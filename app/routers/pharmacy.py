import datetime
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
import app.models as models
from app.services.pdf_service import generate_invoice_pdf, build_pdf_filename
from app.security import require_admin

router = APIRouter(prefix="/admin/pharmacy", tags=["Pharmacy & Medicine Inventory"], dependencies=[Depends(require_admin)])


class MedicineCreate(BaseModel):
    code: str
    name: str
    generic_name: Optional[str] = None
    brand: Optional[str] = None
    dosage_form: str = "Tablet"
    strength: str = "500mg"
    reorder_level: int = 20
    selling_price: int = 50
    purchase_price: int = 30
    tax_percent: int = 12


class MedicineUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    generic_name: Optional[str] = None
    brand: Optional[str] = None
    dosage_form: Optional[str] = None
    strength: Optional[str] = None
    reorder_level: Optional[int] = None
    selling_price: Optional[int] = None
    purchase_price: Optional[int] = None
    tax_percent: Optional[int] = None
    is_active: Optional[bool] = None


class BatchUpdate(BaseModel):
    batch_number: Optional[str] = None
    supplier_name: Optional[str] = None
    expiry_date: Optional[str] = None
    quantity_available: Optional[int] = None
    purchase_cost: Optional[int] = None
    selling_price: Optional[int] = None


class GoodsReceiptItem(BaseModel):
    medicine_id: int
    batch_number: str
    supplier_name: str = "AeroHealth Pharma"
    expiry_date: str  # YYYY-MM-DD
    mfg_date: Optional[str] = None
    quantity: int
    purchase_cost: int
    selling_price: int


class GoodsReceiptRequest(BaseModel):
    received_by: str = "Pharmacist"
    invoice_number: Optional[str] = None
    items: List[GoodsReceiptItem]


class DispenseItem(BaseModel):
    batch_id: int
    quantity: int


class DispenseRequest(BaseModel):
    prescription_id: Optional[int] = None
    patient_id: int
    items: List[DispenseItem]
    dispensed_by: str = "Pharmacist"
    create_invoice: bool = True
    collect_payment: bool = True
    payment_method: str = "Cash"  # Cash, UPI, Card, Net Banking
    payment_status: str = "PAID"  # PAID, PENDING
    amount_collected: Optional[float] = None
    transaction_ref: Optional[str] = None


class PrescriptionCancelPayload(BaseModel):
    reason: str
    cancelled_by: Optional[str] = "Pharmacist"


# ----------------------------------------------------
# Metrics & Master Configurations
# ----------------------------------------------------

def compute_pharmacy_stats(db: Session):
    total_meds = db.query(models.Medicine).filter(models.Medicine.is_active == True).count()
    
    total_stock_units = (
        db.query(func.sum(models.MedicineBatch.quantity_available))
        .scalar()
        or 0
    )
    
    today = datetime.date.today()
    ninety_days_ahead = (today + datetime.timedelta(days=90)).strftime("%Y-%m-%d")
    
    expiry_alerts_count = (
        db.query(models.MedicineBatch)
        .filter(
            models.MedicineBatch.quantity_available > 0,
            models.MedicineBatch.expiry_date <= ninety_days_ahead,
        )
        .count()
    )
    
    # Low stock items calculation
    meds = db.query(models.Medicine).filter(models.Medicine.is_active == True).all()
    low_stock_count = 0
    for m in meds:
        tot = (
            db.query(func.sum(models.MedicineBatch.quantity_available))
            .filter(models.MedicineBatch.medicine_id == m.id)
            .scalar()
            or 0
        )
        if tot <= m.reorder_level:
            low_stock_count += 1
            
    total_batches = db.query(models.MedicineBatch).count()

    # 100% backend-calculated prescription fulfillment & dispatch metrics
    dispensed_rx_ids = {
        r[0] for r in db.query(models.DispenseRecord.prescription_id).filter(models.DispenseRecord.prescription_id != None).all()
    }
    all_rxs = db.query(models.Prescription).all()
    pending_dispatch_count = 0
    dispensed_count = 0
    outside_count = 0
    cancelled_count = 0

    for rx in all_rxs:
        is_dispensed = rx.id in dispensed_rx_ids
        # Exclude draft prescriptions from ongoing unfinalized consultations
        if rx.encounter_id and not is_dispensed:
            enc_obj = db.query(models.Consultation).filter(models.Consultation.id == rx.encounter_id).first()
            if enc_obj and not enc_obj.is_finalised:
                continue

        is_cancelled = getattr(rx, "status", "ACTIVE") == "CANCELLED"
        if is_cancelled:
            cancelled_count += 1
            continue

        try:
            rx_meds = json.loads(rx.medicines or "[]")
        except Exception:
            rx_meds = []
        clinic_meds = [m for m in rx_meds if isinstance(m, dict) and (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
        outside_meds = [m for m in rx_meds if isinstance(m, dict) and (m.get("fulfillment") or "").upper() == "OUTSIDE"]

        is_all_outside = bool(outside_meds and not clinic_meds)

        if is_all_outside:
            outside_count += 1
        elif is_dispensed:
            dispensed_count += 1
        else:
            pending_dispatch_count += 1
    
    return {
        "total_medicines": total_meds,
        "total_stock_units": int(total_stock_units),
        "low_stock_count": low_stock_count,
        "expiry_alerts_count": expiry_alerts_count,
        "total_batches": total_batches,
        "pending_dispatch_count": pending_dispatch_count,
        "dispensed_count": dispensed_count,
        "outside_count": outside_count,
        "cancelled_count": cancelled_count,
        "total_prescriptions": len(all_rxs),
    }


@router.get("/stats")
def get_pharmacy_stats(db: Session = Depends(get_db)):
    """Provides server-aggregated KPI metrics for executive dispensary monitoring."""
    return compute_pharmacy_stats(db)


@router.get("/options")
def get_pharmacy_options():
    """Provides master options for dosage forms, suppliers, and movement categories."""
    return {
        "dosage_forms": [
            "Tablet",
            "Capsule",
            "Syrup",
            "Injection",
            "Ointment",
            "Drops",
            "Inhaler",
            "Suspension",
            "Gel",
            "Powder",
        ],
        "stock_statuses": ["ALL", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"],
        "movement_types": ["ALL", "GOODS_RECEIPT", "DISPENSED", "ADJUSTMENT"],
        "suppliers": [
            "AeroHealth Pharma Distributors",
            "Medico Supplies Ltd",
            "Apex Pharma Solutions",
            "Sun Medical Distributors",
        ],
    }


# ----------------------------------------------------
# 1. Medicine Catalogue
# ----------------------------------------------------

@router.get("/medicines")
def list_medicines(
    search: Optional[str] = None,
    dosage_form: Optional[str] = None,
    stock_status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.Medicine).filter(models.Medicine.is_active == True)
    if dosage_form and dosage_form != "ALL":
        query = query.filter(models.Medicine.dosage_form == dosage_form)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (models.Medicine.name.ilike(s))
            | (models.Medicine.generic_name.ilike(s))
            | (models.Medicine.brand.ilike(s))
            | (models.Medicine.code.ilike(s))
        )

    meds = query.order_by(models.Medicine.name.asc()).all()
    results = []

    for m in meds:
        total_stock = (
            db.query(func.sum(models.MedicineBatch.quantity_available))
            .filter(models.MedicineBatch.medicine_id == m.id)
            .scalar()
            or 0
        )
        is_low_stock = total_stock <= m.reorder_level
        status_val = "OUT_OF_STOCK" if total_stock == 0 else "LOW_STOCK" if is_low_stock else "IN_STOCK"

        if stock_status and stock_status != "ALL" and status_val != stock_status:
            continue

        results.append({
            "id": m.id,
            "code": m.code,
            "name": m.name,
            "generic_name": m.generic_name,
            "brand": m.brand,
            "dosage_form": m.dosage_form,
            "strength": m.strength,
            "selling_price": m.selling_price,
            "purchase_price": m.purchase_price,
            "tax_percent": m.tax_percent,
            "reorder_level": m.reorder_level,
            "total_stock": total_stock,
            "is_low_stock": is_low_stock,
            "stock_status": status_val,
        })

    return results


@router.post("/medicines")
def add_medicine(payload: MedicineCreate, db: Session = Depends(get_db)):
    code = payload.code.strip().upper()
    existing = db.query(models.Medicine).filter(models.Medicine.code == code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Medicine code {code} already exists.")

    med = models.Medicine(
        code=code,
        name=payload.name.strip(),
        generic_name=payload.generic_name,
        brand=payload.brand,
        dosage_form=payload.dosage_form,
        strength=payload.strength,
        reorder_level=payload.reorder_level,
        selling_price=payload.selling_price,
        purchase_price=payload.purchase_price,
        tax_percent=payload.tax_percent,
    )
    db.add(med)
    db.commit()
    db.refresh(med)
    return {"message": "Medicine added to catalogue", "id": med.id}


@router.put("/medicines/{medicine_id}")
def update_medicine(medicine_id: int, payload: MedicineUpdate, db: Session = Depends(get_db)):
    """Updates an existing medicine's catalogue specifications, formulation details, and pricing."""
    med = db.query(models.Medicine).filter(models.Medicine.id == medicine_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")

    if payload.code is not None:
        new_code = payload.code.strip().upper()
        if new_code != med.code:
            existing = (
                db.query(models.Medicine)
                .filter(models.Medicine.code == new_code, models.Medicine.id != medicine_id)
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Medicine code {new_code} is already in use by another medicine."
                )
            med.code = new_code

    if payload.name is not None:
        med.name = payload.name.strip()
    if payload.generic_name is not None:
        med.generic_name = payload.generic_name.strip() if payload.generic_name else None
    if payload.brand is not None:
        med.brand = payload.brand.strip() if payload.brand else None
    if payload.dosage_form is not None:
        med.dosage_form = payload.dosage_form
    if payload.strength is not None:
        med.strength = payload.strength.strip()
    if payload.reorder_level is not None:
        med.reorder_level = payload.reorder_level
    if payload.selling_price is not None:
        med.selling_price = payload.selling_price
    if payload.purchase_price is not None:
        med.purchase_price = payload.purchase_price
    if payload.tax_percent is not None:
        med.tax_percent = payload.tax_percent
    if payload.is_active is not None:
        med.is_active = payload.is_active

    db.commit()
    db.refresh(med)
    return {
        "message": "Medicine updated successfully",
        "id": med.id,
        "code": med.code,
        "name": med.name,
    }


# ----------------------------------------------------
# 2. Batch Inventory & Goods Receipt
# ----------------------------------------------------

@router.get("/batches")
def list_batches(
    medicine_id: Optional[int] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.MedicineBatch).join(models.Medicine)
    if medicine_id:
        query = query.filter(models.MedicineBatch.medicine_id == medicine_id)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (models.MedicineBatch.batch_number.ilike(s))
            | (models.MedicineBatch.supplier_name.ilike(s))
            | (models.Medicine.name.ilike(s))
            | (models.Medicine.code.ilike(s))
        )

    batches = query.order_by(models.MedicineBatch.expiry_date.asc()).all()
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")
    ninety_days_ahead = (today + datetime.timedelta(days=90)).strftime("%Y-%m-%d")
    results = []

    for b in batches:
        is_expired = b.expiry_date < today_str
        is_near_expiry = not is_expired and b.expiry_date <= ninety_days_ahead
        batch_status = "EXPIRED" if is_expired else "EXPIRING_SOON" if is_near_expiry else "ACTIVE"

        if status and status != "ALL" and batch_status != status:
            continue

        results.append({
            "id": b.id,
            "medicine_id": b.medicine_id,
            "medicine_name": b.medicine.name if b.medicine else "Drug Item",
            "medicine_code": b.medicine.code if b.medicine else "-",
            "batch_number": b.batch_number,
            "supplier_name": b.supplier_name,
            "expiry_date": b.expiry_date,
            "is_expired": is_expired,
            "is_near_expiry": is_near_expiry,
            "quantity_available": b.quantity_available,
            "purchase_cost": b.purchase_cost,
            "selling_price": b.selling_price,
            "status": batch_status,
        })
    return results


@router.put("/batches/{batch_id}")
def update_batch(batch_id: int, payload: BatchUpdate, db: Session = Depends(get_db)):
    """Updates batch details or performs manual stock count adjustments."""
    batch = db.query(models.MedicineBatch).filter(models.MedicineBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if payload.batch_number is not None:
        batch.batch_number = payload.batch_number.strip().upper()
    if payload.supplier_name is not None:
        batch.supplier_name = payload.supplier_name.strip()
    if payload.expiry_date is not None:
        batch.expiry_date = payload.expiry_date.strip()
    if payload.purchase_cost is not None:
        batch.purchase_cost = payload.purchase_cost
    if payload.selling_price is not None:
        batch.selling_price = payload.selling_price

    if payload.quantity_available is not None and payload.quantity_available != batch.quantity_available:
        diff = payload.quantity_available - batch.quantity_available
        old_qty = batch.quantity_available
        batch.quantity_available = payload.quantity_available
        txn = models.InventoryTransaction(
            medicine_id=batch.medicine_id,
            batch_id=batch.id,
            transaction_type="ADJUSTMENT",
            quantity=diff,
            reason=f"Manual Stock Adjustment (Count adjusted from {old_qty} to {payload.quantity_available})",
            performed_by="Pharmacist",
            created_at=datetime.datetime.utcnow(),
        )
        db.add(txn)

    db.commit()
    db.refresh(batch)
    return {
        "message": "Batch updated successfully",
        "id": batch.id,
        "batch_number": batch.batch_number,
    }


@router.post("/batches/goods-receipt")
def record_goods_receipt(payload: GoodsReceiptRequest, db: Session = Depends(get_db)):
    """Receives stock from pharmaceutical suppliers and creates an immutable audit trail."""
    created_batches = []
    for item in payload.items:
        med = db.query(models.Medicine).filter(models.Medicine.id == item.medicine_id).first()
        if not med:
            continue

        batch = models.MedicineBatch(
            medicine_id=med.id,
            batch_number=item.batch_number.strip().upper(),
            supplier_name=item.supplier_name,
            expiry_date=item.expiry_date,
            mfg_date=item.mfg_date,
            quantity_received=item.quantity,
            quantity_available=item.quantity,
            purchase_cost=item.purchase_cost,
            selling_price=item.selling_price,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(batch)
        db.commit()
        db.refresh(batch)

        txn = models.InventoryTransaction(
            medicine_id=med.id,
            batch_id=batch.id,
            transaction_type="GOODS_RECEIPT",
            quantity=item.quantity,
            reason=f"Supplier Goods Receipt (Inv #{payload.invoice_number or 'GRN'})",
            performed_by=payload.received_by,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(txn)
        created_batches.append(batch.id)

    db.commit()
    return {"message": f"Successfully received {len(created_batches)} batches into dispensary inventory."}


# ----------------------------------------------------
# 3. Prescription Dispensing (Atomic Stock Decrement)
# ----------------------------------------------------

@router.get("/prescriptions")
def list_pharmacy_prescriptions(
    patient_id: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Returns clinical prescriptions with medication lines and dispensing fulfillment status
    for the pharmacy counter, with 100% backend-calculated metrics, search, date filtering,
    and sorting (latest dispensed prescriptions appear on top).
    """
    query = db.query(models.Prescription).order_by(models.Prescription.created_at.desc())
    if patient_id:
        query = query.filter(models.Prescription.patient_id == patient_id)

    rx_list = query.limit(300).all()
    results = []
    for rx in rx_list:
        dispense_record = (
            db.query(models.DispenseRecord)
            .filter(models.DispenseRecord.prescription_id == rx.id)
            .order_by(models.DispenseRecord.created_at.desc())
            .first()
        )
        dispense_exists = dispense_record is not None
        dispensed_at_raw = dispense_record.created_at if dispense_record else None

        dispensed_ist = (
            (dispense_record.created_at + datetime.timedelta(hours=5, minutes=30))
            if (dispense_record and dispense_record.created_at)
            else None
        )
        dispensed_at_str = (
            dispensed_ist.strftime("%d %b %Y, %I:%M %p")
            if dispensed_ist
            else None
        )
        dispensed_date_str = (
            dispensed_ist.strftime("%Y-%m-%d")
            if dispensed_ist
            else None
        )

        rx_created_ist = (
            (rx.created_at + datetime.timedelta(hours=5, minutes=30))
            if rx.created_at
            else None
        )
        rx_created_str = (
            rx_created_ist.strftime("%d %b %Y, %I:%M %p")
            if rx_created_ist
            else "-"
        )
        rx_date_str = (
            rx_created_ist.strftime("%Y-%m-%d")
            if rx_created_ist
            else None
        )

        try:
            meds = json.loads(rx.medicines or "[]")
        except Exception:
            meds = []

        clinic_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "CLINIC").upper() == "CLINIC"]
        outside_meds = [m for m in meds if isinstance(m, dict) and (m.get("fulfillment") or "").upper() == "OUTSIDE"]

        if clinic_meds and outside_meds:
            fulfillment_type = "HYBRID"
        elif outside_meds and not clinic_meds:
            fulfillment_type = "OUTSIDE"
        else:
            fulfillment_type = "CLINIC"

        # Exclude draft prescriptions from ongoing unfinalized consultations
        if rx.encounter_id and not dispense_exists:
            enc_obj = db.query(models.Consultation).filter(models.Consultation.id == rx.encounter_id).first()
            if enc_obj and not enc_obj.is_finalised:
                continue

        is_cancelled = getattr(rx, "status", "ACTIVE") == "CANCELLED"
        if is_cancelled:
            dispense_status = "CANCELLED"
        elif fulfillment_type == "OUTSIDE":
            dispense_status = "OUTSIDE"
        elif dispense_exists:
            dispense_status = "DISPENSED"
        else:
            dispense_status = "PENDING"

        if status and status.upper() == "PENDING" and (fulfillment_type == "OUTSIDE" or dispense_status != "PENDING"):
            continue
        elif status and status.upper() == "DISPENSED" and dispense_status != "DISPENSED":
            continue
        elif status and status.upper() == "OUTSIDE" and dispense_status != "OUTSIDE":
            continue
        elif status and status.upper() == "CANCELLED" and dispense_status != "CANCELLED":
            continue
        elif status and status.upper() not in ["ALL", "PENDING", "DISPENSED", "OUTSIDE", "CANCELLED"] and dispense_status != status.upper():
            continue

        # 100% backend-calculated date filter
        if date and date.strip() and date.strip().lower() != "all":
            d_val = date.strip().lower()
            today_str = datetime.date.today().strftime("%Y-%m-%d")
            yesterday_str = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
            target_date = today_str if d_val == "today" else yesterday_str if d_val == "yesterday" else date.strip()

            if dispense_status == "DISPENSED":
                # Dispensed records filter by the date they were dispensed
                if dispensed_date_str != target_date:
                    continue
            else:
                # Pending records filter by the date prescription was written
                if rx_date_str != target_date:
                    continue

        # 100% backend-calculated search filter across patient, doctor, diagnosis, and medicine items
        if search and search.strip():
            sf = search.strip().lower()
            pt_name = (rx.patient.name or "").lower() if rx.patient else ""
            pt_phone = (rx.patient.phone or "").lower() if rx.patient else ""
            doc_name = (rx.doctor.name or "").lower() if rx.doctor else ""
            diag = (rx.diagnosis or "").lower()
            uid = (rx.prescription_uid or f"#rx-{rx.id}").lower()
            med_match = any(sf in (m.get("name") or "").lower() for m in meds if isinstance(m, dict))
            if not (sf in pt_name or sf in pt_phone or sf in doc_name or sf in diag or sf in uid or med_match):
                continue

        inv_data = None
        if dispense_record and dispense_record.invoice_id:
            inv = db.query(models.Invoice).filter(models.Invoice.id == dispense_record.invoice_id).first()
            if inv:
                inv_data = {
                    "id": inv.id,
                    "invoice_number": inv.invoice_number,
                    "total": inv.total or 0,
                    "amount_paid": inv.amount_paid or 0,
                    "balance_due": inv.balance_due or 0,
                    "payment_status": inv.payment_status or "PENDING",
                    "payment_method": inv.payment_method or "Cash",
                }
        if not inv_data and rx.id:
            inv_match = db.query(models.Invoice).filter(
                models.Invoice.patient_id == rx.patient_id,
                models.Invoice.notes.ilike(f"%#{rx.id}%")
            ).order_by(models.Invoice.id.desc()).first()
            if inv_match:
                inv_data = {
                    "id": inv_match.id,
                    "invoice_number": inv_match.invoice_number,
                    "total": inv_match.total or 0,
                    "amount_paid": inv_match.amount_paid or 0,
                    "balance_due": inv_match.balance_due or 0,
                    "payment_status": inv_match.payment_status or "PENDING",
                    "payment_method": inv_match.payment_method or "Cash",
                }

        results.append({
            "id": rx.id,
            "prescription_uid": rx.prescription_uid or f"#RX-{rx.id}",
            "encounter_id": rx.encounter_id,
            "patient_id": rx.patient_id,
            "patient_name": rx.patient.name if rx.patient else "Patient",
            "patient_phone": rx.patient.phone if rx.patient else "-",
            "doctor_name": rx.doctor.name if rx.doctor else "Doctor",
            "diagnosis": rx.diagnosis,
            "medicines": meds,
            "fulfillment_type": fulfillment_type,
            "clinic_meds_count": len(clinic_meds),
            "outside_meds_count": len(outside_meds),
            "clinic_meds": clinic_meds,
            "outside_meds": outside_meds,
            "is_dispensed": dispense_exists,
            "is_cancelled": is_cancelled,
            "cancellation_reason": getattr(rx, "cancellation_reason", None),
            "cancelled_at": rx.cancelled_at.strftime("%d %b %Y, %I:%M %p") if getattr(rx, "cancelled_at", None) else None,
            "cancelled_by": getattr(rx, "cancelled_by", None),
            "status": dispense_status,
            "invoice": inv_data,
            "dispensed_at": dispensed_at_str,
            "dispensed_date": dispensed_date_str,
            "dispensed_by": dispense_record.dispensed_by if dispense_record else None,
            "created_at": rx_created_str,
            "created_date": rx_date_str,
            "dispensed_at_raw": dispensed_at_raw,
            "created_at_raw": rx.created_at,
        })

    # Sort logic: latest dispense always on top for DISPENSED tab; latest created for PENDING
    if status and status.upper() == "DISPENSED":
        results.sort(
            key=lambda x: (
                x.get("dispensed_at_raw") or datetime.datetime.min,
                x.get("created_at_raw") or datetime.datetime.min,
                x.get("id") or 0,
            ),
            reverse=True,
        )
    else:
        results.sort(
            key=lambda x: (
                x.get("created_at_raw") or datetime.datetime.min,
                x.get("id") or 0,
            ),
            reverse=True,
        )

    # Clean raw datetime objects before returning JSON
    for r in results:
        r.pop("dispensed_at_raw", None)
        r.pop("created_at_raw", None)

    return results


@router.post("/dispense")
def dispense_prescription(payload: DispenseRequest, db: Session = Depends(get_db)):
    """Dispenses medicines, decrementing batch stock atomically and preventing negative inventory."""
    patient = db.query(models.Patient).filter(models.Patient.id == payload.patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if payload.prescription_id:
        rx_record = db.query(models.Prescription).filter(models.Prescription.id == payload.prescription_id).first()
        if rx_record and rx_record.encounter_id:
            enc_record = db.query(models.Consultation).filter(models.Consultation.id == rx_record.encounter_id).first()
            if enc_record and not enc_record.is_finalised:
                raise HTTPException(
                    status_code=400,
                    detail="Clinical Governance Rule: Cannot dispense medicines for an unfinalized consultation. The doctor must sign and finalize the consultation encounter first."
                )

    if not payload.items:
        raise HTTPException(status_code=400, detail="No medicines provided for dispense")

    dispensed_records = []
    created_dispense_objs = []
    invoice_items = []
    total_invoice_amount = 0
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    try:
        for item in payload.items:
            batch = db.query(models.MedicineBatch).filter(models.MedicineBatch.id == item.batch_id).first()
            if not batch:
                raise HTTPException(status_code=404, detail=f"Batch ID {item.batch_id} not found.")

            # Guard against expired stock dispensing
            if batch.expiry_date < today_str:
                raise HTTPException(
                    status_code=400,
                    detail=f"Batch {batch.batch_number} expired on {batch.expiry_date}. Expired stock cannot be dispensed.",
                )

            # Guard against insufficient inventory (No negative stock)
            if batch.quantity_available < item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient stock for batch {batch.batch_number}. Requested: {item.quantity}, Available: {batch.quantity_available}.",
                )

            # Atomic decrement
            batch.quantity_available -= item.quantity

            dispense_rec = models.DispenseRecord(
                prescription_id=payload.prescription_id,
                patient_id=patient.id,
                medicine_id=batch.medicine_id,
                batch_id=batch.id,
                quantity_dispensed=item.quantity,
                dispensed_by=payload.dispensed_by,
                created_at=datetime.datetime.utcnow(),
            )
            db.add(dispense_rec)
            created_dispense_objs.append(dispense_rec)

            txn = models.InventoryTransaction(
                medicine_id=batch.medicine_id,
                batch_id=batch.id,
                transaction_type="DISPENSED",
                quantity=-item.quantity,
                reason=f"Dispensed to Patient {patient.name} (Rx #{payload.prescription_id or 'Walk-in'})",
                performed_by=payload.dispensed_by,
                created_at=datetime.datetime.utcnow(),
            )
            db.add(txn)
            med_name = batch.medicine.name if batch.medicine else "Medicine"
            unit_price = batch.selling_price if batch.selling_price else (batch.medicine.selling_price if batch.medicine else 50)
            dispensed_records.append(med_name)

            invoice_items.append({
                "description": f"Pharmacy: {med_name} ({batch.batch_number})",
                "quantity": item.quantity,
                "unit_price": unit_price,
                "total": item.quantity * unit_price,
            })
            total_invoice_amount += item.quantity * unit_price

        created_inv_id = None
        created_inv_num = None
        amount_to_pay = 0.0
        balance = float(total_invoice_amount)
        final_status = "PENDING"

        should_create_inv = payload.create_invoice or payload.collect_payment
        if should_create_inv and invoice_items:
            year = datetime.date.today().year
            highest = db.query(models.Invoice).order_by(models.Invoice.id.desc()).first()
            next_num = (highest.id + 1) if highest else 1
            while db.query(models.Invoice).filter(models.Invoice.invoice_number == f"INV-{year}-{next_num:04d}").first():
                next_num += 1
            created_inv_num = f"INV-{year}-{next_num:04d}"

            is_paid = (payload.payment_status or "PAID").upper() == "PAID"
            amount_to_pay = (
                float(payload.amount_collected)
                if (payload.amount_collected is not None and payload.amount_collected >= 0)
                else (float(total_invoice_amount) if is_paid else 0.0)
            )
            balance = max(0.0, float(total_invoice_amount) - amount_to_pay)
            final_status = "PAID" if balance == 0 and amount_to_pay > 0 else "PARTIALLY_PAID" if amount_to_pay > 0 else "PENDING"

            inv = models.Invoice(
                invoice_number=created_inv_num,
                patient_id=patient.id,
                items=json.dumps(invoice_items),
                subtotal=total_invoice_amount,
                total=total_invoice_amount,
                amount_paid=amount_to_pay,
                balance_due=balance,
                payment_method=payload.payment_method or "Cash",
                payment_status=final_status,
                notes=f"Pharmacy dispense for Rx #{payload.prescription_id or 'Walk-in'}",
                created_at=datetime.datetime.utcnow(),
            )
            db.add(inv)
            db.commit()
            db.refresh(inv)
            created_inv_id = inv.id

            if amount_to_pay > 0:
                highest_pay = db.query(models.Payment).order_by(models.Payment.id.desc()).first()
                pay_next = (highest_pay.id + 1) if highest_pay else 1
                while db.query(models.Payment).filter(models.Payment.payment_uid == f"PAY-{year}-{pay_next:04d}").first():
                    pay_next += 1
                pay_uid = f"PAY-{year}-{pay_next:04d}"
                payment_record = models.Payment(
                    payment_uid=pay_uid,
                    invoice_id=inv.id,
                    amount=amount_to_pay,
                    payment_method=payload.payment_method or "Cash",
                    transaction_ref=payload.transaction_ref or "",
                    received_by=payload.dispensed_by or "Pharmacist",
                    notes="Payment collected at Pharmacy Dispensary counter",
                    created_at=datetime.datetime.utcnow(),
                )
                db.add(payment_record)
                db.commit()

            for d_obj in created_dispense_objs:
                d_obj.invoice_id = inv.id

        db.commit()

        return {
            "message": f"Successfully dispensed {len(dispensed_records)} items to {patient.name}.",
            "patient": patient.name,
            "items_dispensed": dispensed_records,
            "invoice_id": created_inv_id,
            "invoice_number": created_inv_num,
            "total_amount": total_invoice_amount,
            "amount_paid": amount_to_pay,
            "balance_due": balance,
            "payment_status": final_status,
            "payment_method": payload.payment_method or "Cash",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Dispensing failed: {str(exc)}")


@router.post("/prescriptions/{rx_id}/send-to-frontdesk-billing")
def send_prescription_to_frontdesk_billing(
    rx_id: int,
    db: Session = Depends(get_db),
):
    rx = db.query(models.Prescription).filter(models.Prescription.id == rx_id).first()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")

    if getattr(rx, "status", None) == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot bill a cancelled prescription.")

    patient = db.query(models.Patient).filter(models.Patient.id == rx.patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found")

    # Check if an active invoice already exists for this prescription
    existing_inv = db.query(models.Invoice).filter(
        models.Invoice.patient_id == rx.patient_id,
        models.Invoice.notes.ilike(f"%#{rx.id}%")
    ).order_by(models.Invoice.id.desc()).first()

    if existing_inv and existing_inv.payment_status in ["PAID", "PENDING", "PARTIALLY_PAID"]:
        return {
            "message": f"Invoice {existing_inv.invoice_number} is already active at Front Desk.",
            "invoice_id": existing_inv.id,
            "invoice_number": existing_inv.invoice_number,
            "total_amount": existing_inv.total,
            "payment_status": existing_inv.payment_status,
        }

    # Parse prescribed medicines to build invoice items
    try:
        meds = json.loads(rx.medicines or "[]")
    except Exception:
        meds = []

    invoice_items = []
    total_amount = 0.0

    for m in meds:
        if not isinstance(m, dict):
            continue
        fulfillment = (m.get("fulfillment") or "CLINIC").upper()
        if fulfillment != "CLINIC":
            continue

        name = m.get("name", "Medicine")
        qty = int(m.get("quantity") or 10)
        # Match price in Medicine catalogue
        med_match = db.query(models.Medicine).filter(
            func.lower(models.Medicine.name) == func.lower(name)
        ).first()
        if not med_match:
            med_match = db.query(models.Medicine).filter(
                models.Medicine.name.ilike(f"%{name[:8]}%")
            ).first()

        unit_price = float(med_match.selling_price) if med_match else 50.0
        item_total = qty * unit_price
        total_amount += item_total
        invoice_items.append({
            "item_id": med_match.id if med_match else None,
            "description": f"{name} ({m.get('dosage') or 'As directed'})",
            "quantity": qty,
            "unit_price": unit_price,
            "total": item_total,
        })

    if not invoice_items:
        invoice_items.append({
            "item_id": None,
            "description": f"Prescription Medications (Rx #{rx.prescription_uid or rx.id})",
            "quantity": 1,
            "unit_price": 100.0,
            "total": 100.0,
        })
        total_amount = 100.0

    year = datetime.date.today().year
    highest = db.query(models.Invoice).order_by(models.Invoice.id.desc()).first()
    next_num = (highest.id + 1) if highest else 1
    while db.query(models.Invoice).filter(models.Invoice.invoice_number == f"INV-{year}-{next_num:04d}").first():
        next_num += 1
    created_inv_num = f"INV-{year}-{next_num:04d}"

    inv = models.Invoice(
        invoice_number=created_inv_num,
        patient_id=patient.id,
        items=json.dumps(invoice_items),
        subtotal=total_amount,
        total=total_amount,
        amount_paid=0.0,
        balance_due=total_amount,
        payment_method="Front Desk (Pending)",
        payment_status="PENDING",
        notes=f"Pharmacy dispense for Rx #{rx.id} ({rx.prescription_uid or ''}) - Forwarded to Front Desk for Billing",
        created_at=datetime.datetime.utcnow(),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    return {
        "message": f"Prescription {rx.prescription_uid or f'#{rx.id}'} successfully forwarded to Front Desk for billing. Invoice #{inv.invoice_number} created.",
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "total_amount": total_amount,
        "payment_status": "PENDING",
    }


@router.post("/prescriptions/{rx_id}/cancel")
def cancel_prescription_dispatch(
    rx_id: int,
    payload: PrescriptionCancelPayload,
    db: Session = Depends(get_db),
):
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Cancellation reason is mandatory and required.")

    rx = db.query(models.Prescription).filter(models.Prescription.id == rx_id).first()
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")

    # Check if already dispensed
    dispense_record = db.query(models.DispenseRecord).filter(models.DispenseRecord.prescription_id == rx_id).first()
    if dispense_record:
        raise HTTPException(status_code=400, detail="Cannot cancel a prescription that has already been physically dispensed.")

    clean_reason = payload.reason.strip()
    rx.status = "CANCELLED"
    rx.cancellation_reason = clean_reason
    rx.cancelled_at = datetime.datetime.utcnow()
    rx.cancelled_by = payload.cancelled_by or "Pharmacist"

    # If an unpaid invoice was generated, mark it cancelled
    pending_invoices = db.query(models.Invoice).filter(
        models.Invoice.patient_id == rx.patient_id,
        models.Invoice.notes.ilike(f"%#{rx.id}%"),
        models.Invoice.payment_status == "PENDING"
    ).all()
    for inv in pending_invoices:
        inv.payment_status = "CANCELLED"
        inv.notes = f"{inv.notes} | CANCELLED: {clean_reason}"

    db.commit()

    return {
        "message": f"Prescription {rx.prescription_uid or f'#{rx.id}'} has been cancelled successfully.",
        "prescription_id": rx.id,
        "prescription_uid": rx.prescription_uid,
        "cancellation_reason": clean_reason,
        "status": "CANCELLED",
    }


# ----------------------------------------------------
# 4. Inventory Audit Log & Alerts
# ----------------------------------------------------

@router.get("/transactions")
def list_transactions(
    search: Optional[str] = None,
    transaction_type: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = (
        db.query(models.InventoryTransaction)
        .outerjoin(models.Medicine, models.InventoryTransaction.medicine_id == models.Medicine.id)
        .outerjoin(models.MedicineBatch, models.InventoryTransaction.batch_id == models.MedicineBatch.id)
    )

    if transaction_type and transaction_type != "ALL":
        query = query.filter(models.InventoryTransaction.transaction_type == transaction_type)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (models.Medicine.name.ilike(s))
            | (models.Medicine.code.ilike(s))
            | (models.MedicineBatch.batch_number.ilike(s))
            | (models.InventoryTransaction.performed_by.ilike(s))
            | (models.InventoryTransaction.reason.ilike(s))
        )

    txns = (
        query.order_by(models.InventoryTransaction.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": t.id,
            "medicine_name": t.medicine.name if t.medicine else "-",
            "medicine_code": t.medicine.code if t.medicine else "-",
            "batch_number": t.batch.batch_number if t.batch else "-",
            "transaction_type": t.transaction_type,
            "quantity": t.quantity,
            "reason": t.reason,
            "performed_by": t.performed_by,
            "created_at": t.created_at.strftime("%d %b %Y, %I:%M %p") if t.created_at else "-",
        }
        for t in txns
    ]


@router.get("/alerts")
def get_inventory_alerts(db: Session = Depends(get_db)):
    """Computes low-stock alerts and near-expiry (< 90 days) batches."""
    today = datetime.date.today()
    ninety_days_ahead = (today + datetime.timedelta(days=90)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")

    # Near-expiry batches
    near_expiry_batches = (
        db.query(models.MedicineBatch)
        .filter(
            models.MedicineBatch.quantity_available > 0,
            models.MedicineBatch.expiry_date <= ninety_days_ahead,
        )
        .all()
    )

    expiry_alerts = [
        {
            "id": b.id,
            "medicine_name": b.medicine.name if b.medicine else "-",
            "batch_number": b.batch_number,
            "expiry_date": b.expiry_date,
            "quantity_available": b.quantity_available,
            "status": "EXPIRED" if b.expiry_date < today_str else "EXPIRING_SOON",
        }
        for b in near_expiry_batches
    ]

    # Low stock items
    meds = db.query(models.Medicine).filter(models.Medicine.is_active == True).all()
    low_stock_alerts = []
    for m in meds:
        tot = (
            db.query(func.sum(models.MedicineBatch.quantity_available))
            .filter(models.MedicineBatch.medicine_id == m.id)
            .scalar()
            or 0
        )
        if tot <= m.reorder_level:
            low_stock_alerts.append({
                "id": m.id,
                "name": m.name,
                "code": m.code,
                "total_stock": tot,
                "reorder_level": m.reorder_level,
            })

    return {
        "low_stock_count": len(low_stock_alerts),
        "expiry_alerts_count": len(expiry_alerts),
        "low_stock": low_stock_alerts,
        "expiry_alerts": expiry_alerts,
    }


@router.get("/invoices/{invoice_id}/pdf")
def get_pharmacy_invoice_pdf(invoice_id: int, download: bool = False, db: Session = Depends(get_db)):
    """Generate and return an official Dispensary / Pharmacy Invoice PDF streamed directly from backend settings."""
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    patient = db.query(models.Patient).filter(models.Patient.id == inv.patient_id).first()
    pdf_bytes = generate_invoice_pdf(inv, patient)
    patient_name = patient.name if patient else "Patient"
    filename = build_pdf_filename(patient_name, "Pharma", inv.invoice_number)
    disposition = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )
