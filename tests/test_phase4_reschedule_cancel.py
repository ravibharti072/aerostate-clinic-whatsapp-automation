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
    """Mocks WhatsApp network calls so tests execute quickly without live Graph API latency."""
    with patch(
        "app.services.whatsapp.WhatsAppClient._send_payload",
        new_callable=AsyncMock,
        return_value={"messaging_product": "whatsapp", "messages": [{"id": "wamid.mock"}]},
    ):
        yield


@pytest.fixture(autouse=True)
def clean_test_data():
    """Sets up clean test clinic, doctors, and isolates test data."""
    db = SessionLocal()
    try:
        # 1. Setup test clinic
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        if not clinic:
            clinic = Clinic(
                id=1,
                code="CLN-PH4-1",
                name="Aerostate Prime Clinic",
                phone_number_id="WABA_PID_CLN1",
                is_active=True,
                reschedule_cutoff_hours=2,
                cancel_cutoff_hours=2,
                cancellation_policy_text="Cancellations and rescheduling allowed up to 2 hours before appointment.",
                max_reschedules=3,
            )
            db.add(clinic)
        else:
            clinic.name = "Aerostate Prime Clinic"
            clinic.phone_number_id = "WABA_PID_CLN1"
            clinic.is_active = True
            clinic.reschedule_cutoff_hours = 2
            clinic.cancel_cutoff_hours = 2
            clinic.cancellation_policy_text = "Cancellations and rescheduling allowed up to 2 hours before appointment."
            clinic.max_reschedules = 3
        db.commit()

        # 2. Setup Doctor 1 (Cardiologist)
        doc1 = db.query(Doctor).filter(Doctor.id == 1).first()
        if not doc1:
            doc1 = Doctor(
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
            db.add(doc1)
        else:
            doc1.clinic_id = 1
            doc1.name = "Dr. Amit Sharma"
            doc1.specialization = "Cardiology"
            doc1.is_available = True
            doc1.consultation_fee = 600

        # 3. Setup Doctor 2 (Neurologist)
        doc2 = db.query(Doctor).filter(Doctor.id == 2).first()
        if not doc2:
            doc2 = Doctor(
                id=2,
                clinic_id=1,
                name="Dr. Priya Verma",
                specialization="Neurology",
                start_time="10:00",
                end_time="18:00",
                slot_duration_mins=20,
                is_available=True,
                consultation_fee=800,
            )
            db.add(doc2)
        else:
            doc2.clinic_id = 1
            doc2.name = "Dr. Priya Verma"
            doc2.is_available = True
            doc2.consultation_fee = 800
        db.commit()

        # Clean appointments, sessions, patients for test numbers
        test_phones = [
            "919777000001", "919777000002", "919777000003",
            "919777000004", "919777000005", "919777000006",
            "919777000007", "919777000008", "919777000009",
            "919777000010",
        ]
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
    list_id: str = None,
    phone_number_id: str = "WABA_PID_CLN1",
):
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
            "button_reply": {"id": button_id, "title": "Button Title"},
        }
    elif list_id is not None:
        msg_obj["type"] = "interactive"
        msg_obj["interactive"] = {
            "type": "list_reply",
            "list_reply": {"id": list_id, "title": "List Item Title"},
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


def test_my_appointments_single_appointment(client):
    """Verifies My Appointments displays patient, doctor, date/time, status, payment status, clinic address and actions."""
    phone = "919777000001"
    db = SessionLocal()
    next_week = (datetime.date.today() + datetime.timedelta(days=4)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Rahul Verma",
            doctor_id=1,
            date_str=next_week,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_view_1", text="my appointments")
        assert res.status_code == 200
        assert mock_qr.called
        kwargs = mock_qr.call_args[1]
        body = kwargs["body_text"]
        buttons = kwargs["buttons"]

        # Verification of required fields
        assert f"Booking ID #{appt_id}" in body
        assert "Rahul Verma" in body
        assert "Dr. Amit Sharma" in body
        assert "Cardiology" in body
        assert next_week in body
        assert "10:00" in body
        assert "CONFIRMED" in body
        assert "PENDING" in body
        assert "Aerostate Prime Clinic" in body

        # Verification of action buttons
        btn_ids = [b["id"] for b in buttons]
        assert f"manage_{appt_id}" in btn_ids
        assert "btn_book" in btn_ids
        assert "btn_history" in btn_ids


def test_my_appointments_multiple_appointments_selection(client):
    """Verifies multiple upcoming appointments provide an interactive selection menu with management routing."""
    phone = "919777000002"
    db = SessionLocal()
    d1 = (datetime.date.today() + datetime.timedelta(days=3)).strftime("%Y-%m-%d")
    d2 = (datetime.date.today() + datetime.timedelta(days=5)).strftime("%Y-%m-%d")
    a1_id, a2_id = None, None
    try:
        a1 = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Suman Rao",
            doctor_id=1,
            date_str=d1,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        a2 = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Kavita Rao",
            doctor_id=2,
            date_str=d2,
            start_time="11:00",
            source="WhatsApp",
            clinic_id=1,
        )
        a1_id, a2_id = a1.id, a2.id
        db.commit()
    finally:
        db.close()

    # Step 1: Request My Appointments -> sends list menu with appointments
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_payload(client, phone, "m_p4_view_multi_1", text="my appointments")
        assert res.status_code == 200
        assert mock_list.called
        sections = mock_list.call_args[1]["sections"]
        row_ids = [r["id"] for s in sections for r in s["rows"]]
        assert f"manage_{a1_id}" in row_ids
        assert f"manage_{a2_id}" in row_ids
        assert "btn_history" in row_ids

    # Step 2: Patient selects manage_a1 -> displays management card with Reschedule and Cancel buttons
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_view_multi_2", list_id=f"manage_{a1_id}")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        buttons = mock_qr.call_args[1]["buttons"]
        assert f"Manage Appointment #{a1_id}" in body
        assert "Suman Rao" in body
        btn_ids = [b["id"] for b in buttons]
        assert f"resched_{a1_id}" in btn_ids
        assert f"cancel_req_{a1_id}" in btn_ids


def test_my_appointments_no_upcoming(client):
    """Verifies friendly message and guidance when patient has no active upcoming appointments."""
    phone = "919777000003"
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_view_none_1", text="my appointments")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        buttons = mock_qr.call_args[1]["buttons"]
        assert "No Upcoming Appointments" in body
        btn_ids = [b["id"] for b in buttons]
        assert "btn_book" in btn_ids
        assert "btn_history" in btn_ids


def test_reschedule_flow_same_doctor_with_confirmation(client):
    """Tests complete rescheduling keeping same doctor, reviewing summary, and confirming update."""
    phone = "919777000004"
    db = SessionLocal()
    cur_date = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    new_date = (datetime.date.today() + datetime.timedelta(days=5)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Ananya Sharma",
            doctor_id=1,
            date_str=cur_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt.payment_status = "PAID"
        appt.paid_amount = 600
        appt.payment_method = "Razorpay"
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Step 1: Request reschedule -> asks doctor choice (Same Doctor vs Change Doctor)
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_resched_1", text="reschedule")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        buttons = mock_qr.call_args[1]["buttons"]
        assert "Dr. Amit Sharma" in body
        btn_ids = [b["id"] for b in buttons]
        assert f"res_same_doc_{appt_id}" in btn_ids
        assert f"res_change_doc_{appt_id}" in btn_ids

    # Step 2: Patient selects Same Doctor -> presents available dates
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_payload(client, phone, "m_p4_resched_2", button_id=f"res_same_doc_{appt_id}")
        assert res.status_code == 200
        assert mock_list.called
        assert "Choose New Date" in mock_list.call_args[1]["button_label"]

    # Step 3: Patient selects date -> presents available slots
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_payload(client, phone, "m_p4_resched_3", list_id=f"resdate_{new_date}")
        assert res.status_code == 200
        assert mock_list.called
        assert "Choose New Time" in mock_list.call_args[1]["button_label"]

    # Step 4: Patient selects slot -> presents Reschedule Summary and requires confirmation
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_resched_4", list_id="resslot_14:00")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        buttons = mock_qr.call_args[1]["buttons"]
        assert "Reschedule Summary" in body
        assert "Ananya Sharma" in body
        assert cur_date in body
        assert new_date in body
        assert "14:00" in body
        assert "PAID" in body  # Preserved payment history
        btn_ids = [b["id"] for b in buttons]
        assert "btn_confirm_resched" in btn_ids
        assert "btn_cancel_resched" in btn_ids

    # Verify appointment NOT modified prior to confirmation
    db = SessionLocal()
    try:
        unconfirmed = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert unconfirmed.appointment_date == cur_date
        assert unconfirmed.start_time == "10:00"
    finally:
        db.close()

    # Step 5: Patient explicitly confirms reschedule
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_resched_5", button_id="btn_confirm_resched")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "APPOINTMENT RESCHEDULED" in body

    # Verify database state after confirmation
    db = SessionLocal()
    try:
        updated = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert updated.appointment_date == new_date
        assert updated.start_time == "14:00"
        assert updated.reschedule_count == 1
        assert cur_date in updated.previous_slot
        assert updated.payment_status == "PAID"
        assert updated.paid_amount == 600
    finally:
        db.close()


def test_reschedule_flow_change_doctor(client):
    """Tests rescheduling with specialist change from Dr. Amit (Cardiology) to Dr. Priya (Neurology)."""
    phone = "919777000005"
    db = SessionLocal()
    cur_date = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    new_date = (datetime.date.today() + datetime.timedelta(days=4)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Vikram Seth",
            doctor_id=1,
            date_str=cur_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Step 1: Start reschedule -> prompt doctor option
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_chgdoc_1", text=f"reschedule")
        assert res.status_code == 200

    # Step 2: Patient selects Change Doctor -> presents available specialists list
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_payload(client, phone, "m_p4_chgdoc_2", button_id=f"res_change_doc_{appt_id}")
        assert res.status_code == 200
        assert mock_list.called
        sections = mock_list.call_args[1]["sections"]
        row_ids = [r["id"] for s in sections for r in s["rows"]]
        assert f"resdoc_2_{appt_id}" in row_ids  # Doctor 2 (Dr. Priya Verma)

    # Step 3: Patient selects Doctor 2 -> presents available dates for Dr. Priya
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_payload(client, phone, "m_p4_chgdoc_3", list_id=f"resdoc_2_{appt_id}")
        assert res.status_code == 200
        assert mock_list.called
        assert "Choose New Date" in mock_list.call_args[1]["button_label"]

    # Step 4: Patient selects date -> presents slots
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_payload(client, phone, "m_p4_chgdoc_4", list_id=f"resdate_{new_date}")
        assert res.status_code == 200
        assert mock_list.called

    # Step 5: Patient selects slot -> summary
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_chgdoc_5", list_id="resslot_11:00")
        assert res.status_code == 200
        body = mock_qr.call_args[1]["body_text"]
        assert "Dr. Priya Verma" in body

    # Step 6: Confirm reschedule
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_chgdoc_6", button_id="btn_confirm_resched")
        assert res.status_code == 200

    # Verify doctor updated in DB
    db = SessionLocal()
    try:
        updated = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert updated.doctor_id == 2
        assert updated.appointment_date == new_date
        assert updated.start_time == "11:00"
    finally:
        db.close()


def test_reschedule_slot_collision_detection(client):
    """Verifies that if target slot gets booked by another patient before confirmation, original appointment remains intact."""
    phone = "919777000006"
    other_phone = "919777000099"
    db = SessionLocal()
    cur_date = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    target_date = (datetime.date.today() + datetime.timedelta(days=4)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Target Patient",
            doctor_id=1,
            date_str=cur_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Step 1: Advance to reschedule slot selection
    send_meta_payload(client, phone, "m_col_1", text="reschedule")
    send_meta_payload(client, phone, "m_col_2", button_id=f"res_same_doc_{appt_id}")
    send_meta_payload(client, phone, "m_col_3", list_id=f"resdate_{target_date}")
    send_meta_payload(client, phone, "m_col_4", list_id="resslot_14:00")

    # SIMULATE CONCURRENCY: Another patient books the 14:00 slot right now!
    db = SessionLocal()
    try:
        booking_service.book_appointment(
            db=db,
            phone=other_phone,
            patient_name="Competing Patient",
            doctor_id=1,
            date_str=target_date,
            start_time="14:00",
            source="WhatsApp",
            clinic_id=1,
        )
        db.commit()
    finally:
        db.close()

    # Step 2: Patient tries to confirm reschedule to 14:00
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_col_5", button_id="btn_confirm_resched")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "No Longer Available" in body or "remains unchanged" in body

    # Verify original appointment is untouched
    db = SessionLocal()
    try:
        original = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert original.appointment_date == cur_date
        assert original.start_time == "10:00"
        assert original.status == "CONFIRMED"
    finally:
        db.close()


def test_reschedule_restricted_by_cutoff_policy(client):
    """Verifies that rescheduling is rejected if within cutoff window (< 2 hours) and guides to receptionist."""
    phone = "919777000007"
    db = SessionLocal()
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    # Set appointment time 30 minutes from now (within 2-hour cutoff)
    now_dt = datetime.datetime.now() + datetime.timedelta(minutes=30)
    time_str = now_dt.strftime("%H:%M")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Cutoff Patient",
            doctor_id=1,
            date_str=today_str,
            start_time=time_str,
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_cutoff_1", text="reschedule")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        buttons = mock_qr.call_args[1]["buttons"]
        assert "Not Permitted" in body or "Clinic Policy" in body
        btn_ids = [b["id"] for b in buttons]
        assert "menu_human" in btn_ids  # Offers receptionist contact


def test_cancellation_flow_with_confirmation_and_keep_option(client):
    """Verifies cancellation requires explicit confirmation and allows keeping appointment."""
    phone = "919777000008"
    db = SessionLocal()
    future_date = (datetime.date.today() + datetime.timedelta(days=3)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Neeraj Chopra",
            doctor_id=1,
            date_str=future_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt.payment_status = "PAID"
        appt.paid_amount = 600
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Step 1: Request cancel -> prompts cancellation confirmation with refund policy note
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_canc_1", text="cancel")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        buttons = mock_qr.call_args[1]["buttons"]
        assert "Confirm Appointment Cancellation" in body
        assert "Neeraj Chopra" in body
        assert "refund policy" in body.lower()
        btn_ids = [b["id"] for b in buttons]
        assert f"confirm_cancel_{appt_id}" in btn_ids
        assert "btn_keep_booking" in btn_ids

    # Step 2: Patient tests clicking 'Keep Appointment'
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_canc_2", button_id="btn_keep_booking")
        assert res.status_code == 200
        assert mock_qr.called
        assert "Kept Active" in mock_qr.call_args[1]["body_text"]

    # Verify status in DB remains CONFIRMED
    db = SessionLocal()
    try:
        kept = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert kept.status == "CONFIRMED"
    finally:
        db.close()

    # Step 3: Now patient confirms cancellation
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_canc_3", button_id=f"confirm_cancel_{appt_id}")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Cancelled" in body
        assert "Refund Notice" in body

    # Verify status in DB is CANCELLED and metadata recorded
    db = SessionLocal()
    try:
        cancelled = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert cancelled.status == "CANCELLED"
        assert cancelled.cancelled_at is not None
        assert cancelled.cancellation_source == "WhatsApp"
    finally:
        db.close()


def test_cancellation_restricted_by_cutoff_and_repeated_cancel(client):
    """Verifies cancellation cutoff policy and graceful handling of repeated cancellation requests."""
    phone = "919777000009"
    db = SessionLocal()
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    near_time = (datetime.datetime.now() + datetime.timedelta(minutes=45)).strftime("%H:%M")
    appt_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Cutoff Cancel Test",
            doctor_id=1,
            date_str=today_str,
            start_time=near_time,
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Part 1: Within cutoff (< 2 hours) -> restricted
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_canc_cut_1", text=f"cancel #{appt_id}")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Not Permitted" in body or "Clinic Policy" in body

    # Part 2: Repeated cancellation request on already cancelled appointment
    db = SessionLocal()
    try:
        a = db.query(Appointment).filter(Appointment.id == appt_id).first()
        a.status = "CANCELLED"
        db.commit()
    finally:
        db.close()

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_p4_canc_rep_1", text=f"cancel #{appt_id}")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "already cancelled" in body.lower()


def test_cross_patient_isolation_in_reschedule_and_cancel(client):
    """Verifies that Patient A cannot access, reschedule, or cancel Patient B's appointment."""
    phone_a = "919777000001"
    phone_b = "919777000010"
    db = SessionLocal()
    future_date = (datetime.date.today() + datetime.timedelta(days=3)).strftime("%Y-%m-%d")
    appt_a_id = None
    try:
        appt = booking_service.book_appointment(
            db=db,
            phone=phone_a,
            patient_name="Patient A",
            doctor_id=1,
            date_str=future_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_a_id = appt.id
        db.commit()
    finally:
        db.close()

    # Patient B attempts to manage Patient A's appointment
    with patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_text:
        res = send_meta_payload(client, phone_b, "m_cross_1", button_id=f"manage_{appt_a_id}")
        assert res.status_code == 200
        assert mock_text.called
        body = mock_text.call_args[1]["text"]
        assert "not authorized" in body.lower() or "not found" in body.lower()

    # Patient B attempts to directly cancel Patient A's appointment
    with patch("app.routers.webhook.whatsapp_client.send_text", new_callable=AsyncMock) as mock_text:
        res = send_meta_payload(client, phone_b, "m_cross_2", button_id=f"confirm_cancel_{appt_a_id}")
        assert res.status_code == 200
        assert mock_text.called
        body = mock_text.call_args[1]["text"]
        assert "not authorized" in body.lower() or "not found" in body.lower()

    # Verify Patient A's appointment is completely untouched
    db = SessionLocal()
    try:
        intact = db.query(Appointment).filter(Appointment.id == appt_a_id).first()
        assert intact.status == "CONFIRMED"
    finally:
        db.close()


def test_appointment_history_past_and_cancelled(client):
    """Verifies viewing completed past consultations and cancelled bookings with privacy protection."""
    phone = "919777000001"
    db = SessionLocal()
    past_date = (datetime.date.today() - datetime.timedelta(days=10)).strftime("%Y-%m-%d")
    try:
        # Create 1 completed appointment
        a_comp = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="History Patient",
            doctor_id=1,
            date_str=past_date,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        a_comp.status = "COMPLETED"

        # Create 1 cancelled appointment
        a_canc = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="History Patient",
            doctor_id=1,
            date_str=past_date,
            start_time="11:00",
            source="WhatsApp",
            clinic_id=1,
        )
        a_canc.status = "CANCELLED"
        a_canc.cancelled_at = datetime.datetime.utcnow()
        a_canc.cancellation_reason = "Patient had a schedule conflict"
        db.commit()
    finally:
        db.close()

    # Test viewing past consultations
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_hist_1", button_id="hist_past")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Past Consultations" in body
        assert "COMPLETED" in body

    # Test viewing cancelled consultations
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_payload(client, phone, "m_hist_2", button_id="hist_cancelled")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Cancelled Bookings" in body
        assert "schedule conflict" in body
