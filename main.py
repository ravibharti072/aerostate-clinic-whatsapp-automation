import os
import logging
from pathlib import Path
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
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("aerostate_clinic")


def check_admin_account_status():
    """Checks if any administrative accounts exist; logs warning if setup is needed."""
    db = SessionLocal()
    try:
        count = db.query(User).count()
        if count == 0:
            logger.warning(
                "No user accounts exist in the database! Please run: "
                "'python create_superadmin.py <username> <password> \"<name>\"' "
                "to initialize your secure master administrator account."
            )
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schemas on startup
    Base.metadata.create_all(bind=engine)
    check_admin_account_status()
    logger.info("Aerostate Clinic WhatsApp Automation backend is ready for production!")
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Automated WhatsApp Appointment and Scheduling System for Clinics and Businesses",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration with restricted origins
allowed_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
if not allowed_origins:
    allowed_origins = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
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


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "clinic": settings.CLINIC_NAME,
        "docs_url": "/docs",
    }


# Static Frontend Serving with Directory Traversal Protection
frontend_dist = Path(__file__).resolve().parent / "frontend" / "dist"
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
