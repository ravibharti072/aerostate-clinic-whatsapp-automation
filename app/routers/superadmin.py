from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import User, Clinic
from app.security import require_superadmin, hash_password

router = APIRouter(prefix="/api/superadmin", tags=["SuperAdmin Management"])


class UserCreateRequest(BaseModel):
    username: str
    name: str
    password: str
    role: str = "Client"  # SuperAdmin or Client
    clinic_id: Optional[int] = None
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    clinic_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@router.get("/stats")
def get_superadmin_stats(
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_superadmin),
):
    """
    100% backend-calculated user statistics for SuperAdmin and Client accounts.
    """
    total_users = db.query(User).count()
    clients = db.query(User).filter(func.lower(User.role) != "superadmin").count()
    active_clients = db.query(User).filter(User.is_active == True, func.lower(User.role) != "superadmin").count()
    superadmins = db.query(User).filter(func.lower(User.role) == "superadmin").count()
    total_clinics = db.query(Clinic).count()
    active_clinics = db.query(Clinic).filter(Clinic.is_active == True).count()

    return {
        "kpis": {
            "total_users": {
                "value": total_users,
                "trend": "All Accounts",
            },
            "client_accounts": {
                "value": clients,
                "trend": "Clinic Access",
            },
            "active_clients": {
                "value": active_clients,
                "trend": "Active Licenses",
            },
            "superadmins": {
                "value": superadmins,
                "trend": "Root Authority",
            },
            "total_clinics": {
                "value": total_clinics,
                "trend": f"{active_clinics} Active Branches",
            },
        }
    }


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_superadmin),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "name": u.name,
            "role": "SuperAdmin" if (u.role or "").lower() == "superadmin" else "Client",
            "role_theme": "purple" if (u.role or "").lower() == "superadmin" else "teal",
            "clinic_id": u.clinic_id,
            "clinic_name": u.clinic.name if u.clinic else "Global (All Clinics)",
            "is_active": u.is_active,
            "status_display": "Active" if u.is_active else "Inactive",
            "created_date_display": u.created_at.strftime("%Y-%m-%d") if u.created_at else "-",
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_superadmin),
):
    clean_username = payload.username.strip().lower()

    if not clean_username or not payload.password.strip():
        raise HTTPException(status_code=400, detail="Username and password are required")

    existing = db.query(User).filter(User.username == clean_username).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"User with ID '{clean_username}' already exists. Please choose another username.",
        )

    assigned_role = "SuperAdmin" if (payload.role or "").lower() == "superadmin" else "Client"

    new_user = User(
        username=clean_username,
        name=payload.name.strip() or clean_username,
        password_hash=hash_password(payload.password),
        role=assigned_role,
        clinic_id=payload.clinic_id,
        is_active=payload.is_active,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User created successfully",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "name": new_user.name,
            "role": new_user.role,
            "clinic_id": new_user.clinic_id,
            "is_active": new_user.is_active,
        },
    }


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_superadmin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_admin.id and payload.role and payload.role.lower() != "superadmin":
        raise HTTPException(status_code=400, detail="Cannot demote your own SuperAdmin account")

    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.role is not None:
        user.role = "SuperAdmin" if payload.role.strip().lower() == "superadmin" else "Client"
    if payload.clinic_id is not None:
        user.clinic_id = payload.clinic_id if payload.clinic_id > 0 else None
    if payload.is_active is not None:
        if user.id == current_admin.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="Cannot deactivate your own active session")
        user.is_active = payload.is_active
    if payload.password and payload.password.strip():
        user.password_hash = hash_password(payload.password)

    db.commit()
    db.refresh(user)

    return {
        "message": "User updated successfully",
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "is_active": user.is_active,
        },
    }


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_superadmin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own SuperAdmin account")

    db.delete(user)
    db.commit()
    return {"message": f"User '{user.username}' deleted successfully"}
