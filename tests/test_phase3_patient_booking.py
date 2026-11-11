import hmac
import hashlib
import json
import datetime
from unittest.mock import patch, AsyncMock
import pytest
from fastapi.testclient import TestClient

from main import app
from app.config import settings
from app.database import SessionLocal
from app.models import Clinic, Doctor, Patient, Appointment, ConversationSession, ProcessedWebhookMessage
from app.services.booking import booking_service


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_whatsapp_payload_network():
    """Mocks WhatsApp network calls so tests run fast without live Graph API calls."""
    with patch(
        "app.services.whatsapp.WhatsAppClient._send_payload",
        new_callable=AsyncMock,
        return_value={"messaging_product": "whatsapp", "messages": [{"id": "wamid.mock"}]},
    ):
        yield


@pytest.fixture(autouse=True)
def clean_test_data():
    """Sets up clean test data for Phase 3 tests."""
    db = SessionLocal()
    try:
        # 1. Setup default test clinic
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        if not clinic:
            clinic = Clinic(
                id=1,
                code="CLN-PH3-1",
                name="Aerostate Prime Clinic",
                phone_number_id="WABA_PID_CLN1",
                is_active=True,
                payment_policy="PAY_AT_CLINIC",
                require_age=False,
                require_gender=False,
                require_reason=False,
            )
            db.add(clinic)
        else:
            clinic.phone_number_id = "WABA_PID_CLN1"
            clinic.is_active = True
            clinic.payment_policy = "PAY_AT_CLINIC"
            clinic.require_age = False
            clinic.require_gender = False
            clinic.require_reason = False
        db.commit()

        # 2. Setup Doctor
        doc = db.query(Doctor).filter(Doctor.id == 1).first()
        if not doc:
            doc = Doctor(
                id=1,
                clinic_id=1,
                name="Dr. Amit Sharma",
                specialization="Cardiology",
                start_time="09:00",
                end_time="17:00",
                slot_duration_mins=20,
                is_available=True,
                consultation_fee=600,
            )
            db.add(doc)
        else:
            doc.clinic_id = 1
            doc.name = "Dr. Amit Sharma"
            doc.is_available = True
            doc.consultation_fee = 600
        db.commit()

        # Clean existing test appointments, sessions, and patients for test numbers
        test_phones = ["919888000001", "919888000002", "919888000003", "919888000004", "919888000005"]
        db.query(Appointment).filter(Appointment.clinic_id == 1).delete()
        db.query(ConversationSession).filter(ConversationSession.phone.in_(test_phones)).delete()
        db.query(Patient).filter(Patient.phone.in_(test_phones)).delete()
        db.query(ProcessedWebhookMessage).delete()
        db.commit()
    finally:
        db.close()


def send_meta_payload(client: TestClient, sender_phone: str, msg_id: str, text: str = None, button_id: str = None, list_id: str = None, phone_number_id: str = "WABA_PID_CLN1"):
    """Helper to dispatch formatted Meta WhatsApp webhook payload."""
    msg_obj = {
        "from": sender_phone,
        "id": msg_id,
        "timestamp": "1700000000",
    }
    if text is not None:
        msg_obj["type"] = "text"
        msg_obj["text"] = {"body": text}
    elif button_id is not None:
        msg_obj["type"] = "interactive"
        msg_obj["interactive"] = {
            "type": "button_reply",
            "button_reply": {"id": button_id, "title": "Button Title"}
        }
    elif list_id is not None:
        msg_obj["type"] = "interactive"
        msg_obj["interactive"] = {
            "type": "list_reply",
            "list_reply": {"id": list_id, "title": "List Item Title"}
        }

    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "BIZ_ACCOUNT_1",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "+1234567890",
                                "phone_number_id": phone_number_id,
                            },
                            "contacts": [{"profile": {"name": "Test User"}, "wa_id": sender_phone}],
                            "messages": [msg_obj],
                        },
                    }
                ],
            }
        ],
    }
    raw_body = json.dumps(payload).encode("utf-8")
    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True):
        return client.post("/webhook", content=raw_body, headers={"Content-Type": "application/json"})


def test_step1_and_step2_myself_vs_someone_else(client):
    """Verifies Book Appointment asks whether it's for Myself or Someone Else."""
    phone = "919888000001"
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p3_1", text="book")
        assert res.status_code == 200
        assert mock_qr.called
        b_ids = [b["id"] for b in mock_qr.call_args[1]["buttons"]]
        assert "btn_book_self" in b_ids
        assert "btn_book_other" in b_ids


def test_step3_name_collection_myself_and_someone_else(client):
    """Verifies full name collection for Myself and Someone Else."""
    phone = "919888000001"

    # Selecting Myself prompts for patient's full legal name
    with patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_txt:
        res = send_meta_payload(client, phone, "m_p3_2", button_id="btn_book_self")
        assert res.status_code == 200
        assert mock_txt.called
        assert "full name" in mock_txt.call_args[1]["text"].lower()

    # User inputs name
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p3_3", text="Ravi Shankar")
        assert res.status_code == 200
        assert mock_qr.called
        # By default require_age/gender/reason are False, so it goes to Step 6: Registration status
        b_ids = [b["id"] for b in mock_qr.call_args[1]["buttons"]]
        assert "reg_new" in b_ids
        assert "reg_existing" in b_ids


def test_conditional_age_and_gender_collection(client):
    """Verifies age and gender are collected only when clinic configuration requires them."""
    phone = "919888000002"
    db = SessionLocal()
    clinic = db.query(Clinic).filter(Clinic.id == 1).first()
    clinic.require_age = True
    clinic.require_gender = True
    clinic.require_reason = True
    db.commit()
    db.close()

    try:
        # 1. Start booking & click Someone Else
        send_meta_payload(client, phone, "m_p3_c1", text="book")
        with patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_txt:
            send_meta_payload(client, phone, "m_p3_c2", button_id="btn_book_other")
            assert mock_txt.called
            assert "full name" in mock_txt.call_args[1]["text"].lower()

        # 2. Enter patient name -> prompts for Age because require_age=True
        with patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_txt:
            send_meta_payload(client, phone, "m_p3_c3", text="Anita Sharma")
            assert mock_txt.called
            assert "age" in mock_txt.call_args[1]["text"].lower()

        # 3. Enter Age -> prompts for Gender buttons because require_gender=True
        with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            send_meta_payload(client, phone, "m_p3_c4", text="45")
            assert mock_qr.called
            b_ids = [b["id"] for b in mock_qr.call_args[1]["buttons"]]
            assert "gen_female" in b_ids
            assert "gen_male" in b_ids

        # 4. Select Gender -> prompts for Registration status (Step 6)
        with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            send_meta_payload(client, phone, "m_p3_c5", button_id="gen_female")
            assert mock_qr.called
            b_ids = [b["id"] for b in mock_qr.call_args[1]["buttons"]]
            assert "reg_new" in b_ids

        # 5. Select New Patient -> prompts for Reason because require_reason=True
        with patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_txt:
            send_meta_payload(client, phone, "m_p3_c6", button_id="reg_new")
            assert mock_txt.called
            assert "reason" in mock_txt.call_args[1]["text"].lower()

        # 6. Enter Reason -> opens Step 8: Booking Mode menu
        with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            send_meta_payload(client, phone, "m_p3_c7", text="Chest discomfort")
            assert mock_qr.called
            b_ids = [b["id"] for b in mock_qr.call_args[1]["buttons"]]
            assert "mode_general" in b_ids
            assert "mode_doctors" in b_ids
            assert "mode_symptoms" in b_ids

    finally:
        # Reset clinic configuration
        db = SessionLocal()
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        clinic.require_age = False
        clinic.require_gender = False
        clinic.require_reason = False
        db.commit()
        db.close()


def test_appointment_summary_display_and_no_premature_booking(client):
    """Verifies summary is displayed with fee, buttons (Confirm, Change, Cancel), and appointment is NOT created prematurely."""
    phone = "919888000003"
    tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # Step 1: Start booking
    send_meta_payload(client, phone, "m_p3_s1", text="book")
    # Step 2: Myself
    send_meta_payload(client, phone, "m_p3_s2", button_id="btn_book_self")
    # Step 3: Enter name
    send_meta_payload(client, phone, "m_p3_s3", text="Vikram Verma")
    # Step 6: Registration
    send_meta_payload(client, phone, "m_p3_s4", button_id="reg_new")
    # Step 8: Select Doctor mode
    send_meta_payload(client, phone, "m_p3_s5", button_id="mode_doctors")
    # Step 9: Choose Doctor 1
    send_meta_payload(client, phone, "m_p3_s6", list_id="doc_1")
    # Step 10: Choose Date
    send_meta_payload(client, phone, "m_p3_s7", list_id=f"date_{tomorrow_str}")

    # Step 11: Choose Slot -> Should trigger Step 12 & 13: Summary Display with Confirm/Change/Cancel
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p3_s8", list_id="slot_10:00")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Appointment Summary" in body
        assert "Vikram Verma" in body
        assert "Amit Sharma" in body
        assert tomorrow_str in body
        assert "10:00" in body
        assert "₹600" in body  # Consultation fee from DB, not hardcoded 500
        buttons = mock_qr.call_args[1]["buttons"]
        b_ids = [b["id"] for b in buttons]
        assert "btn_confirm_booking" in b_ids
        assert "btn_change_details" in b_ids
        assert "btn_cancel_booking" in b_ids

    # Critical Assertion: Appointment must NOT be in DB yet before confirmation
    db = SessionLocal()
    appt = db.query(Appointment).filter(Appointment.clinic_id == 1, Appointment.appointment_date == tomorrow_str).first()
    assert appt is None
    db.close()


def test_cancel_before_confirmation_releases_session(client):
    """Verifies that clicking Cancel before confirmation resets session and creates no appointment."""
    phone = "919888000003"

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p3_cancel", button_id="btn_cancel_booking")
        assert res.status_code == 200
        assert mock_qr.called
        assert "cancelled" in mock_qr.call_args[1]["body_text"].lower()

    db = SessionLocal()
    appts = db.query(Appointment).filter(Appointment.clinic_id == 1).all()
    assert len(appts) == 0
    db.close()


def test_confirm_appointment_pay_at_clinic(client):
    """Verifies Confirm Appointment creates confirmed appointment with PAY_AT_CLINIC policy."""
    phone = "919888000003"
    tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # Navigate to Summary
    send_meta_payload(client, phone, "m_p3_b1", text="book")
    send_meta_payload(client, phone, "m_p3_b2", button_id="btn_book_self")
    send_meta_payload(client, phone, "m_p3_b3", text="Vikram Verma")
    send_meta_payload(client, phone, "m_p3_b4", button_id="reg_new")
    send_meta_payload(client, phone, "m_p3_b5", button_id="mode_doctors")
    send_meta_payload(client, phone, "m_p3_b6", list_id="doc_1")
    send_meta_payload(client, phone, "m_p3_b7", list_id=f"date_{tomorrow_str}")
    send_meta_payload(client, phone, "m_p3_b8", list_id="slot_10:00")

    # Click Confirm Appointment
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p3_confirm", button_id="btn_confirm_booking")
        assert res.status_code == 200
        assert mock_qr.called
        conf_body = mock_qr.call_args[1]["body_text"]
        assert "APPOINTMENT CONFIRMED" in conf_body
        assert "Vikram Verma" in conf_body
        assert "₹600" in conf_body

    db = SessionLocal()
    appt = db.query(Appointment).filter(Appointment.clinic_id == 1, Appointment.appointment_date == tomorrow_str).first()
    assert appt is not None
    assert appt.status == "CONFIRMED"
    assert appt.payment_status == "PENDING"
    assert appt.payment_method == "Pay at Clinic"
    assert appt.doctor.consultation_fee == 600
    db.close()


def test_family_member_booking_distinct_patients_same_phone(client):
    """Verifies booking for mother/child with same WhatsApp phone creates separate Patient records without constraint failure."""
    phone = "919888000004"
    tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # 1. Book for Parent (Self) on slot 11:00
    send_meta_payload(client, phone, "m_p3_f1", text="book")
    send_meta_payload(client, phone, "m_p3_f2", button_id="btn_book_self")
    send_meta_payload(client, phone, "m_p3_f3", text="Pooja Mehta")
    send_meta_payload(client, phone, "m_p3_f4", button_id="reg_new")
    send_meta_payload(client, phone, "m_p3_f5", button_id="mode_doctors")
    send_meta_payload(client, phone, "m_p3_f6", list_id="doc_1")
    send_meta_payload(client, phone, "m_p3_f7", list_id=f"date_{tomorrow_str}")
    send_meta_payload(client, phone, "m_p3_f8", list_id="slot_11:00")
    send_meta_payload(client, phone, "m_p3_f9", button_id="btn_confirm_booking")

    # 2. Book for Child (Someone Else) using the exact same phone number on slot 11:20
    send_meta_payload(client, phone, "m_p3_f10", text="book")
    send_meta_payload(client, phone, "m_p3_f11", button_id="btn_book_other")
    send_meta_payload(client, phone, "m_p3_f12", text="Aarav Mehta")
    send_meta_payload(client, phone, "m_p3_f13", button_id="reg_new")
    send_meta_payload(client, phone, "m_p3_f14", button_id="mode_doctors")
    send_meta_payload(client, phone, "m_p3_f15", list_id="doc_1")
    send_meta_payload(client, phone, "m_p3_f16", list_id=f"date_{tomorrow_str}")
    send_meta_payload(client, phone, "m_p3_f17", list_id="slot_11:20")
    send_meta_payload(client, phone, "m_p3_f18", button_id="btn_confirm_booking")

    db = SessionLocal()
    patients = db.query(Patient).filter(Patient.phone.like(f"%{phone[-10:]}%")).all()
    assert len(patients) >= 2
    names = {p.name for p in patients}
    assert "Pooja Mehta" in names
    assert "Aarav Mehta" in names

    appts = db.query(Appointment).filter(Appointment.clinic_id == 1, Appointment.appointment_date == tomorrow_str).all()
    assert len(appts) >= 2
    db.close()


def test_slot_collision_detection_at_confirmation(client):
    """Verifies that if a slot is booked by another patient before confirmation, collision is detected and patient is informed."""
    phone = "919888000005"
    tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # Patient reaches summary for slot 12:00
    send_meta_payload(client, phone, "m_p3_col1", text="book")
    send_meta_payload(client, phone, "m_p3_col2", button_id="btn_book_self")
    send_meta_payload(client, phone, "m_p3_col3", text="Sameer Khan")
    send_meta_payload(client, phone, "m_p3_col4", button_id="reg_new")
    send_meta_payload(client, phone, "m_p3_col5", button_id="mode_doctors")
    send_meta_payload(client, phone, "m_p3_col6", list_id="doc_1")
    send_meta_payload(client, phone, "m_p3_col7", list_id=f"date_{tomorrow_str}")
    send_meta_payload(client, phone, "m_p3_col8", list_id="slot_12:00")

    # Another patient books the 12:00 slot in the background
    db = SessionLocal()
    booking_service.book_appointment(
        db=db,
        phone="919999999999",
        patient_name="Competing Patient",
        doctor_id=1,
        date_str=tomorrow_str,
        start_time="12:00",
        clinic_id=1,
    )
    db.close()

    # Original patient attempts to confirm
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list, \
         patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_txt:
        res = send_meta_payload(client, phone, "m_p3_col9", button_id="btn_confirm_booking")
        assert res.status_code == 200
        # Should inform that slot was taken and show available slots list menu
        assert mock_list.called or mock_txt.called


def test_online_required_payment_policy_and_webhook_confirmation(client):
    """Verifies ONLINE_REQUIRED policy puts slot on temporary PENDING hold and confirms on Razorpay webhook."""
    phone = "919888000001"
    tomorrow_str = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    db = SessionLocal()
    clinic = db.query(Clinic).filter(Clinic.id == 1).first()
    clinic.payment_policy = "ONLINE_REQUIRED"
    db.commit()
    db.close()

    try:
        # User books slot 14:00
        send_meta_payload(client, phone, "m_p3_on1", text="book")
        send_meta_payload(client, phone, "m_p3_on2", button_id="btn_book_self")
        send_meta_payload(client, phone, "m_p3_on3", text="Rajesh Kumar")
        send_meta_payload(client, phone, "m_p3_on4", button_id="reg_new")
        send_meta_payload(client, phone, "m_p3_on5", button_id="mode_doctors")
        send_meta_payload(client, phone, "m_p3_on6", list_id="doc_1")
        send_meta_payload(client, phone, "m_p3_on7", list_id=f"date_{tomorrow_str}")
        send_meta_payload(client, phone, "m_p3_on8", list_id="slot_14:00")

        # Mock Razorpay payment link generation
        mock_link = {
            "payment_link_id": "plink_test_12345",
            "payment_url": "https://rzp.io/i/testlink123",
            "amount": 600,
        }
        with patch.object(settings, "RAZORPAY_KEY_ID", "rzp_live_key123"), \
             patch.object(settings, "RAZORPAY_KEY_SECRET", "rzp_secret_456"), \
             patch("app.services.razorpay_service.razorpay_service.create_payment_link", new_callable=AsyncMock, return_value=mock_link), \
             patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            res = send_meta_payload(client, phone, "m_p3_on9", button_id="btn_confirm_booking")
            assert res.status_code == 200
            assert mock_qr.called
            body = mock_qr.call_args[1]["body_text"]
            assert "SLOT RESERVED" in body
            assert "https://rzp.io/i/testlink123" in body

        # Verify DB status is PENDING reservation
        db = SessionLocal()
        appt = db.query(Appointment).filter(Appointment.clinic_id == 1, Appointment.start_time == "14:00").first()
        assert appt is not None
        assert appt.status == "PENDING"
        assert appt.payment_status == "PENDING"
        appt_id = appt.id
        db.close()

        # Send Razorpay Webhook: payment_link.paid
        rzp_payload = {
            "entity": "event",
            "event": "payment_link.paid",
            "contains": ["payment_link"],
            "payload": {
                "payment_link": {
                    "entity": {
                        "id": "plink_test_12345",
                        "notes": {"appointment_id": str(appt_id), "clinic_id": "1"},
                    }
                },
                "payment": {
                    "entity": {
                        "id": "pay_test_999",
                        "method": "upi",
                    }
                }
            }
        }
        raw_rzp = json.dumps(rzp_payload).encode("utf-8")
        rzp_secret = settings.RAZORPAY_WEBHOOK_SECRET or "rzp_webhook_secret"
        rzp_sig = hmac.new(rzp_secret.encode(), raw_rzp, hashlib.sha256).hexdigest()

        with patch("app.routers.payments.whatsapp_client.send_text", new_callable=AsyncMock):
            res = client.post(
                "/api/payments/razorpay/webhook",
                content=raw_rzp,
                headers={"X-Razorpay-Signature": rzp_sig, "Content-Type": "application/json"}
            )
            assert res.status_code == 200

        # Verify DB status is now CONFIRMED and PAID
        db = SessionLocal()
        updated_appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert updated_appt.status == "CONFIRMED"
        assert updated_appt.payment_status == "PAID"
        assert "UPI" in updated_appt.payment_method
        db.close()

    finally:
        db = SessionLocal()
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        clinic.payment_policy = "PAY_AT_CLINIC"
        db.commit()
        db.close()


def test_payment_failure_or_expiry_releases_slot(client):
    """Verifies that payment failure or link expiry cancels appointment and releases the slot."""
    db = SessionLocal()
    patient = booking_service.get_or_create_patient(db, "919888000001", "Temporary Hold Patient")
    appt = Appointment(
        clinic_id=1,
        doctor_id=1,
        patient_id=patient.id,
        appointment_date=(datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d"),
        start_time="15:00",
        end_time="15:30",
        status="PENDING",
        payment_status="PENDING",
        source="WhatsApp",
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    appt_id = appt.id
    db.close()

    rzp_payload = {
        "entity": "event",
        "event": "payment_link.expired",
        "contains": ["payment_link"],
        "payload": {
            "payment_link": {
                "entity": {
                    "id": "plink_expired_test",
                    "notes": {"appointment_id": str(appt_id), "clinic_id": "1"},
                }
            }
        }
    }
    raw_rzp = json.dumps(rzp_payload).encode("utf-8")
    rzp_secret = settings.RAZORPAY_WEBHOOK_SECRET or "rzp_webhook_secret"
    rzp_sig = hmac.new(rzp_secret.encode(), raw_rzp, hashlib.sha256).hexdigest()

    with patch("app.routers.payments.whatsapp_client.send_text", new_callable=AsyncMock):
        res = client.post(
            "/api/payments/razorpay/webhook",
            content=raw_rzp,
            headers={"X-Razorpay-Signature": rzp_sig, "Content-Type": "application/json"}
        )
        assert res.status_code == 200

    db = SessionLocal()
    released_appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    assert released_appt.status == "CANCELLED"
    assert released_appt.payment_status == "FAILED"
    db.close()
