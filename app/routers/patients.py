import json
import math
import datetime
from typing import List, Optional, Union, Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.database import get_db
from app.security import require_admin
import app.models as models

router = APIRouter(prefix="/admin/patients", tags=["Patient Registry & EMR"], dependencies=[Depends(require_admin)])


class AllergyItem(BaseModel):
    allergen: str
    severity: str = "Moderate"  # Mild, Moderate, Severe, High
    reaction: str = ""


class PatientCreate(BaseModel):
    name: str = Field(..., min_length=2, description="Patient Full Name")
    phone: str = Field(..., min_length=7, description="WhatsApp or contact phone number")
    gender: Optional[str] = "Unspecified"
    dob: Optional[str] = None
    age: Optional[Union[int, str]] = None
    blood_group: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = "Agra"
    state: Optional[str] = "Uttar Pradesh"
    emergency_name: Optional[str] = None
    emergency_phone: Optional[str] = None
    registration_source: Optional[str] = "Direct"  # WhatsApp, Direct
    allergies: Optional[Any] = None
    allergies_text: Optional[str] = None
    chronic_conditions: Optional[Any] = None
    chronic_conditions_text: Optional[str] = None
    medical_history: Optional[Any] = None
    clinical_alerts: Optional[Any] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None
    dob: Optional[str] = None
    age: Optional[Union[int, str]] = None
    blood_group: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    emergency_name: Optional[str] = None
    emergency_phone: Optional[str] = None
    registration_source: Optional[str] = None
    allergies: Optional[Any] = None
    chronic_conditions: Optional[Any] = None
    medical_history: Optional[Any] = None
    clinical_alerts: Optional[Any] = None


def generate_patient_uid(db: Session) -> str:
    year = datetime.date.today().year
    count = db.query(models.Patient).count() + 1
    return f"PAT-{year}-{count:04d}"


def normalize_phone(phone: str) -> str:
    """Normalize phone number to digits only, trimming leading country codes if appropriate."""
    cleaned = "".join(filter(str.isdigit, phone or ""))
    if cleaned.startswith("91") and len(cleaned) == 12:
        cleaned = cleaned[2:]
    return cleaned


def format_phone_display(phone: str) -> str:
    """Standardize phone representation for display."""
    if not phone:
        return "Not Provided"
    digits = normalize_phone(phone)
    if len(digits) == 10:
        return f"+91 {digits[:5]} {digits[5:]}"
    if phone.startswith("+"):
        return phone
    return phone


def compute_age_and_dob(dob_str: Optional[str], age_val: Optional[Union[int, str]]):
    """
    Syncs DOB and Age on the server.
    - If DOB is present, derives exact age in years today.
    - If age is present and no DOB, estimates approximate birth date.
    """
    today = datetime.date.today()
    final_dob = dob_str.strip() if dob_str and dob_str.strip() else None
    final_age: Optional[int] = None

    if final_dob:
        try:
            parts = [int(p) for p in final_dob.split("-")]
            if len(parts) == 3:
                dob_date = datetime.date(parts[0], parts[1], parts[2])
                computed_age = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))
                final_age = max(0, computed_age)
        except Exception:
            pass

    if final_age is None and age_val is not None and str(age_val).strip():
        try:
            clean_age = int(str(age_val).strip())
            if 0 <= clean_age <= 130:
                final_age = clean_age
                if not final_dob:
                    final_dob = f"{today.year - clean_age}-01-01"
        except Exception:
            pass

    return final_dob, final_age


def parse_allergies_data(allergies_input: Any, allergies_text: Optional[str]) -> List[dict]:
    """
    Parses any raw allergy input (comma string or structured list) into standard clinical dicts.
    """
    result: List[dict] = []
    seen = set()

    # If structured list provided
    if isinstance(allergies_input, list):
        for item in allergies_input:
            if isinstance(item, dict) and item.get("allergen"):
                name = str(item.get("allergen", "")).strip()
                if name and name.lower() not in seen:
                    seen.add(name.lower())
                    result.append({
                        "allergen": name.title(),
                        "severity": item.get("severity", "Moderate"),
                        "reaction": item.get("reaction", ""),
                    })
            elif isinstance(item, str) and item.strip():
                name = item.strip()
                if name.lower() not in seen:
                    seen.add(name.lower())
                    result.append({"allergen": name.title(), "severity": "Moderate", "reaction": ""})

    # If free text comma-delimited string provided
    raw_text = allergies_text or (allergies_input if isinstance(allergies_input, str) else "")
    if raw_text and isinstance(raw_text, str):
        for part in raw_text.replace(";", ",").replace("\n", ",").split(","):
            name = part.strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                result.append({"allergen": name.title(), "severity": "Moderate", "reaction": ""})

    return result


def parse_chronic_data(chronic_input: Any, chronic_text: Optional[str]) -> List[str]:
    """
    Parses chronic conditions from string or array into sanitized list.
    """
    conditions: List[str] = []
    seen = set()

    if isinstance(chronic_input, list):
        for item in chronic_input:
            if isinstance(item, str) and item.strip():
                name = item.strip()
                if name.lower() not in seen:
                    seen.add(name.lower())
                    conditions.append(name.title())

    raw_text = chronic_text or (chronic_input if isinstance(chronic_input, str) else "")
    if raw_text and isinstance(raw_text, str):
        for part in raw_text.replace(";", ",").replace("\n", ",").split(","):
            name = part.strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                conditions.append(name.title())

    return conditions


def format_gender_age_display(gender: Optional[str], age: Optional[int]) -> str:
    """Pre-formats readable clinical gender and age for master tables."""
    clean_gender = (gender or "").strip()
    is_gender_valid = clean_gender and clean_gender.lower() not in ["unspecified", "none", ""]
    has_age = age is not None and age >= 0

    if is_gender_valid and has_age:
        return f"{clean_gender}, {age} yrs"
    if is_gender_valid:
        return clean_gender
    if has_age:
        return f"{age} yrs"
    return "Unspecified"


def compute_patient_stats_internal(db: Session) -> Dict[str, int]:
    """Computes patient registration statistics directly in the database."""
    patients = db.query(models.Patient).all()
    total = len(patients)
    male = sum(1 for p in patients if (p.gender or "").strip().lower() == "male")
    female = sum(1 for p in patients if (p.gender or "").strip().lower() == "female")
    other = sum(1 for p in patients if (p.gender or "").strip().lower() in ["other", "transgender"])
    unspecified = total - male - female - other

    whatsapp_linked = sum(1 for p in patients if bool(p.phone and len(normalize_phone(p.phone)) >= 7))
    direct_count = sum(1 for p in patients if "whatsapp" not in (p.registration_source or "").lower())
    whatsapp_bookings = sum(1 for p in patients if "whatsapp" in (p.registration_source or "").lower())

    return {
        "total_patients": total,
        "male_patients": male,
        "female_patients": female,
        "other_patients": other + unspecified,
        "whatsapp_linked": whatsapp_linked,
        "direct_count": direct_count,
        "walk_in_count": direct_count,
        "whatsapp_booking_count": whatsapp_bookings,
    }


# ========================================================
# STATS & CONFIGURATION ENDPOINTS (Must precede /{patient_id})
# ========================================================

@router.get("/stats")
def get_patient_directory_stats(db: Session = Depends(get_db)):
    """Computes master patient counts, gender ratios, and WhatsApp contact link metrics."""
    return compute_patient_stats_internal(db)


@router.get("/registration-options")
def get_registration_options():
    """Provides standard dropdown options for patient entry (Strictly Direct & WhatsApp)."""
    return {
        "genders": ["Male", "Female", "Other", "Unspecified"],
        "blood_groups": ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
        "sources": ["Direct", "WhatsApp"],
        "common_allergies": ["Penicillin", "Sulfa Drugs", "Aspirin", "Ibuprofen", "Peanuts", "Dust / Pollen"],
        "common_conditions": ["Type 2 Diabetes", "Hypertension", "Asthma", "Thyroid Disorder", "Arthritis", "Cardiac History"],
    }


@router.get("/check-duplicate")
def check_duplicate_patient(phone: str, name: Optional[str] = None, db: Session = Depends(get_db)):
    """Checks for existing patient records by normalized phone and fuzzy name to prevent accidental duplicate registration."""
    norm_phone = normalize_phone(phone)
    all_pts = db.query(models.Patient).all()
    potential_matches = []

    for p in all_pts:
        p_norm = normalize_phone(p.phone)
        if norm_phone and norm_phone in p_norm or (p_norm and p_norm in norm_phone):
            potential_matches.append({
                "id": p.id,
                "patient_uid": p.patient_uid or f"PAT-{p.id:04d}",
                "name": p.name,
                "phone": format_phone_display(p.phone),
                "created_at": p.created_at.strftime("%d %b %Y") if p.created_at else "-",
                "match_reason": "Phone number matches existing registered account",
            })
        elif name and len(name.strip()) >= 3 and name.strip().lower() in (p.name or "").lower():
            potential_matches.append({
                "id": p.id,
                "patient_uid": p.patient_uid or f"PAT-{p.id:04d}",
                "name": p.name,
                "phone": format_phone_display(p.phone),
                "created_at": p.created_at.strftime("%d %b %Y") if p.created_at else "-",
                "match_reason": "Similar patient name in directory",
            })

    return {
        "has_potential_duplicates": len(potential_matches) > 0,
        "count": len(potential_matches),
        "matches": potential_matches[:5],
    }


# ========================================================
# PATIENT DIRECTORY & REGISTRATION ENDPOINTS
# ========================================================

@router.get("")
def list_patients(
    search: Optional[str] = None,
    gender: Optional[str] = None,
    source: Optional[str] = None,
    date: Optional[str] = None,
    page: Optional[int] = Query(None, ge=1),
    page_size: Optional[Union[int, str]] = None,
    db: Session = Depends(get_db),
):
    """
    Enhanced Patient Directory with full metadata, UIDs, visits, and precomputed stats.
    Supports server-side filtering, searching, stats computation, and pagination.
    """
    query = db.query(models.Patient)
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    if search and search.strip():
        search_filter = f"%{search.strip()}%"
        query = (
            query.outerjoin(models.Appointment)
            .outerjoin(models.Doctor)
            .filter(
                (models.Patient.name.ilike(search_filter))
                | (models.Patient.phone.ilike(search_filter))
                | (models.Patient.patient_uid.ilike(search_filter))
                | (models.Patient.aadhaar_number.ilike(search_filter))
                | (models.Appointment.aadhaar_number.ilike(search_filter))
                | (models.Appointment.notes.ilike(search_filter))
                | (models.Appointment.visit_type.ilike(search_filter))
                | (models.Doctor.name.ilike(search_filter))
                | (models.Doctor.specialization.ilike(search_filter))
            )
            .distinct()
        )
    if gender and gender.strip():
        query = query.filter(models.Patient.gender == gender.strip())
    if source and source.strip():
        s = source.strip().lower()
        if "whatsapp" in s:
            query = query.filter(models.Patient.registration_source.ilike("%whatsapp%"))
        else:
            query = query.filter(~models.Patient.registration_source.ilike("%whatsapp%"))

    patients = query.order_by(models.Patient.created_at.desc()).all()
    results = []

    target_date = date.strip() if date and date.strip() else None

    for p in patients:
        # Backfill missing UID if null
        if not p.patient_uid:
            year = p.created_at.year if p.created_at else datetime.date.today().year
            p.patient_uid = f"PAT-{year}-{p.id:04d}"
            try:
                db.commit()
            except Exception:
                db.rollback()

        created_date_str = p.created_at.strftime("%Y-%m-%d") if p.created_at else None

        # Sort all appointments chronologically (most recent first)
        sorted_appts = sorted(
            p.appointments,
            key=lambda a: (a.appointment_date or "", a.start_time or ""),
            reverse=True,
        )
        total_visits = len(sorted_appts)
        completed_visits = sum(1 for a in sorted_appts if a.status == "COMPLETED")

        # Most recent / latest appointment
        last_appt = sorted_appts[0] if sorted_appts else None
        last_visit_date = last_appt.appointment_date if last_appt else None
        last_visit_time = last_appt.start_time if last_appt else None
        last_doctor_name = last_appt.doctor.name if (last_appt and last_appt.doctor) else None
        last_doctor_specialization = last_appt.doctor.specialization if (last_appt and last_appt.doctor) else None
        last_visit_type = last_appt.visit_type if last_appt else None
        last_status = last_appt.status if last_appt else None
        last_reason = (last_appt.notes or "").strip() if last_appt else None
        last_cabin = last_appt.cabin if last_appt else None
        last_paid_amount = last_appt.paid_amount if last_appt else None
        last_payment_status = last_appt.payment_status if last_appt else None

        # Next upcoming confirmed/open appointment
        upcoming_appts = [
            a for a in sorted_appts
            if a.status in ["CONFIRMED", "IN_CONSULTATION"] and (a.appointment_date or "") >= today_str
        ]
        next_appt = sorted(upcoming_appts, key=lambda a: (a.appointment_date or "", a.start_time or ""))[0] if upcoming_appts else None
        next_visit_date = next_appt.appointment_date if next_appt else None
        next_visit_time = next_appt.start_time if next_appt else None
        next_doctor_name = next_appt.doctor.name if (next_appt and next_appt.doctor) else None
        next_specialization = next_appt.doctor.specialization if (next_appt and next_appt.doctor) else None
        next_status = next_appt.status if next_appt else None
        next_visit_type = next_appt.visit_type if next_appt else None

        # Auto-sync missing patient fields from appointment if available
        if last_appt and not p.aadhaar_number and getattr(last_appt, "aadhaar_number", None):
            p.aadhaar_number = last_appt.aadhaar_number
            try:
                db.commit()
            except Exception:
                db.rollback()

        # Check today's visits / queue tokens
        today_appts = [a for a in p.appointments if a.appointment_date == today_str]
        has_today_visit = bool(today_appts or (created_date_str == today_str))
        today_token = None
        for a in today_appts:
            if a.queue_entry:
                q = a.queue_entry[0] if (isinstance(a.queue_entry, list) and a.queue_entry) else a.queue_entry
                if q:
                    today_token = getattr(q, "token_number", None)
                    break

        # Check date filter if requested
        if target_date:
            has_date_match = (created_date_str == target_date) or any(
                a.appointment_date == target_date for a in p.appointments
            )
            if not has_date_match:
                continue

        results.append({
            "id": p.id,
            "patient_uid": p.patient_uid,
            "name": p.name,
            "phone": p.phone,
            "phone_display": format_phone_display(p.phone),
            "gender": p.gender or "Unspecified",
            "age": p.age,
            "gender_age_display": format_gender_age_display(p.gender, p.age),
            "blood_group": p.blood_group or "-",
            "registration_source": "WhatsApp" if "whatsapp" in (p.registration_source or "").lower() else "Direct",
            "total_visits": total_visits,
            "completed_visits": completed_visits,
            "visits_display": f"{total_visits} visit{'s' if total_visits != 1 else ''}",
            # Appointment-derived operational fields:
            "last_visit": last_visit_date or "None yet",
            "last_visit_time": last_visit_time,
            "last_doctor_name": last_doctor_name or "—",
            "last_doctor_specialization": last_doctor_specialization or "—",
            "last_visit_type": last_visit_type or "New Consultation",
            "last_appointment_status": last_status or "—",
            "last_reason": last_reason or "—",
            "last_cabin": last_cabin or "Cabin 1",
            "last_paid_amount": last_paid_amount,
            "last_payment_status": last_payment_status,
            "next_appointment": next_visit_date or "None scheduled",
            "next_appointment_time": next_visit_time,
            "next_doctor_name": next_doctor_name,
            "next_doctor_specialization": next_specialization,
            "next_status": next_status,
            "next_visit_type": next_visit_type,
            "aadhaar_number": p.aadhaar_number or "-",
            "address": p.address or "-",
            "city": p.city or "Agra",
            "created_at": p.created_at.strftime("%d %b %Y") if p.created_at else "-",
            "created_date": created_date_str,
            "is_today": has_today_visit,
            "today_token": today_token,
            "today_token_display": f"Token #{today_token:02d}" if today_token else None,
        })

    # Return structured response including server-calculated directory stats
    stats_data = compute_patient_stats_internal(db)
    total_matching = len(results)

    # Server-side pagination calculation
    if page is not None and str(page_size).lower() != "all":
        try:
            psize = int(page_size) if page_size is not None and str(page_size).isdigit() else 20
        except Exception:
            psize = 20
        total_pages = math.ceil(total_matching / psize) if total_matching > 0 else 1
        offset = (page - 1) * psize
        paginated_patients = results[offset : offset + psize]
        pagination_data = {
            "total_items": total_matching,
            "total_pages": total_pages,
            "current_page": page,
            "page_size": psize,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        }
        return {
            "total": total_matching,
            "pagination": pagination_data,
            "stats": stats_data,
            "patients": paginated_patients,
        }

    return {
        "total": total_matching,
        "pagination": {
            "total_items": total_matching,
            "total_pages": 1,
            "current_page": 1,
            "page_size": total_matching,
            "has_next": False,
            "has_prev": False,
        },
        "stats": stats_data,
        "patients": results,
    }


@router.post("")
def register_patient(payload: PatientCreate, db: Session = Depends(get_db)):
    """
    Registers a new patient with complete demographic and baseline medical history.
    All data normalization, duplicate detection, age synchronization, and clinical
    parsing are executed securely in the backend.
    """
    clean_name = payload.name.strip().title()
    if len(clean_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Patient full name must be at least 2 characters.",
        )

    clean_phone = payload.phone.strip()
    norm_phone = normalize_phone(clean_phone)
    if len(norm_phone) < 7:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Valid phone number with at least 7 digits is required.",
        )

    # Check for existing patient by exact phone or normalized phone
    all_pts = db.query(models.Patient).all()
    for existing in all_pts:
        if normalize_phone(existing.phone) == norm_phone or existing.phone == clean_phone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Patient with phone {format_phone_display(existing.phone)} already exists (ID: {existing.patient_uid or existing.id}, Name: {existing.name}). Please search and open their medical record.",
            )

    # Synchronize DOB and Age
    final_dob, final_age = compute_age_and_dob(payload.dob, payload.age)

    # Parse and structure allergies and chronic conditions
    parsed_allergies = parse_allergies_data(payload.allergies, payload.allergies_text)
    parsed_chronic = parse_chronic_data(payload.chronic_conditions, payload.chronic_conditions_text)

    # Medical history and alerts
    parsed_history = payload.medical_history if isinstance(payload.medical_history, list) else []
    parsed_alerts = payload.clinical_alerts if isinstance(payload.clinical_alerts, list) else []

    # Assign UID
    patient_uid = generate_patient_uid(db)

    patient = models.Patient(
        patient_uid=patient_uid,
        name=clean_name,
        phone=clean_phone,
        gender=payload.gender or "Unspecified",
        dob=final_dob,
        age=final_age,
        blood_group=payload.blood_group or "O+",
        email=payload.email.strip() if payload.email and payload.email.strip() else None,
        address=payload.address.strip() if payload.address and payload.address.strip() else None,
        city=payload.city.strip() if payload.city and payload.city.strip() else "Agra",
        state=payload.state.strip() if payload.state and payload.state.strip() else "Uttar Pradesh",
        emergency_name=payload.emergency_name.strip() if payload.emergency_name and payload.emergency_name.strip() else None,
        emergency_phone=payload.emergency_phone.strip() if payload.emergency_phone and payload.emergency_phone.strip() else None,
        registration_source="WhatsApp" if payload.registration_source and "whatsapp" in payload.registration_source.lower() else "Direct",
        allergies=json.dumps(parsed_allergies),
        chronic_conditions=json.dumps(parsed_chronic),
        medical_history=json.dumps(parsed_history),
        clinical_alerts=json.dumps(parsed_alerts),
        created_at=datetime.datetime.utcnow(),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    stats_data = compute_patient_stats_internal(db)

    return {
        "message": f"Patient {patient.name} registered successfully with ID {patient.patient_uid}.",
        "patient": {
            "id": patient.id,
            "patient_uid": patient.patient_uid,
            "name": patient.name,
            "phone": patient.phone,
            "phone_display": format_phone_display(patient.phone),
            "gender": patient.gender,
            "age": patient.age,
            "gender_age_display": format_gender_age_display(patient.gender, patient.age),
            "blood_group": patient.blood_group,
            "registration_source": patient.registration_source,
            "total_visits": 0,
            "visits_display": "0 visits",
            "last_visit": "None yet",
            "next_appointment": "None scheduled",
            "created_at": patient.created_at.strftime("%d %b %Y"),
        },
        "stats": stats_data,
    }


@router.get("/{patient_id}")
def get_patient_profile(patient_id: int, db: Session = Depends(get_db)):
    """Returns the full 360-degree patient chart with all 8 operational tabs."""
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found")

    # 1. Allergies, Medical History & Chronic Conditions
    try:
        allergies_list = json.loads(patient.allergies or "[]")
    except Exception:
        allergies_list = []
    try:
        chronic_list = json.loads(patient.chronic_conditions or "[]")
    except Exception:
        chronic_list = []
    try:
        history_list = json.loads(patient.medical_history or "[]")
    except Exception:
        history_list = []
    try:
        alerts_list = json.loads(patient.clinical_alerts or "[]")
    except Exception:
        alerts_list = []

    # 2. Consultations Encounters
    consultations = (
        db.query(models.Consultation)
        .filter(models.Consultation.patient_id == patient.id)
        .order_by(models.Consultation.created_at.desc())
        .all()
    )
    consultation_records = [
        {
            "id": c.id,
            "encounter_uid": c.encounter_uid,
            "date": c.consultation_date,
            "doctor_name": c.doctor.name if c.doctor else "Specialist",
            "specialization": c.doctor.specialization if c.doctor else "-",
            "visit_type": c.visit_type,
            "status": c.status,
            "chief_complaint": c.chief_complaint,
            "diagnosis": c.diagnosis,
            "vitals": json.loads(c.vitals or "{}"),
            "treatment_plan": c.treatment_plan,
            "follow_up_date": c.follow_up_date,
            "is_finalised": c.is_finalised,
            "signed_by": c.signed_by,
            "created_at": c.created_at.strftime("%d %b %Y, %I:%M %p") if c.created_at else "-",
        }
        for c in consultations
    ]

    # 3. Prescriptions
    prescriptions = (
        db.query(models.Prescription)
        .filter(models.Prescription.patient_id == patient.id)
        .order_by(models.Prescription.created_at.desc())
        .all()
    )
    prescription_records = [
        {
            "id": rx.id,
            "prescription_uid": rx.prescription_uid or f"RX-{rx.id:04d}",
            "doctor_name": rx.doctor.name if rx.doctor else "Doctor",
            "diagnosis": rx.diagnosis,
            "medicines": json.loads(rx.medicines or "[]"),
            "advice": rx.advice,
            "created_at": rx.created_at.strftime("%d %b %Y") if rx.created_at else "-",
        }
        for rx in prescriptions
    ]

    # 4. Laboratory Orders & Results
    lab_orders = (
        db.query(models.LabOrder)
        .filter(models.LabOrder.patient_id == patient.id)
        .order_by(models.LabOrder.created_at.desc())
        .all()
    )
    lab_records = [
        {
            "id": o.id,
            "order_uid": o.order_uid,
            "priority": o.priority,
            "status": o.status,
            "tests": json.loads(o.tests or "[]"),
            "total_price": o.total_price,
            "created_at": o.created_at.strftime("%d %b %Y, %I:%M %p") if o.created_at else "-",
        }
        for o in lab_orders
    ]

    # 5. Appointments Roster
    appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.patient_id == patient.id)
        .order_by(models.Appointment.appointment_date.desc(), models.Appointment.start_time.desc())
        .all()
    )
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    appointment_records = [
        {
            "id": a.id,
            "date": a.appointment_date,
            "time": f"{a.start_time} - {a.end_time}",
            "start_time": a.start_time,
            "end_time": a.end_time,
            "doctor_name": a.doctor.name if a.doctor else "Specialist",
            "specialization": a.doctor.specialization if a.doctor else "General OPD",
            "status": a.status,
            "source": a.source or "WhatsApp",
            "notes": (a.notes or "").strip(),
            "visit_type": a.visit_type or "New Consultation",
            "cabin": a.cabin or "Cabin 1",
            "aadhaar_number": a.aadhaar_number or "-",
            "payment_status": a.payment_status or "PAID",
            "payment_method": a.payment_method or "UPI",
            "paid_amount": a.paid_amount or 500,
        }
        for a in appointments
    ]

    # Appointments summary for overview
    last_appt = appointments[0] if appointments else None
    upcoming_appts = [
        a for a in appointments
        if a.status in ["CONFIRMED", "IN_CONSULTATION"] and (a.appointment_date or "") >= today_str
    ]
    next_appt = sorted(upcoming_appts, key=lambda a: (a.appointment_date or "", a.start_time or ""))[0] if upcoming_appts else None

    # Auto sync aadhaar to patient profile if missing
    if not patient.aadhaar_number and last_appt and getattr(last_appt, "aadhaar_number", None):
        patient.aadhaar_number = last_appt.aadhaar_number
        try:
            db.commit()
            db.refresh(patient)
        except Exception:
            db.rollback()

    # 6. Billing & Invoices
    invoices = (
        db.query(models.Invoice)
        .filter(models.Invoice.patient_id == patient.id)
        .order_by(models.Invoice.created_at.desc())
        .all()
    )
    invoice_records = [
        {
            "id": inv.id,
            "invoice_number": inv.invoice_number,
            "total": inv.total,
            "amount_paid": inv.amount_paid or (inv.total if inv.payment_status == "PAID" else 0),
            "balance_due": inv.balance_due or (0 if inv.payment_status == "PAID" else inv.total),
            "payment_status": inv.payment_status,
            "payment_method": inv.payment_method,
            "created_at": inv.created_at.strftime("%d %b %Y") if inv.created_at else "-",
        }
        for inv in invoices
    ]

    return {
        "overview": {
            "id": patient.id,
            "patient_uid": patient.patient_uid or f"PAT-{patient.id:04d}",
            "name": patient.name,
            "phone": patient.phone,
            "gender": patient.gender or "Unspecified",
            "dob": patient.dob or "-",
            "age": patient.age or "-",
            "blood_group": patient.blood_group or "-",
            "email": patient.email or "-",
            "address": patient.address or "-",
            "city": patient.city or "-",
            "state": patient.state or "-",
            "emergency_name": patient.emergency_name or "-",
            "emergency_phone": patient.emergency_phone or "-",
            "aadhaar_number": patient.aadhaar_number or (last_appt.aadhaar_number if (last_appt and last_appt.aadhaar_number) else "-"),
            "registration_source": "WhatsApp" if "whatsapp" in (patient.registration_source or "").lower() else "Direct",
            "total_visits": len(appointments),
            "completed_visits": sum(1 for a in appointments if a.status == "COMPLETED"),
            "last_visit_date": last_appt.appointment_date if last_appt else None,
            "last_visit_time": last_appt.start_time if last_appt else None,
            "last_doctor": last_appt.doctor.name if (last_appt and last_appt.doctor) else None,
            "last_specialization": last_appt.doctor.specialization if (last_appt and last_appt.doctor) else None,
            "last_visit_type": last_appt.visit_type if last_appt else None,
            "last_reason": (last_appt.notes or "").strip() if last_appt else None,
            "last_cabin": last_appt.cabin if last_appt else None,
            "last_paid_amount": last_appt.paid_amount if last_appt else None,
            "last_payment_status": last_appt.payment_status if last_appt else None,
            "next_appointment_date": next_appt.appointment_date if next_appt else None,
            "next_appointment_time": next_appt.start_time if next_appt else None,
            "next_doctor": next_appt.doctor.name if (next_appt and next_appt.doctor) else None,
            "next_specialization": next_appt.doctor.specialization if (next_appt and next_appt.doctor) else None,
            "next_visit_type": next_appt.visit_type if next_appt else None,
            "created_at": patient.created_at.strftime("%d %b %Y") if patient.created_at else "-",
        },
        "clinical": {
            "allergies": allergies_list,
            "chronic_conditions": chronic_list,
            "medical_history": history_list,
            "clinical_alerts": alerts_list,
        },
        "consultations": consultation_records,
        "prescriptions": prescription_records,
        "laboratory": lab_records,
        "appointments": appointment_records,
        "billing": invoice_records,
    }


@router.put("/{patient_id}")
def update_patient_profile(patient_id: int, payload: PatientUpdate, db: Session = Depends(get_db)):
    """Updates demographic and clinical history details of a patient."""
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found")

    update_dict = payload.dict(exclude_unset=True)
    for field, val in update_dict.items():
        if field in ["allergies", "chronic_conditions", "medical_history", "clinical_alerts"]:
            if val is not None:
                setattr(patient, field, json.dumps(val))
        elif val is not None:
            setattr(patient, field, val)

    db.commit()
    db.refresh(patient)
    return {"message": "Patient profile updated successfully", "id": patient.id}
