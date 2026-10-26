import json
import datetime
from typing import Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.security import require_admin
import app.models as models
from app.models import Appointment, Invoice, Prescription, Patient, Doctor, WhatsAppMessage, DispenseRecord, LabOrder

router = APIRouter(prefix="/admin/analytics", tags=["Clinic Analytics"], dependencies=[Depends(require_admin)])


@router.get("")
def get_clinic_analytics(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """100% backend-calculated financial, clinical, operational, and patient intelligence metrics."""
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")

    # 1. Master Financial Overview & Receivables
    total_revenue = db.query(func.sum(Invoice.amount_paid)).scalar() or 0
    total_invoiced = db.query(func.sum(Invoice.total)).scalar() or 0
    pending_dues = db.query(func.sum(Invoice.balance_due)).scalar() or 0
    if total_revenue == 0 and total_invoiced > 0:
        total_revenue = db.query(func.sum(Invoice.total)).filter(Invoice.payment_status == "PAID").scalar() or 0

    all_paid_invs = db.query(Invoice).filter(Invoice.payment_status.in_(["PAID", "PARTIALLY_PAID"])).all()
    today_revenue = sum(
        float(inv.amount_paid or inv.total) for inv in all_paid_invs
        if inv.created_at and inv.created_at.strftime("%Y-%m-%d") == today_str
    )
    collection_rate = round((total_revenue / total_invoiced * 100), 1) if total_invoiced > 0 else 100.0

    # 2. Payment Method Distribution with Percentage Share
    payment_methods_raw = (
        db.query(Invoice.payment_method, func.sum(Invoice.amount_paid), func.count(Invoice.id))
        .filter(Invoice.payment_status.in_(["PAID", "PARTIALLY_PAID"]))
        .group_by(Invoice.payment_method)
        .all()
    )
    payment_distribution = []
    for m in payment_methods_raw:
        m_name = m[0] or "Cash"
        m_rev = float(m[1] or 0)
        m_count = m[2] or 0
        share_pct = round((m_rev / total_revenue * 100), 1) if total_revenue > 0 else 0.0
        payment_distribution.append({
            "method": m_name,
            "revenue": round(m_rev),
            "count": m_count,
            "percentage": share_pct,
        })

    # 3. Multi-Department Revenue Stream Breakdown (OPD vs Pharmacy vs Laboratory)
    all_invs = db.query(Invoice).all()
    opd_rev = 0.0
    pharma_rev = 0.0
    lab_rev = 0.0

    for inv in all_invs:
        inv_paid = float(inv.amount_paid or (inv.total if inv.payment_status == "PAID" else 0))
        if not inv_paid:
            continue
        notes = (inv.notes or "").lower()
        items_raw = inv.items or "[]"
        try:
            items = json.loads(items_raw)
        except Exception:
            items = []

        has_lab = "lab" in notes or any(it.get("category") == "Laboratory" for it in items if isinstance(it, dict))
        has_pharma = (
            "rx" in notes
            or "dispens" in notes
            or "pharmacy" in notes
            or any("med" in (it.get("name") or "").lower() or "mg" in (it.get("name") or "").lower() for it in items if isinstance(it, dict))
        )

        if has_lab and not has_pharma:
            lab_rev += inv_paid
        elif has_pharma and not has_lab:
            pharma_rev += inv_paid
        elif has_lab and has_pharma:
            lab_rev += inv_paid / 2
            pharma_rev += inv_paid / 2
        else:
            opd_rev += inv_paid

    total_stream_rev = max(1.0, opd_rev + pharma_rev + lab_rev)
    department_streams = [
        {
            "id": "opd",
            "name": "OPD Consultations",
            "revenue": round(opd_rev),
            "percentage": round((opd_rev / total_stream_rev) * 100, 1),
            "color": "blue",
            "count": db.query(Appointment).filter(Appointment.status == "COMPLETED").count(),
            "count_label": "Visits Completed",
        },
        {
            "id": "pharma",
            "name": "Pharmacy Dispensary",
            "revenue": round(pharma_rev),
            "percentage": round((pharma_rev / total_stream_rev) * 100, 1),
            "color": "purple",
            "count": db.query(DispenseRecord).count(),
            "count_label": "Medications Dispensed",
        },
        {
            "id": "lab",
            "name": "Laboratory & Diagnostics",
            "revenue": round(lab_rev),
            "percentage": round((lab_rev / total_stream_rev) * 100, 1),
            "color": "teal",
            "count": db.query(LabOrder).count(),
            "count_label": "Diagnostic Panels Run",
        },
    ]

    # 4. 7-Day Visual Revenue Trend Array (With Peak Day & Transaction Counts)
    days_range = [(today - datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]
    revenue_trend = []
    for d in days_range:
        day_invs = [
            inv for inv in all_paid_invs
            if inv.created_at and inv.created_at.strftime("%Y-%m-%d") == d
        ]
        day_total = sum(float(inv.amount_paid or inv.total) for inv in day_invs)
        revenue_trend.append({
            "date": d,
            "display": datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%a"),
            "full_date": datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%d %b"),
            "revenue": round(day_total),
            "count": len(day_invs),
        })

    max_day_rev = max((t["revenue"] for t in revenue_trend), default=0)
    peak_date_str = None
    for t in revenue_trend:
        t["percentage"] = round((t["revenue"] / max_day_rev) * 100) if max_day_rev > 0 else 0
        t["is_peak"] = (t["revenue"] == max_day_rev and t["revenue"] > 0)
        if t["is_peak"]:
            peak_date_str = f"{t['full_date']} (₹{t['revenue']:,})"

    # 5. Doctor Clinical Output & Revenue Yield Matrix
    doctors = db.query(Doctor).filter(Doctor.is_active == True).all()
    doctor_perf = []
    for doc in doctors:
        appts = db.query(Appointment).filter(Appointment.doctor_id == doc.id).all()
        appts_count = len(appts)
        completed_count = sum(1 for a in appts if a.status == "COMPLETED")
        rx_count = db.query(Prescription).filter(Prescription.doctor_id == doc.id).count()
        doc_revenue = sum(float(a.paid_amount or doc.consultation_fee) for a in appts if a.status == "COMPLETED")
        completion_rate = round((completed_count / appts_count * 100), 1) if appts_count > 0 else 0.0
        rx_rate = round((rx_count / completed_count * 100), 1) if completed_count > 0 else 0.0

        doctor_perf.append({
            "id": doc.id,
            "name": doc.name,
            "specialization": doc.specialization,
            "total_appointments": appts_count,
            "completed_appointments": completed_count,
            "completion_rate": completion_rate,
            "prescriptions_written": rx_count,
            "rx_conversion_rate": rx_rate,
            "revenue_generated": round(doc_revenue),
        })

    # 6. Patient Loyalty, Retention & Conversion Funnel
    total_patients = db.query(Patient).count()
    multi_appt_patients = (
        db.query(Appointment.patient_id)
        .group_by(Appointment.patient_id)
        .having(func.count(Appointment.id) > 1)
        .count()
    )
    retention_rate = round((multi_appt_patients / total_patients * 100), 1) if total_patients > 0 else 0.0

    total_appts = db.query(Appointment).count()
    whatsapp_appts = db.query(Appointment).filter(func.lower(Appointment.source) == "whatsapp").count()
    reception_appts = db.query(Appointment).filter(func.lower(Appointment.source) != "whatsapp").count()
    whatsapp_pct = round((whatsapp_appts / total_appts * 100), 1) if total_appts > 0 else 0.0

    # Clinic Conversion Funnel
    checked_in_count = db.query(Appointment).filter(Appointment.status.in_(["IN_CONSULTATION", "COMPLETED"])).count()
    completed_appts_count = db.query(Appointment).filter(Appointment.status == "COMPLETED").count()
    prescriptions_total = db.query(Prescription).count()
    invoiced_total = db.query(Invoice).count()

    conversion_funnel = [
        {"stage": "1. Bookings Received", "count": total_appts, "percentage": 100.0, "color": "blue"},
        {"stage": "2. Checked In to OPD", "count": checked_in_count, "percentage": round((checked_in_count / total_appts * 100), 1) if total_appts > 0 else 0, "color": "teal"},
        {"stage": "3. Consultations Completed", "count": completed_appts_count, "percentage": round((completed_appts_count / total_appts * 100), 1) if total_appts > 0 else 0, "color": "emerald"},
        {"stage": "4. Prescriptions Issued", "count": prescriptions_total, "percentage": round((prescriptions_total / total_appts * 100), 1) if total_appts > 0 else 0, "color": "purple"},
        {"stage": "5. Invoices Billed", "count": invoiced_total, "percentage": round((invoiced_total / total_appts * 100), 1) if total_appts > 0 else 0, "color": "sky"},
    ]

    # 7. WhatsApp Messaging Activity
    total_messages = db.query(WhatsAppMessage).count()
    patient_inbound = db.query(WhatsAppMessage).filter(WhatsAppMessage.sender == "patient").count()
    bot_replies = db.query(WhatsAppMessage).filter(WhatsAppMessage.sender == "bot").count()
    clinic_replies = db.query(WhatsAppMessage).filter(WhatsAppMessage.sender == "clinic").count()

    return {
        "financial": {
            "total_revenue": round(total_revenue),
            "today_revenue": round(today_revenue),
            "total_invoiced": round(total_invoiced),
            "pending_dues": round(pending_dues),
            "collection_rate": collection_rate,
            "average_bill": round(total_revenue / len(all_paid_invs)) if all_paid_invs else 0,
            "paid_invoices_count": len(all_paid_invs),
            "pending_invoices_count": db.query(Invoice).filter(Invoice.balance_due > 0).count(),
            "department_streams": department_streams,
            "payment_distribution": payment_distribution,
            "revenue_trend": revenue_trend,
            "peak_day": peak_date_str or "Today",
        },
        "operations": {
            "total_appointments": total_appts,
            "whatsapp_appointments": whatsapp_appts,
            "whatsapp_percentage": whatsapp_pct,
            "reception_appointments": reception_appts,
            "doctor_performance": doctor_perf,
            "conversion_funnel": conversion_funnel,
        },
        "patients": {
            "total_patients": total_patients,
            "returning_patients": multi_appt_patients,
            "retention_rate": retention_rate,
            "total_prescriptions": prescriptions_total,
            "total_dispenses": db.query(DispenseRecord).count(),
            "total_lab_orders": db.query(LabOrder).count(),
        },
        "messaging": {
            "total_messages": total_messages,
            "patient_inbound": patient_inbound,
            "bot_replies": bot_replies,
            "clinic_replies": clinic_replies,
        },
    }
