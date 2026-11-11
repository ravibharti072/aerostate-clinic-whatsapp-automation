import hmac
import hashlib
import json
import datetime
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from app.config import settings
from app.database import SessionLocal, engine, Base
from app.models import Clinic, Doctor, Patient, Appointment, WhatsAppMessage, ConversationSession, ProcessedWebhookMessage
from app.services.booking import booking_service


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_test_data():
    """Ensures test clinic and isolation before each test."""
    db = SessionLocal()
    try:
        # Ensure default test clinics exist
        c1 = db.query(Clinic).filter(Clinic.id == 1).first()
        if not c1:
            c1 = Clinic(
                id=1,
                code="CLN-TEST-1",
                name="Aerostate Prime Clinic",
                phone_number_id="WABA_PID_CLN1",
                is_active=True,
            )
            db.add(c1)
        else:
            c1.phone_number_id = "WABA_PID_CLN1"
            c1.is_active = True

        c2 = db.query(Clinic).filter(Clinic.id == 2).first()
        if not c2:
            c2 = Clinic(
                id=2,
                code="CLN-TEST-2",
                name="Aerostate North Clinic",
                phone_number_id="WABA_PID_CLN2",
                is_active=True,
            )
            db.add(c2)
        else:
            c2.phone_number_id = "WABA_PID_CLN2"
            c2.is_active = True

        # Ensure active doctor exists for clinic 1
        d1 = db.query(Doctor).filter(Doctor.clinic_id == 1).first()
        if not d1:
            d1 = Doctor(
                clinic_id=1,
                name="Dr. Test Specialist",
                specialization="General Medicine",
                available_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                start_time="09:00",
                end_time="18:00",
                slot_duration_mins=30,
                consultation_fee=500,
                is_active=True,
            )
            db.add(d1)

        db.commit()
    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        # Cleanup test messages
        db.query(ProcessedWebhookMessage).filter(ProcessedWebhookMessage.phone.like("%9999%")).delete(synchronize_session=False)
        db.query(WhatsAppMessage).filter(WhatsAppMessage.phone.like("%9999%")).delete(synchronize_session=False)
        db.query(ConversationSession).filter(ConversationSession.phone.like("%9999%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def generate_meta_signature(body_bytes: bytes, secret: str) -> str:
    sig = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


def create_meta_payload(phone_number_id: str, sender_phone: str, msg_id: str, text: str = "hi"):
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "123456789",
                "changes": [
                    {
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "15550001",
                                "phone_number_id": phone_number_id,
                            },
                            "contacts": [
                                {
                                    "profile": {"name": "Test User"},
                                    "wa_id": sender_phone,
                                }
                            ],
                            "messages": [
                                {
                                    "from": sender_phone,
                                    "id": msg_id,
                                    "timestamp": "1730000000",
                                    "type": "text",
                                    "text": {"body": text},
                                }
                            ],
                        },
                        "field": "messages",
                    }
                ],
            }
        ],
    }


# ==============================================================================
# 1. Meta Webhook Verification (GET)
# ==============================================================================

def test_meta_webhook_get_verification_success(client):
    res = client.get(
        "/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.challenge": "11582012",
            "hub.verify_token": settings.VERIFY_TOKEN,
        },
    )
    assert res.status_code == 200
    assert res.text == "11582012"


def test_meta_webhook_get_verification_failure(client):
    res = client.get(
        "/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.challenge": "11582012",
            "hub.verify_token": "wrong_token_12345",
        },
    )
    assert res.status_code == 403


# ==============================================================================
# 2. Meta Webhook Signature Verification (POST)
# ==============================================================================

def test_webhook_signature_verification_production(client):
    test_secret = "test_meta_app_secret_xyz_123"
    payload = create_meta_payload("WABA_PID_CLN1", "919999000001", "wamid.sig_test_1", "hi")
    body_bytes = json.dumps(payload).encode("utf-8")

    with patch.object(settings, "ENVIRONMENT", "production"), \
         patch.object(settings, "META_APP_SECRET", test_secret), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", False):

        # A) Missing Signature Header -> 403
        res1 = client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})
        assert res1.status_code == 403

        # B) Invalid Signature Header -> 403
        res2 = client.post(
            "/webhook",
            content=body_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": "sha256=invalid_hex_string"},
        )
        assert res2.status_code == 403

        # C) Valid Signature Header -> 200 OK
        valid_sig = generate_meta_signature(body_bytes, test_secret)
        res3 = client.post(
            "/webhook",
            content=body_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": valid_sig},
        )
        assert res3.status_code == 200
        assert res3.json() == {"status": "ok"}


def test_webhook_signature_development_mode(client):
    payload = create_meta_payload("WABA_PID_CLN1", "919999000002", "wamid.dev_test_1", "hi")
    body_bytes = json.dumps(payload).encode("utf-8")

    # In development with ALLOW_INSECURE_WEBHOOKS=True, unsigned requests are permitted
    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True):

        res = client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}


# ==============================================================================
# 3. Strict Clinic Identification (No Fallback)
# ==============================================================================

def test_unknown_clinic_phone_number_id_rejected(client):
    payload = create_meta_payload("UNKNOWN_WABA_NUMBER_99999", "919999000003", "wamid.unknown_clinic_1", "hi")
    body_bytes = json.dumps(payload).encode("utf-8")

    db = SessionLocal()
    initial_sessions_count = db.query(ConversationSession).filter(ConversationSession.phone.like("%919999000003%")).count()
    initial_msgs_count = db.query(WhatsAppMessage).filter(WhatsAppMessage.phone.like("%919999000003%")).count()
    db.close()

    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True):

        res = client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})
        assert res.status_code == 200

    # Ensure message was NOT processed or stored under any clinic
    db = SessionLocal()
    after_sessions = db.query(ConversationSession).filter(ConversationSession.phone.like("%919999000003%")).count()
    after_msgs = db.query(WhatsAppMessage).filter(WhatsAppMessage.phone.like("%919999000003%")).count()
    db.close()

    assert after_sessions == initial_sessions_count == 0
    assert after_msgs == initial_msgs_count == 0


# ==============================================================================
# 4. Duplicate Message Protection (Idempotency)
# ==============================================================================

def test_duplicate_incoming_message_protection(client):
    msg_id = "wamid.idempotency_test_001"
    payload = create_meta_payload("WABA_PID_CLN1", "919999000004", msg_id, "hi")
    body_bytes = json.dumps(payload).encode("utf-8")

    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True):

        # First request
        res1 = client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})
        assert res1.status_code == 200

        # Duplicate second request with same message ID
        res2 = client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})
        assert res2.status_code == 200

    db = SessionLocal()
    try:
        # Exactly one processed record must exist for this meta_id
        processed_count = db.query(ProcessedWebhookMessage).filter(ProcessedWebhookMessage.meta_id == msg_id).count()
        assert processed_count == 1

        # The message should only have been logged once
        logged_msgs = db.query(WhatsAppMessage).filter(WhatsAppMessage.meta_id == msg_id).count()
        assert logged_msgs == 1
    finally:
        db.close()


# ==============================================================================
# 5. Same WhatsApp Number Interacting With Two Different Clinics
# ==============================================================================

def test_same_phone_two_clinics_isolated_sessions(client):
    shared_phone = "919999000005"
    db = SessionLocal()
    try:
        # Initialize session for Clinic 1 in SELECTING_DATE
        booking_service.update_session(
            db,
            shared_phone,
            step="SELECTING_DATE",
            context={"doctor_id": 1, "doctor_name": "Dr. Prime"},
            clinic_id=1,
        )

        # Initialize session for Clinic 2 in AWAITING_SYMPTOMS
        booking_service.update_session(
            db,
            shared_phone,
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 2, "specialty": "Dental"},
            clinic_id=2,
        )

        # Retrieve both sessions independently
        s1 = booking_service.get_session(db, shared_phone, clinic_id=1)
        s2 = booking_service.get_session(db, shared_phone, clinic_id=2)

        assert s1.clinic_id == 1
        assert s1.step == "SELECTING_DATE"
        assert json.loads(s1.context_data).get("doctor_name") == "Dr. Prime"

        assert s2.clinic_id == 2
        assert s2.step == "AWAITING_SYMPTOMS"
        assert json.loads(s2.context_data).get("specialty") == "Dental"

        # Updating Clinic 1 must not alter Clinic 2
        booking_service.update_session(
            db,
            shared_phone,
            step="SELECTING_SLOT",
            context={"slot": "10:00"},
            clinic_id=1,
        )

        s1_updated = booking_service.get_session(db, shared_phone, clinic_id=1)
        s2_fresh = booking_service.get_session(db, shared_phone, clinic_id=2)

        assert s1_updated.step == "SELECTING_SLOT"
        assert s2_fresh.step == "AWAITING_SYMPTOMS"
    finally:
        db.close()


# ==============================================================================
# 6. Session Expiration Handling
# ==============================================================================

def test_expired_conversation_session(client):
    phone = "919999000006"
    db = SessionLocal()
    try:
        # Create a session in SELECTING_SLOT that was last updated 45 minutes ago
        s = booking_service.get_session(db, phone, clinic_id=1)
        s.step = "SELECTING_SLOT"
        s.context_data = json.dumps({"doctor_id": 1, "date_str": "2026-11-20"})
        s.updated_at = datetime.datetime.utcnow() - datetime.timedelta(minutes=45)
        db.commit()

        # get_session with 30 min timeout should detect expiration and reset to IDLE
        fresh_s = booking_service.get_session(db, phone, clinic_id=1, timeout_minutes=30)
        assert fresh_s.was_expired is True
        assert fresh_s.step == "IDLE"
        assert fresh_s.context_data == "{}"
    finally:
        db.close()


# ==============================================================================
# 7. Database Failure Handling During Processing
# ==============================================================================

def test_database_failure_handling(client):
    payload = create_meta_payload("WABA_PID_CLN1", "919999000007", "wamid.db_err_test", "hi")
    body_bytes = json.dumps(payload).encode("utf-8")

    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True), \
         patch("app.routers.webhook.check_and_record_meta_id", side_effect=Exception("Simulated SQLite lock error")):

        res = client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})
        assert res.status_code == 500
        assert "Internal Server Error" in res.text


# ==============================================================================
# 8. Preservation of Existing Booking Flow
# ==============================================================================

def test_existing_booking_flow_preservation(client):
    phone = "919999000008"
    db = SessionLocal()
    try:
        # Verify doctor is active
        doc = db.query(Doctor).filter(Doctor.clinic_id == 1, Doctor.is_active == True).first()
        assert doc is not None

        # 1. Start flow by getting available dates
        dates = booking_service.get_available_dates(doc, days_ahead=3)
        assert len(dates) > 0
        target_date = dates[0]["date_str"]

        # 2. Get available slots
        slots = booking_service.get_available_slots(db, doc.id, target_date)
        assert len(slots) > 0
        target_slot = slots[0]

        # 3. Book appointment
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Regression Test Patient",
            doctor_id=doc.id,
            date_str=target_date,
            start_time=target_slot,
            source="WhatsApp",
            clinic_id=1,
        )
        assert appt is not None
        assert appt.clinic_id == 1
        assert appt.status == "CONFIRMED"

        # 4. Check upcoming appointment lookup
        upcoming = booking_service.get_patient_upcoming_appointments(db, phone, clinic_id=1)
        assert len(upcoming) >= 1
        assert upcoming[0].id == appt.id

        # 5. Cancel appointment
        cancelled = booking_service.cancel_appointment(db, phone, appt.id, clinic_id=1)
        assert cancelled is True

        db.refresh(appt)
        assert appt.status == "CANCELLED"
    finally:
        db.close()
