import json
import datetime
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
import app.models as models
from app.services.pdf_service import generate_diagnostic_receipt_pdf, generate_invoice_pdf, build_pdf_filename
from app.security import require_admin

router = APIRouter(prefix="/admin/laboratory", tags=["Laboratory & Diagnostic Management"], dependencies=[Depends(require_admin)])


class LabTestCreate(BaseModel):
    test_code: str
    name: str
    category: str = "Hematology"
    sample_type: str = "Blood"
    tat_hours: int = 24
    price: int = 500
    reference_range: Optional[str] = None
    units: Optional[str] = None
    description: Optional[str] = None


class LabTestUpdate(BaseModel):
    test_code: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    sample_type: Optional[str] = None
    tat_hours: Optional[int] = None
    price: Optional[int] = None
    reference_range: Optional[str] = None
    units: Optional[str] = None
    description: Optional[str] = None


class CategoryCreate(BaseModel):
    name: str


class CategoryDelete(BaseModel):
    category_name: str
    password: str
    reassign_to: Optional[str] = "General Diagnostics"


class SampleTypeCreate(BaseModel):
    name: str


class SampleTypeDelete(BaseModel):
    sample_type_name: str
    password: str
    reassign_to: Optional[str] = "EDTA Whole Blood"


class OrderItemRequest(BaseModel):
    test_id: int


class LabOrderCreate(BaseModel):
    patient_id: int
    doctor_id: Optional[int] = None
    encounter_id: Optional[int] = None
    priority: str = "ROUTINE"  # ROUTINE, URGENT, STAT
    clinical_indication: Optional[str] = None
    test_ids: List[int]
    collect_payment: bool = True
    payment_method: str = "Cash"  # Cash, UPI, Card, Net Banking
    payment_status: str = "PAID"  # PAID, PENDING
    amount_collected: Optional[float] = None
    cash_tendered: Optional[float] = None
    transaction_ref: Optional[str] = None
    received_by: Optional[str] = "Laboratory Cashier"


class LabPaymentCollectRequest(BaseModel):
    amount: Optional[float] = None  # If None, backend defaults to full balance due
    payment_method: str = "Cash"    # Cash, UPI, Card, Net Banking
    cash_tendered: Optional[float] = None
    transaction_ref: Optional[str] = None
    received_by: Optional[str] = "Laboratory Cashier"
    notes: Optional[str] = None


class SampleStatusUpdate(BaseModel):
    status: str  # SAMPLE_COLLECTED, RECEIVED, PROCESSING, REJECTED
    notes: Optional[str] = None
    collector_name: Optional[str] = "Phlebotomist"


class ResultItem(BaseModel):
    test_id: int
    result_value: str
    reference_range: Optional[str] = None
    units: Optional[str] = None
    flag: str = "NORMAL"  # NORMAL, HIGH, LOW, CRITICAL
    technician_notes: Optional[str] = None


class RecordResultsRequest(BaseModel):
    technician_name: str
    results: List[ResultItem]


class VerifyOrderRequest(BaseModel):
    verified_by: str
    notes: Optional[str] = None


def generate_lab_order_uid(db: Session) -> str:
    year = datetime.date.today().year
    highest = db.query(models.LabOrder).order_by(models.LabOrder.id.desc()).first()
    next_num = (highest.id + 1) if highest else 1
    while db.query(models.LabOrder).filter(models.LabOrder.order_uid == f"LAB-{year}-{next_num:04d}").first():
        next_num += 1
    return f"LAB-{year}-{next_num:04d}"


def normalize_phone(phone: str) -> str:
    """Normalize phone number to digits only, trimming leading country codes if appropriate."""
    cleaned = "".join(filter(str.isdigit, phone or ""))
    if cleaned.startswith("91") and len(cleaned) == 12:
        cleaned = cleaned[2:]
    return cleaned


def format_phone_display(phone: str) -> str:
    if not phone:
        return "Not Provided"
    digits = normalize_phone(phone)
    if len(digits) == 10:
        return f"+91 {digits[:5]} {digits[5:]}"
    if phone.startswith("+"):
        return phone
    return phone


def compute_laboratory_stats(db: Session) -> Dict[str, int]:
    """Computes master laboratory and pathology workflow metrics."""
    total_orders = db.query(models.LabOrder).count()

    # Exclude unfinalised consultation draft orders from active pending technician queue
    unfinalised_enc_subquery = (
        db.query(models.Consultation.id)
        .filter(models.Consultation.is_finalised == False)
        .scalar_subquery()
    )
    pending_processing = (
        db.query(models.LabOrder)
        .filter(
            models.LabOrder.status.in_(["ORDERED", "SAMPLE_COLLECTED", "PROCESSING"]),
            ~models.LabOrder.encounter_id.in_(unfinalised_enc_subquery)
        )
        .count()
    )
    completed_verified = db.query(models.LabOrder).filter(models.LabOrder.status == "COMPLETED").count()
    catalogue_tests = db.query(models.LabTest).filter(models.LabTest.is_active == True).count()

    return {
        "total_orders": total_orders,
        "pending_processing": pending_processing,
        "completed_verified": completed_verified,
        "catalogue_tests": catalogue_tests,
    }


# ========================================================
# STATS & CONFIGURATION ENDPOINTS
# ========================================================

@router.get("/stats")
def get_laboratory_stats(db: Session = Depends(get_db)):
    """Provides real-time laboratory queue and catalogue statistics."""
    return compute_laboratory_stats(db)


def verify_admin_security_pass(password: str, current_user: models.User) -> bool:
    clean_pass = (password or "").strip()
    if not clean_pass:
        return False
    from app.security import verify_password
    if current_user and current_user.password_hash:
        return verify_password(clean_pass, current_user.password_hash)
    return False


def seed_categories_if_empty(db: Session):
    try:
        existing_count = db.query(models.LabCategory).count()
        if existing_count == 0:
            default_categories = [
                "Hematology",
                "Biochemistry",
                "Microbiology",
                "Clinical Pathology",
                "Serology & Immunology",
                "Radiology & Imaging",
                "Urinalysis",
                "Molecular Biology",
                "Histopathology",
                "Cytology",
                "Endocrinology",
                "General Diagnostics",
            ]
            from sqlalchemy import distinct
            test_cats = [
                r[0].strip()
                for r in db.query(distinct(models.LabTest.category)).all()
                if r[0] and r[0].strip()
            ]
            all_cats = list(dict.fromkeys(default_categories + test_cats))
            for cat_name in all_cats:
                cat = models.LabCategory(name=cat_name, is_active=True)
                db.add(cat)
            db.commit()
    except Exception as e:
        db.rollback()


@router.get("/categories")
def list_lab_categories(db: Session = Depends(get_db)):
    """Returns all active diagnostic categories with precomputed test counts (Module 3)."""
    seed_categories_if_empty(db)
    categories = (
        db.query(models.LabCategory)
        .filter(models.LabCategory.is_active == True)
        .order_by(models.LabCategory.name.asc())
        .all()
    )
    result = []
    for c in categories:
        count = (
            db.query(models.LabTest)
            .filter(models.LabTest.category == c.name, models.LabTest.is_active == True)
            .count()
        )
        result.append({
            "id": c.id,
            "name": c.name,
            "test_count": count
        })
    return result


@router.post("/categories")
def create_lab_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    """Creates a new diagnostic category in the clinic database."""
    seed_categories_if_empty(db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty.")

    existing = db.query(models.LabCategory).filter(models.LabCategory.name.ilike(name)).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            db.commit()
            return {"message": f"Category '{existing.name}' restored successfully.", "id": existing.id, "name": existing.name}
        raise HTTPException(status_code=400, detail=f"Category '{existing.name}' already exists.")

    new_cat = models.LabCategory(name=name, is_active=True)
    db.add(new_cat)
    db.commit()
    db.refresh(new_cat)
    return {"message": f"Category '{new_cat.name}' created successfully.", "id": new_cat.id, "name": new_cat.name}


@router.post("/categories/delete")
def delete_lab_category(
    payload: CategoryDelete,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Securely deletes a diagnostic category after verifying administrative password.
    Performs full backend reassignment of linked tests and recalculates catalogue statistics.
    """
    seed_categories_if_empty(db)
    category_name = payload.category_name.strip()
    if not category_name:
        raise HTTPException(status_code=400, detail="Category name is required.")

    # 1. Password Verification (Backend-enforced security)
    if not verify_admin_security_pass(payload.password, current_user):
        raise HTTPException(
            status_code=403,
            detail="Incorrect administrative security password. Category deletion denied."
        )

    # 2. Find category
    cat = db.query(models.LabCategory).filter(models.LabCategory.name.ilike(category_name)).first()
    if not cat or not cat.is_active:
        raise HTTPException(status_code=404, detail=f"Category '{category_name}' not found.")

    reassign_target = (payload.reassign_to or "General Diagnostics").strip()

    # Ensure reassign target category exists in LabCategory
    target_cat = db.query(models.LabCategory).filter(models.LabCategory.name.ilike(reassign_target)).first()
    if not target_cat:
        target_cat = models.LabCategory(name=reassign_target, is_active=True)
        db.add(target_cat)
        db.flush()
    elif not target_cat.is_active:
        target_cat.is_active = True

    # 3. Reassign existing tests in backend database
    tests_to_reassign = (
        db.query(models.LabTest)
        .filter(models.LabTest.category.ilike(category_name))
        .all()
    )
    reassigned_count = len(tests_to_reassign)
    for t in tests_to_reassign:
        t.category = target_cat.name

    # 4. Soft-delete category
    cat.is_active = False
    db.commit()

    # 5. Calculate remaining active categories count
    remaining_count = (
        db.query(models.LabCategory)
        .filter(models.LabCategory.is_active == True)
        .count()
    )

    return {
        "message": f"Category '{cat.name}' deleted successfully. {reassigned_count} test(s) reassigned to '{target_cat.name}'.",
        "deleted_category": cat.name,
        "reassigned_count": reassigned_count,
        "reassign_to": target_cat.name,
        "remaining_categories_count": remaining_count,
    }


def seed_sample_types_if_empty(db: Session):
    try:
        models.Base.metadata.create_all(bind=db.get_bind())
        existing_count = db.query(models.LabSampleType).count()
        if existing_count == 0:
            default_samples = [
                "EDTA Whole Blood",
                "Serum",
                "Plasma",
                "Midstream Urine",
                "Urine (Random)",
                "Urine (24h)",
                "Stool",
                "Nasopharyngeal Swab",
                "Throat Swab",
                "Sputum",
                "Tissue / Biopsy",
                "Cerebrospinal Fluid (CSF)",
                "Synovial Fluid",
                "Pleural Fluid",
                "Imaging / Radiograph",
            ]
            from sqlalchemy import distinct
            test_samples = [
                r[0].strip()
                for r in db.query(distinct(models.LabTest.sample_type)).all()
                if r[0] and r[0].strip()
            ]
            all_samples = list(dict.fromkeys(default_samples + test_samples))
            for st_name in all_samples:
                st = models.LabSampleType(name=st_name, is_active=True)
                db.add(st)
            db.commit()
    except Exception:
        db.rollback()


@router.get("/sample-types")
def list_lab_sample_types(db: Session = Depends(get_db)):
    """Returns all active diagnostic sample types with precomputed test counts."""
    seed_sample_types_if_empty(db)
    sample_types = (
        db.query(models.LabSampleType)
        .filter(models.LabSampleType.is_active == True)
        .order_by(models.LabSampleType.name.asc())
        .all()
    )
    result = []
    for st in sample_types:
        count = (
            db.query(models.LabTest)
            .filter(models.LabTest.sample_type == st.name, models.LabTest.is_active == True)
            .count()
        )
        result.append({
            "id": st.id,
            "name": st.name,
            "test_count": count
        })
    return result


@router.post("/sample-types")
def create_lab_sample_type(payload: SampleTypeCreate, db: Session = Depends(get_db)):
    """Creates a new diagnostic specimen / sample type in the clinic database."""
    seed_sample_types_if_empty(db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Sample type name cannot be empty.")

    existing = db.query(models.LabSampleType).filter(models.LabSampleType.name.ilike(name)).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            db.commit()
            return {"message": f"Sample type '{existing.name}' restored successfully.", "id": existing.id, "name": existing.name}
        raise HTTPException(status_code=400, detail=f"Sample type '{existing.name}' already exists.")

    new_st = models.LabSampleType(name=name, is_active=True)
    db.add(new_st)
    db.commit()
    db.refresh(new_st)
    return {"message": f"Sample type '{new_st.name}' created successfully.", "id": new_st.id, "name": new_st.name}


@router.post("/sample-types/delete")
def delete_lab_sample_type(
    payload: SampleTypeDelete,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Securely deletes a diagnostic sample type after verifying administrative security password.
    Performs full backend reassignment of linked tests and returns updated counts.
    """
    seed_sample_types_if_empty(db)
    sample_type_name = payload.sample_type_name.strip()
    if not sample_type_name:
        raise HTTPException(status_code=400, detail="Sample type name is required.")

    # 1. Password Verification (Backend-enforced security)
    if not verify_admin_security_pass(payload.password, current_user):
        raise HTTPException(
            status_code=403,
            detail="Incorrect administrative security password. Sample type deletion denied."
        )

    # 2. Find sample type
    st = db.query(models.LabSampleType).filter(models.LabSampleType.name.ilike(sample_type_name)).first()
    if not st or not st.is_active:
        raise HTTPException(status_code=404, detail=f"Sample type '{sample_type_name}' not found.")

    reassign_target = (payload.reassign_to or "EDTA Whole Blood").strip()

    # Ensure reassign target exists in LabSampleType
    target_st = db.query(models.LabSampleType).filter(models.LabSampleType.name.ilike(reassign_target)).first()
    if not target_st:
        target_st = models.LabSampleType(name=reassign_target, is_active=True)
        db.add(target_st)
        db.flush()
    elif not target_st.is_active:
        target_st.is_active = True

    # 3. Reassign existing tests in backend database
    tests_to_reassign = (
        db.query(models.LabTest)
        .filter(models.LabTest.sample_type.ilike(sample_type_name))
        .all()
    )
    reassigned_count = len(tests_to_reassign)
    for t in tests_to_reassign:
        t.sample_type = target_st.name

    # 4. Soft-delete sample type
    st.is_active = False
    db.commit()

    # 5. Calculate remaining active sample types count
    remaining_count = (
        db.query(models.LabSampleType)
        .filter(models.LabSampleType.is_active == True)
        .count()
    )

    return {
        "message": f"Sample type '{st.name}' deleted successfully. {reassigned_count} test(s) reassigned to '{target_st.name}'.",
        "deleted_sample_type": st.name,
        "reassigned_count": reassigned_count,
        "reassign_to": target_st.name,
        "remaining_sample_types_count": remaining_count,
    }


@router.get("/options")
def get_laboratory_options(db: Session = Depends(get_db)):
    """Provides standard categories, sample types, and turnaround presets merged with clinic-created options."""
    seed_categories_if_empty(db)
    seed_sample_types_if_empty(db)
    active_cats = [
        c.name
        for c in db.query(models.LabCategory)
        .filter(models.LabCategory.is_active == True)
        .order_by(models.LabCategory.name.asc())
        .all()
    ]

    active_samples = [
        s.name
        for s in db.query(models.LabSampleType)
        .filter(models.LabSampleType.is_active == True)
        .order_by(models.LabSampleType.name.asc())
        .all()
    ]

    return {
        "categories": active_cats,
        "sample_types": active_samples,
        "priorities": ["ROUTINE", "URGENT", "STAT"],
        "statuses": ["ORDERED", "SAMPLE_COLLECTED", "PROCESSING", "COMPLETED"],
    }


# ----------------------------------------------------
# 1. Test Catalogue
# ----------------------------------------------------

@router.get("/tests")
def list_lab_tests(
    category: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.LabTest).filter(models.LabTest.is_active == True)
    if category:
        query = query.filter(models.LabTest.category == category)
    if search:
        f = f"%{search.strip()}%"
        query = query.filter((models.LabTest.name.ilike(f)) | (models.LabTest.test_code.ilike(f)))

    tests = query.order_by(models.LabTest.category.asc(), models.LabTest.name.asc()).all()
    return [
        {
            "id": t.id,
            "test_code": t.test_code,
            "name": t.name,
            "category": t.category,
            "sample_type": t.sample_type,
            "tat_hours": t.tat_hours,
            "price": t.price,
            "reference_range": t.reference_range,
            "units": t.units,
            "description": t.description,
        }
        for t in tests
    ]


@router.post("/tests")
def add_lab_test(payload: LabTestCreate, db: Session = Depends(get_db)):
    code = payload.test_code.strip().upper()
    existing = db.query(models.LabTest).filter(models.LabTest.test_code == code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Test code {code} already exists.")

    test = models.LabTest(
        test_code=code,
        name=payload.name.strip(),
        category=payload.category,
        sample_type=payload.sample_type,
        tat_hours=payload.tat_hours,
        price=payload.price,
        reference_range=payload.reference_range,
        units=payload.units,
        description=payload.description,
    )
    db.add(test)
    db.commit()
    db.refresh(test)
    return {"message": "Laboratory test added to catalogue", "id": test.id}


@router.put("/tests/{test_id}")
def update_lab_test(test_id: int, payload: LabTestUpdate, db: Session = Depends(get_db)):
    test = db.query(models.LabTest).filter(models.LabTest.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Laboratory test not found.")

    if payload.test_code:
        code = payload.test_code.strip().upper()
        existing = (
            db.query(models.LabTest)
            .filter(models.LabTest.test_code == code, models.LabTest.id != test_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail=f"Test code {code} is already in use by another test.")
        test.test_code = code

    if payload.name is not None:
        test.name = payload.name.strip()
    if payload.category is not None:
        test.category = payload.category.strip()
    if payload.sample_type is not None:
        test.sample_type = payload.sample_type.strip()
    if payload.tat_hours is not None:
        test.tat_hours = payload.tat_hours
    if payload.price is not None:
        test.price = payload.price
    if payload.reference_range is not None:
        test.reference_range = payload.reference_range.strip() if payload.reference_range else None
    if payload.units is not None:
        test.units = payload.units.strip() if payload.units else None
    if payload.description is not None:
        test.description = payload.description.strip() if payload.description else None

    db.commit()
    db.refresh(test)
    return {"message": "Laboratory test updated successfully", "id": test.id}


@router.delete("/tests/{test_id}")
def delete_lab_test(test_id: int, db: Session = Depends(get_db)):
    test = db.query(models.LabTest).filter(models.LabTest.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Laboratory test not found.")

    # Soft delete so historical lab orders and audit trails remain valid
    test.is_active = False
    db.commit()
    return {"message": "Laboratory test removed from catalogue", "id": test_id}


# ----------------------------------------------------
# 2. Lab Orders & Technician Work Queue
# ----------------------------------------------------

@router.get("/orders")
def list_lab_orders(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Returns technician work queue with SQL-level filtering and precomputed metrics."""
    query = db.query(models.LabOrder).join(models.Patient).outerjoin(models.Doctor)

    if status and status.strip():
        query = query.filter(models.LabOrder.status == status.strip().upper())
    if priority and priority.strip():
        query = query.filter(models.LabOrder.priority == priority.strip().upper())

    if search and search.strip():
        search_filter = f"%{search.strip()}%"
        query = query.filter(
            (models.LabOrder.order_uid.ilike(search_filter))
            | (models.Patient.name.ilike(search_filter))
            | (models.Patient.phone.ilike(search_filter))
            | (models.Patient.patient_uid.ilike(search_filter))
            | (models.Doctor.name.ilike(search_filter))
            | (models.LabOrder.clinical_indication.ilike(search_filter))
        )

    orders = query.order_by(models.LabOrder.created_at.desc()).all()
    results = []

    for o in orders:
        # Resolve consultation encounter finalization status
        is_enc_finalised = True
        encounter_uid = None
        if o.encounter_id:
            enc_rec = db.query(models.Consultation).filter(models.Consultation.id == o.encounter_id).first()
            if enc_rec:
                encounter_uid = enc_rec.encounter_uid
                if not enc_rec.is_finalised:
                    is_enc_finalised = False

        # If technician is filtering specifically for ORDERED or PENDING, omit draft unfinalized consultation orders
        if status and status.strip().upper() in ["ORDERED", "PENDING"]:
            if not is_enc_finalised:
                continue

        tests_list = json.loads(o.tests or "[]")
        test_names = [t.get("name") for t in tests_list if isinstance(t, dict) and t.get("name")]
        tests_summary = (
            f"{len(tests_list)} test{'s' if len(tests_list) != 1 else ''}"
            + (f" • {', '.join(test_names)}" if test_names else "")
        )

        # Check linked invoice & payment collection status (100% backend resolved)
        inv_data = None
        if getattr(o, "invoice_id", None):
            inv = db.query(models.Invoice).filter(models.Invoice.id == o.invoice_id).first()
        else:
            inv = db.query(models.Invoice).filter(
                models.Invoice.patient_id == o.patient_id,
                models.Invoice.notes.ilike(f"%{o.order_uid}%")
            ).order_by(models.Invoice.id.desc()).first()

        if inv:
            inv_data = {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "total": inv.total or 0,
                "amount_paid": inv.amount_paid or 0,
                "balance_due": inv.balance_due or 0,
                "payment_status": inv.payment_status or "PENDING",
                "payment_method": inv.payment_method or "Cash",
            }

        results.append({
            "id": o.id,
            "order_uid": o.order_uid,
            "patient_id": o.patient_id,
            "patient_uid": o.patient.patient_uid if o.patient else None,
            "patient_name": o.patient.name if o.patient else "Valued Patient",
            "patient_phone": o.patient.phone if o.patient else "-",
            "patient_phone_display": format_phone_display(o.patient.phone if o.patient else ""),
            "doctor_name": o.doctor.name if o.doctor else "Hospital Clinician",
            "priority": o.priority,
            "status": o.status if is_enc_finalised else "DRAFT_CONSULTATION",
            "raw_status": o.status,
            "tests_count": len(tests_list),
            "tests": tests_list,
            "tests_summary": tests_summary,
            "total_price": o.total_price,
            "formatted_price": f"₹{o.total_price:,.0f}",
            "clinical_indication": o.clinical_indication,
            "encounter_id": o.encounter_id,
            "encounter_uid": encounter_uid,
            "is_finalised": is_enc_finalised,
            "is_actionable": is_enc_finalised,
            "invoice": inv_data,
            "created_at": o.created_at.strftime("%d %b %Y, %I:%M %p") if o.created_at else "-",
        })

    # Summary metrics for executive KPI grid
    stats_data = compute_laboratory_stats(db)

    return {
        "total": len(results),
        "pending_count": stats_data["pending_processing"],
        "completed_count": stats_data["completed_verified"],
        "stats": stats_data,
        "orders": results,
    }


@router.post("/orders")
def create_lab_order(payload: LabOrderCreate, db: Session = Depends(get_db)):
    """Places a laboratory order and computes itemized charges."""
    patient = db.query(models.Patient).filter(models.Patient.id == payload.patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Ensure Prescribing Doctor is linked
    doctor_id = payload.doctor_id
    if not doctor_id and payload.encounter_id:
        enc = db.query(models.Consultation).filter(models.Consultation.id == payload.encounter_id).first()
        if enc and enc.doctor_id:
            doctor_id = enc.doctor_id
    if not doctor_id:
        first_doc = db.query(models.Doctor).first()
        if first_doc:
            doctor_id = first_doc.id

    # Ensure Clinical Indication / Doctor's Diagnosis is set
    indication = (payload.clinical_indication or "").strip()
    if not indication and payload.encounter_id:
        enc = db.query(models.Consultation).filter(models.Consultation.id == payload.encounter_id).first()
        if enc and enc.diagnosis:
            indication = enc.diagnosis
    if not indication:
        indication = "Provisional Clinical Evaluation"

    selected_tests = db.query(models.LabTest).filter(models.LabTest.id.in_(payload.test_ids)).all()
    if not selected_tests:
        raise HTTPException(status_code=400, detail="Please select at least one test from the catalogue.")

    tests_data = []
    total_price = 0
    for t in selected_tests:
        tests_data.append({
            "test_id": t.id,
            "test_code": t.test_code,
            "name": t.name,
            "category": t.category,
            "sample_type": t.sample_type,
            "price": t.price,
            "reference_range": t.reference_range,
            "units": t.units,
        })
        total_price += t.price

    existing_order = None
    if payload.encounter_id:
        existing_order = (
            db.query(models.LabOrder)
            .filter(
                models.LabOrder.encounter_id == payload.encounter_id,
                models.LabOrder.status == "ORDERED",
            )
            .order_by(models.LabOrder.id.desc())
            .first()
        )

    if existing_order:
        # Update existing order with new selected tests and indication in-place (do not spawn duplicate records)
        existing_order.doctor_id = doctor_id
        existing_order.priority = payload.priority.upper()
        existing_order.clinical_indication = indication
        existing_order.tests = json.dumps(tests_data)
        existing_order.total_price = total_price
        db.commit()
        db.refresh(existing_order)
        order = existing_order

        # Replace pending lab results for this order
        db.query(models.LabResult).filter(models.LabResult.order_id == order.id).delete()
        for t in selected_tests:
            res = models.LabResult(
                order_id=order.id,
                test_id=t.id,
                result_value="Pending Analysis",
                reference_range=t.reference_range,
                units=t.units,
                flag="NORMAL",
                sample_status="PENDING_COLLECTION",
                created_at=datetime.datetime.utcnow(),
            )
            db.add(res)
        db.commit()
    else:
        order_uid = generate_lab_order_uid(db)
        order = models.LabOrder(
            order_uid=order_uid,
            patient_id=patient.id,
            doctor_id=doctor_id,
            encounter_id=payload.encounter_id,
            priority=payload.priority.upper(),
            clinical_indication=indication,
            status="ORDERED",
            tests=json.dumps(tests_data),
            total_price=total_price,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        # Automatically create pending LabResult placeholders for each test
        for t in selected_tests:
            res = models.LabResult(
                order_id=order.id,
                test_id=t.id,
                result_value="Pending Analysis",
                reference_range=t.reference_range,
                units=t.units,
                flag="NORMAL",
                sample_status="PENDING_COLLECTION",
                created_at=datetime.datetime.utcnow(),
            )
            db.add(res)
        db.commit()

    # 100% Backend calculation of Invoice, Balance Due, and Ledger Payments
    created_inv_id = None
    created_inv_num = None
    amount_to_pay = 0.0
    balance_due = float(total_price)
    final_status = "PENDING"
    change_return = 0.0

    if payload.collect_payment:
        year = datetime.date.today().year
        invoice_items = [
            {
                "name": t.name,
                "category": "Laboratory",
                "unit_price": t.price,
                "quantity": 1,
                "total": t.price,
            }
            for t in selected_tests
        ]

        highest = db.query(models.Invoice).order_by(models.Invoice.id.desc()).first()
        next_num = (highest.id + 1) if highest else 1
        while db.query(models.Invoice).filter(models.Invoice.invoice_number == f"INV-{year}-{next_num:04d}").first():
            next_num += 1
        created_inv_num = f"INV-{year}-{next_num:04d}"

        is_paid = (payload.payment_status or "PAID").upper() == "PAID"
        amount_to_pay = (
            float(payload.amount_collected)
            if (payload.amount_collected is not None and payload.amount_collected >= 0)
            else (float(total_price) if is_paid else 0.0)
        )
        balance_due = max(0.0, float(total_price) - amount_to_pay)
        final_status = "PAID" if balance_due == 0 and amount_to_pay > 0 else "PARTIALLY_PAID" if amount_to_pay > 0 else "PENDING"

        if payload.payment_method == "Cash" and payload.cash_tendered is not None:
            change_return = max(0.0, float(payload.cash_tendered) - amount_to_pay)

        inv = models.Invoice(
            invoice_number=created_inv_num,
            patient_id=patient.id,
            items=json.dumps(invoice_items),
            subtotal=total_price,
            total=total_price,
            amount_paid=amount_to_pay,
            balance_due=balance_due,
            payment_method=payload.payment_method or "Cash",
            payment_status=final_status,
            notes=f"Diagnostic Order {order.order_uid}",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)
        created_inv_id = inv.id
        order.invoice_id = inv.id

        if amount_to_pay > 0:
            highest_pay = db.query(models.Payment).order_by(models.Payment.id.desc()).first()
            pay_next = (highest_pay.id + 1) if highest_pay else 1
            while db.query(models.Payment).filter(models.Payment.payment_uid == f"PAY-{year}-{pay_next:04d}").first():
                pay_next += 1
            pay_uid = f"PAY-{year}-{pay_next:04d}"
            payment_record = models.Payment(
                payment_uid=pay_uid,
                invoice_id=inv.id,
                amount=amount_to_pay,
                payment_method=payload.payment_method or "Cash",
                transaction_ref=payload.transaction_ref or "",
                received_by=payload.received_by or "Laboratory Cashier",
                notes=f"Payment collected for {order.order_uid}",
                created_at=datetime.datetime.utcnow(),
            )
            db.add(payment_record)
            db.commit()
        db.commit()

    return {
        "message": f"Laboratory order generated successfully ({'Payment Collected' if amount_to_pay > 0 else 'Payment Pending'}).",
        "order_id": order.id,
        "order_uid": order.order_uid,
        "total_price": order.total_price,
        "invoice_id": created_inv_id,
        "invoice_number": created_inv_num,
        "amount_paid": amount_to_pay,
        "balance_due": balance_due,
        "payment_status": final_status,
        "payment_method": payload.payment_method or "Cash",
        "change_return": change_return,
    }


@router.post("/orders/{order_id}/collect-payment")
def collect_lab_order_payment(order_id: int, payload: LabPaymentCollectRequest, db: Session = Depends(get_db)):
    """Backend-calculated payment collection against a laboratory order with ledger and change calculation."""
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    patient = order.patient
    total_price = float(order.total_price or 0)

    # 1. Resolve or create invoice
    inv = None
    if getattr(order, "invoice_id", None):
        inv = db.query(models.Invoice).filter(models.Invoice.id == order.invoice_id).first()
    if not inv:
        inv = db.query(models.Invoice).filter(
            models.Invoice.patient_id == order.patient_id,
            models.Invoice.notes.ilike(f"%{order.order_uid}%")
        ).order_by(models.Invoice.id.desc()).first()

    year = datetime.date.today().year

    if not inv:
        try:
            tests_list = json.loads(order.tests or "[]")
        except Exception:
            tests_list = []
        invoice_items = [
            {
                "name": t.get("name", "Lab Test"),
                "category": "Laboratory",
                "unit_price": t.get("price", 0),
                "quantity": 1,
                "total": t.get("price", 0),
            }
            for t in tests_list
        ]
        highest = db.query(models.Invoice).order_by(models.Invoice.id.desc()).first()
        next_num = (highest.id + 1) if highest else 1
        while db.query(models.Invoice).filter(models.Invoice.invoice_number == f"INV-{year}-{next_num:04d}").first():
            next_num += 1
        created_inv_num = f"INV-{year}-{next_num:04d}"

        inv = models.Invoice(
            invoice_number=created_inv_num,
            patient_id=order.patient_id,
            items=json.dumps(invoice_items),
            subtotal=total_price,
            total=total_price,
            amount_paid=0.0,
            balance_due=total_price,
            payment_method=payload.payment_method or "Cash",
            payment_status="PENDING",
            notes=f"Diagnostic Order {order.order_uid}",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)
        order.invoice_id = inv.id

    # 2. 100% backend calculation of payment and balance
    current_balance = float(inv.balance_due if inv.balance_due is not None else (inv.total - (inv.amount_paid or 0)))
    amount_to_collect = (
        float(payload.amount)
        if (payload.amount is not None and payload.amount > 0)
        else current_balance
    )

    if amount_to_collect <= 0:
        raise HTTPException(status_code=400, detail="Invoice balance is already settled or payment amount is zero.")

    new_amount_paid = float(inv.amount_paid or 0) + amount_to_collect
    new_balance = max(0.0, float(inv.total) - new_amount_paid)
    inv.amount_paid = new_amount_paid
    inv.balance_due = new_balance
    inv.payment_status = "PAID" if new_balance == 0 else "PARTIALLY_PAID"
    inv.payment_method = payload.payment_method or "Cash"

    # 3. Create payment record
    highest_pay = db.query(models.Payment).order_by(models.Payment.id.desc()).first()
    pay_next = (highest_pay.id + 1) if highest_pay else 1
    while db.query(models.Payment).filter(models.Payment.payment_uid == f"PAY-{year}-{pay_next:04d}").first():
        pay_next += 1
    pay_uid = f"PAY-{year}-{pay_next:04d}"

    payment_record = models.Payment(
        payment_uid=pay_uid,
        invoice_id=inv.id,
        amount=amount_to_collect,
        payment_method=payload.payment_method or "Cash",
        transaction_ref=payload.transaction_ref or "",
        received_by=payload.received_by or "Laboratory Cashier",
        notes=payload.notes or f"Laboratory payment collected for {order.order_uid}",
        created_at=datetime.datetime.utcnow(),
    )
    db.add(payment_record)
    db.commit()
    db.refresh(inv)

    change_return = 0.0
    if payload.payment_method == "Cash" and payload.cash_tendered is not None:
        change_return = max(0.0, float(payload.cash_tendered) - amount_to_collect)

    return {
        "message": f"Payment of ₹{amount_to_collect:,.0f} successfully collected for {order.order_uid}.",
        "order_id": order.id,
        "order_uid": order.order_uid,
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "total": inv.total,
        "amount_paid": inv.amount_paid,
        "balance_due": inv.balance_due,
        "payment_status": inv.payment_status,
        "payment_method": inv.payment_method,
        "change_return": change_return,
    }


class LabPaymentResetRequest(BaseModel):
    reason: str
    reset_by: Optional[str] = "Laboratory Staff"


@router.post("/orders/{order_id}/reset-payment")
def reset_lab_order_payment(
    order_id: int,
    payload: LabPaymentResetRequest,
    db: Session = Depends(get_db)
):
    """Reset payment for a lab order with mandatory justification reason."""
    reason_clean = (payload.reason or "").strip()
    if not reason_clean:
        raise HTTPException(
            status_code=400,
            detail="A mandatory audit reason / justification is required to reset payment to unpaid."
        )

    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    inv = None
    if getattr(order, "invoice_id", None):
        inv = db.query(models.Invoice).filter(models.Invoice.id == order.invoice_id).first()
    if not inv:
        inv = db.query(models.Invoice).filter(
            models.Invoice.patient_id == order.patient_id,
            models.Invoice.notes.ilike(f"%{order.order_uid}%")
        ).order_by(models.Invoice.id.desc()).first()

    now_str = datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")
    audit_entry = f"[REVERSED TO UNPAID on {now_str} by {payload.reset_by or 'Staff'}: {reason_clean}]"

    if inv:
        db.query(models.Payment).filter(models.Payment.invoice_id == inv.id).delete()
        inv.amount_paid = 0.0
        inv.balance_due = inv.total
        inv.payment_status = "PENDING"
        inv.notes = f"{inv.notes or ''} {audit_entry}".strip()
        db.commit()
        db.refresh(inv)

    return {
        "success": True,
        "message": f"Payment successfully reversed to Unpaid for {order.order_uid}.",
        "reason": reason_clean,
        "order_id": order.id,
        "order_uid": order.order_uid,
        "balance_due": inv.total if inv else float(order.total_price or 0),
        "payment_status": "PENDING"
    }


@router.get("/orders/{order_id}/receipt/pdf")
def get_lab_order_receipt_pdf(
    order_id: int,
    download: bool = False,
    db: Session = Depends(get_db)
):
    """Generate and return an official Diagnostic Receipt PDF directly from backend database."""
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    inv = None
    if getattr(order, "invoice_id", None):
        inv = db.query(models.Invoice).filter(models.Invoice.id == order.invoice_id).first()
    if not inv:
        inv = db.query(models.Invoice).filter(
            models.Invoice.patient_id == order.patient_id,
            models.Invoice.notes.ilike(f"%{order.order_uid}%")
        ).order_by(models.Invoice.id.desc()).first()

    pdf_bytes = generate_diagnostic_receipt_pdf(order, inv)

    patient = order.patient
    patient_name = patient.name if patient else "Patient"
    doc_num = inv.invoice_number if inv else order.order_uid
    filename = build_pdf_filename(patient_name, "Lab", doc_num)
    disposition = "attachment" if download else "inline"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )


@router.get("/invoices/{invoice_id}/pdf")
def get_invoice_pdf_lab(
    invoice_id: int,
    download: bool = False,
    db: Session = Depends(get_db)
):
    """Generate and return an official Invoice / Receipt PDF directly from backend database."""
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    patient = inv.patient
    order = db.query(models.LabOrder).filter(models.LabOrder.invoice_id == inv.id).first()
    if order:
        pdf_bytes = generate_diagnostic_receipt_pdf(order, inv)
    else:
        pdf_bytes = generate_invoice_pdf(inv, patient)

    patient_name = patient.name if patient else "Patient"
    filename = build_pdf_filename(patient_name, "Lab", inv.invoice_number)
    disposition = "attachment" if download else "inline"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )


@router.get("/orders/{order_id}")
def get_lab_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    is_enc_finalised = True
    encounter_uid = None
    if order.encounter_id:
        enc_rec = db.query(models.Consultation).filter(models.Consultation.id == order.encounter_id).first()
        if enc_rec:
            encounter_uid = enc_rec.encounter_uid
            if not enc_rec.is_finalised:
                is_enc_finalised = False

    results = db.query(models.LabResult).filter(models.LabResult.order_id == order.id).all()
    results_list = [
        {
            "id": r.id,
            "test_id": r.test_id,
            "test_name": r.test.name if r.test else "Diagnostic Test",
            "test_code": r.test.test_code if r.test else "-",
            "category": r.test.category if r.test else "-",
            "sample_type": r.test.sample_type if r.test else "-",
            "result_value": r.result_value,
            "reference_range": r.reference_range,
            "units": r.units,
            "flag": r.flag,
            "sample_status": r.sample_status,
            "technician_notes": r.technician_notes,
            "verified_by": r.verified_by,
            "verified_at": r.verified_at.strftime("%d %b %Y, %I:%M %p") if r.verified_at else None,
        }
        for r in results
    ]

    return {
        "id": order.id,
        "order_uid": order.order_uid,
        "patient": {
            "id": order.patient.id,
            "name": order.patient.name,
            "phone": order.patient.phone,
            "gender": order.patient.gender or "Unspecified",
            "age": order.patient.age or "-",
        },
        "doctor_name": order.doctor.name if order.doctor else "Referring Clinician",
        "priority": order.priority,
        "status": order.status if is_enc_finalised else "DRAFT_CONSULTATION",
        "raw_status": order.status,
        "encounter_id": order.encounter_id,
        "encounter_uid": encounter_uid,
        "is_finalised": is_enc_finalised,
        "is_actionable": is_enc_finalised,
        "clinical_indication": order.clinical_indication,
        "total_price": order.total_price,
        "created_at": order.created_at.strftime("%d %b %Y, %I:%M %p") if order.created_at else "-",
        "results": results_list,
    }


@router.put("/orders/{order_id}/sample")
def update_sample_status(order_id: int, payload: SampleStatusUpdate, db: Session = Depends(get_db)):
    """Technician updates sample collection status."""
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    # Guard: Cannot collect samples for an unfinalized consultation
    if order.encounter_id:
        enc = db.query(models.Consultation).filter(models.Consultation.id == order.encounter_id).first()
        if enc and not enc.is_finalised:
            raise HTTPException(
                status_code=400,
                detail=f"Order belongs to consultation {enc.encounter_uid or enc.id} which is still in draft. Doctor must 'Finalize & Sign' the consultation before specimen collection or processing can begin."
            )

    order.status = payload.status.upper()
    # Update specimen state on all results
    results = db.query(models.LabResult).filter(models.LabResult.order_id == order.id).all()
    for r in results:
        r.sample_status = payload.status.upper()
        if payload.notes:
            r.technician_notes = payload.notes
    db.commit()

    return {"message": f"Sample status updated to {order.status}", "order_id": order.id}


@router.post("/orders/{order_id}/results")
def record_test_results(order_id: int, payload: RecordResultsRequest, db: Session = Depends(get_db)):
    """Records lab test measurements, units, and flags."""
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    # Guard: Cannot record results for an unfinalized consultation
    if order.encounter_id:
        enc = db.query(models.Consultation).filter(models.Consultation.id == order.encounter_id).first()
        if enc and not enc.is_finalised:
            raise HTTPException(
                status_code=400,
                detail=f"Order belongs to consultation {enc.encounter_uid or enc.id} which is still in draft. Doctor must 'Finalize & Sign' the consultation before test results can be recorded."
            )

    for item in payload.results:
        res = (
            db.query(models.LabResult)
            .filter(models.LabResult.order_id == order.id, models.LabResult.test_id == item.test_id)
            .first()
        )
        if res:
            res.result_value = item.result_value
            if item.reference_range:
                res.reference_range = item.reference_range
            if item.units:
                res.units = item.units
            res.flag = item.flag.upper()
            res.technician_notes = item.technician_notes
            res.sample_status = "PROCESSING"

    order.status = "PROCESSING"
    db.commit()
    return {"message": "Laboratory test results recorded successfully"}


@router.post("/orders/{order_id}/verify")
def verify_and_approve_results(order_id: int, payload: VerifyOrderRequest, db: Session = Depends(get_db)):
    """Authorized pathologist or clinician signs off lab report."""
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Laboratory order not found")

    # Guard: Cannot verify results for an unfinalized consultation
    if order.encounter_id:
        enc = db.query(models.Consultation).filter(models.Consultation.id == order.encounter_id).first()
        if enc and not enc.is_finalised:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot verify results for consultation {enc.encounter_uid or enc.id} which is still in draft. Doctor must 'Finalize & Sign' the consultation first."
            )

    now = datetime.datetime.utcnow()
    results = db.query(models.LabResult).filter(models.LabResult.order_id == order.id).all()
    for r in results:
        r.verified_by = payload.verified_by
        r.verified_at = now
        r.sample_status = "COMPLETED"

    order.status = "COMPLETED"
    db.commit()

    return {
        "message": f"Laboratory Order {order.order_uid} verified and published by {payload.verified_by}",
        "order_id": order.id,
        "status": order.status,
    }
