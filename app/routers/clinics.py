import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import Clinic, Doctor, Appointment, User
from app.security import require_superadmin, get_current_user, hash_password
from app.services.whatsapp import whatsapp_client
from app.config import settings
from app.routers.admin import update_env_variable

router = APIRouter(prefix="/api/clinics", tags=["Multi-Clinic Management"])


class ClinicCreateRequest(BaseModel):
    name: str
    code: Optional[str] = None
    tagline: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    operating_hours: Optional[str] = None
    phone_number_id: Optional[str] = None
    display_phone_number: Optional[str] = None
    whatsapp_token: Optional[str] = None
    verify_token: Optional[str] = None
    is_active: bool = True
    # SaaS Subscription & Licensing Model
    subscription_plan: Optional[str] = "Monthly"
    subscription_expiry: Optional[str] = None
    subscription_expiry_date: Optional[str] = None
    subscription_status: Optional[str] = "Active"
    # Initial Primary Admin Credentials created by SuperAdmin
    admin_username: Optional[str] = None
    admin_password: Optional[str] = None
    admin_name: Optional[str] = None


class ClinicAdminCredentialsRequest(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    password: str


class ClinicUpdateRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    tagline: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    operating_hours: Optional[str] = None
    phone_number_id: Optional[str] = None
    display_phone_number: Optional[str] = None
    whatsapp_token: Optional[str] = None
    verify_token: Optional[str] = None
    is_active: Optional[bool] = None
    # SaaS Subscription & Licensing Model
    subscription_plan: Optional[str] = None
    subscription_expiry: Optional[str] = None
    subscription_expiry_date: Optional[str] = None
    subscription_status: Optional[str] = None
    # Phase 6: Reception Handover & Clinic Information
    google_maps_url: Optional[str] = None
    emergency_contact: Optional[str] = None
    departments: Optional[str] = None
    facilities: Optional[str] = None
    reception_phone: Optional[str] = None
    reception_start_time: Optional[str] = None
    reception_end_time: Optional[str] = None
    reception_days: Optional[str] = None
    reception_message_open: Optional[str] = None
    reception_message_closed: Optional[str] = None
    reception_expected_wait_mins: Optional[int] = None


def parse_expiry_date(expiry_str: Optional[str], plan: Optional[str] = "Monthly") -> Optional[datetime.datetime]:
    if expiry_str and expiry_str.strip():
        val = expiry_str.strip()
        try:
            if len(val) == 10:
                return datetime.datetime.strptime(val, "%Y-%m-%d")
            return datetime.datetime.fromisoformat(val.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            pass

    now = datetime.datetime.utcnow()
    plan_lower = (plan or "monthly").lower()
    if "quarter" in plan_lower:
        return now + datetime.timedelta(days=90)
    elif "annual" in plan_lower or "year" in plan_lower:
        return now + datetime.timedelta(days=365)
    elif "semi" in plan_lower:
        return now + datetime.timedelta(days=180)
    elif "trial" in plan_lower:
        return now + datetime.timedelta(days=14)
    else:
        return now + datetime.timedelta(days=30)


def get_subscription_info(c: Clinic):
    plan = c.subscription_plan or "Monthly"
    expiry = c.subscription_expiry
    status = c.subscription_status or "Active"
    days_remaining = None
    is_expired = False

    if expiry:
        days_remaining = (expiry.date() - datetime.date.today()).days
        if days_remaining < 0:
            status = "Expired"
            is_expired = True
        elif days_remaining <= 7:
            status = "Expiring Soon"
        else:
            status = "Active"

    return {
        "subscription_plan": plan,
        "subscription_expiry": expiry.isoformat() if expiry else None,
        "subscription_expiry_date": expiry.strftime("%Y-%m-%d") if expiry else "",
        "subscription_expiry_display": expiry.strftime("%d %b %Y") if expiry else "Not Configured",
        "subscription_status": status,
        "days_remaining": days_remaining,
        "is_expired": is_expired,
    }


def mask_token(token: Optional[str]) -> str:
    if not token or token.startswith("YOUR_"):
        return ""
    if len(token) > 16:
        return token[:6] + "••••••••" + token[-4:]
    return "••••••••"


@router.get("")
def list_clinics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Lists all clinics/branches.
    If the user is bound to a specific clinic (non-SuperAdmin), only their clinic is returned.
    """
    query = db.query(Clinic)
    # Non-superadmin staff can only see their assigned clinic if clinic_id is set
    if current_user.role.lower() != "superadmin" and current_user.clinic_id:
        query = query.filter(Clinic.id == current_user.clinic_id)

    clinics = query.order_by(Clinic.id.asc()).all()

    result = []
    for c in clinics:
        doc_count = db.query(Doctor).filter(Doctor.clinic_id == c.id, Doctor.is_active == True).count()
        appt_count = db.query(Appointment).filter(Appointment.clinic_id == c.id).count()

        # Find primary clinic admin (role Admin or first staff user)
        admin_user = (
            db.query(User)
            .filter(User.clinic_id == c.id, func.lower(User.role).in_(["admin", "client"]))
            .order_by(User.id.asc())
            .first()
        )
        if not admin_user:
            admin_user = (
                db.query(User)
                .filter(User.clinic_id == c.id, func.lower(User.role) != "superadmin")
                .order_by(User.id.asc())
                .first()
            )

        # Check Meta configuration status
        is_meta_configured = bool(
            c.phone_number_id
            and not c.phone_number_id.startswith("YOUR_")
            and (c.whatsapp_token or (settings.WHATSAPP_TOKEN and not settings.WHATSAPP_TOKEN.startswith("YOUR_")))
        )

        result.append({
            "id": c.id,
            "code": c.code,
            "name": c.name,
            "tagline": c.tagline,
            "address": c.address,
            "city": c.city,
            "state": c.state,
            "phone": c.phone,
            "email": c.email,
            "operating_hours": c.operating_hours,
            "phone_number_id": c.phone_number_id,
            "display_phone_number": c.display_phone_number or c.phone,
            "whatsapp_token_masked": mask_token(c.whatsapp_token),
            "has_custom_token": bool(c.whatsapp_token and not c.whatsapp_token.startswith("YOUR_")),
            "verify_token": c.verify_token,
            "is_active": c.is_active,
            "meta_configured": is_meta_configured,
            "doctor_count": doc_count,
            "appointment_count": appt_count,
            "activation_date": c.created_at.strftime("%d %b %Y") if c.created_at else "—",
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "admin_username": admin_user.username if admin_user else None,
            "admin_name": admin_user.name if admin_user else None,
            "admin_id": admin_user.id if admin_user else None,
            **get_subscription_info(c),
        })
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def create_clinic(
    payload: ClinicCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superadmin),
):
    """Creates a new clinic branch with dedicated WhatsApp Phone Number ID."""
    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Clinic name is required")

    # Generate unique code if not provided
    code = payload.code.strip().upper() if payload.code and payload.code.strip() else None
    if not code:
        count = db.query(Clinic).count() + 1
        code = f"CLN-{count:03d}"

    existing_code = db.query(Clinic).filter(Clinic.code == code).first()
    if existing_code:
        raise HTTPException(status_code=400, detail=f"Clinic code '{code}' already exists")

    # Check phone_number_id uniqueness if provided
    clean_phone_id = payload.phone_number_id.strip() if payload.phone_number_id else None
    if clean_phone_id:
        existing_pid = db.query(Clinic).filter(Clinic.phone_number_id == clean_phone_id).first()
        if existing_pid:
            raise HTTPException(
                status_code=400,
                detail=f"WhatsApp Phone Number ID '{clean_phone_id}' is already registered to '{existing_pid.name}'",
            )

    # Validate admin credentials if provided
    admin_clean_user = payload.admin_username.strip().lower() if payload.admin_username else None
    admin_clean_pass = payload.admin_password.strip() if payload.admin_password else None

    if (admin_clean_user and not admin_clean_pass) or (admin_clean_pass and not admin_clean_user):
        raise HTTPException(
            status_code=400,
            detail="Both Admin Username and Password must be provided to create the initial admin account"
        )

    if admin_clean_user:
        if len(admin_clean_user) < 3:
            raise HTTPException(status_code=400, detail="Admin username must be at least 3 characters")
        if len(admin_clean_pass) < 4:
            raise HTTPException(status_code=400, detail="Admin password must be at least 4 characters")

        existing_user = db.query(User).filter(User.username == admin_clean_user).first()
        if existing_user:
            raise HTTPException(status_code=400, detail=f"Username '{admin_clean_user}' is already registered")

    expiry_raw = payload.subscription_expiry or payload.subscription_expiry_date
    expiry_dt = parse_expiry_date(expiry_raw, payload.subscription_plan)

    clinic = Clinic(
        code=code,
        name=clean_name,
        tagline=payload.tagline.strip() if payload.tagline else None,
        address=payload.address.strip() if payload.address and payload.address.strip() else None,
        city=payload.city.strip() if payload.city and payload.city.strip() else None,
        state=payload.state.strip() if payload.state and payload.state.strip() else None,
        phone=payload.phone.strip() if payload.phone and payload.phone.strip() else None,
        email=payload.email.strip() if payload.email and payload.email.strip() else None,
        operating_hours=payload.operating_hours.strip() if payload.operating_hours and payload.operating_hours.strip() else None,
        phone_number_id=clean_phone_id,
        display_phone_number=payload.display_phone_number.strip() if payload.display_phone_number else payload.phone,
        whatsapp_token=payload.whatsapp_token.strip() if payload.whatsapp_token and payload.whatsapp_token.strip() else None,
        verify_token=payload.verify_token.strip() if payload.verify_token and payload.verify_token.strip() else None,
        is_active=payload.is_active,
        subscription_plan=payload.subscription_plan or "Monthly",
        subscription_expiry=expiry_dt,
        subscription_status=payload.subscription_status or "Active",
    )
    db.add(clinic)
    db.commit()
    db.refresh(clinic)

    # Create initial primary Admin User if credentials were provided
    admin_info = None
    if admin_clean_user and admin_clean_pass:
        admin_user = User(
            clinic_id=clinic.id,
            username=admin_clean_user,
            name=payload.admin_name.strip() if payload.admin_name and payload.admin_name.strip() else f"{clinic.name} Admin",
            password_hash=hash_password(admin_clean_pass),
            role="Admin",
            created_by=admin.username,
            is_active=True,
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
        admin_info = {
            "id": admin_user.id,
            "username": admin_user.username,
            "name": admin_user.name,
        }

    # Synchronize primary clinic info to settings and .env
    first_clinic = db.query(Clinic).order_by(Clinic.id.asc()).first()
    if first_clinic and first_clinic.id == clinic.id:
        if clinic.name:
            settings.CLINIC_NAME = clinic.name
            update_env_variable("CLINIC_NAME", clinic.name)
        if clinic.address:
            settings.CLINIC_ADDRESS = clinic.address
            update_env_variable("CLINIC_ADDRESS", clinic.address)
        if clinic.phone:
            settings.CLINIC_PHONE = clinic.phone
            update_env_variable("CLINIC_PHONE", clinic.phone)
        if clinic.operating_hours:
            settings.CLINIC_HOURS = clinic.operating_hours
            update_env_variable("CLINIC_HOURS", clinic.operating_hours)
        if clinic.phone_number_id:
            settings.PHONE_NUMBER_ID = clinic.phone_number_id
            update_env_variable("PHONE_NUMBER_ID", clinic.phone_number_id)
        if clinic.whatsapp_token:
            settings.WHATSAPP_TOKEN = clinic.whatsapp_token
            update_env_variable("WHATSAPP_TOKEN", clinic.whatsapp_token)

    return {
        "success": True,
        "message": f"Clinic '{clinic.name}' created successfully with code {clinic.code}" + (f" and Admin '{admin_clean_user}'" if admin_clean_user else ""),
        "id": clinic.id,
        "code": clinic.code,
        "admin": admin_info,
    }


@router.get("/{clinic_id}")
def get_clinic_detail(
    clinic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieves specific clinic details with tenant boundary verification."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    # Multi-tenant boundary check: Non-SuperAdmin staff can only access their assigned clinic
    if (current_user.role or "").lower() != "superadmin" and current_user.clinic_id != clinic.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You do not have permission to view records from another clinic.",
        )

    doctors = db.query(Doctor).filter(Doctor.clinic_id == clinic.id, Doctor.is_active == True).all()

    admin_user = (
        db.query(User)
        .filter(User.clinic_id == clinic.id, func.lower(User.role).in_(["admin", "client"]))
        .order_by(User.id.asc())
        .first()
    )
    if not admin_user:
        admin_user = (
            db.query(User)
            .filter(User.clinic_id == clinic.id, func.lower(User.role) != "superadmin")
            .order_by(User.id.asc())
            .first()
        )

    return {
        "id": clinic.id,
        "code": clinic.code,
        "name": clinic.name,
        "tagline": clinic.tagline,
        "address": clinic.address,
        "city": clinic.city,
        "state": clinic.state,
        "phone": clinic.phone,
        "email": clinic.email,
        "operating_hours": clinic.operating_hours,
        "phone_number_id": clinic.phone_number_id,
        "display_phone_number": clinic.display_phone_number,
        "whatsapp_token_masked": mask_token(clinic.whatsapp_token),
        "has_custom_token": bool(clinic.whatsapp_token),
        "verify_token": clinic.verify_token,
        "is_active": clinic.is_active,
        "google_maps_url": clinic.google_maps_url,
        "emergency_contact": clinic.emergency_contact,
        "departments": clinic.departments,
        "facilities": clinic.facilities,
        "reception_phone": clinic.reception_phone,
        "reception_start_time": clinic.reception_start_time,
        "reception_end_time": clinic.reception_end_time,
        "reception_days": clinic.reception_days,
        "reception_message_open": clinic.reception_message_open,
        "reception_message_closed": clinic.reception_message_closed,
        "reception_expected_wait_mins": clinic.reception_expected_wait_mins,
        "admin_username": admin_user.username if admin_user else None,
        "admin_name": admin_user.name if admin_user else None,
        "admin_id": admin_user.id if admin_user else None,
        **get_subscription_info(clinic),
        "doctors": [{"id": d.id, "name": d.name, "specialization": d.specialization} for d in doctors],
    }


@router.post("/{clinic_id}/admin-credentials")
def set_clinic_admin_credentials(
    clinic_id: int,
    payload: ClinicAdminCredentialsRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superadmin),
):
    """
    SuperAdmin creates or updates the primary Admin credentials (ID & password) for a specific clinic.
    """
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    if not payload.password or len(payload.password.strip()) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    # Find existing primary admin
    admin_user = (
        db.query(User)
        .filter(User.clinic_id == clinic.id, func.lower(User.role).in_(["admin", "client"]))
        .order_by(User.id.asc())
        .first()
    )
    if not admin_user:
        admin_user = (
            db.query(User)
            .filter(User.clinic_id == clinic.id, func.lower(User.role) != "superadmin")
            .order_by(User.id.asc())
            .first()
        )

    if admin_user:
        # Update existing admin
        if payload.username and payload.username.strip():
            clean_u = payload.username.strip().lower()
            if clean_u != admin_user.username:
                existing = db.query(User).filter(User.username == clean_u, User.id != admin_user.id).first()
                if existing:
                    raise HTTPException(status_code=400, detail=f"Username '{clean_u}' is already taken")
                admin_user.username = clean_u

        if payload.name and payload.name.strip():
            admin_user.name = payload.name.strip()

        admin_user.password_hash = hash_password(payload.password.strip())
        admin_user.is_active = True
        admin_user.role = "Admin"
        db.commit()
        db.refresh(admin_user)

        return {
            "success": True,
            "message": f"Admin credentials for '{clinic.name}' updated successfully",
            "username": admin_user.username,
            "name": admin_user.name,
        }
    else:
        # Create new primary admin for this clinic
        if not payload.username or not payload.username.strip():
            raise HTTPException(status_code=400, detail="Admin username is required to create a new clinic admin")

        clean_u = payload.username.strip().lower()
        if len(clean_u) < 3:
            raise HTTPException(status_code=400, detail="Admin username must be at least 3 characters")

        existing = db.query(User).filter(User.username == clean_u).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Username '{clean_u}' is already taken")

        new_admin = User(
            clinic_id=clinic.id,
            username=clean_u,
            name=payload.name.strip() if payload.name and payload.name.strip() else f"{clinic.name} Admin",
            password_hash=hash_password(payload.password.strip()),
            role="Admin",
            created_by=admin.username,
            is_active=True,
        )
        db.add(new_admin)
        db.commit()
        db.refresh(new_admin)

        return {
            "success": True,
            "message": f"Primary admin '{new_admin.username}' created for '{clinic.name}'",
            "username": new_admin.username,
            "name": new_admin.name,
        }


@router.put("/{clinic_id}")
def update_clinic(
    clinic_id: int,
    payload: ClinicUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superadmin),
):
    """Updates clinic branch details and WhatsApp credentials."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    if payload.name is not None and payload.name.strip():
        clinic.name = payload.name.strip()
    if payload.code is not None and payload.code.strip():
        new_code = payload.code.strip().upper()
        existing = db.query(Clinic).filter(Clinic.code == new_code, Clinic.id != clinic.id).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Clinic code '{new_code}' already in use")
        clinic.code = new_code
    if payload.tagline is not None:
        clinic.tagline = payload.tagline.strip()
    if payload.address is not None:
        clinic.address = payload.address.strip()
    if payload.city is not None:
        clinic.city = payload.city.strip()
    if payload.state is not None:
        clinic.state = payload.state.strip()
    if payload.phone is not None:
        clinic.phone = payload.phone.strip()
    if payload.email is not None:
        clinic.email = payload.email.strip()
    if payload.operating_hours is not None:
        clinic.operating_hours = payload.operating_hours.strip()

    if payload.phone_number_id is not None:
        clean_pid = payload.phone_number_id.strip() if payload.phone_number_id.strip() else None
        if clean_pid:
            existing_pid = db.query(Clinic).filter(Clinic.phone_number_id == clean_pid, Clinic.id != clinic.id).first()
            if existing_pid:
                raise HTTPException(status_code=400, detail=f"Phone Number ID '{clean_pid}' already registered to another clinic")
        clinic.phone_number_id = clean_pid

    if payload.display_phone_number is not None:
        clinic.display_phone_number = payload.display_phone_number.strip() if payload.display_phone_number.strip() else None

    # Only update token if provided and not masked placeholder
    if payload.whatsapp_token is not None:
        token = payload.whatsapp_token.strip()
        if token and not token.startswith("••••") and not token.startswith("YOUR_"):
            clinic.whatsapp_token = token
        elif token == "":
            clinic.whatsapp_token = None

    if payload.verify_token is not None:
        clinic.verify_token = payload.verify_token.strip() if payload.verify_token.strip() else None

    if payload.subscription_plan is not None:
        clinic.subscription_plan = payload.subscription_plan.strip()
    
    expiry_input = payload.subscription_expiry if payload.subscription_expiry is not None else payload.subscription_expiry_date
    if expiry_input is not None:
        if expiry_input.strip():
            clinic.subscription_expiry = parse_expiry_date(expiry_input, clinic.subscription_plan)
        else:
            clinic.subscription_expiry = None
    if payload.subscription_status is not None:
        clinic.subscription_status = payload.subscription_status.strip()

    # Phase 6: Reception Handover & Clinic Information
    if payload.google_maps_url is not None:
        clinic.google_maps_url = payload.google_maps_url.strip() if payload.google_maps_url.strip() else None
    if payload.emergency_contact is not None:
        clinic.emergency_contact = payload.emergency_contact.strip() if payload.emergency_contact.strip() else None
    if payload.departments is not None:
        clinic.departments = payload.departments.strip() if payload.departments.strip() else None
    if payload.facilities is not None:
        clinic.facilities = payload.facilities.strip() if payload.facilities.strip() else None
    if payload.reception_phone is not None:
        clinic.reception_phone = payload.reception_phone.strip() if payload.reception_phone.strip() else None
    if payload.reception_start_time is not None:
        clinic.reception_start_time = payload.reception_start_time.strip()
    if payload.reception_end_time is not None:
        clinic.reception_end_time = payload.reception_end_time.strip()
    if payload.reception_days is not None:
        clinic.reception_days = payload.reception_days.strip()
    if payload.reception_message_open is not None:
        clinic.reception_message_open = payload.reception_message_open.strip() if payload.reception_message_open.strip() else None
    if payload.reception_message_closed is not None:
        clinic.reception_message_closed = payload.reception_message_closed.strip() if payload.reception_message_closed.strip() else None
    if payload.reception_expected_wait_mins is not None:
        clinic.reception_expected_wait_mins = payload.reception_expected_wait_mins

    if payload.is_active is not None:
        clinic.is_active = payload.is_active

    db.commit()
    db.refresh(clinic)

    # Synchronize primary clinic info to settings and .env
    first_clinic = db.query(Clinic).order_by(Clinic.id.asc()).first()
    if first_clinic and first_clinic.id == clinic.id:
        try:
            if clinic.name:
                settings.CLINIC_NAME = clinic.name
                update_env_variable("CLINIC_NAME", clinic.name)
            if clinic.address:
                settings.CLINIC_ADDRESS = clinic.address
                update_env_variable("CLINIC_ADDRESS", clinic.address)
            if clinic.phone:
                settings.CLINIC_PHONE = clinic.phone
                update_env_variable("CLINIC_PHONE", clinic.phone)
            if clinic.operating_hours:
                settings.CLINIC_HOURS = clinic.operating_hours
                update_env_variable("CLINIC_HOURS", clinic.operating_hours)
            if clinic.phone_number_id is not None:
                settings.PHONE_NUMBER_ID = clinic.phone_number_id or ""
                update_env_variable("PHONE_NUMBER_ID", clinic.phone_number_id or "")
            if clinic.whatsapp_token:
                settings.WHATSAPP_TOKEN = clinic.whatsapp_token
                update_env_variable("WHATSAPP_TOKEN", clinic.whatsapp_token)
        except Exception:
            pass

    return {"success": True, "message": f"Clinic '{clinic.name}' updated successfully"}


@router.delete("/{clinic_id}")
def delete_clinic(
    clinic_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superadmin),
):
    """Deletes or deactivates a clinic branch."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    # Safety check: prevent deleting if active appointments or doctors exist
    active_appts = db.query(Appointment).filter(Appointment.clinic_id == clinic_id, Appointment.status == "CONFIRMED").count()
    if active_appts > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete clinic with {active_appts} active upcoming appointment(s). Please deactivate it instead.",
        )

    clinic.is_active = False
    db.commit()
    return {"success": True, "message": f"Clinic '{clinic.name}' has been deactivated"}


@router.post("/{clinic_id}/test-meta")
async def test_clinic_meta_connection(
    clinic_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superadmin),
):
    """Pings Meta Graph API using this clinic's Phone Number ID and Token."""
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    pid = clinic.phone_number_id or settings.PHONE_NUMBER_ID
    token = clinic.whatsapp_token or settings.WHATSAPP_TOKEN

    result = await whatsapp_client.test_connection(phone_number_id=pid, token=token)
    if isinstance(result, dict) and result.get("success") and result.get("display_phone_number"):
        try:
            clinic.display_phone_number = result.get("display_phone_number")
            db.commit()
        except Exception:
            db.rollback()
    return result
