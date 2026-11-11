"""Receptionist Handover and Working Hours Service (Phase 6).

Handles patient requests to speak with human receptionists, checks reception
availability against clinic working hours, creates and updates handover tickets,
and notifies clinic front-desk teams.
"""

import json
import logging
import datetime
from zoneinfo import ZoneInfo
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from app.models import Clinic, Patient, ReceptionHandoverRequest, User
from app.services.booking import booking_service

logger = logging.getLogger("aerostate_reception")

VALID_HANDOVER_STATUSES = ["Open", "Assigned", "In Progress", "Resolved", "Closed"]


class ReceptionService:
    """Manages clinic reception availability, handover ticket dispatch, and status tracking."""

    @staticmethod
    def get_clinic_timezone(clinic: Optional[Clinic]) -> ZoneInfo:
        tz_str = clinic.timezone if (clinic and clinic.timezone) else "Asia/Kolkata"
        try:
            return ZoneInfo(tz_str)
        except Exception:
            return ZoneInfo("Asia/Kolkata")

    def is_reception_open(self, clinic: Optional[Clinic], now: Optional[datetime.datetime] = None) -> bool:
        """Determines whether clinic reception is currently open based on working days and hours."""
        if not clinic:
            return False

        tz = self.get_clinic_timezone(clinic)
        local_now = now if now else datetime.datetime.now(tz)
        if local_now.tzinfo is None:
            local_now = local_now.replace(tzinfo=tz)

        # 1. Day of week check
        day_name = local_now.strftime("%A")  # e.g. "Monday"
        raw_days = clinic.reception_days or "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday"
        allowed_days = [d.strip().lower() for d in raw_days.split(",") if d.strip()]
        if day_name.lower() not in allowed_days:
            return False

        # 2. Time range check (HH:MM)
        start_str = clinic.reception_start_time or "09:00"
        end_str = clinic.reception_end_time or "18:00"

        cur_str = local_now.strftime("%H:%M")
        return start_str <= cur_str <= end_str

    def create_handover_request(
        self,
        db: Session,
        clinic_id: int,
        phone: str,
        patient_name: str,
        reason: str = "Talk to Receptionist",
        patient_query: Optional[str] = None,
        context_data: Optional[Dict[str, Any]] = None,
        is_outside_hours: bool = False,
        priority: str = "Normal",
    ) -> ReceptionHandoverRequest:
        """Creates a persistent receptionist handover ticket."""
        patient = booking_service.find_patient_by_phone(db, phone, name=patient_name)

        context_json = json.dumps(context_data or {}, default=str)

        req = ReceptionHandoverRequest(
            clinic_id=clinic_id,
            patient_id=patient.id if patient else None,
            phone=phone,
            patient_name=patient_name or (patient.name if patient else "Valued Patient"),
            status="Open",
            priority=priority,
            reason=reason,
            patient_query=patient_query,
            conversation_context=context_json,
            is_outside_working_hours=is_outside_hours,
            created_at=datetime.datetime.utcnow(),
            updated_at=datetime.datetime.utcnow(),
        )
        db.add(req)
        db.commit()
        db.refresh(req)

        # Notify clinic reception team if reception phone configured
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if clinic and clinic.reception_phone:
            logger.info(
                f"[RECEPTION_ALERT] Clinic {clinic.name} ({clinic.code}): New handover ticket #{req.id} "
                f"from {req.patient_name} ({req.phone}). Reason: {reason}. Status: Open."
            )

        return req

    def build_reception_message(
        self,
        clinic: Optional[Clinic],
        is_open: bool,
        user_name: str,
    ) -> str:
        """Builds compliant handover response message following Phase 6 requirements."""
        clinic_name = clinic.name if (clinic and clinic.name) else "our clinic"

        if is_open:
            if clinic and clinic.reception_message_open:
                body = clinic.reception_message_open
            else:
                body = "Your request has been forwarded to our reception team. A receptionist will contact you shortly."

            wait_str = ""
            if clinic and clinic.reception_expected_wait_mins:
                wait_str = f"\n⏱️ *Expected Response:* within {clinic.reception_expected_wait_mins} minutes."

            desk_phone = ""
            if clinic and clinic.phone:
                desk_phone += f"\n📞 *Clinic Phone:* {clinic.phone}"
            if clinic and clinic.reception_phone and clinic.reception_phone != clinic.phone:
                desk_phone += f"\n📞 *Reception Desk:* {clinic.reception_phone}"

            text = (
                f"💬 *TALK TO RECEPTIONIST*\n\n"
                f"Hello *{user_name}*,\n\n"
                f"{body}{wait_str}{desk_phone}\n\n"
                f"Our front-desk team will assist you with any questions or appointment requirements."
            )
        else:
            if clinic and clinic.reception_message_closed:
                body = clinic.reception_message_closed
            else:
                body = "Our reception team is currently unavailable. Your request has been recorded and will be handled during working hours."

            hours_str = ""
            if clinic and (clinic.reception_start_time or clinic.reception_days):
                start = clinic.reception_start_time or "09:00"
                end = clinic.reception_end_time or "18:00"
                days = clinic.reception_days or "Mon-Sat"
                hours_str = f"\n⏰ *Reception Hours:* {start} to {end} ({days})"

            contact_str = ""
            if clinic and clinic.phone:
                contact_str = f"\n📞 *Clinic Number:* {clinic.phone}"

            text = (
                f"💬 *TALK TO RECEPTIONIST*\n\n"
                f"Hello *{user_name}*,\n\n"
                f"{body}\n"
                f"{hours_str}{contact_str}\n\n"
                f"You can also use our automated menu at any time to book, reschedule, or cancel your appointment."
            )

        return text

    def update_handover_status(
        self,
        db: Session,
        request_id: int,
        status: str,
        assigned_to: Optional[str] = None,
        assigned_to_user_id: Optional[int] = None,
        resolution_notes: Optional[str] = None,
    ) -> Optional[ReceptionHandoverRequest]:
        """Transitions ticket status through Open -> Assigned -> In Progress -> Resolved -> Closed."""
        req = db.query(ReceptionHandoverRequest).filter(ReceptionHandoverRequest.id == request_id).first()
        if not req:
            return None

        # Normalize status formatting
        normalized = None
        for s in VALID_HANDOVER_STATUSES:
            if s.lower() == status.lower():
                normalized = s
                break
        if not normalized:
            raise ValueError(f"Invalid status '{status}'. Must be one of {VALID_HANDOVER_STATUSES}")

        req.status = normalized
        if assigned_to is not None:
            req.assigned_to = assigned_to
        if assigned_to_user_id is not None:
            req.assigned_to_user_id = assigned_to_user_id
        if resolution_notes is not None:
            req.resolution_notes = resolution_notes

        req.updated_at = datetime.datetime.utcnow()
        if normalized in ["Resolved", "Closed"]:
            req.resolved_at = datetime.datetime.utcnow()

        db.commit()
        db.refresh(req)
        return req

    def list_handover_requests(
        self,
        db: Session,
        clinic_id: Optional[int] = None,
        status: Optional[str] = None,
        phone: Optional[str] = None,
        limit: int = 50,
    ) -> List[ReceptionHandoverRequest]:
        """Lists handover requests with optional clinic, status, and patient filters."""
        query = db.query(ReceptionHandoverRequest)
        if clinic_id:
            query = query.filter(ReceptionHandoverRequest.clinic_id == clinic_id)
        if status:
            query = query.filter(ReceptionHandoverRequest.status.ilike(status))
        if phone:
            clean_phone = phone.replace("+", "").replace(" ", "").replace("-", "")
            query = query.filter(ReceptionHandoverRequest.phone.contains(clean_phone))

        return query.order_by(ReceptionHandoverRequest.id.desc()).limit(limit).all()


reception_service = ReceptionService()
