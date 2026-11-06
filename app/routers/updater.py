from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel

from app.security import require_superadmin, require_admin
from app.services.updater_service import updater_service

router = APIRouter(prefix="/api/updater", tags=["Software Updates"])


class ApplyUpdateRequest(BaseModel):
    download_url: Optional[str] = None


@router.get("/status", dependencies=[Depends(require_admin)])
async def get_updater_status():
    """Returns the current application version and update check status."""
    return updater_service.get_status()


@router.post("/check", dependencies=[Depends(require_admin)])
async def check_for_updates():
    """Checks for newer versions against the update server or repository."""
    return await updater_service.check_for_updates()


@router.post("/apply")
async def apply_update(payload: Optional[ApplyUpdateRequest] = None, current_user=Depends(require_superadmin)):
    """
    Downloads and applies the latest application update, restarting into the new version.
    Restricted to authenticated SuperAdmin accounts only.
    """
    custom_url = payload.download_url if payload else None
    result = await updater_service.apply_update(custom_url)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message"))
    return result
