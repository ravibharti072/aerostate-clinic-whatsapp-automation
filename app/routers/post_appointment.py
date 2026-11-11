import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Clinic, Appointment, Patient, PatientFeedback
from app.services.post_appointment import post_appointment_service
from app.security import require_staff

logger = logging.getLogger("aerostate_clinic.post_appointment_router")

router = APIRouter(tags=["Post-Appointment Communication & Follow-up"])


# ==============================================================================
# SCHEMAS
# ==============================================================================

class CompleteAppointmentRequest(BaseModel):
    send_feedback: bool = True
    schedule_followup: bool = True
    completed_by: Optional[str] = "Clinic Staff"


class FeedbackSubmitRequest(BaseModel):
    clinic_id: int
    appointment_id: int
    patient_id: int
    rating: int
    rating_label: Optional[str] = None
    comments: Optional[str] = None


class ScheduleFollowUpRequest(BaseModel):
    clinic_id: int
    appointment_id: int
    patient_id: int
    doctor_id: Optional[int] = None
    followup_date: str  # YYYY-MM-DD
    instruction_text: Optional[str] = None
    followup_type: str = "RETURN_VISIT"


class MarkDocumentReadyRequest(BaseModel):
    clinic_id: int
    document_type: str  # "PRESCRIPTION" or "LAB_REPORT"
    document_id: int


# ==============================================================================
# APPOINTMENT COMPLETION & FEEDBACK ENDPOINTS
# ==============================================================================

@router.post("/api/appointments/{appointment_id}/complete")
def complete_appointment_endpoint(
    appointment_id: int,
    payload: CompleteAppointmentRequest = CompleteAppointmentRequest(),
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """
    Clinic Staff Endpoint: Explicitly marks an appointment as Completed in the ERP.
    Initiates configured post-appointment communications (feedback request & follow-up schedule).
    Appointments are NEVER completed simply because time has passed.
    """
    try:
        result = post_appointment_service.complete_appointment(
            db=db,
            appointment_id=appointment_id,
            completed_by=payload.completed_by or getattr(current_user, "username", "Staff"),
            send_feedback=payload.send_feedback,
            schedule_followup_reminder=payload.schedule_followup,
        )
        return {"status": "success", "result": result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error completing appointment #{appointment_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal error completing appointment.")


@router.post("/api/appointments/{appointment_id}/feedback-request")
def trigger_feedback_request_endpoint(
    appointment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """Manually triggers a WhatsApp feedback request for a completed appointment."""
    appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail=f"Appointment #{appointment_id} not found.")

    if appt.status != "COMPLETED":
        raise HTTPException(status_code=400, detail="Feedback requests can only be sent for completed appointments.")

    res = post_appointment_service.send_feedback_request(db, appt)
    if not res:
        return {"status": "skipped", "message": "Feedback disabled or already sent/submitted."}
    return {"status": "success", "message": "Feedback request dispatched via WhatsApp."}


@router.post("/api/feedback")
def submit_feedback_endpoint(
    payload: FeedbackSubmitRequest,
    db: Session = Depends(get_db),
):
    """Stores patient rating and comments against the clinic and appointment."""
    fb = post_appointment_service.record_feedback(
        db=db,
        clinic_id=payload.clinic_id,
        appointment_id=payload.appointment_id,
        patient_id=payload.patient_id,
        rating=payload.rating,
        rating_label=payload.rating_label,
        comments=payload.comments,
    )
    return {"status": "success", "feedback_id": fb.id, "rating": fb.rating}


@router.get("/api/clinics/{clinic_id}/feedback")
def list_clinic_feedback_endpoint(
    clinic_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """Lists feedback entries and summary metrics for a specific clinic."""
    entries = db.query(PatientFeedback).filter(PatientFeedback.clinic_id == clinic_id).all()
    avg_rating = round(sum(f.rating for f in entries) / len(entries), 1) if entries else 0.0

    return {
        "clinic_id": clinic_id,
        "total_reviews": len(entries),
        "average_rating": avg_rating,
        "feedbacks": [
            {
                "id": f.id,
                "appointment_id": f.appointment_id,
                "patient_name": f.patient.name if f.patient else "Anonymous",
                "rating": f.rating,
                "rating_label": f.rating_label,
                "comments": f.comments,
                "created_at": f.created_at.strftime("%Y-%m-%d %H:%M") if f.created_at else "",
            }
            for f in entries
        ],
    }


# ==============================================================================
# FOLLOW-UP REMINDER ENDPOINTS
# ==============================================================================

@router.post("/api/followups/schedule")
def schedule_followup_endpoint(
    payload: ScheduleFollowUpRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """Schedules a clinic-approved follow-up appointment or reminder."""
    schedule = post_appointment_service.schedule_followup(
        db=db,
        clinic_id=payload.clinic_id,
        appointment_id=payload.appointment_id,
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        followup_date=payload.followup_date,
        instruction_text=payload.instruction_text,
        followup_type=payload.followup_type,
    )
    return {"status": "success", "schedule_id": schedule.id, "followup_date": schedule.followup_date}


@router.post("/api/followups/process")
def process_followups_endpoint(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD target date (defaults to today)"),
    db: Session = Depends(get_db),
):
    """Processes and dispatches due clinic-approved follow-up reminders."""
    dispatched = post_appointment_service.process_due_followups(db, target_date=target_date)
    return {"status": "success", "processed_count": len(dispatched), "dispatched": dispatched}


# ==============================================================================
# PRESCRIPTION & LAB REPORT READY NOTIFICATION & SECURE PORTAL
# ==============================================================================

@router.post("/api/documents/mark-ready")
def mark_document_ready_endpoint(
    payload: MarkDocumentReadyRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """
    Staff endpoint: Marks a prescription or lab report ready and notifies the patient on WhatsApp.
    Attaches a secure expiring link if document access is enabled, or instructs in-person collection.
    """
    base_url = str(request.base_url).rstrip("/")
    try:
        res = post_appointment_service.notify_document_ready(
            db=db,
            document_type=payload.document_type,
            document_id=payload.document_id,
            clinic_id=payload.clinic_id,
            staff_user=getattr(current_user, "username", "Staff"),
            base_url=base_url,
        )
        return {"status": "success", "result": res}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error marking document ready: {e}")
        raise HTTPException(status_code=500, detail="Internal error dispatching document notification.")


@router.get("/portal/documents/{token}")
def secure_document_access_portal(
    token: str,
    patient_id: Optional[int] = Query(None, description="Optional patient ID verification"),
    db: Session = Depends(get_db),
):
    """
    Publicly accessible but securely gated endpoint for patient medical document access.
    Validates token existence, expiration, revocation, and patient authorization.
    """
    result = post_appointment_service.verify_and_access_document(
        db=db,
        token=token,
        requesting_patient_id=patient_id,
    )
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=result.get("code", 400), detail=result.get("detail", "Error accessing document."))
    return result


# ==============================================================================
# PAYMENT RECEIPT ENDPOINT
# ==============================================================================

@router.post("/api/payments/{payment_id}/receipt")
def send_payment_receipt_endpoint(
    payment_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """
    Sends an official payment receipt via WhatsApp for verified payments.
    Strictly rejects generating receipts for pending or failed payments.
    """
    base_url = str(request.base_url).rstrip("/")
    try:
        res = post_appointment_service.send_payment_receipt(db, payment_id, base_url=base_url)
        return {"status": "success", "result": res}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error sending payment receipt for #{payment_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal error generating payment receipt.")
