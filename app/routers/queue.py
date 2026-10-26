import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models import QueueEntry, Appointment, Patient, Doctor, Cabin
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.config import settings
from app.security import require_admin

router = APIRouter(prefix="/admin/queue", tags=["Waiting Room & Patient Queue"], dependencies=[Depends(require_admin)])


class CabinCreate(BaseModel):
    name: str
    code: Optional[str] = None
    department: Optional[str] = "General Consultation"
    floor: Optional[str] = "Ground Floor"
    is_active: bool = True


class CabinEdit(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    department: Optional[str] = None
    floor: Optional[str] = None
    is_active: Optional[bool] = None


class CheckInRequest(BaseModel):
    appointment_id: int
    cabin: Optional[str] = "Cabin 1"


class QueueStatusUpdate(BaseModel):
    status: str  # WAITING, CALLED, IN_CONSULTATION, COMPLETED, SKIPPED
    cabin: Optional[str] = None


class CabinUpdate(BaseModel):
    cabin: Optional[str] = "Cabin 1"
    doctor_id: Optional[int] = None


def ensure_default_cabins(db: Session):
    """Initializes standard consultation cabins if none exist yet in the clinic database."""
    if db.query(Cabin).count() == 0:
        defaults = [
            {"name": "Cabin 1", "code": "CAB-01", "department": "General Consultation", "floor": "Ground Floor"},
            {"name": "Cabin 2", "code": "CAB-02", "department": "Specialist Clinic", "floor": "Ground Floor"},
            {"name": "Cabin 3", "code": "CAB-03", "department": "Dental Operatory", "floor": "1st Floor"},
            {"name": "Procedure Room", "code": "PROC-01", "department": "Minor Procedures", "floor": "Ground Floor"},
        ]
        for d in defaults:
            db.add(Cabin(**d))
        db.commit()


@router.get("/cabins")
def list_cabins(include_inactive: bool = False, db: Session = Depends(get_db)):
    """
    Returns configured clinic cabins with real-time backend calculations:
    - Current occupancy status (WAITING / IN_CONSULTATION / AVAILABLE)
    - Active patient name & token
    - Consultations completed today
    """
    ensure_default_cabins(db)
    query = db.query(Cabin)
    if not include_inactive:
        query = query.filter(Cabin.is_active == True)
    cabins = query.order_by(Cabin.name.asc()).all()

    today_str = datetime.date.today().strftime("%Y-%m-%d")
    results = []
    for c in cabins:
        active_entry = (
            db.query(QueueEntry)
            .filter(
                QueueEntry.queue_date == today_str,
                QueueEntry.cabin == c.name,
                QueueEntry.status.in_(["CALLED", "IN_CONSULTATION"]),
            )
            .first()
        )

        completed_count = (
            db.query(QueueEntry)
            .filter(
                QueueEntry.queue_date == today_str,
                QueueEntry.cabin == c.name,
                QueueEntry.status == "COMPLETED",
            )
            .count()
        )

        curr_patient = None
        curr_token = None
        curr_status = "AVAILABLE"
        if active_entry:
            curr_status = active_entry.status
            curr_token = active_entry.token_number
            if active_entry.appointment and active_entry.appointment.patient:
                curr_patient = active_entry.appointment.patient.name

        display_label = f"{c.name} ({c.department})" if c.department else c.name

        results.append({
            "id": c.id,
            "name": c.name,
            "code": c.code,
            "department": c.department or "General Consultation",
            "floor": c.floor or "Ground Floor",
            "is_active": c.is_active,
            "display_label": display_label,
            "occupancy_status": curr_status,
            "is_occupied": active_entry is not None,
            "current_patient": curr_patient,
            "current_token": curr_token,
            "today_completed": completed_count,
        })

    return results


@router.post("/cabins")
def create_cabin(payload: CabinCreate, db: Session = Depends(get_db)):
    """Allows clinic administrator to add new cabins dynamically without hardcoding."""
    name_clean = payload.name.strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Cabin name is required")

    existing = db.query(Cabin).filter(Cabin.name.ilike(name_clean)).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"A cabin named '{name_clean}' already exists.")

    code = payload.code.strip().upper() if payload.code else None
    if not code:
        count = db.query(Cabin).count() + 1
        code = f"CAB-{count:02d}"

    cabin = Cabin(
        name=name_clean,
        code=code,
        department=payload.department.strip() if payload.department else "General Consultation",
        floor=payload.floor.strip() if payload.floor else "Ground Floor",
        is_active=payload.is_active,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(cabin)
    db.commit()
    db.refresh(cabin)

    return {
        "message": f"Cabin '{cabin.name}' created successfully",
        "cabin": {
            "id": cabin.id,
            "name": cabin.name,
            "code": cabin.code,
            "department": cabin.department,
            "display_label": f"{cabin.name} ({cabin.department})" if cabin.department else cabin.name,
        },
    }


@router.put("/cabins/{cabin_id}")
def update_cabin(cabin_id: int, payload: CabinEdit, db: Session = Depends(get_db)):
    cabin = db.query(Cabin).filter(Cabin.id == cabin_id).first()
    if not cabin:
        raise HTTPException(status_code=404, detail="Cabin not found")

    if payload.name:
        cabin.name = payload.name.strip()
    if payload.code:
        cabin.code = payload.code.strip().upper()
    if payload.department:
        cabin.department = payload.department.strip()
    if payload.floor:
        cabin.floor = payload.floor.strip()
    if payload.is_active is not None:
        cabin.is_active = payload.is_active

    db.commit()
    db.refresh(cabin)
    return {"message": "Cabin updated successfully", "id": cabin.id}


@router.delete("/cabins/{cabin_id}")
def delete_cabin(cabin_id: int, db: Session = Depends(get_db)):
    cabin = db.query(Cabin).filter(Cabin.id == cabin_id).first()
    if not cabin:
        raise HTTPException(status_code=404, detail="Cabin not found")

    cabin.is_active = not cabin.is_active
    db.commit()
    return {
        "message": f"Cabin '{cabin.name}' {'activated' if cabin.is_active else 'deactivated'} successfully",
        "is_active": cabin.is_active,
    }


@router.get("/options")
def get_queue_options(db: Session = Depends(get_db)):
    """Provides dynamic queue options including database-persisted cabins."""
    ensure_default_cabins(db)
    active_cabins = db.query(Cabin).filter(Cabin.is_active == True).order_by(Cabin.name.asc()).all()
    return {
        "cabins": [
            {
                "id": c.id,
                "name": c.name,
                "code": c.code,
                "department": c.department,
                "display_label": f"{c.name} ({c.department})" if c.department else c.name,
            }
            for c in active_cabins
        ],
        "statuses": ["ALL", "WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "SKIPPED"],
    }


async def _send_turn_whatsapp(entry: QueueEntry, cabin: str, db: Session, reminder: bool = False) -> bool:
    appt = entry.appointment
    if not appt or not appt.patient or not appt.patient.phone:
        return False

    title = "🔔 *REMINDER: YOUR TURN*" if reminder else "🔔 *IT'S YOUR TURN!*"
    alert_text = (
        f"{title} (Token #{entry.token_number:02d})\n\n"
        f"Hello *{appt.patient.name}*,\n"
        f"Dr. *{appt.doctor.name}* is ready for your consultation in *{cabin}*.\n\n"
        f"Please proceed inside the cabin now.\n"
        f"🏥 *{settings.CLINIC_NAME}*"
    )
    try:
        await whatsapp_client.send_text(to=appt.patient.phone, text=alert_text)
        message_service.log_message(
            db=db,
            phone=appt.patient.phone,
            sender="clinic",
            body=alert_text,
            patient_name=appt.patient.name,
            message_type="queue_alert",
        )
        return True
    except Exception as e:
        print("Failed to dispatch WhatsApp queue call alert:", e)
        return False


def sync_and_clean_stale_queue(db: Session, today_str: str):
    """
    Auto-cleans ghost queue tokens and synchronizes appointments with queue entries:
    1. Past-date stale entries (queue_date < today_str) left in WAITING/CALLED/IN_CONSULTATION
       are marked COMPLETED (if linked appointment was completed) or SKIPPED.
    2. Today's entries are synchronized with their linked appointment status.
    """
    changed = False

    # 1. Past-date stale entries
    past_stale = (
        db.query(QueueEntry)
        .filter(
            QueueEntry.queue_date < today_str,
            QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
        )
        .all()
    )
    for q in past_stale:
        if q.appointment and q.appointment.status == "COMPLETED":
            q.status = "COMPLETED"
        else:
            q.status = "SKIPPED"
        changed = True

    # 2. Today's entries linked to appointments that are COMPLETED or CANCELLED
    today_active = (
        db.query(QueueEntry)
        .filter(
            QueueEntry.queue_date == today_str,
            QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
        )
        .all()
    )
    for q in today_active:
        if q.appointment:
            if q.appointment.status == "COMPLETED":
                q.status = "COMPLETED"
                changed = True
            elif q.appointment.status == "CANCELLED":
                q.status = "SKIPPED"
                changed = True

    if changed:
        db.commit()


@router.get("")
def get_today_queue(
    date: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    doctor_id: Optional[int] = None,
    cabin: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Returns today's live waiting room tokens and queue entries.
    Supports filtering by doctor_id (Doctor Cabin Mode) or cabin,
    and calculates scoped KPIs and next_waiting dynamically.
    """
    today_str = date or datetime.date.today().strftime("%Y-%m-%d")

    # Run auto-cleanup and sync
    sync_and_clean_stale_queue(db, today_str)

    query = (
        db.query(QueueEntry)
        .filter(QueueEntry.queue_date == today_str)
    )

    if doctor_id:
        query = query.join(Appointment).filter(Appointment.doctor_id == doctor_id)

    if cabin and cabin.strip():
        query = query.filter(QueueEntry.cabin == cabin.strip())

    all_entries = query.order_by(QueueEntry.token_number.asc()).all()

    now = datetime.datetime.utcnow()

    # Pre-calculate counts and waiting queue state
    waiting_entries = [q for q in all_entries if q.status == "WAITING"]
    waiting_count = len(waiting_entries)
    in_consult = sum(1 for q in all_entries if q.status in ["CALLED", "IN_CONSULTATION"])
    completed_count = sum(1 for q in all_entries if q.status == "COMPLETED")
    has_waiting = waiting_count > 0

    next_waiting_obj = None
    if waiting_entries:
        first_wait = waiting_entries[0]
        p_name = (
            first_wait.appointment.patient.name
            if (first_wait.appointment and first_wait.appointment.patient)
            else "Patient"
        )
        next_waiting_obj = {
            "id": first_wait.id,
            "token_number": first_wait.token_number,
            "token_display": f"#{first_wait.token_number:02d}",
            "patient_name": p_name,
            "cabin": first_wait.cabin or "Cabin 1",
            "doctor_name": first_wait.appointment.doctor.name if (first_wait.appointment and first_wait.appointment.doctor) else "Doctor",
            "doctor_id": first_wait.appointment.doctor_id if first_wait.appointment else None,
        }

    # Filter by status and search if requested
    filtered_entries = all_entries
    if status and status.upper() != "ALL":
        filtered_entries = [q for q in filtered_entries if q.status == status.upper()]

    if search and search.strip():
        s = search.strip().lower()
        def matches_search(q: QueueEntry):
            appt = q.appointment
            p = appt.patient if appt else None
            d = appt.doctor if appt else None
            token_str = f"#{q.token_number:02d}"
            if s in str(q.token_number) or s in token_str.lower():
                return True
            if p and (s in (p.name or "").lower() or s in (p.phone or "").lower() or s in (p.patient_uid or "").lower()):
                return True
            if d and (s in (d.name or "").lower() or s in (d.specialization or "").lower()):
                return True
            if q.cabin and s in q.cabin.lower():
                return True
            return False

        filtered_entries = [q for q in filtered_entries if matches_search(q)]

    results = []
    for q in filtered_entries:
        appt = q.appointment
        patient = appt.patient if appt else None
        doctor = appt.doctor if appt else None

        wait_mins = 0
        if q.created_at:
            delta = now - q.created_at
            wait_mins = max(0, int(delta.total_seconds() / 60))

        has_other_waiting = any(x.id != q.id and x.status == "WAITING" for x in all_entries)

        results.append({
            "id": q.id,
            "token_number": q.token_number,
            "token_display": f"#{q.token_number:02d}",
            "appointment_id": q.appointment_id,
            "patient_id": patient.id if patient else None,
            "doctor_id": doctor.id if doctor else None,
            "patient_uid": patient.patient_uid if (patient and patient.patient_uid) else (f"PAT-{patient.id:04d}" if patient else ""),
            "patient_name": patient.name if patient else "Valued Patient",
            "patient_phone": patient.phone if patient else "",
            "doctor_name": doctor.name if doctor else "Doctor",
            "doctor_specialty": doctor.specialization if doctor else "Specialist",
            "appointment_time": f"{appt.start_time} - {appt.end_time}" if appt else "",
            "cabin": q.cabin or "Cabin 1",
            "status": q.status,
            "wait_time_mins": wait_mins,
            "wait_display": f"{wait_mins} mins ago",
            "called_at": q.called_at.isoformat() if q.called_at else None,
            "created_at": q.created_at.isoformat() if q.created_at else None,
            # Server-computed state & action permissions:
            "can_call": q.status == "WAITING",
            "can_notify_again": q.status == "CALLED",
            "can_start_consultation": q.status == "CALLED",
            "can_finish": q.status == "IN_CONSULTATION",
            "can_finish_and_call_next": (q.status == "IN_CONSULTATION" and has_other_waiting),
            "can_skip": q.status in ["WAITING", "CALLED"],
            "has_other_waiting": has_other_waiting,
        })

    return {
        "date": today_str,
        "total_queued": len(all_entries),
        "waiting_count": waiting_count,
        "in_consultation_count": in_consult,
        "completed_count": completed_count,
        "has_waiting": has_waiting,
        "next_waiting": next_waiting_obj,
        "queue": results,
    }


@router.post("/checkin")
def check_in_patient(payload: CheckInRequest, db: Session = Depends(get_db)):
    """
    Assigns sequential token number and puts appointment into live queue.
    Enforces strict conditions:
    1. Appointment must be scheduled for today.
    2. Appointment must not be CANCELLED or COMPLETED.
    3. Patient must not already have an active token today.
    """
    appt = db.query(Appointment).filter(Appointment.id == payload.appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    today_str = datetime.date.today().strftime("%Y-%m-%d")

    # Strict Condition 1: Check-in only allowed on the appointment date
    if appt.appointment_date != today_str:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot check in appointment scheduled for {appt.appointment_date}. Patient can only check in on their appointment day ({today_str}).",
        )

    # Strict Condition 2: Cannot check in completed or cancelled appointments
    if appt.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot check in a cancelled appointment.")
    if appt.status == "COMPLETED":
        raise HTTPException(status_code=400, detail="This appointment has already been completed.")

    # Strict Condition 3: Check if already in active queue today
    active_entry = (
        db.query(QueueEntry)
        .filter(
            QueueEntry.appointment_id == appt.id,
            QueueEntry.queue_date == today_str,
            QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
        )
        .first()
    )
    if active_entry:
        return {
            "message": f"Patient is already checked in with active Token #{active_entry.token_number:02d} ({active_entry.status})",
            "token_number": active_entry.token_number,
            "token_display": f"#{active_entry.token_number:02d}",
            "queue_id": active_entry.id,
            "status": active_entry.status,
            "already_checked_in": True,
        }

    # Determine next token number for today
    highest = (
        db.query(QueueEntry)
        .filter(QueueEntry.queue_date == today_str)
        .order_by(QueueEntry.token_number.desc())
        .first()
    )
    next_token = (highest.token_number + 1) if highest else 1

    entry = QueueEntry(
        appointment_id=appt.id,
        token_number=next_token,
        queue_date=today_str,
        cabin=payload.cabin or "Cabin 1",
        status="WAITING",
        created_at=datetime.datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    return {
        "message": f"Checked in! Token #{next_token:02d} assigned",
        "token_number": entry.token_number,
        "token_display": f"#{entry.token_number:02d}",
        "queue_id": entry.id,
        "status": entry.status,
        "already_checked_in": False,
    }


@router.post("/{entry_id}/call")
async def call_queue_patient(
    entry_id: int, payload: Optional[CabinUpdate] = None, db: Session = Depends(get_db)
):
    """
    Dedicated Backend Endpoint:
    Marks patient as CALLED and updates cabin/timestamp to inform front desk & clinic displays.
    Does NOT dispatch WhatsApp message (hospital reception/staff calls patient in person/intercom).
    """
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    cabin = (payload.cabin if payload and payload.cabin else entry.cabin) or "Cabin 1"
    entry.status = "CALLED"
    entry.cabin = cabin
    entry.called_at = datetime.datetime.utcnow()

    db.commit()

    p_name = entry.appointment.patient.name if (entry.appointment and entry.appointment.patient) else "Patient"
    return {
        "message": f"Token #{entry.token_number:02d} ({p_name}) called to {cabin}",
        "token_number": entry.token_number,
        "token_display": f"#{entry.token_number:02d}",
        "status": entry.status,
        "whatsapp_alert_sent": False,
    }


@router.post("/{entry_id}/start-consultation")
def start_consultation(entry_id: int, db: Session = Depends(get_db)):
    """
    Dedicated Backend Endpoint:
    Transitions patient from CALLED to IN_CONSULTATION and updates appointment status.
    """
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    entry.status = "IN_CONSULTATION"
    if entry.appointment:
        entry.appointment.status = "IN_CONSULTATION"

    db.commit()
    return {
        "message": f"Consultation started for Token #{entry.token_number:02d}",
        "status": entry.status,
    }


@router.post("/{entry_id}/finish")
def finish_consultation(entry_id: int, db: Session = Depends(get_db)):
    """
    Dedicated Backend Endpoint:
    Marks patient as COMPLETED and synchronizes appointment status to COMPLETED.
    """
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    entry.status = "COMPLETED"
    if entry.appointment:
        entry.appointment.status = "COMPLETED"

    db.commit()
    return {
        "message": f"Consultation completed for Token #{entry.token_number:02d}",
        "status": entry.status,
    }


@router.post("/{entry_id}/skip")
def skip_queue_patient(entry_id: int, db: Session = Depends(get_db)):
    """
    Dedicated Backend Endpoint:
    Marks patient as SKIPPED.
    """
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    entry.status = "SKIPPED"
    db.commit()
    return {
        "message": f"Token #{entry.token_number:02d} skipped",
        "status": entry.status,
    }


@router.post("/{entry_id}/notify")
def notify_patient_turn(entry_id: int, db: Session = Depends(get_db)):
    """Re-announces / recalls the patient for their turn, updating called_at timestamp."""
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    entry.called_at = datetime.datetime.utcnow()
    db.commit()

    p_name = entry.appointment.patient.name if (entry.appointment and entry.appointment.patient) else "Patient"
    cabin = entry.cabin or "Cabin 1"
    return {"message": f"Token #{entry.token_number:02d} ({p_name}) recalled for {cabin}"}


@router.post("/{entry_id}/finish-and-call-next")
async def finish_and_call_next(
    entry_id: int, payload: Optional[CabinUpdate] = None, db: Session = Depends(get_db)
):
    """
    Backend Atomic Transition:
    1. Completes current consultation.
    2. Immediately finds the next WAITING token today (prioritizing the same doctor/cabin) and marks them CALLED.
    3. Informs front desk / cabin displays without sending WhatsApp messages.
    """
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    # 1. Complete current patient
    entry.status = "COMPLETED"
    if entry.appointment:
        entry.appointment.status = "COMPLETED"

    cabin_to_use = (payload.cabin if payload and payload.cabin else entry.cabin) or "Cabin 1"
    today_str = entry.queue_date or datetime.date.today().strftime("%Y-%m-%d")

    # Determine doctor filter if in doctor mode or current entry has doctor
    filter_doctor_id = None
    if payload and payload.doctor_id:
        filter_doctor_id = payload.doctor_id
    elif entry.appointment and entry.appointment.doctor_id:
        filter_doctor_id = entry.appointment.doctor_id

    # 2. Find next waiting patient for today
    next_q = (
        db.query(QueueEntry)
        .filter(
            QueueEntry.queue_date == today_str,
            QueueEntry.status == "WAITING",
            QueueEntry.id != entry_id,
        )
    )
    if filter_doctor_id:
        next_q = next_q.join(Appointment).filter(Appointment.doctor_id == filter_doctor_id)

    next_waiting = next_q.order_by(QueueEntry.token_number.asc()).first()

    next_token_info = None

    if next_waiting:
        next_waiting.status = "CALLED"
        next_waiting.cabin = cabin_to_use
        next_waiting.called_at = datetime.datetime.utcnow()

        appt = next_waiting.appointment
        next_token_info = {
            "id": next_waiting.id,
            "token_number": next_waiting.token_number,
            "token_display": f"#{next_waiting.token_number:02d}",
            "patient_name": appt.patient.name if (appt and appt.patient) else "Patient",
        }

    db.commit()

    return {
        "message": (
            f"Consultation completed. Next token {next_token_info['token_display']} ({next_token_info['patient_name']}) called to {cabin_to_use}."
            if next_token_info
            else "Consultation completed. No more waiting patients in lobby."
        ),
        "completed_entry_id": entry.id,
        "next_waiting_called": bool(next_waiting),
        "next_token": next_token_info,
    }


@router.post("/call-next")
async def call_next_waiting(
    payload: Optional[CabinUpdate] = None, db: Session = Depends(get_db)
):
    """
    Backend Atomic Action:
    Calls the next WAITING patient in line today (filtered by doctor if in Doctor Mode)
    and marks them CALLED to inform front desk / cabin displays without sending WhatsApp messages.
    """
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    q = (
        db.query(QueueEntry)
        .filter(QueueEntry.queue_date == today_str, QueueEntry.status == "WAITING")
    )
    if payload and payload.doctor_id:
        q = q.join(Appointment).filter(Appointment.doctor_id == payload.doctor_id)

    next_waiting = q.order_by(QueueEntry.token_number.asc()).first()
    if not next_waiting:
        msg = "No waiting patients currently in the queue"
        if payload and payload.doctor_id:
            msg += " for this doctor."
        else:
            msg += "."
        raise HTTPException(status_code=404, detail=msg)

    cabin = (payload.cabin if payload and payload.cabin else next_waiting.cabin) or "Cabin 1"
    next_waiting.status = "CALLED"
    next_waiting.cabin = cabin
    next_waiting.called_at = datetime.datetime.utcnow()

    db.commit()

    appt = next_waiting.appointment
    p_name = appt.patient.name if (appt and appt.patient) else "Patient"
    return {
        "message": f"Token #{next_waiting.token_number:02d} ({p_name}) called to {cabin}.",
        "token_number": next_waiting.token_number,
        "token_display": f"#{next_waiting.token_number:02d}",
        "patient_name": p_name,
        "whatsapp_alert_sent": False,
    }


@router.put("/{entry_id}/status")
async def update_queue_status(
    entry_id: int, payload: QueueStatusUpdate, db: Session = Depends(get_db)
):
    entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")

    status_upper = payload.status.upper()
    valid_statuses = ["WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "SKIPPED"]
    if status_upper not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    entry.status = status_upper
    if payload.cabin:
        entry.cabin = payload.cabin

    if status_upper == "CALLED":
        entry.called_at = datetime.datetime.utcnow()
    elif status_upper == "COMPLETED":
        if entry.appointment:
            entry.appointment.status = "COMPLETED"

    db.commit()

    return {
        "message": f"Queue status updated to {status_upper}",
        "status": entry.status,
        "whatsapp_alert_sent": False,
    }
