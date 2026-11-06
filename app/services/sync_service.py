import json
import socket
import logging
import datetime
from typing import Dict, Any, Optional, List
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.database import SessionLocal
from app.config import settings
from app.models import (
    OfflineQueue,
    SyncRecord,
    SyncMeta,
    Patient,
    Appointment,
    Doctor,
    Consultation,
    Prescription,
    Invoice,
    LabOrder,
    WhatsAppMessage,
)

logger = logging.getLogger("sync_service")

# In-memory cached internet state
_last_connectivity_check: Optional[datetime.datetime] = None
_cached_is_online: bool = True


def is_internet_available(timeout: float = 1.5) -> bool:
    """
    Performs a fast TCP socket check to public DNS (8.8.8.8:53).
    Caches result for 5 seconds to prevent network overhead during rapid actions.
    """
    global _last_connectivity_check, _cached_is_online
    now = datetime.datetime.utcnow()

    if _last_connectivity_check and (now - _last_connectivity_check).total_seconds() < 5.0:
        return _cached_is_online

    try:
        # Fast DNS socket check (8.8.8.8:53)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex(("8.8.8.8", 53))
        sock.close()
        _cached_is_online = (result == 0)
    except Exception:
        _cached_is_online = False

    _last_connectivity_check = now
    return _cached_is_online


class SyncService:
    @staticmethod
    def get_meta(db: Session, key: str, default: Optional[str] = None) -> Optional[str]:
        item = db.query(SyncMeta).filter(SyncMeta.key == key).first()
        return item.value if item else default

    @staticmethod
    def set_meta(db: Session, key: str, value: str):
        item = db.query(SyncMeta).filter(SyncMeta.key == key).first()
        if not item:
            item = SyncMeta(key=key, value=value, updated_at=datetime.datetime.utcnow())
            db.add(item)
        else:
            item.value = value
            item.updated_at = datetime.datetime.utcnow()
        db.commit()

    # ----------------------------------------------------
    # WhatsApp Offline Outbox
    # ----------------------------------------------------

    @staticmethod
    def enqueue_whatsapp(
        db: Session,
        recipient: Optional[str],
        payload: Dict[str, Any],
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
        clinic_id: Optional[int] = None,
        queue_type: str = "whatsapp_message",
        last_error: Optional[str] = None,
    ) -> OfflineQueue:
        """Saves a WhatsApp dispatch payload into local SQLite outbox queue."""
        queue_item = OfflineQueue(
            clinic_id=clinic_id,
            queue_type=queue_type,
            recipient=recipient or payload.get("to"),
            payload=json.dumps({
                "payload": payload,
                "phone_number_id": phone_number_id,
                "token": token,
            }),
            status="PENDING",
            retry_count=0,
            last_error=last_error,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(queue_item)
        db.commit()
        db.refresh(queue_item)
        logger.info(f"Queued outbound WhatsApp to {queue_item.recipient} (Queue ID: #{queue_item.id})")
        return queue_item

    @staticmethod
    def get_outbox_stats(db: Session) -> Dict[str, Any]:
        """Calculates outbox metrics."""
        pending = db.query(OfflineQueue).filter(OfflineQueue.status == "PENDING").count()
        failed = db.query(OfflineQueue).filter(OfflineQueue.status == "FAILED").count()
        sent = db.query(OfflineQueue).filter(OfflineQueue.status == "SENT").count()
        total = db.query(OfflineQueue).count()
        return {
            "pending": pending,
            "failed": failed,
            "sent": sent,
            "total": total,
        }

    @staticmethod
    def get_outbox_items(
        db: Session, limit: int = 50, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Lists recent queue items with previews."""
        query = db.query(OfflineQueue)
        if status:
            query = query.filter(OfflineQueue.status == status)
        items = query.order_by(desc(OfflineQueue.id)).limit(limit).all()

        results = []
        for it in items:
            text_preview = ""
            try:
                data = json.loads(it.payload)
                p = data.get("payload", {})
                if p.get("type") == "text":
                    text_preview = p.get("text", {}).get("body", "")
                elif p.get("type") == "interactive":
                    text_preview = p.get("interactive", {}).get("body", {}).get("text", "")
            except Exception:
                text_preview = "(Binary or Structured Payload)"

            results.append({
                "id": it.id,
                "recipient": it.recipient,
                "queue_type": it.queue_type,
                "status": it.status,
                "retry_count": it.retry_count,
                "last_error": it.last_error,
                "created_at": it.created_at.isoformat() if it.created_at else None,
                "processed_at": it.processed_at.isoformat() if it.processed_at else None,
                "preview": text_preview[:80] + ("..." if len(text_preview) > 80 else ""),
            })
        return results

    @staticmethod
    async def flush_whatsapp_outbox(db: Session, force: bool = False) -> Dict[str, Any]:
        """Dispatches all pending WhatsApp messages in the outbox."""
        online = is_internet_available()
        if not online and not force:
            return {
                "success": False,
                "is_online": False,
                "processed": 0,
                "sent": 0,
                "failed": 0,
                "message": "System is currently offline. Outbox items remain safely queued.",
            }

        from app.services.whatsapp import whatsapp_client

        pending_items = (
            db.query(OfflineQueue)
            .filter(OfflineQueue.status == "PENDING")
            .order_by(OfflineQueue.id.asc())
            .limit(100)
            .all()
        )

        sent_count = 0
        failed_count = 0

        for it in pending_items:
            try:
                data = json.loads(it.payload)
                payload = data.get("payload")
                pid = data.get("phone_number_id")
                tok = data.get("token")

                it.status = "PROCESSING"
                db.commit()

                # Call direct send
                res = await whatsapp_client.send_raw_payload(payload, phone_number_id=pid, token=tok)
                if res and (res.get("messages") or res.get("simulated")):
                    it.status = "SENT"
                    it.processed_at = datetime.datetime.utcnow()
                    it.last_error = None
                    sent_count += 1
                else:
                    it.status = "PENDING"
                    it.retry_count += 1
                    it.last_error = f"Meta API response: {res}"
                    if it.retry_count >= 5:
                        it.status = "FAILED"
                    failed_count += 1
                db.commit()
            except Exception as e:
                it.status = "PENDING"
                it.retry_count += 1
                it.last_error = str(e)
                if it.retry_count >= 5:
                    it.status = "FAILED"
                db.commit()
                failed_count += 1

        SyncService.set_meta(db, "last_whatsapp_sync_timestamp", datetime.datetime.utcnow().isoformat())

        return {
            "success": True,
            "is_online": True,
            "processed": len(pending_items),
            "sent": sent_count,
            "failed": failed_count,
            "remaining_pending": db.query(OfflineQueue).filter(OfflineQueue.status == "PENDING").count(),
        }

    # ----------------------------------------------------
    # Cloud Data Sync (Bidirectional Delta Sync)
    # ----------------------------------------------------

    @staticmethod
    def get_sync_config(db: Session) -> Dict[str, Any]:
        """Returns cloud sync settings, preferring database persistence over .env defaults."""
        enabled_str = SyncService.get_meta(db, "cloud_sync_enabled", str(settings.CLOUD_SYNC_ENABLED))
        cloud_url = SyncService.get_meta(db, "cloud_sync_url", settings.CLOUD_SYNC_URL or "")
        api_key = SyncService.get_meta(db, "cloud_sync_api_key", settings.CLOUD_SYNC_API_KEY or "")
        interval_str = SyncService.get_meta(db, "auto_sync_interval", str(settings.AUTO_SYNC_INTERVAL_SECONDS))
        last_cloud_sync = SyncService.get_meta(db, "last_cloud_sync_timestamp", None)
        last_whatsapp_sync = SyncService.get_meta(db, "last_whatsapp_sync_timestamp", None)

        return {
            "cloud_sync_enabled": enabled_str.lower() in ("true", "1", "yes"),
            "cloud_sync_url": cloud_url or "",
            "cloud_sync_api_key": (api_key[:6] + "••••••••" if len(api_key) > 8 else ("Configured" if api_key else "")),
            "has_api_key": bool(api_key),
            "auto_sync_interval": int(interval_str or 30),
            "last_cloud_sync_timestamp": last_cloud_sync,
            "last_whatsapp_sync_timestamp": last_whatsapp_sync,
            "is_online": is_internet_available(),
        }

    @staticmethod
    def update_sync_config(db: Session, config: Dict[str, Any]):
        """Persists updated cloud sync settings into SyncMeta."""
        if "cloud_sync_enabled" in config:
            SyncService.set_meta(db, "cloud_sync_enabled", str(bool(config["cloud_sync_enabled"])))
        if "cloud_sync_url" in config:
            SyncService.set_meta(db, "cloud_sync_url", (config["cloud_sync_url"] or "").strip().rstrip("/"))
        if "cloud_sync_api_key" in config and config["cloud_sync_api_key"]:
            clean_key = config["cloud_sync_api_key"].strip()
            if not clean_key.startswith("••"):
                SyncService.set_meta(db, "cloud_sync_api_key", clean_key)
        if "auto_sync_interval" in config:
            SyncService.set_meta(db, "auto_sync_interval", str(int(config["auto_sync_interval"])))

    @staticmethod
    def record_change(
        db: Session,
        entity_type: str,
        entity_uid: Optional[str],
        entity_id: Optional[int],
        payload: Dict[str, Any],
        action: str = "UPSERT",
        clinic_id: Optional[int] = None,
    ):
        """Records an entity change to push to central cloud on next sync."""
        rec = SyncRecord(
            clinic_id=clinic_id,
            entity_type=entity_type,
            entity_uid=entity_uid or str(entity_id),
            entity_id=entity_id,
            action=action,
            payload=json.dumps(payload, default=str),
            status="PENDING",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(rec)
        db.commit()

    @staticmethod
    def export_delta(db: Session, since: Optional[str] = None) -> Dict[str, Any]:
        """Gathers local records modified since timestamp or queued in SyncRecord."""
        since_dt = None
        if since:
            try:
                since_dt = datetime.datetime.fromisoformat(since)
            except Exception:
                pass

        # Patients
        p_query = db.query(Patient)
        if since_dt:
            p_query = p_query.filter(Patient.created_at >= since_dt)
        patients = [
            {
                "patient_uid": p.patient_uid,
                "phone": p.phone,
                "name": p.name,
                "gender": p.gender,
                "age": p.age,
                "blood_group": p.blood_group,
                "email": p.email,
                "address": p.address,
                "registration_source": p.registration_source,
                "aadhaar_number": p.aadhaar_number,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in p_query.limit(200).all()
        ]

        # Appointments
        a_query = db.query(Appointment)
        if since_dt:
            a_query = a_query.filter(Appointment.created_at >= since_dt)
        appointments = []
        for a in a_query.limit(200).all():
            appointments.append({
                "patient_phone": a.patient.phone if a.patient else None,
                "patient_name": a.patient.name if a.patient else None,
                "doctor_name": a.doctor.name if a.doctor else None,
                "appointment_date": a.appointment_date,
                "start_time": a.start_time,
                "end_time": a.end_time,
                "status": a.status,
                "notes": a.notes,
                "source": a.source,
                "visit_type": a.visit_type,
                "payment_status": a.payment_status,
                "payment_method": a.payment_method,
                "paid_amount": a.paid_amount,
                "cabin": a.cabin,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            })

        # Prescriptions
        rx_query = db.query(Prescription)
        if since_dt:
            rx_query = rx_query.filter(Prescription.created_at >= since_dt)
        prescriptions = []
        for rx in rx_query.limit(200).all():
            prescriptions.append({
                "prescription_uid": rx.prescription_uid,
                "patient_phone": rx.patient.phone if rx.patient else None,
                "doctor_name": rx.doctor.name if rx.doctor else None,
                "diagnosis": rx.diagnosis,
                "symptoms": rx.symptoms,
                "vitals": rx.vitals,
                "medicines": rx.medicines,
                "advice": rx.advice,
                "status": rx.status,
                "created_at": rx.created_at.isoformat() if rx.created_at else None,
            })

        # Invoices
        inv_query = db.query(Invoice)
        if since_dt:
            inv_query = inv_query.filter(Invoice.created_at >= since_dt)
        invoices = []
        for inv in inv_query.limit(200).all():
            invoices.append({
                "invoice_number": inv.invoice_number,
                "patient_phone": inv.patient.phone if inv.patient else None,
                "items": inv.items,
                "subtotal": inv.subtotal,
                "discount": inv.discount,
                "tax": inv.tax,
                "total": inv.total,
                "amount_paid": inv.amount_paid,
                "balance_due": inv.balance_due,
                "payment_method": inv.payment_method,
                "payment_status": inv.payment_status,
                "created_at": inv.created_at.isoformat() if inv.created_at else None,
            })

        # WhatsApp Messages
        msg_query = db.query(WhatsAppMessage)
        if since_dt:
            msg_query = msg_query.filter(WhatsAppMessage.created_at >= since_dt)
        messages = [
            {
                "phone": m.phone,
                "patient_name": m.patient_name,
                "sender": m.sender,
                "message_type": m.message_type,
                "body": m.body,
                "meta_id": m.meta_id,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in msg_query.limit(300).all()
        ]

        return {
            "clinic_name": settings.CLINIC_NAME,
            "exported_at": datetime.datetime.utcnow().isoformat(),
            "delta": {
                "patients": patients,
                "appointments": appointments,
                "prescriptions": prescriptions,
                "invoices": invoices,
                "whatsapp_messages": messages,
            },
        }

    @staticmethod
    def import_delta(db: Session, delta_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Safely merges incoming records from cloud/peer server into local DB."""
        delta = delta_dict.get("delta") or delta_dict
        imported_patients = 0
        imported_appointments = 0
        imported_prescriptions = 0
        imported_invoices = 0
        imported_messages = 0

        # Import Patients
        for p_data in delta.get("patients", []):
            phone = (p_data.get("phone") or "").strip()
            if not phone:
                continue
            existing = db.query(Patient).filter(Patient.phone == phone).first()
            if not existing and p_data.get("patient_uid"):
                existing = db.query(Patient).filter(Patient.patient_uid == p_data.get("patient_uid")).first()

            if not existing:
                new_p = Patient(
                    patient_uid=p_data.get("patient_uid"),
                    phone=phone,
                    name=p_data.get("name") or "Valued Patient",
                    gender=p_data.get("gender") or "Unspecified",
                    age=p_data.get("age"),
                    blood_group=p_data.get("blood_group"),
                    email=p_data.get("email"),
                    address=p_data.get("address"),
                    registration_source=p_data.get("registration_source") or "Cloud Sync",
                    aadhaar_number=p_data.get("aadhaar_number"),
                )
                db.add(new_p)
                imported_patients += 1
            else:
                if p_data.get("name") and p_data["name"] not in ("Valued Patient", "WhatsApp Patient"):
                    existing.name = p_data["name"]
                if p_data.get("email"):
                    existing.email = p_data["email"]
                if p_data.get("age"):
                    existing.age = p_data["age"]
        db.commit()

        # Import Appointments
        for a_data in delta.get("appointments", []):
            date_str = a_data.get("appointment_date")
            time_str = a_data.get("start_time")
            phone = a_data.get("patient_phone")
            if not (date_str and time_str and phone):
                continue

            patient = db.query(Patient).filter(Patient.phone == phone).first()
            if not patient:
                patient = Patient(phone=phone, name=a_data.get("patient_name") or "Valued Patient")
                db.add(patient)
                db.commit()
                db.refresh(patient)

            # Match doctor by name or fallback to first doctor
            doc_name = a_data.get("doctor_name")
            doctor = None
            if doc_name:
                doctor = db.query(Doctor).filter(Doctor.name.ilike(f"%{doc_name}%")).first()
            if not doctor:
                doctor = db.query(Doctor).first()
            if not doctor:
                continue

            existing_appt = (
                db.query(Appointment)
                .filter(
                    Appointment.doctor_id == doctor.id,
                    Appointment.appointment_date == date_str,
                    Appointment.start_time == time_str,
                )
                .first()
            )
            if not existing_appt:
                new_appt = Appointment(
                    patient_id=patient.id,
                    doctor_id=doctor.id,
                    appointment_date=date_str,
                    start_time=time_str,
                    end_time=a_data.get("end_time") or time_str,
                    status=a_data.get("status") or "CONFIRMED",
                    notes=a_data.get("notes"),
                    source=a_data.get("source") or "Cloud Sync",
                    visit_type=a_data.get("visit_type") or "New Consultation",
                    payment_status=a_data.get("payment_status") or "PENDING",
                    payment_method=a_data.get("payment_method") or "Pay at Clinic",
                    paid_amount=a_data.get("paid_amount") or 500,
                    cabin=a_data.get("cabin") or "Cabin 1",
                )
                db.add(new_appt)
                imported_appointments += 1
            else:
                existing_appt.status = a_data.get("status", existing_appt.status)
        db.commit()

        # Import WhatsApp Messages
        for m_data in delta.get("whatsapp_messages", []):
            body = m_data.get("body")
            phone = m_data.get("phone")
            meta_id = m_data.get("meta_id")
            if not (body and phone):
                continue
            existing_msg = None
            if meta_id:
                existing_msg = db.query(WhatsAppMessage).filter(WhatsAppMessage.meta_id == meta_id).first()
            if not existing_msg:
                existing_msg = (
                    db.query(WhatsAppMessage)
                    .filter(
                        WhatsAppMessage.phone == phone,
                        WhatsAppMessage.body == body,
                        WhatsAppMessage.sender == m_data.get("sender"),
                    )
                    .first()
                )
            if not existing_msg:
                new_msg = WhatsAppMessage(
                    phone=phone,
                    patient_name=m_data.get("patient_name") or "Valued Patient",
                    sender=m_data.get("sender") or "patient",
                    message_type=m_data.get("message_type") or "text",
                    body=body,
                    meta_id=meta_id,
                )
                db.add(new_msg)
                imported_messages += 1
        db.commit()

        return {
            "imported_patients": imported_patients,
            "imported_appointments": imported_appointments,
            "imported_messages": imported_messages,
        }

    @staticmethod
    async def sync_with_cloud(db: Session) -> Dict[str, Any]:
        """Pushes local deltas and pulls cloud updates via remote REST endpoint."""
        config = SyncService.get_sync_config(db)
        if not config["cloud_sync_enabled"]:
            return {
                "success": False,
                "status": "disabled",
                "message": "Cloud sync is disabled. Enable it in Settings to synchronize with remote server.",
            }

        cloud_url = SyncService.get_meta(db, "cloud_sync_url", "")
        if not cloud_url:
            return {
                "success": False,
                "status": "not_configured",
                "message": "Cloud Server URL is not configured. Please enter your remote server endpoint.",
            }

        if not is_internet_available():
            return {
                "success": False,
                "status": "offline",
                "message": "Internet is currently offline. All local changes are preserved and will sync once reconnected.",
            }

        api_key = SyncService.get_meta(db, "cloud_sync_api_key", "")
        last_sync = SyncService.get_meta(db, "last_cloud_sync_timestamp", None)

        # 1. Export local delta
        local_delta = SyncService.export_delta(db, since=last_sync)

        # 2. Exchange with Cloud
        exchange_url = f"{cloud_url}/api/sync/exchange"
        headers = {
            "Content-Type": "application/json",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    exchange_url,
                    headers=headers,
                    json={
                        "clinic_name": settings.CLINIC_NAME,
                        "last_synced_at": last_sync,
                        "local_delta": local_delta["delta"],
                    },
                )
                if res.status_code == 200:
                    cloud_response = res.json()
                    remote_delta = cloud_response.get("remote_delta") or cloud_response.get("delta", {})

                    # 3. Merge remote delta locally
                    import_stats = SyncService.import_delta(db, remote_delta)

                    # 4. Update sync timestamp & mark pending SyncRecords
                    now_str = datetime.datetime.utcnow().isoformat()
                    SyncService.set_meta(db, "last_cloud_sync_timestamp", now_str)

                    # Mark local sync records as SYNCED
                    db.query(SyncRecord).filter(SyncRecord.status == "PENDING").update(
                        {"status": "SYNCED", "synced_at": datetime.datetime.utcnow()}
                    )
                    db.commit()

                    return {
                        "success": True,
                        "status": "synced",
                        "message": "Successfully synchronized local clinic data with cloud server!",
                        "imported": import_stats,
                        "last_synced_at": now_str,
                    }
                else:
                    return {
                        "success": False,
                        "status": "error",
                        "message": f"Cloud sync server returned HTTP {res.status_code}: {res.text[:200]}",
                    }
        except Exception as e:
            logger.error(f"Failed to communicate with cloud sync server: {e}")
            return {
                "success": False,
                "status": "error",
                "message": f"Could not reach cloud server: {str(e)}",
            }

    @staticmethod
    async def run_sync_cycle(db: Optional[Session] = None) -> Dict[str, Any]:
        """
        Master background cycle:
        1. Checks internet connectivity.
        2. Dispatches WhatsApp Outbox if online.
        3. Synchronizes with Cloud Server if configured and online.
        """
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True

        try:
            online = is_internet_available()
            if not online:
                outbox_stats = SyncService.get_outbox_stats(db)
                return {
                    "is_online": False,
                    "whatsapp_outbox": outbox_stats,
                    "cloud_sync": {"status": "offline", "message": "Internet disconnected"},
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                }

            # 1. Flush WhatsApp outbox
            wa_result = await SyncService.flush_whatsapp_outbox(db)

            # 2. Cloud data sync
            cloud_result = await SyncService.sync_with_cloud(db)

            outbox_stats = SyncService.get_outbox_stats(db)

            return {
                "is_online": True,
                "whatsapp_flush": wa_result,
                "whatsapp_outbox": outbox_stats,
                "cloud_sync": cloud_result,
                "timestamp": datetime.datetime.utcnow().isoformat(),
            }
        finally:
            if should_close:
                db.close()


sync_service = SyncService()
