import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class Clinic(Base):
    """Multi-Clinic / Multi-Tenant Branch Model."""
    __tablename__ = "clinics"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, index=True, nullable=False)  # e.g. "CLN-001"
    name = Column(String(150), nullable=False)
    tagline = Column(String(200), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(50), default="Agra")
    state = Column(String(50), default="Uttar Pradesh")
    phone = Column(String(30), nullable=True)
    email = Column(String(100), nullable=True)
    operating_hours = Column(String(100), default="Mon-Sat: 09:00 AM - 08:00 PM")

    # Meta WhatsApp Multi-Tenant Routing
    phone_number_id = Column(String(50), unique=True, index=True, nullable=True)
    display_phone_number = Column(String(30), nullable=True)
    whatsapp_token = Column(Text, nullable=True)  # Dedicated token if clinic has dedicated WABA, else None (uses master)
    verify_token = Column(String(100), nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), default="Staff")  # SuperAdmin, Admin, Doctor, Frontdesk, Pharma
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=True)
    staff_id = Column(Integer, ForeignKey("staff_profiles.id"), nullable=True)
    created_by = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    clinic = relationship("Clinic", backref="users")
    doctor = relationship("Doctor", backref="user_accounts")
    staff = relationship("StaffProfile", foreign_keys=[staff_id], backref="linked_users")


class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=True)
    name = Column(String(100), nullable=False)
    specialization = Column(String(100), nullable=False)
    available_days = Column(String(200), default="Monday,Tuesday,Wednesday,Thursday,Friday,Saturday")
    start_time = Column(String(10), default="09:00")
    end_time = Column(String(10), default="17:00")
    slot_duration_mins = Column(Integer, default=30)
    consultation_fee = Column(Integer, default=500)
    is_active = Column(Boolean, default=True)

    clinic = relationship("Clinic", backref="doctors")
    appointments = relationship("Appointment", back_populates="doctor")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    patient_uid = Column(String(30), unique=True, index=True, nullable=True)  # e.g. PAT-2026-0001
    phone = Column(String(30), unique=True, index=True, nullable=False)
    name = Column(String(100), default="Valued Patient")
    gender = Column(String(20), default="Unspecified")
    dob = Column(String(20), nullable=True)
    age = Column(Integer, nullable=True)
    blood_group = Column(String(10), nullable=True)
    email = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(50), default="Agra")
    state = Column(String(50), default="Uttar Pradesh")
    emergency_name = Column(String(100), nullable=True)
    emergency_phone = Column(String(30), nullable=True)
    aadhaar_number = Column(String(30), nullable=True)  # Optional 12-digit UIDAI number
    registration_source = Column(String(30), default="Direct")  # WhatsApp, Direct
    allergies = Column(Text, default="[]")  # JSON: [{"allergen": "Penicillin", "severity": "High", "reaction": "Hives"}]
    chronic_conditions = Column(Text, default="[]")  # JSON list
    medical_history = Column(Text, default="[]")  # JSON list: past surgeries, hospitalizations, family history
    clinical_alerts = Column(Text, default="[]")  # JSON list of high priority alerts
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    appointments = relationship("Appointment", back_populates="patient")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    appointment_date = Column(String(15), nullable=False)  # YYYY-MM-DD
    start_time = Column(String(10), nullable=False)        # HH:MM
    end_time = Column(String(10), nullable=False)          # HH:MM
    status = Column(String(20), default="CONFIRMED")       # CONFIRMED, CANCELLED, COMPLETED, IN_CONSULTATION, NO_SHOW
    notes = Column(Text, nullable=True)
    aadhaar_number = Column(String(30), nullable=True)
    entry_time = Column(String(20), nullable=True)
    source = Column(String(30), default="WhatsApp")  # WhatsApp, Reception
    visit_type = Column(String(50), default="New Consultation")  # New Consultation, Follow-up Visit, Routine Checkup, Emergency / Urgent
    payment_status = Column(String(20), default="PAID")  # PAID, PENDING
    payment_method = Column(String(30), default="UPI")   # Cash, UPI, Card
    paid_amount = Column(Integer, default=500)
    cabin = Column(String(50), default="Cabin 1")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    clinic = relationship("Clinic", backref="appointments")
    patient = relationship("Patient", back_populates="appointments")
    doctor = relationship("Doctor", back_populates="appointments")


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"

    id = Column(Integer, primary_key=True, index=True)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=True)
    phone = Column(String(30), index=True, nullable=False)
    patient_name = Column(String(100), default="Valued Patient")
    sender = Column(String(20), default="patient")  # "patient", "bot", "clinic"
    message_type = Column(String(30), default="text")  # "text", "button", "list", "booking_confirmation"
    body = Column(Text, nullable=False)
    meta_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    clinic = relationship("Clinic", backref="whatsapp_messages")


class ConversationSession(Base):
    __tablename__ = "conversation_sessions"

    phone = Column(String(30), primary_key=True, index=True)
    step = Column(String(50), default="IDLE")
    context_data = Column(Text, default="{}")  # JSON string to hold temporary booking selections
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class Consultation(Base):
    """Doctor Consultation Encounter Model (Module 2)."""
    __tablename__ = "consultations"

    id = Column(Integer, primary_key=True, index=True)
    encounter_uid = Column(String(50), unique=True, index=True, nullable=False)  # e.g. ENC-2026-0001
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=True)
    consultation_date = Column(String(15), nullable=False)
    status = Column(String(30), default="IN_CONSULTATION")  # SCHEDULED, IN_CONSULTATION, COMPLETED, CANCELLED
    visit_type = Column(String(30), default="General Consultation")  # General, Follow-up, Routine, Emergency
    chief_complaint = Column(Text, nullable=True)
    hpi = Column(Text, nullable=True)  # History of Present Illness
    vitals = Column(Text, default="{}")  # {"bp": "120/80", "pulse": 76, "temp": 98.4, "resp_rate": 18, "spo2": 99, "height": 172, "weight": 70, "bmi": 23.7}
    clinical_examination = Column(Text, nullable=True)  # General & Systemic
    diagnosis = Column(Text, nullable=False)
    differential_diagnosis = Column(Text, nullable=True)
    treatment_plan = Column(Text, nullable=True)
    lab_tests = Column(Text, nullable=True)
    advice = Column(Text, nullable=True)
    follow_up_date = Column(String(15), nullable=True)
    follow_up_instructions = Column(Text, nullable=True)
    is_finalised = Column(Boolean, default=False)
    signed_by = Column(String(100), nullable=True)
    signed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    patient = relationship("Patient", backref="consultations")
    doctor = relationship("Doctor", backref="consultations")
    appointment = relationship("Appointment", backref="consultation")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True)
    prescription_uid = Column(String(50), unique=True, index=True, nullable=True)  # e.g. RX-2026-0001
    prescription_mode = Column(String(30), default="IN_PERSON")  # IN_PERSON, QUICK_REFILL, TELE_CONSULT
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=True)
    encounter_id = Column(Integer, ForeignKey("consultations.id"), nullable=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    vitals = Column(Text, default="{}")
    symptoms = Column(Text, nullable=True)
    diagnosis = Column(Text, nullable=False)
    medicines = Column(Text, default="[]")  # [{"name": "Amoxicillin 500mg", "dosage": "1-0-1", "duration": "5 days", "notes": "After food"}]
    lab_tests = Column(Text, nullable=True)
    advice = Column(Text, nullable=True)
    is_signed = Column(Boolean, default=True)
    signed_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String(30), default="ACTIVE")  # ACTIVE, CANCELLED
    cancellation_reason = Column(Text, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    cancelled_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    patient = relationship("Patient", backref="prescriptions")
    doctor = relationship("Doctor", backref="prescriptions")
    appointment = relationship("Appointment", backref="prescription")


class LabCategory(Base):
    """Laboratory Test Categories (Module 3)."""
    __tablename__ = "lab_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class LabSampleType(Base):
    """Laboratory Specimen / Sample Types (Module 3)."""
    __tablename__ = "lab_sample_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class LabTest(Base):
    """Laboratory Test Catalogue (Module 3)."""
    __tablename__ = "lab_tests"

    id = Column(Integer, primary_key=True, index=True)
    test_code = Column(String(30), unique=True, index=True, nullable=False)  # e.g. "CBC", "LFT", "RFT"
    name = Column(String(150), nullable=False)
    category = Column(String(50), default="Hematology")  # Hematology, Biochemistry, Pathology, Radiology, Microbiology
    sample_type = Column(String(50), default="Blood")  # Blood, Serum, Urine, Swab, Imaging
    tat_hours = Column(Integer, default=24)
    price = Column(Integer, default=500)
    reference_range = Column(String(100), nullable=True)
    units = Column(String(30), nullable=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)


class LabOrder(Base):
    """Laboratory & Diagnostic Order (Module 3)."""
    __tablename__ = "lab_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_uid = Column(String(50), unique=True, index=True, nullable=False)  # e.g. "LAB-2026-0001"
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    encounter_id = Column(Integer, ForeignKey("consultations.id"), nullable=True)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=True)
    clinical_indication = Column(Text, nullable=True)
    priority = Column(String(20), default="ROUTINE")  # ROUTINE, URGENT, STAT
    status = Column(String(30), default="ORDERED")  # ORDERED, SAMPLE_COLLECTED, PROCESSING, COMPLETED, CANCELLED
    tests = Column(Text, default="[]")  # JSON: [{"test_id": 1, "test_code": "CBC", "name": "Complete Blood Count", "price": 400}]
    total_price = Column(Integer, default=0)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    patient = relationship("Patient", backref="lab_orders")
    doctor = relationship("Doctor", backref="lab_orders")
    invoice = relationship("Invoice", foreign_keys=[invoice_id])


class LabResult(Base):
    """Individual Lab Test Result & Verification (Module 3)."""
    __tablename__ = "lab_results"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("lab_orders.id"), nullable=False)
    test_id = Column(Integer, ForeignKey("lab_tests.id"), nullable=False)
    result_value = Column(String(100), nullable=False)
    reference_range = Column(String(100), nullable=True)
    units = Column(String(30), nullable=True)
    flag = Column(String(20), default="NORMAL")  # NORMAL, HIGH, LOW, CRITICAL
    technician_notes = Column(Text, nullable=True)
    sample_status = Column(String(30), default="COLLECTED")  # COLLECTED, RECEIVED, PROCESSING, COMPLETED, REJECTED
    verified_by = Column(String(100), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    order = relationship("LabOrder", backref="results")
    test = relationship("LabTest")


class Medicine(Base):
    """Medicine Item Catalogue (Module 4)."""
    __tablename__ = "medicines"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, index=True, nullable=False)  # e.g. "MED-001"
    name = Column(String(150), nullable=False)
    generic_name = Column(String(150), nullable=True)
    brand = Column(String(100), nullable=True)
    dosage_form = Column(String(30), default="Tablet")  # Tablet, Capsule, Syrup, Injection, Ointment
    strength = Column(String(50), default="500mg")
    reorder_level = Column(Integer, default=20)
    selling_price = Column(Integer, default=50)
    purchase_price = Column(Integer, default=30)
    tax_percent = Column(Integer, default=5)
    is_active = Column(Boolean, default=True)


class MedicineBatch(Base):
    """Batch-level Medicine Stock (Module 4)."""
    __tablename__ = "medicine_batches"

    id = Column(Integer, primary_key=True, index=True)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    batch_number = Column(String(50), nullable=False)
    supplier_name = Column(String(100), default="AeroHealth Pharma")
    expiry_date = Column(String(15), nullable=False)  # YYYY-MM-DD
    mfg_date = Column(String(15), nullable=True)
    quantity_received = Column(Integer, default=0)
    quantity_available = Column(Integer, default=0)
    purchase_cost = Column(Integer, default=0)
    selling_price = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    medicine = relationship("Medicine", backref="batches")


class InventoryTransaction(Base):
    """Inventory Stock Movement Audit Log (Module 4)."""
    __tablename__ = "inventory_transactions"

    id = Column(Integer, primary_key=True, index=True)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("medicine_batches.id"), nullable=True)
    transaction_type = Column(String(30), nullable=False)  # GOODS_RECEIPT, DISPENSED, ADJUSTMENT, RETURN, EXPIRED_DISPOSAL
    quantity = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=True)
    performed_by = Column(String(100), default="Pharmacist")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    medicine = relationship("Medicine")
    batch = relationship("MedicineBatch")


class DispenseRecord(Base):
    """Prescription Dispensing Log (Module 4)."""
    __tablename__ = "dispense_records"

    id = Column(Integer, primary_key=True, index=True)
    prescription_id = Column(Integer, ForeignKey("prescriptions.id"), nullable=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("medicine_batches.id"), nullable=False)
    quantity_dispensed = Column(Integer, nullable=False)
    dispensed_by = Column(String(100), default="Pharmacist")
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    patient = relationship("Patient")
    medicine = relationship("Medicine")
    batch = relationship("MedicineBatch")


class ServiceItem(Base):
    """Standard Billable Service Catalogue (Module 5)."""
    __tablename__ = "service_items"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, index=True, nullable=False)  # e.g. "SRV-CONSULT"
    name = Column(String(150), nullable=False)
    category = Column(String(50), default="Consultation")  # Consultation, Procedure, Diagnostic, Nursing, Daycare
    price = Column(Integer, default=500)
    tax_percent = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String(50), unique=True, index=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=True)
    encounter_id = Column(Integer, ForeignKey("consultations.id"), nullable=True)
    items = Column(Text, default="[]")  # [{"description": "General Consultation", "quantity": 1, "unit_price": 500, "total": 500}]
    subtotal = Column(Integer, default=0)
    discount = Column(Integer, default=0)
    tax = Column(Integer, default=0)
    total = Column(Integer, default=0)
    amount_paid = Column(Integer, default=0)
    balance_due = Column(Integer, default=0)
    payment_method = Column(String(30), default="UPI")  # Cash, UPI, Card, Net Banking
    payment_status = Column(String(20), default="PAID")  # PAID, PARTIALLY_PAID, UNPAID, CANCELLED
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    patient = relationship("Patient", backref="invoices")
    appointment = relationship("Appointment", backref="invoice")


class Payment(Base):
    """Payment Receipts & Multi-Transaction Records (Module 5)."""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    payment_uid = Column(String(50), unique=True, index=True, nullable=False)  # e.g. "PAY-2026-0001"
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    amount = Column(Integer, nullable=False)
    payment_method = Column(String(30), default="UPI")  # Cash, UPI, Card, Bank Transfer
    transaction_ref = Column(String(100), nullable=True)
    received_by = Column(String(100), default="Reception Desk")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    invoice = relationship("Invoice", backref="payments")


class Refund(Base):
    """Invoice Refund Record (Module 5)."""
    __tablename__ = "refunds"

    id = Column(Integer, primary_key=True, index=True)
    refund_uid = Column(String(50), unique=True, index=True, nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    amount = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    authorized_by = Column(String(100), default="Clinic Administrator")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    invoice = relationship("Invoice", backref="refunds")


class StaffProfile(Base):
    """Staff Directory & Professional Registry (Module 6)."""
    __tablename__ = "staff_profiles"

    id = Column(Integer, primary_key=True, index=True)
    staff_uid = Column(String(30), unique=True, index=True, nullable=False)  # e.g. "STF-101"
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    full_name = Column(String(100), nullable=False)
    role_category = Column(String(50), default="Receptionist")  # Doctor, Nurse, Receptionist, Lab Technician, Pharmacist, Billing Staff, Clinic Administrator
    department = Column(String(100), default="General OPD")
    designation = Column(String(100), default="Staff Member")
    contact_phone = Column(String(30), nullable=False)
    email = Column(String(100), nullable=True)
    registration_number = Column(String(50), nullable=True)  # State Medical / Nursing / Pharmacy council
    employment_status = Column(String(20), default="ACTIVE")  # ACTIVE, ON_LEAVE, RESIGNED
    joining_date = Column(String(15), default="2026-01-01")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id], backref="staff_profile")


class DutyShift(Base):
    """Staff Duty Scheduling & Doctor Rosters (Module 6)."""
    __tablename__ = "duty_shifts"

    id = Column(Integer, primary_key=True, index=True)
    staff_id = Column(Integer, ForeignKey("staff_profiles.id"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=True)
    shift_name = Column(String(50), default="Morning OPD")  # Morning OPD, Evening OPD, Night Duty, Full Day
    shift_date = Column(String(15), nullable=False)  # YYYY-MM-DD
    start_time = Column(String(10), default="09:00")
    end_time = Column(String(10), default="17:00")
    status = Column(String(20), default="SCHEDULED")  # SCHEDULED, PRESENT, ABSENT, ON_LEAVE
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    staff = relationship("StaffProfile", backref="shifts")
    doctor = relationship("Doctor", backref="shifts")


class QueueEntry(Base):
    __tablename__ = "queue_entries"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=False)
    token_number = Column(Integer, nullable=False)
    queue_date = Column(String(15), nullable=False)  # YYYY-MM-DD
    cabin = Column(String(50), default="Cabin 1")
    status = Column(String(20), default="WAITING")  # WAITING, CALLED, IN_CONSULTATION, COMPLETED, SKIPPED
    called_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    appointment = relationship("Appointment", backref="queue_entry")


class Cabin(Base):
    """Clinic Consultation Cabins & Examination Rooms."""
    __tablename__ = "cabins"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)  # e.g. "Cabin 1", "Dental Operatory A"
    code = Column(String(30), unique=True, index=True, nullable=True)  # e.g. "CAB-01"
    department = Column(String(100), nullable=True)  # e.g. "General Consultation", "Specialist Clinic"
    floor = Column(String(50), default="Ground Floor")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

