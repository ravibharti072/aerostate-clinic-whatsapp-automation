import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Appointment, WhatsAppMessage
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.config import settings
from app.security import require_admin

router = APIRouter(prefix="/admin/automation", tags=["WhatsApp Automation & Reminders"], dependencies=[Depends(require_admin)])


@router.post("/run-reminders")
async def run_appointment_reminders(db: Session = Depends(get_db)):
    """
    Finds upcoming confirmed appointments for today and sends automated WhatsApp reminders.
    """
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    appts = (
        db.query(Appointment)
        .filter(Appointment.appointment_date == today_str, Appointment.status == "CONFIRMED")
        .all()
    )

    sent_count = 0
    for a in appts:
        patient = a.patient
        doctor = a.doctor

        if not patient or not patient.phone:
            continue

        reminder_text = (
            f"⏰ *APPOINTMENT REMINDER*\n\n"
            f"Hello *{patient.name}*,\n"
            f"This is a gentle reminder for your scheduled appointment today with Dr. *{doctor.name}* ({doctor.specialization}).\n\n"
            f"📅 *Date:* Today ({a.appointment_date})\n"
            f"⏰ *Time:* {a.start_time} - {a.end_time}\n"
            f"📍 *Clinic:* {settings.CLINIC_NAME} ({settings.CLINIC_ADDRESS})\n\n"
            f"Please arrive 10 minutes before your slot. Reply 'my appointments' anytime to view your bookings."
        )

        try:
            await whatsapp_client.send_text(to=patient.phone, text=reminder_text)
            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="bot",
                body=reminder_text,
                patient_name=patient.name,
                message_type="reminder",
            )
            sent_count += 1
        except Exception as e:
            print("Failed to dispatch reminder to", patient.phone, e)

    return {
        "status": "success",
        "reminders_sent": sent_count,
        "eligible_appointments": len(appts),
    }


@router.post("/run-feedback")
async def run_feedback_followups(db: Session = Depends(get_db)):
    """
    Finds completed appointments from today and sends automated post-visit check-in & review request.
    """
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    appts = (
        db.query(Appointment)
        .filter(Appointment.appointment_date == today_str, Appointment.status == "COMPLETED")
        .all()
    )

    sent_count = 0
    for a in appts:
        patient = a.patient
        doctor = a.doctor

        if not patient or not patient.phone:
            continue

        feedback_text = (
            f"🌟 *THANK YOU FOR VISITING {settings.CLINIC_NAME}!*\n\n"
            f"Hello *{patient.name}*,\n"
            f"We hope your consultation with Dr. *{doctor.name}* went well today.\n\n"
            f"Your health is our top priority. If you need any follow-up, refill advice, or assistance, we are always here for you.\n\n"
            f"Stay healthy and take care! 🌿"
        )

        try:
            await whatsapp_client.send_text(to=patient.phone, text=feedback_text)
            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="bot",
                body=feedback_text,
                patient_name=patient.name,
                message_type="followup",
            )
            sent_count += 1
        except Exception as e:
            print("Failed to dispatch feedback to", patient.phone, e)

    return {
        "status": "success",
        "followups_sent": sent_count,
        "completed_appointments": len(appts),
    }


@router.get("/status")
def get_automation_status(db: Session = Depends(get_db)):
    total_reminders = (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.message_type == "reminder")
        .count()
    )
    total_followups = (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.message_type == "followup")
        .count()
    )

    return {
        "reminders_active": True,
        "followups_active": True,
        "total_reminders_sent": total_reminders,
        "total_followups_sent": total_followups,
    }
