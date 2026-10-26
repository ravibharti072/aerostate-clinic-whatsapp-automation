import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.security import require_admin
import app.models as models

router = APIRouter(prefix="/admin/staff", tags=["Staff, Roles & Duty Scheduling"], dependencies=[Depends(require_admin)])


class StaffProfileCreate(BaseModel):
    full_name: str
    role_category: str = "Receptionist"  # Doctor, Nurse, Receptionist, Lab Technician, Pharmacist, Billing Staff, Clinic Administrator
    department: str = "General OPD"
    designation: str = "Staff Member"
    contact_phone: str
    email: Optional[str] = None
    registration_number: Optional[str] = None
    employment_status: str = "ACTIVE"
    joining_date: Optional[str] = None


class StaffProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    role_category: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    contact_phone: Optional[str] = None
    email: Optional[str] = None
    registration_number: Optional[str] = None
    employment_status: Optional[str] = None
    joining_date: Optional[str] = None


class DutyShiftCreate(BaseModel):
    staff_id: int
    doctor_id: Optional[int] = None
    shift_name: str = "Morning OPD"
    shift_date: str  # YYYY-MM-DD
    start_time: str = "09:00"
    end_time: str = "17:00"
    status: str = "SCHEDULED"
    notes: Optional[str] = None


def generate_staff_uid(db: Session) -> str:
    count = db.query(models.StaffProfile).count() + 1
    return f"STF-{count:03d}"


def normalize_staff_phone(phone: str) -> str:
    clean = (phone or "").strip()
    digits = "".join(filter(str.isdigit, clean))
    if digits.startswith("91") and len(digits) > 10:
        digits = digits[2:]
    if len(digits) == 10:
        return f"+91{digits}"
    elif clean.startswith("+"):
        return clean
    elif digits:
        return f"+{digits}"
    return clean


# ----------------------------------------------------
# 1. Staff Statistics & Master Options
# ----------------------------------------------------

def compute_staff_stats(db: Session):
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    total_staff = db.query(models.StaffProfile).count()
    active_staff = db.query(models.StaffProfile).filter(models.StaffProfile.employment_status == "ACTIVE").count()
    deactivated_staff = db.query(models.StaffProfile).filter(models.StaffProfile.employment_status != "ACTIVE").count()
    
    doctors_count = (
        db.query(models.StaffProfile)
        .filter(models.StaffProfile.role_category == "Doctor")
        .count()
    )
    if doctors_count == 0:
        doctors_count = db.query(models.Doctor).filter(models.Doctor.is_active == True).count()
        
    shifts_today = (
        db.query(models.DutyShift)
        .filter(models.DutyShift.shift_date == today_str)
        .count()
    )
    
    clinical_support = (
        db.query(models.StaffProfile)
        .filter(
            models.StaffProfile.role_category.in_([
                "Nurse",
                "Lab Technician",
                "Pharmacist",
                "Receptionist",
                "Billing Staff",
            ])
        )
        .count()
    )
    
    return {
        "total_staff": total_staff,
        "active_staff": active_staff,
        "deactivated_staff": deactivated_staff,
        "doctors_count": doctors_count,
        "shifts_today": shifts_today,
        "clinical_support": clinical_support,
    }


@router.get("/stats")
def get_staff_stats(db: Session = Depends(get_db)):
    """Provides server-aggregated KPI metrics for clinical administration & duty scheduling."""
    return compute_staff_stats(db)


@router.get("/options")
def get_staff_options():
    """Provides master options for staff roles, clinical departments, and shifts."""
    return {
        "role_categories": [
            "ALL",
            "Doctor",
            "Receptionist",
            "Nurse",
            "Lab Technician",
            "Pharmacist",
            "Billing Staff",
            "Clinic Administrator",
        ],
        "departments": [
            "ALL",
            "Dentistry & Maxillofacial",
            "General OPD",
            "Diagnostic Pathology",
            "Central Pharmacy",
            "Front Desk & Registration",
            "Administration",
            "Nursing & Patient Care",
        ],
        "shift_names": [
            "Morning OPD",
            "Evening OPD",
            "Night Duty",
            "Full Day Reception",
            "Emergency Coverage",
        ],
        "employment_statuses": ["ACTIVE", "ON_LEAVE", "RESIGNED", "PROBATION"],
        "shift_statuses": ["ALL", "SCHEDULED", "COMPLETED", "CANCELLED"],
    }


# ----------------------------------------------------
# 2. Staff Directory
# ----------------------------------------------------

@router.get("")
def list_staff(
    role: Optional[str] = None,
    department: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Auto-synchronize any Specialist Doctors into Staff Profiles if missing
    doctors = db.query(models.Doctor).all()
    for doc in doctors:
        exists = db.query(models.StaffProfile).filter(models.StaffProfile.full_name == doc.name).first()
        if not exists:
            count = db.query(models.StaffProfile).count() + 1
            stf = models.StaffProfile(
                staff_uid=f"STF-{count:03d}",
                full_name=doc.name,
                role_category="Doctor",
                department=doc.specialization,
                designation=f"Specialist ({doc.specialization})",
                contact_phone="Clinic Ext",
                employment_status="ACTIVE" if doc.is_active else "ON_LEAVE",
                joining_date=datetime.date.today().strftime("%Y-%m-%d"),
            )
            db.add(stf)
    db.commit()

    query = db.query(models.StaffProfile)
    if role and role != "ALL":
        query = query.filter(models.StaffProfile.role_category == role)
    if department and department != "ALL":
        query = query.filter(models.StaffProfile.department == department)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (models.StaffProfile.full_name.ilike(s))
            | (models.StaffProfile.contact_phone.ilike(s))
            | (models.StaffProfile.staff_uid.ilike(s))
            | (models.StaffProfile.department.ilike(s))
            | (models.StaffProfile.designation.ilike(s))
        )

    staff_members = query.order_by(models.StaffProfile.role_category.asc(), models.StaffProfile.full_name.asc()).all()
    return [
        {
            "id": s.id,
            "staff_uid": s.staff_uid,
            "full_name": s.full_name,
            "role_category": s.role_category,
            "department": s.department,
            "designation": s.designation,
            "contact_phone": s.contact_phone,
            "email": s.email or "-",
            "registration_number": s.registration_number or "-",
            "employment_status": s.employment_status,
            "joining_date": s.joining_date or "-",
        }
        for s in staff_members
    ]


@router.post("")
def create_staff(payload: StaffProfileCreate, db: Session = Depends(get_db)):
    staff_uid = generate_staff_uid(db)
    normalized_phone = normalize_staff_phone(payload.contact_phone)
    staff = models.StaffProfile(
        staff_uid=staff_uid,
        full_name=payload.full_name.strip(),
        role_category=payload.role_category,
        department=payload.department,
        designation=payload.designation,
        contact_phone=normalized_phone,
        email=payload.email,
        registration_number=payload.registration_number,
        employment_status=payload.employment_status,
        joining_date=payload.joining_date or datetime.date.today().strftime("%Y-%m-%d"),
        created_at=datetime.datetime.utcnow(),
    )
    db.add(staff)
    db.commit()
    db.refresh(staff)
    return {"message": "Staff member created successfully", "id": staff.id, "staff_uid": staff.staff_uid}


@router.put("/{staff_id}")
def update_staff(staff_id: int, payload: StaffProfileUpdate, db: Session = Depends(get_db)):
    staff = db.query(models.StaffProfile).filter(models.StaffProfile.id == staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")

    old_name = staff.full_name
    update_data = payload.dict(exclude_unset=True)
    if "contact_phone" in update_data and update_data["contact_phone"] is not None:
        update_data["contact_phone"] = normalize_staff_phone(update_data["contact_phone"])

    for k, v in update_data.items():
        if v is not None:
            setattr(staff, k, v)

    # Sync with Doctor model if this staff member is a Doctor
    if staff.role_category == "Doctor" or (payload.role_category and payload.role_category == "Doctor"):
        doc = db.query(models.Doctor).filter(
            (models.Doctor.name == old_name) | (models.Doctor.name == staff.full_name)
        ).first()
        if doc:
            if payload.full_name:
                doc.name = payload.full_name.strip()
            if payload.department:
                doc.specialization = payload.department.strip()
            if payload.employment_status:
                doc.is_active = (payload.employment_status == "ACTIVE")

    db.commit()
    db.refresh(staff)
    return {"message": "Staff profile updated successfully", "id": staff.id}


@router.post("/{staff_id}/toggle-status")
def toggle_staff_status(staff_id: int, db: Session = Depends(get_db)):
    """Deactivates a departed staff member (or reactivates them) without deleting history."""
    staff = db.query(models.StaffProfile).filter(models.StaffProfile.id == staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")

    new_status = "DEACTIVATED" if staff.employment_status == "ACTIVE" else "ACTIVE"
    staff.employment_status = new_status

    # Also sync with linked Doctor record if any
    doc = db.query(models.Doctor).filter(models.Doctor.name == staff.full_name).first()
    if doc:
        doc.is_active = (new_status == "ACTIVE")

    # Also deactivate linked user login account if any
    if staff.user_id:
        u = db.query(models.User).filter(models.User.id == staff.user_id).first()
        if u:
            u.is_active = (new_status == "ACTIVE")

    db.commit()
    db.refresh(staff)
    return {
        "message": f"Staff member '{staff.full_name}' {'deactivated and moved to departed records' if new_status == 'DEACTIVATED' else 'reactivated'} successfully",
        "id": staff.id,
        "employment_status": staff.employment_status,
    }


# ----------------------------------------------------
# 2. Duty Scheduling & Rosters
# ----------------------------------------------------

@router.get("/shifts")
def list_duty_shifts(
    date: Optional[str] = None,
    staff_id: Optional[int] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.DutyShift).join(models.StaffProfile)
    if date:
        query = query.filter(models.DutyShift.shift_date == date)
    if staff_id:
        query = query.filter(models.DutyShift.staff_id == staff_id)
    if status and status != "ALL":
        query = query.filter(models.DutyShift.status == status)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (models.StaffProfile.full_name.ilike(s))
            | (models.DutyShift.shift_name.ilike(s))
            | (models.StaffProfile.role_category.ilike(s))
        )

    shifts = query.order_by(models.DutyShift.shift_date.desc(), models.DutyShift.start_time.asc()).all()
    return [
        {
            "id": sh.id,
            "staff_id": sh.staff_id,
            "staff_uid": sh.staff.staff_uid if sh.staff else "-",
            "staff_name": sh.staff.full_name if sh.staff else "-",
            "role": sh.staff.role_category if sh.staff else "-",
            "shift_name": sh.shift_name,
            "shift_date": sh.shift_date,
            "timing": f"{sh.start_time} - {sh.end_time}",
            "status": sh.status,
            "notes": sh.notes or "—",
        }
        for sh in shifts
    ]


@router.post("/shifts")
def assign_duty_shift(payload: DutyShiftCreate, db: Session = Depends(get_db)):
    staff = db.query(models.StaffProfile).filter(models.StaffProfile.id == payload.staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")

    shift = models.DutyShift(
        staff_id=staff.id,
        doctor_id=payload.doctor_id,
        shift_name=payload.shift_name,
        shift_date=payload.shift_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        status=payload.status,
        notes=payload.notes,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return {"message": f"Shift assigned to {staff.full_name} for {shift.shift_date}", "id": shift.id}


@router.get("/doctor-roster")
def get_doctor_roster(db: Session = Depends(get_db)):
    """Returns working doctor availability for booking conflict resolution."""
    doctors = db.query(models.Doctor).filter(models.Doctor.is_active == True).all()
    return [
        {
            "id": d.id,
            "name": d.name,
            "specialization": d.specialization,
            "available_days": d.available_days,
            "timings": f"{d.start_time} - {d.end_time}",
            "slot_duration": f"{d.slot_duration_mins} mins",
        }
        for d in doctors
    ]
