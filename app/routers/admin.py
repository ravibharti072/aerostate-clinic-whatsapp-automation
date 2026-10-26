import datetime
import json
from typing import List, Optional, Union, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import Doctor, Appointment, Patient, ConversationSession, WhatsAppMessage, QueueEntry, StaffProfile, User
from app.security import require_admin, require_superadmin
from app.services.booking import booking_service
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.config import settings

router = APIRouter(prefix="/admin", tags=["Clinic Admin"], dependencies=[Depends(require_admin)])


# ----------------------------------------------------
# Request / Response Schemas
# ----------------------------------------------------

class DoctorCreate(BaseModel):
    staff_id: Optional[int] = None
    name: str
    specialization: str
    available_days: str = "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday"
    start_time: str = "09:00"
    end_time: str = "17:00"
    slot_duration_mins: int = 30
    consultation_fee: Optional[int] = 500
    is_active: bool = True


class DoctorUpdate(BaseModel):
    name: Optional[str] = None
    specialization: Optional[str] = None
    available_days: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    slot_duration_mins: Optional[int] = None
    consultation_fee: Optional[int] = None
    is_active: Optional[bool] = None


class AppointmentStatusUpdate(BaseModel):
    status: str  # CONFIRMED, CANCELLED, COMPLETED


class AppointmentRescheduleRequest(BaseModel):
    appointment_date: str  # YYYY-MM-DD
    start_time: str        # HH:MM
    doctor_id: Optional[int] = None
    notes: Optional[str] = None


class ManualBookingCreate(BaseModel):
    patient_name: str
    patient_phone: str
    aadhaar_number: Optional[str] = None
    address: Optional[str] = None
    gender: Optional[str] = "Unspecified"
    age: Optional[Union[int, str]] = None
    blood_group: Optional[str] = None
    doctor_id: int
    appointment_date: str  # YYYY-MM-DD
    start_time: str        # HH:MM
    notes: Optional[str] = None
    visit_type: Optional[str] = "New Consultation"
    payment_status: Optional[str] = "PAID"
    payment_method: Optional[str] = "UPI"
    paid_amount: Optional[int] = None
    check_in_now: Optional[bool] = False
    cabin: Optional[str] = "Cabin 1"


class SendMessageRequest(BaseModel):
    phone: str
    text: str


class PaymentCollectRequest(BaseModel):
    payment_method: str = "Cash"
    paid_amount: Optional[int] = None


# ----------------------------------------------------
# Statistics & Enterprise Analytics (100% Backend Calculated)
# ----------------------------------------------------

@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")

    # 1. Basic Counts
    total_appts = db.query(Appointment).count()
    today_appts = db.query(Appointment).filter(Appointment.appointment_date == today_str).count()
    confirmed_appts = db.query(Appointment).filter(Appointment.status == "CONFIRMED").count()
    cancelled_appts = db.query(Appointment).filter(Appointment.status == "CANCELLED").count()
    completed_appts = db.query(Appointment).filter(Appointment.status == "COMPLETED").count()

    total_patients = db.query(Patient).count()
    active_doctors = db.query(Doctor).filter(Doctor.is_active == True).count()

    # 2. Percentage Breakdown Calculations
    confirmed_pct = round((confirmed_appts / total_appts * 100), 1) if total_appts > 0 else 0.0
    completed_pct = round((completed_appts / total_appts * 100), 1) if total_appts > 0 else 0.0
    cancelled_pct = round((cancelled_appts / total_appts * 100), 1) if total_appts > 0 else 0.0

    # 3. 7-Day Sparkline Calculations from Real Database Data
    days_range = [(today - datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]

    # Fetch daily appointment counts in one grouped query
    daily_appts_query = (
        db.query(Appointment.appointment_date, func.count(Appointment.id))
        .filter(Appointment.appointment_date.in_(days_range))
        .group_by(Appointment.appointment_date)
        .all()
    )
    daily_appts_map = dict(daily_appts_query)
    sparkline_today = [daily_appts_map.get(d, 0) for d in days_range]

    # Fetch daily confirmed counts
    daily_confirmed_query = (
        db.query(Appointment.appointment_date, func.count(Appointment.id))
        .filter(Appointment.appointment_date.in_(days_range), Appointment.status == "CONFIRMED")
        .group_by(Appointment.appointment_date)
        .all()
    )
    daily_confirmed_map = dict(daily_confirmed_query)
    sparkline_confirmed = [daily_confirmed_map.get(d, 0) for d in days_range]

    # Cumulative patients sparkline
    sparkline_patients = [total_patients] * 7

    # Active doctors sparkline
    sparkline_doctors = [active_doctors] * 7

    # 4. Growth Trends Calculation (This week vs prior week)
    prev_week_start = (today - datetime.timedelta(days=14)).strftime("%Y-%m-%d")
    prev_week_end = (today - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    prior_week_appts = (
        db.query(Appointment)
        .filter(Appointment.appointment_date >= prev_week_start, Appointment.appointment_date < prev_week_end)
        .count()
    )
    current_week_appts = sum(sparkline_today)

    if prior_week_appts > 0:
        growth = round(((current_week_appts - prior_week_appts) / prior_week_appts) * 100, 1)
        trend_appts = f"+{growth}%" if growth >= 0 else f"{growth}%"
    else:
        trend_appts = "+100%" if current_week_appts > 0 else "0%"

    trend_confirmed = "+100%" if confirmed_appts > 0 else "0%"
    trend_patients = "+100%" if total_patients > 0 else "0%"
    trend_doctors = f"{active_doctors} on duty"

    # Recent 5 appointments with pre-formatted strings
    recent = (
        db.query(Appointment)
        .order_by(Appointment.created_at.desc())
        .limit(5)
        .all()
    )

    recent_list = [
        {
            "id": a.id,
            "patient_name": a.patient.name,
            "patient_phone": a.patient.phone,
            "doctor_name": a.doctor.name,
            "specialty": a.doctor.specialization,
            "date": a.appointment_date,
            "start_time": a.start_time,
            "formatted_time": f"{a.start_time} - {a.end_time}",
            "status": a.status,
            "status_theme": "emerald" if a.status == "CONFIRMED" else "blue" if a.status == "COMPLETED" else "rose",
            "source": a.source or "WhatsApp",
            "source_display": "WhatsApp (Meta)" if (a.source or "WhatsApp").lower() == "whatsapp" else "Reception Desk",
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in recent
    ]

    recent_msgs = (
        db.query(WhatsAppMessage)
        .order_by(WhatsAppMessage.created_at.desc())
        .limit(5)
        .all()
    )
    recent_msgs_list = [
        {
            "id": m.id,
            "phone": m.phone,
            "patient_name": m.patient_name,
            "sender": m.sender,
            "message_type": m.message_type,
            "body": m.body[:70] + "..." if len(m.body) > 70 else m.body,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in recent_msgs
    ]

    return {
        "kpis": {
            "today_appointments": {
                "value": today_appts,
                "trend": trend_appts,
                "sparkline": sparkline_today,
            },
            "confirmed_appointments": {
                "value": confirmed_appts,
                "trend": trend_confirmed,
                "sparkline": sparkline_confirmed,
            },
            "registered_patients": {
                "value": total_patients,
                "trend": trend_patients,
                "sparkline": sparkline_patients,
            },
            "active_doctors": {
                "value": active_doctors,
                "trend": trend_doctors,
                "sparkline": sparkline_doctors,
            },
        },
        "breakdown": {
            "confirmed_count": confirmed_appts,
            "confirmed_percent": confirmed_pct,
            "completed_count": completed_appts,
            "completed_percent": completed_pct,
            "cancelled_count": cancelled_appts,
            "cancelled_percent": cancelled_pct,
            "total_appointments": total_appts,
        },
        "recent_appointments": recent_list,
        "recent_messages": recent_msgs_list,
    }


# ----------------------------------------------------
# Appointments Management
# ----------------------------------------------------

@router.get("/appointments")
def list_appointments(
    date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    status: Optional[str] = Query(None, description="OPEN / CONFIRMED / CANCELLED / COMPLETED"),
    doctor_id: Optional[int] = Query(None),
    source: Optional[str] = Query(None, description="Filter by booking source (e.g. WhatsApp, Direct)"),
    search: Optional[str] = Query(None, description="Search patient name or phone"),
    open_only: Optional[bool] = Query(False, description="Filter only open appointments not completed by doctor"),
    clinic_id: Optional[int] = Query(None, description="Filter by clinic branch"),
    db: Session = Depends(get_db),
):
    query = db.query(Appointment)
    if clinic_id:
        query = query.filter(Appointment.clinic_id == clinic_id)
    if date:
        query = query.filter(Appointment.appointment_date == date)
    if status:
        if status.upper() == "OPEN":
            query = query.filter(Appointment.status != "COMPLETED", Appointment.status != "CANCELLED")
        else:
            query = query.filter(Appointment.status == status)
    elif open_only:
        query = query.filter(Appointment.status != "COMPLETED", Appointment.status != "CANCELLED")

    if doctor_id:
        query = query.filter(Appointment.doctor_id == doctor_id)
    if source:
        query = query.filter(Appointment.source.ilike(f"%{source}%"))
    if search:
        search_filter = f"%{search}%"
        query = query.join(Appointment.patient).filter(
            (Patient.name.ilike(search_filter))
            | (Patient.phone.ilike(search_filter))
            | (Patient.patient_uid.ilike(search_filter))
            | (Patient.aadhaar_number.ilike(search_filter))
            | (Appointment.aadhaar_number.ilike(search_filter))
        )

    appts = query.order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc()).all()
    results = []

    # Map active or latest queue entries for instant queue status display
    appt_ids = [a.id for a in appts]
    queue_map = {}
    if appt_ids:
        q_entries = (
            db.query(QueueEntry)
            .filter(QueueEntry.appointment_id.in_(appt_ids))
            .order_by(QueueEntry.id.desc())
            .all()
        )
        for q in q_entries:
            if q.appointment_id not in queue_map:
                queue_map[q.appointment_id] = q

    for a in appts:
        q = queue_map.get(a.id)
        created_ist = (a.created_at + datetime.timedelta(hours=5, minutes=30)) if a.created_at else None
        calc_entry_date = created_ist.strftime("%Y-%m-%d") if created_ist else (a.appointment_date or "—")
        calc_entry_time = getattr(a, "entry_time", None) or (created_ist.strftime("%I:%M %p") if created_ist else "—")

        results.append({
            "id": a.id,
            "clinic_id": a.clinic_id,
            "clinic_name": a.clinic.name if (hasattr(a, "clinic") and a.clinic) else "Main Clinic",
            "patient_id": a.patient.id,
            "patient_uid": getattr(a.patient, "patient_uid", None) or f"PAT-{a.patient.id:04d}",
            "patient_name": a.patient.name,
            "patient_phone": a.patient.phone,
            "gender": getattr(a.patient, "gender", None) or "Unspecified",
            "age": getattr(a.patient, "age", None),
            "blood_group": getattr(a.patient, "blood_group", None) or "—",
            "address": getattr(a.patient, "address", None) or "",
            "consultation_fee": (getattr(a.doctor, "consultation_fee", 500) if (a.doctor and a.doctor.consultation_fee) else 500),
            "paid_amount": getattr(a, "paid_amount", None) if getattr(a, "paid_amount", None) is not None else 0,
            "visit_type": getattr(a, "visit_type", None) or "New Consultation",
            "payment_status": getattr(a, "payment_status", None) or ("PENDING" if a.source == "WhatsApp" else "PAID"),
            "payment_method": getattr(a, "payment_method", None) or ("Pay at Clinic" if a.source == "WhatsApp" else "Cash"),
            "cabin": getattr(a, "cabin", None) or (q.cabin if q else "Cabin 1"),
            "aadhaar_number": a.aadhaar_number or getattr(a.patient, "aadhaar_number", None) or "",
            "doctor_id": a.doctor.id,
            "doctor_name": a.doctor.name,
            "doctor_specialty": a.doctor.specialization,
            "date": a.appointment_date,
            "appointment_date": a.appointment_date,
            "start_time": a.start_time,
            "end_time": a.end_time,
            "formatted_time": f"{a.start_time} - {a.end_time}",
            "entry_date": calc_entry_date,
            "entry_time": calc_entry_time,
            "status": a.status,
            "is_completed": a.status == "COMPLETED",
            "is_open": a.status not in ["COMPLETED", "CANCELLED"],
            "status_theme": "emerald" if a.status == "CONFIRMED" else "blue" if a.status == "COMPLETED" else "rose",
            "source": a.source or "Direct",
            "source_display": "WhatsApp" if (a.source or "").lower() == "whatsapp" else "Direct",
            "notes": a.notes,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "queue_token": q.token_number if q else None,
            "queue_status": q.status if q else None,
            "queue_cabin": q.cabin if q else (getattr(a, "cabin", None) or "Cabin 1"),
        })

    # Sort appointments according to arrival and proximity to current check-in time:
    # 1. Today's appointments whose arrival slot has arrived or passed (start_time <= current_time) -> ON TOP, sorted by arrival time ASC
    # 2. Today's upcoming appointments -> chronological arrival order
    # 3. Past open appointments (overdue backlog) -> most recent past date first, then arrival time
    # 4. Future dates (tomorrow and beyond) -> chronological date order, then arrival time
    now_ist = datetime.datetime.now()
    today_str = now_ist.strftime("%Y-%m-%d")
    now_time_str = now_ist.strftime("%H:%M")

    def appointment_sort_key(item):
        d = item.get("appointment_date") or ""
        t = item.get("start_time") or ""
        if d == today_str:
            priority = 0 if t <= now_time_str else 1
            return (priority, 0, t)
        elif d < today_str:
            try:
                date_num = -int(d.replace("-", ""))
            except Exception:
                date_num = 0
            return (2, date_num, t)
        else:
            try:
                date_num = int(d.replace("-", ""))
            except Exception:
                date_num = 0
            return (3, date_num, t)

    results.sort(key=appointment_sort_key)
    return {"total": len(results), "appointments": results}


@router.post("/appointments")
def create_manual_appointment(payload: ManualBookingCreate, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == payload.doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    now = datetime.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    current_time_str = now.strftime("%H:%M")

    if payload.appointment_date < today_str:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot book an appointment for a past date ({payload.appointment_date}). Please choose today or a future date.",
        )

    # If booking is for an immediate walk-in / check-in, allow current slot
    is_walkin = bool(payload.check_in_now)

    if payload.appointment_date == today_str and payload.start_time <= current_time_str and not is_walkin:
        raise HTTPException(
            status_code=400,
            detail=f"Time slot {payload.start_time} has already passed for today. Please select an upcoming slot.",
        )

    # Check slot availability for advance scheduled appointments
    if not is_walkin:
        available_slots = booking_service.get_available_slots(db, payload.doctor_id, payload.appointment_date)
        if payload.start_time not in available_slots:
            raise HTTPException(
                status_code=400,
                detail=f"Time slot {payload.start_time} on {payload.appointment_date} is not available, already booked, or has passed.",
            )

    appointment = booking_service.book_appointment(
        db=db,
        phone=payload.patient_phone,
        patient_name=payload.patient_name,
        doctor_id=payload.doctor_id,
        date_str=payload.appointment_date,
        start_time=payload.start_time,
        source="Direct",
        notes=payload.notes,
        aadhaar_number=payload.aadhaar_number,
        address=payload.address,
        gender=payload.gender,
        age=payload.age,
        blood_group=payload.blood_group,
        visit_type=payload.visit_type or "New Consultation",
        payment_status=payload.payment_status or "PAID",
        payment_method=payload.payment_method or "UPI",
        paid_amount=payload.paid_amount,
        cabin=payload.cabin or "Cabin 1",
        skip_slot_check=is_walkin,
    )

    if not appointment:
        raise HTTPException(status_code=400, detail="Could not book appointment")

    if payload.notes:
        appointment.notes = payload.notes
        db.commit()

    token_number = None
    token_display = None
    if payload.check_in_now:
        today_real = datetime.date.today().strftime("%Y-%m-%d")
        # Only issue token immediately if appointment is scheduled for today
        if appointment.appointment_date == today_real:
            highest = (
                db.query(QueueEntry)
                .filter(QueueEntry.queue_date == today_real)
                .order_by(QueueEntry.token_number.desc())
                .first()
            )
            next_token = (highest.token_number + 1) if highest else 1
            q_entry = QueueEntry(
                appointment_id=appointment.id,
                token_number=next_token,
                queue_date=today_real,
                cabin=payload.cabin or "Cabin 1",
                status="WAITING",
                created_at=datetime.datetime.utcnow(),
            )
            db.add(q_entry)
            db.commit()
            token_number = next_token
            token_display = f"#{next_token:02d}"

    return {
        "message": (
            f"Appointment booked and checked in! Token {token_display} assigned."
            if token_display
            else "Appointment booked successfully"
        ),
        "appointment_id": appointment.id,
        "patient_id": appointment.patient_id,
        "token_number": token_number,
        "token_display": token_display,
        "visit_type": appointment.visit_type,
        "payment_status": appointment.payment_status,
        "payment_method": appointment.payment_method,
        "paid_amount": appointment.paid_amount,
        "cabin": appointment.cabin,
    }


@router.put("/appointments/{appointment_id}/status")
def update_appointment_status(
    appointment_id: int, payload: AppointmentStatusUpdate, db: Session = Depends(get_db)
):
    valid_statuses = ["CONFIRMED", "CANCELLED", "COMPLETED"]
    status_upper = payload.status.upper()
    if status_upper not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid_statuses}")

    appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appt.status = status_upper

    # Bi-directional sync with active QueueEntry
    q_entries = (
        db.query(QueueEntry)
        .filter(
            QueueEntry.appointment_id == appt.id,
            QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
        )
        .all()
    )
    for q in q_entries:
        if status_upper == "COMPLETED":
            q.status = "COMPLETED"
        elif status_upper == "CANCELLED":
            q.status = "SKIPPED"

    db.commit()
    return {"message": "Status updated successfully", "status": appt.status}


@router.put("/appointments/{appointment_id}/collect-payment")
def collect_appointment_payment(
    appointment_id: int, payload: PaymentCollectRequest, db: Session = Depends(get_db)
):
    appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    doctor = db.query(Doctor).filter(Doctor.id == appt.doctor_id).first()
    doc_fee = doctor.consultation_fee if (doctor and doctor.consultation_fee is not None) else 500
    fee = payload.paid_amount if payload.paid_amount is not None else doc_fee

    appt.payment_status = "PAID"
    appt.payment_method = payload.payment_method or "Cash"
    appt.paid_amount = fee

    db.commit()
    db.refresh(appt)
    return {
        "message": f"Payment of INR {fee} collected successfully via {appt.payment_method}",
        "appointment_id": appt.id,
        "payment_status": appt.payment_status,
        "payment_method": appt.payment_method,
        "paid_amount": appt.paid_amount,
    }


@router.put("/appointments/{appointment_id}/reschedule")
def reschedule_appointment(
    appointment_id: int, payload: AppointmentRescheduleRequest, db: Session = Depends(get_db)
):
    try:
        updated = booking_service.reschedule_appointment(
            db,
            appointment_id=appointment_id,
            date_str=payload.appointment_date,
            start_time=payload.start_time,
            doctor_id=payload.doctor_id,
            notes=payload.notes,
        )
        return {
            "message": f"Appointment successfully rescheduled to {updated.appointment_date} at {updated.start_time}",
            "appointment_id": updated.id,
            "appointment_date": updated.appointment_date,
            "start_time": updated.start_time,
            "end_time": updated.end_time,
            "doctor_id": updated.doctor_id,
            "doctor_name": updated.doctor.name if updated.doctor else "",
            "status": updated.status,
            "notes": updated.notes,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reschedule appointment: {str(e)}")


# ----------------------------------------------------
# Doctors Management (With Calculated Capacity)
# ----------------------------------------------------

@router.get("/doctors/stats")
def get_doctor_stats(db: Session = Depends(get_db)):
    """Provides server-aggregated KPI metrics for clinical specialists and scheduling."""
    total_specialists = db.query(Doctor).count()
    active_specialists = db.query(Doctor).filter(Doctor.is_active == True).count()
    total_bookings = db.query(Appointment).filter(Appointment.status == "CONFIRMED").count()
    avg_slot = db.query(func.avg(Doctor.slot_duration_mins)).scalar() or 15

    return {
        "total_specialists": total_specialists,
        "active_specialists": active_specialists,
        "total_bookings": total_bookings,
        "avg_slot_duration": round(avg_slot),
    }


@router.get("/doctors/options")
def get_doctor_options():
    """Provides master configuration options for specialties and appointment slot durations."""
    return {
        "specializations": [
            "ALL",
            "Dentist",
            "General Physician",
            "Pediatrician",
            "Cardiologist",
            "Dermatologist",
            "Orthopedic",
            "Gynecologist",
            "ENT Specialist",
        ],
        "slot_durations": [10, 15, 20, 30, 45, 60],
        "statuses": ["ALL", "ACTIVE", "INACTIVE"],
    }


@router.get("/doctors")
def list_doctors(
    include_inactive: bool = True,
    search: Optional[str] = None,
    specialization: Optional[str] = None,
    status: Optional[str] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Auto-synchronize registered Staff Doctors from Staff Directory into Doctor schedule table
    try:
        staff_doctors = db.query(StaffProfile).filter(
            StaffProfile.employment_status == "ACTIVE",
            StaffProfile.role_category.ilike("%Doctor%")
        ).all()
        for sd in staff_doctors:
            clean_name = sd.full_name.strip()
            stripped_name = clean_name.replace("Dr. ", "").replace("Dr.", "").strip()
            doc_record = db.query(Doctor).filter(
                (Doctor.name == clean_name) | (Doctor.name == stripped_name) | (Doctor.name.ilike(f"%{stripped_name}%"))
            ).first()
            if not doc_record:
                new_doc = Doctor(
                    name=clean_name,
                    specialization=sd.department or "General Medicine",
                    available_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday",
                    start_time="09:00",
                    end_time="18:00",
                    slot_duration_mins=20,
                    is_active=True
                )
                db.add(new_doc)
                db.commit()
    except Exception as e:
        logger.warning(f"Error synchronizing staff doctors: {e}")

    query = db.query(Doctor)
    if status == "ACTIVE":
        query = query.filter(Doctor.is_active == True)
    elif status == "INACTIVE":
        query = query.filter(Doctor.is_active == False)
    elif not include_inactive:
        query = query.filter(Doctor.is_active == True)

    if specialization and specialization != "ALL":
        query = query.filter(Doctor.specialization.ilike(f"%{specialization.strip()}%"))

    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (Doctor.name.ilike(s))
            | (Doctor.specialization.ilike(s))
            | (Doctor.available_days.ilike(s))
        )

    doctors = query.order_by(Doctor.name.asc()).all()

    results = []
    for doc in doctors:
        # Pre-calculated aggregations
        days_list = [d.strip() for d in (doc.available_days or "").split(",") if d.strip()]
        days_short = [d[:3] for d in days_list]
        total_booked = (
            db.query(Appointment)
            .filter(Appointment.doctor_id == doc.id, Appointment.status == "CONFIRMED")
            .count()
        )

        is_available_on_date = True
        if date:
            try:
                date_obj = datetime.datetime.strptime(date, "%Y-%m-%d")
                day_name = date_obj.strftime("%A").lower()
                doc_days = [d.strip().lower() for d in days_list]
                if doc_days and day_name not in doc_days:
                    is_available_on_date = False
            except Exception:
                pass

        results.append({
            "id": doc.id,
            "name": doc.name,
            "specialization": doc.specialization,
            "specialty": doc.specialization,
            "department": doc.specialization,
            "consultation_fee": doc.consultation_fee if getattr(doc, "consultation_fee", None) is not None else 500,
            "available_days": doc.available_days,
            "available_days_short": days_short,
            "start_time": doc.start_time,
            "end_time": doc.end_time,
            "working_hours_display": f"{doc.start_time} - {doc.end_time}",
            "slot_duration_mins": doc.slot_duration_mins,
            "duration_display": f"{doc.slot_duration_mins} mins",
            "is_active": doc.is_active,
            "is_available_on_date": is_available_on_date,
            "total_confirmed_bookings": total_booked,
        })
    return results


@router.get("/doctors/eligible-staff")
def get_eligible_staff_for_doctors(db: Session = Depends(get_db)):
    """Fetches registered staff members from Staff Directory who can be configured as specialists."""
    staff_members = (
        db.query(StaffProfile)
        .filter(StaffProfile.employment_status == "ACTIVE")
        .order_by(StaffProfile.full_name.asc())
        .all()
    )
    existing_docs = {d.name.strip().lower() for d in db.query(Doctor).all()}
    
    results = []
    for s in staff_members:
        results.append({
            "id": s.id,
            "staff_uid": s.staff_uid,
            "full_name": s.full_name,
            "role_category": s.role_category,
            "department": s.department,
            "designation": s.designation,
            "contact_phone": s.contact_phone,
            "is_doctor_role": (s.role_category or "").lower() == "doctor",
            "is_already_specialist": s.full_name.strip().lower() in existing_docs,
        })
    return results


@router.post("/doctors")
def create_doctor(payload: DoctorCreate, db: Session = Depends(get_db)):
    staff = None
    if payload.staff_id:
        staff = db.query(StaffProfile).filter(StaffProfile.id == payload.staff_id).first()
    if not staff and payload.name:
        staff = db.query(StaffProfile).filter(StaffProfile.full_name == payload.name.strip()).first()

    if not staff:
        raise HTTPException(
            status_code=400,
            detail=f"Specialist '{payload.name}' must first be registered in the Staff Directory. Please register this doctor in Staff & Duty Scheduling first."
        )

    # Check if a doctor schedule already exists with this name
    existing_doc = db.query(Doctor).filter(Doctor.name == staff.full_name).first()
    if existing_doc:
        existing_doc.specialization = payload.specialization or staff.department or "General OPD"
        existing_doc.available_days = payload.available_days
        existing_doc.start_time = payload.start_time
        existing_doc.end_time = payload.end_time
        existing_doc.slot_duration_mins = payload.slot_duration_mins
        if payload.consultation_fee is not None:
            existing_doc.consultation_fee = payload.consultation_fee
        existing_doc.is_active = payload.is_active
        db.commit()
        db.refresh(existing_doc)
        return {"message": f"Specialist schedule for {existing_doc.name} updated successfully", "doctor": existing_doc}

    doctor = Doctor(
        name=staff.full_name,
        specialization=payload.specialization or staff.department or "General OPD",
        available_days=payload.available_days,
        start_time=payload.start_time,
        end_time=payload.end_time,
        slot_duration_mins=payload.slot_duration_mins,
        consultation_fee=payload.consultation_fee if payload.consultation_fee is not None else 500,
        is_active=payload.is_active,
    )
    db.add(doctor)
    db.commit()
    db.refresh(doctor)
    return {"message": "Specialist configured successfully from Staff Directory", "doctor": doctor}


@router.put("/doctors/{doctor_id}")
def update_doctor(doctor_id: int, payload: DoctorUpdate, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    old_name = doctor.name
    update_data = payload.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(doctor, key, value)

    # Sync back with StaffProfile if exists
    if "name" in update_data or "specialization" in update_data or "is_active" in update_data:
        staff = db.query(StaffProfile).filter(
            (StaffProfile.full_name == old_name) | (StaffProfile.full_name == doctor.name)
        ).first()
        if staff:
            if "name" in update_data and update_data["name"]:
                staff.full_name = update_data["name"].strip()
            if "specialization" in update_data and update_data["specialization"]:
                staff.department = update_data["specialization"].strip()
            if "is_active" in update_data and update_data["is_active"] is not None:
                staff.employment_status = "ACTIVE" if update_data["is_active"] else "INACTIVE"

    db.commit()
    db.refresh(doctor)
    return {"message": "Doctor updated successfully", "doctor": doctor}


@router.delete("/doctors/{doctor_id}")
def toggle_or_delete_doctor(doctor_id: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    doctor.is_active = not doctor.is_active
    db.commit()
    return {
        "message": f"Doctor {'activated' if doctor.is_active else 'deactivated'} successfully",
        "is_active": doctor.is_active,
    }


@router.get("/doctors/{doctor_id}/slots")
def get_doctor_slots(doctor_id: int, date: str, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    slots = booking_service.get_available_slots(db, doctor_id, date)
    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor.name,
        "date": date,
        "total_available_slots": len(slots),
        "available_slots": slots,
    }


# ----------------------------------------------------
# Settings & Status
# ----------------------------------------------------

class SettingsUpdateRequest(BaseModel):
    whatsapp_token: Optional[str] = None
    phone_number_id: Optional[str] = None
    verify_token: Optional[str] = None
    clinic_name: Optional[str] = None
    clinic_tagline: Optional[str] = None
    clinic_reg_no: Optional[str] = None
    clinic_address: Optional[str] = None
    clinic_phone: Optional[str] = None
    clinic_email: Optional[str] = None
    clinic_hours: Optional[str] = None
    opd_slot_duration: Optional[int] = None
    checkin_grace_period: Optional[int] = None
    emergency_tat: Optional[int] = None
    lab_tat_standard: Optional[int] = None
    followup_days: Optional[int] = None


ALLOWED_ENV_SETTINGS = {
    "WHATSAPP_TOKEN",
    "PHONE_NUMBER_ID",
    "VERIFY_TOKEN",
    "CLINIC_NAME",
    "CLINIC_TAGLINE",
    "CLINIC_REG_NO",
    "CLINIC_ADDRESS",
    "CLINIC_PHONE",
    "CLINIC_EMAIL",
    "CLINIC_HOURS",
    "OPD_SLOT_DURATION",
    "CHECKIN_GRACE_PERIOD",
    "EMERGENCY_TAT",
    "LAB_TAT_STANDARD",
    "FOLLOWUP_DAYS",
}


def update_env_variable(key: str, value: str):
    import os
    if key not in ALLOWED_ENV_SETTINGS:
        return
    # Sanitize value against newline or control character injection
    clean_value = str(value).replace("\r", "").replace("\n", "").replace("\0", "").strip()
    env_path = ".env"
    try:
        lines = []
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        found = False
        new_lines = []
        for line in lines:
            if line.strip().startswith(f"{key}="):
                new_lines.append(f"{key}={clean_value}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{key}={clean_value}\n")
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"Warning: could not update .env: {e}")


@router.get("/settings")
def get_system_settings():
    is_meta_configured = bool(
        settings.WHATSAPP_TOKEN
        and not settings.WHATSAPP_TOKEN.startswith("YOUR_")
        and not settings.WHATSAPP_TOKEN.startswith("your_")
        and settings.PHONE_NUMBER_ID
        and not settings.PHONE_NUMBER_ID.startswith("YOUR_")
        and not settings.PHONE_NUMBER_ID.startswith("your_")
    )

    is_gemini_configured = bool(
        settings.GEMINI_API_KEY
        and not settings.GEMINI_API_KEY.startswith("your_")
    )

    masked_token = ""
    if settings.WHATSAPP_TOKEN and not settings.WHATSAPP_TOKEN.startswith("YOUR_"):
        masked_token = (
            settings.WHATSAPP_TOKEN[:8] + "••••••••" + settings.WHATSAPP_TOKEN[-6:]
            if len(settings.WHATSAPP_TOKEN) > 16
            else "••••••••"
        )

    return {
        "clinic_name": settings.CLINIC_NAME,
        "clinic_tagline": getattr(settings, "CLINIC_TAGLINE", "Medical Center & OPD Consultation Services"),
        "clinic_reg_no": getattr(settings, "CLINIC_REG_NO", "UP-AGR-2026-MED"),
        "clinic_address": settings.CLINIC_ADDRESS,
        "clinic_phone": settings.CLINIC_PHONE,
        "clinic_email": getattr(settings, "CLINIC_EMAIL", "contact@aerostateclinic.com"),
        "clinic_hours": settings.CLINIC_HOURS,
        "opd_slot_duration": int(getattr(settings, "OPD_SLOT_DURATION", 15)),
        "checkin_grace_period": int(getattr(settings, "CHECKIN_GRACE_PERIOD", 15)),
        "emergency_tat": int(getattr(settings, "EMERGENCY_TAT", 30)),
        "lab_tat_standard": int(getattr(settings, "LAB_TAT_STANDARD", 24)),
        "followup_days": int(getattr(settings, "FOLLOWUP_DAYS", 7)),
        "whatsapp_token": masked_token,
        "phone_number_id": settings.PHONE_NUMBER_ID,
        "verify_token": settings.VERIFY_TOKEN,
        "meta_graph_version": settings.META_GRAPH_VERSION,
        "meta_configured": is_meta_configured,
        "gemini_ai_configured": is_gemini_configured,
        "database_url": settings.DATABASE_URL.split("///")[-1],
    }


@router.put("/settings")
def update_system_settings(payload: SettingsUpdateRequest):
    """Updates Meta credentials and clinic info both in runtime memory and in .env."""
    if payload.whatsapp_token and payload.whatsapp_token.strip():
        token = payload.whatsapp_token.strip()
        settings.WHATSAPP_TOKEN = token
        update_env_variable("WHATSAPP_TOKEN", token)

    if payload.phone_number_id and payload.phone_number_id.strip():
        phone_id = payload.phone_number_id.strip()
        settings.PHONE_NUMBER_ID = phone_id
        update_env_variable("PHONE_NUMBER_ID", phone_id)

    if payload.verify_token and payload.verify_token.strip():
        v_token = payload.verify_token.strip()
        settings.VERIFY_TOKEN = v_token
        update_env_variable("VERIFY_TOKEN", v_token)

    if payload.clinic_name and payload.clinic_name.strip():
        settings.CLINIC_NAME = payload.clinic_name.strip()
        update_env_variable("CLINIC_NAME", settings.CLINIC_NAME)

    if payload.clinic_tagline is not None:
        settings.CLINIC_TAGLINE = payload.clinic_tagline.strip()
        update_env_variable("CLINIC_TAGLINE", settings.CLINIC_TAGLINE)

    if payload.clinic_reg_no is not None:
        settings.CLINIC_REG_NO = payload.clinic_reg_no.strip()
        update_env_variable("CLINIC_REG_NO", settings.CLINIC_REG_NO)

    if payload.clinic_address and payload.clinic_address.strip():
        settings.CLINIC_ADDRESS = payload.clinic_address.strip()
        update_env_variable("CLINIC_ADDRESS", settings.CLINIC_ADDRESS)

    if payload.clinic_phone and payload.clinic_phone.strip():
        settings.CLINIC_PHONE = payload.clinic_phone.strip()
        update_env_variable("CLINIC_PHONE", settings.CLINIC_PHONE)

    if payload.clinic_email is not None:
        settings.CLINIC_EMAIL = payload.clinic_email.strip()
        update_env_variable("CLINIC_EMAIL", settings.CLINIC_EMAIL)

    if payload.clinic_hours and payload.clinic_hours.strip():
        settings.CLINIC_HOURS = payload.clinic_hours.strip()
        update_env_variable("CLINIC_HOURS", settings.CLINIC_HOURS)

    if payload.opd_slot_duration is not None:
        settings.OPD_SLOT_DURATION = int(payload.opd_slot_duration)
        update_env_variable("OPD_SLOT_DURATION", str(settings.OPD_SLOT_DURATION))

    if payload.checkin_grace_period is not None:
        settings.CHECKIN_GRACE_PERIOD = int(payload.checkin_grace_period)
        update_env_variable("CHECKIN_GRACE_PERIOD", str(settings.CHECKIN_GRACE_PERIOD))

    if payload.emergency_tat is not None:
        settings.EMERGENCY_TAT = int(payload.emergency_tat)
        update_env_variable("EMERGENCY_TAT", str(settings.EMERGENCY_TAT))

    if payload.lab_tat_standard is not None:
        settings.LAB_TAT_STANDARD = int(payload.lab_tat_standard)
        update_env_variable("LAB_TAT_STANDARD", str(settings.LAB_TAT_STANDARD))

    if payload.followup_days is not None:
        settings.FOLLOWUP_DAYS = int(payload.followup_days)
        update_env_variable("FOLLOWUP_DAYS", str(settings.FOLLOWUP_DAYS))

    return {"message": "Settings updated successfully", "status": "ok"}


@router.post("/settings/test-meta")
async def test_meta_connection():
    """Live connectivity verification with Meta WhatsApp Cloud API."""
    return await whatsapp_client.test_connection()


# ----------------------------------------------------
# WhatsApp Live Inbox & Messaging Endpoints
# ----------------------------------------------------

@router.get("/messages/stats")
def get_whatsapp_stats(db: Session = Depends(get_db)):
    """Returns backend-calculated metrics for WhatsApp messaging activity."""
    return message_service.get_whatsapp_stats(db)


@router.get("/messages/templates")
def get_quick_reply_templates():
    """Returns pre-defined clinical quick reply templates."""
    return message_service.get_reply_templates()


@router.get("/messages")
def get_conversation_threads(search: Optional[str] = None, db: Session = Depends(get_db)):
    """Returns all patient WhatsApp conversation threads with latest messages and active bookings."""
    return message_service.get_conversation_threads(db, search=search)


@router.get("/messages/{phone}")
def get_patient_messages(phone: str, db: Session = Depends(get_db)):
    """Returns the full chronological message log for a given phone number."""
    return message_service.get_messages_for_phone(db, phone)


@router.post("/messages/send")
async def send_clinic_message(payload: SendMessageRequest, db: Session = Depends(get_db)):
    """Sends a manual WhatsApp reply to a patient directly from the clinic dashboard."""
    if not payload.phone or not payload.text.strip():
        raise HTTPException(status_code=400, detail="Phone and text are required")
    res = await message_service.send_manual_reply(db, payload.phone, payload.text)
    return res


# ----------------------------------------------------
# Administrative Database Maintenance & Backup
# ----------------------------------------------------

@router.post("/database/backup", dependencies=[Depends(require_superadmin)])
def trigger_database_backup():
    """Triggers an online, atomic backup of the clinic database."""
    try:
        from backup_db import perform_database_backup
        result = perform_database_backup()
        return {"message": "Database backup completed successfully.", "backup": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database backup failed: {str(e)}")
