import datetime
import time
from collections import defaultdict
from typing import Optional, Tuple
import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models import User

# Configuration
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15  # Short-lived in-memory access token (15 mins)
REFRESH_TOKEN_EXPIRE_DAYS = 7     # Secure HttpOnly refresh cookie (7 days)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# In-Memory Rate Limiting for Authentication / Sensitive Actions
# Key -> List of timestamps
_failed_attempts = defaultdict(list)


def check_login_rate_limit(identifier: str, max_attempts: int = 5, window_seconds: int = 300) -> Tuple[bool, int]:
    """
    Checks if an identifier (e.g. IP or username) has exceeded failed login threshold.
    Returns (is_allowed, retry_after_seconds).
    """
    now = time.time()
    cutoff = now - window_seconds
    # Prune expired timestamps
    attempts = [t for t in _failed_attempts[identifier] if t > cutoff]
    _failed_attempts[identifier] = attempts

    if len(attempts) >= max_attempts:
        oldest_attempt = attempts[0]
        retry_after = int(window_seconds - (now - oldest_attempt)) + 1
        return False, max(1, retry_after)
    return True, 0


def record_failed_login(identifier: str):
    """Records a failed login attempt for the given identifier."""
    _failed_attempts[identifier].append(time.time())


def clear_failed_logins(identifier: str):
    """Clears failed login records on successful authentication."""
    if identifier in _failed_attempts:
        del _failed_attempts[identifier]


def hash_password(password: str) -> str:
    """Hashes a plaintext password using bcrypt with automatic salt."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    """Creates a short-lived signed JWT access token for in-memory client storage."""
    to_encode = data.copy()
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    if expires_delta:
        expire = now_utc + expires_delta
    else:
        expire = now_utc + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """Creates a long-lived signed JWT refresh token intended exclusively for the HttpOnly cookie."""
    to_encode = data.copy()
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    expire = now_utc + datetime.timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_refresh_token(token: str) -> Optional[str]:
    """Validates the refresh token from the HttpOnly cookie and returns the username."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            return None
        return payload.get("sub")
    except JWTError:
        return None


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI Dependency: Extracts and validates the current user from the Authorization Bearer header.
    Tokens in URL query parameters are intentionally rejected to prevent log leakage.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        # Ensure refresh tokens cannot masquerade as access tokens
        if payload.get("type") and payload.get("type") != "access":
            raise credentials_exception
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is deactivated")
    return user


def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    """FastAPI Dependency: Requires the user to have SuperAdmin role."""
    if (current_user.role or "").lower() != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SuperAdmin privileges required to perform this action",
        )
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """FastAPI Dependency: Requires the user to have Admin, SuperAdmin, or Client role."""
    role = (current_user.role or "").lower()
    if role not in ["admin", "superadmin", "client"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required to perform this action",
        )
    return current_user
