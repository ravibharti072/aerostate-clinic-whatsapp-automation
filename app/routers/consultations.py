import json
import re
import datetime
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.security import require_admin
import app.models as models

router = APIRouter(prefix="/admin/consultations", tags=["Doctor Consultation & Clinical Notes"], dependencies=[Depends(require_admin)])


class VitalsModel(BaseModel):
    bp: Optional[str] = None
    pulse: Optional[int] = None
    temp: Optional[float] = None
    resp_rate: Optional[int] = None
    spo2: Optional[int] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    bmi: Optional[float] = None


class VitalsCalcRequest(BaseModel):
    height: Optional[float] = None
    weight: Optional[float] = None


class LabTestCreateRequest(BaseModel):
    name: str
    category: Optional[str] = "General Diagnostic"
    price: Optional[int] = 500


class ConsultationCreate(BaseModel):
    patient_id: int
    doctor_id: int
    appointment_id: Optional[int] = None
    visit_type: str = "General Consultation"
    chief_complaint: Optional[str] = None
    hpi: Optional[str] = None
    vitals: Optional[Dict[str, Any]] = None
    clinical_examination: Optional[str] = None
    diagnosis: str = "Pending Clinical Evaluation"
    treatment_plan: Optional[str] = None
    lab_tests: Optional[str] = None
    advice: Optional[str] = None
    follow_up_date: Optional[str] = None
    follow_up_instructions: Optional[str] = None


class ConsultationUpdate(BaseModel):
    chief_complaint: Optional[str] = None
    hpi: Optional[str] = None
    vitals: Optional[Dict[str, Any]] = None
    clinical_examination: Optional[str] = None
    diagnosis: Optional[str] = None
    differential_diagnosis: Optional[str] = None
    treatment_plan: Optional[str] = None
    lab_tests: Optional[str] = None
    advice: Optional[str] = None
    follow_up_date: Optional[str] = None
    follow_up_instructions: Optional[str] = None


class FinalizeRequest(BaseModel):
    doctor_name: str
    notes: Optional[str] = None


def generate_encounter_uid(db: Session) -> str:
    year = datetime.date.today().year
    highest = db.query(models.Consultation).order_by(models.Consultation.id.desc()).first()
    next_num = (highest.id + 1) if highest else 1
    while db.query(models.Consultation).filter(models.Consultation.encounter_uid == f"ENC-{year}-{next_num:04d}").first():
        next_num += 1
    return f"ENC-{year}-{next_num:04d}"


def calculate_bmi_and_category(height: Any, weight: Any):
    """Calculates BMI and clinical category based on height (cm) and weight (kg)."""
    try:
        h = float(height)
        w = float(weight)
        if h > 0 and w > 0:
            hm = h / 100.0
            bmi = round(w / (hm * hm), 1)
            if bmi < 18.5:
                cat = "Underweight"
            elif bmi < 25.0:
                cat = "Normal"
            elif bmi < 30.0:
                cat = "Overweight"
            else:
                cat = "Obese"
            return bmi, cat
    except Exception:
        pass
    return None, None


def compute_consultation_stats(db: Session) -> Dict[str, int]:
    """Computes real-time clinical encounter KPIs directly in the database."""
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    in_consultation = db.query(models.Consultation).filter(models.Consultation.status == "IN_CONSULTATION").count()
    completed_today = (
        db.query(models.Consultation)
        .filter(models.Consultation.status == "COMPLETED", models.Consultation.consultation_date == today_str)
        .count()
    )
    total_consultations = db.query(models.Consultation).count()
    active_specialists = db.query(models.Doctor).filter(models.Doctor.is_active == True).count()

    return {
        "in_consultation": in_consultation,
        "completed_today": completed_today,
        "total_consultations": total_consultations,
        "active_specialists": active_specialists,
    }


# ========================================================
# STATS & OPTIONS ENDPOINTS (Must precede /{encounter_id})
# ========================================================

@router.get("/stats")
def get_consultation_stats(db: Session = Depends(get_db)):
    """Provides consultation KPIs for executive stat cards."""
    return compute_consultation_stats(db)


@router.get("/options")
def get_consultation_options(db: Session = Depends(get_db)):
    """Provides visit types, default vitals, and standard clinical categories fetched dynamically from DB."""
    db_tests = db.query(models.LabTest).filter(models.LabTest.is_active == True).order_by(models.LabTest.id).all()
    test_names = [t.name for t in db_tests]

    return {
        "visit_types": [
            "General Consultation",
            "Follow-up Visit",
            "Emergency Triage",
            "Post-Operative Review",
            "Routine Health Checkup",
            "Specialist Referral Evaluation",
        ],
        "statuses": ["IN_CONSULTATION", "COMPLETED", "CANCELLED"],
        "lab_tests": test_names,
        "default_vitals": [
            {"id": "bp", "label": "BP (mmHg)", "unit": "mmHg", "type": "text", "placeholder": "e.g. 120/80"},
            {"id": "pulse", "label": "Pulse (bpm)", "unit": "bpm", "type": "number", "placeholder": "e.g. 76"},
            {"id": "temp", "label": "Temp (°F)", "unit": "°F", "type": "number", "step": "0.1", "placeholder": "e.g. 98.4"},
            {"id": "spo2", "label": "SpO2 (%)", "unit": "%", "type": "number", "placeholder": "e.g. 99"},
            {"id": "resp_rate", "label": "Resp (/min)", "unit": "/min", "type": "number", "placeholder": "e.g. 18"},
            {"id": "height", "label": "Height (cm)", "unit": "cm", "type": "number", "placeholder": "e.g. 172"},
            {"id": "weight", "label": "Weight (kg)", "unit": "kg", "type": "number", "placeholder": "e.g. 70"},
        ],
        "preset_vitals": [
            {"id": "blood_sugar", "label": "Blood Sugar (GRBS)", "unit": "mg/dL", "type": "number", "placeholder": "110"},
            {"id": "pain_score", "label": "Pain Score (1-10)", "unit": "score", "type": "number", "placeholder": "0"},
            {"id": "waist_circ", "label": "Waist Circ (cm)", "unit": "cm", "type": "number", "placeholder": "85"},
            {"id": "head_circ", "label": "Head Circ (cm)", "unit": "cm", "type": "number", "placeholder": "54"},
            {"id": "hba1c", "label": "HbA1c (%)", "unit": "%", "type": "number", "placeholder": "5.6"},
            {"id": "hemoglobin", "label": "Hemoglobin (g/dL)", "unit": "g/dL", "type": "number", "placeholder": "14.2"},
        ],
    }


@router.post("/lab-tests")
def add_consultation_lab_test(payload: LabTestCreateRequest, db: Session = Depends(get_db)):
    """Allows doctor to dynamically create a new quick diagnostic test option stored in backend DB."""
    name_clean = payload.name.strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Test name cannot be empty")

    existing = db.query(models.LabTest).filter(models.LabTest.name.ilike(name_clean)).first()
    if existing:
        tests = db.query(models.LabTest).filter(models.LabTest.is_active == True).order_by(models.LabTest.id).all()
        return {
            "message": f"Test '{existing.name}' is already in catalogue",
            "test": {"id": existing.id, "name": existing.name},
            "all_tests": [t.name for t in tests],
        }

    # Generate clean unique test code
    clean_code = re.sub(r'[^A-Z0-9]', '', name_clean.upper())[:8] or "TEST"
    suffix = 1
    code = clean_code
    while db.query(models.LabTest).filter(models.LabTest.test_code == code).first():
        code = f"{clean_code[:6]}{suffix}"
        suffix += 1

    new_test = models.LabTest(
        test_code=code,
        name=name_clean,
        category=payload.category or "General Diagnostic",
        sample_type="Blood",
        price=payload.price or 500,
        is_active=True,
    )
    db.add(new_test)
    db.commit()
    db.refresh(new_test)

    tests = db.query(models.LabTest).filter(models.LabTest.is_active == True).order_by(models.LabTest.id).all()
    return {
        "message": f"Diagnostic test '{name_clean}' added successfully",
        "test": {"id": new_test.id, "name": new_test.name},
        "all_tests": [t.name for t in tests],
    }


@router.post("/calculate-vitals")
def calculate_consultation_vitals(payload: VitalsCalcRequest):
    """Calculates BMI and category on the backend server."""
    bmi, cat = calculate_bmi_and_category(payload.height, payload.weight)
    return {
        "bmi": bmi,
        "bmi_category": cat or "Normal",
    }


# ========================================================
# CONSULTATION ENCOUNTERS LIST & DETAILS
# ========================================================

@router.get("")
def list_consultations(
    search: Optional[str] = None,
    doctor_id: Optional[int] = None,
    status: Optional[str] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Retrieves consultation encounters with SQL-level text search, doctor and status filtering,
    and attached KPI metrics.
    """
    query = db.query(models.Consultation).join(models.Patient).outerjoin(models.Doctor)

    if search and search.strip():
        search_filter = f"%{search.strip()}%"
        query = query.filter(
            (models.Consultation.encounter_uid.ilike(search_filter))
            | (models.Consultation.diagnosis.ilike(search_filter))
            | (models.Consultation.visit_type.ilike(search_filter))
            | (models.Patient.name.ilike(search_filter))
            | (models.Patient.phone.ilike(search_filter))
            | (models.Patient.patient_uid.ilike(search_filter))
            | (models.Doctor.name.ilike(search_filter))
        )

    if doctor_id:
        query = query.filter(models.Consultation.doctor_id == doctor_id)
    if status and status.strip():
        query = query.filter(models.Consultation.status == status.strip().upper())
    if date and date.strip():
        query = query.filter(models.Consultation.consultation_date == date.strip())

    encounters = query.order_by(models.Consultation.created_at.desc()).all()
    results = []

    for enc in encounters:
        # Format patient phone display
        raw_phone = enc.patient.phone if enc.patient else "-"
        phone_digits = "".join(filter(str.isdigit, raw_phone or ""))
        if phone_digits.startswith("91") and len(phone_digits) == 12:
            phone_digits = phone_digits[2:]
        phone_display = f"+91 {phone_digits[:5]} {phone_digits[5:]}" if len(phone_digits) == 10 else raw_phone

        # Parse vitals summary
        try:
            v_dict = json.loads(enc.vitals or "{}")
        except Exception:
            v_dict = {}

        results.append({
            "id": enc.id,
            "encounter_uid": enc.encounter_uid,
            "patient_id": enc.patient_id,
            "patient_uid": enc.patient.patient_uid if enc.patient else None,
            "patient_name": enc.patient.name if enc.patient else "Valued Patient",
            "patient_phone": raw_phone,
            "patient_phone_display": phone_display,
            "patient_gender": enc.patient.gender if enc.patient else "Unspecified",
            "patient_age": enc.patient.age if enc.patient else None,
            "doctor_id": enc.doctor_id,
            "doctor_name": enc.doctor.name if enc.doctor else "Specialist",
            "specialization": enc.doctor.specialization if enc.doctor else "General OPD",
            "consultation_date": enc.consultation_date,
            "visit_type": enc.visit_type,
            "status": enc.status,
            "diagnosis": enc.diagnosis or "Pending Evaluation",
            "lab_tests": enc.lab_tests,
            "advice": enc.advice,
            "vitals": v_dict,
            "is_finalised": enc.is_finalised,
            "signed_by": enc.signed_by,
            "created_at": enc.created_at.strftime("%d %b %Y, %I:%M %p") if enc.created_at else "-",
        })

    return {
        "total": len(results),
        "stats": compute_consultation_stats(db),
        "consultations": results,
    }


@router.get("/{encounter_id}")
def get_consultation(encounter_id: int, db: Session = Depends(get_db)):
    enc = db.query(models.Consultation).filter(models.Consultation.id == encounter_id).first()
    if not enc:
        raise HTTPException(status_code=404, detail="Consultation encounter not found")

    patient = enc.patient
    raw_phone = patient.phone if patient else "-"
    phone_digits = "".join(filter(str.isdigit, raw_phone or ""))
    if phone_digits.startswith("91") and len(phone_digits) == 12:
        phone_digits = phone_digits[2:]
    phone_display = f"+91 {phone_digits[:5]} {phone_digits[5:]}" if len(phone_digits) == 10 else raw_phone

    try:
        allergies = json.loads(patient.allergies or "[]")
    except Exception:
        allergies = []
    try:
        chronic = json.loads(patient.chronic_conditions or "[]")
    except Exception:
        chronic = []

    try:
        v_dict = json.loads(enc.vitals or "{}")
    except Exception:
        v_dict = {}

    if "bmi" not in v_dict or not v_dict.get("bmi"):
        h = v_dict.get("height")
        w = v_dict.get("weight")
        bmi_val, bmi_cat = calculate_bmi_and_category(h, w)
        if bmi_val is not None:
            v_dict["bmi"] = bmi_val
            v_dict["bmi_category"] = bmi_cat

    # Get linked prescription if any
    linked_rx = (
        db.query(models.Prescription)
        .filter(models.Prescription.encounter_id == enc.id)
        .order_by(models.Prescription.created_at.desc())
        .first()
    )
    # Get linked lab orders if any
    linked_labs = (
        db.query(models.LabOrder)
        .filter(models.LabOrder.encounter_id == enc.id)
        .all()
    )
    # Get linked invoice if any
    linked_inv = (
        db.query(models.Invoice)
        .filter(
            (models.Invoice.encounter_id == enc.id)
            | ((models.Invoice.appointment_id == enc.appointment_id) if enc.appointment_id else False)
        )
        .first()
    )

    return {
        "id": enc.id,
        "encounter_uid": enc.encounter_uid,
        "patient": {
            "id": patient.id,
            "uid": patient.patient_uid or f"PAT-{patient.id:04d}",
            "name": patient.name,
            "phone": patient.phone,
            "phone_display": phone_display,
            "gender": patient.gender or "Unspecified",
            "age": patient.age or "-",
            "blood_group": patient.blood_group or "-",
            "allergies": allergies,
            "chronic_conditions": chronic,
        },
        "doctor": {
            "id": enc.doctor.id if enc.doctor else None,
            "name": enc.doctor.name if enc.doctor else "Doctor",
            "specialization": enc.doctor.specialization if enc.doctor else "-",
        },
        "appointment_id": enc.appointment_id,
        "consultation_date": enc.consultation_date,
        "visit_type": enc.visit_type,
        "status": enc.status,
        "chief_complaint": enc.chief_complaint,
        "hpi": enc.hpi,
        "vitals": v_dict,
        "clinical_examination": enc.clinical_examination,
        "diagnosis": enc.diagnosis,
        "differential_diagnosis": enc.differential_diagnosis,
        "treatment_plan": enc.treatment_plan,
        "lab_tests": enc.lab_tests,
        "advice": enc.advice,
        "follow_up_date": enc.follow_up_date,
        "follow_up_instructions": enc.follow_up_instructions,
        "is_finalised": enc.is_finalised,
        "signed_by": enc.signed_by,
        "signed_at": enc.signed_at.strftime("%d %b %Y, %I:%M %p") if enc.signed_at else None,
        "created_at": enc.created_at.strftime("%d %b %Y, %I:%M %p") if enc.created_at else "-",
        "linked_prescription": {
            "id": linked_rx.id,
            "prescription_uid": linked_rx.prescription_uid or f"#RX-{linked_rx.id}",
            "diagnosis": linked_rx.diagnosis,
            "medicines": json.loads(linked_rx.medicines or "[]"),
            "advice": linked_rx.advice,
            "created_at": linked_rx.created_at.strftime("%d %b %Y, %I:%M %p") if linked_rx.created_at else "-",
        } if linked_rx else None,
        "linked_lab_orders": [
            {
                "id": lo.id,
                "order_uid": lo.order_uid,
                "tests": json.loads(lo.tests or "[]"),
                "status": lo.status,
                "total_price": lo.total_price,
            }
            for lo in linked_labs
        ],
        "linked_invoice": {
            "id": linked_inv.id,
            "invoice_number": linked_inv.invoice_number,
            "total": linked_inv.total,
            "payment_status": linked_inv.payment_status,
            "payment_method": linked_inv.payment_method,
        } if linked_inv else None,
    }


@router.post("")
def start_consultation(payload: ConsultationCreate, db: Session = Depends(get_db)):
    """Starts or records a doctor consultation encounter, syncing appointment & queue status."""
    patient = db.query(models.Patient).filter(models.Patient.id == payload.patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    doctor = db.query(models.Doctor).filter(models.Doctor.id == payload.doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # Deduplication & Resume Check: If consultation already exists for this appointment, resume it
    if payload.appointment_id:
        existing = (
            db.query(models.Consultation)
            .filter(
                models.Consultation.appointment_id == payload.appointment_id,
                models.Consultation.status != "CANCELLED",
            )
            .first()
        )
        if existing:
            if existing.status != "COMPLETED":
                existing.status = "IN_CONSULTATION"
            appt = db.query(models.Appointment).filter(models.Appointment.id == payload.appointment_id).first()
            if appt and appt.status != "COMPLETED":
                appt.status = "IN_CONSULTATION"
            q_entry = db.query(models.QueueEntry).filter(models.QueueEntry.appointment_id == payload.appointment_id).first()
            if q_entry and q_entry.status != "COMPLETED":
                q_entry.status = "IN_CONSULTATION"
            db.commit()
            return {
                "message": f"Resumed active consultation encounter {existing.encounter_uid}",
                "encounter_id": existing.id,
                "encounter_uid": existing.encounter_uid,
                "status": existing.status,
                "stats": compute_consultation_stats(db),
            }

    encounter_uid = generate_encounter_uid(db)
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    # Calculate BMI and Category automatically if height and weight are provided
    vitals_dict = payload.vitals or {}
    h = vitals_dict.get("height")
    w = vitals_dict.get("weight")
    bmi_val, bmi_cat = calculate_bmi_and_category(h, w)
    if bmi_val is not None:
        vitals_dict["bmi"] = bmi_val
        vitals_dict["bmi_category"] = bmi_cat

    enc = models.Consultation(
        encounter_uid=encounter_uid,
        patient_id=patient.id,
        doctor_id=doctor.id,
        appointment_id=payload.appointment_id,
        consultation_date=today_str,
        status="IN_CONSULTATION",
        visit_type=payload.visit_type,
        chief_complaint=payload.chief_complaint,
        hpi=payload.hpi,
        vitals=json.dumps(vitals_dict),
        clinical_examination=payload.clinical_examination,
        diagnosis=payload.diagnosis,
        treatment_plan=payload.treatment_plan,
        lab_tests=payload.lab_tests,
        advice=payload.advice,
        follow_up_date=payload.follow_up_date,
        follow_up_instructions=payload.follow_up_instructions,
        is_finalised=False,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(enc)

    # Sync Appointment Status to IN_CONSULTATION
    if payload.appointment_id:
        appt = db.query(models.Appointment).filter(models.Appointment.id == payload.appointment_id).first()
        if appt:
            appt.status = "IN_CONSULTATION"
            # Sync QueueEntry to IN_CONSULTATION
            q_entry = db.query(models.QueueEntry).filter(models.QueueEntry.appointment_id == appt.id).first()
            if q_entry:
                q_entry.status = "IN_CONSULTATION"

    db.commit()
    db.refresh(enc)

    return {
        "message": f"Consultation encounter {enc.encounter_uid} started for {patient.name} with Dr. {doctor.name}",
        "encounter_id": enc.id,
        "encounter_uid": enc.encounter_uid,
        "status": enc.status,
        "stats": compute_consultation_stats(db),
    }


@router.put("/{encounter_id}")
def update_consultation_draft(encounter_id: int, payload: ConsultationUpdate, db: Session = Depends(get_db)):
    """Saves ongoing consultation notes & clinical observations (prevents modification if already signed)."""
    enc = db.query(models.Consultation).filter(models.Consultation.id == encounter_id).first()
    if not enc:
        raise HTTPException(status_code=404, detail="Consultation encounter not found")
    if enc.is_finalised:
        raise HTTPException(status_code=400, detail="Signed consultation encounter is locked and cannot be silently modified.")

    update_dict = payload.dict(exclude_unset=True)
    for field, val in update_dict.items():
        if field == "vitals" and val is not None:
            # Recalculate BMI and category on server
            h = val.get("height")
            w = val.get("weight")
            bmi_val, bmi_cat = calculate_bmi_and_category(h, w)
            if bmi_val is not None:
                val["bmi"] = bmi_val
                val["bmi_category"] = bmi_cat
            enc.vitals = json.dumps(val)
        elif val is not None:
            setattr(enc, field, val)

    db.commit()
    db.refresh(enc)
    return {
        "message": "Consultation draft updated successfully",
        "id": enc.id,
        "stats": compute_consultation_stats(db),
    }


@router.post("/{encounter_id}/finalize")
def finalize_and_sign_consultation(encounter_id: int, payload: FinalizeRequest, db: Session = Depends(get_db)):
    """Signs off clinical consultation, locks the encounter, and updates appointment & queue status to COMPLETED."""
    enc = db.query(models.Consultation).filter(models.Consultation.id == encounter_id).first()
    if not enc:
        raise HTTPException(status_code=404, detail="Consultation encounter not found")

    enc.is_finalised = True
    enc.status = "COMPLETED"
    enc.signed_by = payload.doctor_name
    enc.signed_at = datetime.datetime.utcnow()

    # Sync Appointment
    if enc.appointment_id:
        appt = db.query(models.Appointment).filter(models.Appointment.id == enc.appointment_id).first()
        if appt:
            appt.status = "COMPLETED"
            q_entry = db.query(models.QueueEntry).filter(models.QueueEntry.appointment_id == appt.id).first()
            if q_entry:
                q_entry.status = "COMPLETED"

    db.commit()
    db.refresh(enc)

    return {
        "message": f"Consultation encounter {enc.encounter_uid} signed and finalised by {payload.doctor_name}",
        "encounter_id": enc.id,
        "is_finalised": True,
        "status": enc.status,
        "stats": compute_consultation_stats(db),
    }


@router.post("/{encounter_id}/cancel")
def cancel_consultation(encounter_id: int, db: Session = Depends(get_db)):
    """Cancels a consultation encounter and safely returns the patient to the active waiting queue."""
    enc = db.query(models.Consultation).filter(models.Consultation.id == encounter_id).first()
    if not enc:
        raise HTTPException(status_code=404, detail="Consultation encounter not found")

    if enc.is_finalised:
        raise HTTPException(status_code=400, detail="Cannot cancel a finalized and signed clinical consultation")

    enc.status = "CANCELLED"

    # Revert Appointment and QueueEntry if linked
    if enc.appointment_id:
        appt = db.query(models.Appointment).filter(models.Appointment.id == enc.appointment_id).first()
        if appt and appt.status != "COMPLETED":
            appt.status = "CONFIRMED"
        q_entry = db.query(models.QueueEntry).filter(models.QueueEntry.appointment_id == enc.appointment_id).first()
        if q_entry and q_entry.status != "COMPLETED":
            q_entry.status = "WAITING"

    db.commit()
    db.refresh(enc)

    return {
        "message": f"Consultation encounter {enc.encounter_uid} has been cancelled successfully. Patient returned to queue.",
        "encounter_id": enc.id,
        "status": "CANCELLED",
        "stats": compute_consultation_stats(db),
    }


@router.delete("/{encounter_id}")
def delete_consultation(encounter_id: int, db: Session = Depends(get_db)):
    """Deletes / cancels an unfinalized consultation encounter."""
    return cancel_consultation(encounter_id=encounter_id, db=db)

