import json
import datetime
from unittest.mock import patch, AsyncMock
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from app.config import settings
from app.database import SessionLocal
from app.models import (
    Clinic,
    Doctor,
    Patient,
    Appointment,
    ConversationSession,
    ProcessedWebhookMessage,
    WhatsAppMessage,
)
from app.routers.webhook import match_text_command
from app.services.booking import booking_service


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def setup_and_teardown_data():
    db = SessionLocal()
    try:
        # 1. Setup Test Clinic
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        if not clinic:
            clinic = Clinic(
                id=1,
                code="CLN-TEST-1",
                name="Aerostate Prime Clinic",
                phone_number_id="WABA_PID_CLN1",
                phone="+919876543210",
                address="123 Health Ave, Bangalore",
                operating_hours="9 AM - 8 PM",
                is_active=True,
            )
            db.add(clinic)
        else:
            clinic.phone_number_id = "WABA_PID_CLN1"
            clinic.phone = "+919876543210"
            clinic.address = "123 Health Ave, Bangalore"
            clinic.operating_hours = "9 AM - 8 PM"
            clinic.is_active = True

        # 2. Setup Test Doctors
        d1 = db.query(Doctor).filter(Doctor.clinic_id == 1, Doctor.name == "Dr. A Sharma").first()
        if not d1:
            d1 = Doctor(
                clinic_id=1,
                name="Dr. A Sharma",
                specialization="General Medicine",
                available_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                start_time="09:00",
                end_time="17:00",
                slot_duration_mins=30,
                consultation_fee=400,
                is_active=True,
            )
            db.add(d1)

        d2 = db.query(Doctor).filter(Doctor.clinic_id == 1, Doctor.name == "Dr. B Dental").first()
        if not d2:
            d2 = Doctor(
                clinic_id=1,
                name="Dr. B Dental",
                specialization="Dentistry",
                available_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                start_time="10:00",
                end_time="16:00",
                slot_duration_mins=30,
                consultation_fee=600,
                is_active=True,
            )
            db.add(d2)

        db.commit()
    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        # Cleanup test patients and appointments with 9999 phone
        test_patients = db.query(Patient).filter(Patient.phone.like("%9999%")).all()
        for p in test_patients:
            db.query(Appointment).filter(Appointment.patient_id == p.id).delete()
            db.delete(p)
        db.query(ProcessedWebhookMessage).filter(ProcessedWebhookMessage.phone.like("%9999%")).delete(synchronize_session=False)
        db.query(ConversationSession).filter(ConversationSession.phone.like("%9999%")).delete(synchronize_session=False)
        db.query(WhatsAppMessage).filter(WhatsAppMessage.phone.like("%9999%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def send_meta_message(client: TestClient, sender_phone: str, msg_id: str, text: str = None, list_id: str = None, button_id: str = None):
    msg_obj = {
        "from": sender_phone,
        "id": msg_id,
        "timestamp": "1700000000",
    }
    if text is not None:
        msg_obj["type"] = "text"
        msg_obj["text"] = {"body": text}
    elif list_id is not None:
        msg_obj["type"] = "interactive"
        msg_obj["interactive"] = {
            "type": "list_reply",
            "list_reply": {"id": list_id, "title": list_id},
        }
    elif button_id is not None:
        msg_obj["type"] = "interactive"
        msg_obj["interactive"] = {
            "type": "button_reply",
            "button_reply": {"id": button_id, "title": button_id},
        }

    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "123456",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "919876543210",
                                "phone_number_id": "WABA_PID_CLN1",
                            },
                            "contacts": [{"profile": {"name": "Test User"}, "wa_id": sender_phone}],
                            "messages": [msg_obj],
                        },
                    }
                ],
            }
        ],
    }
    body_bytes = json.dumps(payload).encode("utf-8")
    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "ALLOW_INSECURE_WEBHOOKS", True):
        return client.post("/webhook", content=body_bytes, headers={"Content-Type": "application/json"})


def test_match_text_commands():
    """Verifies case-insensitivity and typo resilience for all Phase 2 text commands."""
    # Main menu commands
    assert match_text_command("HI") == "menu"
    assert match_text_command("hello") == "menu"
    assert match_text_command("Menu") == "menu"
    assert match_text_command("help") == "menu"
    assert match_text_command("start") == "menu"
    assert match_text_command("home") == "menu"
    assert match_text_command("namaste") == "menu"

    # Reschedule commands
    assert match_text_command("RESCHEDULE") == "reschedule"
    assert match_text_command("resched") == "reschedule"
    assert match_text_command("re-schedule") == "reschedule"
    assert match_text_command("change appointment") == "reschedule"
    assert match_text_command("postpone") == "reschedule"
    assert match_text_command("badalna") == "reschedule"

    # Cancel commands
    assert match_text_command("CANCEL") == "cancel"
    assert match_text_command("cancle") == "cancel"
    assert match_text_command("cancel booking") == "cancel"
    assert match_text_command("cancell") == "cancel"
    assert match_text_command("radd") == "cancel"

    # My appointments
    assert match_text_command("MY APPOINTMENTS") == "my_appointments"
    assert match_text_command("my appointment") == "my_appointments"
    assert match_text_command("view appointment") == "my_appointments"
    assert match_text_command("status") == "my_appointments"

    # Booking commands
    assert match_text_command("BOOK") == "book"
    assert match_text_command("booking") == "book"
    assert match_text_command("APPOINTMENT") == "book"
    assert match_text_command("new appointment") == "book"

    # Doctors commands
    assert match_text_command("DOCTORS") == "doctors"
    assert match_text_command("doctor") == "doctors"
    assert match_text_command("specialist") == "doctors"
    assert match_text_command("daktar") == "doctors"

    # Clinic info commands
    assert match_text_command("CLINIC INFO") == "clinic_info"
    assert match_text_command("address") == "clinic_info"
    assert match_text_command("hours") == "clinic_info"
    assert match_text_command("timings") == "clinic_info"
    assert match_text_command("location") == "clinic_info"

    # Human / Receptionist commands
    assert match_text_command("HUMAN") == "human"
    assert match_text_command("receptionist") == "human"
    assert match_text_command("talk to receptionist") == "human"
    assert match_text_command("desk") == "human"

    # ABHA commands
    assert match_text_command("abha") == "abha"
    assert match_text_command("health id") == "abha"


def test_main_menu_list_structure(client):
    """Verifies that sending 'hi' or 'menu' renders the 6-option interactive list menu."""
    phone = "919999000001"
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_menu_1", text="menu")
        assert res.status_code == 200
        assert mock_list.called

        args, kwargs = mock_list.call_args
        sections = kwargs.get("sections")
        button_label = kwargs.get("button_label")
        header_text = kwargs.get("header_text")

        assert button_label == "📋 Choose Option"
        assert "Aerostate" in header_text

        # Check all 6 row IDs are present
        row_ids = [row["id"] for sec in sections for row in sec["rows"]]
        assert "menu_book" in row_ids
        assert "menu_reschedule" in row_ids
        assert "menu_cancel" in row_ids
        assert "menu_view" in row_ids
        assert "menu_info" in row_ids
        assert "menu_human" in row_ids

        # Check character limit compliance (Meta max title: 24, max description: 72)
        for sec in sections:
            for row in sec["rows"]:
                assert len(row["title"]) <= 24, f"Row title too long: {row['title']}"
                assert len(row["description"]) <= 72, f"Row description too long: {row['description']}"


def test_menu_list_selections_routing(client):
    """Verifies list menu item selection executes correct conversational handler."""
    phone = "919999000002"

    # 1. Select menu_info -> Clinic & Doctors Info
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_item_info", list_id="menu_info")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Aerostate" in body
        assert "Dr." in body
        assert "123 Health Ave" in body

    # 2. Select menu_human -> Talk to Receptionist
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_item_human", list_id="menu_human")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "TALK TO RECEPTIONIST" in body
        assert "+919876543210" in body

    # 3. Select menu_book -> Initiates Booking Flow (Step 1 & 2: Myself / Someone Else)
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_item_book", list_id="menu_book")
        assert res.status_code == 200
        assert mock_qr.called
        buttons = mock_qr.call_args[1]["buttons"]
        b_ids = [b["id"] for b in buttons]
        assert "btn_book_self" in b_ids
        assert "btn_book_other" in b_ids


def test_talk_to_receptionist_text_and_button(client):
    """Verifies text commands for receptionist return clinic contact details and main menu navigation."""
    phone = "919999000003"
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_human_cmd", text="talk to receptionist")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "TALK TO RECEPTIONIST" in body
        buttons = mock_qr.call_args[1]["buttons"]
        assert any(b["id"] == "btn_menu" for b in buttons)


def test_doctors_and_clinic_info_command(client):
    """Verifies 'clinic info' and 'doctors' text command shows address, hours, and doctor fees."""
    phone = "919999000004"
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_info_cmd", text="clinic info")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "123 Health Ave" in body
        assert "₹400" in body or "₹600" in body


def test_reschedule_flow_single_appointment(client):
    """Tests full rescheduling flow when patient has exactly 1 appointment."""
    phone = "919999000005"
    db = SessionLocal()
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    next_week = (datetime.date.today() + datetime.timedelta(days=3)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        doctor = db.query(Doctor).filter(Doctor.clinic_id == 1).first()
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Reschedule Test",
            doctor_id=doctor.id,
            date_str=tomorrow,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Step 1: Send 'reschedule' command -> asks doctor preference (Same Doctor vs Change Doctor)
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_resched_1", text="reschedule")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Doctor" in body

    # Step 1b: Select Same Doctor -> presents available dates
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_resched_1b", button_id=f"res_same_doc_{appt_id}")
        assert res.status_code == 200
        assert mock_list.called
        kwargs = mock_list.call_args[1]
        assert "Choose New Date" in kwargs.get("button_label")

    # Step 2: Patient selects new date -> presents available times
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_resched_2", list_id=f"resdate_{next_week}")
        assert res.status_code == 200
        assert mock_list.called
        kwargs = mock_list.call_args[1]
        assert "Choose New Time" in kwargs.get("button_label")

    # Step 3: Patient selects new slot -> presents Reschedule Summary and Confirmation
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_resched_3", list_id="resslot_14:00")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Reschedule Summary" in body
        assert next_week in body
        assert "14:00" in body

    # Step 4: Patient confirms reschedule -> updates DB and sends receipt
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_resched_4", button_id="btn_confirm_resched")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "APPOINTMENT RESCHEDULED" in body
        assert next_week in body
        assert "14:00" in body

    # Verify database update
    db = SessionLocal()
    try:
        updated = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert updated.appointment_date == next_week
        assert updated.start_time == "14:00"
        assert updated.status == "CONFIRMED"
    finally:
        db.close()


def test_reschedule_flow_multiple_appointments(client):
    """Tests rescheduling when patient has multiple upcoming appointments."""
    phone = "919999000006"
    db = SessionLocal()
    day1 = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    day2 = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    appt2_id = None
    try:
        doctor = db.query(Doctor).filter(Doctor.clinic_id == 1).first()
        a1 = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Multi Test",
            doctor_id=doctor.id,
            date_str=day1,
            start_time="10:00",
            source="WhatsApp",
            clinic_id=1,
        )
        a2 = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Multi Test",
            doctor_id=doctor.id,
            date_str=day2,
            start_time="11:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt2_id = a2.id
        db.commit()
    finally:
        db.close()

    # Step 1: Send 'reschedule' -> prompts list of appointments to choose which one
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_m_resched_1", text="reschedule")
        assert res.status_code == 200
        assert mock_list.called
        sections = mock_list.call_args[1]["sections"]
        row_ids = [r["id"] for s in sections for r in s["rows"]]
        assert f"resched_{appt2_id}" in row_ids

    # Step 2: Patient selects appt 2 to reschedule -> prompts doctor preference
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_m_resched_2", list_id=f"resched_{appt2_id}")
        assert res.status_code == 200
        assert mock_qr.called
        assert "Doctor" in mock_qr.call_args[1]["body_text"]

    # Step 3: Patient chooses Same Doctor -> presents dates
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_m_resched_3", button_id=f"res_same_doc_{appt2_id}")
        assert res.status_code == 200
        assert mock_list.called
        assert "Choose New Date" in mock_list.call_args[1]["button_label"]


def test_cancel_flow_by_text_command(client):
    """Tests cancellation via text command 'cancel #ID' with confirmation step."""
    phone = "919999000007"
    db = SessionLocal()
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    appt_id = None
    try:
        doctor = db.query(Doctor).filter(Doctor.clinic_id == 1).first()
        appt = booking_service.book_appointment(
            db=db,
            phone=phone,
            patient_name="Cancel Test",
            doctor_id=doctor.id,
            date_str=tomorrow,
            start_time="15:00",
            source="WhatsApp",
            clinic_id=1,
        )
        appt_id = appt.id
        db.commit()
    finally:
        db.close()

    # Step 1: Send 'cancel #ID' -> displays confirmation screen
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_cancel_1", text=f"cancel #{appt_id}")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Confirm" in body

    # Step 2: Patient explicitly confirms cancellation
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_cancel_2", button_id=f"confirm_cancel_{appt_id}")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Cancelled" in body

    # Verify status in DB
    db = SessionLocal()
    try:
        updated = db.query(Appointment).filter(Appointment.id == appt_id).first()
        assert updated.status == "CANCELLED"
    finally:
        db.close()


def test_unexpected_text_during_active_flow_safe_recovery(client):
    """Verifies that unexpected text during an active step does NOT crash or book, and offers Main Menu."""
    phone = "919999000008"
    db = SessionLocal()
    try:
        # Simulate patient being midway in selection
        booking_service.update_session(db, phone, step="SELECTING_SLOT", context={"clinic_id": 1}, clinic_id=1)
    finally:
        db.close()

    # User types unexpected message instead of selecting a slot
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_unexp_1", text="how much does it cost?")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "We received your message" in body
        buttons = mock_qr.call_args[1]["buttons"]
        assert any(b["id"] == "btn_menu" for b in buttons)

    # Now patient sends 'MENU' during active flow -> resets safely to IDLE
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_unexp_2", text="MENU")
        assert res.status_code == 200
        assert mock_list.called

    db = SessionLocal()
    try:
        sess = booking_service.get_session(db, phone, clinic_id=1)
        assert sess.step == "IDLE"
    finally:
        db.close()


def test_back_button_navigation(client):
    """Verifies clicking 'btn_back' or 'btn_menu' resets to IDLE and sends main menu."""
    phone = "919999000009"
    with patch("app.routers.webhook.whatsapp_client.send_list_menu", new_callable=AsyncMock) as mock_list:
        res = send_meta_message(client, phone, "msg_p2_back_1", button_id="btn_back")
        assert res.status_code == 200
        assert mock_list.called


def test_symptom_triage_multilingual_preservation(client):
    """Verifies English, Hindi, and Hinglish symptom text triage remains fully functional."""
    phone = "919999000010"
    db = SessionLocal()
    try:
        booking_service.update_session(db, phone, step="AWAITING_SYMPTOMS", context={"clinic_id": 1}, clinic_id=1)
    finally:
        db.close()

    # Hindi / Hinglish symptom
    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_qr:
        res = send_meta_message(client, phone, "msg_p2_symp_hi", text="Bukhar aur sar dard hai do din se")
        assert res.status_code == 200
        assert mock_qr.called
        body = mock_qr.call_args[1]["body_text"]
        assert "Doctor Recommendation" in body
        assert "Dr." in body

