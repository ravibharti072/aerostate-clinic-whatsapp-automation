from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_refresh_token,
    get_current_user,
    check_login_rate_limit,
    record_failed_login,
    clear_failed_logins,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

REFRESH_COOKIE_NAME = "aerostate_refresh_token"
REFRESH_COOKIE_MAX_AGE = 7 * 24 * 3600  # 7 days


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    username = payload.username.strip().lower()

    # Rate limiting by IP and by username
    ip_allowed, ip_retry = check_login_rate_limit(f"ip:{client_ip}", max_attempts=10, window_seconds=300)
    user_allowed, user_retry = check_login_rate_limit(f"user:{username}", max_attempts=5, window_seconds=300)

    if not ip_allowed or not user_allowed:
        retry_after = max(ip_retry, user_retry)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Please try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    user = db.query(User).filter(User.username == username).first()

    if not user or not verify_password(payload.password, user.password_hash):
        record_failed_login(f"ip:{client_ip}")
        record_failed_login(f"user:{username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect User ID or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Contact SuperAdmin.",
        )

    # Clear failed counters upon successful authentication
    clear_failed_logins(f"ip:{client_ip}")
    clear_failed_logins(f"user:{username}")

    # 1. Issue short-lived in-memory Access Token (15 mins)
    access_token = create_access_token(data={"sub": user.username, "role": user.role})

    # 2. Issue long-lived Refresh Token in HttpOnly cookie (7 days)
    refresh_token = create_refresh_token(data={"sub": user.username})
    is_secure = request.url.scheme == "https"
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=is_secure,
        path="/api/auth",
        max_age=REFRESH_COOKIE_MAX_AGE,
    )

    doc = user.doctor if user.doctor_id else None
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "doctor_id": user.doctor_id,
            "doctor_name": doc.name if doc else None,
            "specialization": doc.specialization if doc else None,
        },
    }


@router.post("/refresh", response_model=LoginResponse)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Exchanges the HttpOnly refresh token cookie for a brand new short-lived in-memory access token.
    JavaScript cannot read this cookie; it is sent automatically by the browser with credentials: 'include'.
    """
    refresh_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh session cookie present",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = verify_refresh_token(refresh_cookie)
    if not username:
        response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired or is invalid. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active:
        response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated or no longer exists.",
        )

    # Issue a fresh short-lived access token
    new_access_token = create_access_token(data={"sub": user.username, "role": user.role})

    doc = user.doctor if user.doctor_id else None
    return {
        "access_token": new_access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "doctor_id": user.doctor_id,
            "doctor_name": doc.name if doc else None,
            "specialization": doc.specialization if doc else None,
        },
    }


@router.post("/logout")
def logout(response: Response):
    """Clears the HttpOnly refresh token cookie on server side."""
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth")
    return {"message": "Logged out successfully"}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    doc = current_user.doctor if current_user.doctor_id else None
    return {
        "id": current_user.id,
        "username": current_user.username,
        "name": current_user.name,
        "role": current_user.role,
        "doctor_id": current_user.doctor_id,
        "doctor_name": doc.name if doc else None,
        "specialization": doc.specialization if doc else None,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
    }
