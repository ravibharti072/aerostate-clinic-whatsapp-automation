import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.models import Doctor, Patient, Appointment, ConversationSession, QueueEntry
import json


class BookingService:
    @staticmethod
    def get_or_create_patient(db: Session, phone: str, name: Optional[str] = None, source: str = "Direct") -> Patient:
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

        # 1. Primary lookup by normalized 10-digit phone
        if norm:
            for p in db.query(Patient).all():
                if normalize_phone(p.phone) == norm:
                    patient = p
                    break

        # 2. Secondary lookup by case-insensitive name to prevent duplicates (e.g. 'Ravi Bharti' vs 'Ravi bharti')
        if not patient and display_name and display_name.lower() not in ["valued patient", "whatsapp patient", "direct patient"]:
            for p in db.query(Patient).all():
                if (p.name or "").strip().lower() == display_name.lower():
                    patient = p
                    # If patient record had placeholder phone or user is updating phone, keep uniform format
                    if not p.phone or p.phone in ["", "Not Provided"] or len(normalize_phone(p.phone)) != 10:
                        p.phone = stored_phone
                        db.commit()
                        db.refresh(p)
                    break

        if not patient:
            uid = generate_patient_uid(db)
            patient = Patient(
                phone=stored_phone,
                name=display_name if display_name else ("WhatsApp Patient" if source == "WhatsApp" else "Direct Patient"),
                patient_uid=uid,
                registration_source=source,
            )
            db.add(patient)
            db.commit()
            db.refresh(patient)
        elif display_name and display_name not in ["Valued Patient", "WhatsApp Patient", "Direct Patient"]:
            # Standardize name to proper Title Case on existing record
            if (patient.name or "").strip().lower() in ["valued patient", "whatsapp patient", "direct patient", "", display_name.lower()]:
                patient.name = display_name
                db.commit()
                db.refresh(patient)
        return patient

    @staticmethod
    def get_session(db: Session, phone: str) -> ConversationSession:
        session = db.query(ConversationSession).filter(ConversationSession.phone == phone).first()
        if not session:
            session = ConversationSession(phone=phone, step="IDLE", context_data="{}")
            db.add(session)
            db.commit()
            db.refresh(session)
        return session

    @staticmethod
    def update_session(db: Session, phone: str, step: str, context: Optional[Dict[str, Any]] = None):
        session = BookingService.get_session(db, phone)
        session.step = step
        if context is not None:
            session.context_data = json.dumps(context)
        db.commit()

    @staticmethod
    def get_active_doctors(db: Session, clinic_id: Optional[int] = None) -> List[Doctor]:
        query = db.query(Doctor).filter(Doctor.is_active == True)
        if clinic_id:
            query = query.filter((Doctor.clinic_id == clinic_id) | (Doctor.clinic_id == None))
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

        # Find existing bookings for this doctor and date
        existing_bookings = (
            db.query(Appointment)
            .filter(
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date == date_str,
                Appointment.status.in_(["CONFIRMED", "IN_CONSULTATION"]),
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
        payment_status: Optional[str] = "PAID",
        payment_method: Optional[str] = "UPI",
        paid_amount: Optional[int] = None,
        cabin: Optional[str] = "Cabin 1",
        skip_slot_check: bool = False,
        clinic_id: Optional[int] = None,
    ) -> Optional[Appointment]:
        # Check slot availability unless explicit walk-in / admin override
        if not skip_slot_check:
            available_slots = BookingService.get_available_slots(db, doctor_id, date_str)
            if start_time not in available_slots:
                return None

        doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
        start_dt = datetime.datetime.strptime(start_time, "%H:%M")
        end_dt = start_dt + datetime.timedelta(minutes=doctor.slot_duration_mins)
        end_time = end_dt.strftime("%H:%M")

        assigned_clinic_id = clinic_id if clinic_id is not None else getattr(doctor, "clinic_id", None)

        patient = BookingService.get_or_create_patient(db, phone, patient_name, source=source)
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
        if age is not None and str(age).strip():
            try:
                clean_age = int(str(age).strip())
                if 0 <= clean_age <= 130:
                    patient.age = clean_age
                    updated_patient = True
            except Exception:
                pass
        if blood_group and blood_group.strip():
            patient.blood_group = blood_group.strip()
            updated_patient = True

        if updated_patient:
            db.commit()

        # Backend calculation for consultation fee: Specialist rate with policy override
        doc_fee = doctor.consultation_fee if (hasattr(doctor, "consultation_fee") and doctor.consultation_fee is not None) else 500
        is_whatsapp = (source or "").strip().lower() == "whatsapp"
        
        # WhatsApp bookings are unpaid by default; payment is collected at clinic reception
        if is_whatsapp:
            final_payment_status = "PENDING"
            final_payment_method = "Pay at Clinic"
            final_paid_amount = 0
        else:
            final_payment_status = payment_status or "PAID"
            final_payment_method = payment_method or "Cash"
            if final_payment_status in ["PENDING", "UNPAID"]:
                final_paid_amount = 0
            elif visit_type == "Follow-up Visit":
                final_paid_amount = 0 if (paid_amount is None or paid_amount == doc_fee) else paid_amount
            elif paid_amount is not None:
                final_paid_amount = paid_amount
            else:
                final_paid_amount = doc_fee

        now_entry_time = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).strftime("%I:%M %p")
        appointment = Appointment(
            clinic_id=assigned_clinic_id,
            patient_id=patient.id,
            doctor_id=doctor_id,
            appointment_date=date_str,
            start_time=start_time,
            end_time=end_time,
            status="CONFIRMED",
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

        # 1. Exact string match
        if clean_phone:
            patient = db.query(Patient).filter(Patient.phone == clean_phone).first()
            if patient:
                return patient

            # 2. Try with or without leading '+'
            alt_phone = clean_phone[1:] if clean_phone.startswith("+") else f"+{clean_phone}"
            patient = db.query(Patient).filter(Patient.phone == alt_phone).first()
            if patient:
                return patient

            # 3. Normalized 10-digit match against all patients
            if norm:
                for p in db.query(Patient).all():
                    if normalize_phone(p.phone) == norm:
                        return p

        # 4. Fallback by patient name (case-insensitive) if non-generic
        clean_name = (name or "").strip()
        if clean_name and clean_name.lower() not in ["valued patient", "whatsapp patient", "direct patient"]:
            for p in db.query(Patient).all():
                if (p.name or "").strip().lower() == clean_name.lower():
                    # Associate phone with patient if phone was missing or different
                    if clean_phone and (not p.phone or p.phone in ["", "Not Provided"] or normalize_phone(p.phone) != norm):
                        p.phone = f"+91{norm}" if len(norm) == 10 else (f"+{norm}" if norm else clean_phone)
                        db.commit()
                        db.refresh(p)
                    return p

        return None

    @staticmethod
    def get_patient_upcoming_appointments(db: Session, phone: str, name: Optional[str] = None) -> List[Appointment]:
        patient = BookingService.find_patient_by_phone(db, phone, name=name)
        if not patient:
            return []
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        return (
            db.query(Appointment)
            .filter(
                Appointment.patient_id == patient.id,
                Appointment.status.in_(["CONFIRMED", "IN_CONSULTATION"]),
                Appointment.appointment_date >= today_str,
            )
            .order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc())
            .all()
        )

    @staticmethod
    def cancel_appointment(db: Session, phone: str, appointment_id: int, name: Optional[str] = None) -> bool:
        patient = BookingService.find_patient_by_phone(db, phone, name=name)
        if not patient:
            return False
        appt = (
            db.query(Appointment)
            .filter(Appointment.id == appointment_id, Appointment.patient_id == patient.id)
            .first()
        )
        if not appt:
            return False
        appt.status = "CANCELLED"
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
    ) -> Appointment:
        appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
        if not appt:
            raise ValueError("Appointment not found")

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
                Appointment.status.in_(["CONFIRMED", "IN_CONSULTATION"]),
            )
            .first()
        )
        if conflict:
            raise ValueError(f"Time slot {clean_start_time} on {date_str} is already booked for Dr. {doctor.name}")

        # Compute end_time based on doctor's slot duration
        duration_mins = doctor.slot_duration_mins if (doctor.slot_duration_mins and doctor.slot_duration_mins > 0) else 15
        start_dt = datetime.datetime.strptime(clean_start_time, "%H:%M")
        end_dt = start_dt + datetime.timedelta(minutes=duration_mins)
        end_time = end_dt.strftime("%H:%M")

        # Update appointment record
        appt.doctor_id = target_doctor_id
        appt.appointment_date = date_str
        appt.start_time = clean_start_time
        appt.end_time = end_time

        # If appointment was previously CANCELLED, reinstate to CONFIRMED
        if appt.status != "CONFIRMED":
            appt.status = "CONFIRMED"

        if notes and notes.strip():
            old_notes = appt.notes or ""
            reschedule_tag = f"[Rescheduled: {notes.strip()}]"
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
                # Patient rescheduled to a future date, remove from today's live waiting queue
                q.status = "SKIPPED"
            else:
                # Still today: sync doctor
                q.doctor_id = target_doctor_id

        db.commit()
        db.refresh(appt)
        return appt


booking_service = BookingService()
