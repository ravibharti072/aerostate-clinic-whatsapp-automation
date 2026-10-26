import json
import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import Invoice, Patient, Appointment, ServiceItem, Payment, Refund, Consultation, LabOrder, DispenseRecord
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.services.pdf_service import generate_invoice_pdf, generate_diagnostic_receipt_pdf, build_pdf_filename
from app.config import settings
from app.security import require_admin

router = APIRouter(prefix="/admin/billing", tags=["Billing & Invoicing"], dependencies=[Depends(require_admin)])


class InvoiceItem(BaseModel):
    description: str
    quantity: int = 1
    unit_price: int
    total: Optional[int] = None


class InvoiceCreate(BaseModel):
    patient_id: Optional[int] = None
    patient_phone: Optional[str] = None
    patient_name: Optional[str] = None
    appointment_id: Optional[int] = None
    encounter_id: Optional[int] = None
    items: List[InvoiceItem]
    discount: int = 0
    tax: int = 0
    payment_method: str = "UPI"  # Cash, UPI, Card, Net Banking
    payment_status: str = "PAID"  # PAID, PENDING, CANCELLED
    notes: Optional[str] = None
    send_whatsapp: bool = True


class InvoiceStatusUpdate(BaseModel):
    payment_status: str
    payment_method: Optional[str] = None


class ServiceItemCreate(BaseModel):
    code: str
    name: str
    category: str = "Consultation"
    price: int
    tax_percent: int = 0


class PaymentRecordCreate(BaseModel):
    amount: int
    payment_method: str = "UPI"
    transaction_ref: Optional[str] = None
    received_by: str = "Reception Desk"
    notes: Optional[str] = None


class RefundRecordCreate(BaseModel):
    amount: int
    reason: str
    authorized_by: str = "Clinic Administrator"


def generate_payment_uid(db: Session) -> str:
    year = datetime.date.today().year
    highest = db.query(Payment).order_by(Payment.id.desc()).first()
    next_num = (highest.id + 1) if highest else 1
    while db.query(Payment).filter(Payment.payment_uid == f"PAY-{year}-{next_num:04d}").first():
        next_num += 1
    return f"PAY-{year}-{next_num:04d}"


def generate_refund_uid(db: Session) -> str:
    year = datetime.date.today().year
    highest = db.query(Refund).order_by(Refund.id.desc()).first()
    next_num = (highest.id + 1) if highest else 1
    while db.query(Refund).filter(Refund.refund_uid == f"REF-{year}-{next_num:04d}").first():
        next_num += 1
    return f"REF-{year}-{next_num:04d}"


def generate_invoice_number(db: Session) -> str:
    """Auto-generates sequential professional invoice numbers e.g. INV-2026-0001."""
    year = datetime.date.today().year
    highest = db.query(Invoice).order_by(Invoice.id.desc()).first()
    next_num = (highest.id + 1) if highest else 1
    while db.query(Invoice).filter(Invoice.invoice_number == f"INV-{year}-{next_num:04d}").first():
        next_num += 1
    return f"INV-{year}-{next_num:04d}"


def format_invoice_whatsapp(inv: Invoice, patient: Patient, items: list) -> str:
    """Formats a clean receipt message for WhatsApp."""
    today_str = inv.created_at.strftime("%d %b %Y, %I:%M %p")

    items_str = ""
    for i, item in enumerate(items, 1):
        qty = item.get("quantity", 1)
        price = item.get("unit_price", 0)
        item_total = item.get("total", qty * price)
        items_str += f"{i}. *{item.get('description')}* (x{qty}) - ₹{item_total:,}\n"

    status_badge = "PAID ✅" if inv.payment_status == "PAID" else "PENDING PAYMENT ⏳"

    text = (
        f"🏥 *{settings.CLINIC_NAME}*\n"
        f"🧾 *OFFICIAL RECEIPT / INVOICE #{inv.invoice_number}*\n\n"
        f"👤 *Patient:* {patient.name}\n"
        f"📱 *Phone:* {patient.phone}\n"
        f"📅 *Date:* {today_str}\n"
        f"💳 *Payment Mode:* {inv.payment_method}\n"
        f"📌 *Status:* {status_badge}\n\n"
        f"*Itemized Breakdown:*\n"
        f"{items_str}\n"
        f"Subtotal: ₹{inv.subtotal:,}\n"
    )
    if inv.discount > 0:
        text += f"Discount: -₹{inv.discount:,}\n"
    if inv.tax > 0:
        text += f"Tax: +₹{inv.tax:,}\n"

    text += (
        f"━━━━━━━━━━━━━━━\n"
        f"*Total Amount:* ₹{inv.total:,}\n"
        f"━━━━━━━━━━━━━━━\n\n"
        f"🏥 *Clinic Helpline:* {settings.CLINIC_PHONE}\n"
        f"📍 *Address:* {settings.CLINIC_ADDRESS}\n"
        f"_Thank you for choosing our clinic. Keep this digital receipt for your records._"
    )
    return text


@router.get("/stats")
def get_billing_stats(db: Session = Depends(get_db)):
    """100% backend-calculated financial metrics and today's collections."""
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")

    # 1. Total revenue collected (PAID only)
    total_revenue = db.query(func.sum(Invoice.total)).filter(Invoice.payment_status == "PAID").scalar() or 0

    # 2. Today's collections
    all_paid = db.query(Invoice).filter(Invoice.payment_status == "PAID").all()
    today_revenue = sum(
        inv.total for inv in all_paid
        if inv.created_at and inv.created_at.strftime("%Y-%m-%d") == today_str
    )

    # 3. Pending payments
    pending_amount = db.query(func.sum(Invoice.total)).filter(Invoice.payment_status == "PENDING").scalar() or 0
    pending_count = db.query(Invoice).filter(Invoice.payment_status == "PENDING").count()

    # 4. Total invoice counts
    total_invoices = db.query(Invoice).count()

    # 5. Average bill size
    avg_bill = round(total_revenue / total_invoices) if total_invoices > 0 else 0

    return {
        "total_revenue": total_revenue,
        "today_revenue": today_revenue,
        "pending_amount": pending_amount,
        "pending_count": pending_count,
        "total_invoices": total_invoices,
        "average_bill": avg_bill,
    }


@router.get("/options")
def get_billing_options():
    """Provides master options for payment methods, payment statuses, and service categories."""
    return {
        "payment_methods": ["ALL", "UPI", "Cash", "Debit Card", "Credit Card", "Net Banking"],
        "payment_statuses": ["ALL", "PAID", "PENDING", "REFUNDED", "CANCELLED"],
        "service_categories": ["Consultation", "Diagnostics", "Pharmacy", "Procedure", "Package", "Room/Bed"],
    }


@router.get("/unbilled-services")
def get_unbilled_services(
    patient_id: Optional[int] = None,
    encounter_id: Optional[int] = None,
    appointment_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Collects unbilled consultation encounters, lab diagnostic orders, and pharmacy dispenses
    for seamless 1-click invoice itemization.
    """
    target_patient = None
    target_enc = None

    if encounter_id:
        target_enc = db.query(Consultation).filter(Consultation.id == encounter_id).first()
        if target_enc:
            target_patient = target_enc.patient
    elif appointment_id:
        target_enc = db.query(Consultation).filter(Consultation.appointment_id == appointment_id).first()
        appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
        if appt:
            target_patient = appt.patient
    elif patient_id:
        target_patient = db.query(Patient).filter(Patient.id == patient_id).first()

    if not target_patient:
        return {
            "patient_id": None,
            "patient_name": "",
            "patient_phone": "",
            "encounter_id": encounter_id,
            "appointment_id": appointment_id,
            "suggested_items": [],
            "subtotal": 0,
        }

    suggested_items = []

    # 1. Check Unbilled Doctor Consultation
    if target_enc:
        already_billed_enc = db.query(Invoice).filter(Invoice.encounter_id == target_enc.id).first()
        if not already_billed_enc:
            doctor_name = target_enc.doctor.name if target_enc.doctor else "Specialist"
            suggested_items.append({
                "description": f"OPD Consultation ({target_enc.encounter_uid}) - Dr. {doctor_name}",
                "quantity": 1,
                "unit_price": 500,
            })
    elif appointment_id:
        already_billed_appt = db.query(Invoice).filter(Invoice.appointment_id == appointment_id).first()
        if not already_billed_appt:
            appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
            if appt:
                doc_name = appt.doctor.name if appt.doctor else "Doctor"
                suggested_items.append({
                    "description": f"Clinic Appointment - Dr. {doc_name}",
                    "quantity": 1,
                    "unit_price": 500,
                })

    # 2. Check Unbilled Laboratory Orders for this Encounter / Patient
    lab_query = db.query(LabOrder).filter(LabOrder.patient_id == target_patient.id)
    if target_enc:
        lab_query = lab_query.filter(LabOrder.encounter_id == target_enc.id)
    lab_orders = lab_query.all()

    for lo in lab_orders:
        try:
            tests_list = json.loads(lo.tests or "[]")
        except Exception:
            tests_list = []
        for t in tests_list:
            suggested_items.append({
                "description": f"Lab Diagnostic: {t.get('name', 'Test')} ({lo.order_uid})",
                "quantity": 1,
                "unit_price": int(t.get("price", 400)),
            })

    # 3. Check Unbilled Pharmacy Dispenses
    disp_records = (
        db.query(DispenseRecord)
        .filter(DispenseRecord.patient_id == target_patient.id, DispenseRecord.invoice_id == None)
        .all()
    )
    for dr in disp_records:
        med_name = dr.medicine.name if dr.medicine else "Medicine"
        unit_price = dr.medicine.selling_price if dr.medicine and dr.medicine.selling_price else 25
        suggested_items.append({
            "description": f"Pharmacy: {med_name} (Dispense #{dr.id})",
            "quantity": dr.quantity_dispensed,
            "unit_price": unit_price,
        })

    subtotal = sum(item["quantity"] * item["unit_price"] for item in suggested_items)

    return {
        "patient_id": target_patient.id,
        "patient_name": target_patient.name,
        "patient_phone": target_patient.phone,
        "encounter_id": target_enc.id if target_enc else encounter_id,
        "appointment_id": appointment_id,
        "suggested_items": suggested_items,
        "subtotal": subtotal,
    }


@router.get("/invoices")
def list_invoices(
    search: Optional[str] = None,
    status: Optional[str] = None,
    payment_method: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Invoice).join(Patient)

    if status and status != "ALL":
        query = query.filter(Invoice.payment_status == status.upper())
    if payment_method and payment_method != "ALL":
        query = query.filter(Invoice.payment_method == payment_method)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (Invoice.invoice_number.ilike(s))
            | (Patient.name.ilike(s))
            | (Patient.phone.ilike(s))
        )

    invoices = query.order_by(Invoice.id.desc()).all()

    def get_latest_activity(inv):
        dates = [inv.created_at] if inv.created_at else []
        for p in (inv.payments or []):
            if p.created_at:
                dates.append(p.created_at)
        for r in (inv.refunds or []):
            if r.created_at:
                dates.append(r.created_at)
        return max(dates) if dates else datetime.datetime.min

    invoices.sort(key=lambda inv: (get_latest_activity(inv), inv.id), reverse=True)

    results = []
    for inv in invoices:
        patient = inv.patient
        items = json.loads(inv.items or "[]")
        latest_dt = get_latest_activity(inv)

        results.append({
            "id": inv.id,
            "invoice_number": inv.invoice_number,
            "patient_id": patient.id,
            "patient_name": patient.name,
            "patient_phone": patient.phone,
            "appointment_id": inv.appointment_id,
            "items": items,
            "items_count": len(items),
            "subtotal": inv.subtotal,
            "discount": inv.discount,
            "tax": inv.tax,
            "total": inv.total,
            "amount_paid": inv.amount_paid or 0,
            "balance_due": inv.balance_due if inv.balance_due is not None else max(0, inv.total - (inv.amount_paid or 0)),
            "payment_method": inv.payment_method,
            "payment_status": inv.payment_status,
            "notes": inv.notes,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
            "created_date_display": inv.created_at.strftime("%d %b %Y, %I:%M %p") if inv.created_at else "-",
            "latest_activity": latest_dt.isoformat() if latest_dt and latest_dt != datetime.datetime.min else (inv.created_at.isoformat() if inv.created_at else None),
            "latest_activity_display": latest_dt.strftime("%d %b %Y, %I:%M %p") if latest_dt and latest_dt != datetime.datetime.min else "-",
        })

    return {
        "total": len(results),
        "invoices": results,
    }


@router.get("/invoices/{inv_id}")
def get_invoice(inv_id: int, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "patient": {
            "id": inv.patient.id,
            "name": inv.patient.name,
            "phone": inv.patient.phone,
        },
        "appointment_id": inv.appointment_id,
        "items": json.loads(inv.items or "[]"),
        "subtotal": inv.subtotal,
        "discount": inv.discount,
        "tax": inv.tax,
        "total": inv.total,
        "amount_paid": inv.amount_paid or 0,
        "balance_due": inv.balance_due if inv.balance_due is not None else max(0, inv.total - (inv.amount_paid or 0)),
        "payment_method": inv.payment_method,
        "payment_status": inv.payment_status,
        "notes": inv.notes,
        "payments": [
            {
                "payment_uid": p.payment_uid,
                "amount": p.amount,
                "payment_method": p.payment_method,
                "transaction_ref": p.transaction_ref,
                "received_by": p.received_by,
                "notes": p.notes or "Payment collected",
                "date": p.created_at.strftime("%d %b %Y, %I:%M %p") if p.created_at else "-",
            }
            for p in (inv.payments or [])
        ],
        "refunds": [
            {
                "refund_uid": r.refund_uid,
                "amount": r.amount,
                "reason": r.reason,
                "authorized_by": r.authorized_by,
                "date": r.created_at.strftime("%d %b %Y, %I:%M %p") if r.created_at else "-",
            }
            for r in (inv.refunds or [])
        ],
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "created_date_display": inv.created_at.strftime("%d %b %Y, %I:%M %p") if inv.created_at else "-",
    }


def resolve_invoice_bill_type(inv: Invoice, db: Session) -> str:
    """Determine invoice bill type: 'Lab', 'Pharma', 'Appointment', or 'General'."""
    notes = (inv.notes or "").lower()
    if any(k in notes for k in ["pharmacy", "dispense", "rx", "prescription", "chemist", "medicine"]):
        return "Pharma"
    if any(k in notes for k in ["lab", "diagnostic", "investigation", "pathology"]):
        return "Lab"

    try:
        items = json.loads(inv.items) if isinstance(inv.items, str) else (inv.items or [])
        item_text = " ".join([
            str(it.get("description") or it.get("name") or it.get("medicine_name") or "")
            for it in items
        ]).lower()
        if any(w in item_text for w in ["tablet", "capsule", "syrup", "injection", "ointment", "drops", "mg", "ml"]):
            return "Pharma"
        if any(w in item_text for w in ["test", "blood", "profile", "cbc", "scan", "x-ray", "culture", "urine"]):
            return "Lab"
        if any(w in item_text for w in ["consultation", "appointment", "opd", "follow-up", "doctor"]):
            return "Appointment"
    except Exception:
        pass

    if inv.appointment_id or inv.encounter_id:
        return "Appointment"

    return "General"


@router.get("/invoices/{inv_id}/pdf")
def get_invoice_pdf_file(inv_id: int, download: bool = False, db: Session = Depends(get_db)):
    """Generate and stream an official, high-resolution PDF for the requested invoice."""
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    patient = inv.patient
    patient_name = patient.name if patient else "Patient"

    # Check if linked to laboratory order for rich diagnostic metadata
    lab_order = db.query(LabOrder).filter(LabOrder.invoice_id == inv.id).first()
    if lab_order:
        pdf_bytes = generate_diagnostic_receipt_pdf(lab_order, inv)
        bill_type = "Lab"
    else:
        pdf_bytes = generate_invoice_pdf(inv, patient)
        bill_type = resolve_invoice_bill_type(inv, db)

    filename = build_pdf_filename(patient_name, bill_type, inv.invoice_number)
    disposition = "attachment" if download else "inline"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )


@router.post("/invoices")
async def create_invoice(payload: InvoiceCreate, db: Session = Depends(get_db)):
    # 1. Resolve Patient
    patient = None
    if payload.patient_id:
        patient = db.query(Patient).filter(Patient.id == payload.patient_id).first()
    elif payload.patient_phone:
        clean_phone = payload.patient_phone.strip()
        patient = db.query(Patient).filter(Patient.phone == clean_phone).first()
        if not patient:
            patient = Patient(phone=clean_phone, name=payload.patient_name or "Valued Patient")
            db.add(patient)
            db.commit()
            db.refresh(patient)

    if not patient:
        raise HTTPException(status_code=400, detail="Patient information required")

    # 2. Calculate Line Items & Subtotal on Backend
    items_list = []
    subtotal = 0
    for item in payload.items:
        qty = max(1, item.quantity)
        price = max(0, item.unit_price)
        line_total = qty * price
        subtotal += line_total
        items_list.append({
            "description": item.description,
            "quantity": qty,
            "unit_price": price,
            "total": line_total,
        })

    discount = max(0, payload.discount)
    tax = max(0, payload.tax)
    total = max(0, subtotal - discount + tax)

    inv_number = generate_invoice_number(db)

    amount_paid = total if payload.payment_status.upper() == "PAID" else 0
    balance_due = max(0, total - amount_paid)

    enc_id = payload.encounter_id
    if not enc_id and payload.appointment_id:
        enc_match = db.query(Consultation).filter(Consultation.appointment_id == payload.appointment_id).first()
        if enc_match:
            enc_id = enc_match.id

    inv = Invoice(
        invoice_number=inv_number,
        patient_id=patient.id,
        appointment_id=payload.appointment_id,
        encounter_id=enc_id,
        items=json.dumps(items_list),
        subtotal=subtotal,
        discount=discount,
        tax=tax,
        total=total,
        amount_paid=amount_paid,
        balance_due=balance_due,
        payment_method=payload.payment_method,
        payment_status=payload.payment_status.upper(),
        notes=payload.notes,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    # Link any unbilled dispense records for this patient to this invoice
    unbilled_dispenses = (
        db.query(DispenseRecord)
        .filter(DispenseRecord.patient_id == patient.id, DispenseRecord.invoice_id == None)
        .all()
    )
    for dr in unbilled_dispenses:
        dr.invoice_id = inv.id
    db.commit()

    if amount_paid > 0:
        pay = Payment(
            payment_uid=generate_payment_uid(db),
            invoice_id=inv.id,
            amount=amount_paid,
            payment_method=payload.payment_method,
            received_by="Reception Cashier",
            notes="Initial invoice settlement",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(pay)
        db.commit()

    # Optional 1-click WhatsApp receipt dispatch
    whatsapp_sent = False
    if payload.send_whatsapp and patient.phone:
        try:
            msg_text = format_invoice_whatsapp(inv, patient, items_list)
            await whatsapp_client.send_text(to=patient.phone, text=msg_text)
            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="clinic",
                body=msg_text,
                patient_name=patient.name,
                message_type="invoice",
            )
            whatsapp_sent = True
        except Exception as e:
            print("Failed to dispatch WhatsApp invoice:", e)

    return {
        "message": "Invoice generated successfully",
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "encounter_id": inv.encounter_id,
        "total": inv.total,
        "whatsapp_sent": whatsapp_sent,
    }


@router.put("/invoices/{inv_id}/status")
def update_invoice_status(inv_id: int, payload: InvoiceStatusUpdate, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    inv.payment_status = payload.payment_status.upper()
    if payload.payment_method:
        inv.payment_method = payload.payment_method

    db.commit()
    return {"message": "Invoice status updated successfully", "payment_status": inv.payment_status}


@router.post("/invoices/{inv_id}/send-whatsapp")
async def send_invoice_whatsapp(inv_id: int, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    patient = inv.patient
    items = json.loads(inv.items or "[]")

    msg_text = format_invoice_whatsapp(inv, patient, items)
    await whatsapp_client.send_text(to=patient.phone, text=msg_text)
    message_service.log_message(
        db=db,
        phone=patient.phone,
        sender="clinic",
        body=msg_text,
        patient_name=patient.name,
        message_type="invoice",
    )

    return {
        "message": f"Invoice #{inv.invoice_number} sent to {patient.phone} via WhatsApp successfully",
        "phone": patient.phone,
    }


# ----------------------------------------------------
# Service Catalogue & Multi-Payment Processing
# ----------------------------------------------------

@router.get("/services")
def list_billable_services(category: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(ServiceItem).filter(ServiceItem.is_active == True)
    if category:
        query = query.filter(ServiceItem.category == category)
    services = query.order_by(ServiceItem.category.asc(), ServiceItem.name.asc()).all()
    return [
        {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "category": s.category,
            "price": s.price,
            "tax_percent": s.tax_percent,
        }
        for s in services
    ]


@router.post("/services")
def add_billable_service(payload: ServiceItemCreate, db: Session = Depends(get_db)):
    code = payload.code.strip().upper()
    existing = db.query(ServiceItem).filter(ServiceItem.code == code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Service code {code} already exists.")

    service = ServiceItem(
        code=code,
        name=payload.name.strip(),
        category=payload.category,
        price=payload.price,
        tax_percent=payload.tax_percent,
    )
    db.add(service)
    db.commit()
    db.refresh(service)
    return {"message": "Service added to billing catalogue", "id": service.id}


@router.post("/invoices/{inv_id}/payments")
def record_invoice_payment(inv_id: int, payload: PaymentRecordCreate, db: Session = Depends(get_db)):
    """Records full or partial payment, recalculates balance due, and updates invoice status."""
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")

    reason = (payload.notes or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason / purpose for collecting this amount is mandatory.")

    pay_uid = generate_payment_uid(db)
    payment = Payment(
        payment_uid=pay_uid,
        invoice_id=inv.id,
        amount=payload.amount,
        payment_method=payload.payment_method,
        transaction_ref=payload.transaction_ref,
        received_by=payload.received_by or "Reception Desk",
        notes=reason,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(payment)

    current_paid = inv.amount_paid or 0
    new_paid = current_paid + payload.amount
    inv.amount_paid = new_paid
    inv.balance_due = max(0, inv.total - new_paid)

    if inv.balance_due == 0:
        inv.payment_status = "PAID"
    elif inv.balance_due < inv.total:
        inv.payment_status = "PARTIALLY_PAID"

    today_stamp = datetime.datetime.utcnow().strftime("%d %b %Y, %I:%M %p")
    audit_entry = f"\n[COLLECTED ₹{payload.amount} on {today_stamp} via {payload.payment_method}: {reason}]"
    inv.notes = (inv.notes or "") + audit_entry

    db.commit()
    db.refresh(inv)

    return {
        "message": f"Payment of ₹{payload.amount} recorded against Invoice {inv.invoice_number}",
        "payment_uid": payment.payment_uid,
        "amount_paid": inv.amount_paid,
        "balance_due": inv.balance_due,
        "payment_status": inv.payment_status,
    }


@router.post("/invoices/{inv_id}/refunds")
def record_invoice_refund(inv_id: int, payload: RefundRecordCreate, db: Session = Depends(get_db)):
    """Authorizes and records an official refund against an invoice."""
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    current_paid = inv.amount_paid or 0
    if payload.amount <= 0 or payload.amount > current_paid:
        raise HTTPException(
            status_code=400,
            detail=f"Refund amount (₹{payload.amount}) cannot exceed collected amount (₹{current_paid}).",
        )

    ref_uid = generate_refund_uid(db)
    refund = Refund(
        refund_uid=ref_uid,
        invoice_id=inv.id,
        amount=payload.amount,
        reason=payload.reason,
        authorized_by=payload.authorized_by,
        created_at=datetime.datetime.utcnow(),
    )
    db.add(refund)

    inv.amount_paid = current_paid - payload.amount
    inv.balance_due = max(0, inv.total - inv.amount_paid)
    if inv.amount_paid == 0:
        inv.payment_status = "REFUNDED"
    else:
        inv.payment_status = "PARTIALLY_REFUNDED"

    db.commit()

    return {
        "message": f"Refund of ₹{payload.amount} authorized by {payload.authorized_by}",
        "refund_uid": refund.refund_uid,
        "amount_refunded": payload.amount,
        "balance_due": inv.balance_due,
        "payment_status": inv.payment_status,
    }


@router.get("/invoices/{inv_id}/payments")
def list_invoice_payments(inv_id: int, db: Session = Depends(get_db)):
    payments = db.query(Payment).filter(Payment.invoice_id == inv_id).order_by(Payment.id.desc()).all()
    refunds = db.query(Refund).filter(Refund.invoice_id == inv_id).order_by(Refund.id.desc()).all()
    return {
        "payments": [
            {
                "payment_uid": p.payment_uid,
                "amount": p.amount,
                "payment_method": p.payment_method,
                "transaction_ref": p.transaction_ref,
                "received_by": p.received_by,
                "notes": p.notes or "Payment collected",
                "date": p.created_at.strftime("%d %b %Y, %I:%M %p") if p.created_at else "-",
            }
            for p in payments
        ],
        "refunds": [
            {
                "refund_uid": r.refund_uid,
                "amount": r.amount,
                "reason": r.reason,
                "authorized_by": r.authorized_by,
                "date": r.created_at.strftime("%d %b %Y, %I:%M %p") if r.created_at else "-",
            }
            for r in refunds
        ],
    }
