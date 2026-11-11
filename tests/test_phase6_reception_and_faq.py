"""Comprehensive Test Suite for Phase 6: Receptionist Handover and Clinic Information / FAQ.

Verifies:
1. Receptionist handover during working hours.
2. Receptionist handover outside working hours.
3. Custom reception messages and response time configurations.
4. Handover request lifecycle & status transitions (Open -> Assigned -> In Progress -> Resolved -> Closed).
5. Seeding and querying all 10 standard clinic FAQs.
6. Webhook FAQ answering behavior using approved clinic data.
7. Unanswered / missing FAQ questions offering receptionist handover.
8. Strict clinical separation of medical/symptom questions from administrative FAQs.
9. Clinic Information displaying only configured fields (no placeholders or 'None').
10. Multi-clinic tenant isolation for FAQs and handover tickets.
11. Admin CRUD endpoints for FAQs and Handover tickets.
"""

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
from app.models import Clinic, Doctor, Patient, ReceptionHandoverRequest, ClinicFAQ, ConversationSession
from app.services.reception import reception_service
from app.services.faq import faq_service


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_whatsapp_payload_network():
    """Mocks WhatsApp network calls so tests execute quickly and reliably."""
    with patch(
        "app.services.whatsapp.WhatsAppClient._send_payload",
        new_callable=AsyncMock,
        return_value={"messaging_product": "whatsapp", "messages": [{"id": "wamid.mock_p6"}]},
    ):
        yield


@pytest.fixture(autouse=True)
def clean_test_data():
    """Sets up clean test clinics with doctors and reception/FAQ configurations."""
    db = SessionLocal()
    try:
        # Setup Clinic 1
        c1 = db.query(Clinic).filter(Clinic.id == 1).first()
        if not c1:
            c1 = Clinic(
                id=1,
                code="CLN-PH6-1",
                name="Aerostate Prime Clinic",
                phone_number_id="WABA_PID_CLN1",
                is_active=True,
                timezone="Asia/Kolkata",
                phone="+91 98765 43210",
                address="123 Medical Enclave, Agra",
                operating_hours="Mon-Sat: 09:00 AM - 08:00 PM",
                reception_phone="+91 98765 00001",
                reception_start_time="09:00",
                reception_end_time="18:00",
                reception_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday",
            )
            db.add(c1)
        else:
            c1.name = "Aerostate Prime Clinic"
            c1.phone_number_id = "WABA_PID_CLN1"
            c1.is_active = True
            c1.timezone = "Asia/Kolkata"
            c1.phone = "+91 98765 43210"
            c1.address = "123 Medical Enclave, Agra"
            c1.operating_hours = "Mon-Sat: 09:00 AM - 08:00 PM"
            c1.reception_phone = "+91 98765 00001"
            c1.reception_start_time = "09:00"
            c1.reception_end_time = "18:00"
            c1.reception_days = "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday"
            c1.reception_message_open = None
            c1.reception_message_closed = None
            c1.reception_expected_wait_mins = None
            c1.google_maps_url = None
            c1.emergency_contact = None
            c1.departments = None
            c1.facilities = None

        # Setup Doctor for Clinic 1
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
            doc1.consultation_fee = 600
            doc1.is_available = True

        # Setup Clinic 2 for multi-tenant isolation tests
        c2 = db.query(Clinic).filter(Clinic.id == 2).first()
        if not c2:
            c2 = Clinic(
                id=2,
                code="CLN-PH6-2",
                name="Metro Health Care",
                phone_number_id="WABA_PID_CLN2",
                is_active=True,
                timezone="Asia/Kolkata",
                phone="+91 88888 77777",
                address="45 South Extension, Delhi",
                operating_hours="Mon-Sun: 08:00 AM - 10:00 PM",
                reception_phone="+91 88888 00002",
                reception_start_time="08:00",
                reception_end_time="20:00",
                reception_days="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
            )
            db.add(c2)
        else:
            c2.name = "Metro Health Care"
            c2.phone_number_id = "WABA_PID_CLN2"
            c2.is_active = True
            c2.reception_phone = "+91 88888 00002"

        # Clear previous Phase 6 handover tickets and FAQs and processed messages
        from app.models import ProcessedWebhookMessage
        db.query(ReceptionHandoverRequest).delete()
        db.query(ClinicFAQ).delete()
        db.query(ProcessedWebhookMessage).delete()
        db.commit()
    finally:
        db.close()


def make_whatsapp_post_payload(
    phone_number_id: str,
    from_phone: str,
    body: str,
    user_name: str = "Test User",
    msg_id: str = "wamid.ph6_test",
    is_button: bool = False,
    button_id: str = "",
):
    """Builds valid Meta WhatsApp webhook POST payload."""
    if is_button:
        msg_obj = {
            "from": from_phone,
            "id": msg_id,
            "timestamp": "1730000000",
            "type": "interactive",
            "interactive": {
                "type": "button_reply",
                "button_reply": {"id": button_id, "title": body},
            },
        }
    else:
        msg_obj = {
            "from": from_phone,
            "id": msg_id,
            "timestamp": "1730000000",
            "type": "text",
            "text": {"body": body},
        }

    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "BIZ_1",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "1234567890",
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


def send_signed_webhook(client: TestClient, payload: dict, app_secret: str = "test_meta_secret_ph6"):
    payload_bytes = json.dumps(payload).encode("utf-8")
    sig = "sha256=" + hmac.new(app_secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    with patch.object(settings, "META_APP_SECRET", app_secret):
        return client.post(
            "/webhook",
            data=payload_bytes,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig},
        )


def test_reception_handover_during_working_hours(client):
    """Verifies Talk to Receptionist during configured working hours creates open ticket and sends confirmation."""
    phone = "919777000001"
    # Verify reception service is open on Monday 11:30 AM
    mock_monday_1130 = datetime.datetime(2026, 11, 16, 11, 30, tzinfo=ZoneInfo("Asia/Kolkata"))
    db = SessionLocal()
    try:
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        assert reception_service.is_reception_open(clinic, now=mock_monday_1130) is True
    finally:
        db.close()

    payload = make_whatsapp_post_payload(
        phone_number_id="WABA_PID_CLN1",
        from_phone=phone,
        body="Talk to Receptionist",
        user_name="Rajesh Verma",
        msg_id="wamid.ph6_rec_open",
        is_button=True,
        button_id="btn_human",
    )

    with patch("app.routers.webhook.reception_service.is_reception_open", return_value=True):
        resp = send_signed_webhook(client, payload)

    assert resp.status_code == 200

    # Verify handover ticket was created in DB
    db = SessionLocal()
    try:
        req = db.query(ReceptionHandoverRequest).filter(
            ReceptionHandoverRequest.phone == phone,
            ReceptionHandoverRequest.clinic_id == 1,
        ).first()
        assert req is not None
        assert req.status == "Open"
        assert req.is_outside_working_hours is False
        assert req.patient_name == "Rajesh Verma"
    finally:
        db.close()


def test_reception_handover_outside_working_hours(client):
    """Verifies Talk to Receptionist outside working hours records after-hours ticket and sends after-hours message."""
    phone = "919777000002"
    # Verify reception service is closed on Sunday night 20:30
    mock_sunday_night = datetime.datetime(2026, 11, 15, 20, 30, tzinfo=ZoneInfo("Asia/Kolkata"))
    db = SessionLocal()
    try:
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        assert reception_service.is_reception_open(clinic, now=mock_sunday_night) is False
    finally:
        db.close()

    payload = make_whatsapp_post_payload(
        phone_number_id="WABA_PID_CLN1",
        from_phone=phone,
        body="reception",
        user_name="Anita Sharma",
        msg_id="wamid.ph6_rec_closed",
    )

    with patch("app.routers.webhook.reception_service.is_reception_open", return_value=False):
        resp = send_signed_webhook(client, payload)

    assert resp.status_code == 200

    db = SessionLocal()
    try:
        req = db.query(ReceptionHandoverRequest).filter(
            ReceptionHandoverRequest.phone == phone,
            ReceptionHandoverRequest.clinic_id == 1,
        ).first()
        assert req is not None
        assert req.status == "Open"
        assert req.is_outside_working_hours is True
    finally:
        db.close()


def test_reception_handover_custom_response_and_wait_time(client):
    """Verifies clinic-configured custom reception message and wait-time promises."""
    db = SessionLocal()
    try:
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        clinic.reception_message_open = "Our front-desk executive has received your call request."
        clinic.reception_expected_wait_mins = 15
        db.commit()

        # When open with configured wait time
        msg_open = reception_service.build_reception_message(clinic, is_open=True, user_name="Sanjay")
        assert "Our front-desk executive has received your call request." in msg_open
        assert "within 15 minutes" in msg_open

        # When closed
        clinic.reception_message_closed = "Reception desk is currently closed for the day."
        db.commit()

        msg_closed = reception_service.build_reception_message(clinic, is_open=False, user_name="Sanjay")
        assert "Reception desk is currently closed for the day." in msg_closed
        assert "09:00 to 18:00" in msg_closed

        # Verify no wait time is promised when unconfigured
        clinic.reception_expected_wait_mins = None
        db.commit()
        msg_no_wait = reception_service.build_reception_message(clinic, is_open=True, user_name="Sanjay")
        assert "within" not in msg_no_wait
    finally:
        db.close()


def test_reception_handover_status_transitions(client):
    """Tests the lifecycle status transitions: Open -> Assigned -> In Progress -> Resolved -> Closed."""
    db = SessionLocal()
    try:
        # Create ticket
        req = reception_service.create_handover_request(
            db=db,
            clinic_id=1,
            phone="919888777111",
            patient_name="Pooja Mehta",
            reason="Rescheduling Assistance",
        )
        assert req.status == "Open"
        assert req.resolved_at is None

        # Transition to Assigned
        r_assigned = reception_service.update_handover_status(
            db, request_id=req.id, status="Assigned", assigned_to="Receptionist Neha"
        )
        assert r_assigned.status == "Assigned"
        assert r_assigned.assigned_to == "Receptionist Neha"

        # Transition to In Progress
        r_prog = reception_service.update_handover_status(
            db, request_id=req.id, status="In Progress", resolution_notes="Called patient, line busy."
        )
        assert r_prog.status == "In Progress"
        assert "line busy" in r_prog.resolution_notes

        # Transition to Resolved
        r_res = reception_service.update_handover_status(
            db, request_id=req.id, status="Resolved", resolution_notes="Connected and rescheduled appointment."
        )
        assert r_res.status == "Resolved"
        assert r_res.resolved_at is not None

        # Transition to Closed
        r_closed = reception_service.update_handover_status(db, request_id=req.id, status="Closed")
        assert r_closed.status == "Closed"

        # Invalid status should raise ValueError
        with pytest.raises(ValueError):
            reception_service.update_handover_status(db, request_id=req.id, status="InvalidStatus")
    finally:
        db.close()


def test_clinic_faq_seed_and_standard_questions(client):
    """Seeds and verifies all 10 standard clinic questions required by Phase 6."""
    db = SessionLocal()
    try:
        faqs = faq_service.seed_default_faqs(db, clinic_id=1)
        assert len(faqs) == 10

        categories = [f.category for f in faqs]
        expected_categories = [
            "Timings", "Location", "Fees", "Doctors", "Walkin",
            "Online", "Payments", "Lab", "Pharmacy", "Reception"
        ]
        for cat in expected_categories:
            assert cat in categories

        # Test querying each standard category
        c1 = db.query(Clinic).filter(Clinic.id == 1).first()
        q_timings = faq_service.answer_query(db, c1, "What are the clinic timings?")
        assert q_timings["type"] == "FAQ"
        assert "Mon-Sat: 09:00 AM - 08:00 PM" in q_timings["answer"]

        q_fees = faq_service.answer_query(db, c1, "What is the consultation fee?")
        assert q_fees["type"] == "FAQ"
        assert "₹" in q_fees["answer"] and "consultation" in q_fees["answer"].lower()

        q_walkin = faq_service.answer_query(db, c1, "Can I visit without an appointment?")
        assert q_walkin["type"] == "FAQ"
        assert "walk-in" in q_walkin["answer"].lower()

        q_payment = faq_service.answer_query(db, c1, "What payment methods are accepted?")
        assert q_payment["type"] == "FAQ"
        assert "UPI" in q_payment["answer"]

        q_pharmacy = faq_service.answer_query(db, c1, "Is there a pharmacy?")
        assert q_pharmacy["type"] == "FAQ"
        assert "pharmacy" in q_pharmacy["answer"].lower()
    finally:
        db.close()


def test_clinic_faq_answering_via_webhook(client):
    """Verifies incoming WhatsApp patient question correctly matches FAQ and sends approved answer."""
    db = SessionLocal()
    try:
        faq_service.seed_default_faqs(db, clinic_id=1)
    finally:
        db.close()

    phone = "919777000003"
    payload = make_whatsapp_post_payload(
        phone_number_id="WABA_PID_CLN1",
        from_phone=phone,
        body="Where is the clinic located?",
        user_name="Sunil Rao",
        msg_id="wamid.ph6_faq_location",
    )

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_send:
        resp = send_signed_webhook(client, payload)
        assert resp.status_code == 200
        assert mock_send.called
        sent_body = mock_send.call_args[1]["body_text"]
        assert "Where is the clinic located?" in sent_body
        assert "123 Medical Enclave, Agra" in sent_body


def test_missing_faq_responses_offer_receptionist_handover(client):
    """Verifies that unanswerable / missing clinic questions trigger receptionist handover offer."""
    db = SessionLocal()
    try:
        faq_service.seed_default_faqs(db, clinic_id=1)
    finally:
        db.close()

    phone = "919777000004"
    # Question not covered by any approved clinic FAQ
    payload = make_whatsapp_post_payload(
        phone_number_id="WABA_PID_CLN1",
        from_phone=phone,
        body="Do you provide pet grooming and animal vaccination?",
        user_name="Priya Das",
        msg_id="wamid.ph6_faq_missing",
    )

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_send:
        resp = send_signed_webhook(client, payload)
        assert resp.status_code == 200
        assert mock_send.called
        sent_body = mock_send.call_args[1]["body_text"]
        buttons = mock_send.call_args[1]["buttons"]
        # Must inform answer unavailable and offer receptionist
        assert "couldn't find an answer" in sent_body
        button_ids = [b["id"] for b in buttons]
        assert "btn_human" in button_ids


def test_medical_questions_strictly_separated_from_faqs(client):
    """Verifies that clinical/medical questions are kept separate from administrative FAQs and direct to doctor consultation."""
    db = SessionLocal()
    try:
        faq_service.seed_default_faqs(db, clinic_id=1)
    finally:
        db.close()

    phone = "919777000005"
    payload = make_whatsapp_post_payload(
        phone_number_id="WABA_PID_CLN1",
        from_phone=phone,
        body="I have severe chest pain and vomiting, which medicine tablet should I take?",
        user_name="Deepak Jain",
        msg_id="wamid.ph6_medical_query",
    )

    with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_send:
        resp = send_signed_webhook(client, payload)
        assert resp.status_code == 200
        assert mock_send.called
        sent_body = mock_send.call_args[1]["body_text"]
        # Must refuse automated medical advice and direct to medical consultation
        assert "Medical Consultation" in sent_body or "Cardiology" in sent_body


def test_clinic_information_display_only_configured(client):
    """Verifies Clinic Information displays ONLY configured fields and suppresses unconfigured placeholders."""
    db = SessionLocal()
    try:
        clinic = db.query(Clinic).filter(Clinic.id == 1).first()
        # Reset optional fields to None
        clinic.google_maps_url = None
        clinic.emergency_contact = None
        clinic.departments = None
        clinic.facilities = None
        db.commit()

        # Send clinic_info command
        phone = "919777000006"
        payload = make_whatsapp_post_payload(
            phone_number_id="WABA_PID_CLN1",
            from_phone=phone,
            body="CLINIC INFO",
            user_name="Ramesh",
            msg_id="wamid.ph6_info_partial",
        )

        with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_send:
            resp = send_signed_webhook(client, payload)
            assert resp.status_code == 200
            assert mock_send.called
            sent_body = mock_send.call_args[1]["body_text"]
            assert "Aerostate Prime Clinic" in sent_body
            assert "123 Medical Enclave, Agra" in sent_body
            assert "Directions / Map" not in sent_body
            assert "Available Facilities" not in sent_body
            assert "None" not in sent_body

        # Now configure these fields
        clinic.google_maps_url = "https://maps.google.com/?q=aerostate_clinic"
        clinic.emergency_contact = "Call 0562-223344 or visit Emergency Counter Ground Floor"
        clinic.departments = "Cardiology, General Medicine, Pediatrics"
        clinic.facilities = "Pathology Lab, 24x7 Pharmacy, Wheelchair Access"
        db.commit()

        payload2 = make_whatsapp_post_payload(
            phone_number_id="WABA_PID_CLN1",
            from_phone=phone,
            body="CLINIC INFO",
            user_name="Ramesh",
            msg_id="wamid.ph6_info_full",
        )

        with patch("app.routers.webhook.whatsapp_client.send_quick_reply_buttons", new_callable=AsyncMock) as mock_send:
            resp = send_signed_webhook(client, payload2)
            assert resp.status_code == 200
            sent_body = mock_send.call_args[1]["body_text"]
            assert "https://maps.google.com/?q=aerostate_clinic" in sent_body
            assert "Pathology Lab, 24x7 Pharmacy" in sent_body
            assert "Cardiology, General Medicine" in sent_body
            assert "0562-223344" in sent_body
    finally:
        db.close()


def test_clinic_data_isolation_between_clinics(client):
    """Verifies that FAQs and Reception requests are strictly isolated by clinic tenant boundary."""
    db = SessionLocal()
    try:
        # Seed FAQs for Clinic 1
        faq1 = faq_service.create_faq(
            db=db,
            clinic_id=1,
            question="What is the Clinic 1 special test?",
            answer="Clinic 1 Exclusive Cardiac Screening Package.",
            keywords="cardiac, special test",
        )
        # Seed FAQ for Clinic 2
        faq2 = faq_service.create_faq(
            db=db,
            clinic_id=2,
            question="What is the Clinic 2 special test?",
            answer="Clinic 2 Exclusive Full Body Health Checkup.",
            keywords="body checkup, full test",
        )

        # Query Clinic 1 for Clinic 2 FAQ: should NOT match Clinic 2
        c1 = db.query(Clinic).filter(Clinic.id == 1).first()
        c2 = db.query(Clinic).filter(Clinic.id == 2).first()
        ans_c1 = faq_service.answer_query(db, c1, "What is the Clinic 2 special test?")
        assert ans_c1["type"] != "FAQ" or (ans_c1["matched_faq"] and ans_c1["matched_faq"].clinic_id == 1)

        # Query Clinic 2 for Clinic 1 FAQ: should NOT match Clinic 1
        ans_c2 = faq_service.answer_query(db, c2, "What is the Clinic 1 special test?")
        assert ans_c2["type"] != "FAQ" or (ans_c2["matched_faq"] and ans_c2["matched_faq"].clinic_id == 2)

        # Handover request creation under Clinic 2
        req2 = reception_service.create_handover_request(
            db=db,
            clinic_id=2,
            phone="919777999888",
            patient_name="Tenant 2 Patient",
        )
        assert req2.clinic_id == 2

        # Listing Clinic 1 tickets should NOT include Clinic 2
        c1_reqs = reception_service.list_handover_requests(db, clinic_id=1)
        assert all(r.clinic_id == 1 for r in c1_reqs)
    finally:
        db.close()


def test_faq_and_reception_admin_api_endpoints(client):
    """Tests the REST APIs for FAQ management and Reception Handover tracking."""
    # 1. Seed standard FAQs via endpoint
    seed_resp = client.post("/api/faq/1/seed-defaults")
    assert seed_resp.status_code == 200
    assert seed_resp.json()["count"] == 10

    # 2. List FAQs
    list_resp = client.get("/api/faq/1")
    assert list_resp.status_code == 200
    faqs = list_resp.json()
    assert len(faqs) >= 10
    faq_id = faqs[0]["id"]

    # 3. Create custom FAQ
    create_resp = client.post(
        "/api/faq/1",
        json={
            "category": "Parking",
            "question": "Is car parking available?",
            "answer": "Yes, free basement valet parking is available for patients.",
            "keywords": "parking, car, vehicle, valet",
            "priority": 5,
        },
    )
    assert create_resp.status_code == 200
    custom_faq_id = create_resp.json()["faq_id"]

    # 4. Query endpoint
    query_resp = client.post("/api/faq/1/query", json={"query": "Can I park my car?"})
    assert query_resp.status_code == 200
    assert query_resp.json()["type"] == "FAQ"
    assert "valet parking" in query_resp.json()["answer"]

    # 5. Deactivate FAQ and verify it no longer matches
    toggle_resp = client.patch(f"/api/faq/item/{custom_faq_id}/status?is_active=false")
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["is_active"] is False

    query_after = client.post("/api/faq/1/query", json={"query": "Can I park my car?"})
    assert query_after.status_code == 200
    assert query_after.json()["type"] != "FAQ" or query_after.json()["matched_faq"] is None

    # 6. Delete FAQ
    del_resp = client.delete(f"/api/faq/item/{custom_faq_id}")
    assert del_resp.status_code == 200

    # 7. Reception availability check endpoint
    avail_resp = client.get("/api/reception/availability/1")
    assert avail_resp.status_code == 200
    assert "is_reception_open" in avail_resp.json()

    # 8. Create and update handover request via REST endpoint
    ho_create = client.post(
        "/api/reception/requests",
        json={
            "clinic_id": 1,
            "phone": "+919777555444",
            "patient_name": "API Test Patient",
            "reason": "Billing Question",
        },
    )
    assert ho_create.status_code == 200
    req_id = ho_create.json()["request_id"]

    ho_patch = client.patch(
        f"/api/reception/requests/{req_id}",
        json={"status": "In Progress", "assigned_to": "Dr. Coordinator"},
    )
    assert ho_patch.status_code == 200
    assert ho_patch.json()["status"] == "In Progress"
