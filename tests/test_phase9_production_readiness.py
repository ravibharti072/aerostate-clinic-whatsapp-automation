import pytest
import json
import hmac
import hashlib
import datetime
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.models import (
    Clinic,
    Doctor,
    Patient,
    Appointment,
    Invoice,
    Payment,
    Prescription,
    LabOrder,
    PatientFeedback,
    FollowUpSchedule,
    DocumentAccessGrant,
    NotificationLog,
    ConversationSession,
    ProcessedWebhookMessage,
    ReceptionHandoverRequest,
    ClinicFAQ,
)
from app.services.booking import booking_service
from app.services.post_appointment import post_appointment_service
from app.services.safety import MEDICAL_SAFETY_DISCLAIMER
from app.services.razorpay_service import razorpay_service
from main import app

TEST_APP_SECRET = "production_test_secret_ph9"


@pytest.fixture(autouse=True)
def setup_production_db():
    db = SessionLocal()
    try:
        # Purge test records
        db.query(ProcessedWebhookMessage).delete()
        db.query(ConversationSession).delete()
        db.query(NotificationLog).filter(NotificationLog.clinic_id.in_([901, 902])).delete()
        db.query(DocumentAccessGrant).filter(DocumentAccessGrant.clinic_id.in_([901, 902])).delete()
        db.query(PatientFeedback).filter(PatientFeedback.clinic_id.in_([901, 902])).delete()
        db.query(FollowUpSchedule).filter(FollowUpSchedule.clinic_id.in_([901, 902])).delete()
        db.query(ReceptionHandoverRequest).filter(ReceptionHandoverRequest.clinic_id.in_([901, 902])).delete()
        db.query(ClinicFAQ).filter(ClinicFAQ.clinic_id.in_([901, 902])).delete()
        db.query(Payment).delete()
        db.query(Invoice).delete()
        db.query(Prescription).delete()
        db.query(LabOrder).delete()
        db.query(Appointment).filter(Appointment.clinic_id.in_([901, 902])).delete()
        db.query(Doctor).filter(Doctor.clinic_id.in_([901, 902])).delete()
        db.query(Patient).filter(Patient.phone.like("9199999%")).delete()
        db.query(Clinic).filter(Clinic.id.in_([901, 902])).delete()
        db.commit()

        # Clinic 1: Prime Health Care (PID: WABA_PID_901)
        c1 = Clinic(
            id=901,
            code="CLN-PROD-1",
            name="Prime Health Care",
            phone_number_id="WABA_PID_901",
            is_active=True,
            phone="+919876590100",
            address="100 Medical Boulevard, Sector 1, Agra",
            operating_hours="Mon-Sat: 09:00 AM - 06:00 PM",
            reception_phone="+919876590101",
            reception_start_time="09:00",
            reception_end_time="18:00",
            payment_policy="PAY_AT_CLINIC",
            feedback_enabled=True,
            followup_reminders_enabled=True,
            document_access_enabled=True,
            payment_receipt_enabled=True,
        )

        # Clinic 2: City Dental & Orthodontics (PID: WABA_PID_902)
        c2 = Clinic(
            id=902,
            code="CLN-PROD-2",
            name="City Dental Clinic",
            phone_number_id="WABA_PID_902",
            is_active=True,
            phone="+919876590200",
            address="200 Smile Avenue, Agra",
            operating_hours="Mon-Sun: 10:00 AM - 08:00 PM",
            reception_phone="+919876590201",
            reception_start_time="10:00",
            reception_end_time="20:00",
            payment_policy="ONLINE_REQUIRED",
            feedback_enabled=False,
            followup_reminders_enabled=False,
            document_access_enabled=False,
            payment_receipt_enabled=False,
        )
        db.add_all([c1, c2])
        db.commit()

        # Doctors
        doc1 = Doctor(
            id=901,
            clinic_id=901,
            name="Dr. Sanjeev Kapoor",
            specialization="General Physician",
            consultation_fee=600.0,
            start_time="09:00",
            end_time="17:00",
            slot_duration_mins=30,
            is_active=True,
        )
        doc2 = Doctor(
            id=902,
            clinic_id=902,
            name="Dr. Meera Nambiar",
            specialization="Dentistry",
            consultation_fee=400.0,
            start_time="10:00",
            end_time="18:00",
            slot_duration_mins=30,
            is_active=True,
        )
        db.add_all([doc1, doc2])
        db.commit()

        # FAQs
        faq1 = ClinicFAQ(
            clinic_id=901,
            category="Timings",
            question="What are your clinic hours?",
            answer="Prime Health Care is open Monday to Saturday from 09:00 AM to 06:00 PM.",
            is_active=True,
        )
        faq2 = ClinicFAQ(
            clinic_id=902,
            category="Timings",
            question="What are your clinic hours?",
            answer="City Dental Clinic is open all days from 10:00 AM to 08:00 PM.",
            is_active=True,
        )
        db.add_all([faq1, faq2])
        db.commit()

    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        db.query(ProcessedWebhookMessage).delete()
        db.query(ConversationSession).delete()
        db.query(NotificationLog).filter(NotificationLog.clinic_id.in_([901, 902])).delete()
        db.query(DocumentAccessGrant).filter(DocumentAccessGrant.clinic_id.in_([901, 902])).delete()
        db.query(PatientFeedback).filter(PatientFeedback.clinic_id.in_([901, 902])).delete()
        db.query(FollowUpSchedule).filter(FollowUpSchedule.clinic_id.in_([901, 902])).delete()
        db.query(ReceptionHandoverRequest).filter(ReceptionHandoverRequest.clinic_id.in_([901, 902])).delete()
        db.query(ClinicFAQ).filter(ClinicFAQ.clinic_id.in_([901, 902])).delete()
        db.query(Payment).delete()
        db.query(Invoice).delete()
        db.query(Prescription).delete()
        db.query(LabOrder).delete()
        db.query(Appointment).filter(Appointment.clinic_id.in_([901, 902])).delete()
        db.query(Doctor).filter(Doctor.clinic_id.in_([901, 902])).delete()
        db.query(Patient).filter(Patient.phone.like("9199999%")).delete()
        db.query(Clinic).filter(Clinic.id.in_([901, 902])).delete()
        db.commit()
    finally:
        db.close()


def send_signed_webhook(client: TestClient, payload: dict, app_secret: str = TEST_APP_SECRET, custom_sig: str = None):
    payload_bytes = json.dumps(payload).encode("utf-8")
    if custom_sig is not None:
        sig = custom_sig
    else:
        sig = "sha256=" + hmac.new(app_secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    with patch.object(settings, "META_APP_SECRET", app_secret):
        return client.post(
            "/webhook",
            data=payload_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig},
        )


def make_payload(phone_number_id, from_phone, text=None, button_id=None, list_id=None, user_name="Test Patient", msg_id="msg_p9_1"):
    if button_id:
        msg_obj = {
            "from": from_phone,
            "id": msg_id,
            "timestamp": "1730000000",
            "type": "interactive",
            "interactive": {
                "type": "button_reply",
                "button_reply": {"id": button_id, "title": text or button_id},
            },
        }
    elif list_id:
        msg_obj = {
            "from": from_phone,
            "id": msg_id,
            "timestamp": "1730000000",
            "type": "interactive",
            "interactive": {
                "type": "list_reply",
                "list_reply": {"id": list_id, "title": text or list_id},
            },
        }
    else:
        msg_obj = {
            "from": from_phone,
            "id": msg_id,
            "timestamp": "1730000000",
            "type": "text",
            "text": {"body": text},
        }

    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "BIZ_PROD_9",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "15550220",
                                "phone_number_id": phone_number_id,
                            },
                            "contacts": [{"profile": {"name": user_name}, "wa_id": from_phone}],
                            "messages": [msg_obj],
                        },
                    }
                ],
            }
        ],
    }


# ==============================================================================
# 1. END-TO-END PATIENT TESTING
# ==============================================================================

@patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock)
@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
@patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock)
def test_e2e_complete_patient_lifecycle(mock_text, mock_btn, mock_list):
    """
    Simulates the complete patient lifecycle:
    HI -> Menu -> Book Myself -> Name -> Select General Doctor -> Select Date
    -> Select Slot -> Summary -> Confirm -> Reminders Scheduled -> View -> Complete -> Feedback.
    """
    client = TestClient(app)
    phone = "919999900001"
    pid = "WABA_PID_901"

    # Step 1: Patient sends HI
    p1 = make_payload(pid, phone, text="HI", user_name="Aman Verma", msg_id="e2e_1")
    r1 = send_signed_webhook(client, p1)
    assert r1.status_code == 200
    assert mock_list.called
    assert "Option" in mock_list.call_args[1].get("button_label", "")

    # Step 2: Patient selects Book Appointment (menu_book)
    mock_btn.reset_mock()
    p2 = make_payload(pid, phone, list_id="menu_book", user_name="Aman Verma", msg_id="e2e_2")
    r2 = send_signed_webhook(client, p2)
    assert r2.status_code == 200
    assert mock_btn.called
    btn_ids = [b["id"] for b in mock_btn.call_args[1].get("buttons", [])]
    assert "btn_book_self" in btn_ids
    assert "btn_book_other" in btn_ids

    # Step 3: Patient chooses Myself
    mock_text.reset_mock()
    p3 = make_payload(pid, phone, button_id="btn_book_self", user_name="Aman Verma", msg_id="e2e_3")
    r3 = send_signed_webhook(client, p3)
    assert r3.status_code == 200
    assert mock_text.called
    assert "full name" in mock_text.call_args[1].get("text", "").lower()

    # Step 4: Patient provides full name
    mock_btn.reset_mock()
    p4 = make_payload(pid, phone, text="Aman Verma", user_name="Aman Verma", msg_id="e2e_4")
    r4 = send_signed_webhook(client, p4)
    assert r4.status_code == 200
    assert mock_btn.called
    skip_btn_ids = [b["id"] for b in mock_btn.call_args[1].get("buttons", [])]
    assert "btn_skip_reason" in skip_btn_ids

    # Step 4b: Patient skips reason -> Doctor selection modes presented
    mock_btn.reset_mock()
    p4b = make_payload(pid, phone, button_id="btn_skip_reason", user_name="Aman Verma", msg_id="e2e_4b")
    r4b = send_signed_webhook(client, p4b)
    assert r4b.status_code == 200
    assert mock_btn.called
    mode_btn_ids = [b["id"] for b in mock_btn.call_args[1].get("buttons", [])]
    assert "mode_general" in mode_btn_ids or "mode_symptoms" in mode_btn_ids

    # Step 5: Patient chooses General Doctor (mode_general)
    mock_list.reset_mock()
    p5 = make_payload(pid, phone, button_id="mode_general", user_name="Aman Verma", msg_id="e2e_5")
    r5 = send_signed_webhook(client, p5)
    assert r5.status_code == 200
    assert mock_list.called
    # Dates list presented
    assert "Date" in mock_list.call_args[1].get("button_label", "")

    # Target test date: pick tomorrow's date
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # Step 6: Patient picks Date
    mock_list.reset_mock()
    p6 = make_payload(pid, phone, list_id=f"date_{tomorrow}", user_name="Aman Verma", msg_id="e2e_6")
    r6 = send_signed_webhook(client, p6)
    assert r6.status_code == 200
    assert mock_list.called
    # Slots list presented
    assert "Time" in mock_list.call_args[1].get("button_label", "")

    # Step 7: Patient picks Slot (e.g. 10:00)
    mock_btn.reset_mock()
    p7 = make_payload(pid, phone, list_id="slot_10:00", user_name="Aman Verma", msg_id="e2e_7")
    r7 = send_signed_webhook(client, p7)
    assert r7.status_code == 200
    assert mock_btn.called
    summary_body = mock_btn.call_args[1].get("body_text", "")
    assert "Appointment Summary" in summary_body
    assert "Dr. Sanjeev Kapoor" in summary_body
    assert "10:00" in summary_body
    confirm_btn_ids = [b["id"] for b in mock_btn.call_args[1].get("buttons", [])]
    assert "btn_confirm_booking" in confirm_btn_ids

    # Step 8: Patient confirms booking
    mock_btn.reset_mock()
    p8 = make_payload(pid, phone, button_id="btn_confirm_booking", user_name="Aman Verma", msg_id="e2e_8")
    r8 = send_signed_webhook(client, p8)
    assert r8.status_code == 200

    # Verify Appointment is created in database with CONFIRMED status
    db = SessionLocal()
    created_appt = (
        db.query(Appointment)
        .filter(Appointment.clinic_id == 901, Appointment.appointment_date == tomorrow, Appointment.start_time == "10:00")
        .first()
    )
    assert created_appt is not None
    assert created_appt.status == "CONFIRMED"
    assert created_appt.patient.name == "Aman Verma"

    # Verify scheduled reminders logged in NotificationLog
    notifs = db.query(NotificationLog).filter(NotificationLog.appointment_id == created_appt.id).all()
    notif_types = [n.notification_type for n in notifs]
    assert "REMINDER_24H" in notif_types or "REMINDER_2H" in notif_types or "CONFIRMATION" in notif_types

    # Step 9: Patient views My Appointments (menu_view)
    mock_btn.reset_mock()
    p9 = make_payload(pid, phone, list_id="menu_view", user_name="Aman Verma", msg_id="e2e_9")
    r9 = send_signed_webhook(client, p9)
    assert r9.status_code == 200
    assert mock_btn.called
    view_body = mock_btn.call_args[1].get("body_text", "")
    assert "Upcoming Appointments" in view_body
    assert "Dr. Sanjeev Kapoor" in view_body

    # Step 10: Receptionist Handover (menu_human)
    mock_btn.reset_mock()
    p10 = make_payload(pid, phone, list_id="menu_human", user_name="Aman Verma", msg_id="e2e_10")
    r10 = send_signed_webhook(client, p10)
    assert r10.status_code == 200
    handover = db.query(ReceptionHandoverRequest).filter(ReceptionHandoverRequest.clinic_id == 901).first()
    assert handover is not None
    assert handover.status == "Open"

    # Step 11: Consultation Completed by Doctor & Feedback Request Dispatched
    mock_btn.reset_mock()
    comp_res = post_appointment_service.complete_appointment(db, created_appt.id, completed_by="Dr. Sanjeev Kapoor")
    assert comp_res["status"] == "COMPLETED"
    assert comp_res["feedback_sent"] is True

    # Step 12: Patient submits Feedback rating
    p12 = make_payload(pid, phone, button_id=f"fb_rate_5_{created_appt.id}", text="⭐⭐⭐⭐⭐ Excellent", user_name="Aman Verma", msg_id="e2e_12")
    r12 = send_signed_webhook(client, p12)
    assert r12.status_code == 200

    fb = db.query(PatientFeedback).filter(PatientFeedback.appointment_id == created_appt.id).first()
    assert fb is not None
    assert fb.rating == 5

    db.close()


# ==============================================================================
# 2. MULTI-CLINIC TENANT ISOLATION TESTING
# ==============================================================================

@patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock)
@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_multi_clinic_isolation_and_distinct_configurations(mock_btn, mock_list):
    """
    Verifies two distinct clinics (Prime Health Care vs City Dental):
    - Distinct phone_number_ids (WABA_PID_901 vs WABA_PID_902)
    - Distinct doctors & specialties (Dr. Sanjeev vs Dr. Meera)
    - Distinct consultation fees (₹600 vs ₹400)
    - Distinct FAQs
    - Strict cross-clinic access prevention (Patient at clinic 901 cannot cancel clinic 902's appt).
    """
    client = TestClient(app)

    # 1. Clinic 901 FAQ check
    p_faq_1 = make_payload("WABA_PID_901", "919999900010", text="What are your clinic hours?", msg_id="mcl_1")
    r_faq_1 = send_signed_webhook(client, p_faq_1)
    assert r_faq_1.status_code == 200
    assert mock_btn.called
    body_c1 = mock_btn.call_args[1].get("body_text", "")
    assert "Prime Health Care is open Monday to Saturday" in body_c1
    assert "City Dental" not in body_c1

    # 2. Clinic 902 FAQ check
    mock_btn.reset_mock()
    p_faq_2 = make_payload("WABA_PID_902", "919999900011", text="What are your clinic hours?", msg_id="mcl_2")
    r_faq_2 = send_signed_webhook(client, p_faq_2)
    assert r_faq_2.status_code == 200
    assert mock_btn.called
    body_c2 = mock_btn.call_args[1].get("body_text", "")
    assert "City Dental Clinic is open all days" in body_c2
    assert "Prime Health Care" not in body_c2

    # 3. Doctors list query for Clinic 901
    mock_list.reset_mock()
    p_doc_1 = make_payload("WABA_PID_901", "919999900010", text="DOCTORS", msg_id="mcl_3")
    r_doc_1 = send_signed_webhook(client, p_doc_1)
    assert r_doc_1.status_code == 200
    # Must list Dr. Sanjeev Kapoor, NOT Dr. Meera Nambiar
    sections_c1 = mock_list.call_args[1].get("sections", [])
    row_titles_c1 = [r["title"] for s in sections_c1 for r in s.get("rows", [])]
    assert any("Sanjeev Kapoor" in t for t in row_titles_c1)
    assert not any("Meera Nambiar" in t for t in row_titles_c1)

    # 4. Doctors list query for Clinic 902
    mock_list.reset_mock()
    p_doc_2 = make_payload("WABA_PID_902", "919999900011", text="DOCTORS", msg_id="mcl_4")
    r_doc_2 = send_signed_webhook(client, p_doc_2)
    assert r_doc_2.status_code == 200
    sections_c2 = mock_list.call_args[1].get("sections", [])
    row_titles_c2 = [r["title"] for s in sections_c2 for r in s.get("rows", [])]
    assert any("Meera Nambiar" in t for t in row_titles_c2)
    assert not any("Sanjeev Kapoor" in t for t in row_titles_c2)

    # 5. Cross-Clinic Tampering Defense:
    # Create appointment under Clinic 902
    db = SessionLocal()
    pat_c2 = Patient(name="Neha Singh", phone="919999900012")
    db.add(pat_c2)
    db.commit()

    appt_c2 = Appointment(
        id=999,
        clinic_id=902,
        patient_id=pat_c2.id,
        doctor_id=902,
        appointment_date="2026-11-20",
        start_time="11:00",
        end_time="11:30",
        status="CONFIRMED",
    )
    db.add(appt_c2)
    db.commit()
    db.close()

    # Attacker tries to cancel appt #999 via Clinic 901 webhook channel
    p_cancel_attack = make_payload("WABA_PID_901", "919999900012", button_id="confirm_cancel_999", msg_id="mcl_attack")
    r_attack = send_signed_webhook(client, p_cancel_attack)
    assert r_attack.status_code == 200

    # Appointment must remain CONFIRMED (cross-clinic tampering rejected)
    db = SessionLocal()
    queried_appt = db.query(Appointment).filter(Appointment.id == 999).first()
    assert queried_appt.status == "CONFIRMED"
    db.close()


# ==============================================================================
# 3. SECURITY TESTING
# ==============================================================================

def test_security_invalid_and_missing_meta_signatures_rejected():
    """In production mode, missing or invalid X-Hub-Signature-256 must be rejected with HTTP 403."""
    client = TestClient(app)
    payload = make_payload("WABA_PID_901", "919999900020", text="HI", msg_id="sec_sig_1")
    payload_bytes = json.dumps(payload).encode("utf-8")

    # 1. Missing signature
    with patch.object(settings, "META_APP_SECRET", TEST_APP_SECRET):
        r_missing = client.post("/webhook", data=payload_bytes, headers={"Content-Type": "application/json"})
        assert r_missing.status_code == 403

    # 2. Tampered signature
    with patch.object(settings, "META_APP_SECRET", TEST_APP_SECRET):
        r_bad = client.post(
            "/webhook",
            data=payload_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": "sha256=invalid_hash_value_12345"},
        )
        assert r_bad.status_code == 403


@patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock)
def test_security_duplicate_webhook_message_idempotency(mock_list):
    """Identical incoming message_id is processed exactly once; duplicates are discarded idempotently."""
    client = TestClient(app)
    payload = make_payload("WABA_PID_901", "919999900021", text="MENU", msg_id="sec_dup_msg_100")

    # First delivery
    r1 = send_signed_webhook(client, payload)
    assert r1.status_code == 200
    assert mock_list.call_count == 1

    # Immediate redelivery from Meta
    r2 = send_signed_webhook(client, payload)
    assert r2.status_code == 200
    # Handler should NOT execute again
    assert mock_list.call_count == 1


def test_security_razorpay_signature_tampering_rejected():
    """Tampered Razorpay payment webhook signature must be rejected."""
    client = TestClient(app)
    webhook_secret = "rzp_secret_ph9"
    payload = {
        "event": "payment.captured",
        "payload": {
            "payment": {"entity": {"id": "pay_test_tamper_1", "amount": 60000, "status": "captured"}},
        },
    }
    raw_body = json.dumps(payload).encode("utf-8")
    tampered_sig = "invalid_rzp_signature_hex"

    with patch.object(settings, "RAZORPAY_WEBHOOK_SECRET", webhook_secret):
        resp = client.post(
            "/api/payments/razorpay-webhook",
            data=raw_body,
            headers={"Content-Type": "application/json", "X-Razorpay-Signature": tampered_sig},
        )
        assert resp.status_code == 403
        assert "Invalid signature" in resp.text


@patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock)
def test_security_slot_concurrency_double_booking_lock(mock_list):
    """When two patients attempt to book the exact same slot concurrently, second attempt is locked and notified."""
    client = TestClient(app)
    db = SessionLocal()
    target_date = "2026-11-25"
    target_slot = "14:00"

    # Patient 1 has already booked slot 14:00
    pat1 = Patient(name="Ravi Patient 1", phone="919999900030")
    db.add(pat1)
    db.commit()

    existing_appt = Appointment(
        clinic_id=901,
        patient_id=pat1.id,
        doctor_id=901,
        appointment_date=target_date,
        start_time=target_slot,
        end_time="14:30",
        status="CONFIRMED",
    )
    db.add(existing_appt)
    db.commit()

    # Patient 2 prepares booking summary with identical slot
    session2 = booking_service.get_session(db, "919999900031", clinic_id=901)
    booking_service.update_session(
        db,
        "919999900031",
        step="CONFIRMING_BOOKING",
        context={
            "clinic_id": 901,
            "doctor_id": 901,
            "doctor_name": "Dr. Sanjeev Kapoor",
            "date_str": target_date,
            "start_time": target_slot,
            "patient_name": "Vikas Patient 2",
        },
        clinic_id=901,
    )
    db.close()

    # Patient 2 tries to confirm
    p_confirm2 = make_payload("WABA_PID_901", "919999900031", button_id="btn_confirm_booking", msg_id="sec_concur_1")
    r2 = send_signed_webhook(client, p_confirm2)
    assert r2.status_code == 200

    # Must notify Patient 2 that slot is no longer available
    assert mock_list.called
    body = mock_list.call_args[1].get("body_text", "")
    assert "booked by another patient" in body


def test_security_document_access_token_tampering_and_isolation():
    """Document access tokens must resist tampering, enforce expiration, and isolate clinics."""
    client = TestClient(app)
    db = SessionLocal()
    try:
        pat = Patient(name="Ravi Patient Doc", phone="919999900035")
        db.add(pat)
        db.commit()

        appt = Appointment(
            clinic_id=901,
            patient_id=pat.id,
            doctor_id=901,
            appointment_date="2026-11-20",
            start_time="10:00",
            end_time="10:30",
            status="COMPLETED",
        )
        db.add(appt)
        db.commit()

        rx = Prescription(
            appointment_id=appt.id,
            patient_id=pat.id,
            doctor_id=901,
            diagnosis="Seasonal Rhinitis",
            medicines="Cetirizine 10mg OD",
            advice="Stay hydrated",
            prescription_uid="RX-901-001",
        )
        db.add(rx)
        db.commit()

        # 1. Valid token issuance
        grant = post_appointment_service.create_document_access_grant(
            db, clinic_id=901, patient_id=pat.id, document_type="PRESCRIPTION", document_id=rx.id, expiry_hours=24
        )
        valid_token = grant.token

        resp_valid = client.get(f"/portal/documents/{valid_token}?patient_id={pat.id}")
        assert resp_valid.status_code == 200
        assert resp_valid.json()["document_type"] == "PRESCRIPTION"
        assert resp_valid.json()["document"]["diagnosis"] == "Seasonal Rhinitis"

        # 2. Tampered token
        resp_tampered = client.get(f"/portal/documents/{valid_token}BAD?patient_id={pat.id}")
        assert resp_tampered.status_code == 404

        # 3. Expired token
        grant.expires_at = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
        db.commit()

        resp_expired = client.get(f"/portal/documents/{valid_token}?patient_id={pat.id}")
        assert resp_expired.status_code == 410

        # 4. Cross-patient isolation (different patient attempting access)
        grant.expires_at = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        db.commit()

        resp_unauth = client.get(f"/portal/documents/{valid_token}?patient_id=999999")
        assert resp_unauth.status_code == 403
    finally:
        db.close()


# ==============================================================================
# 4. RELIABILITY TESTING
# ==============================================================================

@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_reliability_unexpected_patient_messages_safe_recovery(mock_send):
    """Patient sending random unexpected text during an active booking step receives guidance without crash."""
    client = TestClient(app)
    db = SessionLocal()
    # Set session to active selection step
    session = booking_service.get_session(db, "919999900040", clinic_id=901)
    booking_service.update_session(db, "919999900040", step="SELECTING_MODE", context={"clinic_id": 901}, clinic_id=901)
    db.close()

    # Patient types random gibberish
    p_gibberish = make_payload("WABA_PID_901", "919999900040", text="asdfghjkl random noise 123", msg_id="rel_gib_1")
    resp = send_signed_webhook(client, p_gibberish)
    assert resp.status_code == 200

    assert mock_send.called
    body = mock_send.call_args[1].get("body_text", "")
    assert "We received your message" in body
    assert "choose below to proceed" in body


@patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock)
def test_reliability_abandoned_flow_reset_on_menu_command(mock_list):
    """Patient abandons half-completed booking and later types MENU; session cleanly resets to IDLE."""
    client = TestClient(app)
    db = SessionLocal()
    session = booking_service.get_session(db, "919999900041", clinic_id=901)
    booking_service.update_session(db, "919999900041", step="COLLECTING_GENDER", context={"clinic_id": 901}, clinic_id=901)
    db.close()

    # Patient sends MENU
    p_menu = make_payload("WABA_PID_901", "919999900041", text="MENU", msg_id="rel_menu_reset")
    resp = send_signed_webhook(client, p_menu)
    assert resp.status_code == 200

    # Session step returned to IDLE
    db = SessionLocal()
    resetted_session = booking_service.get_session(db, "919999900041", clinic_id=901)
    assert resetted_session.step == "IDLE"
    assert mock_list.called
    db.close()


def test_reliability_whatsapp_api_failure_logged_and_retryable():
    """Transient WhatsApp API failure creates FAILED notification record with retry capability."""
    db = SessionLocal()
    try:
        from app.services.notifications import notification_service
        clinic = db.query(Clinic).filter(Clinic.id == 901).first()

        pat = Patient(name="Ravi Notif Pat", phone="919999900050")
        db.add(pat)
        db.commit()

        appt = Appointment(
            clinic_id=901,
            patient_id=pat.id,
            doctor_id=901,
            appointment_date="2026-11-25",
            start_time="10:00",
            end_time="10:30",
            status="CONFIRMED",
        )
        db.add(appt)
        db.commit()

        # 1. Transient failure during send
        with patch("app.services.notifications.whatsapp_client.send_text", side_effect=Exception("Connection timed out")):
            log = notification_service.send_notification(
                db=db,
                clinic=clinic,
                appointment=appt,
                notification_type="REMINDER_24H",
                recipient_phone="919999900050",
                use_buttons=False,
                force=True,
            )
            assert log is not None
            assert log.status == "FAILED"
            assert log.retry_count == 1
            assert "Connection timed out" in (log.error_message or "")

        # 2. Recovery and Retry succeeds
        with patch("app.services.notifications.whatsapp_client.send_text", new_callable=AsyncMock) as mock_send_txt, \
             patch("app.services.notifications.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_send_btn:
            mock_send_txt.return_value = {"messages": [{"id": "wamid_retry_success"}]}
            mock_send_btn.return_value = {"messages": [{"id": "wamid_retry_success"}]}
            retried = notification_service.retry_failed_notifications(db)
            assert retried >= 1
            db.refresh(log)
            assert log.status == "SENT"
            assert log.meta_message_id == "wamid_retry_success"
    finally:
        db.close()
