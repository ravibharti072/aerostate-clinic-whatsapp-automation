import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import Clinic, NotificationLog
from app.services.notifications import notification_service, DEFAULT_TEMPLATES

router = APIRouter(prefix="/api/notifications", tags=["Notifications & Reminders"])


class ReminderProcessRequest(BaseModel):
    now_override: Optional[datetime.datetime] = None


class ClinicNotificationSettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    reminder_24h_enabled: Optional[bool] = None
    reminder_2h_enabled: Optional[bool] = None
    reminder_template_24h: Optional[str] = None
    reminder_template_2h: Optional[str] = None
    notify_booking_confirmed: Optional[bool] = None
    notify_booking_rescheduled: Optional[bool] = None
    notify_booking_cancelled: Optional[bool] = None
    notify_payment_confirmed: Optional[bool] = None
    notify_payment_failed: Optional[bool] = None


@router.post("/run-reminders")
def run_due_reminders(
    payload: Optional[ReminderProcessRequest] = None,
    db: Session = Depends(get_db),
):
    """
    Manually triggers appointment reminder evaluation across all active clinics.
    Supports time override for testing and simulation.
    """
    now_ov = payload.now_override if payload else None
    stats = notification_service.process_due_reminders(db, now_override=now_ov)
    return {
        "status": "success",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "stats": stats,
    }


@router.post("/retry-failed")
def retry_failed_notifications(db: Session = Depends(get_db)):
    """Retries transient failed notifications up to max retries."""
    retried = notification_service.retry_failed_notifications(db)
    return {"status": "success", "retried_count": retried}


@router.get("/logs")
def get_notification_logs(
    clinic_id: Optional[int] = Query(None),
    notification_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Fetches persistent notification logs with audit and delivery status information."""
    query = db.query(NotificationLog)
    if clinic_id:
        query = query.filter(NotificationLog.clinic_id == clinic_id)
    if notification_type:
        query = query.filter(NotificationLog.notification_type == notification_type)
    if status:
        query = query.filter(NotificationLog.status == status.upper())

    logs = query.order_by(NotificationLog.id.desc()).limit(limit).all()
    return [
        {
            "id": l.id,
            "clinic_id": l.clinic_id,
            "appointment_id": l.appointment_id,
            "patient_id": l.patient_id,
            "recipient_phone": l.recipient_phone,
            "notification_type": l.notification_type,
            "appointment_slot": l.appointment_slot,
            "status": l.status,
            "meta_message_id": l.meta_message_id,
            "retry_count": l.retry_count,
            "sent_at": l.sent_at.isoformat() if l.sent_at else None,
            "error_message": l.error_message,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


@router.get("/clinic-settings/{clinic_id}")
def get_clinic_notification_settings(clinic_id: int, db: Session = Depends(get_db)):
    """Retrieves clinic-specific notification toggles, templates, and timezone configuration."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    return {
        "clinic_id": clinic.id,
        "clinic_name": clinic.name,
        "timezone": clinic.timezone or "Asia/Kolkata",
        "reminder_24h_enabled": getattr(clinic, "reminder_24h_enabled", True),
        "reminder_2h_enabled": getattr(clinic, "reminder_2h_enabled", True),
        "reminder_template_24h": getattr(clinic, "reminder_template_24h", None) or DEFAULT_TEMPLATES["REMINDER_24H"],
        "reminder_template_2h": getattr(clinic, "reminder_template_2h", None) or DEFAULT_TEMPLATES["REMINDER_2H"],
        "notify_booking_confirmed": getattr(clinic, "notify_booking_confirmed", True),
        "notify_booking_rescheduled": getattr(clinic, "notify_booking_rescheduled", True),
        "notify_booking_cancelled": getattr(clinic, "notify_booking_cancelled", True),
        "notify_payment_confirmed": getattr(clinic, "notify_payment_confirmed", True),
        "notify_payment_failed": getattr(clinic, "notify_payment_failed", True),
        "available_templates": DEFAULT_TEMPLATES,
    }


@router.put("/clinic-settings/{clinic_id}")
def update_clinic_notification_settings(
    clinic_id: int, payload: ClinicNotificationSettingsUpdate, db: Session = Depends(get_db)
):
    """Updates clinic-specific notification toggles, templates, and timezone."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    if payload.timezone is not None:
        clinic.timezone = payload.timezone
    if payload.reminder_24h_enabled is not None:
        clinic.reminder_24h_enabled = payload.reminder_24h_enabled
    if payload.reminder_2h_enabled is not None:
        clinic.reminder_2h_enabled = payload.reminder_2h_enabled
    if payload.reminder_template_24h is not None:
        clinic.reminder_template_24h = payload.reminder_template_24h
    if payload.reminder_template_2h is not None:
        clinic.reminder_template_2h = payload.reminder_template_2h
    if payload.notify_booking_confirmed is not None:
        clinic.notify_booking_confirmed = payload.notify_booking_confirmed
    if payload.notify_booking_rescheduled is not None:
        clinic.notify_booking_rescheduled = payload.notify_booking_rescheduled
    if payload.notify_booking_cancelled is not None:
        clinic.notify_booking_cancelled = payload.notify_booking_cancelled
    if payload.notify_payment_confirmed is not None:
        clinic.notify_payment_confirmed = payload.notify_payment_confirmed
    if payload.notify_payment_failed is not None:
        clinic.notify_payment_failed = payload.notify_payment_failed

    db.commit()
    return {"status": "success", "message": "Notification settings updated"}
