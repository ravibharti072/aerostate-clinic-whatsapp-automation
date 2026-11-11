import secrets
import datetime
import logging
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Appointment,
    Patient,
    Clinic,
    Doctor,
    QueueEntry,
    Prescription,
    LabOrder,
    Payment,
    PatientFeedback,
    FollowUpSchedule,
    DocumentAccessGrant,
    NotificationLog,
)
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service

logger = logging.getLogger("aerostate_clinic.post_appointment")


def format_doc_name(name: Optional[str]) -> str:
    """Safely formats doctor's name, preventing duplicate 'Dr. Dr.' prefixes."""
    cleaned = (name or "Doctor").strip()
    if cleaned.lower().startswith("dr.") or cleaned.lower().startswith("dr "):
        return cleaned
    return f"Dr. {cleaned}"


class PostAppointmentService:
    """Manages post-consultation communication: feedback requests, follow-up reminders,
    secure document notification, and verified payment receipts."""

    @staticmethod
    def complete_appointment(
        db: Session,
        appointment_id: int,
        completed_by: Optional[str] = None,
        send_feedback: bool = True,
        schedule_followup_reminder: bool = True,
    ) -> Dict[str, Any]:
        """
        Marks an appointment as Completed in the ERP.
        Ensures appointment status is updated explicitly by staff (not just because time passed)
        and initiates configured post-appointment communications.
        """
        appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
        if not appt:
            raise ValueError(f"Appointment #{appointment_id} not found.")

        # Update appointment status
        appt.status = "COMPLETED"

        # Synchronize associated QueueEntry if one exists
        q_entry = db.query(QueueEntry).filter(QueueEntry.appointment_id == appointment_id).first()
        if q_entry and q_entry.status != "COMPLETED":
            q_entry.status = "COMPLETED"

        db.commit()
        logger.info(f"Appointment #{appointment_id} explicitly marked COMPLETED by {completed_by or 'Staff'}.")

        clinic = appt.clinic or db.query(Clinic).filter(Clinic.id == appt.clinic_id).first()
        feedback_sent = False
        followup_scheduled = False

        # 1. Configured Feedback Request
        if clinic and getattr(clinic, "feedback_enabled", True) and send_feedback:
            try:
                PostAppointmentService.send_feedback_request(db, appt)
                feedback_sent = True
            except Exception as e:
                logger.error(f"Failed to dispatch feedback request for appt #{appointment_id}: {e}")

        # 2. Configured Follow-up Schedule
        if clinic and getattr(clinic, "followup_reminders_enabled", True) and schedule_followup_reminder:
            try:
                # Default return visit in configured days (e.g. 7 days)
                default_days = getattr(clinic, "followup_default_days", 7) or 7
                try:
                    appt_dt = datetime.datetime.strptime(appt.appointment_date, "%Y-%m-%d").date()
                except Exception:
                    appt_dt = datetime.date.today()
                target_date = (appt_dt + datetime.timedelta(days=default_days)).strftime("%Y-%m-%d")

                # Check if follow-up schedule already exists
                existing_followup = (
                    db.query(FollowUpSchedule)
                    .filter(FollowUpSchedule.appointment_id == appt.id, FollowUpSchedule.status == "SCHEDULED")
                    .first()
                )
                if not existing_followup:
                    followup = FollowUpSchedule(
                        clinic_id=clinic.id,
                        appointment_id=appt.id,
                        patient_id=appt.patient_id,
                        doctor_id=appt.doctor_id,
                        followup_date=target_date,
                        followup_type="RETURN_VISIT",
                        instruction_text=(
                            getattr(clinic, "followup_template", None)
                            or "Clinic return visit recommendation: please schedule your follow-up consultation."
                        ),
                        status="SCHEDULED",
                        created_at=datetime.datetime.utcnow(),
                    )
                    db.add(followup)
                    db.commit()
                    followup_scheduled = True
            except Exception as e:
                logger.error(f"Failed to schedule follow-up for appt #{appointment_id}: {e}")

        return {
            "status": "COMPLETED",
            "appointment_id": appt.id,
            "patient_name": appt.patient.name if appt.patient else "Valued Patient",
            "feedback_sent": feedback_sent,
            "followup_scheduled": followup_scheduled,
        }

    @staticmethod
    def send_feedback_request(db: Session, appointment: Appointment) -> Optional[Dict[str, Any]]:
        """Sends WhatsApp rating & review request for a completed consultation."""
        clinic = appointment.clinic or db.query(Clinic).filter(Clinic.id == appointment.clinic_id).first()
        if not clinic or not getattr(clinic, "feedback_enabled", True):
            logger.info(f"Feedback disabled for clinic {clinic.id if clinic else 'unknown'}; skipping.")
            return None

        patient = appointment.patient
        if not patient or not patient.phone:
            logger.warning(f"No valid patient phone for appt #{appointment.id}; skipping feedback.")
            return None

        # Check if feedback has already been submitted for this appointment
        existing_fb = db.query(PatientFeedback).filter(PatientFeedback.appointment_id == appointment.id).first()
        if existing_fb and existing_fb.rating:
            logger.info(f"Feedback already submitted for appt #{appointment.id}; skipping request.")
            return None

        # Check deduplication in NotificationLog
        existing_notif = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.appointment_id == appointment.id,
                NotificationLog.notification_type == "FEEDBACK_REQUEST",
                NotificationLog.status == "SENT",
            )
            .first()
        )
        if existing_notif:
            logger.info(f"Feedback request already dispatched for appt #{appointment.id}; skipping duplicate.")
            return None

        clinic_name = clinic.name or settings.CLINIC_NAME or "our clinic"
        doctor_name = appointment.doctor.name if appointment.doctor else "our doctor"

        custom_template = getattr(clinic, "feedback_template", None)
        if custom_template and "{{patient_name}}" in custom_template:
            body = (
                custom_template
                .replace("{{patient_name}}", patient.name or "Valued Patient")
                .replace("{{clinic_name}}", clinic_name)
                .replace("{{doctor_name}}", doctor_name)
            )
        else:
            body = (
                f"Hello *{patient.name or 'Valued Patient'}*,\n\n"
                f"Thank you for visiting *{clinic_name}* today.\n\n"
                f"We would appreciate your feedback about your consultation with *{format_doc_name(doctor_name)}*.\n\n"
                f"How was your visit?"
            )

        buttons = [
            {"id": f"fb_rate_5_{appointment.id}", "title": "⭐⭐⭐⭐⭐ Excellent"},
            {"id": f"fb_rate_4_{appointment.id}", "title": "⭐⭐⭐⭐ Good"},
            {"id": f"fb_rate_2_{appointment.id}", "title": "⭐ Needs Improvement"},
        ]

        import asyncio
        try:
            # Send buttons via async whatsapp client
            coro = whatsapp_client.send_quick_reply_buttons(
                to=patient.phone,
                body_text=body,
                buttons=buttons,
                header_text=clinic_name,
                phone_number_id=clinic.phone_number_id,
            )
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(coro)
            except RuntimeError:
                asyncio.run(coro)

            # Log to NotificationLog
            notif = NotificationLog(
                clinic_id=clinic.id,
                appointment_id=appointment.id,
                patient_id=patient.id,
                recipient_phone=patient.phone,
                notification_type="FEEDBACK_REQUEST",
                status="SENT",
                message_body=body,
                sent_at=datetime.datetime.utcnow(),
            )
            db.add(notif)
            db.commit()

            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="bot",
                body=body,
                patient_name=patient.name,
                message_type="feedback_request",
                clinic_id=clinic.id,
            )
            return {"status": "SENT", "appointment_id": appointment.id}
        except Exception as e:
            logger.error(f"Error sending feedback request: {e}")
            return None

    @staticmethod
    def record_feedback(
        db: Session,
        clinic_id: int,
        appointment_id: int,
        patient_id: int,
        rating: int,
        rating_label: Optional[str] = None,
        comments: Optional[str] = None,
    ) -> PatientFeedback:
        """Stores or updates patient feedback against the clinic and appointment."""
        clamped_rating = max(1, min(5, int(rating)))
        label = rating_label or {5: "Excellent", 4: "Good", 3: "Average", 2: "Poor", 1: "Very Poor"}.get(clamped_rating, "Rated")

        fb = db.query(PatientFeedback).filter(PatientFeedback.appointment_id == appointment_id).first()
        if not fb:
            fb = PatientFeedback(
                clinic_id=clinic_id,
                appointment_id=appointment_id,
                patient_id=patient_id,
                rating=clamped_rating,
                rating_label=label,
                comments=comments.strip() if comments else None,
                created_at=datetime.datetime.utcnow(),
            )
            db.add(fb)
        else:
            fb.rating = clamped_rating
            fb.rating_label = label
            if comments:
                fb.comments = comments.strip()

        db.commit()
        db.refresh(fb)
        logger.info(f"Feedback recorded for appt #{appointment_id}: {clamped_rating}/5 stars.")
        return fb

    @staticmethod
    def schedule_followup(
        db: Session,
        clinic_id: int,
        appointment_id: int,
        patient_id: int,
        doctor_id: Optional[int],
        followup_date: str,
        instruction_text: Optional[str] = None,
        followup_type: str = "RETURN_VISIT",
    ) -> FollowUpSchedule:
        """
        Schedules a follow-up reminder with clinic-approved instructions.
        Strictly prevents generating unauthorized automated medical advice.
        """
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        approved_text = (
            instruction_text
            or (clinic.followup_template if clinic else None)
            or "Recommended return consultation: please schedule your follow-up visit."
        )

        schedule = FollowUpSchedule(
            clinic_id=clinic_id,
            appointment_id=appointment_id,
            patient_id=patient_id,
            doctor_id=doctor_id,
            followup_date=followup_date,
            followup_type=followup_type,
            instruction_text=approved_text,
            status="SCHEDULED",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
        return schedule

    @staticmethod
    def process_due_followups(db: Session, target_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """Scans and dispatches due follow-up reminders that have been clinic-approved."""
        import asyncio
        if not target_date:
            target_date = datetime.date.today().strftime("%Y-%m-%d")

        due_schedules = (
            db.query(FollowUpSchedule)
            .filter(FollowUpSchedule.status == "SCHEDULED", FollowUpSchedule.followup_date <= target_date)
            .all()
        )

        dispatched = []
        for sched in due_schedules:
            clinic = sched.clinic or db.query(Clinic).filter(Clinic.id == sched.clinic_id).first()
            if not clinic or not getattr(clinic, "followup_reminders_enabled", True):
                continue

            patient = sched.patient
            if not patient or not patient.phone:
                continue

            doctor = sched.doctor
            doc_name = doctor.name if doctor else "your doctor"
            clinic_name = clinic.name or settings.CLINIC_NAME or "our clinic"

            body = (
                f"🔔 *FOLLOW-UP REMINDER from {clinic_name}*\n\n"
                f"Hello *{patient.name}*,\n\n"
                f"This is a reminder regarding your recent visit with Dr. *{doc_name}*.\n\n"
                f"📅 *Scheduled Follow-up Date:* {sched.followup_date}\n"
                f"📋 *Clinic Note:* {sched.instruction_text}\n\n"
                f"To book your follow-up appointment or speak with our team, please reply below:"
            )

            buttons = [
                {"id": "btn_book", "title": "📅 Book Appointment"},
                {"id": "btn_human", "title": "💬 Talk to Reception"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]

            try:
                coro = whatsapp_client.send_quick_reply_buttons(
                    to=patient.phone,
                    body_text=body,
                    buttons=buttons,
                    header_text="Follow-up Care",
                    phone_number_id=clinic.phone_number_id,
                )
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(coro)
                except RuntimeError:
                    asyncio.run(coro)

                sched.status = "SENT"
                sched.sent_at = datetime.datetime.utcnow()

                notif = NotificationLog(
                    clinic_id=clinic.id,
                    appointment_id=sched.appointment_id,
                    patient_id=patient.id,
                    recipient_phone=patient.phone,
                    notification_type="FOLLOWUP_REMINDER",
                    status="SENT",
                    message_body=body,
                    sent_at=datetime.datetime.utcnow(),
                )
                db.add(notif)
                db.commit()

                message_service.log_message(
                    db=db,
                    phone=patient.phone,
                    sender="bot",
                    body=body,
                    patient_name=patient.name,
                    message_type="followup_reminder",
                    clinic_id=clinic.id,
                )
                dispatched.append({"schedule_id": sched.id, "patient": patient.name, "phone": patient.phone})
            except Exception as e:
                logger.error(f"Failed to dispatch follow-up schedule #{sched.id}: {e}")

        return dispatched

    @staticmethod
    def create_document_access_grant(
        db: Session,
        clinic_id: int,
        patient_id: int,
        document_type: str,
        document_id: int,
        created_by: Optional[str] = None,
        expiry_hours: int = 24,
    ) -> DocumentAccessGrant:
        """Generates a secure, cryptographically random, expiring access grant for a medical document."""
        token = secrets.token_urlsafe(32)
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(hours=expiry_hours)

        grant = DocumentAccessGrant(
            clinic_id=clinic_id,
            patient_id=patient_id,
            document_type=document_type.upper(),
            document_id=document_id,
            token=token,
            expires_at=expires_at,
            created_by=created_by or "Staff",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(grant)
        db.commit()
        db.refresh(grant)
        return grant

    @staticmethod
    def verify_and_access_document(
        db: Session,
        token: str,
        requesting_patient_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Validates token integrity, expiration, and patient authorization before serving medical documents.
        Enforces strict cross-patient isolation.
        """
        grant = db.query(DocumentAccessGrant).filter(DocumentAccessGrant.token == token).first()
        if not grant or grant.is_revoked:
            return {"status": "ERROR", "code": 404, "detail": "Invalid or revoked document access link."}

        # Check expiration
        if grant.expires_at < datetime.datetime.utcnow():
            return {
                "status": "ERROR",
                "code": 410,
                "detail": "This secure document access link has expired for your privacy. Please contact the clinic for a new link.",
            }

        # Cross-patient verification
        if requesting_patient_id and grant.patient_id != requesting_patient_id:
            logger.warning(
                f"[SECURITY_ALERT] Cross-patient document access attempt blocked! "
                f"Grant patient={grant.patient_id}, Requesting patient={requesting_patient_id}"
            )
            return {"status": "ERROR", "code": 403, "detail": "Access denied: Unauthorized medical document request."}

        # Record access audit
        grant.access_count += 1
        grant.last_accessed_at = datetime.datetime.utcnow()
        db.commit()

        clinic = grant.clinic or db.query(Clinic).filter(Clinic.id == grant.clinic_id).first()
        patient = grant.patient or db.query(Patient).filter(Patient.id == grant.patient_id).first()

        doc_data = {}
        if grant.document_type == "PRESCRIPTION":
            rx = db.query(Prescription).filter(Prescription.id == grant.document_id).first()
            if rx:
                doc_data = {
                    "document_id": rx.id,
                    "prescription_uid": rx.prescription_uid,
                    "diagnosis": rx.diagnosis,
                    "medicines": rx.medicines,
                    "advice": rx.advice,
                    "doctor_name": rx.doctor.name if rx.doctor else "Doctor",
                    "doctor_specialization": rx.doctor.specialization if rx.doctor else "General",
                    "date": rx.signed_at.strftime("%Y-%m-%d") if rx.signed_at else "",
                }
        elif grant.document_type == "LAB_REPORT":
            lab = db.query(LabOrder).filter(LabOrder.id == grant.document_id).first()
            if lab:
                doc_data = {
                    "document_id": lab.id,
                    "order_uid": lab.order_uid,
                    "status": lab.status,
                    "tests": lab.tests,
                    "clinical_indication": lab.clinical_indication,
                    "date": lab.created_at.strftime("%Y-%m-%d"),
                }
        elif grant.document_type == "PAYMENT_RECEIPT":
            pay = db.query(Payment).filter(Payment.id == grant.document_id).first()
            if pay:
                doc_data = {
                    "payment_uid": pay.payment_uid,
                    "amount": pay.amount,
                    "payment_method": pay.payment_method,
                    "transaction_ref": pay.transaction_ref,
                    "date": pay.created_at.strftime("%Y-%m-%d %H:%M"),
                }

        return {
            "status": "SUCCESS",
            "document_type": grant.document_type,
            "patient_name": patient.name if patient else "Valued Patient",
            "clinic_name": clinic.name if clinic else settings.CLINIC_NAME,
            "clinic_phone": clinic.phone if clinic else "",
            "document": doc_data,
            "expires_at": grant.expires_at.isoformat(),
        }

    @staticmethod
    def notify_document_ready(
        db: Session,
        document_type: str,
        document_id: int,
        clinic_id: int,
        staff_user: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> Dict[str, Any]:
        """
        Notifies patient that a prescription or lab report is ready.
        If secure access is enabled: sends a secure expiring link.
        If secure access is disabled: prompts patient to collect in person from clinic reception.
        Never exposes permanent unauthenticated public links.
        """
        import asyncio
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise ValueError(f"Clinic #{clinic_id} not found.")

        patient = None
        doc_label = "Medical Document"
        if document_type.upper() == "PRESCRIPTION":
            rx = db.query(Prescription).filter(Prescription.id == document_id).first()
            if not rx:
                raise ValueError(f"Prescription #{document_id} not found.")
            patient = rx.patient
            doc_label = "Official Doctor Prescription"
        elif document_type.upper() == "LAB_REPORT":
            lab = db.query(LabOrder).filter(LabOrder.id == document_id).first()
            if not lab:
                raise ValueError(f"Lab Order #{document_id} not found.")
            patient = lab.patient
            doc_label = "Laboratory Diagnostic Report"
        else:
            raise ValueError(f"Unsupported document type '{document_type}'.")

        if not patient or not patient.phone:
            raise ValueError("Document is not linked to a patient with a valid phone number.")

        clinic_name = clinic.name or settings.CLINIC_NAME or "our clinic"
        is_secure_enabled = getattr(clinic, "document_access_enabled", True)

        if is_secure_enabled:
            expiry_hours = getattr(clinic, "document_token_expiry_hours", 24) or 24
            grant = PostAppointmentService.create_document_access_grant(
                db=db,
                clinic_id=clinic.id,
                patient_id=patient.id,
                document_type=document_type.upper(),
                document_id=document_id,
                created_by=staff_user or "Authorized Staff",
                expiry_hours=expiry_hours,
            )
            secure_url = f"{base_url}/portal/documents/{grant.token}"
            body = (
                f"📄 *{doc_label.upper()} READY*\n\n"
                f"Hello *{patient.name}*,\n"
                f"Your {doc_label.lower()} from *{clinic_name}* is now available.\n\n"
                f"🔒 *Secure Access Link:*\n{secure_url}\n\n"
                f"⏱️ _For your medical confidentiality, this link is valid for {expiry_hours} hours._"
            )
        else:
            # Secure web access disabled: prompt patient to contact clinic desk
            body = (
                f"📄 *{doc_label.upper()} READY*\n\n"
                f"Hello *{patient.name}*,\n"
                f"Your {doc_label.lower()} from *{clinic_name}* has been prepared by our clinical team.\n\n"
                f"📍 Please visit our clinic reception desk during working hours to collect your printed copy, "
                f"or contact reception directly."
            )

        buttons = [
            {"id": "btn_human", "title": "💬 Talk to Reception"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]

        try:
            coro = whatsapp_client.send_quick_reply_buttons(
                to=patient.phone,
                body_text=body,
                buttons=buttons,
                header_text=clinic_name,
                phone_number_id=clinic.phone_number_id,
            )
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(coro)
            except RuntimeError:
                asyncio.run(coro)

            notif = NotificationLog(
                clinic_id=clinic.id,
                patient_id=patient.id,
                recipient_phone=patient.phone,
                notification_type="DOCUMENT_READY",
                status="SENT",
                message_body=body,
                sent_at=datetime.datetime.utcnow(),
            )
            db.add(notif)
            db.commit()

            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="bot",
                body=body,
                patient_name=patient.name,
                message_type="document_ready",
                clinic_id=clinic.id,
            )
            return {"status": "SENT", "patient": patient.name, "secure_enabled": is_secure_enabled}
        except Exception as e:
            logger.error(f"Failed to dispatch document ready notification: {e}")
            raise e

    @staticmethod
    def send_payment_receipt(db: Session, payment_id: int, base_url: str = "http://localhost:8000") -> Dict[str, Any]:
        """
        Sends an official payment receipt over WhatsApp only for verified payments.
        Strictly rejects generating receipts for pending or failed payments.
        """
        import asyncio
        payment = db.query(Payment).filter(Payment.id == payment_id).first()
        if not payment:
            raise ValueError(f"Payment #{payment_id} not found.")

        # Verify payment status: must be linked to a valid invoice or verified payment
        invoice = payment.invoice
        if invoice and invoice.payment_status not in ["PAID", "PARTIALLY_PAID"]:
            raise ValueError(f"Cannot generate paid receipt for invoice with status '{invoice.payment_status}'. Payment must be verified.")

        # Check linked appointment payment_status if applicable
        if invoice and invoice.appointment and invoice.appointment.payment_status not in ["PAID"]:
            raise ValueError("Cannot generate paid receipt: Appointment payment status is not PAID.")

        patient = invoice.patient if invoice else None
        if not patient or not patient.phone:
            raise ValueError("No valid patient contact linked to this payment.")

        clinic = None
        if invoice and invoice.appointment and invoice.appointment.clinic:
            clinic = invoice.appointment.clinic
        elif invoice and invoice.appointment_id:
            appt = db.query(Appointment).filter(Appointment.id == invoice.appointment_id).first()
            clinic = appt.clinic if appt else None

        if not clinic:
            clinic = db.query(Clinic).filter(Clinic.is_active == True).first()

        if clinic and not getattr(clinic, "payment_receipt_enabled", True):
            raise ValueError(f"Payment receipts are disabled for clinic {clinic.name}.")

        clinic_name = clinic.name if clinic else settings.CLINIC_NAME or "our clinic"
        date_str = payment.created_at.strftime("%d %b %Y, %I:%M %p")

        receipt_body = (
            f"🧾 *OFFICIAL PAYMENT RECEIPT*\n\n"
            f"Hello *{patient.name}*,\n"
            f"Your payment has been successfully verified by *{clinic_name}*:\n\n"
            f"• *Receipt No:* `{payment.payment_uid}`\n"
            f"• *Amount Paid:* *₹{payment.amount:,.2f}*\n"
            f"• *Payment Method:* {payment.payment_method}\n"
            f"• *Transaction Ref:* `{payment.transaction_ref or 'Desk Verified'}`\n"
            f"• *Payment Status:* ✅ *PAID (Verified)*\n"
            f"• *Date & Time:* {date_str}\n\n"
            f"Thank you for choosing *{clinic_name}*!"
        )

        buttons = [
            {"id": "btn_my_appointments", "title": "📅 My Appointments"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]

        try:
            coro = whatsapp_client.send_quick_reply_buttons(
                to=patient.phone,
                body_text=receipt_body,
                buttons=buttons,
                header_text=clinic_name,
                phone_number_id=clinic.phone_number_id if clinic else None,
            )
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(coro)
            except RuntimeError:
                asyncio.run(coro)

            notif = NotificationLog(
                clinic_id=clinic.id if clinic else 1,
                patient_id=patient.id,
                recipient_phone=patient.phone,
                notification_type="PAYMENT_RECEIPT",
                status="SENT",
                message_body=receipt_body,
                sent_at=datetime.datetime.utcnow(),
            )
            db.add(notif)
            db.commit()

            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="bot",
                body=receipt_body,
                patient_name=patient.name,
                message_type="payment_receipt",
                clinic_id=clinic.id if clinic else 1,
            )
            return {"status": "SENT", "payment_uid": payment.payment_uid, "amount": payment.amount}
        except Exception as e:
            logger.error(f"Failed to dispatch payment receipt: {e}")
            raise e


post_appointment_service = PostAppointmentService()
