import datetime
import hmac
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.sync_service import sync_service, is_internet_available
from app.models import OfflineQueue
from app.config import settings
from app.security import require_admin

logger = logging.getLogger("sync_router")

router = APIRouter(prefix="/api/sync", tags=["Offline & Cloud Sync Hub"])


class SyncConfigUpdate(BaseModel):
    cloud_sync_enabled: Optional[bool] = None
    cloud_sync_url: Optional[str] = None
    cloud_sync_api_key: Optional[str] = None
    auto_sync_interval: Optional[int] = None


class ExchangeRequest(BaseModel):
    clinic_name: Optional[str] = None
    last_synced_at: Optional[str] = None
    local_delta: Optional[Dict[str, Any]] = None


@router.get("/status", dependencies=[Depends(require_admin)])
def get_sync_status(db: Session = Depends(get_db)):
    """Real-time operational sync status: internet connectivity, outbox counts, cloud config."""
    is_online = is_internet_available()
    outbox_stats = sync_service.get_outbox_stats(db)
    config = sync_service.get_sync_config(db)

    return {
        "is_online": is_online,
        "mode": "Online" if is_online else "Offline (Local Mode)",
        "whatsapp_outbox": outbox_stats,
        "cloud_sync": config,
        "server_time": datetime.datetime.utcnow().isoformat(),
    }


@router.post("/trigger", dependencies=[Depends(require_admin)])
async def trigger_manual_sync(db: Session = Depends(get_db)):
    """Manually triggers outbox dispatch and bidirectional cloud database synchronization."""
    result = await sync_service.run_sync_cycle(db)
    return {
        "message": (
            "Sync cycle completed successfully"
            if result.get("is_online")
            else "Clinic is currently offline. Local changes remain queued."
        ),
        "result": result,
    }


@router.get("/outbox", dependencies=[Depends(require_admin)])
def list_outbox_items(
    status: Optional[str] = Query(None, description="Filter by status: PENDING, SENT, FAILED"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Lists items queued in the offline WhatsApp outbox."""
    items = sync_service.get_outbox_items(db, limit=limit, status=status)
    return {"total": len(items), "items": items}


@router.post("/outbox/{queue_id}/retry", dependencies=[Depends(require_admin)])
async def retry_outbox_item(queue_id: int, db: Session = Depends(get_db)):
    """Retries dispatching a specific queued or failed WhatsApp message."""
    item = db.query(OfflineQueue).filter(OfflineQueue.id == queue_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Outbox item not found")

    item.status = "PENDING"
    item.retry_count = 0
    item.last_error = None
    db.commit()

    if is_internet_available():
        res = await sync_service.flush_whatsapp_outbox(db)
        return {"message": f"Retried item #{queue_id}", "result": res}

    return {"message": f"Item #{queue_id} marked as pending. Will send once internet reconnects."}


@router.delete("/outbox/{queue_id}", dependencies=[Depends(require_admin)])
def delete_outbox_item(queue_id: int, db: Session = Depends(get_db)):
    """Removes a message from the offline outbox queue."""
    item = db.query(OfflineQueue).filter(OfflineQueue.id == queue_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Outbox item not found")
    db.delete(item)
    db.commit()
    return {"message": f"Outbox item #{queue_id} deleted successfully"}


@router.get("/config", dependencies=[Depends(require_admin)])
def get_sync_configuration(db: Session = Depends(get_db)):
    """Retrieves current cloud synchronization configuration."""
    return sync_service.get_sync_config(db)


@router.post("/config", dependencies=[Depends(require_admin)])
def update_sync_configuration(payload: SyncConfigUpdate, db: Session = Depends(get_db)):
    """Updates cloud synchronization URL, API key, and background interval."""
    sync_service.update_sync_config(db, payload.dict(exclude_unset=True))
    return {
        "message": "Cloud sync settings updated successfully",
        "config": sync_service.get_sync_config(db),
    }


@router.post("/exchange")
def exchange_deltas(
    payload: ExchangeRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Bidirectional data exchange endpoint.
    Used by remote cloud servers or peer instances to synchronize patients, appointments,
    prescriptions, invoices, and WhatsApp conversations.
    """
    # Enforce API key verification. If not configured, block exchange outright.
    configured_key = (sync_service.get_meta(db, "cloud_sync_api_key", settings.CLOUD_SYNC_API_KEY or "") or "").strip()
    if not configured_key:
        logger.warning("Rejected /api/sync/exchange: CLOUD_SYNC_API_KEY is not configured on this server.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cloud synchronization exchange is disabled on this server because no CLOUD_SYNC_API_KEY is configured.",
        )

    expected_bearer = f"Bearer {configured_key}"
    auth_header = (authorization or "").strip()
    if not (
        hmac.compare_digest(auth_header, expected_bearer)
        or hmac.compare_digest(auth_header, configured_key)
    ):
        logger.warning("Rejected /api/sync/exchange: invalid or missing Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized sync request. Invalid API Key.",
        )

    # 1. Merge incoming delta from peer/local
    imported = {}
    if payload.local_delta:
        imported = sync_service.import_delta(db, payload.local_delta)

    # 2. Export local delta for peer/local
    remote_delta = sync_service.export_delta(db, since=payload.last_synced_at)

    return {
        "success": True,
        "clinic_name": settings.CLINIC_NAME,
        "server_time": datetime.datetime.utcnow().isoformat(),
        "imported_into_server": imported,
        "remote_delta": remote_delta["delta"],
    }
