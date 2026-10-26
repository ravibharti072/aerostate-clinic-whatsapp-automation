import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_
from app.models import WhatsAppMessage, Patient, Appointment, Doctor
from app.services.whatsapp import whatsapp_client
from app.services.booking import booking_service
from app.config import settings


class MessageService:
    @staticmethod
    def log_message(
        db: Session,
        phone: str,
        sender: str,
        body: str,
        patient_name: Optional[str] = None,
        message_type: str = "text",
        meta_id: Optional[str] = None,
        clinic_id: Optional[int] = None,
    ) -> WhatsAppMessage:
        """Persists a WhatsApp message (patient inbound, bot reply, or manual clinic reply)."""
        clean_phone = phone.strip()
        
        # Ensure patient record exists in Patient Registry (Source: WhatsApp)
        from app.routers.patients import normalize_phone, generate_patient_uid
        clean_phone = (phone or "").strip()
        norm = normalize_phone(clean_phone)
        display_name = (patient_name or "").strip().title()

        if len(norm) == 10:
            stored_phone = f"+91{norm}"
        elif norm and not clean_phone.startswith("+"):
            stored_phone = f"+{norm}"
        else:
            stored_phone = clean_phone

        patient = None
        if norm:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    patient = p
                    break

        if not patient and display_name and display_name.lower() not in ["valued patient", "whatsapp patient"]:
            for p in db.query(Patient).all():
                if (p.name or "").strip().lower() == display_name.lower():
                    patient = p
                    break

        if not patient:
            uid = generate_patient_uid(db)
            patient = Patient(
                phone=stored_phone,
                name=display_name if display_name and display_name != "Valued Patient" else "WhatsApp Patient",
                patient_uid=uid,
                registration_source="WhatsApp",
            )
            db.add(patient)
            db.commit()
            db.refresh(patient)
        elif display_name and display_name not in ["Valued Patient", "WhatsApp Patient"]:
            if (patient.name or "").strip().lower() in ["valued patient", "whatsapp patient", "", display_name.lower()]:
                patient.name = display_name
                db.commit()

        msg = WhatsAppMessage(
            clinic_id=clinic_id,
            phone=clean_phone,
            patient_name=patient_name or "Valued Patient",
            sender=sender,
            message_type=message_type,
            body=body,
            meta_id=meta_id,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        return msg

    @staticmethod
    def get_whatsapp_stats(db: Session) -> Dict[str, Any]:
        """Calculates total messages, inbound from patients, outbound replies, and active channels."""
        total_msgs = db.query(func.count(WhatsAppMessage.id)).scalar() or 0
        inbound = db.query(func.count(WhatsAppMessage.id)).filter(WhatsAppMessage.sender == "patient").scalar() or 0
        outbound = db.query(func.count(WhatsAppMessage.id)).filter(WhatsAppMessage.sender.in_(["clinic", "bot"])).scalar() or 0
        unique_threads = db.query(func.count(func.distinct(WhatsAppMessage.phone))).scalar() or 0
        
        is_live = bool(settings.WHATSAPP_TOKEN and not settings.WHATSAPP_TOKEN.startswith("mock") and not settings.WHATSAPP_TOKEN.startswith("YOUR_META"))

        return {
            "total_messages": total_msgs,
            "inbound_messages": inbound,
            "outbound_messages": outbound,
            "total_threads": unique_threads,
            "service_status": {
                "enabled": True,
                "is_live": is_live,
                "channel_mode": "Meta Cloud API Live" if is_live else "Testing & Simulation Mode",
                "phone_number_id": getattr(settings, "PHONE_NUMBER_ID", "Meta-Cloud-API"),
                "clinic_name": settings.CLINIC_NAME,
            }
        }

    @staticmethod
    def get_conversation_threads(db: Session, search: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Returns all unique conversation threads grouped by phone,
        including latest message preview, timestamp, patient info, and active booking.
        Filtering logic is executed on the backend.
        """
        subq = (
            db.query(
                WhatsAppMessage.phone,
                func.max(WhatsAppMessage.created_at).label("latest_time"),
            )
            .group_by(WhatsAppMessage.phone)
            .subquery()
        )

        recent_phones = (
            db.query(subq.c.phone, subq.c.latest_time)
            .order_by(desc(subq.c.latest_time))
            .all()
        )

        threads = []
        today_str = datetime.date.today().strftime("%Y-%m-%d")

        for phone_row in recent_phones:
            phone = phone_row.phone
            
            # Fetch latest message
            latest_msg = (
                db.query(WhatsAppMessage)
                .filter(WhatsAppMessage.phone == phone)
                .order_by(desc(WhatsAppMessage.created_at))
                .first()
            )

            # Total messages in this thread
            total_count = (
                db.query(func.count(WhatsAppMessage.id))
                .filter(WhatsAppMessage.phone == phone)
                .scalar()
                or 0
            )

            # Patient info
            patient = db.query(Patient).filter(Patient.phone == phone).first()
            patient_name = patient.name if patient else (latest_msg.patient_name if latest_msg else "Valued Patient")
            patient_uid = patient.patient_uid if (patient and patient.patient_uid) else (f"PAT-{patient.id:04d}" if patient else "")

            # Check if there is an upcoming appointment
            upcoming_appt = None
            if patient:
                appt = (
                    db.query(Appointment)
                    .filter(
                        Appointment.patient_id == patient.id,
                        Appointment.status == "CONFIRMED",
                        Appointment.appointment_date >= today_str,
                    )
                    .order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc())
                    .first()
                )
                if appt:
                    doc = db.query(Doctor).filter(Doctor.id == appt.doctor_id).first()
                    upcoming_appt = {
                        "id": appt.id,
                        "date": appt.appointment_date,
                        "time": appt.start_time,
                        "doctor_name": doc.name if doc else "Specialist",
                        "specialization": doc.specialization if doc else "General",
                        "source": appt.source or "WhatsApp",
                    }

            # Backend search filter
            if search and search.strip():
                s = search.strip().lower()
                matches_phone = s in phone.lower()
                matches_name = s in (patient_name or "").lower()
                matches_uid = s in patient_uid.lower()
                matches_body = s in ((latest_msg.body or "") if latest_msg else "").lower()
                if not (matches_phone or matches_name or matches_uid or matches_body):
                    continue

            threads.append({
                "phone": phone,
                "patient_id": patient.id if patient else None,
                "patient_uid": patient_uid,
                "patient_name": patient_name,
                "latest_message": {
                    "body": latest_msg.body if latest_msg else "",
                    "sender": latest_msg.sender if latest_msg else "patient",
                    "message_type": latest_msg.message_type if latest_msg else "text",
                    "created_at": latest_msg.created_at.isoformat() if latest_msg else None,
                },
                "total_messages": total_count,
                "upcoming_appointment": upcoming_appt,
            })

        return threads

    @staticmethod
    def get_messages_for_phone(db: Session, phone: str) -> List[Dict[str, Any]]:
        """Returns the full chronological message log for a given phone number."""
        clean_phone = phone.strip()
        msgs = (
            db.query(WhatsAppMessage)
            .filter(WhatsAppMessage.phone == clean_phone)
            .order_by(WhatsAppMessage.created_at.asc())
            .all()
        )

        return [
            {
                "id": m.id,
                "phone": m.phone,
                "patient_name": m.patient_name,
                "sender": m.sender,
                "message_type": m.message_type,
                "body": m.body,
                "created_at": m.created_at.isoformat(),
            }
            for m in msgs
        ]

    @staticmethod
    def get_reply_templates() -> List[Dict[str, str]]:
        """Pre-defined clinical quick reply templates."""
        return [
            {
                "title": "Doctor is Ready",
                "text": "Hello, your doctor is ready for consultation in Cabin 1. Please proceed inside now.",
            },
            {
                "title": "Confirm Appointment",
                "text": f"Thank you for contacting {settings.CLINIC_NAME}. Your appointment has been confirmed.",
            },
            {
                "title": "Prescription Available",
                "text": "Your digital prescription and dosage instructions have been issued. You may collect medications from the clinic dispensary.",
            },
            {
                "title": "Directions & Parking",
                "text": f"We are located at Agra, UP. Clinic parking is available for all visiting patients. Clinic contact: {settings.CLINIC_PHONE}.",
            },
        ]

    @staticmethod
    async def send_manual_reply(
        db: Session, phone: str, text: str, user_name: str = "Clinic Reception"
    ) -> Dict[str, Any]:
        """Clinic staff manually sends a WhatsApp reply to a patient."""
        clean_phone = phone.strip()
        clean_text = text.strip()

        # Send via WhatsApp client
        await whatsapp_client.send_text(to=clean_phone, text=clean_text)

        # Retrieve patient name if known
        patient = db.query(Patient).filter(Patient.phone == clean_phone).first()
        patient_name = patient.name if patient else "Valued Patient"

        # Log into database
        logged = MessageService.log_message(
            db=db,
            phone=clean_phone,
            sender="clinic",
            body=clean_text,
            patient_name=patient_name,
            message_type="text",
        )

        return {
            "id": logged.id,
            "phone": logged.phone,
            "sender": "clinic",
            "body": logged.body,
            "created_at": logged.created_at.isoformat(),
        }


message_service = MessageService()
