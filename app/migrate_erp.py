import sqlite3
import datetime
from app.database import engine, Base, SessionLocal
import app.models as models

def run_migration():
    print("[MIGRATION] Starting safe ERP schema upgrade...")
    conn = engine.raw_connection()
    cursor = conn.cursor()

    # 1. Inspect existing columns in patients
    cursor.execute("PRAGMA table_info(patients)")
    existing_patient_cols = [row[1] for row in cursor.fetchall()]

    new_patient_cols = [
        ("patient_uid", "VARCHAR(30)"),
        ("gender", "VARCHAR(20) DEFAULT 'Unspecified'"),
        ("dob", "VARCHAR(20)"),
        ("age", "INTEGER"),
        ("blood_group", "VARCHAR(10)"),
        ("email", "VARCHAR(100)"),
        ("address", "TEXT"),
        ("city", "VARCHAR(50) DEFAULT 'Agra'"),
        ("state", "VARCHAR(50) DEFAULT 'Uttar Pradesh'"),
        ("emergency_name", "VARCHAR(100)"),
        ("emergency_phone", "VARCHAR(30)"),
        ("registration_source", "VARCHAR(30) DEFAULT 'Walk-in'"),
        ("allergies", "TEXT DEFAULT '[]'"),
        ("chronic_conditions", "TEXT DEFAULT '[]'"),
        ("medical_history", "TEXT DEFAULT '[]'"),
        ("clinical_alerts", "TEXT DEFAULT '[]'"),
    ]

    for col_name, col_type in new_patient_cols:
        if col_name not in existing_patient_cols:
            print(f"[MIGRATION] Adding column {col_name} to patients...")
            cursor.execute(f"ALTER TABLE patients ADD COLUMN {col_name} {col_type}")

    # 2. Inspect existing columns in invoices
    cursor.execute("PRAGMA table_info(invoices)")
    existing_invoice_cols = [row[1] for row in cursor.fetchall()]
    new_invoice_cols = [
        ("encounter_id", "INTEGER"),
        ("amount_paid", "INTEGER DEFAULT 0"),
        ("balance_due", "INTEGER DEFAULT 0"),
    ]
    for col_name, col_type in new_invoice_cols:
        if col_name not in existing_invoice_cols:
            print(f"[MIGRATION] Adding column {col_name} to invoices...")
            cursor.execute(f"ALTER TABLE invoices ADD COLUMN {col_name} {col_type}")

    # 3. Inspect existing columns in prescriptions
    cursor.execute("PRAGMA table_info(prescriptions)")
    existing_prescription_cols = [row[1] for row in cursor.fetchall()]
    new_prescription_cols = [
        ("prescription_uid", "VARCHAR(50)"),
        ("encounter_id", "INTEGER"),
        ("is_signed", "BOOLEAN DEFAULT 1"),
        ("signed_at", "DATETIME"),
    ]
    for col_name, col_type in new_prescription_cols:
        if col_name not in existing_prescription_cols:
            print(f"[MIGRATION] Adding column {col_name} to prescriptions...")
            cursor.execute(f"ALTER TABLE prescriptions ADD COLUMN {col_name} {col_type}")

    conn.commit()
    cursor.close()
    conn.close()

    # 4. Create all new tables
    Base.metadata.create_all(bind=engine)
    print("[MIGRATION] All ERP tables verified.")

    # 5. Populate UIDs for existing patients if needed & seed standard medical data
    db = SessionLocal()
    try:
        # Update patient UIDs
        pts = db.query(models.Patient).all()
        for idx, p in enumerate(pts, 1):
            if not p.patient_uid:
                p.patient_uid = f"PAT-2026-{idx:04d}"
            if not p.allergies:
                p.allergies = "[]"
            if not p.chronic_conditions:
                p.chronic_conditions = "[]"
            if not p.medical_history:
                p.medical_history = "[]"
            if not p.clinical_alerts:
                p.clinical_alerts = "[]"
        db.commit()

        # Seed Lab Tests if catalogue is empty
        if db.query(models.LabTest).count() == 0:
            print("[MIGRATION] Seeding standard Laboratory Test catalogue...")
            seed_tests = [
                models.LabTest(
                    test_code="CBC",
                    name="Complete Blood Count (CBC with ESR)",
                    category="Hematology",
                    sample_type="EDTA Whole Blood",
                    tat_hours=4,
                    price=350,
                    reference_range="Hb: 12.0 - 15.5 g/dL; TLC: 4,000 - 11,000 /mcL",
                    units="Various",
                    description="Measures red blood cells, white blood cells, platelets and hemoglobin.",
                ),
                models.LabTest(
                    test_code="LFT",
                    name="Liver Function Test (LFT Comprehensive)",
                    category="Biochemistry",
                    sample_type="Serum",
                    tat_hours=6,
                    price=650,
                    reference_range="SGOT: 5 - 40 U/L; SGPT: 7 - 56 U/L; Bilirubin: 0.2 - 1.2 mg/dL",
                    units="U/L, mg/dL",
                    description="Assesses liver enzymes, bilirubin, protein and albumin levels.",
                ),
                models.LabTest(
                    test_code="KFT",
                    name="Kidney Function Test (KFT / RFT)",
                    category="Biochemistry",
                    sample_type="Serum",
                    tat_hours=6,
                    price=550,
                    reference_range="Urea: 15 - 45 mg/dL; Creatinine: 0.6 - 1.2 mg/dL",
                    units="mg/dL",
                    description="Assesses renal filtration rate, serum creatinine, and blood urea nitrogen.",
                ),
                models.LabTest(
                    test_code="LIPID",
                    name="Lipid Profile (Cholesterol & Triglycerides)",
                    category="Biochemistry",
                    sample_type="Serum (Fasting 12h)",
                    tat_hours=8,
                    price=600,
                    reference_range="Total Chol: < 200 mg/dL; Triglycerides: < 150 mg/dL; HDL: > 40 mg/dL",
                    units="mg/dL",
                    description="Evaluates cardiovascular risk, LDL, HDL and total cholesterol.",
                ),
                models.LabTest(
                    test_code="THYROID",
                    name="Thyroid Profile (T3, T4, TSH Ultra)",
                    category="Biochemistry",
                    sample_type="Serum",
                    tat_hours=12,
                    price=500,
                    reference_range="TSH: 0.4 - 4.5 uIU/mL; T3: 0.8 - 2.0 ng/mL; T4: 5.1 - 14.1 ug/dL",
                    units="uIU/mL",
                    description="Monitors endocrine thyroid activity and metabolic regulation.",
                ),
                models.LabTest(
                    test_code="URINE_RE",
                    name="Urine Routine & Microscopic Examination",
                    category="Pathology",
                    sample_type="Midstream Urine",
                    tat_hours=2,
                    price=200,
                    reference_range="Color: Pale Yellow; Pus Cells: 0-4 /hpf; RBC: Nil; Albumin: Nil",
                    units="Microscopic",
                    description="Screens for urinary tract infections, renal stones, and proteinuria.",
                ),
                models.LabTest(
                    test_code="XRAY_CHEST",
                    name="Digital Chest X-Ray (PA View)",
                    category="Radiology",
                    sample_type="Imaging",
                    tat_hours=1,
                    price=450,
                    reference_range="Normal Bronchovascular Markings, Clear Costophrenic Angles",
                    units="Digital Radiograph",
                    description="High-resolution digital thoracic radiograph for pulmonary evaluation.",
                ),
            ]
            db.add_all(seed_tests)
            db.commit()

        # Seed Medicine Catalogue & Initial Batches
        if db.query(models.Medicine).count() == 0:
            print("[MIGRATION] Seeding standard Medicine & Pharmacy catalogue...")
            seed_meds = [
                models.Medicine(
                    code="MED-AMOX-500",
                    name="Amoxicillin & Clavulanate 625mg",
                    generic_name="Amoxicillin 500mg + Potassium Clavulanate 125mg",
                    brand="Augmentin 625 Duo",
                    dosage_form="Tablet",
                    strength="625mg",
                    reorder_level=30,
                    purchase_price=90,
                    selling_price=160,
                    tax_percent=12,
                ),
                models.Medicine(
                    code="MED-PARA-650",
                    name="Paracetamol 650mg",
                    generic_name="Acetaminophen / Paracetamol",
                    brand="Dolo 650",
                    dosage_form="Tablet",
                    strength="650mg",
                    reorder_level=50,
                    purchase_price=15,
                    selling_price=32,
                    tax_percent=12,
                ),
                models.Medicine(
                    code="MED-PANT-40",
                    name="Pantoprazole 40mg",
                    generic_name="Pantoprazole Sodium Gastro-resistant",
                    brand="Pan 40",
                    dosage_form="Tablet",
                    strength="40mg",
                    reorder_level=40,
                    purchase_price=45,
                    selling_price=95,
                    tax_percent=12,
                ),
                models.Medicine(
                    code="MED-AZITH-500",
                    name="Azithromycin 500mg",
                    generic_name="Azithromycin Dihydrate",
                    brand="Azithral 500",
                    dosage_form="Tablet",
                    strength="500mg",
                    reorder_level=25,
                    purchase_price=70,
                    selling_price=125,
                    tax_percent=12,
                ),
                models.Medicine(
                    code="MED-MET-500",
                    name="Metformin Hydrochloride 500mg",
                    generic_name="Metformin PR",
                    brand="Glycomet 500",
                    dosage_form="Tablet",
                    strength="500mg",
                    reorder_level=30,
                    purchase_price=18,
                    selling_price=35,
                    tax_percent=12,
                ),
                models.Medicine(
                    code="MED-CET-10",
                    name="Cetirizine Hydrochloride 10mg",
                    generic_name="Cetirizine 10mg",
                    brand="Cetzine 10",
                    dosage_form="Tablet",
                    strength="10mg",
                    reorder_level=20,
                    purchase_price=12,
                    selling_price=28,
                    tax_percent=12,
                ),
            ]
            db.add_all(seed_meds)
            db.commit()

            # Add initial batches with valid future expiry dates
            meds = db.query(models.Medicine).all()
            for m in meds:
                batch = models.MedicineBatch(
                    medicine_id=m.id,
                    batch_number=f"BN-{m.id}26-A",
                    supplier_name="AeroHealth Pharma Distributors",
                    expiry_date="2027-12-31",
                    mfg_date="2026-01-15",
                    quantity_received=100,
                    quantity_available=100,
                    purchase_cost=m.purchase_price,
                    selling_price=m.selling_price,
                )
                db.add(batch)
                db.commit()
                db.refresh(batch)

                # Record inventory receipt transaction
                txn = models.InventoryTransaction(
                    medicine_id=m.id,
                    batch_id=batch.id,
                    transaction_type="GOODS_RECEIPT",
                    quantity=100,
                    reason="Initial Clinic Pharmacy Opening Stock",
                    performed_by="Pharmacy Head",
                )
                db.add(txn)
            db.commit()

        # Seed Billable Services Catalogue
        if db.query(models.ServiceItem).count() == 0:
            print("[MIGRATION] Seeding standard Service catalogue...")
            seed_services = [
                models.ServiceItem(code="SRV-CONSULT-GEN", name="General Physician OPD Consultation", category="Consultation", price=500, tax_percent=0),
                models.ServiceItem(code="SRV-CONSULT-SPEC", name="Specialist / Super-Specialist Consultation", category="Consultation", price=800, tax_percent=0),
                models.ServiceItem(code="SRV-ECG-12", name="12-Lead Electrocardiogram (ECG)", category="Diagnostic", price=350, tax_percent=0),
                models.ServiceItem(code="SRV-DRESSING", name="Wound Dressing & Aseptic Bandage", category="Procedure", price=250, tax_percent=0),
                models.ServiceItem(code="SRV-NEBULIZATION", name="Respiratory Nebulization Session", category="Procedure", price=200, tax_percent=0),
                models.ServiceItem(code="SRV-BLOOD-SUGAR", name="Random Blood Sugar Test (Glucometer)", category="Diagnostic", price=100, tax_percent=0),
            ]
            db.add_all(seed_services)
            db.commit()

        # Seed Staff Directory
        if db.query(models.StaffProfile).count() == 0:
            print("[MIGRATION] Seeding initial Staff Directory...")
            seed_staff = [
                models.StaffProfile(
                    staff_uid="STF-001",
                    full_name="Dr. Amit Sharma",
                    role_category="Doctor",
                    department="Dentistry & Maxillofacial",
                    designation="Senior Dental Surgeon",
                    contact_phone="+919876543210",
                    email="amit.sharma@aerostateclinic.com",
                    registration_number="DCI-UP-48921",
                    employment_status="ACTIVE",
                    joining_date="2025-06-01",
                ),
                models.StaffProfile(
                    staff_uid="STF-002",
                    full_name="Pooja Verma",
                    role_category="Receptionist",
                    department="Front Desk & Registration",
                    designation="Lead Receptionist",
                    contact_phone="+919876543211",
                    email="pooja.verma@aerostateclinic.com",
                    employment_status="ACTIVE",
                    joining_date="2025-08-15",
                ),
                models.StaffProfile(
                    staff_uid="STF-003",
                    full_name="Sanjay Gupta",
                    role_category="Pharmacist",
                    department="Central Pharmacy",
                    designation="Registered Pharmacist",
                    contact_phone="+919876543212",
                    email="sanjay.pharma@aerostateclinic.com",
                    registration_number="PCI-UP-9182",
                    employment_status="ACTIVE",
                    joining_date="2025-10-01",
                ),
                models.StaffProfile(
                    staff_uid="STF-004",
                    full_name="Sunita Rawat",
                    role_category="Lab Technician",
                    department="Diagnostic Pathology",
                    designation="Senior Medical Lab Technologist",
                    contact_phone="+919876543213",
                    email="sunita.lab@aerostateclinic.com",
                    registration_number="DMLT-88219",
                    employment_status="ACTIVE",
                    joining_date="2025-11-10",
                ),
            ]
            db.add_all(seed_staff)
            db.commit()

            # Seed today's duty shift
            today_str = datetime.date.today().strftime("%Y-%m-%d")
            s1 = db.query(models.StaffProfile).filter(models.StaffProfile.staff_uid == "STF-001").first()
            s2 = db.query(models.StaffProfile).filter(models.StaffProfile.staff_uid == "STF-002").first()
            if s1:
                db.add(models.DutyShift(staff_id=s1.id, doctor_id=1, shift_name="Morning OPD", shift_date=today_str, start_time="09:00", end_time="17:00", status="SCHEDULED"))
            if s2:
                db.add(models.DutyShift(staff_id=s2.id, shift_name="Full Day Reception", shift_date=today_str, start_time="08:30", end_time="18:00", status="SCHEDULED"))
            db.commit()

        print("[MIGRATION] Migration and initial ERP catalogue seeding successfully completed!")
    except Exception as e:
        print(f"[MIGRATION ERROR] {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()
