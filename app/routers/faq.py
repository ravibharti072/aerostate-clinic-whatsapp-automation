"""Clinic FAQ Management REST Endpoints (Phase 6).

Provides full CRUD operations for clinic-specific FAQs, bulk seeding of
standard clinic questions, and querying against the FAQ matching engine.
"""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Clinic, ClinicFAQ
from app.services.faq import faq_service

logger = logging.getLogger("aerostate_faq_router")

router = APIRouter(prefix="/api/faq", tags=["Clinic FAQ"])


class FAQCreateSchema(BaseModel):
    category: Optional[str] = "General"
    question: str
    answer: str
    keywords: Optional[str] = None
    priority: Optional[int] = 0
    is_active: Optional[bool] = True


class FAQUpdateSchema(BaseModel):
    category: Optional[str] = None
    question: Optional[str] = None
    answer: Optional[str] = None
    keywords: Optional[str] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class FAQQuerySchema(BaseModel):
    query: str


@router.get("/{clinic_id}")
def get_clinic_faqs(
    clinic_id: int,
    category: Optional[str] = Query(None, description="Filter by category"),
    active_only: bool = Query(False, description="Filter only active FAQs"),
    db: Session = Depends(get_db),
):
    """Retrieves all FAQs configured for a clinic."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    faqs = faq_service.list_faqs(db, clinic_id=clinic_id, category=category, active_only=active_only)
    return [
        {
            "id": f.id,
            "clinic_id": f.clinic_id,
            "category": f.category,
            "question": f.question,
            "keywords": f.keywords,
            "answer": f.answer,
            "priority": f.priority,
            "is_active": f.is_active,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
        }
        for f in faqs
    ]


@router.post("/{clinic_id}")
def create_clinic_faq(
    clinic_id: int, payload: FAQCreateSchema, db: Session = Depends(get_db)
):
    """Creates a new clinic-specific FAQ entry."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    faq = faq_service.create_faq(
        db=db,
        clinic_id=clinic_id,
        question=payload.question,
        answer=payload.answer,
        category=payload.category or "General",
        keywords=payload.keywords,
        priority=payload.priority or 0,
        is_active=payload.is_active if payload.is_active is not None else True,
    )
    return {
        "message": "FAQ created successfully",
        "faq_id": faq.id,
        "question": faq.question,
        "is_active": faq.is_active,
    }


@router.put("/item/{faq_id}")
def update_clinic_faq(
    faq_id: int, payload: FAQUpdateSchema, db: Session = Depends(get_db)
):
    """Updates an existing FAQ entry."""
    updated = faq_service.update_faq(
        db,
        faq_id=faq_id,
        category=payload.category,
        question=payload.question,
        answer=payload.answer,
        keywords=payload.keywords,
        priority=payload.priority,
        is_active=payload.is_active,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="FAQ not found")
    return {
        "message": "FAQ updated successfully",
        "faq_id": updated.id,
        "question": updated.question,
        "is_active": updated.is_active,
    }


@router.patch("/item/{faq_id}/status")
def toggle_faq_status(
    faq_id: int, is_active: bool = Query(...), db: Session = Depends(get_db)
):
    """Activates or deactivates an FAQ entry."""
    updated = faq_service.update_faq(db, faq_id=faq_id, is_active=is_active)
    if not updated:
        raise HTTPException(status_code=404, detail="FAQ not found")
    return {
        "message": f"FAQ #{faq_id} {'activated' if is_active else 'deactivated'}",
        "is_active": updated.is_active,
    }


@router.delete("/item/{faq_id}")
def delete_clinic_faq(faq_id: int, db: Session = Depends(get_db)):
    """Deletes an FAQ entry."""
    success = faq_service.delete_faq(db, faq_id=faq_id)
    if not success:
        raise HTTPException(status_code=404, detail="FAQ not found")
    return {"message": f"FAQ #{faq_id} deleted successfully"}


@router.post("/{clinic_id}/seed-defaults")
def seed_default_clinic_faqs(clinic_id: int, db: Session = Depends(get_db)):
    """Seeds standard baseline FAQs for the clinic based on its active configuration."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    faqs = faq_service.seed_default_faqs(db, clinic_id)
    return {
        "message": f"Seeded {len(faqs)} standard FAQs for {clinic.name}",
        "count": len(faqs),
        "clinic_id": clinic_id,
    }


@router.post("/{clinic_id}/query")
def test_faq_query(
    clinic_id: int, payload: FAQQuerySchema, db: Session = Depends(get_db)
):
    """Tests the FAQ answering engine against a sample patient question."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    res = faq_service.answer_query(db, clinic, payload.query)
    matched_faq_dict = None
    if res.get("matched_faq"):
        f = res["matched_faq"]
        matched_faq_dict = {
            "id": f.id,
            "category": f.category,
            "question": f.question,
        }

    return {
        "query": payload.query,
        "type": res["type"],
        "answer": res["answer"],
        "matched_faq": matched_faq_dict,
        "offer_handover": res["offer_handover"],
    }
