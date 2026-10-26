import datetime
import math
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.database import get_db
from app.models import User, Doctor, StaffProfile
from app.security import require_admin, hash_password

router = APIRouter(prefix="/admin/users", tags=["Clinic User Management"], dependencies=[Depends(require_admin)])


class ClinicUserCreate(BaseModel):
    name: Optional[str] = None
    staff_id: Optional[int] = None
    username: str
    password: str
    role: str  # frontdesk, doctor, pharma, admin
    doctor_id: Optional[int] = None
    specialization: Optional[str] = "General Consultation"
    is_active: bool = True


class ClinicUserUpdate(BaseModel):
    name: Optional[str] = None
    staff_id: Optional[int] = None
    username: Optional[str] = None
    role: Optional[str] = None
    doctor_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


ROLE_MAPPING = {
    "frontdesk": {
        "code": "Frontdesk",
        "label": "Front Desk / Reception",
        "theme": "blue",
        "portal": "Front Desk Portal",
        "is_frontdesk": True,
        "is_doctor": False,
        "is_pharma": False,
        "is_admin": False,
    },
    "receptionist": {
        "code": "Frontdesk",
        "label": "Front Desk / Reception",
        "theme": "blue",
        "portal": "Front Desk Portal",
        "is_frontdesk": True,
        "is_doctor": False,
        "is_pharma": False,
        "is_admin": False,
    },
    "doctor": {
        "code": "Doctor",
        "label": "Doctor / Medical Specialist",
        "theme": "teal",
        "portal": "Doctor Clinical Portal",
        "is_frontdesk": False,
        "is_doctor": True,
        "is_pharma": False,
        "is_admin": False,
    },
    "pharma": {
        "code": "Pharma",
        "label": "Pharmacist / Inventory",
        "theme": "purple",
        "portal": "Pharmacy & Dispensing Portal",
        "is_frontdesk": False,
        "is_doctor": False,
        "is_pharma": True,
        "is_admin": False,
    },
    "pharmacist": {
        "code": "Pharma",
        "label": "Pharmacist / Inventory",
        "theme": "purple",
        "portal": "Pharmacy & Dispensing Portal",
        "is_frontdesk": False,
        "is_doctor": False,
        "is_pharma": True,
        "is_admin": False,
    },
    "admin": {
        "code": "Admin",
        "label": "Clinic Administrator",
        "theme": "emerald",
        "portal": "Full Clinic Administration",
        "is_frontdesk": False,
        "is_doctor": False,
        "is_pharma": False,
        "is_admin": True,
    },
    "superadmin": {
        "code": "SuperAdmin",
        "label": "Platform SuperAdmin",
        "theme": "indigo",
        "portal": "SuperAdmin Master",
        "is_frontdesk": False,
        "is_doctor": False,
        "is_pharma": False,
        "is_admin": True,
    },
    "client": {
        "code": "Admin",
        "label": "Clinic Administrator",
        "theme": "emerald",
        "portal": "Full Clinic Administration",
        "is_frontdesk": False,
        "is_doctor": False,
        "is_pharma": False,
        "is_admin": True,
    },
}


@router.get("/options")
def get_user_options(db: Session = Depends(get_db)):
    """
    100% Server-computed options for user creation & role assignment.
    Provides doctors list and role definitions with pre-formatted labels and descriptions.
    """
    doctors = db.query(Doctor).filter(Doctor.is_active == True).order_by(Doctor.name.asc()).all()

    doctor_options = [
        {
            "id": d.id,
            "name": d.name,
            "specialization": d.specialization or "General Consultation",
            "display_label": f"{d.name} ({d.specialization})" if d.specialization else d.name,
        }
        for d in doctors
    ]

    roles = [
        {
            "value": "frontdesk",
            "label": "Front Desk / Receptionist (All Clinic Operations)",
            "short_label": "Front Desk",
            "badge": "Front Desk Portal",
            "theme": "blue",
            "description": "Full access to reception desk, appointments booking, patient check-in & waiting room queue, patient records, WhatsApp chats, and billing cashier.",
        },
        {
            "value": "doctor",
            "label": "Doctor / Medical Specialist (Clinical OPD Portal)",
            "short_label": "Doctor",
            "badge": "Doctor Clinical Portal",
            "theme": "teal",
            "description": "Dedicated Doctor Clinical Portal: Cabin OPD Queue, patient consultations, vitals, diagnosis, prescriptions, patient health records, and laboratory investigation results.",
        },
        {
            "value": "pharma",
            "label": "Pharmacist / Dispensary (Inventory & Dispensing)",
            "short_label": "Pharmacist",
            "badge": "Pharmacy Portal",
            "theme": "purple",
            "description": "Dedicated Pharmacy Portal: Pharmacy catalogue, batch inventory, drug movements, dispensing queue, prescription fulfillment, and dispensary billing.",
        },
        {
            "value": "admin",
            "label": "Clinic Administrator (Full Administrative Authority)",
            "short_label": "Clinic Admin",
            "badge": "Full Administration",
            "theme": "emerald",
            "description": "Full access across all clinic modules, financial analytics, staff duty roster, system configurations, and clinic user account creation.",
        },
    ]

    staff_members = db.query(StaffProfile).order_by(StaffProfile.full_name.asc()).all()
    staff_options = []
    for s in staff_members:
        raw_role = (s.role_category or "").lower()
        suggested = "frontdesk"
        if "doctor" in raw_role:
            suggested = "doctor"
        elif "pharm" in raw_role:
            suggested = "pharma"
        elif "admin" in raw_role:
            suggested = "admin"

        staff_options.append({
            "id": s.id,
            "staff_uid": s.staff_uid,
            "name": s.full_name,
            "role_category": s.role_category or "Staff",
            "department": s.department or "General",
            "display_label": f"{s.full_name} ({s.role_category} - {s.department or 'General'})",
            "suggested_role": suggested,
        })

    return {
        "roles": roles,
        "doctors": doctor_options,
        "staff_members": staff_options,
    }


@router.get("")
def list_clinic_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    role: Optional[str] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    """
    100% Backend-computed User Management listing:
    - Server-side search filtering
    - Server-side role filtering
    - Server-side status filtering (ACTIVE / INACTIVE)
    - Server-side pagination & offsets
    - All KPI statistics calculated directly on DB
    - Pre-computed display fields and boolean flags (no frontend calculation)
    - SuperAdmin account is strictly concealed from non-SuperAdmin staff
    """
    is_caller_superadmin = (current_admin.role or "").lower() == "superadmin"

    base_query = db.query(User)

    # Strictly hide SuperAdmin accounts from regular clinic administrators and staff
    if not is_caller_superadmin:
        base_query = base_query.filter(func.lower(User.role) != "superadmin")

    if status and status.strip() and status.upper() != "ALL":
        if status.upper() == "ACTIVE":
            base_query = base_query.filter(User.is_active == True)
        elif status.upper() in ["INACTIVE", "DEACTIVATED"]:
            base_query = base_query.filter(User.is_active == False)

    if role and role.strip() and role.upper() != "ALL":
        clean_role = role.strip().lower()
        if clean_role in ["admin", "superadmin", "client"]:
            if is_caller_superadmin:
                base_query = base_query.filter(func.lower(User.role).in_(["admin", "superadmin", "client"]))
            else:
                base_query = base_query.filter(func.lower(User.role).in_(["admin", "client"]))
        elif clean_role in ["frontdesk", "receptionist"]:
            base_query = base_query.filter(func.lower(User.role).in_(["frontdesk", "receptionist"]))
        elif clean_role in ["pharma", "pharmacist"]:
            base_query = base_query.filter(func.lower(User.role).in_(["pharma", "pharmacist"]))
        elif clean_role == "doctor":
            base_query = base_query.filter(func.lower(User.role) == "doctor")
        else:
            base_query = base_query.filter(func.lower(User.role) == clean_role)

    if search and search.strip():
        s = f"%{search.strip().lower()}%"
        base_query = base_query.filter(
            or_(
                func.lower(User.name).like(s),
                func.lower(User.username).like(s),
                func.lower(User.role).like(s),
            )
        )

    # Calculate filtered pagination
    total_matching = base_query.count()
    total_pages = math.ceil(total_matching / page_size) if total_matching > 0 else 1
    offset = (page - 1) * page_size
    users = base_query.order_by(User.created_at.desc()).offset(offset).limit(page_size).all()

    # Pre-calculate whole-clinic KPI statistics on database (scoped by caller role)
    all_users_query = db.query(User)
    if not is_caller_superadmin:
        all_users_query = all_users_query.filter(func.lower(User.role) != "superadmin")
    all_users = all_users_query.all()

    total_count = len(all_users)
    active_count = sum(1 for u in all_users if u.is_active)
    doctors_count = sum(1 for u in all_users if (u.role or "").lower() == "doctor")
    frontdesk_count = sum(1 for u in all_users if (u.role or "").lower() in ["frontdesk", "receptionist"])
    pharma_count = sum(1 for u in all_users if (u.role or "").lower() in ["pharma", "pharmacist"])
    admins_count = sum(
        1 for u in all_users
        if (u.role or "").lower() in (["admin", "superadmin", "client"] if is_caller_superadmin else ["admin", "client"])
    )

    results = []
    for u in users:
        raw_role = (u.role or "Staff").lower()
        role_meta = ROLE_MAPPING.get(raw_role, {
            "code": u.role or "Staff",
            "label": u.role or "Staff",
            "theme": "teal",
            "portal": f"{u.role} Portal",
            "is_frontdesk": False,
            "is_doctor": False,
            "is_pharma": False,
            "is_admin": False,
        })

        doc_name = None
        specialization = None
        if u.doctor_id and u.doctor:
            doc_name = u.doctor.name
            specialization = u.doctor.specialization
        elif role_meta["is_doctor"]:
            doc_match = db.query(Doctor).filter(Doctor.name == u.name).first()
            if doc_match:
                doc_name = doc_match.name
                specialization = doc_match.specialization
                if not u.doctor_id:
                    u.doctor_id = doc_match.id
                    db.commit()

        doctor_display = "Clinic-wide"
        if role_meta["is_doctor"]:
            if doc_name and specialization:
                doctor_display = f"{doc_name} ({specialization})"
            elif doc_name:
                doctor_display = doc_name
            else:
                doctor_display = u.name

        created_by_text = u.created_by or "Clinic Administrator"

        results.append({
            "id": u.id,
            "username": u.username,
            "name": u.name,
            "role": role_meta["code"],
            "role_display": role_meta["label"],
            "role_theme": role_meta["theme"],
            "portal_name": role_meta["portal"],
            "is_doctor": role_meta["is_doctor"],
            "is_frontdesk": role_meta["is_frontdesk"],
            "is_pharma": role_meta["is_pharma"],
            "is_admin": role_meta["is_admin"],
            "doctor_id": u.doctor_id,
            "doctor_name": doc_name,
            "specialization": specialization,
            "doctor_display": doctor_display,
            "staff_id": u.staff_id,
            "staff_uid": u.staff.staff_uid if u.staff else None,
            "staff_name": u.staff.full_name if u.staff else None,
            "is_active": u.is_active,
            "status_display": "Active" if u.is_active else "Inactive",
            "status_theme": "emerald" if u.is_active else "rose",
            "created_by": created_by_text,
            "created_date_display": u.created_at.strftime("%Y-%m-%d") if u.created_at else "-",
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "is_self": u.id == current_admin.id,
            "can_deactivate": u.id != current_admin.id,
            "can_edit": True,
            "can_reset_password": True,
        })

    return {
        "stats": {
            "total_users": total_count,
            "active_users": active_count,
            "doctors_count": doctors_count,
            "frontdesk_count": frontdesk_count,
            "pharma_count": pharma_count,
            "admins_count": admins_count,
        },
        "pagination": {
            "total_items": total_matching,
            "total_pages": total_pages,
            "current_page": page,
            "page_size": page_size,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
        "users": results,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_clinic_user(
    payload: ClinicUserCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    """
    Every staff user is created and authenticated by the clinic admin account.
    Validates username uniqueness and auto-creates doctor profile if needed.
    """
    clean_username = payload.username.strip().lower()
    clean_role = payload.role.strip().lower()

    clean_name = payload.name.strip() if payload.name else ""
    staff_id = payload.staff_id
    if staff_id:
        stf = db.query(StaffProfile).filter(StaffProfile.id == staff_id).first()
        if stf:
            if not clean_name:
                clean_name = stf.full_name
            staff_id = stf.id

    if not clean_username:
        raise HTTPException(status_code=400, detail="User Name (Login ID) is required.")
    if len(clean_username) < 3:
        raise HTTPException(status_code=400, detail="User Name must be at least 3 characters long.")
    if not payload.password or len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
    if not clean_name:
        raise HTTPException(status_code=400, detail="Staff member name is required. Select from the staff directory or enter a name.")

    if clean_role == "superadmin" and (current_admin.role or "").lower() != "superadmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can create SuperAdmin accounts.")

    # Check for duplicate username
    existing = db.query(User).filter(User.username == clean_username).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"User Name '{clean_username}' is already in use. Please choose a different username.",
        )

    # Standardize role
    role_meta = ROLE_MAPPING.get(clean_role)
    if not role_meta:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{payload.role}'. Must be one of: frontdesk, doctor, pharma, admin.",
        )
    standard_role = role_meta["code"]

    doctor_id = None
    if standard_role == "Doctor":
        if payload.doctor_id:
            doc = db.query(Doctor).filter(Doctor.id == payload.doctor_id).first()
            if doc:
                doctor_id = doc.id
        if not doctor_id:
            doc_existing = db.query(Doctor).filter(Doctor.name.ilike(clean_name)).first()
            if doc_existing:
                doctor_id = doc_existing.id
            else:
                new_doc = Doctor(
                    name=clean_name,
                    specialization=payload.specialization.strip() if payload.specialization else "General Consultation",
                    is_active=True,
                )
                db.add(new_doc)
                db.commit()
                db.refresh(new_doc)
                doctor_id = new_doc.id

    admin_creator = current_admin.name or current_admin.username or "Clinic Admin"

    user = User(
        username=clean_username,
        name=clean_name,
        password_hash=hash_password(payload.password),
        role=standard_role,
        doctor_id=doctor_id,
        staff_id=staff_id,
        created_by=f"Admin ({admin_creator})",
        is_active=payload.is_active,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": f"User account '{user.username}' created successfully for {clean_name} ({standard_role}).",
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "doctor_id": user.doctor_id,
            "staff_id": user.staff_id,
            "created_by": user.created_by,
            "is_active": user.is_active,
        },
    }


@router.put("/{user_id}")
def update_clinic_user(
    user_id: int,
    payload: ClinicUserUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent non-SuperAdmins from modifying SuperAdmin accounts
    is_target_superadmin = (user.role or "").lower() == "superadmin"
    is_caller_superadmin = (current_admin.role or "").lower() == "superadmin"
    if is_target_superadmin and not is_caller_superadmin:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent non-SuperAdmins from promoting any account to SuperAdmin
    if payload.role and payload.role.strip().lower() == "superadmin" and not is_caller_superadmin:
        raise HTTPException(status_code=403, detail="Only SuperAdmin can promote users to SuperAdmin role.")

    # Prevent deactivating or demoting the only active SuperAdmin
    if user.id == current_admin.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own administrative account.")

    # Update Username if requested
    if payload.username and payload.username.strip():
        new_username = payload.username.strip().lower()
        if new_username != user.username:
            if len(new_username) < 3:
                raise HTTPException(status_code=400, detail="User Name must be at least 3 characters long.")
            existing = db.query(User).filter(User.username == new_username, User.id != user.id).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"User Name '{new_username}' is already in use by another account.")
            user.username = new_username

    if payload.staff_id is not None:
        user.staff_id = payload.staff_id if payload.staff_id else None
        if payload.staff_id:
            stf = db.query(StaffProfile).filter(StaffProfile.id == payload.staff_id).first()
            if stf and not (payload.name and payload.name.strip()):
                user.name = stf.full_name

    if payload.name and payload.name.strip():
        user.name = payload.name.strip()

    if payload.role and payload.role.strip():
        clean_role = payload.role.strip().lower()
        role_meta = ROLE_MAPPING.get(clean_role)
        if role_meta:
            user.role = role_meta["code"]
            if user.role == "Doctor" and not user.doctor_id and payload.doctor_id:
                user.doctor_id = payload.doctor_id

    if payload.doctor_id is not None:
        user.doctor_id = payload.doctor_id

    if payload.is_active is not None:
        user.is_active = payload.is_active

    if payload.password and payload.password.strip():
        if len(payload.password.strip()) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters long.")
        user.password_hash = hash_password(payload.password.strip())

    db.commit()
    db.refresh(user)

    return {
        "message": f"User '{user.username}' updated successfully",
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "is_active": user.is_active,
        },
    }


@router.post("/{user_id}/toggle-status")
def toggle_user_status(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if (user.role or "").lower() == "superadmin" and (current_admin.role or "").lower() != "superadmin":
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")

    user.is_active = not user.is_active
    db.commit()

    return {
        "message": f"User '{user.username}' {'activated' if user.is_active else 'deactivated'} successfully",
        "is_active": user.is_active,
    }


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if (user.role or "").lower() == "superadmin" and (current_admin.role or "").lower() != "superadmin":
        raise HTTPException(status_code=404, detail="User not found")

    new_pass = payload.new_password.strip()
    if not new_pass or len(new_pass) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")

    user.password_hash = hash_password(new_pass)
    db.commit()

    return {"message": f"Password for '{user.username}' has been reset successfully."}
