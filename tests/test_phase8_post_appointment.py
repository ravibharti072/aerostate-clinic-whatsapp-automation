import pytest
import json
import datetime
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

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
)
from app.services.post_appointment import post_appointment_service
from app.services.booking import booking_service
from main import app


@pytest.fixture(autouse=True)
def setup_db():
    db = SessionLocal()
    try:
        db.query(ProcessedWebhookMessage).delete()
        db.query(ConversationSession).delete()
        db.query(NotificationLog).filter(NotificationLog.clinic_id.in_([801, 802])).delete()
        db.query(DocumentAccessGrant).filter(DocumentAccessGrant.clinic_id.in_([801, 802])).delete()
        db.query(PatientFeedback).filter(PatientFeedback.clinic_id.in_([801, 802])).delete()
        db.query(FollowUpSchedule).filter(FollowUpSchedule.clinic_id.in_([801, 802])).delete()
        db.query(Prescription).delete()
        db.query(LabOrder).delete()
        db.query(Payment).delete()
        db.query(Invoice).delete()
        db.query(Appointment).filter(Appointment.clinic_id.in_([801, 802])).delete()
        db.query(Doctor).filter(Doctor.clinic_id.in_([801, 802])).delete()
        db.query(Patient).filter(Patient.phone.like("9198888%")).delete()
        db.query(Clinic).filter(Clinic.id.in_([801, 802])).delete()
        db.commit()

        # Clinic 1: Full post-appointment features enabled
        c1 = Clinic(
            id=801,
            code="CLN-PH8-1",
            name="Apex Wellness Clinic",
            phone_number_id="meta_phone_ph8_1",
            is_active=True,
            feedback_enabled=True,
            followup_reminders_enabled=True,
            followup_default_days=7,
            document_access_enabled=True,
            document_token_expiry_hours=24,
            payment_receipt_enabled=True,
        )
        # Clinic 2: Features disabled / restricted
        c2 = Clinic(
            id=802,
            code="CLN-PH8-2",
            name="Minimalist Care Center",
            phone_number_id="meta_phone_ph8_2",
            is_active=True,
            feedback_enabled=False,
            followup_reminders_enabled=False,
            document_access_enabled=False,
            payment_receipt_enabled=False,
        )
        db.add_all([c1, c2])
        db.commit()

        doc1 = Doctor(
            id=801,
            clinic_id=801,
            name="Dr. Alok Verma",
            specialization="Internal Medicine",
            consultation_fee=700.0,
            is_active=True,
        )
        db.add(doc1)
        db.commit()

        pat1 = Patient(
            id=801,
            name="Rohit Mehra",
            phone="919888800001",
        )
        pat2 = Patient(
            id=802,
            name="Sneha Kapoor",
            phone="919888800002",
        )
        db.add_all([pat1, pat2])
        db.commit()
    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        db.query(ProcessedWebhookMessage).delete()
        db.query(ConversationSession).delete()
        db.query(NotificationLog).filter(NotificationLog.clinic_id.in_([801, 802])).delete()
        db.query(DocumentAccessGrant).filter(DocumentAccessGrant.clinic_id.in_([801, 802])).delete()
        db.query(PatientFeedback).filter(PatientFeedback.clinic_id.in_([801, 802])).delete()
        db.query(FollowUpSchedule).filter(FollowUpSchedule.clinic_id.in_([801, 802])).delete()
        db.query(Prescription).delete()
        db.query(LabOrder).delete()
        db.query(Payment).delete()
        db.query(Invoice).delete()
        db.query(Appointment).filter(Appointment.clinic_id.in_([801, 802])).delete()
        db.query(Doctor).filter(Doctor.clinic_id.in_([801, 802])).delete()
        db.query(Patient).filter(Patient.phone.like("9198888%")).delete()
        db.query(Clinic).filter(Clinic.id.in_([801, 802])).delete()
        db.commit()
    finally:
        db.close()


def send_signed_webhook(client: TestClient, payload: dict, app_secret: str = "test_meta_secret_ph8"):
    import hmac, hashlib
    from app.config import settings
    payload_bytes = json.dumps(payload).encode("utf-8")
    sig = "sha256=" + hmac.new(app_secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    with patch.object(settings, "META_APP_SECRET", app_secret):
        return client.post(
            "/webhook",
            data=payload_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig},
        )


def send_webhook_button(client, phone, button_id, button_title="Option", msg_id="btn_p8_1", phone_number_id="meta_phone_ph8_1"):
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "entry_p8",
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


def send_webhook_text(client, phone, text, msg_id="msg_p8_1", phone_number_id="meta_phone_ph8_1"):
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "entry_p8",
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


# ==============================================================================
# TESTS
# ==============================================================================

@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_appointment_completion_explicit_triggers_feedback_and_followup(mock_send):
    """Staff explicitly marks appointment COMPLETED in ERP, triggering feedback and scheduling follow-up."""
    db = SessionLocal()
    appt = Appointment(
        id=801,
        clinic_id=801,
        patient_id=801,
        doctor_id=801,
        appointment_date="2026-11-12",
        start_time="10:00",
        end_time="10:30",
        status="CONFIRMED",
    )
    db.add(appt)
    db.commit()
    db.close()

    # Complete the appointment via post-appointment service
    db = SessionLocal()
    result = post_appointment_service.complete_appointment(
        db,
        appointment_id=801,
        completed_by="Dr. Verma",
        send_feedback=True,
        schedule_followup_reminder=True,
    )
    assert result["status"] == "COMPLETED"
    assert result["feedback_sent"] is True
    assert result["followup_scheduled"] is True

    # Verify DB status updated
    updated_appt = db.query(Appointment).filter(Appointment.id == 801).first()
    assert updated_appt.status == "COMPLETED"

    # Verify FollowUpSchedule created
    followup = db.query(FollowUpSchedule).filter(FollowUpSchedule.appointment_id == 801).first()
    assert followup is not None
    assert followup.followup_date == "2026-11-19"  # 12 + 7 days
    assert followup.status == "SCHEDULED"

    # Verify Feedback Notification sent
    assert mock_send.called
    call_args = mock_send.call_args[1]
    body_text = call_args.get("body_text", "")
    assert "Apex Wellness Clinic" in body_text
    assert "Dr. Alok Verma" in body_text
    assert "How was your visit?" in body_text

    db.close()


def test_appointment_not_completed_simply_because_time_passed():
    """Past appointments must NOT be marked COMPLETED automatically without staff action."""
    db = SessionLocal()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    appt = Appointment(
        id=802,
        clinic_id=801,
        patient_id=801,
        doctor_id=801,
        appointment_date=yesterday,
        start_time="09:00",
        end_time="09:30",
        status="CONFIRMED",
    )
    db.add(appt)
    db.commit()

    # Querying appointment shows it remains CONFIRMED (not silently completed)
    queried = db.query(Appointment).filter(Appointment.id == 802).first()
    assert queried.status == "CONFIRMED"
    db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_appointment_completion_respects_clinic_feedback_disabled(mock_send):
    """When clinic has feedback_enabled = False, no feedback request is dispatched."""
    db = SessionLocal()
    appt = Appointment(
        id=803,
        clinic_id=802,  # Clinic 2 has feedback_enabled = False
        patient_id=802,
        doctor_id=801,
        appointment_date="2026-11-12",
        start_time="11:00",
        end_time="11:30",
        status="CONFIRMED",
    )
    db.add(appt)
    db.commit()

    result = post_appointment_service.complete_appointment(db, appointment_id=803)
    assert result["status"] == "COMPLETED"
    assert result["feedback_sent"] is False
    assert not mock_send.called
    db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_feedback_rating_submission_via_whatsapp_button(mock_send):
    """Patient taps rating button on WhatsApp; rating is saved and optional comments are invited."""
    client = TestClient(app)
    db = SessionLocal()
    appt = Appointment(
        id=804,
        clinic_id=801,
        patient_id=801,
        doctor_id=801,
        appointment_date="2026-11-12",
        start_time="12:00",
        end_time="12:30",
        status="COMPLETED",
    )
    db.add(appt)
    db.commit()
    db.close()

    # Patient taps 5-star rating: fb_rate_5_804
    resp = send_webhook_button(
        client,
        phone="919888800001",
        button_id="fb_rate_5_804",
        button_title="⭐⭐⭐⭐⭐ Excellent",
        msg_id="btn_fb_5",
        phone_number_id="meta_phone_ph8_1",
    )
    assert resp.status_code == 200

    # Verify feedback record created in DB
    db = SessionLocal()
    fb = db.query(PatientFeedback).filter(PatientFeedback.appointment_id == 804).first()
    assert fb is not None
    assert fb.rating == 5
    assert fb.rating_label == "Excellent"
    assert fb.clinic_id == 801
    assert fb.patient_id == 801

    # Verify conversation session is now awaiting optional comments
    session = booking_service.get_session(db, "919888800001", clinic_id=801)
    assert session.step == "AWAITING_FEEDBACK_COMMENTS"

    # Acknowledgment sent asking for optional comments
    assert mock_send.called
    body = mock_send.call_args[1].get("body_text", "")
    assert "5/5 Stars" in body
    assert "comments or suggestions" in body
    db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_feedback_optional_written_comments_recorded(mock_send):
    """Patient sends text comments after rating; comments are saved to PatientFeedback."""
    client = TestClient(app)
    db = SessionLocal()
    appt = Appointment(
        id=805,
        clinic_id=801,
        patient_id=801,
        doctor_id=801,
        appointment_date="2026-11-12",
        start_time="14:00",
        end_time="14:30",
        status="COMPLETED",
    )
    db.add(appt)
    db.commit()

    # Existing rating without comments
    fb = PatientFeedback(
        clinic_id=801,
        appointment_id=805,
        patient_id=801,
        rating=5,
        rating_label="Excellent",
    )
    db.add(fb)
    db.commit()

    # Set session step to AWAITING_FEEDBACK_COMMENTS
    booking_service.get_session(db, "919888800001", clinic_id=801)
    booking_service.update_session(
        db,
        "919888800001",
        step="AWAITING_FEEDBACK_COMMENTS",
        context={"clinic_id": 801, "feedback_appt_id": 805},
        clinic_id=801,
    )
    db.close()

    # Patient sends text comment
    resp = send_webhook_text(
        client,
        phone="919888800001",
        text="Dr. Alok was very attentive and explained everything clearly!",
        msg_id="txt_fb_comm",
        phone_number_id="meta_phone_ph8_1",
    )
    assert resp.status_code == 200

    # Verify comment stored
    db = SessionLocal()
    updated_fb = db.query(PatientFeedback).filter(PatientFeedback.appointment_id == 805).first()
    assert updated_fb.comments == "Dr. Alok was very attentive and explained everything clearly!"

    # Session returned to IDLE
    session = booking_service.get_session(db, "919888800001", clinic_id=801)
    assert session.step == "IDLE"
    db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_followup_reminder_processing_and_dispatch(mock_send):
    """Due clinic-approved follow-ups are processed and sent to patients."""
    db = SessionLocal()
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    sched = FollowUpSchedule(
        clinic_id=801,
        appointment_id=801,
        patient_id=801,
        doctor_id=801,
        followup_date=today_str,
        instruction_text="Routine post-treatment blood pressure check",
        status="SCHEDULED",
    )
    db.add(sched)
    db.commit()

    dispatched = post_appointment_service.process_due_followups(db, target_date=today_str)
    assert len(dispatched) == 1

    # Status updated to SENT
    db.refresh(sched)
    assert sched.status == "SENT"
    assert sched.sent_at is not None

    # Verify message sent
    assert mock_send.called
    body = mock_send.call_args[1].get("body_text", "")
    assert "FOLLOW-UP REMINDER" in body
    assert "blood pressure check" in body
    db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_document_ready_secure_expiring_link(mock_send):
    """When document access is enabled, marks document ready and sends secure expiring link."""
    client = TestClient(app)
    db = SessionLocal()
    rx = Prescription(
        id=801,
        prescription_uid="RX-PH8-001",
        patient_id=801,
        doctor_id=801,
        diagnosis="Acute Bronchitis",
        medicines='[{"name": "Azithromycin 500mg"}]',
        advice="Rest and plenty of warm fluids",
    )
    db.add(rx)
    db.commit()

    # Notify prescription ready
    res = post_appointment_service.notify_document_ready(
        db,
        document_type="PRESCRIPTION",
        document_id=801,
        clinic_id=801,
        base_url="http://testserver",
    )
    assert res["status"] == "SENT"
    assert res["secure_enabled"] is True

    # Check grant in DB
    grant = db.query(DocumentAccessGrant).filter(DocumentAccessGrant.document_id == 801).first()
    assert grant is not None
    assert grant.document_type == "PRESCRIPTION"
    assert grant.patient_id == 801

    # Verify message body has secure link
    assert mock_send.called
    body = mock_send.call_args[1].get("body_text", "")
    assert f"/portal/documents/{grant.token}" in body
    assert "24 hours" in body

    # Test accessing the document via the secure portal
    portal_resp = client.get(f"/portal/documents/{grant.token}?patient_id=801")
    assert portal_resp.status_code == 200
    doc_json = portal_resp.json()
    assert doc_json["status"] == "SUCCESS"
    assert doc_json["document"]["diagnosis"] == "Acute Bronchitis"
    assert doc_json["document"]["doctor_name"] == "Dr. Alok Verma"

    # Test Cross-Patient Isolation: Patient 802 cannot access Patient 801's prescription!
    cross_resp = client.get(f"/portal/documents/{grant.token}?patient_id=802")
    assert cross_resp.status_code == 403
    assert "Unauthorized" in cross_resp.json()["detail"]

    db.close()


def test_document_access_link_expiration():
    """Expired document tokens are safely rejected (HTTP 410)."""
    client = TestClient(app)
    db = SessionLocal()
    rx = Prescription(
        id=802,
        prescription_uid="RX-PH8-002",
        patient_id=801,
        doctor_id=801,
        diagnosis="Hypertension",
    )
    db.add(rx)
    db.commit()

    # Create grant that expired 1 hour ago
    expired_grant = DocumentAccessGrant(
        clinic_id=801,
        patient_id=801,
        document_type="PRESCRIPTION",
        document_id=802,
        token="expired_token_12345",
        expires_at=datetime.datetime.utcnow() - datetime.timedelta(hours=1),
        created_at=datetime.datetime.utcnow() - datetime.timedelta(hours=25),
    )
    db.add(expired_grant)
    db.commit()
    db.close()

    resp = client.get("/portal/documents/expired_token_12345")
    assert resp.status_code == 410
    assert "expired" in resp.json()["detail"].lower()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_document_ready_when_secure_access_disabled_prompts_reception(mock_send):
    """When document access is disabled, patient is told to collect at reception (never sends insecure links)."""
    db = SessionLocal()
    lab = LabOrder(
        id=801,
        order_uid="LAB-PH8-001",
        patient_id=802,
        doctor_id=801,
        status="COMPLETED",
        tests='[{"name": "Lipid Profile"}]',
    )
    db.add(lab)
    db.commit()

    # Clinic 802 has document_access_enabled = False
    res = post_appointment_service.notify_document_ready(
        db,
        document_type="LAB_REPORT",
        document_id=801,
        clinic_id=802,
    )
    assert res["status"] == "SENT"
    assert res["secure_enabled"] is False

    assert mock_send.called
    body = mock_send.call_args[1].get("body_text", "")
    assert "http://" not in body
    assert "https://" not in body
    assert "reception desk" in body.lower()
    db.close()


@patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock)
def test_payment_receipt_generated_only_for_verified_paid_payments(mock_send):
    """Verified payments receive official receipt; pending or failed payments are strictly rejected."""
    db = SessionLocal()
    appt = Appointment(
        id=806,
        clinic_id=801,
        patient_id=801,
        doctor_id=801,
        appointment_date="2026-11-12",
        start_time="15:00",
        end_time="15:30",
        status="CONFIRMED",
        payment_status="PAID",
    )
    db.add(appt)
    db.commit()

    inv = Invoice(
        id=801,
        invoice_number="INV-PH8-001",
        appointment_id=806,
        patient_id=801,
        total=700,
        amount_paid=700,
        payment_status="PAID",
    )
    db.add(inv)
    db.commit()

    # 1. Verified Payment
    paid_payment = Payment(
        id=801,
        payment_uid="PAY-PH8-001",
        invoice_id=801,
        amount=700,
        payment_method="UPI",
        transaction_ref="UPI_REF_998877",
    )
    db.add(paid_payment)
    db.commit()

    # Generate receipt for paid payment
    res = post_appointment_service.send_payment_receipt(db, payment_id=801)
    assert res["status"] == "SENT"
    assert res["amount"] == 700

    assert mock_send.called
    body = mock_send.call_args[1].get("body_text", "")
    assert "OFFICIAL PAYMENT RECEIPT" in body
    assert "PAY-PH8-001" in body
    assert "PAID (Verified)" in body
    assert "700" in body

    # 2. Reject receipt generation for an unpaid/pending invoice
    inv_pending = Invoice(
        id=802,
        invoice_number="INV-PH8-002",
        patient_id=801,
        total=500,
        amount_paid=0,
        payment_status="PENDING",
    )
    db.add(inv_pending)
    db.commit()

    pending_payment = Payment(
        id=802,
        payment_uid="PAY-PH8-002",
        invoice_id=802,
        amount=500,
        payment_method="Cash",
    )
    db.add(pending_payment)
    db.commit()

    # Must raise ValueError because invoice payment_status is PENDING
    with pytest.raises(ValueError) as excinfo:
        post_appointment_service.send_payment_receipt(db, payment_id=802)
    assert "Payment must be verified" in str(excinfo.value)

    db.close()
