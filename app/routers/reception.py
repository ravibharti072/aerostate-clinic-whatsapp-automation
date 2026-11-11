"""Receptionist Handover REST Endpoints (Phase 6).

Enables clinic staff and administrators to manage receptionist handover requests,
update statuses, and check reception availability.
"""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Clinic, ReceptionHandoverRequest
from app.services.reception import reception_service, VALID_HANDOVER_STATUSES

logger = logging.getLogger("aerostate_reception_router")

router = APIRouter(prefix="/api/reception", tags=["Reception & Handover"])


class HandoverCreateSchema(BaseModel):
    clinic_id: int
    phone: str
    patient_name: Optional[str] = "Valued Patient"
    reason: Optional[str] = "Talk to Receptionist"
    patient_query: Optional[str] = None
    priority: Optional[str] = "Normal"


class HandoverStatusUpdateSchema(BaseModel):
    status: str
    assigned_to: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    resolution_notes: Optional[str] = None


@router.get("/requests")
def list_handover_requests(
    clinic_id: Optional[int] = Query(None, description="Filter by clinic ID"),
    status: Optional[str] = Query(None, description="Filter by status (Open, Assigned, In Progress, Resolved, Closed)"),
    phone: Optional[str] = Query(None, description="Filter by patient phone"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Lists receptionist handover requests with filters."""
    requests = reception_service.list_handover_requests(
        db, clinic_id=clinic_id, status=status, phone=phone, limit=limit
    )
    return [
        {
            "id": r.id,
            "clinic_id": r.clinic_id,
            "patient_id": r.patient_id,
            "phone": r.phone,
            "patient_name": r.patient_name,
            "status": r.status,
            "priority": r.priority,
            "reason": r.reason,
            "patient_query": r.patient_query,
            "assigned_to": r.assigned_to,
            "assigned_to_user_id": r.assigned_to_user_id,
            "resolution_notes": r.resolution_notes,
            "is_outside_working_hours": r.is_outside_working_hours,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        }
        for r in requests
    ]


@router.get("/requests/{request_id}")
def get_handover_request(request_id: int, db: Session = Depends(get_db)):
    """Retrieves a single handover ticket."""
    req = db.query(ReceptionHandoverRequest).filter(ReceptionHandoverRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Handover request not found")
    return {
        "id": req.id,
        "clinic_id": req.clinic_id,
        "patient_id": req.patient_id,
        "phone": req.phone,
        "patient_name": req.patient_name,
        "status": req.status,
        "priority": req.priority,
        "reason": req.reason,
        "patient_query": req.patient_query,
        "conversation_context": req.conversation_context,
        "assigned_to": req.assigned_to,
        "assigned_to_user_id": req.assigned_to_user_id,
        "resolution_notes": req.resolution_notes,
        "is_outside_working_hours": req.is_outside_working_hours,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
        "resolved_at": req.resolved_at.isoformat() if req.resolved_at else None,
    }


@router.post("/requests")
def create_handover_request(payload: HandoverCreateSchema, db: Session = Depends(get_db)):
    """Manually creates a receptionist handover request."""
    clinic = db.query(Clinic).filter(Clinic.id == payload.clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    is_open = reception_service.is_reception_open(clinic)
    req = reception_service.create_handover_request(
        db=db,
        clinic_id=payload.clinic_id,
        phone=payload.phone,
        patient_name=payload.patient_name,
        reason=payload.reason,
        patient_query=payload.patient_query,
        is_outside_hours=not is_open,
        priority=payload.priority or "Normal",
    )
    return {
        "message": "Handover request created successfully",
        "request_id": req.id,
        "status": req.status,
        "is_outside_working_hours": req.is_outside_working_hours,
    }


@router.patch("/requests/{request_id}")
def update_handover_status(
    request_id: int, payload: HandoverStatusUpdateSchema, db: Session = Depends(get_db)
):
    """Updates status and assignment of a handover ticket."""
    try:
        updated = reception_service.update_handover_status(
            db=db,
            request_id=request_id,
            status=payload.status,
            assigned_to=payload.assigned_to,
            assigned_to_user_id=payload.assigned_to_user_id,
            resolution_notes=payload.resolution_notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not updated:
        raise HTTPException(status_code=404, detail="Handover request not found")

    return {
        "message": f"Handover ticket #{request_id} updated to {updated.status}",
        "status": updated.status,
        "assigned_to": updated.assigned_to,
        "resolved_at": updated.resolved_at.isoformat() if updated.resolved_at else None,
    }


@router.get("/availability/{clinic_id}")
def check_reception_availability(clinic_id: int, db: Session = Depends(get_db)):
    """Checks whether the clinic's reception is currently open."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    is_open = reception_service.is_reception_open(clinic)
    sample_msg = reception_service.build_reception_message(clinic, is_open, "Valued Patient")
    return {
        "clinic_id": clinic.id,
        "clinic_name": clinic.name,
        "timezone": clinic.timezone or "Asia/Kolkata",
        "is_reception_open": is_open,
        "working_days": clinic.reception_days,
        "start_time": clinic.reception_start_time,
        "end_time": clinic.reception_end_time,
        "reception_phone": clinic.reception_phone,
        "expected_response_message": sample_msg,
    }
