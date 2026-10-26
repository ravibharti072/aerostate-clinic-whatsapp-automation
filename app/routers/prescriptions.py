import json
import datetime
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Prescription, Patient, Doctor, Appointment, Consultation, DispenseRecord, QueueEntry
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.config import settings
from app.security import require_admin

router = APIRouter(prefix="/admin/prescriptions", tags=["Prescriptions & EMR"], dependencies=[Depends(require_admin)])


class MedicineItem(BaseModel):
    name: str
    dosage: str = "1-0-1"        # e.g., 1-0-1, 1-0-0
    duration: str = "5 days"     # e.g., 5 days, 1 week
    notes: Optional[str] = "After food"
    fulfillment: Optional[str] = "CLINIC"  # "CLINIC" or "OUTSIDE"


class FulfillmentUpdateRequest(BaseModel):
    fulfillment: Optional[str] = None  # "CLINIC" or "OUTSIDE"
    medicines: Optional[List[Dict[str, Any]]] = None


class PrescriptionCreate(BaseModel):
    id: Optional[int] = None
    prescription_id: Optional[int] = None
    patient_id: Optional[int] = None
    patient_phone: Optional[str] = None
    patient_name: Optional[str] = None
    doctor_id: int
    appointment_id: Optional[int] = None
    encounter_id: Optional[int] = None
    vitals: Optional[Dict[str, Any]] = None  # bp, pulse, temp, weight
    symptoms: Optional[str] = None
    diagnosis: str
    medicines: List[MedicineItem] = []
    lab_tests: Optional[str] = None
    advice: Optional[str] = None
    send_whatsapp: bool = True
    prescription_mode: Optional[str] = "IN_PERSON"  # IN_PERSON, QUICK_REFILL, TELE_CONSULT


def format_prescription_whatsapp(rx: Prescription, patient: Patient, doctor: Doctor, meds: list) -> str:
    """Formats a clean, professional prescription message for WhatsApp with clinic/outside split."""
    today_str = rx.created_at.strftime("%d %b %Y, %I:%M %p")
    vitals_data = json.loads(rx.vitals or "{}")

    vitals_str = ""
    vitals_parts = []
    if vitals_data.get("bp"): vitals_parts.append(f"BP: {vitals_data['bp']}")
    if vitals_data.get("pulse"): vitals_parts.append(f"Pulse: {vitals_data['pulse']} bpm")
    if vitals_data.get("temp"): vitals_parts.append(f"Temp: {vitals_data['temp']}")
    if vitals_data.get("weight"): vitals_parts.append(f"Weight: {vitals_data['weight']}")
    if vitals_parts:
        vitals_str = f"🩺 *Vitals:* {', '.join(vitals_parts)}\n"

    clinic_meds = [m for m in meds if (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
    outside_meds = [m for m in meds if (m.get("fulfillment") or "").upper() == "OUTSIDE"]

    meds_str = ""
    if clinic_meds and outside_meds:
        # Hybrid Prescriptions: clearly split into Section A & B
        meds_str = "*🏥 SECTION A — In-House Clinic Pharmacy:*\n_(Collect directly from clinic pharmacy desk)_\n"
        for i, m in enumerate(clinic_meds, 1):
            dosage = m.get("dosage", "1-0-1")
            dur = m.get("duration", "5 days")
            instruction = f" ({m.get('notes')})" if m.get("notes") else ""
            meds_str += f"{i}. *{m.get('name')}*\n   └ Dosage: {dosage} for {dur}{instruction}\n"

        meds_str += "\n*💊 SECTION B — Outside Retail Chemist:*\n_(Purchase from any licensed chemist/pharmacy)_\n"
        for i, m in enumerate(outside_meds, 1):
            dosage = m.get("dosage", "1-0-1")
            dur = m.get("duration", "5 days")
            instruction = f" ({m.get('notes')})" if m.get("notes") else ""
            meds_str += f"{i}. *{m.get('name')}*\n   └ Dosage: {dosage} for {dur}{instruction}\n"
    elif outside_meds and not clinic_meds:
        # 100% Outside Prescriptions
        meds_str = "*💊 Prescribed Medications (To Purchase from Outside Retail Chemist):*\n"
        for i, m in enumerate(outside_meds, 1):
            dosage = m.get("dosage", "1-0-1")
            dur = m.get("duration", "5 days")
            instruction = f" ({m.get('notes')})" if m.get("notes") else ""
            meds_str += f"{i}. *{m.get('name')}*\n   └ Dosage: {dosage} for {dur}{instruction}\n"
    elif clinic_meds:
        # In-House Clinic Pharmacy
        meds_str = "*💊 Prescribed Medications (Clinic In-House Pharmacy):*\n"
        for i, m in enumerate(clinic_meds, 1):
            dosage = m.get("dosage", "1-0-1")
            dur = m.get("duration", "5 days")
            instruction = f" ({m.get('notes')})" if m.get("notes") else ""
            meds_str += f"{i}. *{m.get('name')}*\n   └ Dosage: {dosage} for {dur}{instruction}\n"

    advice_str = f"\n💡 *Doctor's Advice:* {rx.advice}\n" if rx.advice else ""
    tests_str = f"\n🔬 *Recommended Tests:* {rx.lab_tests}\n" if rx.lab_tests else ""

    text = (
        f"🏥 *{settings.CLINIC_NAME}*\n"
        f"📜 *DIGITAL PRESCRIPTION #{rx.prescription_uid or f'RX-{rx.id}'}*\n\n"
        f"👤 *Patient:* {patient.name}\n"
        f"🩺 *Doctor:* {doctor.name} ({doctor.specialization})\n"
        f"📅 *Date:* {today_str}\n"
        f"📋 *Diagnosis:* {rx.diagnosis}\n"
        f"{vitals_str}"
        f"{meds_str}"
        f"{tests_str}"
        f"{advice_str}\n"
        f"📞 *Clinic Helpline:* {settings.CLINIC_PHONE}\n"
        f"📍 *Address:* {settings.CLINIC_ADDRESS}\n"
        f"_Please take medications as advised. Get well soon!_"
    )
    return text


def normalize_phone(phone: str) -> str:
    """Normalize phone number to digits only, trimming leading country codes if appropriate."""
    cleaned = "".join(filter(str.isdigit, phone or ""))
    if cleaned.startswith("91") and len(cleaned) == 12:
        cleaned = cleaned[2:]
    return cleaned


def format_phone_display(phone: str) -> str:
    if not phone or "00000" in str(phone) or "TEMP" in str(phone):
        return "Not Provided"
    digits = normalize_phone(phone)
    if len(digits) == 10:
        return f"+91 {digits[:5]} {digits[5:]}"
    if phone.startswith("+"):
        return phone
    return phone


def compute_prescription_stats(db: Session) -> Dict[str, int]:
    """Computes master prescription metrics directly in the database."""
    total_prescriptions = db.query(Prescription).count()
    today_start = datetime.datetime.combine(datetime.date.today(), datetime.time.min)
    today_prescriptions = db.query(Prescription).filter(Prescription.created_at >= today_start).count()

    all_rxs = db.query(Prescription).all()
    whatsapp_delivered = sum(1 for rx in all_rxs if rx.patient and rx.patient.phone and len(normalize_phone(rx.patient.phone)) >= 7)
    available_specialists = db.query(Doctor).filter(Doctor.is_active == True).count()

    # 100% backend-calculated prescription fulfillment metrics
    dispensed_rx_ids = {
        r[0] for r in db.query(DispenseRecord.prescription_id).filter(DispenseRecord.prescription_id != None).all()
    }
    pending_count = 0
    dispensed_count = 0
    outside_count = 0

    for rx in all_rxs:
        is_dispensed = rx.id in dispensed_rx_ids
        try:
            meds = json.loads(rx.medicines or "[]")
        except Exception:
            meds = []
        clinic_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
        outside_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "").upper() == "OUTSIDE"]

        is_all_outside = bool(outside_meds and not clinic_meds)

        if is_all_outside:
            outside_count += 1
        elif is_dispensed:
            dispensed_count += 1
        else:
            pending_count += 1

    return {
        "total_prescriptions": total_prescriptions,
        "today_prescriptions": today_prescriptions,
        "whatsapp_delivered": whatsapp_delivered,
        "available_specialists": available_specialists,
        "pending_count": pending_count,
        "dispensed_count": dispensed_count,
        "outside_count": outside_count,
    }


# ========================================================
# STATS & TEMPLATES (Must precede /{rx_id})
# ========================================================

@router.get("/stats")
def get_prescription_stats(db: Session = Depends(get_db)):
    """Returns real-time prescription and dispatch statistics."""
    return compute_prescription_stats(db)


@router.get("/templates")
def get_prescription_templates():
    """Provides standard medication timings, dosage presets, and diagnostic templates."""
    return {
        "dosage_presets": ["1-0-1", "1-0-0", "0-0-1", "1-1-1", "SOS (As Needed)", "1-1-1-1"],
        "duration_presets": ["3 days", "5 days", "7 days", "10 days", "14 days", "1 month"],
        "timing_instructions": [
            "After food",
            "Before food",
            "With warm water",
            "At bedtime",
            "On empty stomach",
            "With meals",
        ],
        "common_diagnoses": [
            "Acute Bronchitis",
            "Upper Respiratory Tract Infection (URTI)",
            "Viral Fever & Bodyache",
            "Essential Hypertension Review",
            "Type 2 Diabetes Mellitus",
            "Acute Gingivitis & Dental Pain",
            "Gastritis & Acid Peptic Disorder",
            "Allergic Rhinitis & Sinusitis",
        ],
        "common_tests": [
            "Complete Blood Count (CBC)",
            "Fasting Blood Sugar (FBS)",
            "HbA1c Glycated Hemoglobin",
            "Lipid Profile",
            "Liver Function Test (LFT)",
            "Kidney Function Test (KFT)",
            "Thyroid Profile (T3, T4, TSH)",
            "Urine Routine & Microscopic",
        ],
    }


# ========================================================
# PRESCRIPTION ROSTER & ENTRY
# ========================================================

@router.get("")
def list_prescriptions(
    search: Optional[str] = None,
    doctor_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Returns prescriptions roster with SQL-level search across patient, doctor,
    and diagnosis, along with calculated KPI metrics.
    """
    query = db.query(Prescription).join(Patient).outerjoin(Doctor)

    if search and search.strip():
        search_filter = f"%{search.strip()}%"
        query = query.filter(
            (Patient.name.ilike(search_filter))
            | (Patient.phone.ilike(search_filter))
            | (Patient.patient_uid.ilike(search_filter))
            | (Doctor.name.ilike(search_filter))
            | (Prescription.diagnosis.ilike(search_filter))
        )

    if doctor_id:
        query = query.filter(Prescription.doctor_id == doctor_id)
    if patient_id:
        query = query.filter(Prescription.patient_id == patient_id)

    rx_list = query.order_by(Prescription.created_at.desc()).all()

    results = []
    for rx in rx_list:
        patient = rx.patient
        doctor = rx.doctor

        meds = json.loads(rx.medicines or "[]")
        vitals = json.loads(rx.vitals or "{}")

        med_names = [m.get("name") for m in meds if isinstance(m, dict) and m.get("name")]
        summary_text = (
            f"{len(meds)} Medication{'s' if len(meds) != 1 else ''}"
            + (f" ({', '.join(med_names)})" if med_names else "")
        )

        # Check Pharmacy dispensing status
        has_dispense = db.query(DispenseRecord).filter(DispenseRecord.prescription_id == rx.id).first() is not None

        # Analyze medicine fulfillment (Clinic vs Outside Chemist)
        clinic_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
        outside_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "").upper() == "OUTSIDE"]

        if clinic_meds and outside_meds:
            fulfillment_type = "HYBRID"
        elif outside_meds and not clinic_meds:
            fulfillment_type = "OUTSIDE"
        else:
            fulfillment_type = "CLINIC"

        if fulfillment_type == "OUTSIDE":
            dispense_status = "OUTSIDE"
        elif has_dispense:
            dispense_status = "DISPENSED"
        elif fulfillment_type == "HYBRID":
            dispense_status = "PENDING_CLINIC"
        else:
            dispense_status = "PENDING"

        # Resolve encounter UID if linked
        enc_uid = None
        visit_type = None
        is_enc_finalised = True
        if rx.encounter_id:
            enc_obj = db.query(Consultation).filter(Consultation.id == rx.encounter_id).first()
            if enc_obj:
                enc_uid = enc_obj.encounter_uid
                visit_type = enc_obj.visit_type
                is_enc_finalised = enc_obj.is_finalised

        if not is_enc_finalised and not has_dispense:
            dispense_status = "DRAFT_CONSULTATION"
            if status and status.lower() == "pending":
                continue

        # 100% backend-calculated status filter
        if status and status.lower() == "pending" and (fulfillment_type == "OUTSIDE" or has_dispense):
            continue
        elif status and status.lower() == "dispensed" and not has_dispense:
            continue
        elif status and status.lower() == "outside" and fulfillment_type != "OUTSIDE":
            continue

        results.append({
            "id": rx.id,
            "prescription_uid": rx.prescription_uid or f"#RX-{rx.id}",
            "appointment_id": rx.appointment_id,
            "encounter_id": rx.encounter_id,
            "encounter_uid": enc_uid,
            "prescription_mode": getattr(rx, "prescription_mode", "IN_PERSON") or "IN_PERSON",
            "is_finalised": is_enc_finalised,
            "is_dispensable": is_enc_finalised and not has_dispense and fulfillment_type != "OUTSIDE",
            "visit_type": visit_type or "Quick Rx / Direct",
            "is_dispensed": has_dispense,
            "dispense_status": dispense_status,
            "fulfillment_type": fulfillment_type,
            "clinic_meds_count": len(clinic_meds),
            "outside_meds_count": len(outside_meds),
            "patient_id": patient.id,
            "patient_uid": patient.patient_uid or f"PAT-{patient.id:04d}",
            "patient_name": patient.name,
            "patient_phone": patient.phone,
            "patient_phone_display": format_phone_display(patient.phone),
            "doctor_id": doctor.id,
            "doctor_name": doctor.name,
            "doctor_specialty": doctor.specialization,
            "diagnosis": rx.diagnosis,
            "symptoms": rx.symptoms,
            "medicines": meds,
            "medicines_count": len(meds),
            "medicines_summary": summary_text,
            "vitals": vitals,
            "lab_tests": rx.lab_tests,
            "advice": rx.advice,
            "created_at": rx.created_at.isoformat() if rx.created_at else None,
            "created_date_display": rx.created_at.strftime("%d %b %Y") if rx.created_at else "-",
        })

    return {
        "total": len(results),
        "stats": compute_prescription_stats(db),
        "prescriptions": results,
    }


@router.get("/{rx_id}")
def get_prescription(rx_id: int, db: Session = Depends(get_db)):
    rx = db.query(Prescription).filter(Prescription.id == rx_id).first()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")

    has_dispense = db.query(DispenseRecord).filter(DispenseRecord.prescription_id == rx.id).first() is not None
    meds = json.loads(rx.medicines or "[]")
    clinic_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
    outside_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "").upper() == "OUTSIDE"]

    if clinic_meds and outside_meds:
        fulfillment_type = "HYBRID"
    elif outside_meds and not clinic_meds:
        fulfillment_type = "OUTSIDE"
    else:
        fulfillment_type = "CLINIC"

    if fulfillment_type == "OUTSIDE":
        dispense_status = "OUTSIDE"
    elif has_dispense:
        dispense_status = "DISPENSED"
    elif fulfillment_type == "HYBRID":
        dispense_status = "PENDING_CLINIC"
    else:
        dispense_status = "PENDING"

    enc_uid = None
    if rx.encounter_id:
        enc_obj = db.query(Consultation).filter(Consultation.id == rx.encounter_id).first()
        if enc_obj:
            enc_uid = enc_obj.encounter_uid

    return {
        "id": rx.id,
        "prescription_uid": rx.prescription_uid or f"#RX-{rx.id}",
        "appointment_id": rx.appointment_id,
        "encounter_id": rx.encounter_id,
        "encounter_uid": enc_uid,
        "prescription_mode": getattr(rx, "prescription_mode", "IN_PERSON") or "IN_PERSON",
        "is_dispensed": has_dispense,
        "dispense_status": dispense_status,
        "fulfillment_type": fulfillment_type,
        "clinic_meds_count": len(clinic_meds),
        "outside_meds_count": len(outside_meds),
        "patient": {
            "id": rx.patient.id,
            "uid": rx.patient.patient_uid or f"PAT-{rx.patient.id:04d}",
            "name": rx.patient.name,
            "phone": rx.patient.phone,
        },
        "doctor": {
            "id": rx.doctor.id,
            "name": rx.doctor.name,
            "specialization": rx.doctor.specialization,
        },
        "vitals": json.loads(rx.vitals or "{}"),
        "symptoms": rx.symptoms,
        "diagnosis": rx.diagnosis,
        "medicines": json.loads(rx.medicines or "[]"),
        "lab_tests": rx.lab_tests,
        "advice": rx.advice,
        "created_at": rx.created_at.isoformat(),
        "created_date_display": rx.created_at.strftime("%d %b %Y, %I:%M %p"),
    }


@router.post("")
async def create_prescription(payload: PrescriptionCreate, db: Session = Depends(get_db)):
    # 1. Resolve or Auto-Register Patient
    patient = None
    clean_name = payload.patient_name.strip() if (payload.patient_name and payload.patient_name.strip()) else None
    clean_phone = payload.patient_phone.strip() if (payload.patient_phone and payload.patient_phone.strip()) else None

    # In Quick Refill or Telephonic mode, patient name is optional; default to general placeholder
    if not clean_name and (payload.prescription_mode or "").upper() == "QUICK_REFILL":
        clean_name = "Walk-in Refill Patient"
        patient = db.query(Patient).filter(Patient.name == "Walk-in Refill Patient").first()
    elif not clean_name and (payload.prescription_mode or "").upper() == "TELE_CONSULT":
        clean_name = "Telephonic Patient"
        if not clean_phone:
            patient = db.query(Patient).filter(Patient.name == "Telephonic Patient").first()

    if not patient and payload.patient_id:
        patient = db.query(Patient).filter(Patient.id == payload.patient_id).first()

    if not patient and clean_phone:
        patient = db.query(Patient).filter(Patient.phone == clean_phone).first()

    if not patient and clean_name:
        # Search by patient name in database
        patient = db.query(Patient).filter(Patient.name.ilike(clean_name)).first()

    # If patient not found in database, auto-register them immediately
    if not patient:
        if not clean_name:
            raise HTTPException(status_code=400, detail="Patient Name is required to write prescription")
        year = datetime.date.today().year
        count = db.query(Patient).count() + 1
        assigned_phone = clean_phone if clean_phone else f"+91 00000 {count:05d}"
        patient = Patient(
            patient_uid=f"PAT-{year}-{count:04d}",
            name=clean_name,
            phone=assigned_phone,
            registration_source="Direct",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(patient)
        db.commit()
        db.refresh(patient)
    else:
        # Update phone if patient currently has placeholder or empty phone and new valid phone is supplied
        if clean_phone and ("00000" in (patient.phone or "") or not patient.phone):
            patient.phone = clean_phone
            try:
                db.commit()
                db.refresh(patient)
            except Exception:
                db.rollback()

    doctor = db.query(Doctor).filter(Doctor.id == payload.doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    meds_list = []
    for m in payload.medicines:
        m_dict = m.dict()
        if not m_dict.get("fulfillment"):
            m_dict["fulfillment"] = "CLINIC"
        else:
            m_dict["fulfillment"] = m_dict["fulfillment"].upper()
        meds_list.append(m_dict)

    # Option B: Modern Hybrid - Resolve or Auto-Create Clinical Encounter
    enc_id = payload.encounter_id
    if not enc_id and payload.appointment_id:
        enc = db.query(Consultation).filter(Consultation.appointment_id == payload.appointment_id).first()
        if enc:
            enc_id = enc.id

    presc_mode = (payload.prescription_mode or "IN_PERSON").upper()
    if presc_mode == "QUICK_REFILL":
        visit_type_label = "Direct Medication Refill"
    elif presc_mode == "TELE_CONSULT":
        visit_type_label = "Telephonic / Remote Rx"
    else:
        visit_type_label = "In-Person Consultation"

    if not enc_id:
        # Auto-generate clinical encounter so medical record chain is 100% preserved
        year = datetime.date.today().year
        highest_enc = db.query(Consultation).order_by(Consultation.id.desc()).first()
        next_enc_num = (highest_enc.id + 1) if highest_enc else 1
        while db.query(Consultation).filter(Consultation.encounter_uid == f"ENC-{year}-{next_enc_num:04d}").first():
            next_enc_num += 1
        enc_uid = f"ENC-{year}-{next_enc_num:04d}"

        new_enc = Consultation(
            encounter_uid=enc_uid,
            patient_id=patient.id,
            doctor_id=doctor.id,
            appointment_id=payload.appointment_id,
            consultation_date=datetime.date.today().strftime("%Y-%m-%d"),
            status="COMPLETED",
            visit_type=visit_type_label,
            chief_complaint=payload.symptoms or (f"Routine medication refill for {payload.diagnosis}" if presc_mode == "QUICK_REFILL" else f"Direct prescription issued for {payload.diagnosis}"),
            vitals=json.dumps(payload.vitals or {}),
            diagnosis=payload.diagnosis,
            lab_tests=payload.lab_tests,
            advice=payload.advice,
            is_finalised=True,
            signed_by=doctor.name,
            signed_at=datetime.datetime.utcnow(),
            created_at=datetime.datetime.utcnow(),
        )
        db.add(new_enc)
        db.commit()
        db.refresh(new_enc)
        enc_id = new_enc.id

    # Check if an existing un-dispensed prescription already exists for this consultation/encounter
    existing_rx = None
    target_rx_id = payload.id or payload.prescription_id
    if target_rx_id:
        existing_rx = db.query(Prescription).filter(Prescription.id == target_rx_id).first()

    if not existing_rx and enc_id:
        # Check if consultation encounter exists and is not finalised yet
        enc_record = db.query(Consultation).filter(Consultation.id == enc_id).first()
        if enc_record and not enc_record.is_finalised:
            existing_rx = (
                db.query(Prescription)
                .filter(Prescription.encounter_id == enc_id)
                .order_by(Prescription.id.desc())
                .first()
            )
        elif not enc_record:
            existing_rx = (
                db.query(Prescription)
                .filter(Prescription.encounter_id == enc_id)
                .order_by(Prescription.id.desc())
                .first()
            )

    is_dispensed = False
    if existing_rx:
        is_dispensed = db.query(DispenseRecord).filter(DispenseRecord.prescription_id == existing_rx.id).first() is not None

    is_update = False
    if existing_rx and not is_dispensed:
        # Update existing prescription in-place (do not create duplicate records for same consultation)
        existing_rx.doctor_id = doctor.id
        existing_rx.prescription_mode = presc_mode
        existing_rx.vitals = json.dumps(payload.vitals or {})
        existing_rx.symptoms = payload.symptoms
        existing_rx.diagnosis = payload.diagnosis
        existing_rx.medicines = json.dumps(meds_list)
        existing_rx.lab_tests = payload.lab_tests
        existing_rx.advice = payload.advice
        db.commit()
        db.refresh(existing_rx)
        rx = existing_rx
        is_update = True

        # Clean up any lingering un-dispensed duplicate prescriptions for this same encounter
        if enc_id:
            dispensed_ids = {r[0] for r in db.query(DispenseRecord.prescription_id).filter(DispenseRecord.prescription_id != None).all()}
            dup_rxs = (
                db.query(Prescription)
                .filter(
                    Prescription.encounter_id == enc_id,
                    Prescription.id != rx.id,
                    ~Prescription.id.in_(dispensed_ids) if dispensed_ids else True,
                )
                .all()
            )
            for dup in dup_rxs:
                db.delete(dup)
            if dup_rxs:
                db.commit()
    else:
        rx = Prescription(
            prescription_mode=presc_mode,
            appointment_id=payload.appointment_id,
            encounter_id=enc_id,
            patient_id=patient.id,
            doctor_id=doctor.id,
            vitals=json.dumps(payload.vitals or {}),
            symptoms=payload.symptoms,
            diagnosis=payload.diagnosis,
            medicines=json.dumps(meds_list),
            lab_tests=payload.lab_tests,
            advice=payload.advice,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(rx)
        db.commit()
        db.refresh(rx)

        # Assign UID
        rx.prescription_uid = f"RX-{datetime.date.today().year}-{rx.id:04d}"
        db.commit()
        db.refresh(rx)

    # If linked to appointment, mark appointment as COMPLETED and sync QueueEntry
    if payload.appointment_id:
        appt = db.query(Appointment).filter(Appointment.id == payload.appointment_id).first()
        if appt and appt.status != "COMPLETED":
            appt.status = "COMPLETED"
        q_entries = (
            db.query(QueueEntry)
            .filter(
                QueueEntry.appointment_id == payload.appointment_id,
                QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
            )
            .all()
        )
        for q in q_entries:
            q.status = "COMPLETED"
        db.commit()

    # Optional 1-click WhatsApp delivery
    whatsapp_sent = False
    if payload.send_whatsapp and patient.phone:
        try:
            msg_text = format_prescription_whatsapp(rx, patient, doctor, meds_list)
            await whatsapp_client.send_text(to=patient.phone, text=msg_text)
            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="clinic",
                body=msg_text,
                patient_name=patient.name,
                message_type="prescription",
            )
            whatsapp_sent = True
        except Exception as e:
            print("Failed to dispatch WhatsApp prescription:", e)

    return {
        "message": (f"Prescription #{rx.id} updated successfully" if is_update else f"Prescription #{rx.id} registered with Clinical Encounter successfully") + (" and sent to WhatsApp" if whatsapp_sent else ""),
        "id": rx.id,
        "prescription_id": rx.id,
        "prescription_uid": rx.prescription_uid,
        "encounter_id": enc_id,
        "is_updated": is_update,
        "whatsapp_sent": whatsapp_sent,
        "stats": compute_prescription_stats(db),
    }


@router.post("/{rx_id}/send-whatsapp")
async def send_prescription_whatsapp(rx_id: int, db: Session = Depends(get_db)):
    rx = db.query(Prescription).filter(Prescription.id == rx_id).first()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")

    patient = rx.patient
    doctor = rx.doctor
    meds = json.loads(rx.medicines or "[]")

    msg_text = format_prescription_whatsapp(rx, patient, doctor, meds)
    await whatsapp_client.send_text(to=patient.phone, text=msg_text)
    message_service.log_message(
        db=db,
        phone=patient.phone,
        sender="clinic",
        body=msg_text,
        patient_name=patient.name,
        message_type="prescription",
    )

    return {
        "message": f"Prescription #{rx.id} sent to {patient.phone} via WhatsApp successfully",
        "phone": patient.phone,
    }


@router.put("/{rx_id}/fulfillment")
def update_prescription_fulfillment(rx_id: int, payload: FulfillmentUpdateRequest, db: Session = Depends(get_db)):
    """Updates medicine fulfillment (CLINIC vs OUTSIDE) for an existing prescription."""
    rx = db.query(Prescription).filter(Prescription.id == rx_id).first()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")

    current_meds = json.loads(rx.medicines or "[]")

    if payload.medicines is not None:
        updated_meds = []
        for m in payload.medicines:
            m_copy = dict(m)
            if not m_copy.get("fulfillment"):
                m_copy["fulfillment"] = "CLINIC"
            else:
                m_copy["fulfillment"] = m_copy["fulfillment"].upper()
            updated_meds.append(m_copy)
    elif payload.fulfillment:
        mode = payload.fulfillment.upper()
        if mode not in ["CLINIC", "OUTSIDE"]:
            raise HTTPException(status_code=400, detail="Fulfillment must be CLINIC or OUTSIDE")
        updated_meds = []
        for m in current_meds:
            m_copy = dict(m)
            m_copy["fulfillment"] = mode
            updated_meds.append(m_copy)
    else:
        raise HTTPException(status_code=400, detail="Provide fulfillment mode or medicines list")

    rx.medicines = json.dumps(updated_meds)
    db.commit()
    db.refresh(rx)

    clinic_meds = [m for m in updated_meds if (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
    outside_meds = [m for m in updated_meds if (m.get("fulfillment") or "").upper() == "OUTSIDE"]
    fulfillment_type = "HYBRID" if (clinic_meds and outside_meds) else ("OUTSIDE" if outside_meds and not clinic_meds else "CLINIC")

    return {
        "message": f"Prescription #{rx.id} fulfillment updated to {fulfillment_type} successfully",
        "prescription_id": rx.id,
        "fulfillment_type": fulfillment_type,
        "clinic_meds_count": len(clinic_meds),
        "outside_meds_count": len(outside_meds),
        "medicines": updated_meds,
    }

