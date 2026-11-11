import hmac
import hashlib
import json
import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch, AsyncMock
import pytest
from fastapi.testclient import TestClient

from main import app
from app.config import settings
from app.database import SessionLocal
from app.models import Clinic, Doctor, Patient, Appointment, NotificationLog, ConversationSession, ProcessedWebhookMessage
from app.services.booking import booking_service
from app.services.notifications import notification_service


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_whatsapp_payload_network():
    """Mocks WhatsApp network calls so tests execute quickly and reliably."""
    with patch(
        "app.services.whatsapp.WhatsAppClient._send_payload",
        new_callable=AsyncMock,
        return_value={"messaging_product": "whatsapp", "messages": [{"id": "wamid.mock_p5"}]},
    ):
        yield


@pytest.fixture(autouse=True)
def clean_test_data():
    """Sets up clean test clinic with reminder settings and doctors."""
    db = SessionLocal()
    try:
        # Setup test clinic
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        if not clinic:
            clinic = Clinic(
                id=1,
                code="CLN-PH5-1",
                name="Aerostate Prime Clinic",
                phone_number_id="WABA_PID_CLN1",
                is_active=True,
                timezone="Asia/Kolkata",
                reminder_24h_enabled=True,
                reminder_2h_enabled=True,
                notify_booking_confirmed=True,
                notify_booking_rescheduled=True,
                notify_booking_cancelled=True,
                notify_payment_confirmed=True,
                notify_payment_failed=True,
            )
            db.add(clinic)
        else:
            clinic.name = "Aerostate Prime Clinic"
            clinic.phone_number_id = "WABA_PID_CLN1"
            clinic.is_active = True
            clinic.timezone = "Asia/Kolkata"
            clinic.reminder_24h_enabled = True
            clinic.reminder_2h_enabled = True
            clinic.reminder_template_24h = None
            clinic.reminder_template_2h = None
            clinic.notify_booking_confirmed = True
            clinic.notify_booking_rescheduled = True
            clinic.notify_booking_cancelled = True
            clinic.notify_payment_confirmed = True
            clinic.notify_payment_failed = True

        # Setup Doctor
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
            doc.specialization = "Cardiology"
            doc.is_available = True
            doc.consultation_fee = 600

        db.commit()

        # Clean appointments, notification logs, and test phone records
        test_phones = [
            "919666000001", "919666000002", "919666000003",
            "919666000004", "919666000005", "919666000006",
            "919666000007", "919666000008", "919666000009",
            "919666000010",
        ]
        db.query(NotificationLog).filter(NotificationLog.clinic_id == 1).delete()
        db.query(Appointment).filter(Appointment.clinic_id == 1).delete()
        db.query(ConversationSession).filter(ConversationSession.phone.in_(test_phones)).delete()
        db.query(Patient).filter(Patient.phone.in_(test_phones)).delete()
        db.query(ProcessedWebhookMessage).delete()
        db.commit()
    finally:
        db.close()


def send_meta_payload(
    client: TestClient,
    sender_phone: str,
    msg_id: str,
    text: str = None,
    button_id: str = None,
    statuses: list = None,
    phone_number_id: str = "WABA_PID_CLN1",
):
    """Helper to dispatch formatted Meta WhatsApp webhook payload."""
    value_obj = {
        "messaging_product": "whatsapp",
        "metadata": {
            "display_phone_number": "+1234567890",
            "phone_number_id": phone_number_id,
        },
    }

    if statuses is not None:
        value_obj["statuses"] = statuses
    else:
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
                "button_reply": {"id": button_id, "title": "Button Title"},
            }
        value_obj["contacts"] = [{"profile": {"name": "Test User"}, "wa_id": sender_phone}]
        value_obj["messages"] = [msg_obj]

    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "BIZ_ACCOUNT_1",
                "changes": [{"field": "messages", "value": value_obj}],
            }
        ],
    }
    raw_body = json.dumps(payload).encode("utf-8")
    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True):
        return client.post("/webhook", content=raw_body, headers={"Content-Type": "application/json"})


def test_24_hour_appointment_reminder_trigger():
    """Verifies 24-hour reminder is triggered when an appointment is scheduled ~24 hours ahead."""
    phone = "919666000001"
    db = SessionLocal()
    tz = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz)
    # Appointment scheduled for 23.5 hours from now
    target_dt = now_kolkata + datetime.timedelta(hours=23, minutes=30)
    date_str = target_dt.strftime("%Y-%m-%d")
    time_str = target_dt.strftime("%H:%M")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Sanjay Gupta",
            doctor_id=1,
            date_str=date_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()

        # Run reminder evaluation
        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats["reminders_24h_sent"] == 1
            assert mock_qr.called
            kwargs = mock_qr.call_args[1]
            body = kwargs["body_text"]
            assert "Sanjay Gupta" in body
            assert "Aerostate Prime Clinic" in body
            assert "Dr. Amit Sharma" in body
            assert date_str in body
            assert time_str in body
            assert "Please arrive a little early" in body

        # Verify persistent log record
        log = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.appointment_id == appt_id,
                NotificationLog.notification_type == "REMINDER_24H",
            )
            .first()
        )
        assert log is not None
        assert log.status == "SENT"
        assert log.recipient_phone.endswith(phone.replace("+", ""))
        assert log.sent_at is not None
    finally:
        db.close()


def test_2_hour_appointment_reminder_trigger():
    """Verifies 2-hour reminder is triggered when appointment is scheduled ~1.5 hours ahead."""
    phone = "919666000002"
    db = SessionLocal()
    tz = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz)
    # Appointment scheduled for 1.5 hours from now
    target_dt = now_kolkata + datetime.timedelta(hours=1, minutes=30)
    date_str = target_dt.strftime("%Y-%m-%d")
    time_str = target_dt.strftime("%H:%M")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Meera Sen",
            doctor_id=1,
            date_str=date_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()

        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats["reminders_2h_sent"] == 1
            assert mock_qr.called
            body = mock_qr.call_args[1]["body_text"]
            assert "Meera Sen" in body
            assert "in about 2 hours" in body or "today" in body

        # Verify persistent log record
        log = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.appointment_id == appt_id,
                NotificationLog.notification_type == "REMINDER_2H",
            )
            .first()
        )
        assert log is not None
        assert log.status == "SENT"
    finally:
        db.close()


def test_duplicate_reminder_prevention():
    """Verifies running the reminder scheduler repeatedly NEVER sends duplicate reminders."""
    phone = "919666000003"
    db = SessionLocal()
    tz = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz)
    target_dt = now_kolkata + datetime.timedelta(hours=20)
    date_str = target_dt.strftime("%Y-%m-%d")
    time_str = target_dt.strftime("%H:%M")
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Duplicate Test",
            doctor_id=1,
            date_str=date_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        db.commit()

        # Run 1: Sends reminder
        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats1 = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats1["reminders_24h_sent"] == 1
            assert mock_qr.call_count == 1

        # Run 2: Immediate re-run must NOT send anything!
        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats2 = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats2["reminders_24h_sent"] == 0
            assert mock_qr.call_count == 0

        # Verify exactly 1 log entry in database
        logs = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.appointment_id == appt.id,
                NotificationLog.notification_type == "REMINDER_24H",
            )
            .all()
        )
        assert len(logs) == 1
    finally:
        db.close()


def test_cancelled_and_completed_appointments_not_reminded():
    """Verifies cancelled and completed appointments are strictly skipped by the reminder scheduler."""
    phone = "919666000004"
    db = SessionLocal()
    tz = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz)
    target_dt = now_kolkata + datetime.timedelta(hours=10)
    date_str = target_dt.strftime("%Y-%m-%d")
    time_str = target_dt.strftime("%H:%M")
    try:
        # Create cancelled appointment
        a_canc = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Cancelled Patient",
            doctor_id=1,
            date_str=date_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        a_canc.status = "CANCELLED"

        # Create completed appointment
        a_comp = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Completed Patient",
            doctor_id=1,
            date_str=date_str,
            start_time="16:00",
            source="WhatsApp",
            clinic_id=1,
        )
        a_comp.status = "COMPLETED"
        db.commit()

        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats["reminders_24h_sent"] == 0
            assert stats["reminders_2h_sent"] == 0
            assert mock_qr.call_count == 0
    finally:
        db.close()


def test_clinic_admin_reminder_toggles_enable_disable():
    """Verifies clinic administrator can enable or disable 24h and 2h reminders independently."""
    phone = "919666000005"
    db = SessionLocal()
    tz = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz)
    target_dt = now_kolkata + datetime.timedelta(hours=22)
    date_str = target_dt.strftime("%Y-%m-%d")
    time_str = target_dt.strftime("%H:%M")
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Toggle Test",
            doctor_id=1,
            date_str=date_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()

        # Step 1: Disable 24h reminders
        clinic.reminder_24h_enabled = False
        db.commit()

        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats["reminders_24h_sent"] == 0
            assert mock_qr.call_count == 0

        # Step 2: Re-enable 24h reminders
        clinic.reminder_24h_enabled = True
        db.commit()

        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats["reminders_24h_sent"] == 1
            assert mock_qr.call_count == 1
    finally:
        db.close()


def test_rescheduled_appointment_reminder_adjusts_to_new_slot():
    """Verifies rescheduling dynamically shifts the reminder window to the new appointment date and time."""
    phone = "919666000006"
    db = SessionLocal()
    tz = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz)

    old_dt = now_kolkata + datetime.timedelta(days=1)
    new_dt = now_kolkata + datetime.timedelta(days=4)
    old_date = old_dt.strftime("%Y-%m-%d")
    new_date = new_dt.strftime("%Y-%m-%d")
    time_str = "10:00"

    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Reschedule Shift Test",
            doctor_id=1,
            date_str=old_date,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        # Reschedule to Day 4
        appt.appointment_date = new_date
        appt.previous_slot = f"{old_date} {time_str}"
        appt.reschedule_count = 1
        db.commit()

        # Check reminder on Day 0 (now): new appointment is 4 days away (>24 hours) -> no reminder yet
        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_kolkata)
            assert stats["reminders_24h_sent"] == 0

        # Simulate time moving to Day 3 (20 hours before new appointment) -> reminder triggers for new slot!
        simulated_now = new_dt - datetime.timedelta(hours=20)
        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=simulated_now)
            assert stats["reminders_24h_sent"] == 1
            body = mock_qr.call_args[1]["body_text"]
            assert new_date in body

        # Verify log has the new appointment_slot recorded
        log = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.appointment_id == appt.id,
                NotificationLog.notification_type == "REMINDER_24H",
            )
            .first()
        )
        assert f"{new_date}_10:00" in log.appointment_slot
    finally:
        db.close()


def test_timezone_aware_scheduling():
    """Verifies that reminder time differences are calculated accurately using the clinic's configured timezone."""
    phone = "919666000007"
    db = SessionLocal()
    clinic = db.query(Clinic).filter(Clinic.id == 1).first()
    clinic.timezone = "Asia/Kolkata"
    db.commit()

    tz_kolkata = ZoneInfo("Asia/Kolkata")
    now_kolkata = datetime.datetime.now(tz_kolkata)
    target_dt = now_kolkata + datetime.timedelta(hours=1, minutes=15)
    date_str = target_dt.strftime("%Y-%m-%d")
    time_str = target_dt.strftime("%H:%M")

    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Timezone Patient",
            doctor_id=1,
            date_str=date_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        db.commit()

        # Pass UTC time equivalent to now_kolkata
        now_utc = now_kolkata.astimezone(datetime.timezone.utc)
        with patch("app.services.whatsapp.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
            stats = notification_service.process_due_reminders(db, now_override=now_utc)
            assert stats["reminders_2h_sent"] == 1
            assert mock_qr.called
    finally:
        db.close()


def test_temporary_api_failure_and_retry_mechanism():
    """Verifies failed WhatsApp notifications are logged as FAILED and retried up to max_retries."""
    phone = "919666000008"
    db = SessionLocal()
    clinic = db.query(Clinic).filter(Clinic.id == 1).first()
    future_date = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Retry Patient",
            doctor_id=1,
            date_str=future_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()

        # Step 1: Simulate temporary network failure
        with patch("app.services.whatsapp.whatsapp_client.send_text", side_effect=Exception("Connection timed out")):
            log = notification_service.send_notification(
                db=db,
                clinic=clinic,
                notification_type="CONFIRMATION",
                recipient_phone=phone,
                appointment=appt,
                use_buttons=False,
            )
            assert log.status == "FAILED"
            assert log.retry_count == 1
            assert "Connection timed out" in log.error_message

        # Step 2: Retry with network restored
        with patch("app.services.whatsapp.whatsapp_client.send_text", new_callable=AsyncMock, return_value={"messages": [{"id": "wamid.retried"}]}):
            retried_count = notification_service.retry_failed_notifications(db)
            assert retried_count == 1

        # Verify status in DB updated to SENT
        db.refresh(log)
        assert log.status == "SENT"
        assert log.meta_message_id == "wamid.retried"
    finally:
        db.close()


def test_meta_delivery_status_tracking(client):
    """Verifies incoming Meta delivery status updates (delivered, read) update NotificationLog accordingly."""
    db = SessionLocal()
    wamid = "wamid.HBgMTEST_STATUS_TRACKING_123"
    try:
        log = NotificationLog(
            clinic_id=1,
            recipient_phone="919666000009",
            notification_type="REMINDER_24H",
            appointment_slot="2026-11-20_10:00",
            status="SENT",
            message_body="Reminder text",
            meta_message_id=wamid,
            sent_at=datetime.datetime.utcnow(),
        )
        db.add(log)
        db.commit()

        # 1. Meta sends 'delivered' status webhook
        status_payload_delivered = [
            {"id": wamid, "status": "delivered", "timestamp": "1700000001", "recipient_id": "919666000009"}
        ]
        res1 = send_meta_payload(client, "919666000009", "m_st_1", statuses=status_payload_delivered)
        assert res1.status_code == 200

        db.refresh(log)
        assert log.status == "DELIVERED"

        # 2. Meta sends 'read' status webhook
        status_payload_read = [
            {"id": wamid, "status": "read", "timestamp": "1700000005", "recipient_id": "919666000009"}
        ]
        res2 = send_meta_payload(client, "919666000009", "m_st_2", statuses=status_payload_read)
        assert res2.status_code == 200

        db.refresh(log)
        assert log.status == "READ"
    finally:
        db.close()


def test_notifications_admin_api_endpoints(client):
    """Verifies notification administration endpoints for manual trigger, log queries, and settings updates."""
    # 1. Test POST /api/notifications/run-reminders
    res_run = client.post("/api/notifications/run-reminders", json={})
    assert res_run.status_code == 200
    data = res_run.json()
    assert data["status"] == "success"
    assert "stats" in data

    # 2. Test GET /api/notifications/logs
    res_logs = client.get("/api/notifications/logs?clinic_id=1&limit=10")
    assert res_logs.status_code == 200
    logs_data = res_logs.json()
    assert isinstance(logs_data, list)

    # 3. Test GET /api/notifications/clinic-settings/1
    res_get_settings = client.get("/api/notifications/clinic-settings/1")
    assert res_get_settings.status_code == 200
    settings_data = res_get_settings.json()
    assert settings_data["clinic_id"] == 1
    assert "reminder_24h_enabled" in settings_data
    assert "available_templates" in settings_data

    # 4. Test PUT /api/notifications/clinic-settings/1
    custom_template = "Hi {{patient_name}}, custom reminder from {{clinic_name}} on {{appointment_date}}."
    res_update = client.put(
        "/api/notifications/clinic-settings/1",
        json={
            "reminder_template_24h": custom_template,
            "reminder_24h_enabled": True,
            "timezone": "Asia/Kolkata",
        },
    )
    assert res_update.status_code == 200
    assert res_update.json()["status"] == "success"

    # Verify updated settings
    res_verify = client.get("/api/notifications/clinic-settings/1")
    assert res_verify.json()["reminder_template_24h"] == custom_template
