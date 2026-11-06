import json
import logging
import datetime
from typing import Optional
from fastapi import APIRouter, Request, Response, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Appointment, Invoice, Payment, Patient, Doctor, Clinic
from app.services.razorpay_service import razorpay_service
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.config import settings
from app.security import require_staff

logger = logging.getLogger("aerostate_clinic.payments")

router = APIRouter(prefix="/api/payments", tags=["Razorpay & Online Payments"])


class GeneratePaymentLinkRequest(BaseModel):
    appointment_id: Optional[int] = None
    invoice_id: Optional[int] = None
    amount: float
    description: Optional[str] = None
    send_whatsapp: bool = True


@router.post("/create-link")
async def create_payment_link_endpoint(
    payload: GeneratePaymentLinkRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_staff),
):
    """
    Staff / Receptionist endpoint: Generates a Razorpay UPI Payment Link and optionally
    sends it directly to the patient's WhatsApp.
    """
    if not razorpay_service.is_configured:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.",
        )

    patient = None
    desc = payload.description or "Medical Consultation & Care Services"

    if payload.appointment_id:
        appt = db.query(Appointment).filter(Appointment.id == payload.appointment_id).first()
        if appt:
            patient = appt.patient
            doc = appt.doctor
            desc = f"Consultation Fee - Dr. {doc.name if doc else 'Doctor'} ({appt.appointment_date})"

    if not patient and payload.invoice_id:
        inv = db.query(Invoice).filter(Invoice.id == payload.invoice_id).first()
        if inv:
            patient = inv.patient
            desc = f"Clinic Invoice #{inv.invoice_number}"

    if not patient or not patient.phone:
        raise HTTPException(status_code=400, detail="Valid patient phone number is required to send payment link.")

    link_data = await razorpay_service.create_payment_link(
        amount_rupees=payload.amount,
        description=desc,
        customer_name=patient.name or "Valued Patient",
        customer_phone=patient.phone,
        appointment_id=payload.appointment_id,
        invoice_id=payload.invoice_id,
    )

    if not link_data:
        raise HTTPException(status_code=500, detail="Failed to generate payment link with Razorpay.")

    pay_url = link_data.get("payment_url")

    # Optionally dispatch immediately via WhatsApp
    if payload.send_whatsapp and pay_url:
        wa_text = (
            f"💳 *ONLINE PAYMENT LINK - {settings.CLINIC_NAME}*\n\n"
            f"Dear *{patient.name}*,\n"
            f"Please complete your payment of *₹{payload.amount:,.2f}* for:\n"
            f"📌 {desc}\n\n"
            f"👉 *Tap to pay with UPI / GPay / PhonePe / Cards:*\n"
            f"{pay_url}\n\n"
            f"✅ *Instant Confirmation:* Your payment is automatically verified the second you complete it!"
        )
        try:
            await whatsapp_client.send_text(to=patient.phone, text=wa_text)
            message_service.log_message(
                db=db,
                phone=patient.phone,
                sender="bot",
                body=wa_text,
                patient_name=patient.name,
                message_type="payment_link",
            )
        except Exception as e:
            logger.warning(f"Failed to send payment link WhatsApp: {e}")

    return {
        "status": "success",
        "payment_url": pay_url,
        "payment_link_id": link_data.get("payment_link_id"),
        "amount": payload.amount,
        "description": desc,
    }


@router.post("/razorpay-webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Razorpay Automated Confirmation Webhook.
    Receives 'payment_link.paid' and 'payment.captured' events.
    Authoritatively updates Appointment & Invoice to PAID and sends an instant WhatsApp receipt!
    """
    body_bytes = await request.body()
    sig_header = request.headers.get("X-Razorpay-Signature") or request.headers.get("x-razorpay-signature")

    # Cryptographic signature verification
    if settings.RAZORPAY_WEBHOOK_SECRET and settings.RAZORPAY_WEBHOOK_SECRET.strip():
        if not razorpay_service.verify_webhook_signature(body_bytes, sig_header):
            logger.warning("Rejected Razorpay webhook: Invalid X-Razorpay-Signature")
            return Response(content="Invalid signature", status_code=403)

    try:
        payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    except Exception as e:
        logger.error(f"Malformed JSON in Razorpay webhook: {e}")
        return Response(content="Malformed JSON", status_code=400)

    event_type = payload.get("event")
    logger.info(f"Received Razorpay webhook event: {event_type}")

    if event_type in ("payment_link.paid", "order.paid", "payment.captured"):
        payload_data = payload.get("payload", {})
        plink_entity = payload_data.get("payment_link", {}).get("entity", {})
        payment_entity = payload_data.get("payment", {}).get("entity", {})

        notes = plink_entity.get("notes", {}) or payment_entity.get("notes", {})
        payment_id = payment_entity.get("id") or plink_entity.get("id", "rzp_paid")
        amount_paise = payment_entity.get("amount") or plink_entity.get("amount", 0)
        amount_rupees = float(amount_paise) / 100.0 if amount_paise else 0.0
        pay_method = (payment_entity.get("method") or "UPI").upper()

        appt_id_str = notes.get("appointment_id")
        inv_id_str = notes.get("invoice_id")

        matched_appointment = None
        matched_invoice = None

        # 1. Update Appointment if linked
        if appt_id_str and appt_id_str.isdigit():
            matched_appointment = db.query(Appointment).filter(Appointment.id == int(appt_id_str)).first()
            if matched_appointment:
                matched_appointment.payment_status = "PAID"
                matched_appointment.payment_method = f"Razorpay ({pay_method})"
                matched_appointment.paid_amount = int(amount_rupees)
                db.commit()
                logger.info(f"Appointment #{matched_appointment.id} marked as PAID via Razorpay webhook!")

        # 2. Update Invoice if linked or create one
        if inv_id_str and inv_id_str.isdigit():
            matched_invoice = db.query(Invoice).filter(Invoice.id == int(inv_id_str)).first()
        elif matched_appointment:
            matched_invoice = db.query(Invoice).filter(Invoice.appointment_id == matched_appointment.id).first()

        if matched_invoice:
            matched_invoice.amount_paid = amount_rupees
            matched_invoice.balance_due = max(0.0, float(matched_invoice.total or amount_rupees) - amount_rupees)
            matched_invoice.payment_status = "PAID" if matched_invoice.balance_due == 0 else "PARTIALLY_PAID"
            matched_invoice.payment_method = f"Razorpay ({pay_method})"
            
            # Record in payments ledger
            highest_pay = db.query(Payment).order_by(Payment.id.desc()).first()
            next_uid = f"PAY-{(highest_pay.id + 1 if highest_pay else 1):04d}"
            pay_record = Payment(
                payment_uid=next_uid,
                invoice_id=matched_invoice.id,
                amount=amount_rupees,
                payment_method=f"Razorpay ({pay_method})",
                transaction_ref=payment_id,
                received_by="Razorpay Automated Gateway",
                notes=f"100% Automated Online Payment via {pay_method} ({payment_id})",
                created_at=datetime.datetime.utcnow(),
            )
            db.add(pay_record)
            db.commit()
            logger.info(f"Invoice #{matched_invoice.invoice_number} updated to PAID!")

        # 3. 100% Automated Instant WhatsApp Confirmation Message to Patient
        patient_phone = None
        patient_name = "Valued Patient"
        doctor_info = ""
        date_info = ""

        if matched_appointment and matched_appointment.patient:
            patient_phone = matched_appointment.patient.phone
            patient_name = matched_appointment.patient.name
            if matched_appointment.doctor:
                doctor_info = f"🩺 *Doctor:* Dr. {matched_appointment.doctor.name} ({matched_appointment.doctor.specialization})\n"
            date_info = f"📅 *Scheduled:* {matched_appointment.appointment_date} at {matched_appointment.start_time}\n"
        elif matched_invoice and matched_invoice.patient:
            patient_phone = matched_invoice.patient.phone
            patient_name = matched_invoice.patient.name

        if patient_phone:
            confirmation_wa = (
                f"✅ *PAYMENT CONFIRMED (100% AUTOMATED)*\n\n"
                f"Hello *{patient_name}*,\n"
                f"Your payment of *₹{amount_rupees:,.2f}* via *{pay_method}* has been successfully verified!\n\n"
                f"🧾 *Transaction ID:* `{payment_id}`\n"
                f"{doctor_info}"
                f"{date_info}"
                f"📍 *Clinic:* {settings.CLINIC_NAME}\n"
                f"🏢 *Address:* {settings.CLINIC_ADDRESS}\n\n"
                f"Your appointment is 100% confirmed. You may proceed directly to the cabin upon arrival—no reception payment required!"
            )
            try:
                await whatsapp_client.send_text(to=patient_phone, text=confirmation_wa)
                message_service.log_message(
                    db=db,
                    phone=patient_phone,
                    sender="bot",
                    body=confirmation_wa,
                    patient_name=patient_name,
                    message_type="payment_success_receipt",
                )
            except Exception as e:
                logger.error(f"Failed to dispatch payment confirmation WhatsApp: {e}")

    return {"status": "ok", "event": event_type}
