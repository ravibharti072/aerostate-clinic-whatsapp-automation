import json
import logging
import hmac
import hashlib
from typing import Optional
from fastapi import APIRouter, Request, Response, Depends, Query
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.services.whatsapp import whatsapp_client
from app.services.booking import booking_service
from app.services.messages import message_service
from app.services.ai import ai_service, CLINICAL_SYMPTOM_MAP
from app.models import Doctor, Clinic

router = APIRouter(tags=["WhatsApp Webhook"])
logger = logging.getLogger("webhook")


class ClinicContext:
    """Encapsulates clinic-scoped credentials, details, and message transmission."""

    def __init__(self, db: Session, phone_number_id: Optional[str] = None, clinic_id: Optional[int] = None):
        self.clinic: Optional[Clinic] = None
        if clinic_id:
            self.clinic = db.query(Clinic).filter(Clinic.id == clinic_id, Clinic.is_active == True).first()
        elif phone_number_id:
            self.clinic = db.query(Clinic).filter(Clinic.phone_number_id == phone_number_id, Clinic.is_active == True).first()

        if not self.clinic:
            self.clinic = db.query(Clinic).filter(Clinic.is_active == True).first()

        self.clinic_id: Optional[int] = self.clinic.id if self.clinic else None
        self.name: str = (self.clinic.name if self.clinic and self.clinic.name else None) or settings.CLINIC_NAME or "Aerostate Clinic"
        self.phone_number_id: Optional[str] = (self.clinic.phone_number_id if self.clinic and self.clinic.phone_number_id else None) or settings.PHONE_NUMBER_ID
        self.token: Optional[str] = (self.clinic.whatsapp_token if self.clinic and self.clinic.whatsapp_token else None) or settings.WHATSAPP_TOKEN
        self.address: str = (self.clinic.address if self.clinic and self.clinic.address else None) or settings.CLINIC_ADDRESS
        self.phone: str = (self.clinic.phone if self.clinic and self.clinic.phone else None) or settings.CLINIC_PHONE
        self.hours: str = (self.clinic.operating_hours if self.clinic and self.clinic.operating_hours else None) or settings.CLINIC_HOURS

    async def send_text(self, to: str, text: str):
        return await whatsapp_client.send_text(
            to=to, text=text, phone_number_id=self.phone_number_id, token=self.token
        )

    async def send_quick_reply_buttons(
        self, to: str, body_text: str, buttons: list, header_text: Optional[str] = None
    ):
        return await whatsapp_client.send_quick_reply_buttons(
            to=to,
            body_text=body_text,
            buttons=buttons,
            header_text=header_text or self.name,
            phone_number_id=self.phone_number_id,
            token=self.token,
        )

    async def send_list_menu(
        self,
        to: str,
        body_text: str,
        button_label: str,
        sections: list,
        header_text: Optional[str] = None,
        footer_text: Optional[str] = None,
    ):
        return await whatsapp_client.send_list_menu(
            to=to,
            body_text=body_text,
            button_label=button_label,
            sections=sections,
            header_text=header_text or self.name,
            footer_text=footer_text,
            phone_number_id=self.phone_number_id,
            token=self.token,
        )


def verify_meta_webhook_signature(payload_bytes: bytes, signature_header: Optional[str], app_secret: str) -> bool:
    """Verifies that the payload was sent and signed by Meta using HMAC-SHA256."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = signature_header.split("sha256=", 1)[1].strip()
    calculated = hmac.new(app_secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, calculated)


@router.get("/webhook")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    db: Session = Depends(get_db),
):
    """
    Verification endpoint required by Meta.
    Validates either the global verify token or any individual clinic's token.
    """
    is_valid = (hub_verify_token == settings.VERIFY_TOKEN)
    if not is_valid and hub_verify_token:
        matched = db.query(Clinic).filter(Clinic.verify_token == hub_verify_token, Clinic.is_active == True).first()
        if matched:
            is_valid = True

    if hub_mode == "subscribe" and is_valid:
        logger.info("Meta Webhook verified successfully!")
        return Response(content=hub_challenge, media_type="text/plain")
    logger.warning("Meta Webhook verification failed. Tokens did not match.")
    return Response(content="Verification token mismatch", status_code=403)


@router.post("/webhook")
async def receive_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Message Receiver endpoint.
    Routes incoming messages dynamically to the right clinic by Meta phone_number_id.
    """
    body_bytes = await request.body()

    # Verify Meta App Secret signature if configured
    if settings.META_APP_SECRET and settings.META_APP_SECRET.strip():
        signature_header = request.headers.get("x-hub-signature-256")
        if not verify_meta_webhook_signature(body_bytes, signature_header, settings.META_APP_SECRET.strip()):
            logger.warning("Rejected webhook request: invalid or missing X-Hub-Signature-256")
            return Response(content="Invalid signature", status_code=403)

    try:
        payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    except Exception as e:
        logger.error(f"Malformed JSON in webhook request: {e}")
        return Response(content="Malformed JSON", status_code=400)

    try:
        entries = payload.get("entry", [])
        for entry in entries:
            for change in entry.get("changes", []):
                value = change.get("value", {})
                metadata = value.get("metadata", {})
                incoming_phone_id = metadata.get("phone_number_id")

                contacts = value.get("contacts", [{}])
                user_name = contacts[0].get("profile", {}).get("name", "Valued Patient")

                # Resolve clinic context by phone_number_id
                ctx = ClinicContext(db, phone_number_id=incoming_phone_id)

                messages = value.get("messages", [])
                for msg in messages:
                    sender_phone = msg.get("from")
                    msg_type = msg.get("type")
                    meta_msg_id = msg.get("id")

                    # Check if patient already has a session pinned to a specific clinic
                    session = booking_service.get_session(db, sender_phone)
                    active_ctx = ctx
                    if session.context_data:
                        try:
                            s_data = json.loads(session.context_data)
                            if s_data.get("clinic_id"):
                                active_ctx = ClinicContext(db, clinic_id=s_data.get("clinic_id"))
                        except Exception:
                            pass

                    # Handle plain text message
                    if msg_type == "text":
                        text_body = msg.get("text", {}).get("body", "").strip()
                        await handle_user_text(db, sender_phone, user_name, text_body, ctx=active_ctx, meta_id=meta_msg_id)

                    # Handle button response
                    elif msg_type == "interactive":
                        interactive = msg.get("interactive", {})
                        int_type = interactive.get("type")

                        if int_type == "button_reply":
                            button_id = interactive.get("button_reply", {}).get("id")
                            button_title = interactive.get("button_reply", {}).get("title")
                            await handle_user_button(db, sender_phone, user_name, button_id, button_title, ctx=active_ctx, meta_id=meta_msg_id)

                        elif int_type == "list_reply":
                            list_id = interactive.get("list_reply", {}).get("id")
                            list_title = interactive.get("list_reply", {}).get("title")
                            await handle_user_list_selection(db, sender_phone, user_name, list_id, list_title, ctx=active_ctx, meta_id=meta_msg_id)

    except Exception as e:
        logger.error(f"Error handling WhatsApp webhook: {e}", exc_info=True)

    # Always return 200 OK so Meta doesn't retry delivery
    return {"status": "ok"}


async def send_main_menu(
    db: Session, sender_phone: str, user_name: str, ctx: Optional[ClinicContext] = None, greeting: str = "Welcome"
):
    """Sends the standard main menu with quick reply buttons."""
    if not ctx:
        ctx = ClinicContext(db)
    body = (
        f"👋 {greeting}, *{user_name}*!\n\n"
        f"Welcome to *{ctx.name}*.\n"
        f"How can we assist you today?"
    )
    buttons = [
        {"id": "btn_book", "title": "📅 Book Appointment"},
        {"id": "btn_view", "title": "📋 My Appointments"},
        {"id": "btn_info", "title": "🏥 Clinic Info"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text=ctx.name,
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=body,
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def send_booking_mode_menu(
    db: Session, sender_phone: str, user_name: str, ctx: Optional[ClinicContext] = None
):
    """
    Presents the 3 booking modes for first-timers and returning patients:
    1. General Doctor (Instant triage)
    2. Describe Symptoms (AI Recommendation)
    3. Select Doctor (Direct catalogue)
    """
    if not ctx:
        ctx = ClinicContext(db)
    body = (
        f"📅 *Book an Appointment*\n\n"
        f"Welcome to *{ctx.name}*, *{user_name}*! How would you like to proceed?\n\n"
        f"1️⃣ *General Doctor* — Fast booking for common health concerns (cold, fever, checkup).\n"
        f"2️⃣ *Describe Symptoms* — Tell us your problem; our assistant will match the best specialist.\n"
        f"3️⃣ *Select Doctor* — Choose directly from our list of specialists."
    )
    buttons = [
        {"id": "mode_general", "title": "🩺 General Doctor"},
        {"id": "mode_symptoms", "title": "💬 Describe Problem"},
        {"id": "mode_doctors", "title": "👨‍⚕️ Select Doctor"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text="Step 1: Choose Option",
    )
    booking_service.update_session(db, sender_phone, step="SELECTING_MODE", context={"clinic_id": ctx.clinic_id})
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=body,
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def present_available_dates(
    db: Session,
    sender_phone: str,
    user_name: str,
    doctor: Doctor,
    context: dict,
    ctx: Optional[ClinicContext] = None,
    prompt_prefix: Optional[str] = None,
):
    """Presents upcoming available dates for the selected doctor."""
    if not ctx:
        ctx = ClinicContext(db, clinic_id=context.get("clinic_id"))
    context["clinic_id"] = ctx.clinic_id
    context["doctor_id"] = doctor.id
    context["doctor_name"] = doctor.name
    booking_service.update_session(db, sender_phone, step="SELECTING_DATE", context=context)

    dates = booking_service.get_available_dates(doctor, days_ahead=5)
    if not dates:
        msg = f"⚠️ {doctor.name} has no available slots this week. Please contact reception or choose another specialist."
        await ctx.send_text(to=sender_phone, text=msg)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    date_rows = [
        {"id": f"date_{d['date_str']}", "title": d["display"], "description": "Select this day"}
        for d in dates
    ]
    sections = [{"title": "Upcoming Available Dates", "rows": date_rows}]
    default_prompt = f"Doctor: *{doctor.name}* ({doctor.specialization}).\nPlease select a convenient date for your visit:"
    prompt_text = f"{prompt_prefix}\n\n{default_prompt}" if prompt_prefix else default_prompt

    await ctx.send_list_menu(
        to=sender_phone,
        body_text=prompt_text,
        button_label="📅 Choose Date",
        sections=sections,
        header_text="Step 2 of 3: Select Date",
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=f"{prompt_text} (Dates: {', '.join(d['display'] for d in dates)})",
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def handle_symptom_text(
    db: Session, sender_phone: str, user_name: str, text: str, ctx: Optional[ClinicContext] = None
):
    """Analyzes patient symptoms and suggests the best matching doctor."""
    if not ctx:
        ctx = ClinicContext(db)
    doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
    if not doctors:
        msg = f"No doctors are currently available at {ctx.name}. Please contact clinic reception directly."
        await ctx.send_text(to=sender_phone, text=msg)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    rec = await ai_service.recommend_doctor_by_symptoms(text, doctors)
    doc_id = rec.get("doctor_id")
    doctor = booking_service.get_doctor_by_id(db, doc_id) if doc_id else doctors[0]

    session = booking_service.get_session(db, sender_phone)
    context = json.loads(session.context_data or "{}")
    context["clinic_id"] = ctx.clinic_id
    context["doctor_id"] = doctor.id
    context["doctor_name"] = doctor.name
    context["symptoms"] = text.strip()

    booking_service.update_session(db, sender_phone, step="CONFIRM_RECOMMENDED_DOCTOR", context=context)

    reasoning = rec.get("reasoning", "Our doctor will provide a full medical consultation.")
    body = (
        f"🩺 *Doctor Recommendation*\n\n"
        f"Based on what you described:\n"
        f"_{text.strip()}_\n\n"
        f"💡 {reasoning}\n\n"
        f"We recommend: *{doctor.name}*\n"
        f"({doctor.specialization})\n\n"
        f"Would you like to book with *{doctor.name}*?"
    )
    buttons = [
        {"id": f"rec_accept_{doctor.id}", "title": "✅ Yes, Book Now"},
        {"id": "mode_doctors", "title": "👨‍⚕️ View All Doctors"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text="Specialist Match",
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=body,
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def handle_user_text(
    db: Session,
    sender_phone: str,
    user_name: str,
    text: str,
    ctx: Optional[ClinicContext] = None,
    meta_id: str = None,
):
    """Processes user text input."""
    if not ctx:
        ctx = ClinicContext(db)

    # 1. Log inbound message
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="patient",
        body=text,
        patient_name=user_name,
        message_type="text",
        meta_id=meta_id,
        clinic_id=ctx.clinic_id,
    )

    text_lower = text.lower().strip()
    session = booking_service.get_session(db, sender_phone)

    # 1. Global reset commands
    if text_lower in ["hi", "hello", "hey", "start", "menu", "help"]:
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id})
        await send_main_menu(db, sender_phone, user_name, ctx=ctx)
        return

    # 2. Check for cancellation requests first (before booking check so 'cancel booking' works)
    if "cancel" in text_lower:
        parts = text_lower.split()
        target_id = None
        for p in parts:
            clean_p = p.replace("#", "")
            if clean_p.isdigit():
                target_id = int(clean_p)
                break

        appts = booking_service.get_patient_upcoming_appointments(db, sender_phone, name=user_name)
        if not target_id and appts:
            if len(appts) == 1:
                target_id = appts[0].id
            else:
                prompt = (
                    "❓ *Which appointment would you like to cancel?*\n\n"
                    "Tap below to cancel your booking:"
                )
                buttons = [
                    {"id": f"cancel_{a.id}", "title": f"❌ Cancel #{a.id}"}
                    for a in appts[:2]
                ] + [{"id": "btn_menu", "title": "🏠 Main Menu"}]
                await ctx.send_quick_reply_buttons(
                    to=sender_phone, body_text=prompt, buttons=buttons[:3], header_text="Select Appointment"
                )
                message_service.log_message(db, sender_phone, "bot", prompt, user_name, clinic_id=ctx.clinic_id)
                return

        if target_id:
            success = booking_service.cancel_appointment(db, sender_phone, target_id, name=user_name)
            if success:
                reply = (
                    f"❌ *Appointment #{target_id} Cancelled*\n\n"
                    f"Your appointment has been cancelled successfully.\n\n"
                    f"Type 'book' or 'hi' whenever you would like to reschedule."
                )
                buttons = [
                    {"id": "btn_book", "title": "📅 Book New Appt"},
                    {"id": "btn_menu", "title": "🏠 Main Menu"},
                ]
                await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons)
                message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
                return
            else:
                reply = f"Could not cancel appointment #{target_id} or it was not found under your account."
                await ctx.send_text(to=sender_phone, text=reply)
                message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
                return
        else:
            reply = (
                "ℹ️ You do not have any upcoming appointments to cancel.\n\n"
                "Would you like to schedule a consultation?"
            )
            buttons = [
                {"id": "btn_book", "title": "📅 Book Appointment"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons)
            message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
            return

    # 3. Direct navigation commands
    if "my appointment" in text_lower or "status" in text_lower or "view appointment" in text_lower:
        await show_patient_appointments(db, sender_phone, user_name, ctx=ctx)
        return
    elif "clinic" in text_lower or "info" in text_lower or "address" in text_lower or "hours" in text_lower:
        await show_clinic_info(db, sender_phone, user_name, ctx=ctx)
        return
    elif "book" in text_lower or "appointment" in text_lower:
        await send_booking_mode_menu(db, sender_phone, user_name, ctx=ctx)
        return

    # If the user is currently prompted to describe their symptoms
    if session.step == "AWAITING_SYMPTOMS":
        await handle_symptom_text(db, sender_phone, user_name, text, ctx=ctx)
        return

    # Proactive symptom detection if user sends health concern while IDLE
    if session.step in ["IDLE", "SELECTING_MODE"]:
        is_symptom = any(
            any(kw in text_lower for kw in cat["keywords"])
            for cat in CLINICAL_SYMPTOM_MAP.values()
        )
        if is_symptom or len(text.split()) >= 3:
            doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
            rec = await ai_service.recommend_doctor_by_symptoms(text, doctors)
            if rec.get("confidence") in ["HIGH", "MEDIUM"]:
                await handle_symptom_text(db, sender_phone, user_name, text, ctx=ctx)
                return

    # Otherwise default to sending the main menu
    await send_main_menu(db, sender_phone, user_name, ctx=ctx, greeting="Hello")


async def handle_user_button(
    db: Session,
    sender_phone: str,
    user_name: str,
    button_id: str,
    button_title: str = None,
    ctx: Optional[ClinicContext] = None,
    meta_id: str = None,
):
    """Processes button replies."""
    if not ctx:
        ctx = ClinicContext(db)

    label = button_title or button_id

    # Log patient button click
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="patient",
        body=f"Clicked: {label}",
        patient_name=user_name,
        message_type="button",
        meta_id=meta_id,
        clinic_id=ctx.clinic_id,
    )

    if button_id == "btn_book":
        await send_booking_mode_menu(db, sender_phone, user_name, ctx=ctx)

    elif button_id == "mode_general":
        doctor = booking_service.get_general_physician(db, clinic_id=ctx.clinic_id)
        if not doctor:
            await start_booking_flow(db, sender_phone, user_name, ctx=ctx)
            return
        context = {
            "clinic_id": ctx.clinic_id,
            "doctor_id": doctor.id,
            "doctor_name": doctor.name,
            "symptoms": "General Consultation",
        }
        await present_available_dates(
            db,
            sender_phone,
            user_name,
            doctor,
            context,
            ctx=ctx,
            prompt_prefix="🩺 *General Consultation Selected*",
        )

    elif button_id == "mode_symptoms":
        booking_service.update_session(db, sender_phone, step="AWAITING_SYMPTOMS", context={"clinic_id": ctx.clinic_id})
        msg = (
            "💬 *Describe Your Health Concern*\n\n"
            "Please reply with a brief description of your symptoms (in English, Hindi, or Hinglish).\n\n"
            "_Examples:_\n"
            "• \"Severe toothache and gum swelling\"\n"
            "• \"Bukhar aur khasi hai 2 din se\"\n"
            "• \"Knee pain while walking\"\n\n"
            f"Our assistant will recommend the best specialist at *{ctx.name}*!"
        )
        await ctx.send_text(to=sender_phone, text=msg)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)

    elif button_id == "mode_doctors":
        await start_booking_flow(db, sender_phone, user_name, ctx=ctx)

    elif button_id.startswith("rec_accept_"):
        doc_id = int(button_id.replace("rec_accept_", ""))
        doctor = booking_service.get_doctor_by_id(db, doc_id)
        if not doctor:
            await start_booking_flow(db, sender_phone, user_name, ctx=ctx)
            return
        session = booking_service.get_session(db, sender_phone)
        context = json.loads(session.context_data or "{}")
        context["clinic_id"] = ctx.clinic_id
        context["doctor_id"] = doctor.id
        context["doctor_name"] = doctor.name
        await present_available_dates(db, sender_phone, user_name, doctor, context, ctx=ctx)

    elif button_id == "btn_menu":
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id})
        await send_main_menu(db, sender_phone, user_name, ctx=ctx)

    elif button_id == "btn_view":
        await show_patient_appointments(db, sender_phone, user_name, ctx=ctx)

    elif button_id == "btn_info":
        await show_clinic_info(db, sender_phone, user_name, ctx=ctx)

    elif button_id.startswith("cancel_"):
        appt_id = int(button_id.replace("cancel_", ""))
        success = booking_service.cancel_appointment(db, sender_phone, appt_id, name=user_name)
        if success:
            msg_reply = (
                f"❌ *Appointment #{appt_id} Cancelled*\n\n"
                f"Your appointment has been cancelled successfully.\n\n"
                f"Type 'hi' or 'book' whenever you wish to reschedule."
            )
            buttons = [
                {"id": "btn_book", "title": "📅 Book New Appt"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg_reply, buttons=buttons)
        else:
            msg_reply = "Could not cancel the appointment or it was not found."
            await ctx.send_text(to=sender_phone, text=msg_reply)

        message_service.log_message(
            db=db,
            phone=sender_phone,
            sender="bot",
            body=msg_reply,
            patient_name=user_name,
            message_type="button",
            clinic_id=ctx.clinic_id,
        )


async def handle_user_list_selection(
    db: Session,
    sender_phone: str,
    user_name: str,
    item_id: str,
    item_title: str = None,
    ctx: Optional[ClinicContext] = None,
    meta_id: str = None,
):
    """Processes list menu selections (Cancel -> Doctor -> Date -> Time Slot)."""
    if not ctx:
        ctx = ClinicContext(db)

    display_title = item_title or item_id
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="patient",
        body=f"Selected: {display_title}",
        patient_name=user_name,
        message_type="list",
        meta_id=meta_id,
        clinic_id=ctx.clinic_id,
    )

    # 0. Cancel Selected from list menu
    if item_id.startswith("cancel_"):
        appt_id = int(item_id.replace("cancel_", ""))
        success = booking_service.cancel_appointment(db, sender_phone, appt_id, name=user_name)
        if success:
            msg_reply = (
                f"❌ *Appointment #{appt_id} Cancelled*\n\n"
                f"Your appointment has been cancelled successfully.\n\n"
                f"Type 'hi' or 'book' whenever you wish to reschedule."
            )
            buttons = [
                {"id": "btn_book", "title": "📅 Book New Appt"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg_reply, buttons=buttons)
        else:
            msg_reply = "Could not cancel the appointment or it was not found."
            await ctx.send_text(to=sender_phone, text=msg_reply)

        message_service.log_message(
            db=db,
            phone=sender_phone,
            sender="bot",
            body=msg_reply,
            patient_name=user_name,
            message_type="list",
            clinic_id=ctx.clinic_id,
        )
        return

    session = booking_service.get_session(db, sender_phone)
    context = json.loads(session.context_data or "{}")
    context["clinic_id"] = ctx.clinic_id

    # 1. Doctor Selected from full list
    if item_id.startswith("doc_"):
        doctor_id = int(item_id.replace("doc_", ""))
        doctor = booking_service.get_doctor_by_id(db, doctor_id)
        if not doctor:
            msg = "Doctor not found. Please try again."
            await ctx.send_text(to=sender_phone, text=msg)
            message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
            return

        await present_available_dates(db, sender_phone, user_name, doctor, context, ctx=ctx)

    # 2. Date Selected
    elif item_id.startswith("date_"):
        date_str = item_id.replace("date_", "")
        context["date_str"] = date_str
        doctor_id = context.get("doctor_id")

        if not doctor_id:
            await send_booking_mode_menu(db, sender_phone, user_name, ctx=ctx)
            return

        booking_service.update_session(db, sender_phone, step="SELECTING_SLOT", context=context)

        slots = booking_service.get_available_slots(db, doctor_id, date_str)
        if not slots:
            msg = f"⚠️ All appointments are booked for {date_str}. Please select another date by typing 'book'."
            await ctx.send_text(to=sender_phone, text=msg)
            message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
            return

        # Up to 10 slots per list
        slot_rows = [
            {"id": f"slot_{slot}", "title": f"⏰ {slot}", "description": "30 min consultation"}
            for slot in slots[:10]
        ]
        sections = [{"title": f"Slots for {date_str}", "rows": slot_rows}]
        prompt_text = f"Available time slots on *{date_str}*:\nPlease select your preferred time:"
        await ctx.send_list_menu(
            to=sender_phone,
            body_text=prompt_text,
            button_label="⏰ Choose Time",
            sections=sections,
            header_text="Step 3 of 3: Select Time",
        )
        message_service.log_message(
            db=db,
            phone=sender_phone,
            sender="bot",
            body=f"{prompt_text} (Available: {', '.join(slots[:10])})",
            patient_name=user_name,
            message_type="interactive",
            clinic_id=ctx.clinic_id,
        )

    # 3. Time Slot Selected -> Confirm Booking
    elif item_id.startswith("slot_"):
        slot_time = item_id.replace("slot_", "")
        doctor_id = context.get("doctor_id")
        date_str = context.get("date_str")
        symptoms = context.get("symptoms")

        if not doctor_id or not date_str:
            await send_booking_mode_menu(db, sender_phone, user_name, ctx=ctx)
            return

        doctor = booking_service.get_doctor_by_id(db, doctor_id)
        doc_fee = doctor.consultation_fee if (doctor and doctor.consultation_fee is not None) else 500
        appointment = booking_service.book_appointment(
            db=db,
            phone=sender_phone,
            patient_name=user_name,
            doctor_id=doctor_id,
            date_str=date_str,
            start_time=slot_time,
            source="WhatsApp",
            notes=symptoms,
            payment_status="PENDING",
            payment_method="Pay at Clinic",
            paid_amount=0,
            clinic_id=ctx.clinic_id,
        )

        if not appointment:
            msg = "⚠️ This slot was just taken by another patient! Please pick another slot."
            await ctx.send_text(to=sender_phone, text=msg)
            message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
            return

        # Reset session
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id})

        symptom_line = f"🩺 *Reason / Symptoms:* {symptoms}\n" if symptoms else ""

        confirmation_text = (
            f"🎉 *APPOINTMENT CONFIRMED!*\n\n"
            f"📋 *Booking ID:* #{appointment.id}\n"
            f"👤 *Patient:* {user_name}\n"
            f"🩺 *Doctor:* {doctor.name} ({doctor.specialization})\n"
            f"{symptom_line}"
            f"📅 *Date:* {date_str}\n"
            f"⏰ *Time:* {appointment.start_time} - {appointment.end_time}\n"
            f"💳 *Consultation Fee:* ₹{doc_fee} *(To be paid at clinic reception)*\n"
            f"💵 *Payment Status:* ⏳ Unpaid (Pay on arrival)\n"
            f"📍 *Clinic:* {ctx.name}\n"
            f"🏢 *Address:* {ctx.address}\n\n"
            f"Please arrive 10 minutes early. To cancel or check your bookings anytime, send 'my appointments'."
        )
        await ctx.send_text(to=sender_phone, text=confirmation_text)
        message_service.log_message(
            db=db,
            phone=sender_phone,
            sender="bot",
            body=confirmation_text,
            patient_name=user_name,
            message_type="booking_confirmation",
            clinic_id=ctx.clinic_id,
        )


async def start_booking_flow(
    db: Session, sender_phone: str, user_name: str = "Valued Patient", ctx: Optional[ClinicContext] = None
):
    """Initiates direct doctor selection."""
    if not ctx:
        ctx = ClinicContext(db)

    doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
    if not doctors:
        msg = f"No doctors are currently available at {ctx.name}. Please contact clinic reception directly."
        await ctx.send_text(to=sender_phone, text=msg)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    booking_service.update_session(db, sender_phone, step="SELECTING_DOCTOR", context={"clinic_id": ctx.clinic_id})

    doc_rows = [
        {
            "id": f"doc_{doc.id}",
            "title": doc.name[:24],
            "description": f"{doc.specialization} ({doc.start_time}-{doc.end_time})"[:72],
        }
        for doc in doctors
    ]
    sections = [{"title": f"Specialists at {ctx.name}", "rows": doc_rows}]

    prompt_text = "Please choose a specialist for your consultation:"
    await ctx.send_list_menu(
        to=sender_phone,
        body_text=prompt_text,
        button_label="🩺 Select Doctor",
        sections=sections,
        header_text="Step 1 of 3: Specialist",
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=f"{prompt_text} (Specialists: {', '.join(d.name for d in doctors)})",
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def show_patient_appointments(
    db: Session, sender_phone: str, user_name: str = "Valued Patient", ctx: Optional[ClinicContext] = None
):
    """Displays upcoming appointments and allows 1-click cancellation."""
    if not ctx:
        ctx = ClinicContext(db)

    appts = booking_service.get_patient_upcoming_appointments(db, sender_phone, name=user_name)
    if not appts:
        buttons = [{"id": "btn_book", "title": "📅 Book New Appt"}]
        body = "You do not have any upcoming appointments scheduled."
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=body,
            buttons=buttons,
            header_text=ctx.name,
        )
        message_service.log_message(db, sender_phone, "bot", body, user_name, clinic_id=ctx.clinic_id)
        return

    text = f"📋 *Upcoming Appointments for {user_name}:*\n\n"
    for a in appts:
        clinic_title = a.clinic.name if (hasattr(a, "clinic") and a.clinic) else ctx.name
        symptom_info = f"  🩺 Reason: _{a.notes}_\n" if a.notes else ""
        text += (
            f"• *Booking ID #{a.id}*\n"
            f"  🏥 Clinic: {clinic_title}\n"
            f"  👨‍⚕️ Specialist: {a.doctor.name} ({a.doctor.specialization})\n"
            f"  📅 Date: {a.appointment_date}\n"
            f"  ⏰ Time: {a.start_time} - {a.end_time}\n"
            f"{symptom_info}"
            f"  Status: ✅ {a.status}\n\n"
        )

    # Attach interactive cancel buttons for all upcoming appointments
    if len(appts) == 1:
        buttons = [
            {"id": f"cancel_{appts[0].id}", "title": f"❌ Cancel #{appts[0].id}"},
            {"id": "btn_book", "title": "📅 Book Another"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=text,
            buttons=buttons,
            header_text="My Appointments",
        )
    elif len(appts) == 2:
        buttons = [
            {"id": f"cancel_{appts[0].id}", "title": f"❌ Cancel #{appts[0].id}"},
            {"id": f"cancel_{appts[1].id}", "title": f"❌ Cancel #{appts[1].id}"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=text,
            buttons=buttons,
            header_text="My Appointments",
        )
    else:
        text += "Select an appointment below to cancel it directly:"
        rows = [
            {
                "id": f"cancel_{a.id}",
                "title": f"Cancel #{a.id} ({a.start_time})"[:24],
                "description": f"{a.doctor.name} ({a.appointment_date})"[:72],
            }
            for a in appts[:10]
        ]
        sections = [{"title": "Your Upcoming Appointments", "rows": rows}]
        await ctx.send_list_menu(
            to=sender_phone,
            body_text=text,
            button_label="❌ Cancel Booking",
            sections=sections,
            header_text="My Appointments",
        )

    message_service.log_message(db, sender_phone, "bot", text, user_name, clinic_id=ctx.clinic_id)


async def show_clinic_info(
    db: Session, sender_phone: str, user_name: str = "Valued Patient", ctx: Optional[ClinicContext] = None
):
    """Sends clinic information and contact details."""
    if not ctx:
        ctx = ClinicContext(db)

    text = (
        f"🏥 *{ctx.name}*\n\n"
        f"📍 *Address:* {ctx.address}\n"
        f"📞 *Phone:* {ctx.phone}\n"
        f"⏰ *Hours:* {ctx.hours}\n\n"
        f"Emergency cases: Please visit our clinic emergency desk directly or call 112."
    )
    buttons = [{"id": "btn_book", "title": "📅 Book Appointment"}]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=text,
        buttons=buttons,
        header_text=ctx.name,
    )
    message_service.log_message(db, sender_phone, "bot", text, user_name, clinic_id=ctx.clinic_id)
