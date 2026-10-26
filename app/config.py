import logging
import secrets
from pydantic_settings import BaseSettings
from typing import Optional

logger = logging.getLogger("aerostate_clinic.config")


class Settings(BaseSettings):
    PROJECT_NAME: str = "Aerostate Clinic WhatsApp Automation"
    
    # Meta WhatsApp Cloud API credentials
    WHATSAPP_TOKEN: str = "YOUR_META_PERMANENT_OR_TEMPORARY_TOKEN"
    PHONE_NUMBER_ID: str = "YOUR_WHATSAPP_PHONE_NUMBER_ID"
    VERIFY_TOKEN: str = "aerostate_secret_verify_token_2026"
    META_GRAPH_VERSION: str = "v21.0"
    META_APP_SECRET: Optional[str] = None

    # Security & CORS
    SECRET_KEY: str = ""
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://localhost:8000,http://127.0.0.1:5173,http://127.0.0.1:8000"

    # Database
    DATABASE_URL: str = "sqlite:///./clinic.db"

    # Optional Gemini AI API Key for Natural Language Booking
    GEMINI_API_KEY: Optional[str] = None

    # Clinic Profile & Healthcare Registry
    CLINIC_NAME: str = "Aerostate Speciality Clinic"
    CLINIC_TAGLINE: str = "Medical Center & OPD Consultation Services"
    CLINIC_REG_NO: str = "UP-AGR-2026-MED"
    CLINIC_ADDRESS: str = "Plot 14, Fatehabad Road, Tajganj, Agra (U.P.) - 282001"
    CLINIC_PHONE: str = "+91 98765 43210"
    CLINIC_EMAIL: str = "contact@aerostateclinic.com"
    CLINIC_HOURS: str = "Mon - Sat: 09:00 AM - 08:00 PM"

    # Clinical Policies & Operational Standards
    OPD_SLOT_DURATION: int = 15
    CHECKIN_GRACE_PERIOD: int = 15
    EMERGENCY_TAT: int = 30
    LAB_TAT_STANDARD: int = 24
    FOLLOWUP_DAYS: int = 7

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Ensure a secure random key is present if missing from .env
if not settings.SECRET_KEY or settings.SECRET_KEY.startswith("YOUR_"):
    settings.SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        "PRODUCTION WARNING: SECRET_KEY is not defined in .env! Generated an ephemeral key. "
        "User sessions will NOT persist across server restarts or multi-worker processes. "
        "Run `python -c \"import secrets; print(secrets.token_hex(32))\"` and set SECRET_KEY in your server .env file."
    )
