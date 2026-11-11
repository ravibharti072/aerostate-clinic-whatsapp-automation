import os
import sys
import datetime
from pathlib import Path

# Safe stream fallback for windowed / GUI executable (console=False)
class SafeStream:
    def write(self, s):
        pass
    def writelines(self, lines):
        pass
    def flush(self):
        pass
    def isatty(self):
        return False
    @property
    def encoding(self):
        return "utf-8"

if sys.stdout is None:
    sys.stdout = SafeStream()
if sys.stderr is None:
    sys.stderr = SafeStream()
if getattr(sys, "stdin", None) is None:
    import io
    sys.stdin = io.StringIO("")

# When running as a compiled standalone executable, ensure working directory is where .exe is located
if getattr(sys, "frozen", False):
    exe_dir = Path(sys.executable).resolve().parent
    os.chdir(exe_dir)
    # Ensure clinic.db exists from bundled seed on first launch
    local_db = exe_dir / "clinic.db"
    if not local_db.exists() and hasattr(sys, "_MEIPASS"):
        bundled_db = Path(sys._MEIPASS) / "clinic.db"
        if bundled_db.exists():
            import shutil
            try:
                shutil.copy2(bundled_db, local_db)
            except Exception:
                pass

import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import settings
from app.database import Base, engine, SessionLocal
from app.models import User
from app.routers import (
    webhook,
    admin,
    auth,
    superadmin,
    prescriptions,
    billing,
    queue,
    analytics,
    automation,
    patients,
    consultations,
    laboratory,
    pharmacy,
    staff,
    users,
    clinics,
    sync,
    updater,
    abdm,
    payments,
    notifications,
    reception,
    faq,
    post_appointment,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("aerostate_clinic")


def check_admin_account_status():
    """Ensures baseline administrative account exists securely and deactivates default demo accounts."""
    db = SessionLocal()
    try:
        import secrets
        from app.security import hash_password

        # 1. Ensure at least one SuperAdmin exists without hardcoded static passwords
        superadmin_user = db.query(User).filter(User.role.ilike("superadmin")).first()
        if not superadmin_user:
            bootstrap_pwd = secrets.token_urlsafe(12)
            admin_user = User(
                username="superadmin",
                name="Clinic SuperAdmin",
                password_hash=hash_password(bootstrap_pwd),
                role="SuperAdmin",
                is_active=True,
            )
            db.add(admin_user)
            logger.warning(
                "\n" + "=" * 70 + "\n"
                "[SECURITY] Initialized new SuperAdmin account:\n"
                "  Username: superadmin\n"
                f"  Generated Password: {bootstrap_pwd}\n"
                "Change this password immediately or run create_superadmin.py to set a custom one.\n"
                + "=" * 70
            )

        # 2. Ensure clinic admin demo account is active
        demo_user = db.query(User).filter(User.username == "demo").first()
        if demo_user and not demo_user.is_active:
            demo_user.is_active = True

        db.commit()
    finally:
        db.close()


def ensure_default_clinic_and_doctors():
    """Initializes baseline clinic profile and doctor record if empty."""
    db = SessionLocal()
    try:
        from app.models import Clinic, Doctor
        if db.query(Clinic).count() == 0:
            c = Clinic(
                code="CLN-001",
                name="Aerostate Speciality Clinic",
                tagline="Medical Center & OPD Consultation Services",
                address="Plot 14, Fatehabad Road, Tajganj, Agra (U.P.) - 282001",
                phone="+91 98765 43210",
                email="contact@aerostateclinic.com",
                is_active=True,
            )
            db.add(c)
            db.commit()

        if db.query(Doctor).count() == 0:
            d = Doctor(
                name="Dr. Amit Sharma",
                specialization="General Medicine & Cardiology",
                available_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday",
                start_time="09:00",
                end_time="17:00",
                slot_duration_mins=15,
                consultation_fee=500,
                is_active=True,
            )
            db.add(d)
            db.commit()
    finally:
        db.close()


def ensure_subscription_columns():
    """Ensures subscription columns exist on clinics table and initializes defaults."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "subscription_plan" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN subscription_plan VARCHAR(50) DEFAULT 'Monthly'"))
                if "subscription_expiry" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN subscription_expiry DATETIME"))
                if "subscription_status" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN subscription_status VARCHAR(30) DEFAULT 'Active'"))
                conn.commit()

        db = SessionLocal()
        try:
            from app.models import Clinic
            now = datetime.datetime.utcnow()
            for c in db.query(Clinic).all():
                if not c.subscription_expiry:
                    c.subscription_plan = "Monthly"
                    c.subscription_expiry = now + datetime.timedelta(days=30)
                    c.subscription_status = "Active"
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Subscription column initialization note: {e}")


def ensure_abha_columns():
    """Ensures ABHA (Ayushman Bharat Digital Mission) columns exist on patients table."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "patients" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("patients")]
                if "abha_number" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_number VARCHAR(30)"))
                if "abha_address" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_address VARCHAR(100)"))
                if "abha_status" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_status VARCHAR(30) DEFAULT 'UNLINKED'"))
                if "abha_profile_photo" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_profile_photo TEXT"))
                if "abha_meta" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_meta TEXT DEFAULT '{}'"))
                conn.commit()
    except Exception as e:
        logger.warning(f"ABHA column initialization note: {e}")



def ensure_phase3_columns():
    """Ensures clinic booking/payment configuration columns and non-unique patients.phone index."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "payment_policy" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN payment_policy VARCHAR(30) DEFAULT 'PAY_AT_CLINIC'"))
                if "advance_amount" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN advance_amount INTEGER DEFAULT 200"))
                if "advance_percentage" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN advance_percentage INTEGER"))
                if "require_age" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN require_age BOOLEAN DEFAULT 0"))
                if "require_gender" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN require_gender BOOLEAN DEFAULT 0"))
                if "require_reason" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN require_reason BOOLEAN DEFAULT 0"))
                if "payment_link_expiry_mins" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN payment_link_expiry_mins INTEGER DEFAULT 30"))

            if "patients" in insp.get_table_names():
                conn.execute(text("DROP INDEX IF EXISTS ix_patients_phone"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_patients_phone ON patients (phone)"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Phase 3 column initialization note: {e}")


def ensure_phase4_columns():
    """Ensures Phase 4 rescheduling and cancellation policy columns exist in clinics and appointments tables."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "reschedule_cutoff_hours" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reschedule_cutoff_hours INTEGER DEFAULT 2"))
                if "cancel_cutoff_hours" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN cancel_cutoff_hours INTEGER DEFAULT 2"))
                if "cancellation_policy_text" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN cancellation_policy_text VARCHAR(255) DEFAULT 'Cancellations allowed up to 2 hours before appointment.'"))
                if "max_reschedules" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN max_reschedules INTEGER DEFAULT 3"))

            if "appointments" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("appointments")]
                if "reschedule_count" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN reschedule_count INTEGER DEFAULT 0"))
                if "previous_slot" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN previous_slot VARCHAR(100)"))
                if "cancelled_at" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN cancelled_at DATETIME"))
                if "cancellation_reason" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN cancellation_reason VARCHAR(255)"))
                if "cancellation_source" not in cols:
                    conn.execute(text("ALTER TABLE appointments ADD COLUMN cancellation_source VARCHAR(30)"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Phase 4 column initialization note: {e}")


def ensure_phase5_columns():
    """Ensures Phase 5 notification settings and reminder columns exist in clinics table."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "timezone" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN timezone VARCHAR(50) DEFAULT 'Asia/Kolkata'"))
                if "reminder_24h_enabled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reminder_24h_enabled BOOLEAN DEFAULT 1"))
                if "reminder_2h_enabled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reminder_2h_enabled BOOLEAN DEFAULT 1"))
                if "reminder_template_24h" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reminder_template_24h TEXT"))
                if "reminder_template_2h" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reminder_template_2h TEXT"))
                if "notify_booking_confirmed" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN notify_booking_confirmed BOOLEAN DEFAULT 1"))
                if "notify_booking_rescheduled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN notify_booking_rescheduled BOOLEAN DEFAULT 1"))
                if "notify_booking_cancelled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN notify_booking_cancelled BOOLEAN DEFAULT 1"))
                if "notify_payment_confirmed" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN notify_payment_confirmed BOOLEAN DEFAULT 1"))
                if "notify_payment_failed" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN notify_payment_failed BOOLEAN DEFAULT 1"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Phase 5 column initialization note: {e}")


def ensure_phase6_columns():
    """Ensures Phase 6 reception handover and clinic information columns exist in clinics table."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "google_maps_url" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN google_maps_url TEXT"))
                if "emergency_contact" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN emergency_contact VARCHAR(255)"))
                if "departments" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN departments TEXT"))
                if "facilities" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN facilities TEXT"))
                if "reception_phone" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_phone VARCHAR(30)"))
                if "reception_start_time" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_start_time VARCHAR(10) DEFAULT '09:00'"))
                if "reception_end_time" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_end_time VARCHAR(10) DEFAULT '18:00'"))
                if "reception_days" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_days VARCHAR(100) DEFAULT 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday'"))
                if "reception_message_open" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_message_open TEXT"))
                if "reception_message_closed" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_message_closed TEXT"))
                if "reception_expected_wait_mins" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN reception_expected_wait_mins INTEGER"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Phase 6 column initialization note: {e}")


def ensure_phase7_columns():
    """Ensures Phase 7 emergency signs and ABHA verification columns exist."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "emergency_keywords" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN emergency_keywords TEXT"))

            if "patients" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("patients")]
                if "abha_verification_source" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_verification_source VARCHAR(50)"))
                if "abha_consented_at" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_consented_at DATETIME"))
                if "abha_verified_at" not in cols:
                    conn.execute(text("ALTER TABLE patients ADD COLUMN abha_verified_at DATETIME"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Phase 7 column initialization note: {e}")


def ensure_phase8_columns():
    """Ensures Phase 8 post-appointment, feedback, follow-up, and document access columns exist."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            if "clinics" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("clinics")]
                if "feedback_enabled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN feedback_enabled BOOLEAN DEFAULT 1"))
                if "feedback_template" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN feedback_template TEXT"))
                if "followup_reminders_enabled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN followup_reminders_enabled BOOLEAN DEFAULT 1"))
                if "followup_default_days" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN followup_default_days INTEGER DEFAULT 7"))
                if "followup_template" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN followup_template TEXT"))
                if "document_access_enabled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN document_access_enabled BOOLEAN DEFAULT 1"))
                if "document_token_expiry_hours" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN document_token_expiry_hours INTEGER DEFAULT 24"))
                if "payment_receipt_enabled" not in cols:
                    conn.execute(text("ALTER TABLE clinics ADD COLUMN payment_receipt_enabled BOOLEAN DEFAULT 1"))
            conn.commit()
    except Exception as e:
        logger.warning(f"Phase 8 column initialization note: {e}")


def ensure_session_and_dedup_tables():
    """Ensures processed_webhook_messages exists and conversation_sessions has multi-tenant (clinic_id, phone) schema."""
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            insp = inspect(engine)
            tables = insp.get_table_names()

            # 1. Processed Webhook Messages (Idempotency)
            if "processed_webhook_messages" not in tables:
                conn.execute(text("""
                    CREATE TABLE processed_webhook_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        meta_id VARCHAR(120) UNIQUE NOT NULL,
                        clinic_id INTEGER REFERENCES clinics(id),
                        phone VARCHAR(30),
                        message_type VARCHAR(30),
                        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                """))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_processed_webhook_messages_meta_id ON processed_webhook_messages (meta_id);"))
                conn.commit()

            # 2. Multi-tenant Conversation Sessions
            if "conversation_sessions" in tables:
                cols = [c["name"] for c in insp.get_columns("conversation_sessions")]
                if "clinic_id" not in cols:
                    conn.execute(text("""
                        CREATE TABLE conversation_sessions_v2 (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            clinic_id INTEGER NOT NULL DEFAULT 1 REFERENCES clinics(id),
                            phone VARCHAR(30) NOT NULL,
                            step VARCHAR(50) DEFAULT 'IDLE',
                            context_data TEXT DEFAULT '{}',
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_clinic_phone_session UNIQUE (clinic_id, phone)
                        );
                    """))
                    conn.execute(text("""
                        INSERT INTO conversation_sessions_v2 (clinic_id, phone, step, context_data, updated_at)
                        SELECT 1, phone, step, context_data, updated_at FROM conversation_sessions;
                    """))
                    conn.execute(text("DROP TABLE conversation_sessions;"))
                    conn.execute(text("ALTER TABLE conversation_sessions_v2 RENAME TO conversation_sessions;"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversation_sessions_clinic_id ON conversation_sessions (clinic_id);"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conversation_sessions_phone ON conversation_sessions (phone);"))
                    conn.commit()
                    logger.info("Migrated conversation_sessions to multi-tenant (clinic_id, phone) schema.")
    except Exception as e:
        logger.warning(f"Session / dedup table initialization note: {e}")


async def background_sync_worker():
    """Periodically checks connectivity, flushes WhatsApp outbox, and syncs cloud database."""
    from app.services.sync_service import sync_service
    import asyncio
    while True:
        try:
            await sync_service.run_sync_cycle()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Background sync note: {e}")
        try:
            await asyncio.sleep(settings.AUTO_SYNC_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            break

# Ensure essential tables and schema columns are present on import
Base.metadata.create_all(bind=engine)
ensure_session_and_dedup_tables()
ensure_phase3_columns()
ensure_phase4_columns()
ensure_phase5_columns()
ensure_phase6_columns()
ensure_phase7_columns()
ensure_phase8_columns()

async def background_update_checker():
    import asyncio
    if getattr(settings, 'AUTO_UPDATE_ON_STARTUP', True):
        await asyncio.sleep(3.0)
        try:
            from app.services.updater_service import updater_service
            await updater_service.check_for_updates()
        except Exception as e:
            logger.debug(f"Background update check note: {e}")

async def background_reminder_worker():
    """Runs periodic appointment reminder checks in the background (every 10 mins)."""
    import asyncio
    while True:
        try:
            await asyncio.sleep(600)  # 10 minutes interval
            from app.services.notifications import notification_service
            db = SessionLocal()
            try:
                await notification_service.process_due_reminders(db)
                await notification_service.retry_failed_notifications(db)
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Background reminder worker cycle note: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    # Initialize DB schemas on startup
    Base.metadata.create_all(bind=engine)
    ensure_session_and_dedup_tables()
    ensure_phase3_columns()
    ensure_phase4_columns()
    ensure_phase5_columns()
    ensure_phase6_columns()
    ensure_phase7_columns()
    ensure_phase8_columns()
    ensure_subscription_columns()
    ensure_abha_columns()
    check_admin_account_status()
    ensure_default_clinic_and_doctors()
    logger.info("Aerostate Clinic WhatsApp Automation backend is ready for production!")
    
    # Start background auto-sync, auto-update, and scheduled reminder workers
    sync_worker_task = asyncio.create_task(background_sync_worker())
    update_worker_task = asyncio.create_task(background_update_checker())
    reminder_worker_task = asyncio.create_task(background_reminder_worker())
    try:
        yield
    finally:
        sync_worker_task.cancel()
        update_worker_task.cancel()
        reminder_worker_task.cancel()
        try:
            await sync_worker_task
        except asyncio.CancelledError:
            pass
        try:
            await update_worker_task
        except asyncio.CancelledError:
            pass
        try:
            await reminder_worker_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Automated WhatsApp Appointment and Scheduling System for Clinics and Businesses",
    version="2.2.5",
    lifespan=lifespan,
)

# CORS Configuration with restricted origins
allowed_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
if not allowed_origins:
    allowed_origins = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Enforces standard enterprise web security headers across all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# Include routers
app.include_router(auth.router)
app.include_router(superadmin.router)
app.include_router(webhook.router)
app.include_router(admin.router)
app.include_router(prescriptions.router)
app.include_router(billing.router)
app.include_router(queue.router)
app.include_router(analytics.router)
app.include_router(automation.router)
app.include_router(patients.router)
app.include_router(consultations.router)
app.include_router(laboratory.router)
app.include_router(pharmacy.router)
app.include_router(staff.router)
app.include_router(users.router)
app.include_router(clinics.router)
app.include_router(sync.router)
app.include_router(updater.router)
app.include_router(abdm.router)
app.include_router(payments.router)
app.include_router(notifications.router)
app.include_router(reception.router)
app.include_router(faq.router)
app.include_router(post_appointment.router)


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "clinic": settings.CLINIC_NAME,
        "docs_url": "/docs",
    }


# Static Frontend Serving with Directory Traversal Protection
def get_frontend_dist() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        bundled = Path(sys._MEIPASS) / "frontend" / "dist"
        if bundled.exists() and bundled.is_dir():
            return bundled
    if getattr(sys, "frozen", False):
        next_to_exe = Path(sys.executable).resolve().parent / "frontend" / "dist"
        if next_to_exe.exists() and next_to_exe.is_dir():
            return next_to_exe
    return Path(__file__).resolve().parent / "frontend" / "dist"

frontend_dist = get_frontend_dist()
if frontend_dist.exists() and frontend_dist.is_dir():
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists() and assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        normalized_path = full_path.lstrip("/\\")

        # Disallow access to backend API prefixes
        for reserved in ("admin", "api", "webhook", "docs", "openapi.json"):
            if normalized_path.startswith(reserved):
                raise HTTPException(status_code=404, detail="Not Found")

        # Resolve path safely inside frontend_dist
        try:
            target_path = (frontend_dist / normalized_path).resolve()
        except Exception:
            raise HTTPException(status_code=404, detail="Not Found")

        # Prevent Directory Traversal: path must be strictly inside frontend_dist
        try:
            target_path.relative_to(frontend_dist)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not Found")

        # Disallow hidden files or dotfiles
        if any(part.startswith(".") for part in target_path.parts):
            raise HTTPException(status_code=404, detail="Not Found")

        if target_path.is_file():
            return FileResponse(str(target_path))

        index_file = frontend_dist / "index.html"
        if index_file.is_file():
            return FileResponse(str(index_file))
        raise HTTPException(status_code=404, detail="Not Found")
else:
    @app.get("/")
    def root_info():
        return {
            "status": "healthy",
            "service": settings.PROJECT_NAME,
            "clinic": settings.CLINIC_NAME,
            "docs_url": "/docs",
            "note": "Build frontend via 'cd frontend && npm run build' to serve UI here, or run 'npm run dev'.",
        }


def find_available_port(preferred_port: int = 8000, max_tries: int = 50) -> int:
    import socket
    for p in range(preferred_port, preferred_port + max_tries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("0.0.0.0", p))
                return p
        except OSError:
            continue
    return preferred_port


def wait_for_server(port: int, timeout: float = 12.0) -> bool:
    import socket
    import time
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


if __name__ == "__main__":
    import uvicorn
    import webbrowser
    import threading
    import time

    if getattr(sys, "frozen", False):
        port = find_available_port(8000)
        url = f"http://localhost:{port}"

        # Start uvicorn server in a background daemon thread
        config = uvicorn.Config(app, host="0.0.0.0", port=port, log_config=None, log_level="warning")
        server = uvicorn.Server(config)
        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()

        # Wait until server is listening
        wait_for_server(port)

        # Launch native desktop application window
        window_launched = False
        try:
            import webview
            window = webview.create_window(
                title="Aerostate Speciality Clinic",
                url=url,
                width=1340,
                height=880,
                min_size=(960, 640),
            )
            webview.start()
            window_launched = True
        except Exception as e:
            logger.warning(f"Native desktop window unavailable ({e}); falling back to web browser.")

        # Fallback to web browser if webview was not launched
        if not window_launched:
            webbrowser.open(url)
            try:
                while server_thread.is_alive():
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
