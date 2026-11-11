import json
import logging
import hmac
import hashlib
import datetime
import re
from typing import Optional, List
from fastapi import APIRouter, Request, Response, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.database import get_db
from app.services.whatsapp import whatsapp_client
from app.services.booking import booking_service
from app.services.messages import message_service
from app.services.ai import ai_service
from app.services.reception import reception_service
from app.services.faq import faq_service
from app.services.safety import safety_service, MEDICAL_SAFETY_DISCLAIMER
from app.models import Doctor, Clinic, Appointment, ProcessedWebhookMessage

router = APIRouter(tags=["WhatsApp Webhook"])
logger = logging.getLogger("webhook")


def mask_abha(abha_str: Optional[str]) -> str:
    """Masks 14-digit ABHA number for privacy protection on WhatsApp (e.g. 12-****-****-7890)."""
    if not abha_str:
        return ""
    clean = re.sub(r"[^\d]", "", abha_str)
    if len(clean) >= 12:
        return f"{clean[:2]}-****-****-{clean[-4:]}"
    elif len(clean) >= 4:
        return f"****-****-{clean[-4:]}"
    return "****"


def format_doc_name(name: Optional[str]) -> str:
    """Safely formats doctor's name, preventing duplicate 'Dr. Dr.' prefixes."""
    cleaned = (name or "Doctor").strip()
    if cleaned.lower().startswith("dr.") or cleaned.lower().startswith("dr "):
        return cleaned
    return f"Dr. {cleaned}"


class ClinicContext:
    """Encapsulates clinic-scoped credentials, details, and message transmission."""

    def __init__(self, db: Session, phone_number_id: Optional[str] = None, clinic_id: Optional[int] = None):
        self.clinic: Optional[Clinic] = None
        if clinic_id:
            self.clinic = db.query(Clinic).filter(Clinic.id == clinic_id, Clinic.is_active == True).first()
        elif phone_number_id:
            clean_pid = str(phone_number_id).strip()
            self.clinic = db.query(Clinic).filter(Clinic.phone_number_id == clean_pid, Clinic.is_active == True).first()
            if not self.clinic and settings.PHONE_NUMBER_ID and clean_pid == str(settings.PHONE_NUMBER_ID).strip():
                self.clinic = db.query(Clinic).filter(Clinic.is_active == True).order_by(Clinic.id.asc()).first()
            if not self.clinic:
                active_clinics = db.query(Clinic).filter(Clinic.is_active == True).all()
                if len(active_clinics) == 1 and not active_clinics[0].phone_number_id:
                    # Single active clinic without phone_number_id yet; auto-bind it
                    single_c = active_clinics[0]
                    single_c.phone_number_id = clean_pid
                    try:
                        db.commit()
                        db.refresh(single_c)
                    except Exception:
                        db.rollback()
                    self.clinic = single_c

        # Strict clinic validation: NEVER fall back to another clinic if unmatched
        self.is_valid: bool = self.clinic is not None
        self.clinic_id: Optional[int] = self.clinic.id if self.clinic else None
        self.name: str = (self.clinic.name if self.clinic and self.clinic.name else "") or settings.CLINIC_NAME or "Aerostate Clinic"
        self.phone_number_id: Optional[str] = (self.clinic.phone_number_id if self.clinic and self.clinic.phone_number_id else None) or settings.PHONE_NUMBER_ID
        self.token: Optional[str] = (self.clinic.whatsapp_token if self.clinic and self.clinic.whatsapp_token else None) or settings.WHATSAPP_TOKEN
        self.address: str = (self.clinic.address if self.clinic and self.clinic.address else "") or settings.CLINIC_ADDRESS
        self.phone: str = (self.clinic.phone if self.clinic and self.clinic.phone else "") or settings.CLINIC_PHONE
        self.hours: str = (self.clinic.operating_hours if self.clinic and self.clinic.operating_hours else "") or settings.CLINIC_HOURS
        # Phase 3: Clinic Booking & Payment Policies
        self.payment_policy: str = (getattr(self.clinic, "payment_policy", None) or "PAY_AT_CLINIC").upper()
        self.advance_amount: int = getattr(self.clinic, "advance_amount", 200) or 200
        self.advance_percentage: Optional[int] = getattr(self.clinic, "advance_percentage", None)
        self.require_age: bool = bool(getattr(self.clinic, "require_age", False))
        self.require_gender: bool = bool(getattr(self.clinic, "require_gender", False))
        self.require_reason: bool = bool(getattr(self.clinic, "require_reason", False))
        self.payment_link_expiry_mins: int = getattr(self.clinic, "payment_link_expiry_mins", 30) or 30
        # Phase 4: Rescheduling & Cancellation Policies
        self.reschedule_cutoff_hours: int = getattr(self.clinic, "reschedule_cutoff_hours", 2) or 2
        self.cancel_cutoff_hours: int = getattr(self.clinic, "cancel_cutoff_hours", 2) or 2
        self.cancellation_policy_text: str = getattr(self.clinic, "cancellation_policy_text", None) or "Cancellations allowed up to 2 hours before appointment."
        self.max_reschedules: int = getattr(self.clinic, "max_reschedules", 3) or 3
        # Phase 6: Reception Handover & Clinic Information Policies
        self.google_maps_url: Optional[str] = getattr(self.clinic, "google_maps_url", None)
        self.emergency_contact: Optional[str] = getattr(self.clinic, "emergency_contact", None)
        self.departments: Optional[str] = getattr(self.clinic, "departments", None)
        self.facilities: Optional[str] = getattr(self.clinic, "facilities", None)
        self.reception_phone: Optional[str] = getattr(self.clinic, "reception_phone", None)
        self.reception_start_time: str = getattr(self.clinic, "reception_start_time", "09:00") or "09:00"
        self.reception_end_time: str = getattr(self.clinic, "reception_end_time", "18:00") or "18:00"
        self.reception_days: str = getattr(self.clinic, "reception_days", "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday") or "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday"
        self.reception_message_open: Optional[str] = getattr(self.clinic, "reception_message_open", None)
        self.reception_message_closed: Optional[str] = getattr(self.clinic, "reception_message_closed", None)
        self.reception_expected_wait_mins: Optional[int] = getattr(self.clinic, "reception_expected_wait_mins", None)

    async def send_text(self, to: str, text: str):
        if not self.is_valid:
            logger.warning("send_text aborted: Invalid or unverified clinic context.")
            return None
        return await whatsapp_client.send_text(
            to=to, text=text, phone_number_id=self.phone_number_id, token=self.token
        )

    async def send_quick_reply_buttons(
        self, to: str, body_text: str, buttons: list, header_text: Optional[str] = None
    ):
        if not self.is_valid:
            logger.warning("send_quick_reply_buttons aborted: Invalid or unverified clinic context.")
            return None
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
        if not self.is_valid:
            logger.warning("send_list_menu aborted: Invalid or unverified clinic context.")
            return None
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


def check_and_record_meta_id(
    db: Session,
    meta_id: Optional[str],
    clinic_id: Optional[int] = None,
    phone: Optional[str] = None,
    msg_type: Optional[str] = None,
) -> bool:
    """
    Checks if a Meta message ID has already been processed using atomic DB insertion.
    Returns True if already processed (duplicate), False if it is new and successfully recorded.
    """
    if not meta_id:
        return False

    existing = db.query(ProcessedWebhookMessage).filter(ProcessedWebhookMessage.meta_id == meta_id).first()
    if existing:
        return True

    try:
        rec = ProcessedWebhookMessage(
            meta_id=meta_id,
            clinic_id=clinic_id,
            phone=phone,
            message_type=msg_type,
            processed_at=datetime.datetime.utcnow(),
        )
        db.add(rec)
        db.commit()
        return False
    except IntegrityError:
        db.rollback()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"Error checking message idempotency for meta_id '{meta_id}': {e}")
        existing = db.query(ProcessedWebhookMessage).filter(ProcessedWebhookMessage.meta_id == meta_id).first()
        return bool(existing)


@router.get("/webhook")
@router.get("/api/webhook")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    db: Session = Depends(get_db),
):
    """
    Verification endpoint required by Meta.
    Validates either the global verify token or any individual clinic's token using constant-time comparison.
    """
    is_valid = bool(
        hub_verify_token
        and settings.VERIFY_TOKEN
        and hmac.compare_digest(hub_verify_token, settings.VERIFY_TOKEN)
    )
    if not is_valid and hub_verify_token:
        matched = db.query(Clinic).filter(Clinic.is_active == True).all()
        for cln in matched:
            if cln.verify_token and hmac.compare_digest(hub_verify_token, cln.verify_token):
                is_valid = True
                break

    if hub_mode == "subscribe" and is_valid:
        logger.info("Meta Webhook verified successfully!")
        return Response(content=hub_challenge, media_type="text/plain")
    logger.warning("Meta Webhook verification failed. Tokens did not match.")
    return Response(content="Verification token mismatch", status_code=403)


@router.post("/webhook")
@router.post("/api/webhook")
async def receive_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Message Receiver endpoint.
    Routes incoming messages strictly by Meta phone_number_id with signature & idempotency verification.
    """
    body_bytes = await request.body()

    # Meta Webhook Signature Verification
    app_secret = (settings.META_APP_SECRET or "").strip()
    signature_header = request.headers.get("x-hub-signature-256") or request.headers.get("X-Hub-Signature-256")

    is_dev_insecure = (
        getattr(settings, "ENVIRONMENT", "production").lower() == "development"
        and getattr(settings, "ALLOW_INSECURE_WEBHOOKS", False) is True
    ) or getattr(settings, "ALLOW_INSECURE_WEBHOOKS", False) is True

    if app_secret:
        if not verify_meta_webhook_signature(body_bytes, signature_header, app_secret):
            if not is_dev_insecure:
                logger.warning("Rejected webhook request: Invalid or missing X-Hub-Signature-256")
                return Response(content="Invalid signature", status_code=403)
            else:
                logger.warning("DEVELOPMENT NOTICE: Allowed mismatched signature because ALLOW_INSECURE_WEBHOOKS=True.")
    else:
        # If META_APP_SECRET is not configured in .env, log a notice and allow messages through
        logger.warning(
            "SECURITY NOTICE: Webhook received without META_APP_SECRET configured in .env. "
            "Processing message. For production security, please add META_APP_SECRET in .env."
        )

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

                # 1. Strict clinic identification
                ctx = ClinicContext(db, phone_number_id=incoming_phone_id)
                if not ctx.is_valid:
                    logger.warning(
                        f"Rejected webhook message: Unrecognized or inactive clinic phone_number_id='{incoming_phone_id}'. "
                        f"Message will not be processed under any other clinic."
                    )
                    continue

                # Process Meta message delivery status updates (Phase 5)
                for st in value.get("statuses", []):
                    wamid = st.get("id")
                    st_val = st.get("status")
                    if wamid and st_val:
                        from app.services.notifications import notification_service
                        notification_service.update_delivery_status(db, wamid, st_val)

                contacts = value.get("contacts", [{}])
                user_name = contacts[0].get("profile", {}).get("name", "Valued Patient")

                messages = value.get("messages", [])
                for msg in messages:
                    sender_phone = msg.get("from")
                    msg_type = msg.get("type")
                    meta_msg_id = msg.get("id")

                    if not sender_phone:
                        continue

                    # 2. Duplicate Message Protection (Idempotency)
                    if meta_msg_id:
                        if check_and_record_meta_id(
                            db,
                            meta_id=meta_msg_id,
                            clinic_id=ctx.clinic_id,
                            phone=sender_phone,
                            msg_type=msg_type,
                        ):
                            logger.info(
                                f"Duplicate Meta message ignored: meta_id={meta_msg_id}, clinic_id={ctx.clinic_id}"
                            )
                            continue

                    # 3. Privacy-preserving safe logging
                    phone_mask = f"...{sender_phone[-4:]}" if len(sender_phone) >= 4 else "****"
                    logger.info(
                        f"Inbound WhatsApp message: clinic_id={ctx.clinic_id}, phone={phone_mask}, "
                        f"type={msg_type}, meta_id={meta_msg_id}"
                    )

                    # 4. Clinic-scoped session with expiration
                    session = booking_service.get_session(db, sender_phone, clinic_id=ctx.clinic_id)
                    if getattr(session, "was_expired", False):
                        logger.info(
                            f"Session for patient phone {phone_mask} in clinic #{ctx.clinic_id} expired. "
                            f"Restarting from main menu."
                        )
                        await send_main_menu(
                            db=db,
                            sender_phone=sender_phone,
                            user_name=user_name,
                            ctx=ctx,
                            greeting="Your previous session timed out. Welcome back"
                        )
                        continue

                    # 5. Message dispatch
                    if msg_type == "text":
                        text_body = msg.get("text", {}).get("body", "").strip()
                        await handle_user_text(db, sender_phone, user_name, text_body, ctx=ctx, meta_id=meta_msg_id)

                    elif msg_type == "interactive":
                        interactive = msg.get("interactive", {})
                        int_type = interactive.get("type")

                        if int_type == "button_reply":
                            button_id = interactive.get("button_reply", {}).get("id")
                            button_title = interactive.get("button_reply", {}).get("title")
                            await handle_user_button(db, sender_phone, user_name, button_id, button_title, ctx=ctx, meta_id=meta_msg_id)

                        elif int_type == "list_reply":
                            list_id = interactive.get("list_reply", {}).get("id")
                            list_title = interactive.get("list_reply", {}).get("title")
                            await handle_user_list_selection(db, sender_phone, user_name, list_id, list_title, ctx=ctx, meta_id=meta_msg_id)

    except Exception as e:
        db.rollback()
        logger.error(f"Error handling WhatsApp webhook: {e}", exc_info=True)
        return Response(content="Internal Server Error", status_code=500)

    # Always return 200 OK so Meta doesn't retry delivery
    return {"status": "ok"}


def match_text_command(text: str) -> Optional[str]:
    """
    Standardizes patient text commands using case-insensitive matching with typo resilience.
    Returns canonical command: 'menu', 'book', 'reschedule', 'cancel', 'my_appointments',
    'doctors', 'clinic_info', 'human', 'abha', or None.
    """
    clean = re.sub(r"[^\w\s]", " ", (text or "").lower()).strip()
    clean = re.sub(r"\s+", " ", clean)

    if not clean:
        return None

    # 1. Main menu / greetings
    if clean in [
        "hi", "hello", "hey", "helo", "hii", "start", "menu", "main menu",
        "help", "namaste", "shuru", "home", "back", "wapas", "restart"
    ]:
        return "menu"

    # 2. Reschedule commands (check before general book)
    if any(k in clean for k in [
        "reschedule", "resched", "re schedule", "re-schedule",
        "change appointment", "change date", "change time", "postpone", "prepone",
        "shift appointment", "rescedule", "reshedule", "badalna"
    ]):
        return "reschedule"

    # 3. Cancel commands (check before book so 'cancel booking' is cancel)
    if any(k in clean for k in [
        "cancel", "cancle", "cancel appointment", "cancel booking", "cancell", "radd", "delete booking"
    ]):
        return "cancel"

    # 4. My appointments
    if any(k in clean for k in [
        "my appointment", "my appointments", "my booking", "my bookings",
        "view appointment", "check appointment", "status", "meri appointment"
    ]):
        return "my_appointments"

    # 5. Booking commands
    if any(k in clean for k in [
        "book", "booking", "appointment", "appoint", "apointment",
        "new appointment", "schedule", "doctor appointment"
    ]):
        return "book"

    # 6. Doctors catalogue
    if clean in [
        "doctors", "doctor", "doc", "docs", "specialist", "specialists",
        "doctor list", "find doctor", "dr", "daktar"
    ]:
        return "doctors"

    # 7. Clinic Info commands
    if clean in [
        "clinic info", "clinic", "info", "address", "location",
        "hours", "timings", "timing", "where", "kahan", "clinic information"
    ] or clean.startswith("clinic info"):
        return "clinic_info"

    # 8. Human / Receptionist commands
    if any(k in clean for k in [
        "human", "receptionist", "reception", "agent", "support",
        "operator", "staff", "talk to receptionist", "call", "desk", "helpdesk"
    ]):
        return "human"

    # 9. FAQ / Common Questions commands
    if clean in ["faq", "faqs", "question", "questions", "sawal", "frequently asked questions"]:
        return "faq"

    # 10. ABHA / Ayushman Bharat
    if any(k in clean for k in ["abha", "ayushman", "health id"]):
        return "abha"

    return None


async def send_main_menu(
    db: Session, sender_phone: str, user_name: str, ctx: Optional[ClinicContext] = None, greeting: str = "Welcome"
):
    """
    Sends the upgraded WhatsApp interactive list menu with 6 comprehensive options:
    1. Book Appointment
    2. Reschedule Appointment
    3. Cancel Appointment
    4. My Appointments
    5. Doctors & Clinic Information
    6. Talk to Receptionist
    """
    if not ctx or not ctx.is_valid:
        logger.warning("send_main_menu rejected: invalid or unverified clinic context.")
        return

    body = (
        f"👋 Welcome to *{ctx.name}*!\n\n"
        f"How can we help you today, *{user_name}*?\n\n"
        f"Choose an option below:"
    )

    sections = [
        {
            "title": "Appointments",
            "rows": [
                {
                    "id": "menu_book",
                    "title": "📅 Book Appointment",
                    "description": "Schedule a doctor consultation",
                },
                {
                    "id": "menu_reschedule",
                    "title": "🔄 Reschedule",
                    "description": "Change appointment date or time",
                },
                {
                    "id": "menu_cancel",
                    "title": "❌ Cancel Booking",
                    "description": "Cancel an existing appointment",
                },
                {
                    "id": "menu_view",
                    "title": "📋 My Appointments",
                    "description": "View scheduled upcoming visits",
                },
            ],
        },
        {
            "title": "Clinic & Assistance",
            "rows": [
                {
                    "id": "menu_info",
                    "title": "🏥 Doctors & Info",
                    "description": "Specialists, timings & address",
                },
                {
                    "id": "menu_human",
                    "title": "💬 Talk to Reception",
                    "description": "Connect with front desk staff",
                },
            ],
        },
    ]

    await ctx.send_list_menu(
        to=sender_phone,
        body_text=body,
        button_label="📋 Choose Option",
        sections=sections,
        header_text=ctx.name,
        footer_text="Aerostate Digital Clinic",
    )
    booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=body,
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def talk_to_receptionist(
    db: Session,
    sender_phone: str,
    user_name: str,
    reason: str = "Talk to Receptionist",
    patient_query: Optional[str] = None,
    ctx: Optional[ClinicContext] = None,
):
    """Handles patient request to connect with human receptionist, checking working hours and creating handover ticket."""
    if not ctx or not ctx.is_valid:
        return

    # Check reception availability based on clinic timezone and configured working hours
    is_open = reception_service.is_reception_open(ctx.clinic)

    # Get conversation context
    session = booking_service.get_session(db, sender_phone, clinic_id=ctx.clinic_id)
    context_data = json.loads(session.context_data or "{}") if session else {}

    # Create persistent handover request
    req = reception_service.create_handover_request(
        db=db,
        clinic_id=ctx.clinic_id,
        phone=sender_phone,
        patient_name=user_name,
        reason=reason,
        patient_query=patient_query,
        context_data=context_data,
        is_outside_hours=not is_open,
    )

    # Build response message strictly respecting Phase 6 requirements
    text = reception_service.build_reception_message(ctx.clinic, is_open=is_open, user_name=user_name)

    buttons = [
        {"id": "btn_book", "title": "📅 Book Appointment"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=text,
        buttons=buttons,
        header_text=ctx.name,
    )
    booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=text,
        patient_name=user_name,
        message_type="reception_request",
        clinic_id=ctx.clinic_id,
    )


async def show_clinic_and_doctors_info(
    db: Session, sender_phone: str, user_name: str, ctx: Optional[ClinicContext] = None
):
    """Sends comprehensive clinic details and available specialist doctor catalogue (Phase 6)."""
    if not ctx or not ctx.is_valid:
        return

    # Only include configured fields; do not display empty or None placeholders
    info_parts = [f"🏥 *{ctx.name}*"]
    if getattr(ctx.clinic, "tagline", None):
        info_parts.append(f"_{ctx.clinic.tagline}_")

    if ctx.address:
        info_parts.append(f"📍 *Address:* {ctx.address}")
    if ctx.google_maps_url:
        info_parts.append(f"🗺️ *Directions / Map:* {ctx.google_maps_url}")
    if ctx.phone:
        info_parts.append(f"📞 *Contact Number:* {ctx.phone}")
    if ctx.reception_phone and ctx.reception_phone != ctx.phone:
        info_parts.append(f"📞 *Reception Phone:* {ctx.reception_phone}")
    if ctx.hours:
        info_parts.append(f"⏰ *Working Hours:* {ctx.hours}")
    if ctx.departments:
        info_parts.append(f"🏢 *Available Departments:* {ctx.departments}")
    if ctx.facilities:
        info_parts.append(f"✨ *Available Facilities:* {ctx.facilities}")
    if ctx.emergency_contact:
        info_parts.append(f"🚨 *Emergency Instructions:* {ctx.emergency_contact}")

    # Doctors catalogue (only approved doctors, actual fees without inventing)
    doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
    if doctors:
        doc_lines = "👨‍⚕️ *Our Doctors & Specialists:*\n"
        for d in doctors:
            fee_str = f"₹{d.consultation_fee}" if d.consultation_fee else "₹500"
            days_str = f"  _Days:_ {d.available_days}\n" if d.available_days else "\n"
            doc_lines += f"• *{d.name}* — {d.specialization} ({fee_str})\n{days_str}"
        info_parts.append(doc_lines)

    text = "\n\n".join(info_parts)
    buttons = [
        {"id": "btn_book", "title": "📅 Book Appointment"},
        {"id": "btn_human", "title": "💬 Talk to Reception"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=text,
        buttons=buttons,
        header_text=ctx.name,
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=text,
        patient_name=user_name,
        message_type="clinic_info",
        clinic_id=ctx.clinic_id,
    )


# Backward-compatibility alias
show_clinic_info = show_clinic_and_doctors_info


async def show_clinic_faqs(
    db: Session, sender_phone: str, user_name: str, ctx: Optional[ClinicContext] = None
):
    """Sends common clinic FAQs and instructions for asking questions (Phase 6)."""
    if not ctx or not ctx.is_valid:
        return

    faqs = faq_service.list_faqs(db, clinic_id=ctx.clinic_id, active_only=True)
    if not faqs:
        # Seed defaults if none exist
        faqs = faq_service.seed_default_faqs(db, clinic_id=ctx.clinic_id)

    top_faqs = faqs[:5]
    faq_body = "❓ *Frequently Asked Questions:*\n\n"
    for i, f in enumerate(top_faqs, 1):
        faq_body += f"*{i}. {f.question}*\n{f.answer}\n\n"

    faq_body += "You can type any question here (e.g. 'clinic timings', 'consultation fee', 'pharmacy', 'lab tests'), or speak with reception."

    buttons = [
        {"id": "btn_book", "title": "📅 Book Appointment"},
        {"id": "btn_human", "title": "💬 Talk to Reception"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=faq_body.strip(),
        buttons=buttons,
        header_text=f"{ctx.name} FAQs",
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=faq_body.strip(),
        patient_name=user_name,
        message_type="faq_list",
        clinic_id=ctx.clinic_id,
    )


async def show_appointment_management(
    db: Session,
    sender_phone: str,
    user_name: str,
    appt_id: int,
    ctx: Optional[ClinicContext] = None,
):
    """Presents management actions (Reschedule / Cancel) for a selected upcoming appointment."""
    if not ctx or not ctx.is_valid:
        return

    from app.routers.patients import normalize_phone

    appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not appt or (appt.clinic_id and appt.clinic_id != ctx.clinic_id):
        await ctx.send_text(sender_phone, f"⚠️ Appointment #{appt_id} was not found under {ctx.name}.")
        return

    # Cross-patient verification
    if normalize_phone(sender_phone) != normalize_phone(appt.patient.phone if appt.patient else ""):
        await ctx.send_text(sender_phone, "⚠️ You are not authorized to view or manage this appointment.")
        return

    pat_name = appt.patient.name if appt.patient else user_name
    pay_status = appt.payment_status or "PENDING"
    pay_str = f"💳 PAID (₹{appt.paid_amount or 500} via {appt.payment_method or 'Razorpay'})" if pay_status == "PAID" else "💳 PENDING (Pay at clinic)"
    doc_name = format_doc_name(appt.doctor.name if appt.doctor else "Doctor")
    doc_spec = appt.doctor.specialization if appt.doctor else "General Consultation"
    clinic_name = appt.clinic.name if (hasattr(appt, "clinic") and appt.clinic) else ctx.name
    clinic_addr = appt.clinic.address if (hasattr(appt, "clinic") and appt.clinic and appt.clinic.address) else ctx.address

    body = (
        f"⚙️ *Manage Appointment #{appt.id}*\n\n"
        f"👤 *Patient:* {pat_name}\n"
        f"👨‍⚕️ *Doctor:* {doc_name} ({doc_spec})\n"
        f"📅 *Date:* {appt.appointment_date}\n"
        f"⏰ *Time:* {appt.start_time} - {appt.end_time}\n"
        f"📊 *Status:* ✅ {appt.status}\n"
        f"  {pay_str}\n"
        f"🏥 *Clinic:* {clinic_name}\n"
        f"📍 *Address:* {clinic_addr}\n\n"
        f"What would you like to do with this booking?"
    )
    buttons = [
        {"id": f"resched_{appt.id}", "title": "🔄 Reschedule"},
        {"id": f"cancel_req_{appt.id}", "title": "❌ Cancel Booking"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text=f"Booking #{appt.id}",
    )
    message_service.log_message(db, sender_phone, "bot", body, user_name, clinic_id=ctx.clinic_id)


async def show_appointment_history(
    db: Session,
    sender_phone: str,
    user_name: str,
    view_type: str = "menu",
    ctx: Optional[ClinicContext] = None,
):
    """Presents completed or cancelled appointment history while protecting medical privacy."""
    if not ctx or not ctx.is_valid:
        return

    if view_type == "past":
        past_appts = booking_service.get_patient_past_appointments(db, sender_phone, clinic_id=ctx.clinic_id)
        if not past_appts:
            msg = f"📜 *Past Consultations*\n\nHello *{user_name}*, no past completed consultations were found at *{ctx.name}*."
        else:
            msg = f"📜 *Past Consultations at {ctx.name} ({len(past_appts)}):*\n\n"
            for a in past_appts[:5]:
                pat_name = a.patient.name if a.patient else user_name
                doc_name = a.doctor.name if a.doctor else "Doctor"
                doc_spec = a.doctor.specialization if a.doctor else "General"
                msg += (
                    f"• *Booking #{a.id}*\n"
                    f"  👤 Patient: {pat_name}\n"
                    f"  👨‍⚕️ Dr. {doc_name} ({doc_spec})\n"
                    f"  📅 {a.appointment_date} at {a.start_time}\n"
                    f"  Status: {a.status}\n\n"
                )
        buttons = [
            {"id": "btn_view", "title": "📋 Upcoming Appts"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Past Consultations")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    elif view_type == "cancelled":
        cancelled_appts = booking_service.get_patient_cancelled_appointments(db, sender_phone, clinic_id=ctx.clinic_id)
        if not cancelled_appts:
            msg = f"❌ *Cancelled Appointments*\n\nHello *{user_name}*, no cancelled bookings were found at *{ctx.name}*."
        else:
            msg = f"❌ *Cancelled Bookings at {ctx.name} ({len(cancelled_appts)}):*\n\n"
            for a in cancelled_appts[:5]:
                pat_name = a.patient.name if a.patient else user_name
                doc_name = a.doctor.name if a.doctor else "Doctor"
                canc_time = a.cancelled_at.strftime("%Y-%m-%d") if getattr(a, "cancelled_at", None) else "N/A"
                msg += (
                    f"• *Booking #{a.id}*\n"
                    f"  👤 Patient: {pat_name}\n"
                    f"  👨‍⚕️ Dr. {doc_name}\n"
                    f"  📅 Original Slot: {a.appointment_date} at {a.start_time}\n"
                    f"  🗓️ Cancelled On: {canc_time}\n"
                    f"  Reason: {a.cancellation_reason or 'Cancelled by patient'}\n\n"
                )
        buttons = [
            {"id": "btn_book", "title": "📅 Book New Appt"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Cancelled Bookings")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # Default history selector menu
    menu_text = (
        f"📜 *Appointment History*\n\n"
        f"Hello *{user_name}*, which records would you like to review for *{ctx.name}*?"
    )
    buttons = [
        {"id": "hist_past", "title": "✅ Past Visits"},
        {"id": "hist_cancelled", "title": "❌ Cancelled Visits"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(to=sender_phone, body_text=menu_text, buttons=buttons, header_text="History")
    message_service.log_message(db, sender_phone, "bot", menu_text, user_name, clinic_id=ctx.clinic_id)


async def start_reschedule_flow(
    db: Session,
    sender_phone: str,
    user_name: str,
    target_id: Optional[int] = None,
    ctx: Optional[ClinicContext] = None,
):
    """Initiates appointment rescheduling flow with doctor preference and policy check."""
    if not ctx or not ctx.is_valid:
        return

    from app.routers.patients import normalize_phone

    appts = booking_service.get_patient_upcoming_appointments(
        db, sender_phone, name=user_name, clinic_id=ctx.clinic_id
    )

    if not appts:
        msg = (
            f"ℹ️ *No Upcoming Appointments*\n\n"
            f"Hello *{user_name}*, you do not have any active appointments to reschedule at *{ctx.name}*.\n\n"
            f"Would you like to schedule a consultation?"
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # If target_id provided, look up that specific appointment
    target_appt = None
    if target_id:
        target_appt = next((a for a in appts if a.id == target_id), None)
        if not target_appt:
            existing = db.query(Appointment).filter(Appointment.id == target_id).first()
            if existing and normalize_phone(sender_phone) != normalize_phone(existing.patient.phone if existing.patient else ""):
                await ctx.send_text(sender_phone, "⚠️ You are not authorized to reschedule this appointment.")
                return
            await ctx.send_text(sender_phone, f"⚠️ Appointment #{target_id} was not found or is no longer active.")
            return

    # If exactly 1 upcoming appointment, select it directly
    if not target_appt and len(appts) == 1:
        target_appt = appts[0]

    if target_appt:
        clinic_obj = db.query(Clinic).filter(Clinic.id == ctx.clinic_id).first()
        allowed, reason = booking_service.check_reschedule_allowed(target_appt, clinic_obj)
        if not allowed:
            policy_text = getattr(clinic_obj, "cancellation_policy_text", None) or "Rescheduling allowed up to 2 hours before appointment."
            msg = (
                f"⚠️ *Rescheduling Not Permitted*\n\n"
                f"{reason}\n\n"
                f"📋 *Clinic Policy:* {policy_text}\n\n"
                f"If you need urgent assistance, please contact our clinic receptionist."
            )
            buttons = [
                {"id": "menu_human", "title": "💬 Receptionist"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Reschedule Restricted")
            booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
            message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
            return

        # Prompt patient: keep same doctor or choose different doctor
        pat_name = target_appt.patient.name if target_appt.patient else user_name
        doc_name = format_doc_name(target_appt.doctor.name if target_appt.doctor else "Doctor")
        doc_spec = target_appt.doctor.specialization if target_appt.doctor else "General Consultation"
        prompt = (
            f"🔄 *Reschedule Appointment #{target_appt.id}*\n\n"
            f"👤 *Patient:* {pat_name}\n"
            f"👨‍⚕️ *Doctor:* {doc_name} ({doc_spec})\n"
            f"📅 *Current Slot:* {target_appt.appointment_date} at {target_appt.start_time}\n\n"
            f"Would you like to keep *{doc_name}* or consult a different specialist?"
        )
        buttons = [
            {"id": f"res_same_doc_{target_appt.id}", "title": "👨‍⚕️ Same Doctor"},
            {"id": f"res_change_doc_{target_appt.id}", "title": "🔄 Change Doctor"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        context = {
            "clinic_id": ctx.clinic_id,
            "reschedule_appt_id": target_appt.id,
            "doctor_id": target_appt.doctor_id,
            "doctor_name": doc_name,
            "patient_name": pat_name,
        }
        booking_service.update_session(db, sender_phone, step="CHOOSING_RESCHEDULE_DOCTOR_OPTION", context=context, clinic_id=ctx.clinic_id)
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=prompt, buttons=buttons, header_text=f"Reschedule #{target_appt.id}")
        message_service.log_message(db, sender_phone, "bot", prompt, user_name, clinic_id=ctx.clinic_id)
        return

    # Multiple upcoming appointments: prompt patient to pick which one to reschedule
    rows = [
        {
            "id": f"resched_{a.id}",
            "title": f"Appt #{a.id} ({a.appointment_date})"[:24],
            "description": f"Dr. {a.doctor.name} at {a.start_time}"[:72],
        }
        for a in appts[:10]
    ]
    sections = [{"title": "Select Appointment to Reschedule", "rows": rows}]
    prompt_text = (
        f"📋 *Select Appointment to Reschedule*\n\n"
        f"You have {len(appts)} upcoming appointments at *{ctx.name}*. Please choose which booking to reschedule:"
    )
    await ctx.send_list_menu(
        to=sender_phone,
        body_text=prompt_text,
        button_label="🔄 Select Booking",
        sections=sections,
        header_text="Reschedule",
    )
    booking_service.update_session(
        db, sender_phone, step="SELECTING_RESCHEDULE_APPOINTMENT", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id
    )
    message_service.log_message(db, sender_phone, "bot", prompt_text, user_name, clinic_id=ctx.clinic_id)


async def present_reschedule_dates(
    db: Session,
    sender_phone: str,
    user_name: str,
    appt: Appointment,
    doctor: Optional[Doctor] = None,
    ctx: Optional[ClinicContext] = None,
):
    """Presents available new dates for rescheduling."""
    if not ctx or not ctx.is_valid:
        return

    target_doctor = doctor or appt.doctor
    dates = booking_service.get_available_dates(target_doctor, days_ahead=5)
    if not dates:
        msg = f"⚠️ Dr. {target_doctor.name} has no available slots this week to reschedule. Please contact clinic reception."
        buttons = [
            {"id": "menu_human", "title": "💬 Receptionist"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    pat_name = appt.patient.name if appt.patient else user_name
    context = {
        "clinic_id": ctx.clinic_id,
        "reschedule_appt_id": appt.id,
        "doctor_id": target_doctor.id,
        "doctor_name": target_doctor.name,
        "patient_name": pat_name,
    }
    booking_service.update_session(db, sender_phone, step="RESCHEDULING_DATE", context=context, clinic_id=ctx.clinic_id)

    date_rows = [
        {"id": f"resdate_{d['date_str']}", "title": d["display"], "description": "Reschedule to this day"}
        for d in dates
    ]
    sections = [{"title": f"Available Dates for Dr. {target_doctor.name}", "rows": date_rows}]
    prompt_text = (
        f"🔄 *Reschedule Appointment #{appt.id}*\n"
        f"Doctor: *Dr. {target_doctor.name}* ({target_doctor.specialization})\n"
        f"Current Slot: {appt.appointment_date} at {appt.start_time}\n\n"
        f"Please select your preferred *new date*:"
    )

    await ctx.send_list_menu(
        to=sender_phone,
        body_text=prompt_text,
        button_label="📅 Choose New Date",
        sections=sections,
        header_text="Step 1 of 2: New Date",
    )
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=prompt_text,
        patient_name=user_name,
        message_type="interactive",
        clinic_id=ctx.clinic_id,
    )


async def start_cancel_flow(
    db: Session,
    sender_phone: str,
    user_name: str,
    text: str = "",
    target_id: Optional[int] = None,
    ctx: Optional[ClinicContext] = None,
):
    """Processes appointment cancellation request with confirmation step."""
    if not ctx or not ctx.is_valid:
        return

    from app.routers.patients import normalize_phone

    if not target_id and text:
        parts = text.lower().split()
        for p in parts:
            clean_p = p.replace("#", "")
            if clean_p.isdigit():
                target_id = int(clean_p)
                break

    appts = booking_service.get_patient_upcoming_appointments(
        db, sender_phone, name=user_name, clinic_id=ctx.clinic_id
    )

    if not target_id and not appts:
        reply = (
            f"ℹ️ *No Upcoming Appointments*\n\n"
            f"Hello *{user_name}*, you do not have any upcoming appointments to cancel at *{ctx.name}*.\n\n"
            f"Would you like to schedule a consultation?"
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons)
        message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
        return

    if not target_id:
        if len(appts) == 1:
            target_id = appts[0].id
        else:
            prompt = (
                f"❓ *Which appointment would you like to cancel?*\n\n"
                f"You have {len(appts)} upcoming bookings at *{ctx.name}*. Please select one below:"
            )
            rows = [
                {
                    "id": f"cancel_req_{a.id}",
                    "title": f"❌ Cancel #{a.id}"[:24],
                    "description": f"Dr. {a.doctor.name} ({a.appointment_date} at {a.start_time})"[:72],
                }
                for a in appts[:10]
            ]
            sections = [{"title": "Your Active Bookings", "rows": rows}]
            await ctx.send_list_menu(
                to=sender_phone,
                body_text=prompt,
                button_label="❌ Cancel Booking",
                sections=sections,
                header_text="Cancel Appointment",
            )
            message_service.log_message(db, sender_phone, "bot", prompt, user_name, clinic_id=ctx.clinic_id)
            return

    target_appt = db.query(Appointment).filter(Appointment.id == target_id).first()
    if not target_appt or (target_appt.clinic_id and target_appt.clinic_id != ctx.clinic_id):
        await ctx.send_text(sender_phone, f"⚠️ Appointment #{target_id} was not found under {ctx.name}.")
        return

    # Cross-patient validation
    if normalize_phone(sender_phone) != normalize_phone(target_appt.patient.phone if target_appt.patient else ""):
        await ctx.send_text(sender_phone, "⚠️ You are not authorized to cancel this appointment.")
        return

    # Check if already cancelled
    if target_appt.status == "CANCELLED":
        reply = (
            f"ℹ️ *Appointment #{target_id} is already cancelled.*\n\n"
            f"Would you like to book a new appointment?"
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Book New Appt"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons, header_text="Already Cancelled")
        message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
        return

    # Check clinic cancellation policy cutoff
    clinic_obj = db.query(Clinic).filter(Clinic.id == ctx.clinic_id).first()
    allowed, reason = booking_service.check_cancel_allowed(target_appt, clinic_obj)
    if not allowed:
        policy_text = getattr(clinic_obj, "cancellation_policy_text", None) or "Cancellations allowed up to 2 hours before appointment."
        msg = (
            f"⚠️ *Cancellation Not Permitted*\n\n"
            f"{reason}\n\n"
            f"📋 *Clinic Policy:* {policy_text}\n\n"
            f"Please contact clinic reception for assistance."
        )
        buttons = [
            {"id": "menu_human", "title": "💬 Receptionist"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Cancellation Restricted")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # Present cancellation confirmation prompt
    pat_name = target_appt.patient.name if target_appt.patient else user_name
    doc_name = format_doc_name(target_appt.doctor.name if target_appt.doctor else "Doctor")
    doc_spec = target_appt.doctor.specialization if target_appt.doctor else "General Consultation"
    refund_note = ""
    if target_appt.payment_status == "PAID":
        paid_val = target_appt.paid_amount or 500
        refund_note = f"\n💳 *Note on Payment:* Online payment of ₹{paid_val} was recorded. As per clinic refund policy, please contact our reception for refund processing.\n"

    confirm_body = (
        f"⚠️ *Confirm Appointment Cancellation*\n\n"
        f"Are you sure you want to cancel the following appointment?\n\n"
        f"📋 *Booking ID:* #{target_appt.id}\n"
        f"👤 *Patient:* {pat_name}\n"
        f"👨‍⚕️ *Doctor:* {doc_name} ({doc_spec})\n"
        f"📅 *Date:* {target_appt.appointment_date}\n"
        f"⏰ *Time:* {target_appt.start_time} - {target_appt.end_time}\n"
        f"🏥 *Clinic:* {ctx.name}\n"
        f"{refund_note}\n"
        f"⚠️ _Note: This action will release your consultation slot._"
    )
    buttons = [
        {"id": f"confirm_cancel_{target_appt.id}", "title": "⚠️ Yes, Cancel Appt"},
        {"id": "btn_keep_booking", "title": "✅ Keep Appointment"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone, body_text=confirm_body, buttons=buttons, header_text="Cancel Confirmation"
    )
    message_service.log_message(db, sender_phone, "bot", confirm_body, user_name, clinic_id=ctx.clinic_id)


async def start_booking_flow(
    db: Session, sender_phone: str, user_name: str = "Valued Patient", ctx: Optional[ClinicContext] = None
):
    """
    Step 1 & 2: Initiates patient details collection.
    Asks whether the appointment is for Myself or Someone Else.
    """
    if not ctx or not ctx.is_valid:
        logger.warning("start_booking_flow rejected: invalid or unverified clinic context.")
        return

    context = {"clinic_id": ctx.clinic_id}
    booking_service.update_session(db, sender_phone, step="BOOKING_TARGET", context=context, clinic_id=ctx.clinic_id)

    body = (
        f"📅 *Book an Appointment*\n\n"
        f"Welcome to *{ctx.name}*!\n\n"
        f"Who is this consultation for?"
    )
    buttons = [
        {"id": "btn_book_self", "title": "👤 Myself"},
        {"id": "btn_book_other", "title": "👥 Someone Else"},
        {"id": "btn_menu", "title": "🏠 Main Menu"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text="Step 1: Patient Selection",
    )
    message_service.log_message(db, sender_phone, "bot", body, user_name, clinic_id=ctx.clinic_id)


async def prompt_patient_name(
    db: Session, sender_phone: str, user_name: str, booking_for: str, context: dict, ctx: ClinicContext
):
    """Step 3: Collects the patient's full name."""
    context["booking_for"] = booking_for
    context["clinic_id"] = ctx.clinic_id
    booking_service.update_session(db, sender_phone, step="COLLECTING_NAME", context=context, clinic_id=ctx.clinic_id)

    if booking_for == "self":
        body = (
            f"👤 *Patient Full Name*\n\n"
            f"Please reply with your *full legal name* for clinic registration:"
        )
    else:
        body = (
            f"👥 *Patient Full Name*\n\n"
            f"Please reply with the *full name* of the family member or person consulting:"
        )
    await ctx.send_text(to=sender_phone, text=body)
    message_service.log_message(db, sender_phone, "bot", body, user_name, clinic_id=ctx.clinic_id)


async def handle_patient_name_input(
    db: Session, sender_phone: str, user_name: str, name_text: str, context: dict, ctx: ClinicContext
):
    """Processes patient name input, searches existing patient record, and proceeds."""
    clean_name = name_text.strip().title()
    if len(clean_name) < 2:
        msg = "⚠️ Please provide a valid full name (at least 2 letters):"
        await ctx.send_text(to=sender_phone, text=msg)
        return

    context["patient_name"] = clean_name
    # Check if patient record already exists for this phone and name
    existing = booking_service.find_patient_by_phone(db, sender_phone, name=clean_name)
    if existing:
        context["patient_id"] = existing.id
        context["is_registered"] = True
        context["patient_type"] = "Returning"
        if existing.age:
            context["patient_age"] = existing.age
        if existing.gender and existing.gender != "Unspecified":
            context["patient_gender"] = existing.gender

    await advance_patient_details_flow(db, sender_phone, user_name, context, ctx)


async def advance_patient_details_flow(
    db: Session, sender_phone: str, user_name: str, context: dict, ctx: ClinicContext
):
    """Navigates through optional clinic-specific patient questions (Age -> Gender -> Registration -> Reason)."""
    # Step 4: Collect age only if required by clinic configuration and not already known
    if ctx.require_age and not context.get("patient_age"):
        booking_service.update_session(db, sender_phone, step="COLLECTING_AGE", context=context, clinic_id=ctx.clinic_id)
        msg = f"🎂 *Patient Age*\n\nPlease reply with *{context.get('patient_name')}*'s age in years (e.g. 28):"
        await ctx.send_text(to=sender_phone, text=msg)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # Step 5: Collect gender only if required by clinic configuration and not already known
    if ctx.require_gender and not context.get("patient_gender"):
        booking_service.update_session(db, sender_phone, step="COLLECTING_GENDER", context=context, clinic_id=ctx.clinic_id)
        msg = f"⚧ *Patient Gender*\n\nPlease select the gender for *{context.get('patient_name')}*:"
        buttons = [
            {"id": "gen_male", "title": "👨 Male"},
            {"id": "gen_female", "title": "👩 Female"},
            {"id": "gen_other", "title": "🧑 Other"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Gender")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # Step 6: Ask registration status if not already known
    if not context.get("is_registered"):
        booking_service.update_session(db, sender_phone, step="COLLECTING_REGISTRATION_STATUS", context=context, clinic_id=ctx.clinic_id)
        msg = (
            f"🏥 *Patient Registration*\n\n"
            f"Is *{context.get('patient_name')}* a new patient at *{ctx.name}*, or have they visited before?"
        )
        buttons = [
            {"id": "reg_new", "title": "🆕 New Patient"},
            {"id": "reg_existing", "title": "📋 Visited Before"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Registration")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # Step 7: Reason for consultation
    if "symptoms" not in context:
        booking_service.update_session(db, sender_phone, step="COLLECTING_REASON", context=context, clinic_id=ctx.clinic_id)
        if ctx.require_reason:
            msg = (
                f"🩺 *Reason for Consultation*\n\n"
                f"Please reply with the primary health concern or reason for visit for *{context.get('patient_name')}*:"
            )
            await ctx.send_text(to=sender_phone, text=msg)
        else:
            msg = (
                f"🩺 *Reason for Consultation (Optional)*\n\n"
                f"Please reply with the health concern or symptoms for *{context.get('patient_name')}*, or tap 'Skip' below:"
            )
            buttons = [
                {"id": "btn_skip_reason", "title": "⏭️ Skip Reason"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Reason for Visit")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    # Step 8: Proceed to Booking Method Selection
    await send_booking_mode_menu(db, sender_phone, user_name, context=context, ctx=ctx)


async def send_booking_mode_menu(
    db: Session, sender_phone: str, user_name: str, context: Optional[dict] = None, ctx: Optional[ClinicContext] = None
):
    """
    Step 8: Presents the 3 booking modes:
    1. General Doctor (Instant triage)
    2. Describe Symptoms (AI Recommendation)
    3. Select Doctor (Direct catalogue)
    """
    if not ctx or not ctx.is_valid:
        logger.warning("send_booking_mode_menu rejected: invalid or unverified clinic context.")
        return

    ctx_data = context or {"clinic_id": ctx.clinic_id, "patient_name": user_name}
    ctx_data["clinic_id"] = ctx.clinic_id
    booking_service.update_session(db, sender_phone, step="SELECTING_MODE", context=ctx_data, clinic_id=ctx.clinic_id)

    pat_name = ctx_data.get("patient_name") or user_name
    body = (
        f"📅 *Book an Appointment*\n\n"
        f"Booking for: *{pat_name}*\n\n"
        f"How would you like to proceed?\n\n"
        f"1️⃣ *General Doctor* — Fast booking for common health concerns (cold, fever, checkup).\n"
        f"2️⃣ *Select Doctor* — Choose directly from our list of specialists.\n"
        f"3️⃣ *Describe Symptoms* — Assistant matches the best specialist based on your concern."
    )
    buttons = [
        {"id": "mode_general", "title": "🩺 General Doctor"},
        {"id": "mode_doctors", "title": "👨‍⚕️ Select Doctor"},
        {"id": "mode_symptoms", "title": "💬 Describe Problem"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text="Step 8: Choose Doctor",
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


async def present_doctors_list(
    db: Session, sender_phone: str, user_name: str, context: dict, ctx: ClinicContext
):
    """Step 9: Shows active clinic doctors with actual consultation fee."""
    doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
    if not doctors:
        msg = f"No doctors are currently available at {ctx.name}. Please contact clinic reception directly."
        await ctx.send_text(to=sender_phone, text=msg)
        return

    context["clinic_id"] = ctx.clinic_id
    booking_service.update_session(db, sender_phone, step="SELECTING_DOCTOR", context=context, clinic_id=ctx.clinic_id)

    doc_rows = []
    for doc in doctors:
        fee_str = f"₹{doc.consultation_fee}" if (doc.consultation_fee and doc.consultation_fee > 0) else "Fee TBD"
        doc_rows.append({
            "id": f"doc_{doc.id}",
            "title": doc.name[:24],
            "description": f"{doc.specialization} ({fee_str})"[:72],
        })
    sections = [{"title": f"Specialists at {ctx.name}", "rows": doc_rows}]
    prompt_text = "Please choose a specialist for your consultation:"
    await ctx.send_list_menu(
        to=sender_phone,
        body_text=prompt_text,
        button_label="🩺 Select Doctor",
        sections=sections,
        header_text="Step 9: Specialist",
    )
    message_service.log_message(db, sender_phone, "bot", prompt_text, user_name, clinic_id=ctx.clinic_id)


async def present_available_dates(
    db: Session,
    sender_phone: str,
    user_name: str,
    doctor: Doctor,
    context: dict,
    ctx: Optional[ClinicContext] = None,
    prompt_prefix: Optional[str] = None,
):
    """Step 10: Presents upcoming available dates for the selected doctor."""
    if not ctx or not ctx.is_valid:
        logger.warning("present_available_dates rejected: invalid clinic context.")
        return
    context["clinic_id"] = ctx.clinic_id
    context["doctor_id"] = doctor.id
    context["doctor_name"] = doctor.name
    booking_service.update_session(db, sender_phone, step="SELECTING_DATE", context=context, clinic_id=ctx.clinic_id)

    dates = booking_service.get_available_dates(doctor, days_ahead=5)
    if not dates:
        msg = f"⚠️ Dr. {doctor.name} has no available slots this week. Please contact reception or choose another specialist."
        await ctx.send_text(to=sender_phone, text=msg)
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
        return

    date_rows = [
        {"id": f"date_{d['date_str']}", "title": d["display"], "description": "Select this day"}
        for d in dates
    ]
    sections = [{"title": "Upcoming Available Dates", "rows": date_rows}]
    default_prompt = f"Doctor: *Dr. {doctor.name}* ({doctor.specialization}).\nPlease select a convenient date for your visit:"
    prompt_text = f"{prompt_prefix}\n\n{default_prompt}" if prompt_prefix else default_prompt

    await ctx.send_list_menu(
        to=sender_phone,
        body_text=prompt_text,
        button_label="📅 Choose Date",
        sections=sections,
        header_text="Step 10: Select Date",
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


async def send_appointment_summary(
    db: Session, sender_phone: str, user_name: str, context: dict, ctx: ClinicContext
):
    """
    Step 12 & 13: Displays complete appointment summary and asks patient to confirm.
    Does NOT create appointment until patient clicks Confirm Appointment.
    """
    doctor_id = context.get("doctor_id")
    date_str = context.get("date_str")
    start_time = context.get("start_time")
    patient_name = context.get("patient_name") or user_name

    doctor = booking_service.get_doctor_by_id(db, doctor_id)
    if not doctor or not date_str or not start_time:
        await start_booking_flow(db, sender_phone, user_name, ctx=ctx)
        return

    if doctor.consultation_fee and doctor.consultation_fee > 0:
        fee_str = f"₹{doctor.consultation_fee}"
    else:
        fee_str = "To be confirmed by clinic"

    context["consultation_fee_display"] = fee_str
    booking_service.update_session(db, sender_phone, step="CONFIRMING_BOOKING", context=context, clinic_id=ctx.clinic_id)

    body = (
        f"📋 *Appointment Summary*\n\n"
        f"👤 *Patient Name:* {patient_name}\n"
        f"🩺 *Doctor:* Dr. {doctor.name} ({doctor.specialization})\n"
        f"📅 *Date:* {date_str}\n"
        f"⏰ *Time:* {start_time}\n"
        f"💳 *Consultation Fee:* {fee_str}\n"
        f"🏥 *Clinic:* {ctx.name}\n"
        f"📍 *Location:* {ctx.address}\n\n"
        f"Please review your details and confirm your booking below:"
    )
    buttons = [
        {"id": "btn_confirm_booking", "title": "✅ Confirm Booking"},
        {"id": "btn_change_details", "title": "✏️ Change Details"},
        {"id": "btn_cancel_booking", "title": "❌ Cancel"},
    ]
    await ctx.send_quick_reply_buttons(
        to=sender_phone,
        body_text=body,
        buttons=buttons,
        header_text="Step 12: Review & Confirm",
    )
    message_service.log_message(db, sender_phone, "bot", body, user_name, clinic_id=ctx.clinic_id)


async def confirm_and_create_appointment(
    db: Session, sender_phone: str, user_name: str, context: dict, ctx: ClinicContext
):
    """
    Step 14: Atomically verifies slot availability and creates appointment according to clinic payment policy.
    """
    doctor_id = context.get("doctor_id")
    date_str = context.get("date_str")
    start_time = context.get("start_time")
    patient_name = context.get("patient_name") or user_name
    symptoms = context.get("symptoms")

    doctor = booking_service.get_doctor_by_id(db, doctor_id)
    if not doctor or not date_str or not start_time:
        await start_booking_flow(db, sender_phone, user_name, ctx=ctx)
        return

    # 1. Atomic slot check
    available_slots = booking_service.get_available_slots(db, doctor_id, date_str)
    if start_time not in available_slots:
        warning_msg = (
            f"⚠️ We apologize, but the slot *{start_time}* on *{date_str}* was just booked by another patient!\n\n"
            f"Please choose another convenient time slot below:"
        )
        new_slots = booking_service.get_available_slots(db, doctor_id, date_str)
        if not new_slots:
            alt_msg = f"⚠️ All appointments are fully booked for Dr. {doctor.name} on {date_str}. Please choose another date by typing 'book'."
            await ctx.send_text(to=sender_phone, text=alt_msg)
            return

        slot_rows = [
            {"id": f"slot_{s}", "title": f"⏰ {s}", "description": "Select this time"}
            for s in new_slots[:10]
        ]
        sections = [{"title": f"Available Slots on {date_str}", "rows": slot_rows}]
        await ctx.send_list_menu(
            to=sender_phone,
            body_text=warning_msg,
            button_label="⏰ Choose New Slot",
            sections=sections,
            header_text="Slot Taken",
        )
        booking_service.update_session(db, sender_phone, step="SELECTING_SLOT", context=context, clinic_id=ctx.clinic_id)
        return

    # 2. Doctor fee
    doc_fee = doctor.consultation_fee if (doctor.consultation_fee and doctor.consultation_fee > 0) else 0
    fee_str = f"₹{doc_fee}" if doc_fee > 0 else "To be confirmed by clinic"

    policy = ctx.payment_policy

    # 3. Handle by Clinic Payment Policy
    if policy == "ONLINE_REQUIRED":
        appt_status = "PENDING"
        pay_status = "PENDING"
        pay_method = "Online Payment Required"
    elif policy == "ADVANCE_PAYMENT":
        appt_status = "PENDING"
        pay_status = "PENDING"
        pay_method = "Advance Payment"
    else:  # PAY_AT_CLINIC
        appt_status = "CONFIRMED"
        pay_status = "PENDING"
        pay_method = "Pay at Clinic"

    appointment = booking_service.book_appointment(
        db=db,
        phone=sender_phone,
        patient_name=patient_name,
        doctor_id=doctor_id,
        date_str=date_str,
        start_time=start_time,
        source="WhatsApp",
        notes=symptoms,
        gender=context.get("patient_gender"),
        age=context.get("patient_age"),
        status=appt_status,
        payment_status=pay_status,
        payment_method=pay_method,
        paid_amount=0,
        clinic_id=ctx.clinic_id,
    )

    if not appointment:
        msg = "⚠️ Could not complete your booking due to a concurrency lock. Please select a slot again."
        await ctx.send_text(to=sender_phone, text=msg)
        return

    # Reset session to IDLE
    booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)

    symptom_line = f"🩺 *Reason:* _{symptoms}_\n" if symptoms and symptoms != "General Consultation" else ""

    # Generate payment link if required or if configured
    pay_url = None
    if policy in ["ONLINE_REQUIRED", "ADVANCE_PAYMENT"] or getattr(settings, "RAZORPAY_ENABLED", False):
        try:
            from app.services.razorpay_service import razorpay_service
            if razorpay_service.is_configured:
                amount_to_charge = doc_fee
                if policy == "ADVANCE_PAYMENT":
                    amount_to_charge = ctx.advance_amount if not ctx.advance_percentage else int(doc_fee * ctx.advance_percentage / 100)
                if amount_to_charge > 0:
                    link_obj = await razorpay_service.create_payment_link(
                        amount_rupees=float(amount_to_charge),
                        description=f"{pay_method} - Dr. {doctor.name} ({date_str})",
                        customer_name=patient_name,
                        customer_phone=sender_phone,
                        appointment_id=appointment.id,
                        clinic_id=ctx.clinic_id,
                    )
                    if link_obj:
                        pay_url = link_obj.get("payment_url")
        except Exception as e:
            logger.warning(f"Could not generate Razorpay link: {e}")

    if policy == "ONLINE_REQUIRED":
        res_text = (
            f"⏳ *SLOT RESERVED (PAYMENT REQUIRED)*\n\n"
            f"📋 *Booking ID:* #{appointment.id}\n"
            f"👤 *Patient:* {patient_name}\n"
            f"🩺 *Doctor:* Dr. {doctor.name} ({doctor.specialization})\n"
            f"📅 *Date:* {date_str}\n"
            f"⏰ *Time:* {appointment.start_time} - {appointment.end_time}\n"
            f"💳 *Consultation Fee:* {fee_str}\n\n"
            f"⚡ *Complete Online Payment to Confirm:*\n"
            f"{pay_url or 'Please contact clinic for payment link'}\n\n"
            f"⚠️ _Your slot is held for {ctx.payment_link_expiry_mins} minutes. Once payment is verified, your booking will be confirmed automatically!_"
        )
        buttons = [
            {"id": "btn_view", "title": "📋 My Bookings"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=res_text, buttons=buttons, header_text="Payment Required")
    elif policy == "ADVANCE_PAYMENT":
        res_text = (
            f"⏳ *SLOT RESERVED (ADVANCE PAYMENT REQUIRED)*\n\n"
            f"📋 *Booking ID:* #{appointment.id}\n"
            f"👤 *Patient:* {patient_name}\n"
            f"🩺 *Doctor:* Dr. {doctor.name}\n"
            f"📅 *Date:* {date_str}\n"
            f"⏰ *Time:* {appointment.start_time} - {appointment.end_time}\n"
            f"💳 *Advance Required:* ₹{ctx.advance_amount}\n\n"
            f"👉 Pay advance to confirm:\n"
            f"{pay_url or 'Payment link unavailable'}\n\n"
            f"Remaining balance of ₹{max(0, doc_fee - ctx.advance_amount)} can be paid at clinic."
        )
        buttons = [
            {"id": "btn_view", "title": "📋 My Bookings"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=res_text, buttons=buttons, header_text="Advance Required")
    else:  # PAY_AT_CLINIC
        conf_text = (
            f"🎉 *APPOINTMENT CONFIRMED!*\n\n"
            f"📋 *Booking ID:* #{appointment.id}\n"
            f"👤 *Patient:* {patient_name}\n"
            f"🩺 *Doctor:* Dr. {doctor.name} ({doctor.specialization})\n"
            f"{symptom_line}"
            f"📅 *Date:* {date_str}\n"
            f"⏰ *Time:* {appointment.start_time} - {appointment.end_time}\n"
            f"💳 *Consultation Fee:* {fee_str}\n"
            f"💵 *Payment:* ⏳ Pay at Clinic Reception\n"
            f"📍 *Clinic:* {ctx.name}\n"
            f"🏢 *Address:* {ctx.address}\n\n"
            f"Please arrive 10 minutes early. To view or cancel anytime, send 'my appointments'."
        )
        buttons = [
            {"id": "btn_view", "title": "📋 My Appointments"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=conf_text, buttons=buttons, header_text="Appointment Confirmed")
        logged_text = conf_text

    logged_msg = res_text if policy in ["ONLINE_REQUIRED", "ADVANCE_PAYMENT"] else logged_text
    message_service.log_message(
        db=db,
        phone=sender_phone,
        sender="bot",
        body=logged_msg,
        patient_name=user_name,
        message_type="booking_confirmation",
        clinic_id=ctx.clinic_id,
    )

    # Phase 5: Event Notification Log (CONFIRMATION)
    try:
        from app.models import NotificationLog
        slot_key = f"{appointment.appointment_date}_{appointment.start_time[:5]}"
        notif_log = NotificationLog(
            clinic_id=ctx.clinic_id,
            appointment_id=appointment.id,
            patient_id=appointment.patient_id,
            recipient_phone=sender_phone,
            notification_type="CONFIRMATION",
            appointment_slot=slot_key,
            status="SENT",
            message_body=logged_msg,
            sent_at=datetime.datetime.utcnow(),
        )
        db.add(notif_log)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.debug(f"Confirmation notification log note: {e}")


async def handle_symptom_text(
    db: Session, sender_phone: str, user_name: str, text: str, ctx: Optional[ClinicContext] = None
):
    """Analyzes patient symptoms safely and suggests the best matching doctor, or offers receptionist assistance."""
    if not ctx or not ctx.is_valid:
        logger.warning("handle_symptom_text rejected: invalid clinic context.")
        return

    # 1. Conservative Emergency Safety Check (halt appointment flow on warning signs)
    is_emergency, cat_key, label = safety_service.detect_emergency(text, clinic=ctx.clinic)
    if is_emergency:
        logger.warning(f"EMERGENCY DETECTED in symptom input for {sender_phone}: category={cat_key}, label={label}")
        body = safety_service.build_emergency_message(ctx.clinic, label)
        buttons = [
            {"id": "btn_human", "title": "💬 Talk to Reception"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        # Reset session to prevent trapping the patient in booking flow during an emergency
        booking_service.update_session(db, sender_phone, step="IDLE", context={}, clinic_id=ctx.clinic_id)
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=body,
            buttons=buttons,
            header_text="🚨 URGENT MEDICAL NOTICE",
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
        return

    doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
    if not doctors:
        msg = (
            f"No doctors are currently available at {ctx.name}.\n\n"
            f"Please talk directly to our clinic reception team for appointment assistance or inquiries."
        )
        buttons = [
            {"id": "btn_human", "title": "💬 Talk to Reception"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=msg,
            buttons=buttons,
            header_text=ctx.name,
        )
        message_service.log_message(
            db=db,
            phone=sender_phone,
            sender="bot",
            body=msg,
            patient_name=user_name,
            message_type="interactive",
            clinic_id=ctx.clinic_id,
        )
        return

    rec = await ai_service.recommend_doctor_by_symptoms(text, doctors)
    doc_id = rec.get("doctor_id")
    confidence = rec.get("confidence", "LOW")
    reasoning = rec.get("reasoning", "")

    doctor = booking_service.get_doctor_by_id(db, doc_id) if doc_id else None

    # STRICT REQUIREMENT: Do NOT silently select the first doctor (doctors[0])!
    # If no matching specialist is identified with confidence, offer receptionist routing.
    if not doctor or confidence == "LOW":
        body = (
            f"🩺 *Doctor Recommendation Assistance*\n\n"
            f"Based on your symptoms: _{text.strip()}_\n\n"
            f"We could not find an exact matching specialist available at {ctx.name} with high certainty.\n\n"
            f"💬 Our clinic reception team can help guide you to the right department or doctor.\n\n"
            f"_{MEDICAL_SAFETY_DISCLAIMER}_"
        )
        buttons = [
            {"id": "btn_human", "title": "💬 Talk to Reception"},
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
        return

    session = booking_service.get_session(db, sender_phone, clinic_id=ctx.clinic_id)
    context = json.loads(session.context_data or "{}")
    context["clinic_id"] = ctx.clinic_id
    context["doctor_id"] = doctor.id
    context["doctor_name"] = doctor.name
    context["symptoms"] = text.strip()

    booking_service.update_session(db, sender_phone, step="CONFIRM_RECOMMENDED_DOCTOR", context=context, clinic_id=ctx.clinic_id)

    rec_reason = reasoning if reasoning else f"Based on your symptoms, a consultation with {doctor.specialization} is suggested."
    body = (
        f"🩺 *Doctor Recommendation*\n\n"
        f"Based on what you described:\n"
        f"_{text.strip()}_\n\n"
        f"💡 {rec_reason}\n\n"
        f"We recommend: *{format_doc_name(doctor.name)}*\n"
        f"({doctor.specialization})\n\n"
        f"_{MEDICAL_SAFETY_DISCLAIMER}_\n\n"
        f"Would you like to book with *{format_doc_name(doctor.name)}*?"
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
    """Processes user text input with robust command parsing, navigation, and graceful fallback."""
    if not ctx or not ctx.is_valid:
        logger.warning("handle_user_text rejected: invalid or unverified clinic context.")
        return

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

    session = booking_service.get_session(db, sender_phone, clinic_id=ctx.clinic_id)
    context = json.loads(session.context_data or "{}")
    context["clinic_id"] = ctx.clinic_id
    cmd = match_text_command(text)

    # 2. Global text command routing
    if cmd == "menu":
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
        await send_main_menu(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "reschedule":
        await start_reschedule_flow(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "cancel":
        await start_cancel_flow(db, sender_phone, user_name, text=text, ctx=ctx)
        return

    if cmd == "my_appointments":
        await show_patient_appointments(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "book":
        await start_booking_flow(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "doctors":
        await present_doctors_list(db, sender_phone, user_name, context, ctx=ctx)
        return

    if cmd == "clinic_info":
        await show_clinic_and_doctors_info(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "human":
        await talk_to_receptionist(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "faq":
        await show_clinic_faqs(db, sender_phone, user_name, ctx=ctx)
        return

    if cmd == "abha":
        patient = booking_service.find_patient_by_phone(db, sender_phone, name=user_name)
        if not patient:
            patient = booking_service.find_patient_by_phone(db, sender_phone)
        if patient and patient.abha_number:
            masked = mask_abha(patient.abha_number)
            status = (patient.abha_status or "ENTERED").upper()
            if status == "VERIFIED":
                reply = (
                    f"🇮🇳 *YOUR OFFICIAL ABHA HEALTH ID*\n\n"
                    f"Hello *{patient.name}*,\n"
                    f"Your Government ABHA account is verified and linked with *{ctx.name}*:\n\n"
                    f"💳 *ABHA Number:* {masked}\n"
                    f"🔗 *ABHA Address:* {patient.abha_address or 'N/A'}\n"
                    f"✅ *Status:* Government Verified (ABDM M1)\n\n"
                    f"All your digital prescriptions and lab reports are linked to your ABHA."
                )
            elif status == "CONSENTED":
                reply = (
                    f"🇮🇳 *ABHA HEALTH ID - CONSENT RECORDED*\n\n"
                    f"Hello *{patient.name}*,\n"
                    f"Your consent to link your ABHA Health ID has been recorded:\n\n"
                    f"💳 *ABHA Number:* {masked}\n"
                    f"🔗 *ABHA Address:* {patient.abha_address or 'Pending'}\n"
                    f"⏳ *Status:* Consent Granted (Verification Pending)\n\n"
                    f"⚠️ Please complete OTP verification at clinic reception or on the portal to link digital prescriptions and lab reports."
                )
            else:
                reply = (
                    f"🇮🇳 *ABHA HEALTH ID - UNVERIFIED*\n\n"
                    f"Hello *{patient.name}*,\n"
                    f"An ABHA number has been entered for your profile:\n\n"
                    f"💳 *ABHA Number:* {masked}\n"
                    f"⚠️ *Status:* Entered / Unverified\n\n"
                    f"Note: This ABHA number is NOT yet verified with the Government ABDM system. "
                    f"Prescriptions and diagnostic records are NOT linked until OTP verification is completed at reception."
                )
        else:
            reply = (
                f"🇮🇳 *AYUSHMAN BHARAT DIGITAL MISSION (ABDM)*\n\n"
                f"Hello *{user_name}*,\n"
                f"Your 14-digit ABHA Health ID is not yet linked with our clinic.\n\n"
                f"You can create or verify your ABHA ID at our clinic reception desk, or by visiting our patient portal."
            )
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons, header_text=ctx.name)
        message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
        return

    # 3. Patient Details Collection (Phase 3)
    if session.step == "COLLECTING_NAME":
        await handle_patient_name_input(db, sender_phone, user_name, text, context, ctx)
        return

    if session.step == "COLLECTING_AGE":
        clean_text = text.strip()
        try:
            val_age = int(clean_text)
            if 0 <= val_age <= 125:
                context["patient_age"] = val_age
            else:
                msg = "⚠️ Please enter a realistic age between 0 and 125:"
                await ctx.send_text(to=sender_phone, text=msg)
                return
        except ValueError:
            msg = "⚠️ Please reply with your age as a number (e.g. 28):"
            await ctx.send_text(to=sender_phone, text=msg)
            return
        await advance_patient_details_flow(db, sender_phone, user_name, context, ctx)
        return

    if session.step == "COLLECTING_REASON":
        if text.strip().lower() in ["skip", "none", "no", "nahi"]:
            context["symptoms"] = "General Consultation"
        else:
            is_emergency, cat_key, label = safety_service.detect_emergency(text, clinic=ctx.clinic)
            if is_emergency:
                logger.warning(f"EMERGENCY DETECTED in reason for consultation from {sender_phone}: category={cat_key}, label={label}")
                body = safety_service.build_emergency_message(ctx.clinic, label)
                buttons = [
                    {"id": "btn_human", "title": "💬 Talk to Reception"},
                    {"id": "btn_menu", "title": "🏠 Main Menu"},
                ]
                booking_service.update_session(db, sender_phone, step="IDLE", context={}, clinic_id=ctx.clinic_id)
                await ctx.send_quick_reply_buttons(
                    to=sender_phone,
                    body_text=body,
                    buttons=buttons,
                    header_text="🚨 URGENT MEDICAL NOTICE",
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
                return
            context["symptoms"] = text.strip()
        await advance_patient_details_flow(db, sender_phone, user_name, context, ctx)
        return

    # 4. If currently in symptom input step from Describe Problem mode
    if session.step == "AWAITING_SYMPTOMS":
        await handle_symptom_text(db, sender_phone, user_name, text, ctx=ctx)
        return

    # Post-Consultation Feedback Comments Collection (Phase 8)
    if session.step == "AWAITING_FEEDBACK_COMMENTS":
        if cmd in ["menu", "hi", "hello"]:
            booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
            await present_main_menu(db, sender_phone, user_name, ctx=ctx)
            return

        appt_id = context.get("feedback_appt_id")
        if appt_id:
            from app.models import PatientFeedback
            fb = db.query(PatientFeedback).filter(PatientFeedback.appointment_id == appt_id).first()
            if fb:
                fb.comments = text.strip()
                db.commit()

        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
        reply = (
            f"✅ *Thank You for Your Feedback!*\n\n"
            f"We have recorded your comments. Your feedback helps our clinical and reception team at *{ctx.name}* "
            f"continue to provide top-quality healthcare."
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons, header_text=ctx.name)
        message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
        return

    # 5. Graceful handling of unexpected text during active selection flows
    if session.step == "CONFIRMING_BOOKING":
        prompt = (
            f"❓ Please confirm your appointment above, or choose an option below:\n\n"
            f"• Tap *Confirm Booking* to finalize\n"
            f"• Tap *Change Details* to edit\n"
            f"• Tap *Cancel* to discard"
        )
        buttons = [
            {"id": "btn_confirm_booking", "title": "✅ Confirm Booking"},
            {"id": "btn_change_details", "title": "✏️ Change Details"},
            {"id": "btn_cancel_booking", "title": "❌ Cancel"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=prompt, buttons=buttons, header_text="Confirm Booking")
        return

    active_selection_steps = [
        "BOOKING_TARGET",
        "COLLECTING_GENDER",
        "COLLECTING_REGISTRATION_STATUS",
        "SELECTING_MODE",
        "SELECTING_DOCTOR",
        "SELECTING_DATE",
        "SELECTING_SLOT",
        "SELECTING_RESCHEDULE_APPOINTMENT",
        "RESCHEDULING_DATE",
        "RESCHEDULING_SLOT",
    ]
    if session.step in active_selection_steps:
        prompt = (
            f"❓ We received your message: \"{text[:50]}\".\n\n"
            f"Please make a selection from the options above, or choose below to proceed:"
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Start Over"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=prompt, buttons=buttons, header_text=ctx.name)
        message_service.log_message(db, sender_phone, "bot", prompt, user_name, clinic_id=ctx.clinic_id)
        return

    # 5. Medical Query Check (Strict clinical separation from administrative FAQs)
    if faq_service.is_medical_query(text):
        is_emergency, cat_key, label = safety_service.detect_emergency(text, clinic=ctx.clinic)
        if is_emergency:
            logger.warning(f"EMERGENCY DETECTED in medical query from {sender_phone}: category={cat_key}, label={label}")
            body = safety_service.build_emergency_message(ctx.clinic, label)
            buttons = [
                {"id": "btn_human", "title": "💬 Talk to Reception"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            booking_service.update_session(db, sender_phone, step="IDLE", context={}, clinic_id=ctx.clinic_id)
            await ctx.send_quick_reply_buttons(
                to=sender_phone,
                body_text=body,
                buttons=buttons,
                header_text="🚨 URGENT MEDICAL NOTICE",
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
            return

        doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
        if doctors:
            rec = await ai_service.recommend_doctor_by_symptoms(text, doctors)
            if rec.get("confidence") in ["HIGH", "MEDIUM"]:
                await handle_symptom_text(db, sender_phone, user_name, text, ctx=ctx)
                return
        # If no specific doctor match found, provide medical disclaimer directing to doctor consultation
        med_reply = (
            f"🩺 *Medical Consultation Advice*\n\n"
            f"For medical questions, diagnoses, or prescriptions, please consult a qualified doctor at *{ctx.name}*. "
            f"Automated systems cannot provide medical treatments.\n\n"
            f"_{MEDICAL_SAFETY_DISCLAIMER}_\n\n"
            f"Please choose an option below to schedule a doctor consultation or speak with reception:"
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_human", "title": "💬 Talk to Reception"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=med_reply, buttons=buttons, header_text=ctx.name)
        message_service.log_message(db, sender_phone, "bot", med_reply, user_name, clinic_id=ctx.clinic_id)
        return

    # 6. Clinic FAQ & Knowledge Base Answering (Phase 6)
    faq_match = faq_service.find_matching_faq(db, ctx.clinic_id, text)
    if faq_match:
        reply = f"ℹ️ *{faq_match.question}*\n\n{faq_match.answer}"
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_human", "title": "💬 Talk to Reception"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons, header_text=ctx.name)
        message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
        return

    # If user sent a question or query that had NO matching FAQ, offer receptionist handover
    clean_lower = text.lower()
    is_question = (
        "?" in text
        or any(w in clean_lower for w in ["what", "where", "when", "how", "who", "why", "is", "can", "does", "do", "tell me", "kahan", "kaise", "fees", "fee", "cost", "price", "timing", "hours", "pharmacy", "lab", "test", "walkin"])
        or len(text.split()) >= 3
    )
    if is_question:
        unavail_reply = (
            f"I'm sorry, I couldn't find an answer to your question in *{ctx.name}'s* approved clinic information.\n\n"
            f"Would you like to speak directly with our reception team for personalized assistance?"
        )
        buttons = [
            {"id": "btn_human", "title": "💬 Talk to Reception"},
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=unavail_reply, buttons=buttons, header_text=ctx.name)
        message_service.log_message(db, sender_phone, "bot", unavail_reply, user_name, clinic_id=ctx.clinic_id)
        return

    # 6. Default to main menu
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
    """Processes button replies with unified navigation and action routing."""
    if not ctx or not ctx.is_valid:
        logger.warning("handle_user_button rejected: invalid or unverified clinic context.")
        return

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

    session = booking_service.get_session(db, sender_phone, clinic_id=ctx.clinic_id)
    context = json.loads(session.context_data or "{}")
    context["clinic_id"] = ctx.clinic_id

    if button_id in ["btn_book", "menu_book"]:
        await start_booking_flow(db, sender_phone, user_name, ctx=ctx)

    elif button_id == "btn_book_self":
        await prompt_patient_name(db, sender_phone, user_name, "self", context, ctx)

    elif button_id == "btn_book_other":
        await prompt_patient_name(db, sender_phone, user_name, "other", context, ctx)

    elif button_id in ["gen_male", "gen_female", "gen_other"]:
        g_map = {"gen_male": "Male", "gen_female": "Female", "gen_other": "Other"}
        context["patient_gender"] = g_map[button_id]
        await advance_patient_details_flow(db, sender_phone, user_name, context, ctx)

    elif button_id in ["reg_new", "reg_existing"]:
        context["patient_type"] = "New Patient" if button_id == "reg_new" else "Returning Patient"
        context["is_registered"] = True
        await advance_patient_details_flow(db, sender_phone, user_name, context, ctx)

    elif button_id == "btn_skip_reason":
        context["symptoms"] = "General Consultation"
        await advance_patient_details_flow(db, sender_phone, user_name, context, ctx)

    elif button_id == "btn_confirm_booking":
        await confirm_and_create_appointment(db, sender_phone, user_name, context, ctx)

    elif button_id == "btn_change_details":
        body = (
            f"✏️ *Change Booking Details*\n\n"
            f"What would you like to update?"
        )
        buttons = [
            {"id": "mode_doctors", "title": "👨‍⚕️ Change Doctor"},
            {"id": "btn_change_slot", "title": "📅 Change Date/Time"},
            {"id": "btn_book_self", "title": "👤 Change Patient"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=body, buttons=buttons, header_text="Edit Details")

    elif button_id == "btn_change_slot":
        doctor_id = context.get("doctor_id")
        doctor = booking_service.get_doctor_by_id(db, doctor_id) if doctor_id else None
        if doctor:
            await present_available_dates(db, sender_phone, user_name, doctor, context, ctx=ctx)
        else:
            await present_doctors_list(db, sender_phone, user_name, context, ctx=ctx)

    elif button_id == "btn_cancel_booking":
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
        msg = (
            f"❌ *Appointment Booking Cancelled*\n\n"
            f"Your appointment was not booked. Whenever you are ready, type 'book' or 'menu'."
        )
        buttons = [
            {"id": "btn_book", "title": "📅 Book Appointment"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text=ctx.name)

    elif button_id in ["btn_menu", "btn_back", "menu", "back"]:
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
        await send_main_menu(db, sender_phone, user_name, ctx=ctx)

    elif button_id in ["btn_reschedule", "menu_reschedule"]:
        await start_reschedule_flow(db, sender_phone, user_name, ctx=ctx)

    elif button_id in ["btn_cancel", "menu_cancel"]:
        await start_cancel_flow(db, sender_phone, user_name, ctx=ctx)

    elif button_id in ["btn_view", "btn_my_appointments", "menu_view"]:
        await show_patient_appointments(db, sender_phone, user_name, ctx=ctx)

    elif button_id in ["btn_info", "btn_clinic_info", "menu_info"]:
        await show_clinic_and_doctors_info(db, sender_phone, user_name, ctx=ctx)

    elif button_id in ["btn_human", "btn_reception", "btn_receptionist", "menu_human"]:
        await talk_to_receptionist(db, sender_phone, user_name, ctx=ctx)

    elif button_id in ["btn_faq", "menu_faq"]:
        await show_clinic_faqs(db, sender_phone, user_name, ctx=ctx)

    elif button_id == "mode_general":
        doctor = booking_service.get_general_physician(db, clinic_id=ctx.clinic_id)
        if not doctor:
            await present_doctors_list(db, sender_phone, user_name, context, ctx=ctx)
            return
        context["doctor_id"] = doctor.id
        context["doctor_name"] = doctor.name
        if "symptoms" not in context:
            context["symptoms"] = "General Consultation"
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
        if context.get("symptoms") and context.get("symptoms") != "General Consultation":
            await handle_symptom_text(db, sender_phone, user_name, context["symptoms"], ctx=ctx)
        else:
            booking_service.update_session(db, sender_phone, step="AWAITING_SYMPTOMS", context=context, clinic_id=ctx.clinic_id)
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
        await present_doctors_list(db, sender_phone, user_name, context, ctx=ctx)

    elif button_id.startswith("rec_accept_"):
        doc_id = int(button_id.replace("rec_accept_", ""))
        doctor = booking_service.get_doctor_by_id(db, doc_id)
        if not doctor:
            await present_doctors_list(db, sender_phone, user_name, context, ctx=ctx)
            return
        context["doctor_id"] = doctor.id
        context["doctor_name"] = doctor.name
        await present_available_dates(db, sender_phone, user_name, doctor, context, ctx=ctx)

    elif button_id.startswith("manage_"):
        appt_id = int(button_id.replace("manage_", ""))
        await show_appointment_management(db, sender_phone, user_name, appt_id, ctx=ctx)

    elif button_id == "btn_history":
        await show_appointment_history(db, sender_phone, user_name, "menu", ctx=ctx)

    elif button_id == "hist_past":
        await show_appointment_history(db, sender_phone, user_name, "past", ctx=ctx)

    elif button_id == "hist_cancelled":
        await show_appointment_history(db, sender_phone, user_name, "cancelled", ctx=ctx)

    elif button_id.startswith("res_same_doc_"):
        appt_id = int(button_id.replace("res_same_doc_", ""))
        appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        if appt:
            await present_reschedule_dates(db, sender_phone, user_name, appt, doctor=appt.doctor, ctx=ctx)

    elif button_id.startswith("res_change_doc_"):
        appt_id = int(button_id.replace("res_change_doc_", ""))
        appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        if appt:
            doctors = booking_service.get_active_doctors(db, clinic_id=ctx.clinic_id)
            rows = [
                {
                    "id": f"resdoc_{d.id}_{appt_id}",
                    "title": f"Dr. {d.name}"[:24],
                    "description": f"{d.specialization} (Fee: ₹{d.consultation_fee or 500})"[:72],
                }
                for d in doctors[:10]
            ]
            sections = [{"title": "Select Specialist Doctor", "rows": rows}]
            prompt = (
                f"🔄 *Select New Specialist for Appt #{appt_id}*\n\n"
                f"Please choose which doctor you would like to consult:"
            )
            await ctx.send_list_menu(
                to=sender_phone,
                body_text=prompt,
                button_label="👨‍⚕️ Choose Doctor",
                sections=sections,
                header_text="Change Doctor",
            )
            message_service.log_message(db, sender_phone, "bot", prompt, user_name, clinic_id=ctx.clinic_id)

    elif button_id == "btn_confirm_resched":
        from app.routers.patients import normalize_phone

        appt_id = context.get("reschedule_appt_id")
        new_date = context.get("new_date")
        new_slot = context.get("new_slot")
        doctor_id = context.get("doctor_id")

        if not appt_id or not new_date or not new_slot:
            await ctx.send_text(sender_phone, "⚠️ Rescheduling session expired. Please type 'reschedule' to start again.")
            return

        appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        if not appt or (appt.clinic_id and appt.clinic_id != ctx.clinic_id):
            await ctx.send_text(sender_phone, f"⚠️ Appointment #{appt_id} was not found.")
            return

        # Cross-patient verification
        if normalize_phone(sender_phone) != normalize_phone(appt.patient.phone if appt.patient else ""):
            await ctx.send_text(sender_phone, "⚠️ Unauthorized access to appointment.")
            return

        # Recheck cutoff policy immediately before confirming
        clinic_obj = db.query(Clinic).filter(Clinic.id == ctx.clinic_id).first()
        allowed, reason = booking_service.check_reschedule_allowed(appt, clinic_obj)
        if not allowed:
            policy_text = getattr(clinic_obj, "cancellation_policy_text", None) or "Rescheduling allowed up to 2 hours before appointment."
            msg = f"⚠️ *Rescheduling Not Permitted*\n\n{reason}\n\n📋 *Clinic Policy:* {policy_text}"
            buttons = [
                {"id": "menu_human", "title": "💬 Receptionist"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Restricted")
            booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
            return

        try:
            updated_appt = booking_service.reschedule_appointment(
                db=db,
                appointment_id=appt_id,
                date_str=new_date,
                start_time=new_slot,
                doctor_id=doctor_id,
                notes="Rescheduled via WhatsApp",
                clinic_id=ctx.clinic_id,
            )
            booking_service.update_session(
                db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id
            )
            doc_name = format_doc_name(updated_appt.doctor.name if updated_appt.doctor else "Doctor")
            pat_name = updated_appt.patient.name if updated_appt.patient else user_name
            pay_status = updated_appt.payment_status or "PENDING"
            pay_note = f"💳 *Payment:* {pay_status} (Preserved)\n" if pay_status == "PAID" else ""
            conf_text = (
                f"✅ *APPOINTMENT RESCHEDULED!*\n\n"
                f"📋 *Booking ID:* #{updated_appt.id}\n"
                f"👤 *Patient:* {pat_name}\n"
                f"🩺 *Doctor:* {doc_name} ({updated_appt.doctor.specialization if updated_appt.doctor else 'General'})\n"
                f"📅 *New Date:* {updated_appt.appointment_date}\n"
                f"⏰ *New Time:* {updated_appt.start_time} - {updated_appt.end_time}\n"
                f"⏮️ *Previous Slot:* {updated_appt.previous_slot}\n"
                f"{pay_note}"
                f"📍 *Clinic:* {ctx.name}\n\n"
                f"Your appointment has been successfully updated. Please arrive 10 minutes prior to your slot."
            )
            buttons = [
                {"id": "btn_view", "title": "📋 My Appointments"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(
                to=sender_phone,
                body_text=conf_text,
                buttons=buttons,
                header_text="Reschedule Confirmed",
            )
            message_service.log_message(
                db=db,
                phone=sender_phone,
                sender="bot",
                body=conf_text,
                patient_name=user_name,
                message_type="reschedule_confirmation",
                clinic_id=ctx.clinic_id,
            )

            # Phase 5: Event Notification Log (RESCHEDULED)
            try:
                from app.models import NotificationLog
                new_slot_key = f"{updated_appt.appointment_date}_{updated_appt.start_time[:5]}"
                notif_log = NotificationLog(
                    clinic_id=ctx.clinic_id,
                    appointment_id=updated_appt.id,
                    patient_id=updated_appt.patient_id,
                    recipient_phone=sender_phone,
                    notification_type="RESCHEDULED",
                    appointment_slot=new_slot_key,
                    status="SENT",
                    message_body=conf_text,
                    sent_at=datetime.datetime.utcnow(),
                )
                db.add(notif_log)
                db.commit()
            except Exception as e:
                db.rollback()
                logger.debug(f"Reschedule notification log note: {e}")
        except Exception as e:
            logger.warning(f"Rescheduling failed for appointment #{appt_id}: {e}")
            err_text = (
                f"⚠️ *Slot No Longer Available*\n\n"
                f"{str(e)}\n\n"
                f"Your original appointment #{appt_id} on {appt.appointment_date} at {appt.start_time} remains unchanged.\n"
                f"Please select an alternative date or time."
            )
            buttons = [
                {"id": f"resched_{appt_id}", "title": "🔄 Try Again"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=err_text, buttons=buttons, header_text="Slot Unavailable")
            message_service.log_message(db, sender_phone, "bot", err_text, user_name, clinic_id=ctx.clinic_id)

    elif button_id == "btn_cancel_resched":
        appt_id = context.get("reschedule_appt_id")
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
        msg = (
            f"ℹ️ *Reschedule Cancelled*\n\n"
            f"Your appointment #{appt_id or ''} remains unchanged and confirmed at *{ctx.name}*.\n\n"
            f"Type 'menu' anytime to manage your appointments."
        )
        buttons = [
            {"id": "btn_view", "title": "📋 My Appointments"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Reschedule Cancelled")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)

    elif button_id.startswith("confirm_cancel_"):
        from app.routers.patients import normalize_phone

        appt_id = int(button_id.replace("confirm_cancel_", ""))
        appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        if not appt or (appt.clinic_id and appt.clinic_id != ctx.clinic_id):
            await ctx.send_text(sender_phone, f"⚠️ Appointment #{appt_id} was not found.")
            return

        if normalize_phone(sender_phone) != normalize_phone(appt.patient.phone if appt.patient else ""):
            await ctx.send_text(sender_phone, "⚠️ You are not authorized to cancel this appointment.")
            return

        if appt.status == "CANCELLED":
            msg = f"ℹ️ *Appointment #{appt_id} is already cancelled.*"
            buttons = [
                {"id": "btn_book", "title": "📅 Book New Appt"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Already Cancelled")
            return

        # Check cutoff policy again
        clinic_obj = db.query(Clinic).filter(Clinic.id == ctx.clinic_id).first()
        allowed, reason = booking_service.check_cancel_allowed(appt, clinic_obj)
        if not allowed:
            policy_text = getattr(clinic_obj, "cancellation_policy_text", None) or "Cancellations allowed up to 2 hours before appointment."
            msg = f"⚠️ *Cancellation Not Permitted*\n\n{reason}\n\n📋 *Clinic Policy:* {policy_text}"
            buttons = [
                {"id": "menu_human", "title": "💬 Receptionist"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Cancellation Restricted")
            return

        doc_name = appt.doctor.name if appt.doctor else "Doctor"
        appt_date = appt.appointment_date
        appt_time = appt.start_time
        is_paid = appt.payment_status == "PAID"
        paid_val = appt.paid_amount or 500

        success = booking_service.cancel_appointment(
            db, sender_phone, appt_id, name=user_name, clinic_id=ctx.clinic_id
        )
        if success:
            booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
            refund_note = ""
            if is_paid:
                refund_note = f"\n💳 *Refund Notice:* Your online payment of ₹{paid_val} has been logged. Please contact reception at {ctx.phone} for refund assistance per clinic policy.\n"

            reply = (
                f"❌ *Appointment #{appt_id} Cancelled*\n\n"
                f"Your appointment with Dr. {doc_name} on {appt_date} at {appt_time} has been successfully cancelled and the slot has been released.\n"
                f"{refund_note}\n"
                f"Whenever you wish to schedule another visit, please tap below:"
            )
            buttons = [
                {"id": "btn_book", "title": "📅 Book New Appt"},
                {"id": "btn_menu", "title": "🏠 Main Menu"},
            ]
            await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons, header_text="Appointment Cancelled")
            message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)

            # Phase 5: Event Notification Log (CANCELLED)
            try:
                from app.models import NotificationLog
                canc_slot_key = f"{appt.appointment_date}_{appt.start_time[:5]}"
                notif_log = NotificationLog(
                    clinic_id=ctx.clinic_id,
                    appointment_id=appt.id,
                    patient_id=appt.patient_id,
                    recipient_phone=sender_phone,
                    notification_type="CANCELLED",
                    appointment_slot=canc_slot_key,
                    status="SENT",
                    message_body=reply,
                    sent_at=datetime.datetime.utcnow(),
                )
                db.add(notif_log)
                db.commit()
            except Exception as e:
                db.rollback()
                logger.debug(f"Cancel notification log note: {e}")
        else:
            reply = f"Could not cancel appointment #{appt_id}."
            await ctx.send_text(sender_phone, reply)

    elif button_id == "btn_keep_booking":
        booking_service.update_session(db, sender_phone, step="IDLE", context={"clinic_id": ctx.clinic_id}, clinic_id=ctx.clinic_id)
        msg = (
            f"✅ *Appointment Kept Active*\n\n"
            f"Your appointment remains confirmed. We look forward to seeing you at *{ctx.name}*!"
        )
        buttons = [
            {"id": "btn_view", "title": "📋 My Appointments"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        await ctx.send_quick_reply_buttons(to=sender_phone, body_text=msg, buttons=buttons, header_text="Appointment Kept")
        message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)

    elif button_id.startswith("cancel_req_") or button_id.startswith("cancel_"):
        clean_id = button_id.replace("cancel_req_", "").replace("cancel_", "")
        if clean_id.isdigit():
            appt_id = int(clean_id)
            await start_cancel_flow(db, sender_phone, user_name, target_id=appt_id, ctx=ctx)

    elif button_id.startswith("fb_rate_"):
        # Format: fb_rate_<rating>_<appt_id>
        parts = button_id.split("_")
        if len(parts) >= 4 and parts[2].isdigit() and parts[3].isdigit():
            rating = int(parts[2])
            appt_id = int(parts[3])

            appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
            if appt:
                from app.services.post_appointment import post_appointment_service
                label = {5: "Excellent", 4: "Good", 3: "Average", 2: "Needs Improvement", 1: "Poor"}.get(rating, "Rated")
                post_appointment_service.record_feedback(
                    db=db,
                    clinic_id=appt.clinic_id or ctx.clinic_id,
                    appointment_id=appt.id,
                    patient_id=appt.patient_id,
                    rating=rating,
                    rating_label=label,
                )

                booking_service.update_session(
                    db,
                    sender_phone,
                    step="AWAITING_FEEDBACK_COMMENTS",
                    context={"clinic_id": ctx.clinic_id, "feedback_appt_id": appt.id},
                    clinic_id=ctx.clinic_id,
                )

                reply = (
                    f"🌟 *Thank you for your rating ({rating}/5 Stars)!*\n\n"
                    f"Your feedback helps *{ctx.name}* continuously improve our patient care.\n\n"
                    f"💬 *Optional:* Reply with any comments or suggestions, or tap *Main Menu* below."
                )
                buttons = [
                    {"id": "btn_menu", "title": "🏠 Main Menu"},
                ]
                await ctx.send_quick_reply_buttons(to=sender_phone, body_text=reply, buttons=buttons, header_text=ctx.name)
                message_service.log_message(db, sender_phone, "bot", reply, user_name, clinic_id=ctx.clinic_id)
                return


async def handle_user_list_selection(
    db: Session,
    sender_phone: str,
    user_name: str,
    item_id: str,
    item_title: str = None,
    ctx: Optional[ClinicContext] = None,
    meta_id: str = None,
):
    """Processes list menu selections (Menu items -> Reschedule -> Cancel -> Doctor -> Date -> Time Slot)."""
    if not ctx or not ctx.is_valid:
        logger.warning("handle_user_list_selection rejected: invalid or unverified clinic context.")
        return

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

    # 1. Main interactive list menu selections
    if item_id == "menu_book":
        await start_booking_flow(db, sender_phone, user_name, ctx=ctx)
        return
    elif item_id == "menu_reschedule":
        await start_reschedule_flow(db, sender_phone, user_name, ctx=ctx)
        return
    elif item_id == "menu_cancel":
        await start_cancel_flow(db, sender_phone, user_name, ctx=ctx)
        return
    elif item_id == "menu_view":
        await show_patient_appointments(db, sender_phone, user_name, ctx=ctx)
        return
    elif item_id == "menu_info":
        await show_clinic_and_doctors_info(db, sender_phone, user_name, ctx=ctx)
        return
    elif item_id == "menu_human":
        await talk_to_receptionist(db, sender_phone, user_name, ctx=ctx)
        return

    # 2. Appointment Management from List Menu
    if item_id.startswith("manage_"):
        appt_id = int(item_id.replace("manage_", ""))
        await show_appointment_management(db, sender_phone, user_name, appt_id, ctx=ctx)
        return

    if item_id == "btn_history":
        await show_appointment_history(db, sender_phone, user_name, "menu", ctx=ctx)
        return

    if item_id.startswith("resdoc_"):
        parts = item_id.split("_")
        doc_id = int(parts[1])
        appt_id = int(parts[2])
        doctor = booking_service.get_doctor_by_id(db, doc_id)
        appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        if doctor and appt:
            await present_reschedule_dates(db, sender_phone, user_name, appt, doctor=doctor, ctx=ctx)
        return

    # 3. Rescheduling list selections
    if item_id.startswith("resched_"):
        appt_id = int(item_id.replace("resched_", ""))
        await start_reschedule_flow(db, sender_phone, user_name, target_id=appt_id, ctx=ctx)
        return

    session = booking_service.get_session(db, sender_phone, clinic_id=ctx.clinic_id)
    context = json.loads(session.context_data or "{}")
    context["clinic_id"] = ctx.clinic_id

    if item_id.startswith("resdate_"):
        new_date = item_id.replace("resdate_", "")
        context["new_date"] = new_date
        doctor_id = context.get("doctor_id")
        if not doctor_id:
            await start_reschedule_flow(db, sender_phone, user_name, ctx=ctx)
            return

        booking_service.update_session(db, sender_phone, step="RESCHEDULING_SLOT", context=context, clinic_id=ctx.clinic_id)
        slots = booking_service.get_available_slots(db, doctor_id, new_date)
        if not slots:
            msg = f"⚠️ All appointments are booked for {new_date}. Please select another date by typing 'reschedule'."
            await ctx.send_text(to=sender_phone, text=msg)
            message_service.log_message(db, sender_phone, "bot", msg, user_name, clinic_id=ctx.clinic_id)
            return

        slot_rows = [
            {"id": f"resslot_{slot}", "title": f"⏰ {slot}", "description": "Reschedule to this time"}
            for slot in slots[:10]
        ]
        sections = [{"title": f"Available Slots on {new_date}", "rows": slot_rows}]
        prompt_text = f"Rescheduling to *{new_date}*:\nPlease select your new appointment time:"
        await ctx.send_list_menu(
            to=sender_phone,
            body_text=prompt_text,
            button_label="⏰ Choose New Time",
            sections=sections,
            header_text="Step 2 of 2: New Time",
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
        return

    elif item_id.startswith("resslot_"):
        from app.routers.patients import normalize_phone

        new_slot = item_id.replace("resslot_", "")
        appt_id = context.get("reschedule_appt_id")
        new_date = context.get("new_date")
        doctor_id = context.get("doctor_id")

        if not appt_id or not new_date or not doctor_id:
            await start_reschedule_flow(db, sender_phone, user_name, ctx=ctx)
            return

        appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
        if not appt or (appt.clinic_id and appt.clinic_id != ctx.clinic_id):
            await ctx.send_text(sender_phone, "⚠️ Original appointment was not found.")
            return

        if normalize_phone(sender_phone) != normalize_phone(appt.patient.phone if appt.patient else ""):
            await ctx.send_text(sender_phone, "⚠️ Unauthorized access to appointment.")
            return

        doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
        doc_name = format_doc_name(doctor.name if doctor else "Doctor")
        doc_spec = doctor.specialization if doctor else "General"

        context["new_slot"] = new_slot
        booking_service.update_session(
            db, sender_phone, step="AWAITING_RESCHEDULE_CONFIRMATION", context=context, clinic_id=ctx.clinic_id
        )

        pat_name = appt.patient.name if appt.patient else user_name
        pay_status = appt.payment_status or "PENDING"
        pay_str = f"💳 PAID (₹{appt.paid_amount or 500} preserved)" if pay_status == "PAID" else "💳 PENDING (Pay at clinic)"

        summary_text = (
            f"📋 *Appointment Reschedule Summary*\n\n"
            f"Please review your updated consultation details:\n\n"
            f"👤 *Patient Name:* {pat_name}\n"
            f"👨‍⚕️ *Doctor:* {doc_name} ({doc_spec})\n"
            f"⏮️ *Previous Slot:* {appt.appointment_date} at {appt.start_time}\n"
            f"🆕 *New Date & Time:* {new_date} at {new_slot}\n"
            f"  {pay_str}\n"
            f"🏥 *Clinic:* {ctx.name}\n"
            f"📍 *Address:* {ctx.address}\n\n"
            f"Would you like to confirm this reschedule?"
        )
        buttons = [
            {"id": "btn_confirm_resched", "title": "✅ Confirm Reschedule"},
            {"id": "btn_cancel_resched", "title": "❌ Keep Original"},
        ]
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=summary_text,
            buttons=buttons,
            header_text="Confirm Reschedule",
        )
        message_service.log_message(
            db=db,
            phone=sender_phone,
            sender="bot",
            body=summary_text,
            patient_name=user_name,
            message_type="summary",
            clinic_id=ctx.clinic_id,
        )
        return

    # 4. Cancel Selected from list menu -> route to confirmation
    if item_id.startswith("cancel_req_") or item_id.startswith("cancel_"):
        clean_id = item_id.replace("cancel_req_", "").replace("cancel_", "")
        if clean_id.isdigit():
            appt_id = int(clean_id)
            await start_cancel_flow(db, sender_phone, user_name, target_id=appt_id, ctx=ctx)
            return

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

        booking_service.update_session(db, sender_phone, step="SELECTING_SLOT", context=context, clinic_id=ctx.clinic_id)

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

    # 3. Time Slot Selected -> Present Summary and Request Confirmation
    elif item_id.startswith("slot_"):
        slot_time = item_id.replace("slot_", "")
        context["start_time"] = slot_time
        await send_appointment_summary(db, sender_phone, user_name, context, ctx=ctx)
        return


async def show_patient_appointments(
    db: Session, sender_phone: str, user_name: str = "Valued Patient", ctx: Optional[ClinicContext] = None
):
    """Displays upcoming appointments with patient scoping, payment status, clinic details, and management options."""
    if not ctx or not ctx.is_valid:
        logger.warning("show_patient_appointments rejected: invalid or unverified clinic context.")
        return

    appts = booking_service.get_patient_upcoming_appointments(db, sender_phone, name=user_name, clinic_id=ctx.clinic_id)
    if not appts:
        buttons = [
            {"id": "btn_book", "title": "📅 Book New Appt"},
            {"id": "btn_history", "title": "📜 Past Bookings"},
            {"id": "btn_menu", "title": "🏠 Main Menu"},
        ]
        body = (
            f"ℹ️ *No Upcoming Appointments*\n\n"
            f"Hello *{user_name}*, you do not have any upcoming appointments scheduled at *{ctx.name}*.\n\n"
            f"Would you like to schedule a consultation or view your past visit history?"
        )
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=body,
            buttons=buttons,
            header_text=ctx.name,
        )
        message_service.log_message(db, sender_phone, "bot", body, user_name, clinic_id=ctx.clinic_id)
        return

    text = f"📋 *Upcoming Appointments at {ctx.name}:*\n\n"
    for a in appts:
        pat_name = a.patient.name if (hasattr(a, "patient") and a.patient) else user_name
        clinic_title = a.clinic.name if (hasattr(a, "clinic") and a.clinic) else ctx.name
        clinic_addr = a.clinic.address if (hasattr(a, "clinic") and a.clinic and a.clinic.address) else ctx.address
        pay_status = a.payment_status or "PENDING"
        if pay_status == "PAID":
            pay_str = f"💳 PAID (₹{a.paid_amount or 500} via {a.payment_method or 'Razorpay'})"
        else:
            pay_str = "💳 PENDING (Pay at clinic counter)"
        symptom_info = f"  🩺 Reason: _{a.notes}_\n" if a.notes else ""
        doc_name = format_doc_name(a.doctor.name if a.doctor else "Doctor")
        doc_spec = a.doctor.specialization if a.doctor else "General Consultation"
        text += (
            f"• *Booking ID #{a.id}*\n"
            f"  👤 Patient: {pat_name}\n"
            f"  👨‍⚕️ Specialist: {doc_name} ({doc_spec})\n"
            f"  📅 Date: {a.appointment_date}\n"
            f"  ⏰ Time: {a.start_time} - {a.end_time}\n"
            f"  📊 Status: ✅ {a.status}\n"
            f"  {pay_str}\n"
            f"  🏥 Clinic: {clinic_title}\n"
            f"  📍 Address: {clinic_addr}\n"
            f"{symptom_info}\n"
        )

    if len(appts) == 1:
        buttons = [
            {"id": f"manage_{appts[0].id}", "title": f"⚙️ Manage #{appts[0].id}"},
            {"id": "btn_book", "title": "📅 Book Another"},
            {"id": "btn_history", "title": "📜 History"},
        ]
        await ctx.send_quick_reply_buttons(
            to=sender_phone,
            body_text=text,
            buttons=buttons,
            header_text="My Appointments",
        )
    else:
        text += "Select an appointment below to reschedule, cancel, or review history:"
        rows = [
            {
                "id": f"manage_{a.id}",
                "title": f"Manage #{a.id} ({a.appointment_date})"[:24],
                "description": f"Dr. {a.doctor.name} at {a.start_time}"[:72],
            }
            for a in appts[:9]
        ]
        rows.append({
            "id": "btn_history",
            "title": "📜 View Past History",
            "description": "View completed and cancelled consultations",
        })
        sections = [{"title": "Your Upcoming Appointments", "rows": rows}]
        await ctx.send_list_menu(
            to=sender_phone,
            body_text=text,
            button_label="⚙️ Manage Booking",
            sections=sections,
            header_text="My Appointments",
        )

    message_service.log_message(db, sender_phone, "bot", text, user_name, clinic_id=ctx.clinic_id)
