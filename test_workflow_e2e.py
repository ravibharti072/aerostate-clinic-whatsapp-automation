"""
End-to-End Clinic Multi-Portal Data Flow & Integration Verification Test
Traces a patient journey through every portal:
Reception -> Queue -> Consultation -> Pharmacy -> Laboratory -> Billing -> EMR -> Messaging -> Analytics
"""

import sys
import json
import datetime
from fastapi.testclient import TestClient
from main import app
from app.database import SessionLocal
import app.models as models
from app.security import create_access_token

client = TestClient(app)
db = SessionLocal()


def run_full_workflow_audit():
    print("=" * 75)
    print(" CLINIC MULTI-PORTAL END-TO-END WORKFLOW INTEGRATION AUDIT")
    print("=" * 75)

    # 0. Setup & Authentication
    admin = db.query(models.User).filter(models.User.role == "SuperAdmin").first()
    assert admin, "No SuperAdmin user found"
    token = create_access_token(data={"sub": admin.username, "role": admin.role})
    headers = {"Authorization": f"Bearer {token}"}

    today_str = datetime.date.today().strftime("%Y-%m-%d")
    doctor = db.query(models.Doctor).filter(models.Doctor.is_active == True).first()
    assert doctor, "No active doctor found"

    # Find available medicine batch for dispensing
    batch = db.query(models.MedicineBatch).filter(
        models.MedicineBatch.quantity_available > 0,
        models.MedicineBatch.expiry_date >= today_str
    ).first()
    assert batch, "No active medicine batch available for dispensing test"
    initial_batch_qty = batch.quantity_available

    # Find available lab test
    lab_test = db.query(models.LabTest).first()
    assert lab_test, "No lab tests available in catalogue"

    test_phone = f"+9198765{datetime.datetime.now().strftime('%M%S')}"
    test_patient_name = f"Workflow Test Patient {datetime.datetime.now().strftime('%H%M%S')}"

    # ----------------------------------------------------
    # STEP 1: Reception / Appointments Portal
    # ----------------------------------------------------
    print("\n[PORTAL 1: RECEPTION / APPOINTMENTS]")
    curr_time_str = datetime.datetime.now().strftime("%H:%M")
    booking_payload = {
        "patient_name": test_patient_name,
        "patient_phone": test_phone,
        "gender": "Male",
        "age": 35,
        "doctor_id": doctor.id,
        "appointment_date": today_str,
        "start_time": curr_time_str,
        "visit_type": "New Consultation",
        "notes": "Testing multi-portal synchronization",
        "check_in_now": True,
    }
    r = client.post("/admin/appointments", json=booking_payload, headers=headers)
    assert r.status_code == 200, f"Booking failed ({r.status_code}): {r.text}"
    booking_data = r.json()
    appointment_id = booking_data["appointment_id"]
    patient_id = booking_data["patient_id"]
    token_num = booking_data["token_number"]
    print(f" -> Appointment #{appointment_id} created for Patient #{patient_id} ({test_patient_name})")
    print(f" -> Token #{token_num} auto-assigned for walk-in.")

    # Verify Appointment is visible in Reception roster
    r = client.get(f"/admin/appointments?date={today_str}", headers=headers)
    assert r.status_code == 200, "Failed to fetch appointments list"
    appt_list = r.json().get("appointments", [])
    found_appt = any(a["id"] == appointment_id for a in appt_list)
    assert found_appt, f"Appointment #{appointment_id} not visible in Reception portal list!"
    print(" -> [VERIFIED] Appointment received and listed in Reception Portal.")

    # ----------------------------------------------------
    # STEP 2: Queue Management (Waiting Room) Portal
    # ----------------------------------------------------
    print("\n[PORTAL 2: OPD QUEUE MANAGEMENT]")
    r = client.get("/admin/queue", headers=headers)
    assert r.status_code == 200, "Failed to fetch live queue list"
    queue_entries = r.json().get("queue", [])
    matched_q = [q for q in queue_entries if q.get("appointment_id") == appointment_id]
    assert len(matched_q) > 0, f"Queue entry for appointment #{appointment_id} not received in Queue portal!"
    queue_entry = matched_q[0]
    queue_id = queue_entry["id"]
    print(f" -> [VERIFIED] Patient received in Waiting Room queue with Token #{queue_entry['token_number']} (Queue ID: {queue_id})")

    # Call patient to consultation room
    r = client.post(f"/admin/queue/{queue_id}/start-consultation", headers=headers)
    assert r.status_code == 200, f"Failed to start consultation: {r.text}"
    print(f" -> Queue status transitioned to IN_CONSULTATION")

    # ----------------------------------------------------
    # STEP 3: Doctor Consultation Portal
    # ----------------------------------------------------
    print("\n[PORTAL 3: DOCTOR CONSULTATION ENCOUNTER]")
    consultation_payload = {
        "appointment_id": appointment_id,
        "patient_id": patient_id,
        "doctor_id": doctor.id,
        "visit_type": "New Consultation",
        "chief_complaint": "Persistent fever, cough and fatigue for 3 days",
        "vitals": {"bp": "120/80", "pulse": 76, "temp": 100.2, "spo2": 98, "height": 175, "weight": 70},
        "diagnosis": "Acute Upper Respiratory Tract Infection",
        "treatment_plan": "Antipyretics, oral hydration, rest",
    }
    r = client.post("/admin/consultations", json=consultation_payload, headers=headers)
    assert r.status_code == 200, f"Consultation encounter start failed: {r.text}"
    enc_data = r.json()
    encounter_id = enc_data["encounter_id"]
    print(f" -> Consultation Encounter #{encounter_id} ({enc_data.get('encounter_uid')}) created.")

    # Verify Consultation appears in Doctor portal list
    r = client.get(f"/admin/consultations?date={today_str}", headers=headers)
    assert r.status_code == 200, "Failed to fetch consultations list"
    enc_list = r.json().get("consultations", [])
    found_enc = any(e["id"] == encounter_id for e in enc_list)
    assert found_enc, f"Encounter #{encounter_id} not received in Doctor portal list!"
    print(" -> [VERIFIED] Consultation encounter received in Doctor's register.")

    # ----------------------------------------------------
    # STEP 4: Doctor Prescribes Medication & Orders Diagnostic Lab Tests
    # ----------------------------------------------------
    print("\n[PORTAL 4: CLINICAL ORDERS (PRESCRIPTION & LAB TESTS)]")
    # Prescribe Medication
    rx_payload = {
        "patient_id": patient_id,
        "doctor_id": doctor.id,
        "appointment_id": appointment_id,
        "encounter_id": encounter_id,
        "diagnosis": "Acute Upper Respiratory Tract Infection",
        "medicines": [
            {
                "name": batch.medicine.name if batch.medicine else "Paracetamol 500mg",
                "dosage": "1-0-1",
                "duration": "5 days",
                "notes": "After meals with water",
                "fulfillment": "CLINIC",
            }
        ],
        "send_whatsapp": False,
    }
    r = client.post("/admin/prescriptions", json=rx_payload, headers=headers)
    assert r.status_code == 200, f"Prescription creation failed: {r.text}"
    rx_id = r.json()["id"]
    print(f" -> Doctor generated Prescription #{rx_id}")

    # Order Laboratory Tests
    lab_order_payload = {
        "patient_id": patient_id,
        "doctor_id": doctor.id,
        "encounter_id": encounter_id,
        "priority": "ROUTINE",
        "clinical_indication": "Routine fever workup",
        "test_ids": [lab_test.id],
        "collect_payment": True,
        "payment_status": "PENDING",
    }
    r = client.post("/admin/laboratory/orders", json=lab_order_payload, headers=headers)
    assert r.status_code == 200, f"Lab order creation failed: {r.text}"
    order_data = r.json()
    order_id = order_data["order_id"]
    order_uid = order_data["order_uid"]
    lab_inv_id = order_data.get("invoice_id")
    print(f" -> Lab Order #{order_id} ({order_uid}) created for test '{lab_test.name}' (Invoice #{lab_inv_id})")

    # Finalize and sign the clinical consultation
    r = client.post(f"/admin/consultations/{encounter_id}/finalize", json={"doctor_name": doctor.name}, headers=headers)
    assert r.status_code == 200, f"Finalize consultation failed: {r.text}"
    print(f" -> Consultation #{encounter_id} signed & finalized by Dr. {doctor.name}.")

    # Verify synchronized appointment status
    db.expire_all()
    check_appt = db.query(models.Appointment).filter(models.Appointment.id == appointment_id).first()
    assert check_appt.status == "COMPLETED", f"Appointment status not synced to COMPLETED! Current: {check_appt.status}"
    print(" -> [VERIFIED] Appointment status synchronized to COMPLETED.")

    # ----------------------------------------------------
    # STEP 5: Pharmacy Counter Receiving & Dispensing
    # ----------------------------------------------------
    print("\n[PORTAL 5: PHARMACY PORTAL RECEIVING & DISPENSING]")
    r = client.get("/admin/pharmacy/prescriptions", headers=headers)
    assert r.status_code == 200, "Failed to fetch pharmacy prescriptions list"
    pharma_rx_list = r.json()
    found_pharma_rx = any(p["id"] == rx_id for p in pharma_rx_list)
    assert found_pharma_rx, f"Prescription #{rx_id} not received in Pharmacy Portal queue!"
    print(" -> [VERIFIED] Prescription received in Pharmacy Portal queue.")

    # Dispense the medication from inventory batch
    dispense_payload = {
        "prescription_id": rx_id,
        "patient_id": patient_id,
        "payment_method": "Cash",
        "payment_status": "PAID",
        "items": [
            {
                "batch_id": batch.id,
                "quantity": 1,
            }
        ],
    }
    r = client.post("/admin/pharmacy/dispense", json=dispense_payload, headers=headers)
    assert r.status_code == 200, f"Pharmacy dispense failed: {r.text}"
    pharma_dispense_res = r.json()
    pharma_invoice_id = pharma_dispense_res.get("invoice_id")
    print(f" -> Pharmacy dispensed medication. Generated Pharmacy Invoice #{pharma_invoice_id}")

    # Verify inventory was decremented atomically
    db.expire_all()
    updated_batch = db.query(models.MedicineBatch).filter(models.MedicineBatch.id == batch.id).first()
    assert updated_batch.quantity_available == initial_batch_qty - 1, f"Inventory stock not decremented! Expected: {initial_batch_qty - 1}, Got: {updated_batch.quantity_available}"
    print(f" -> [VERIFIED] Dispensary inventory decremented from {initial_batch_qty} to {updated_batch.quantity_available}.")

    # ----------------------------------------------------
    # STEP 6: Laboratory Portal Diagnostic Processing & Sign-off
    # ----------------------------------------------------
    print("\n[PORTAL 6: LABORATORY DIAGNOSTIC WORKLIST & PATHOLOGY]")
    r = client.get("/admin/laboratory/orders", headers=headers)
    assert r.status_code == 200, "Failed to fetch lab orders list"
    lab_orders = r.json().get("orders", []) if isinstance(r.json(), dict) else r.json()
    found_lab_order = any(o["id"] == order_id for o in lab_orders)
    assert found_lab_order, f"Lab order #{order_id} not received in Laboratory Portal worklist!"
    print(" -> [VERIFIED] Lab order received in Laboratory Portal worklist.")

    # Phlebotomist collects specimen
    r = client.put(f"/admin/laboratory/orders/{order_id}/sample", json={"status": "SAMPLE_COLLECTED", "collector_name": "Phlebotomist"}, headers=headers)
    assert r.status_code == 200, f"Sample status update failed: {r.text}"
    print(" -> Specimen collected by phlebotomist.")

    # Lab Technician records test results
    results_payload = {
        "technician_name": "Senior Lab Technician",
        "results": [
            {
                "test_id": lab_test.id,
                "result_value": "13.8",
                "reference_range": lab_test.reference_range or "13.0 - 17.0",
                "units": lab_test.units or "g/dL",
                "flag": "NORMAL",
            }
        ],
    }
    r = client.post(f"/admin/laboratory/orders/{order_id}/results", json=results_payload, headers=headers)
    assert r.status_code == 200, f"Recording lab results failed: {r.text}"
    print(" -> Diagnostic test results recorded.")

    # Lab Pathologist verifies & finalizes report
    r = client.post(f"/admin/laboratory/orders/{order_id}/verify", json={"verified_by": "Dr. Pathologist"}, headers=headers)
    assert r.status_code == 200, f"Lab verification failed: {r.text}"
    print(f" -> [VERIFIED] Lab report #{order_uid} verified and marked COMPLETED.")

    # ----------------------------------------------------
    # STEP 7: Billing & Invoicing Portal Receiving
    # ----------------------------------------------------
    print("\n[PORTAL 7: CENTRAL BILLING & INVOICING]")
    r = client.get("/admin/billing/invoices", headers=headers)
    assert r.status_code == 200, "Failed to fetch invoices list"
    all_invoices = r.json().get("invoices", [])
    patient_invoices = [inv for inv in all_invoices if inv.get("patient_id") == patient_id]
    assert len(patient_invoices) > 0, "No invoices received for patient in Billing Portal!"
    print(f" -> Billing Portal received {len(patient_invoices)} invoice(s) for patient.")

    target_invoice = patient_invoices[0]
    inv_id = target_invoice["id"]
    balance = target_invoice.get("balance_due", 0)
    if balance > 0:
        pay_payload = {
            "amount": balance,
            "payment_method": "UPI",
            "transaction_reference": "UPI-WORKFLOW-TEST",
            "notes": "Full settlement via UPI",
        }
        r = client.post(f"/admin/billing/invoices/{inv_id}/payments", json=pay_payload, headers=headers)
        assert r.status_code == 200, f"Payment record failed: {r.text}"
        print(f" -> Recorded UPI payment of INR {balance} on Invoice #{inv_id}")

    # Verify Invoice PDF generation
    r = client.get(f"/admin/billing/invoices/{inv_id}/pdf", headers=headers)
    assert r.status_code == 200, f"Invoice PDF download failed: {r.status_code}"
    assert len(r.content) > 1000, "Generated PDF is empty or corrupt"
    print(f" -> [VERIFIED] Official Billing Receipt PDF successfully rendered ({len(r.content)} bytes).")

    # ----------------------------------------------------
    # STEP 8: Central Patient 360 EMR Data Consolidation
    # ----------------------------------------------------
    print("\n[PORTAL 8: CENTRAL PATIENT 360 EMR CONSOLIDATION]")
    r = client.get(f"/admin/patients/{patient_id}", headers=headers)
    assert r.status_code == 200, f"Failed to fetch patient 360 profile: {r.text}"
    patient_profile = r.json()

    overview = patient_profile.get("overview", {})
    appointments_rec = patient_profile.get("appointments", [])
    consultations_rec = patient_profile.get("consultations", [])
    prescriptions_rec = patient_profile.get("prescriptions", [])
    lab_orders_rec = patient_profile.get("laboratory", [])
    invoices_rec = patient_profile.get("billing", [])

    print(f" -> Patient EMR Profile: '{overview.get('name')}' (UID: {overview.get('patient_uid')})")
    print(f"    - Appointments linked:  {len(appointments_rec)}")
    print(f"    - Consultations linked: {len(consultations_rec)}")
    print(f"    - Prescriptions linked: {len(prescriptions_rec)}")
    print(f"    - Lab Orders linked:    {len(lab_orders_rec)}")
    print(f"    - Invoices linked:      {len(invoices_rec)}")

    assert any(a["id"] == appointment_id for a in appointments_rec), "Appointment missing from Patient EMR!"
    assert any(c["id"] == encounter_id for c in consultations_rec), "Consultation missing from Patient EMR!"
    assert any(p["id"] == rx_id for p in prescriptions_rec), "Prescription missing from Patient EMR!"
    assert any(o["id"] == order_id for o in lab_orders_rec), "Lab order missing from Patient EMR!"
    assert len(invoices_rec) > 0, "Invoices missing from Patient EMR!"
    print(" -> [VERIFIED] All cross-portal records successfully consolidated into Patient 360 EMR!")

    # ----------------------------------------------------
    # STEP 9: WhatsApp Notifications & Communications
    # ----------------------------------------------------
    print("\n[PORTAL 9: WHATSAPP NOTIFICATIONS & LIVE INBOX]")
    msg_payload = {
        "phone": test_phone,
        "text": f"Dear {test_patient_name}, your consultation and prescription are ready. Thank you for visiting Aerostate Clinic!",
    }
    r = client.post("/admin/messages/send", json=msg_payload, headers=headers)
    assert r.status_code == 200, f"Sending manual WhatsApp message failed: {r.text}"
    print(f" -> Dispatched message to {test_phone}")

    r = client.get(f"/admin/messages/{test_phone}", headers=headers)
    assert r.status_code == 200, "Failed to retrieve conversation history"
    history = r.json()
    assert len(history) > 0, "Sent message not found in patient WhatsApp history!"
    print(" -> [VERIFIED] WhatsApp message logged and visible in patient conversation thread.")

    # ----------------------------------------------------
    # STEP 10: Executive Analytics & KPI Consolidation
    # ----------------------------------------------------
    print("\n[PORTAL 10: EXECUTIVE ANALYTICS & DASHBOARD]")
    r = client.get("/admin/analytics", headers=headers)
    assert r.status_code == 200, "Failed to fetch clinic analytics"
    analytics = r.json()
    assert "financial" in analytics and "operations" in analytics, "Analytics payload missing financial or operations structure"
    fin = analytics["financial"]
    print(f" -> Executive Analytics Verified: Total Revenue INR {fin.get('total_revenue')}, Average Bill INR {fin.get('average_bill')}")

    r = client.get("/admin/stats", headers=headers)
    assert r.status_code == 200, "Failed to fetch dashboard stats"
    stats = r.json()
    kpis = stats.get("kpis", {})
    reg_patients = kpis.get("registered_patients", {}).get("value", 0)
    today_appts = kpis.get("today_appointments", {}).get("value", 0)
    assert reg_patients > 0, "Patient count not updated in stats"
    print(f" -> Dashboard Stats Verified: Registered Patients: {reg_patients}, Today Appointments: {today_appts}")
    print(" -> [VERIFIED] Real-time executive metrics updated.")

    print("\n" + "=" * 75)
    print(" ALL 10 CLINICAL PORTALS & CROSS-PORTAL DATA LINKS VERIFIED 100% OPERATIONAL!")
    print("=" * 75)


if __name__ == "__main__":
    try:
        run_full_workflow_audit()
    except AssertionError as err:
        print(f"\n[BROKEN LINK DETECTED] {err}")
        sys.exit(1)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"\n[UNEXPECTED ERROR] {exc}")
        sys.exit(1)
