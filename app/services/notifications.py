import datetime
import logging
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.models import Clinic, Doctor, Patient, Appointment, NotificationLog
from app.services.whatsapp import whatsapp_client

logger = logging.getLogger("notifications")

# Default configurable notification templates
DEFAULT_TEMPLATES = {
    "REMINDER_24H": (
        "Hello {{patient_name}},\n\n"
        "This is a reminder from {{clinic_name}}.\n\n"
        "Your appointment is scheduled for:\n"
        "Doctor: {{doctor_name}}\n"
        "Date: {{appointment_date}}\n"
        "Time: {{appointment_time}}\n\n"
        "Please arrive a little early.\n"
        "For rescheduling or cancellation, reply to this message or use the appointment management menu.\n\n"
        "Thank you!"
    ),
    "REMINDER_2H": (
        "Hello {{patient_name}},\n\n"
        "This is a reminder from {{clinic_name}}.\n\n"
        "Your appointment is scheduled today in about 2 hours:\n"
        "Doctor: {{doctor_name}}\n"
        "Date: {{appointment_date}}\n"
        "Time: {{appointment_time}}\n\n"
        "Please arrive 10 minutes prior to your slot.\n"
        "For urgent updates or rescheduling, reply to this message.\n\n"
        "Thank you!"
    ),
    "CONFIRMATION": (
        "Hello {{patient_name}},\n\n"
        "Your appointment at {{clinic_name}} is confirmed!\n\n"
        "📋 Booking ID: #{{booking_id}}\n"
        "👨‍⚕️ Doctor: {{doctor_name}}\n"
        "📅 Date: {{appointment_date}}\n"
        "⏰ Time: {{appointment_time}}\n"
        "💳 Payment: {{payment_status}}\n\n"
        "Please arrive 10 minutes prior to your consultation.\n"
        "Thank you!"
    ),
    "RESCHEDULED": (
        "Hello {{patient_name}},\n\n"
        "Your appointment at {{clinic_name}} has been rescheduled.\n\n"
        "📋 Booking ID: #{{booking_id}}\n"
        "👨‍⚕️ Doctor: {{doctor_name}}\n"
        "📅 New Date: {{appointment_date}}\n"
        "⏰ New Time: {{appointment_time}}\n"
        "⏮️ Previous Slot: {{previous_slot}}\n\n"
        "Thank you!"
    ),
    "CANCELLED": (
        "Hello {{patient_name}},\n\n"
        "Your appointment at {{clinic_name}} (#{{booking_id}}) on {{appointment_date}} at {{appointment_time}} has been cancelled.\n\n"
        "{{refund_note}}\n"
        "Thank you!"
    ),
    "PAYMENT_CONFIRMATION": (
        "Hello {{patient_name}},\n\n"
        "We have received your payment of ₹{{amount}} for Booking #{{booking_id}} at {{clinic_name}}.\n\n"
        "Payment ID: {{payment_id}}\n"
        "Status: Confirmed\n\n"
        "Thank you!"
    ),
    "PAYMENT_FAILURE": (
        "Hello {{patient_name}},\n\n"
        "Payment for Booking #{{booking_id}} at {{clinic_name}} could not be completed.\n\n"
        "Reason: {{failure_reason}}\n"
        "You may pay at the clinic counter or retry the payment link.\n\n"
        "Thank you!"
    ),
}


class NotificationService:
    """Manages scheduled appointment reminders, event notifications, duplicate prevention, and retries."""

    @staticmethod
    def render_template(template: str, context: Dict[str, Any]) -> str:
        """Substitutes {{variable}} placeholders with values from context."""
        rendered = template
        for k, v in context.items():
            rendered = rendered.replace(f"{{{{{k}}}}}", str(v) if v is not None else "")
        return rendered

    @staticmethod
    def get_clinic_timezone(clinic: Optional[Clinic]) -> ZoneInfo:
        """Returns clinic configured timezone, falling back to Asia/Kolkata."""
        tz_name = (clinic.timezone if clinic and clinic.timezone else "") or "Asia/Kolkata"
        try:
            return ZoneInfo(tz_name)
        except Exception as e:
            logger.warning(f"Invalid timezone '{tz_name}' for clinic {getattr(clinic, 'id', None)}, defaulting to Asia/Kolkata: {e}")
            return ZoneInfo("Asia/Kolkata")

    @classmethod
    def is_notification_enabled(cls, clinic: Clinic, notification_type: str) -> bool:
        """Checks whether the clinic administrator has enabled the given notification."""
        if not clinic:
            return False

        type_map = {
            "REMINDER_24H": "reminder_24h_enabled",
            "REMINDER_2H": "reminder_2h_enabled",
            "CONFIRMATION": "notify_booking_confirmed",
            "RESCHEDULED": "notify_booking_rescheduled",
            "CANCELLED": "notify_booking_cancelled",
            "PAYMENT_CONFIRMATION": "notify_payment_confirmed",
            "PAYMENT_FAILURE": "notify_payment_failed",
        }
        field_name = type_map.get(notification_type)
        if field_name:
            return bool(getattr(clinic, field_name, True))
        return True

    @classmethod
    def build_notification_context(
        cls, clinic: Clinic, appointment: Optional[Appointment] = None, extra_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Constructs standardized context parameters for template rendering."""
        ctx = {
            "clinic_name": clinic.name if clinic else settings.CLINIC_NAME or "Aerostate Clinic",
            "clinic_phone": clinic.phone if clinic else settings.CLINIC_PHONE or "",
            "clinic_address": clinic.address if clinic else settings.CLINIC_ADDRESS or "",
        }
        if appointment:
            doc_name = appointment.doctor.name if appointment.doctor else "Doctor"
            if not doc_name.lower().startswith("dr.") and not doc_name.lower().startswith("dr "):
                doc_name = f"Dr. {doc_name}"

            pat_name = appointment.patient.name if appointment.patient else "Valued Patient"
            pay_status = appointment.payment_status or "PENDING"
            pay_display = f"PAID (₹{appointment.paid_amount or 500})" if pay_status == "PAID" else "Pay at clinic"

            ctx.update({
                "booking_id": appointment.id,
                "patient_name": pat_name,
                "doctor_name": doc_name,
                "appointment_date": appointment.appointment_date,
                "appointment_time": appointment.start_time,
                "previous_slot": appointment.previous_slot or "N/A",
                "payment_status": pay_display,
                "refund_note": "If an online payment was made, please contact reception for refund processing." if pay_status == "PAID" else "",
            })

        if extra_context:
            ctx.update(extra_context)

        return ctx

    @classmethod
    async def send_notification(
        cls,
        db: Session,
        clinic: Clinic,
        notification_type: str,
        recipient_phone: str,
        appointment: Optional[Appointment] = None,
        extra_context: Optional[Dict[str, Any]] = None,
        force: bool = False,
        use_buttons: bool = True,
    ) -> Optional[NotificationLog]:
        """
        Sends an event notification or reminder with duplicate prevention, DB persistence, and failure handling.
        """
        if not clinic or not clinic.is_active:
            logger.info(f"Skipping notification {notification_type}: clinic is inactive or not provided.")
            return None

        # Check clinic configuration toggle
        if not force and not cls.is_notification_enabled(clinic, notification_type):
            logger.info(f"Notification {notification_type} is disabled for clinic #{clinic.id} ({clinic.name}).")
            return None

        # Determine slot key for duplicate reminder protection
        slot_key = None
        if appointment:
            slot_key = f"{appointment.appointment_date}_{appointment.start_time[:5]}"

        # Duplicate check: check if already successfully sent or recorded for this appointment and slot
        if appointment and slot_key:
            existing = (
                db.query(NotificationLog)
                .filter(
                    NotificationLog.appointment_id == appointment.id,
                    NotificationLog.notification_type == notification_type,
                    NotificationLog.appointment_slot == slot_key,
                )
                .first()
            )
            if existing:
                if not force:
                    # Never send duplicate reminders unless explicitly forced
                    logger.info(
                        f"Duplicate prevented: {notification_type} for appointment #{appointment.id} ({slot_key}) "
                        f"already exists with status='{existing.status}' (log #{existing.id})."
                    )
                    return None
                elif existing.status in ["SENT", "DELIVERED", "READ"]:
                    # Even when forced (retry), do not send if already successfully sent/delivered/read
                    logger.info(
                        f"Duplicate prevented: {notification_type} for appointment #{appointment.id} ({slot_key}) "
                        f"already sent (log #{existing.id})."
                    )
                    return None

        # Choose template (clinic custom template or default)
        template_str = None
        if notification_type == "REMINDER_24H" and clinic.reminder_template_24h:
            template_str = clinic.reminder_template_24h
        elif notification_type == "REMINDER_2H" and clinic.reminder_template_2h:
            template_str = clinic.reminder_template_2h
        else:
            template_str = DEFAULT_TEMPLATES.get(notification_type, "Notification from {{clinic_name}}")

        context = cls.build_notification_context(clinic, appointment, extra_context)
        message_body = cls.render_template(template_str, context)

        # Retrieve or initialize persistent log record
        log_entry = None
        if appointment and slot_key:
            log_entry = (
                db.query(NotificationLog)
                .filter(
                    NotificationLog.appointment_id == appointment.id,
                    NotificationLog.notification_type == notification_type,
                    NotificationLog.appointment_slot == slot_key,
                )
                .first()
            )

        if not log_entry:
            log_entry = NotificationLog(
                clinic_id=clinic.id,
                appointment_id=appointment.id if appointment else None,
                patient_id=appointment.patient_id if appointment else None,
                recipient_phone=recipient_phone,
                notification_type=notification_type,
                appointment_slot=slot_key,
                status="PENDING",
                message_body=message_body,
                retry_count=0,
                max_retries=3,
                created_at=datetime.datetime.utcnow(),
            )
            db.add(log_entry)
            try:
                db.commit()
                db.refresh(log_entry)
            except IntegrityError:
                db.rollback()
                logger.warning("Concurrent duplicate notification insert prevented by database unique constraint.")
                return None

        # Transmit message via WhatsApp
        phone_number_id = clinic.phone_number_id or settings.PHONE_NUMBER_ID
        whatsapp_token = clinic.whatsapp_token or settings.WHATSAPP_TOKEN

        try:
            buttons = None
            if use_buttons and appointment and notification_type.startswith("REMINDER_"):
                buttons = [
                    {"id": f"resched_{appointment.id}", "title": "🔄 Reschedule"},
                    {"id": f"cancel_req_{appointment.id}", "title": "❌ Cancel"},
                    {"id": "btn_menu", "title": "🏠 Main Menu"},
                ]

            if buttons:
                res = await whatsapp_client.send_quick_reply_buttons(
                    to=recipient_phone,
                    body_text=message_body,
                    buttons=buttons,
                    header_text="Appointment Reminder",
                    phone_number_id=phone_number_id,
                    token=whatsapp_token,
                )
            else:
                res = await whatsapp_client.send_text(
                    to=recipient_phone,
                    text=message_body,
                    phone_number_id=phone_number_id,
                    token=whatsapp_token,
                )

            is_success = False
            meta_id = None
            if isinstance(res, dict):
                msgs = res.get("messages", [])
                if msgs and isinstance(msgs, list) and len(msgs) > 0 and "id" in msgs[0]:
                    meta_id = msgs[0]["id"]
                    is_success = True
                elif res.get("simulated") or res.get("queued"):
                    is_success = True
                    meta_id = res.get("meta_id")

            if is_success:
                log_entry.status = "SENT"
                log_entry.sent_at = datetime.datetime.utcnow()
                log_entry.meta_message_id = meta_id
                log_entry.error_message = None
                db.commit()
                logger.info(f"Notification {notification_type} sent successfully to {recipient_phone} (wamid: {meta_id}).")
                return log_entry
            else:
                err_msg = "WhatsApp dispatch returned failure"
                if isinstance(res, dict) and "error" in res:
                    err_msg = str(res["error"])
                elif isinstance(res, dict) and "message" in res:
                    err_msg = str(res["message"])
                log_entry.status = "FAILED"
                log_entry.retry_count += 1
                log_entry.error_message = err_msg
                db.commit()
                logger.error(f"Notification {notification_type} failed for {recipient_phone}: {err_msg}")
                return log_entry

        except Exception as e:
            logger.error(f"Failed to send notification {notification_type} to {recipient_phone}: {e}")
            log_entry.status = "FAILED"
            log_entry.retry_count += 1
            log_entry.error_message = str(e)
            db.commit()
            return log_entry

    @classmethod
    async def process_due_reminders(cls, db: Session, now_override: Optional[datetime.datetime] = None) -> Dict[str, int]:
        """
        Scans all active clinics and evaluates upcoming appointments for 24-hour and 2-hour reminders.
        Timezone-aware: converts current wall-clock time to each clinic's configured timezone.
        """
        stats = {"reminders_24h_sent": 0, "reminders_2h_sent": 0, "errors": 0}
        clinics = db.query(Clinic).filter(Clinic.is_active == True).all()

        for clinic in clinics:
            clinic_tz = cls.get_clinic_timezone(clinic)
            if now_override:
                if now_override.tzinfo is not None:
                    now_local = now_override.astimezone(clinic_tz)
                else:
                    now_local = now_override.replace(tzinfo=clinic_tz)
            else:
                now_local = datetime.datetime.now(clinic_tz)

            # Query active upcoming appointments
            appts = (
                db.query(Appointment)
                .filter(
                    Appointment.clinic_id == clinic.id,
                    Appointment.status.in_(["CONFIRMED", "PENDING"]),
                )
                .all()
            )

            for appt in appts:
                try:
                    clean_time = appt.start_time[:5]
                    appt_dt = datetime.datetime.strptime(
                        f"{appt.appointment_date} {clean_time}", "%Y-%m-%d %H:%M"
                    ).replace(tzinfo=clinic_tz)

                    diff_hours = (appt_dt - now_local).total_seconds() / 3600.0

                    recipient_phone = appt.patient.phone if appt.patient else None
                    if not recipient_phone:
                        continue

                    # 1. 24-Hour Reminder Check (Target: within 24h, but more than 2h away)
                    if 2.0 < diff_hours <= 24.5 and clinic.reminder_24h_enabled:
                        log = await cls.send_notification(
                            db=db,
                            clinic=clinic,
                            notification_type="REMINDER_24H",
                            recipient_phone=recipient_phone,
                            appointment=appt,
                        )
                        if log and log.status == "SENT":
                            stats["reminders_24h_sent"] += 1

                    # 2. 2-Hour Reminder Check (Target: between 0 and 2 hours before consultation)
                    elif 0.0 <= diff_hours <= 2.0 and clinic.reminder_2h_enabled:
                        log = await cls.send_notification(
                            db=db,
                            clinic=clinic,
                            notification_type="REMINDER_2H",
                            recipient_phone=recipient_phone,
                            appointment=appt,
                        )
                        if log and log.status == "SENT":
                            stats["reminders_2h_sent"] += 1

                except Exception as ex:
                    logger.warning(f"Error processing reminder for appointment #{appt.id}: {ex}")
                    stats["errors"] += 1

        return stats

    @classmethod
    async def retry_failed_notifications(cls, db: Session) -> int:
        """Retries notifications that encountered temporary failures and have remaining retries."""
        # Minimum 15 minutes cooldown before retrying to avoid rapid retry spam
        cutoff_time = datetime.datetime.utcnow() - datetime.timedelta(minutes=15)
        failed_logs = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.status == "FAILED",
                NotificationLog.retry_count < NotificationLog.max_retries,
                NotificationLog.created_at <= cutoff_time,
            )
            .all()
        )
        retried_count = 0
        for log in failed_logs:
            clinic = db.query(Clinic).filter(Clinic.id == log.clinic_id).first()
            if not clinic or not clinic.is_active:
                continue

            appointment = db.query(Appointment).filter(Appointment.id == log.appointment_id).first() if log.appointment_id else None
            # If appointment was cancelled since the failure, don't retry reminder
            if appointment and appointment.status == "CANCELLED":
                log.status = "CANCELLED"
                db.commit()
                continue

            res = await cls.send_notification(
                db=db,
                clinic=clinic,
                notification_type=log.notification_type,
                recipient_phone=log.recipient_phone,
                appointment=appointment,
                force=True,
            )
            if res and res.status == "SENT":
                retried_count += 1

        return retried_count

    @classmethod
    def update_delivery_status(cls, db: Session, meta_message_id: str, new_status: str) -> bool:
        """Updates delivery status from Meta webhooks (SENT, DELIVERED, READ, FAILED)."""
        if not meta_message_id:
            return False

        log_entry = (
            db.query(NotificationLog)
            .filter(NotificationLog.meta_message_id == meta_message_id)
            .first()
        )
        if log_entry:
            log_entry.status = new_status.upper()
            db.commit()
            return True
        return False

    @classmethod
    def send_notification_sync(cls, *args, **kwargs) -> Optional[NotificationLog]:
        """Synchronous wrapper for test fixtures and script callers."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    return pool.submit(lambda: asyncio.run(cls.send_notification(*args, **kwargs))).result(timeout=15.0)
            return loop.run_until_complete(cls.send_notification(*args, **kwargs))
        except Exception as e:
            logger.error(f"send_notification_sync error: {e}")
            return None

    @classmethod
    def process_due_reminders_sync(cls, *args, **kwargs) -> Dict[str, int]:
        """Synchronous wrapper for test fixtures and script callers."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    return pool.submit(lambda: asyncio.run(cls.process_due_reminders(*args, **kwargs))).result(timeout=30.0)
            return loop.run_until_complete(cls.process_due_reminders(*args, **kwargs))
        except Exception as e:
            logger.error(f"process_due_reminders_sync error: {e}")
            return {"reminders_24h_sent": 0, "reminders_2h_sent": 0, "errors": 1}


notification_service = NotificationService()
