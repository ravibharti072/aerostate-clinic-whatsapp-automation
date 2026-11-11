import pytest
import json
import hmac
import hashlib
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.models import Clinic, Doctor, Patient, ConversationSession, ProcessedWebhookMessage
from app.services.safety import safety_service, MEDICAL_SAFETY_DISCLAIMER
from app.services.abdm_service import abdm_service
from app.services.booking import booking_service
from app.routers.webhook import mask_abha
from main import app

TEST_APP_SECRET = "test_meta_secret_ph7"


@pytest.fixture(autouse=True)
def setup_db():
    db = SessionLocal()
    try:
        db.query(ProcessedWebhookMessage).delete()
        db.query(ConversationSession).delete()
        db.query(Patient).filter(Patient.phone.like("9198765432%")).delete()
        db.query(Doctor).filter(Doctor.clinic_id.in_([701, 702, 703])).delete()
        db.query(Clinic).filter(Clinic.id.in_([701, 702, 703])).delete()
        db.commit()

        clinic = Clinic(
            id=701,
            code="CLN-PH7-1",
            name="Metro Care Hospital",
            phone_number_id="meta_phone_phase7",
            is_active=True,
            address="Casualty & Trauma Center, Gate 3, Agra",
            emergency_contact="+919876500000",
            emergency_keywords="anaphylaxis, snake bite, electric shock",
        )
        db.add(clinic)
        db.commit()

        doc1 = Doctor(
            id=701,
            clinic_id=701,
            name="Dr. Vikram Sharma",
            specialization="General Physician",
            consultation_fee=500.0,
            is_active=True,
        )
        doc2 = Doctor(
            id=702,
            clinic_id=701,
            name="Dr. Priya Desai",
            specialization="Cardiology",
            consultation_fee=1200.0,
            is_active=True,
        )
        doc3 = Doctor(
            id=703,
            clinic_id=701,
            name="Dr. Amit Patel",
            specialization="Dentistry",
            consultation_fee=600.0,
            is_active=True,
        )
        db.add_all([doc1, doc2, doc3])
        db.commit()
    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        db.query(ProcessedWebhookMessage).delete()
        db.query(ConversationSession).delete()
        db.query(Patient).filter(Patient.phone.like("9198765432%")).delete()
        db.query(Doctor).filter(Doctor.clinic_id.in_([701, 702, 703])).delete()
        db.query(Clinic).filter(Clinic.id.in_([701, 702, 703])).delete()
        db.commit()
    finally:
        db.close()


def send_signed_webhook(client: TestClient, payload: dict, app_secret: str = TEST_APP_SECRET):
    payload_bytes = json.dumps(payload).encode("utf-8")
    sig = "sha256=" + hmac.new(app_secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    with patch.object(settings, "META_APP_SECRET", app_secret):
        return client.post(
            "/webhook",
            data=payload_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig},
        )


def send_webhook_text(client, phone, text, msg_id="msg_p7_1", phone_number_id="meta_phone_phase7"):
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "entry_p7",
                "changes": [
                    {
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "15550220",
                                "phone_number_id": phone_number_id,
                            },
                            "contacts": [{"profile": {"name": "Test Patient"}, "wa_id": phone}],
                            "messages": [
                                {
                                    "from": phone,
                                    "id": msg_id,
                                    "timestamp": "1700000000",
                                    "text": {"body": text},
                                    "type": "text",
                                }
                            ],
                        },
                        "field": "messages",
                    }
                ],
            }
        ],
    }
    return send_signed_webhook(client, payload)


def send_webhook_button(client, phone, button_id, button_title="Option", msg_id="btn_p7_1", phone_number_id="meta_phone_phase7"):
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "entry_p7",
                "changes": [
                    {
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "15550220",
                                "phone_number_id": phone_number_id,
                            },
                            "contacts": [{"profile": {"name": "Test Patient"}, "wa_id": phone}],
                            "messages": [
                                {
                                    "from": phone,
                                    "id": msg_id,
                                    "timestamp": "1700000000",
                                    "type": "interactive",
                                    "interactive": {
                                        "type": "button_reply",
                                        "button_reply": {"id": button_id, "title": button_title},
                                    },
                                }
                            ],
                        },
                        "field": "messages",
                    }
                ],
            }
        ],
    }
    return send_signed_webhook(client, payload)


# ==============================================================================
# TESTS
# ==============================================================================

def test_mask_abha_utility():
    """Verify ABHA masking protects patient privacy."""
    assert mask_abha("12345678901234") == "12-****-****-1234"
    assert mask_abha("12-3456-7890-1234") == "12-****-****-1234"
    assert mask_abha("99887766554433") == "99-****-****-4433"
    assert mask_abha("") == ""
    assert mask_abha(None) == ""


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_ordinary_symptom_routing_includes_medical_disclaimer(mock_send):
    """Ordinary symptoms route to a specialist and MUST include the medical safety disclaimer."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        booking_service.get_session(db, "919876543201", clinic_id=701)
        booking_service.update_session(
            db,
            "919876543201",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 701, "patient_name": "Ravi Kumar"},
            clinic_id=701,
        )
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543201", "Bukhar aur sardi hai 2 din se", msg_id="p7_ord_1")
    assert resp.status_code == 200

    assert mock_send.called
    call_args = mock_send.call_args[1]
    body_text = call_args.get("body_text", "")

    # Must contain doctor recommendation
    assert "Vikram Sharma" in body_text or "General Physician" in body_text
    # MUST contain mandatory disclaimer
    assert MEDICAL_SAFETY_DISCLAIMER in body_text
    # Does NOT diagnose a disease
    assert "you have" not in body_text.lower()
    # Provides booking confirmation button
    buttons = call_args.get("buttons", [])
    btn_ids = [b["id"] for b in buttons]
    assert any("rec_accept_" in b_id for b_id in btn_ids)


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_emergency_chest_pain_stops_booking_and_displays_instructions(mock_send):
    """Emergency symptoms (chest pain) immediately stop booking flow and display emergency escalation instructions."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        booking_service.get_session(db, "919876543202", clinic_id=701)
        booking_service.update_session(
            db,
            "919876543202",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 701, "patient_name": "Suresh"},
            clinic_id=701,
        )
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543202", "Severe crushing chest pain radiating to left arm", msg_id="p7_emg_1")
    assert resp.status_code == 200

    assert mock_send.called
    call_args = mock_send.call_args[1]
    body_text = call_args.get("body_text", "")

    # Must display emergency warning and 112
    assert "112" in body_text
    assert "EMERGENCY" in body_text.upper() or "URGENT" in body_text.upper()
    assert "+919876500000" in body_text
    assert "Casualty & Trauma Center" in body_text

    # Must NOT offer normal appointment booking buttons
    buttons = call_args.get("buttons", [])
    btn_ids = [b["id"] for b in buttons]
    assert not any("rec_accept_" in b_id for b_id in btn_ids)
    assert "btn_human" in btn_ids
    assert "btn_menu" in btn_ids

    # Session must be reset from AWAITING_SYMPTOMS to IDLE so patient is not stuck
    db = SessionLocal()
    try:
        updated_session = booking_service.get_session(db, "919876543202", clinic_id=701)
        assert updated_session.step == "IDLE"
    finally:
        db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_emergency_breathing_difficulty_hindi_hinglish(mock_send):
    """Emergency symptoms in Hindi/Hinglish (breathing distress) trigger emergency handling."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        booking_service.get_session(db, "919876543203", clinic_id=701)
        booking_service.update_session(
            db,
            "919876543203",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 701},
            clinic_id=701,
        )
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543203", "Saans nahi aa rahi bahut takleef hai dam ghut raha hai", msg_id="p7_emg_2")
    assert resp.status_code == 200

    assert mock_send.called
    call_args = mock_send.call_args[1]
    body_text = call_args.get("body_text", "")

    assert "112" in body_text
    assert "Breathing Distress" in body_text or "EMERGENCY" in body_text.upper()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_emergency_stroke_symptoms(mock_send):
    """Stroke-like symptoms trigger immediate emergency escalation."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        booking_service.get_session(db, "919876543204", clinic_id=701)
        booking_service.update_session(
            db,
            "919876543204",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 701},
            clinic_id=701,
        )
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543204", "Sudden face drooping and slurred speech, can't speak", msg_id="p7_emg_3")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")
    assert "112" in body_text
    assert "Stroke / Neurological Warning Signs" in body_text or "EMERGENCY" in body_text


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_emergency_custom_clinic_keywords(mock_send):
    """Custom clinic emergency keywords (e.g. electric shock) trigger emergency escalation."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        booking_service.get_session(db, "919876543205", clinic_id=701)
        booking_service.update_session(
            db,
            "919876543205",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 701},
            clinic_id=701,
        )
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543205", "Patient got severe electric shock at home", msg_id="p7_emg_4")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")
    assert "112" in body_text
    assert "Clinic Emergency" in body_text or "EMERGENCY" in body_text


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_no_silent_fallback_to_first_doctor_when_unmatched(mock_send):
    """When symptoms do not match any available doctor, do NOT silently select doctors[0]. Offer receptionist."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        # Create a specialized dental clinic with only a Dentist
        dental_clinic = Clinic(
            id=702,
            code="CLN-PH7-2",
            name="Dental Care Center",
            phone_number_id="meta_phone_dental",
            is_active=True,
        )
        db.add(dental_clinic)
        db.commit()

        dentist = Doctor(
            id=720,
            clinic_id=702,
            name="Dr. Smile Dentist",
            specialization="Dentistry",
            is_active=True,
        )
        db.add(dentist)
        db.commit()

        booking_service.get_session(db, "919876543206", clinic_id=702)
        booking_service.update_session(
            db,
            "919876543206",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 702},
            clinic_id=702,
        )
    finally:
        db.close()

    # Patient reports an orthopedic issue at a purely dental clinic
    resp = send_webhook_text(
        client,
        "919876543206",
        "Severe knee pain and fracture in leg from a bike fall",
        msg_id="p7_unmatch_1",
        phone_number_id="meta_phone_dental",
    )
    assert resp.status_code == 200

    assert mock_send.called
    call_args = mock_send.call_args[1]
    body_text = call_args.get("body_text", "")

    # MUST NOT book with Dr. Smile Dentist!
    assert "Dr. Smile Dentist" not in body_text
    assert "We could not find an exact matching specialist" in body_text
    assert MEDICAL_SAFETY_DISCLAIMER in body_text

    # Buttons should offer receptionist and view all doctors, but NOT 'rec_accept_720'
    buttons = call_args.get("buttons", [])
    btn_ids = [b["id"] for b in buttons]
    assert not any("rec_accept_" in b_id for b_id in btn_ids)
    assert "btn_human" in btn_ids
    assert "mode_doctors" in btn_ids


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_no_active_doctors_available_offers_receptionist(mock_send):
    """When clinic has no active doctors, symptom flow gracefully offers receptionist."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        empty_clinic = Clinic(
            id=703,
            code="CLN-PH7-3",
            name="Empty Clinic",
            phone_number_id="meta_phone_empty",
            is_active=True,
        )
        db.add(empty_clinic)
        db.commit()

        booking_service.get_session(db, "919876543207", clinic_id=703)
        booking_service.update_session(
            db,
            "919876543207",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 703},
            clinic_id=703,
        )
    finally:
        db.close()

    resp = send_webhook_text(
        client,
        "919876543207",
        "I have a fever",
        msg_id="p7_empty_1",
        phone_number_id="meta_phone_empty",
    )
    assert resp.status_code == 200

    assert mock_send.called
    call_args = mock_send.call_args[1]
    body_text = call_args.get("body_text", "")
    assert "No doctors are currently available" in body_text
    buttons = call_args.get("buttons", [])
    btn_ids = [b["id"] for b in buttons]
    assert "btn_human" in btn_ids


@patch("app.services.ai.ai_service.recommend_doctor_by_symptoms")
@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_ai_service_failure_falls_back_safely(mock_send, mock_ai):
    """If Gemini AI service fails, fallback rule matcher safely handles request without crash or invalid assignment."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        booking_service.get_session(db, "919876543208", clinic_id=701)
        booking_service.update_session(
            db,
            "919876543208",
            step="AWAITING_SYMPTOMS",
            context={"clinic_id": 701},
            clinic_id=701,
        )
    finally:
        db.close()

    # Simulate AI returning LOW confidence / no doctor match
    mock_ai.return_value = {
        "doctor_id": None,
        "specialization": "Unknown",
        "confidence": "LOW",
        "reasoning": "AI service unavailable",
    }

    resp = send_webhook_text(client, "919876543208", "Random obscure symptom description", msg_id="p7_aifail_1")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")
    assert "We could not find an exact matching specialist" in body_text
    assert MEDICAL_SAFETY_DISCLAIMER in body_text


# ==============================================================================
# ABHA VERIFICATION ACCURACY TESTS
# ==============================================================================

@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_abha_verified_state_display_and_masking(mock_send):
    """ABHA verified state displays Government Verified ABDM M1, masked number, and linked records confirmation."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        patient = Patient(
            name="Anil Sharma",
            phone="919876543210",
            abha_number="14123456789012",
            abha_address="anil@abdm",
            abha_status="VERIFIED",
            abha_verification_source="ABDM_M1",
        )
        db.add(patient)
        db.commit()
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543210", "ABHA", msg_id="p7_abha_1")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")

    # Masked number
    assert "14-****-****-9012" in body_text
    assert "14123456789012" not in body_text
    # Accurate verified status
    assert "Government Verified (ABDM M1)" in body_text
    assert "prescriptions and lab reports are linked" in body_text


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_abha_consented_state_display_and_masking(mock_send):
    """ABHA consented state shows Consent Granted (Verification Pending), masked number, and OTP requirement."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        patient = Patient(
            name="Sunita Rao",
            phone="919876543211",
            abha_number="98765432109876",
            abha_address="sunita@sbx",
            abha_status="CONSENTED",
        )
        db.add(patient)
        db.commit()
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543211", "ABHA", msg_id="p7_abha_2")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")

    # Masked number
    assert "98-****-****-9876" in body_text
    # Pending status notice
    assert "Consent Granted (Verification Pending)" in body_text
    assert "complete OTP verification" in body_text


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_abha_entered_unverified_state_display_and_masking(mock_send):
    """ABHA merely entered shows Entered / Unverified, masked number, and explicitly notes records are NOT linked."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        patient = Patient(
            name="Deepak Verma",
            phone="919876543212",
            abha_number="11223344556677",
            abha_status="ENTERED",
        )
        db.add(patient)
        db.commit()
    finally:
        db.close()

    resp = send_webhook_text(client, "919876543212", "ABHA", msg_id="p7_abha_3")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")

    # Masked number
    assert "11-****-****-6677" in body_text
    # Explicit Unverified notice
    assert "Entered / Unverified" in body_text
    assert "NOT yet verified with the Government ABDM system" in body_text
    assert "Prescriptions and diagnostic records are NOT linked" in body_text


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_abha_unlinked_state(mock_send):
    """Patient with no ABHA shows unlinked prompt."""
    client = TestClient(app)
    resp = send_webhook_text(client, "919876543213", "ABHA", msg_id="p7_abha_4")
    assert resp.status_code == 200

    assert mock_send.called
    body_text = mock_send.call_args[1].get("body_text", "")
    assert "not yet linked with our clinic" in body_text


def test_abdm_service_state_lifecycle():
    """Verify backend abdm_service methods manage the ABHA lifecycle accurately."""
    db = SessionLocal()
    try:
        patient = Patient(name="Kavita", phone="919876543214")
        db.add(patient)
        db.commit()

        # Step 1: Manual entry
        p = abdm_service.enter_patient_abha(db, patient.id, "12345678901234")
        assert p.abha_status == "ENTERED"
        assert p.abha_verification_source == "MANUAL_ENTRY"
        assert p.abha_verified_at is None

        # Step 2: Patient consent
        p = abdm_service.record_patient_consent(db, patient.id, "kavita@abdm")
        assert p.abha_status == "CONSENTED"
        assert p.abha_consented_at is not None
        assert p.abha_verified_at is None

        # Step 3: Verified linking (ABDM M1)
        p = abdm_service.link_patient_abha(db, patient.id, "12345678901234", "kavita@abdm")
        assert p.abha_status == "VERIFIED"
        assert p.abha_verification_source == "ABDM_M1"
        assert p.abha_verified_at is not None
    finally:
        db.close()
