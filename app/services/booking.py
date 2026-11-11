import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.models import Doctor, Patient, Appointment, ConversationSession, QueueEntry
from app.config import settings
import json


class BookingService:
    @staticmethod
    def get_or_create_patient(
        db: Session,
        phone: str,
        name: Optional[str] = None,
        source: str = "Direct",
        gender: Optional[str] = None,
        age: Optional[int] = None,
    ) -> Patient:
        from app.routers.patients import normalize_phone, generate_patient_uid
        clean_phone = (phone or "").strip()
        norm = normalize_phone(clean_phone)
        display_name = (name or "").strip().title()

        # Format phone uniformly for storage with default +91 prefix
        if len(norm) == 10:
            stored_phone = f"+91{norm}"
        elif norm and not clean_phone.startswith("+"):
            stored_phone = f"+{norm}"
        else:
            stored_phone = clean_phone

        patient = None

        # 1. Exact match by normalized phone AND matching name (case-insensitive)
        if norm and display_name and display_name.lower() not in ["valued patient", "whatsapp patient", "direct patient"]:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm and (p.name or "").strip().lower() == display_name.lower():
                    patient = p
                    break

        # 2. Match generic record on same phone to adopt specific name
        if not patient and norm and display_name and display_name.lower() not in ["valued patient", "whatsapp patient", "direct patient"]:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm and (p.name or "").strip().lower() in ["valued patient", "whatsapp patient", "direct patient", ""]:
                    patient = p
                    patient.name = display_name
                    db.commit()
                    db.refresh(patient)
                    break

        # 3. Match any record on this phone if name is generic
        if not patient and norm and (not display_name or display_name.lower() in ["valued patient", "whatsapp patient", "direct patient"]):
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    patient = p
                    break

        # 4. Create new patient (supports distinct family members on same phone)
        if not patient:
            uid = generate_patient_uid(db)
            patient = Patient(
                phone=stored_phone,
                name=display_name if display_name else ("WhatsApp Patient" if source == "WhatsApp" else "Direct Patient"),
                patient_uid=uid,
                registration_source=source,
                gender=gender or "Unspecified",
                age=age,
            )
            db.add(patient)
            db.commit()
            db.refresh(patient)

        return patient

    @staticmethod
    def get_session(
        db: Session,
        phone: str,
        clinic_id: Optional[int] = None,
        timeout_minutes: Optional[int] = None,
    ) -> ConversationSession:
        """
        Retrieves or initializes a clinic-scoped conversation session.
        Enforces session expiration: if non-IDLE session has been inactive beyond timeout,
        it resets step to IDLE, clears context, and sets `session.was_expired = True`.
        """
        from app.routers.patients import normalize_phone
        clean_phone = (phone or "").strip()
        norm = normalize_phone(clean_phone)
        stored_phone = f"+91{norm}" if len(norm) == 10 else (f"+{norm}" if norm and not clean_phone.startswith("+") else clean_phone)

        cid = clinic_id or 1

        session = (
            db.query(ConversationSession)
            .filter(ConversationSession.clinic_id == cid, ConversationSession.phone == stored_phone)
            .first()
        )
        if not session and clean_phone != stored_phone:
            session = (
                db.query(ConversationSession)
                .filter(ConversationSession.clinic_id == cid, ConversationSession.phone == clean_phone)
                .first()
            )

        now = datetime.datetime.utcnow()
        was_expired = False
        expiry_mins = timeout_minutes or getattr(settings, "WHATSAPP_SESSION_TIMEOUT_MINUTES", 30)

        if not session:
            session = ConversationSession(
                clinic_id=cid,
                phone=stored_phone,
                step="IDLE",
                context_data="{}",
                updated_at=now,
            )
            db.add(session)
            db.commit()
            db.refresh(session)
        else:
            # Check expiration if session is in an active non-IDLE step
            if session.step != "IDLE" and session.updated_at:
                if (now - session.updated_at) > datetime.timedelta(minutes=expiry_mins):
                    was_expired = True
                    session.step = "IDLE"
                    session.context_data = "{}"
                    session.updated_at = now
                    db.commit()
                    db.refresh(session)

        session.was_expired = was_expired
        return session

    @staticmethod
    def update_session(
        db: Session,
        phone: str,
        step: str,
        context: Optional[Dict[str, Any]] = None,
        clinic_id: Optional[int] = None,
    ):
        cid = clinic_id
        if cid is None and context and context.get("clinic_id"):
            cid = context.get("clinic_id")
        session = BookingService.get_session(db, phone, clinic_id=cid)
        session.step = step
        session.updated_at = datetime.datetime.utcnow()
        if context is not None:
            session.context_data = json.dumps(context)
        db.commit()

    @staticmethod
    def get_active_doctors(db: Session, clinic_id: Optional[int] = None) -> List[Doctor]:
        query = db.query(Doctor).filter(Doctor.is_active == True)
        if clinic_id:
            query = query.filter(Doctor.clinic_id == clinic_id)
        return query.all()

    @staticmethod
    def get_doctor_by_id(db: Session, doctor_id: int) -> Optional[Doctor]:
        return db.query(Doctor).filter(Doctor.id == doctor_id).first()

    @staticmethod
    def get_general_physician(db: Session, clinic_id: Optional[int] = None) -> Optional[Doctor]:
        """Finds the primary general medicine / physician doctor or defaults to first active doctor."""
        doctors = BookingService.get_active_doctors(db, clinic_id=clinic_id)
        if not doctors:
            return None
        general_keywords = ["general", "physician", "medicine", "internal", "family", "opd", "mbbs"]
        for doc in doctors:
            spec_lower = (doc.specialization or "").lower()
            if any(k in spec_lower for k in general_keywords):
                return doc
        return doctors[0]

    @staticmethod
    def get_available_dates(doctor: Doctor, days_ahead: int = 5) -> List[Dict[str, str]]:
        """Returns the next upcoming available dates for the doctor."""
        available_days = [d.strip().lower() for d in doctor.available_days.split(",")]
        dates = []
        today = datetime.date.today()

        for offset in range(1, days_ahead + 6):
            target_date = today + datetime.timedelta(days=offset)
            weekday_name = target_date.strftime("%A").lower()
            if weekday_name in available_days:
                dates.append({
                    "date_str": target_date.strftime("%Y-%m-%d"),
                    "display": target_date.strftime("%a, %b %d"),
                })
            if len(dates) >= days_ahead:
                break
        return dates

    @staticmethod
    def get_available_slots(db: Session, doctor_id: int, date_str: str) -> List[str]:
        doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
        if not doctor:
            return []

        now = datetime.datetime.now()
        today_str = now.strftime("%Y-%m-%d")

        # Past dates cannot have available booking slots
        if date_str < today_str:
            return []

        # Find existing confirmed/in-consultation or active pending reserved bookings
        now_utc = datetime.datetime.utcnow()
        reservation_cutoff = now_utc - datetime.timedelta(minutes=30)
        existing_bookings = (
            db.query(Appointment)
            .filter(
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date == date_str,
                (
                    Appointment.status.in_(["CONFIRMED", "IN_CONSULTATION"])
                    | (
                        (Appointment.status == "PENDING")
                        & (Appointment.created_at >= reservation_cutoff)
                    )
                ),
            )
            .all()
        )
        booked_times = {b.start_time for b in existing_bookings}

        # Generate candidate slots based on working hours and slot duration
        duration_mins = doctor.slot_duration_mins if (doctor.slot_duration_mins and doctor.slot_duration_mins > 0) else 15
        slots = []
        start_dt = datetime.datetime.strptime(doctor.start_time, "%H:%M")
        end_dt = datetime.datetime.strptime(doctor.end_time, "%H:%M")
        delta = datetime.timedelta(minutes=duration_mins)

        current = start_dt
        while current + delta <= end_dt:
            time_str = current.strftime("%H:%M")

            # If the booking date is today, omit slots that have already passed
            if date_str == today_str:
                if current.time() <= now.time():
                    current += delta
                    continue

            if time_str not in booked_times:
                slots.append(time_str)
            current += delta

        return slots

    @staticmethod
    def book_appointment(
        db: Session,
        phone: str,
        patient_name: str,
        doctor_id: int,
        date_str: str,
        start_time: str,
        source: str = "WhatsApp",
        notes: Optional[str] = None,
        aadhaar_number: Optional[str] = None,
        address: Optional[str] = None,
        gender: Optional[str] = None,
        age: Optional[Any] = None,
        blood_group: Optional[str] = None,
        visit_type: Optional[str] = "New Consultation",
        status: Optional[str] = None,
        payment_status: Optional[str] = None,
        payment_method: Optional[str] = None,
        paid_amount: Optional[int] = None,
        cabin: Optional[str] = "Cabin 1",
        skip_slot_check: bool = False,
        clinic_id: Optional[int] = None,
    ) -> Optional[Appointment]:
        # Atomic slot availability check
        if not skip_slot_check:
            now_utc = datetime.datetime.utcnow()
            reservation_cutoff = now_utc - datetime.timedelta(minutes=30)
            conflict = (
                db.query(Appointment)
                .filter(
                    Appointment.doctor_id == doctor_id,
                    Appointment.appointment_date == date_str,
                    Appointment.start_time == start_time,
                    (
                        Appointment.status.in_(["CONFIRMED", "IN_CONSULTATION"])
                        | (
                            (Appointment.status == "PENDING")
                            & (Appointment.created_at >= reservation_cutoff)
                        )
                    ),
                )
                .first()
            )
            if conflict:
                return None

        doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
        if not doctor:
            return None

        slot_duration = doctor.slot_duration_mins if (doctor.slot_duration_mins and doctor.slot_duration_mins > 0) else 15
        start_dt = datetime.datetime.strptime(start_time, "%H:%M")
        end_dt = start_dt + datetime.timedelta(minutes=slot_duration)
        end_time = end_dt.strftime("%H:%M")

        assigned_clinic_id = clinic_id if clinic_id is not None else getattr(doctor, "clinic_id", None)

        clean_age_val = None
        if age is not None and str(age).strip():
            try:
                ca = int(str(age).strip())
                if 0 <= ca <= 130:
                    clean_age_val = ca
            except Exception:
                pass

        patient = BookingService.get_or_create_patient(
            db, phone, patient_name, source=source, gender=gender, age=clean_age_val
        )
        updated_patient = False
        if aadhaar_number and aadhaar_number.strip():
            patient.aadhaar_number = aadhaar_number.strip()
            updated_patient = True
        if address and address.strip():
            patient.address = address.strip()
            updated_patient = True
        if gender and gender.strip() and gender.strip() != "Unspecified":
            patient.gender = gender.strip()
            updated_patient = True
        if clean_age_val is not None:
            patient.age = clean_age_val
            updated_patient = True
        if blood_group and blood_group.strip():
            patient.blood_group = blood_group.strip()
            updated_patient = True

        if updated_patient:
            db.commit()

        # Doctor consultation fee (no hardcoded 500 default)
        doc_fee = doctor.consultation_fee if (hasattr(doctor, "consultation_fee") and doctor.consultation_fee is not None) else 0

        final_status = status or "CONFIRMED"
        final_payment_status = payment_status or ("PENDING" if source.lower() == "whatsapp" else "PAID")
        final_payment_method = payment_method or ("Pay at Clinic" if source.lower() == "whatsapp" else "Cash")
        final_paid_amount = paid_amount if paid_amount is not None else (0 if final_payment_status == "PENDING" else doc_fee)

        now_entry_time = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).strftime("%I:%M %p")
        appointment = Appointment(
            clinic_id=assigned_clinic_id,
            patient_id=patient.id,
            doctor_id=doctor_id,
            appointment_date=date_str,
            start_time=start_time,
            end_time=end_time,
            status=final_status,
            source=source,
            notes=notes,
            aadhaar_number=aadhaar_number.strip() if aadhaar_number else None,
            entry_time=now_entry_time,
            visit_type=visit_type or "New Consultation",
            payment_status=final_payment_status,
            payment_method=final_payment_method,
            paid_amount=final_paid_amount,
            cabin=cabin or "Cabin 1",
        )
        db.add(appointment)
        db.commit()
        db.refresh(appointment)
        return appointment

    @staticmethod
    def find_patient_by_phone(db: Session, phone: str, name: Optional[str] = None) -> Optional[Patient]:
        """Finds patient by matching raw phone, +country code, normalized 10 digits, or registered name."""
        from app.routers.patients import normalize_phone
        clean_phone = (phone or "").strip()
        norm = normalize_phone(clean_phone)
        clean_name = (name or "").strip().lower()
        has_specific_name = clean_name and clean_name not in ["valued patient", "whatsapp patient", "direct patient"]

        # 1. Exact match on phone AND name
        if norm and has_specific_name:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm and (p.name or "").strip().lower() == clean_name:
                    return p
            # Match placeholder record on same phone
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm and (p.name or "").strip().lower() in ["valued patient", "whatsapp patient", "direct patient", ""]:
                    return p
            return None

        # 2. If name is not specified or generic, return first patient record matching phone
        if norm and not has_specific_name:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    return p

        # 3. Fallback match by name
        if has_specific_name:
            for p in db.query(Patient).all():
                if (p.name or "").strip().lower() == clean_name:
                    return p

        return None

    @staticmethod
    def get_patient_upcoming_appointments(
        db: Session, phone: str, name: Optional[str] = None, clinic_id: Optional[int] = None
    ) -> List[Appointment]:
        from app.routers.patients import normalize_phone
        norm = normalize_phone(phone)
        today_str = datetime.date.today().strftime("%Y-%m-%d")

        patients = []
        if norm:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    if name and name.strip() and name.strip().lower() not in ["valued patient", "whatsapp patient", "direct patient"]:
                        if (p.name or "").strip().lower() == name.strip().lower():
                            patients.append(p)
                    else:
                        patients.append(p)

            # If no patient strictly matched the name on this phone, fall back to all patients on this phone
            if not patients:
                for p in db.query(Patient).all():
                    if normalize_phone(p.phone) == norm:
                        patients.append(p)

        if not patients:
            p_fallback = BookingService.find_patient_by_phone(db, phone, name=name)
            if p_fallback:
                patients = [p_fallback]

        if not patients:
            return []

        p_ids = [p.id for p in patients]
        query = (
            db.query(Appointment)
            .filter(
                Appointment.patient_id.in_(p_ids),
                Appointment.status.in_(["CONFIRMED", "PENDING", "IN_CONSULTATION"]),
                Appointment.appointment_date >= today_str,
            )
        )
        if clinic_id:
            query = query.filter((Appointment.clinic_id == clinic_id) | (Appointment.clinic_id == None))
        return query.order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc()).all()

    @staticmethod
    def get_patient_past_appointments(
        db: Session, phone: str, name: Optional[str] = None, clinic_id: Optional[int] = None
    ) -> List[Appointment]:
        """Returns completed or past appointments for the patient."""
        from app.routers.patients import normalize_phone
        norm = normalize_phone(phone)
        today_str = datetime.date.today().strftime("%Y-%m-%d")

        patients = []
        if norm:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    patients.append(p)
        if not patients:
            return []

        p_ids = [p.id for p in patients]
        query = (
            db.query(Appointment)
            .filter(
                Appointment.patient_id.in_(p_ids),
                (Appointment.appointment_date < today_str) | (Appointment.status == "COMPLETED"),
                Appointment.status != "CANCELLED",
            )
        )
        if clinic_id:
            query = query.filter((Appointment.clinic_id == clinic_id) | (Appointment.clinic_id == None))
        return query.order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc()).all()

    @staticmethod
    def get_patient_cancelled_appointments(
        db: Session, phone: str, name: Optional[str] = None, clinic_id: Optional[int] = None
    ) -> List[Appointment]:
        """Returns cancelled appointments for the patient."""
        from app.routers.patients import normalize_phone
        norm = normalize_phone(phone)

        patients = []
        if norm:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    patients.append(p)
        if not patients:
            return []

        p_ids = [p.id for p in patients]
        query = (
            db.query(Appointment)
            .filter(
                Appointment.patient_id.in_(p_ids),
                Appointment.status == "CANCELLED",
            )
        )
        if clinic_id:
            query = query.filter((Appointment.clinic_id == clinic_id) | (Appointment.clinic_id == None))
        return query.order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc()).all()

    @staticmethod
    def is_within_cutoff(date_str: str, time_str: str, cutoff_hours: int) -> bool:
        """Returns True if the appointment is within cutoff_hours or in the past."""
        try:
            clean_time = (time_str or "")[:5]
            appt_dt = datetime.datetime.strptime(f"{date_str} {clean_time}", "%Y-%m-%d %H:%M")
            now = datetime.datetime.now()
            diff = appt_dt - now
            return diff.total_seconds() < cutoff_hours * 3600
        except Exception:
            return False

    @staticmethod
    def check_reschedule_allowed(appt: Appointment, clinic: Optional[Any] = None) -> tuple[bool, str]:
        """Checks clinic policy rules for rescheduling an appointment."""
        if not appt:
            return False, "Appointment not found."
        if appt.status == "COMPLETED":
            return False, "Completed appointments cannot be rescheduled."
        if appt.status == "CANCELLED":
            return False, "Cancelled appointments cannot be rescheduled."

        max_limit = getattr(clinic, "max_reschedules", 3) or 3
        if (getattr(appt, "reschedule_count", 0) or 0) >= max_limit:
            return False, f"This booking has reached the maximum limit of {max_limit} reschedules under clinic policy."

        cutoff = getattr(clinic, "reschedule_cutoff_hours", 2) or 2
        if BookingService.is_within_cutoff(appt.appointment_date, appt.start_time, cutoff):
            return False, f"Rescheduling is not permitted within {cutoff} hours of your scheduled appointment time under clinic policy."

        return True, "OK"

    @staticmethod
    def check_cancel_allowed(appt: Appointment, clinic: Optional[Any] = None) -> tuple[bool, str]:
        """Checks clinic policy rules for cancelling an appointment."""
        if not appt:
            return False, "Appointment not found."
        if appt.status == "CANCELLED":
            return False, "ALREADY_CANCELLED"
        if appt.status == "COMPLETED":
            return False, "Completed appointments cannot be cancelled."

        cutoff = getattr(clinic, "cancel_cutoff_hours", 2) or 2
        if BookingService.is_within_cutoff(appt.appointment_date, appt.start_time, cutoff):
            return False, f"Cancellations are not permitted within {cutoff} hours of your scheduled appointment time under clinic policy."

        return True, "OK"

    @staticmethod
    def cancel_appointment(
        db: Session,
        phone: str,
        appointment_id: int,
        name: Optional[str] = None,
        clinic_id: Optional[int] = None,
        reason: Optional[str] = None,
        source: str = "WhatsApp",
    ) -> Any:
        appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
        if not appt:
            return False
        if clinic_id and appt.clinic_id and appt.clinic_id != clinic_id:
            return False

        # Cross-patient security validation: patient phone must match sender phone
        from app.routers.patients import normalize_phone
        sender_norm = normalize_phone(phone)
        patient_norm = normalize_phone(appt.patient.phone) if (appt.patient and appt.patient.phone) else ""
        if sender_norm and patient_norm and sender_norm != patient_norm:
            return False

        if appt.status == "CANCELLED":
            return "ALREADY_CANCELLED"

        appt.status = "CANCELLED"
        appt.cancelled_at = datetime.datetime.utcnow()
        appt.cancellation_source = source
        appt.cancellation_reason = reason or "Cancelled by patient via WhatsApp"

        # Sync active queue entry
        q_entries = (
            db.query(QueueEntry)
            .filter(
                QueueEntry.appointment_id == appt.id,
                QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
            )
            .all()
        )
        for q in q_entries:
            q.status = "CANCELLED"

        db.commit()
        return True

    @staticmethod
    def reschedule_appointment(
        db: Session,
        appointment_id: int,
        date_str: str,
        start_time: str,
        doctor_id: Optional[int] = None,
        notes: Optional[str] = None,
        clinic_id: Optional[int] = None,
    ) -> Appointment:
        appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
        if not appt:
            raise ValueError("Appointment not found")

        if clinic_id and appt.clinic_id and appt.clinic_id != clinic_id:
            raise ValueError("Appointment does not belong to this clinic")

        if appt.status == "COMPLETED":
            raise ValueError("Cannot reschedule an appointment that is already COMPLETED")

        target_doctor_id = doctor_id if (doctor_id is not None and doctor_id > 0) else appt.doctor_id
        doctor = db.query(Doctor).filter(Doctor.id == target_doctor_id).first()
        if not doctor:
            raise ValueError("Selected doctor was not found")

        now = datetime.datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        if date_str < today_str:
            raise ValueError("Cannot reschedule an appointment to a past date")

        # Standardize start_time format (HH:MM)
        clean_start_time = start_time[:5]
        if date_str == today_str:
            slot_time = datetime.datetime.strptime(clean_start_time, "%H:%M").time()
            if slot_time <= now.time():
                raise ValueError(f"Time slot {clean_start_time} has already passed for today")

        # Check for conflict with other appointments
        conflict = (
            db.query(Appointment)
            .filter(
                Appointment.id != appt.id,
                Appointment.doctor_id == target_doctor_id,
                Appointment.appointment_date == date_str,
                Appointment.start_time.startswith(clean_start_time),
                Appointment.status.in_(["CONFIRMED", "PENDING", "IN_CONSULTATION"]),
            )
            .first()
        )
        if conflict:
            if conflict.status == "PENDING" and conflict.created_at:
                hold_mins = 30
                if (datetime.datetime.utcnow() - conflict.created_at).total_seconds() > hold_mins * 60:
                    conflict = None
            if conflict:
                raise ValueError(f"Time slot {clean_start_time} on {date_str} is already booked for Dr. {doctor.name}")

        # Compute end_time based on doctor's slot duration
        duration_mins = doctor.slot_duration_mins if (doctor.slot_duration_mins and doctor.slot_duration_mins > 0) else 15
        start_dt = datetime.datetime.strptime(clean_start_time, "%H:%M")
        end_dt = start_dt + datetime.timedelta(minutes=duration_mins)
        end_time = end_dt.strftime("%H:%M")

        # Record previous slot and increment reschedule count
        old_slot = f"{appt.appointment_date} {appt.start_time}"
        appt.previous_slot = old_slot
        appt.reschedule_count = (getattr(appt, "reschedule_count", 0) or 0) + 1

        # Update appointment record
        appt.doctor_id = target_doctor_id
        appt.appointment_date = date_str
        appt.start_time = clean_start_time
        appt.end_time = end_time

        # Reinstate to CONFIRMED
        appt.status = "CONFIRMED"

        reschedule_tag = f"[Rescheduled from {old_slot} to {date_str} {clean_start_time}]"
        old_notes = appt.notes or ""
        if notes and notes.strip():
            appt.notes = f"{old_notes} {reschedule_tag} ({notes.strip()})".strip()
        else:
            appt.notes = f"{old_notes} {reschedule_tag}".strip()

        # Synchronize active queue entry
        q_entries = (
            db.query(QueueEntry)
            .filter(
                QueueEntry.appointment_id == appt.id,
                QueueEntry.status.in_(["WAITING", "CALLED", "IN_CONSULTATION"]),
            )
            .all()
        )
        for q in q_entries:
            if date_str != today_str:
                q.status = "SKIPPED"
            else:
                q.doctor_id = target_doctor_id

        db.commit()
        db.refresh(appt)
        return appt


booking_service = BookingService()
