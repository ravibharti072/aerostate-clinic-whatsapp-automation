"""Clinic FAQ & Knowledge Base Service (Phase 6).

Implements clinic-specific FAQ management, keyword-driven intent matching,
strict separation of administrative questions from medical consultations,
and fallback receptionist handover for unanswered inquiries.
"""

import re
import logging
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from app.models import Clinic, Doctor, ClinicFAQ

logger = logging.getLogger("aerostate_faq")

STOPWORDS = {
    "can", "could", "would", "is", "are", "the", "a", "an", "i", "my", "we", "our", "you", "your",
    "do", "does", "did", "to", "in", "at", "of", "for", "on", "it", "me", "what",
    "where", "how", "when", "why", "there", "this", "that", "any", "have", "has",
    "provide", "provides", "service", "services", "give", "take", "get", "want", "need",
    "know", "like", "tell", "please", "clinic"
}

# Medical terms for strict separation from administrative FAQs
MEDICAL_INDICATORS = {
    "symptom", "symptoms", "pain", "fever", "cough", "cold", "headache",
    "vomit", "vomiting", "nausea", "stomach", "chest pain", "breathless",
    "breathing", "tablet", "medicine", "medicines", "dosage", "diagnose",
    "diagnosis", "cure", "treatment", "infection", "rash", "disease",
    "blood pressure", "diabetes", "sugar", "illness", "ache", "swelling",
    "injury", "bleeding", "dizzy", "dizziness", "asthma", "allergy"
}


class FAQService:
    """Handles clinic FAQ indexing, search matching, answering, and medical inquiry screening."""

    def is_medical_query(self, query: str) -> bool:
        """Determines if query is medical/clinical in nature rather than administrative."""
        q_clean = query.lower()
        # Direct word matching
        words = re.findall(r"\b[a-z]{3,}\b", q_clean)
        for w in words:
            if w in MEDICAL_INDICATORS:
                return True
        for phrase in ["chest pain", "blood pressure", "head ache", "stomach pain", "body ache"]:
            if phrase in q_clean:
                return True
        return False

    def seed_default_faqs(self, db: Session, clinic_id: int) -> List[ClinicFAQ]:
        """Seeds or updates standard approved FAQs for a clinic using its actual profile."""
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            return []

        # Gather doctor details for fee and doctor FAQs
        doctors = db.query(Doctor).filter(Doctor.clinic_id == clinic_id, Doctor.is_active == True).all()
        fees = [d.consultation_fee for d in doctors if d.consultation_fee]
        min_fee = min(fees) if fees else 500
        max_fee = max(fees) if fees else 800

        doc_summary = ", ".join([f"{d.name} ({d.specialization})" for d in doctors]) if doctors else "General Physicians and Specialists"

        maps_part = f"\nDirections / Map: {clinic.google_maps_url}" if clinic.google_maps_url else ""
        rec_phone = clinic.reception_phone or clinic.phone or "our front desk"

        defaults = [
            {
                "category": "Timings",
                "question": "What are the clinic timings?",
                "keywords": "timings, timing, hours, open, close, schedule, time, operating hours, working hours, when",
                "answer": f"Our clinic operating hours are: {clinic.operating_hours or 'Mon-Sat: 09:00 AM - 08:00 PM'}.",
                "priority": 10,
            },
            {
                "category": "Location",
                "question": "Where is the clinic located?",
                "keywords": "location, address, where, reach, directions, map, place, route, landmark",
                "answer": f"Our clinic is located at: {clinic.address or 'City Center'}.{maps_part}",
                "priority": 10,
            },
            {
                "category": "Fees",
                "question": "What is the consultation fee?",
                "keywords": "consultation fee, fee, fees, cost, price, charge, charges, how much, rate",
                "answer": (
                    f"Consultation fees at {clinic.name} range from ₹{min_fee} to ₹{max_fee} "
                    f"depending on the doctor's specialization. General consultation starts at ₹{min_fee}."
                ),
                "priority": 9,
            },
            {
                "category": "Doctors",
                "question": "Which doctors are available?",
                "keywords": "doctors, doctor, specialist, specialists, physician, team, available doctors, who are the doctors",
                "answer": f"Available doctors at {clinic.name} include: {doc_summary}. You can view schedules in the Doctors menu.",
                "priority": 8,
            },
            {
                "category": "Walkin",
                "question": "Does the clinic accept walk-in patients?",
                "keywords": "walk-in, walk in, without appointment, direct visit, appointment required, emergency visit",
                "answer": (
                    f"Yes, {clinic.name} accepts walk-in patients during OPD hours. "
                    f"However, prior appointment booking via WhatsApp is recommended to avoid waiting time."
                ),
                "priority": 7,
            },
            {
                "category": "Online",
                "question": "Is online consultation available?",
                "keywords": "online, teleconsultation, video consultation, video call, remote, phone consult",
                "answer": (
                    f"Currently, appointments at {clinic.name} are primarily in-person clinic visits. "
                    f"Online or teleconsultation slots can be arranged through our reception team upon request."
                ),
                "priority": 6,
            },
            {
                "category": "Payments",
                "question": "What payment methods are accepted?",
                "keywords": "payment, payment methods, upi, cash, card, credit card, debit card, gpay, phonepe, paytm, netbanking",
                "answer": (
                    f"We accept Cash, UPI (Google Pay, PhonePe, Paytm), and Credit/Debit Cards at clinic reception. "
                    f"Online payments via WhatsApp Razorpay links are also available."
                ),
                "priority": 7,
            },
            {
                "category": "Lab",
                "question": "Does the clinic provide laboratory services?",
                "keywords": "laboratory, lab, pathology, blood test, urine test, diagnostic, sample, test, testing",
                "answer": (
                    f"Yes, laboratory and diagnostic pathology test collection services are available "
                    f"at {clinic.name} during clinic hours."
                ),
                "priority": 6,
            },
            {
                "category": "Pharmacy",
                "question": "Is there a pharmacy?",
                "keywords": "pharmacy, chemist, medicine, medical store, dispensary, drugs, prescription",
                "answer": f"Yes, {clinic.name} has an on-site dispensary / pharmacy providing prescribed medications.",
                "priority": 6,
            },
            {
                "category": "Reception",
                "question": "How can I contact reception?",
                "keywords": "contact reception, talk to reception, reception phone, human, front desk, helpdesk, receptionist",
                "answer": (
                    f"You can contact our reception desk at {rec_phone}, or simply type "
                    f"'Talk to Receptionist' here on WhatsApp to request a call back."
                ),
                "priority": 8,
            },
        ]

        created_faqs = []
        for d in defaults:
            # Check if already exists for this clinic by question
            existing = (
                db.query(ClinicFAQ)
                .filter(ClinicFAQ.clinic_id == clinic_id, ClinicFAQ.question == d["question"])
                .first()
            )
            if existing:
                existing.answer = d["answer"]
                existing.keywords = d["keywords"]
                existing.priority = d["priority"]
                existing.category = d["category"]
                existing.is_active = True
                created_faqs.append(existing)
            else:
                faq = ClinicFAQ(
                    clinic_id=clinic_id,
                    category=d["category"],
                    question=d["question"],
                    keywords=d["keywords"],
                    answer=d["answer"],
                    priority=d["priority"],
                    is_active=True,
                )
                db.add(faq)
                created_faqs.append(faq)

        db.commit()
        for f in created_faqs:
            db.refresh(f)
        return created_faqs

    def find_matching_faq(
        self, db: Session, clinic_id: int, query: str
    ) -> Optional[ClinicFAQ]:
        """Finds the best matching active FAQ for the clinic using normalized keyword and phrase scoring."""
        faqs = (
            db.query(ClinicFAQ)
            .filter(ClinicFAQ.clinic_id == clinic_id, ClinicFAQ.is_active == True)
            .all()
        )
        if not faqs:
            return None

        q_clean = re.sub(r"[^\w\s]", " ", query.lower()).strip()
        q_tokens = set(re.findall(r"\b[a-z0-9]{2,}\b", q_clean)) - STOPWORDS

        best_faq = None
        best_score = 0.0

        for faq in faqs:
            score = 0.0
            faq_q_lower = re.sub(r"[^\w\s]", " ", faq.question.lower()).strip()

            # Exact question match
            if q_clean == faq_q_lower or q_clean in faq_q_lower or faq_q_lower in q_clean:
                score += 10.0

            # Question token match (excluding stopwords)
            q_faq_tokens = set(re.findall(r"\b[a-z0-9]{2,}\b", faq_q_lower)) - STOPWORDS
            overlap = q_tokens.intersection(q_faq_tokens)
            score += len(overlap) * 2.5

            # Keywords matching
            if faq.keywords:
                raw_kw = [k.strip().lower() for k in faq.keywords.split(",") if k.strip()]
                for kw in raw_kw:
                    kw_clean = re.sub(r"[^\w\s]", " ", kw).strip()
                    if kw_clean and (kw_clean in q_clean or q_clean in kw_clean):
                        score += 3.5
                    kw_tokens = set(re.findall(r"\b[a-z0-9]{2,}\b", kw)) - STOPWORDS
                    if kw_tokens and kw_tokens.issubset(q_tokens):
                        score += 3.0

            # Priority boost only when relevant keywords or content matched
            if score > 0:
                score += (faq.priority or 0) * 0.1

            if score > best_score:
                best_score = score
                best_faq = faq

        # Match threshold to prevent false positives
        if best_score >= 2.0:
            return best_faq
        return None

    def answer_query(
        self, db: Session, clinic: Optional[Clinic], query: str
    ) -> Dict[str, Any]:
        """Processes patient query according to Phase 6 answering rules."""
        if not clinic:
            return {
                "type": "UNAVAILABLE",
                "answer": "Clinic information is currently unavailable.",
                "matched_faq": None,
                "offer_handover": True,
            }

        # 1. Medical Query Check (Strict clinical separation)
        if self.is_medical_query(query):
            return {
                "type": "MEDICAL",
                "answer": (
                    f"🩺 *Medical Consultation Advice*\n\n"
                    f"For medical symptoms, diagnosis, or prescription advice, "
                    f"please consult a qualified doctor at *{clinic.name}*. "
                    f"Automated systems do not provide medical treatments.\n\n"
                    f"Would you like to book a doctor consultation or speak with our receptionist?"
                ),
                "matched_faq": None,
                "offer_handover": True,
            }

        # 2. Approved Clinic FAQ lookup
        faq = self.find_matching_faq(db, clinic.id, query)
        if faq:
            return {
                "type": "FAQ",
                "answer": f"ℹ️ *{faq.question}*\n\n{faq.answer}",
                "matched_faq": faq,
                "offer_handover": False,
            }

        # 3. Unavailable / Missing Answer
        return {
            "type": "UNAVAILABLE",
            "answer": (
                f"I'm sorry, I couldn't find an answer to that in *{clinic.name}'s* approved clinic information.\n\n"
                f"Would you like to speak directly with our reception team for assistance?"
            ),
            "matched_faq": None,
            "offer_handover": True,
        }

    def list_faqs(
        self, db: Session, clinic_id: int, category: Optional[str] = None, active_only: bool = False
    ) -> List[ClinicFAQ]:
        """Lists FAQs for a clinic."""
        q = db.query(ClinicFAQ).filter(ClinicFAQ.clinic_id == clinic_id)
        if active_only:
            q = q.filter(ClinicFAQ.is_active == True)
        if category:
            q = q.filter(ClinicFAQ.category.ilike(category))
        return q.order_by(ClinicFAQ.priority.desc(), ClinicFAQ.id.asc()).all()

    def create_faq(
        self,
        db: Session,
        clinic_id: int,
        question: str,
        answer: str,
        category: str = "General",
        keywords: Optional[str] = None,
        priority: int = 0,
        is_active: bool = True,
    ) -> ClinicFAQ:
        """Creates a new clinic FAQ."""
        faq = ClinicFAQ(
            clinic_id=clinic_id,
            category=category,
            question=question,
            answer=answer,
            keywords=keywords,
            priority=priority,
            is_active=is_active,
        )
        db.add(faq)
        db.commit()
        db.refresh(faq)
        return faq

    def update_faq(
        self, db: Session, faq_id: int, **kwargs
    ) -> Optional[ClinicFAQ]:
        """Updates an existing clinic FAQ."""
        faq = db.query(ClinicFAQ).filter(ClinicFAQ.id == faq_id).first()
        if not faq:
            return None
        for k, v in kwargs.items():
            if hasattr(faq, k) and v is not None:
                setattr(faq, k, v)
        db.commit()
        db.refresh(faq)
        return faq

    def delete_faq(self, db: Session, faq_id: int) -> bool:
        """Deletes a clinic FAQ."""
        faq = db.query(ClinicFAQ).filter(ClinicFAQ.id == faq_id).first()
        if not faq:
            return False
        db.delete(faq)
        db.commit()
        return True


faq_service = FAQService()
