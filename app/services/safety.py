"""Medical Safety and Emergency Escalation Service (Phase 7).

Implements conservative clinical safety mechanisms:
1. Emergency warning sign detection across English, Hindi, and Hinglish.
2. Immediate cessation of booking flows for potentially life-threatening emergencies.
3. Strict medical disclaimers prohibiting disease diagnosis, drug prescriptions, or dosage suggestions.
"""

import re
import logging
from typing import Optional, Tuple, Dict, Any, List
from app.models import Clinic

logger = logging.getLogger("aerostate_safety")

# Standard clinical disclaimer mandatory on all automated triage outputs
MEDICAL_SAFETY_DISCLAIMER = (
    "⚕️ *Medical Safety Notice:*\n"
    "_This automated assistant can help direct you to an appropriate department or doctor. "
    "It does not provide a medical diagnosis or replace professional medical advice._"
)

# Rule-based emergency warning signs (English, Hindi, Hinglish)
EMERGENCY_SIGN_PATTERNS = {
    "chest_pain_cardiac": {
        "label": "Severe Chest Pain / Potential Cardiac Emergency",
        "patterns": [
            r"\b(?:severe|crushing|heavy|sharp|tight|sudden)?\s*chest\s*(?:pain|pressure|tightness|heaviness)\b",
            r"\bheart\s*attack\b",
            r"\bcardiac\s*arrest\b",
            r"\bpain\s*in\s*(?:left\s*arm|jaw|back)\s*(?:and|with)?\s*chest\b",
            r"\b(?:seene|chhati|chaati)\s*me(?:h)?\s*(?:tez|bhaari|bahut)?\s*dard\b",
            r"\bdil\s*ka\s*daura\b",
            r"\bchhati\s*dab\s*rahi\b",
        ],
    },
    "severe_breathing_difficulty": {
        "label": "Severe Difficulty Breathing / Respiratory Distress",
        "patterns": [
            r"\b(?:severe|acute|extreme)?\s*(?:difficulty|trouble|struggling)\s*(?:in\s*)?breathing\b",
            r"\bcannot\s*breathe\b",
            r"\bunable\s*to\s*breathe\b",
            r"\bgasping\s*for\s*(?:air|breath)\b",
            r"\bsuffocating\b",
            r"\bsevere\s*shortness\s*of\s*breath\b",
            r"\bchoking\b",
            r"\bsaans\s*nahi\s*aa\s*rahi\b",
            r"\bsaans\s*lene\s*me(?:h)?\s*(?:bahut|tez)?\s*takleef\b",
            r"\bdam\s*ghut\s*raha\b",
            r"\bsaans\s*atak\s*rahi\b",
            r"\bsaans\s*phool\s*rahi\b",
        ],
    },
    "unconsciousness_collapse": {
        "label": "Unconsciousness / Collapse",
        "patterns": [
            r"\bunconscious(?:ness)?\b",
            r"\bpassed\s*out\b",
            r"\bfainted\b",
            r"\bcollapsed\b",
            r"\bunresponsive\b",
            r"\bloss\s*of\s*consciousness\b",
            r"\bnot\s*waking\s*up\b",
            r"\bbehosh(?:i)?\b",
            r"\bbehosh\s*ho\s*gaya\b",
            r"\bhosh\s*me(?:h)?\s*nahi\b",
        ],
    },
    "severe_bleeding": {
        "label": "Severe / Uncontrolled Bleeding",
        "patterns": [
            r"\b(?:severe|heavy|profuse|uncontrolled)\s*bleeding\b",
            r"\bbleeding\s*profusely\b",
            r"\bhemorrhage\b",
            r"\bvomiting\s*blood\b",
            r"\bcoughing\s*up\s*blood\b",
            r"\bblood\s*gushing\b",
            r"\bbahut\s*jyada\s*khoon\b",
            r"\bkhoon\s*(?:ruk|rukta)\s*nahi\s*raha\b",
            r"\bkhoon\s*ki\s*ulti\b",
        ],
    },
    "stroke_symptoms": {
        "label": "Stroke-like Warning Signs",
        "patterns": [
            r"\bstroke\b",
            r"\bparalysis\b",
            r"\bfacial\s*droop(?:ing)?\b",
            r"\bface\s*droop(?:ing)?\b",
            r"\b(?:sudden)?\s*slurred\s*speech\b",
            r"\bcannot\s*speak\s*suddenly\b",
            r"\bsudden\s*(?:arm|leg|side)\s*weakness\b",
            r"\bsudden\s*numbness\s*on\s*one\s*side\b",
            r"\blakwa\b",
            r"\bfalij\b",
            r"\bmuh\s*tedha\b",
            r"\baawaz\s*ladkhada\s*rahi\b",
        ],
    },
    "seizures_convulsions": {
        "label": "Seizures / Convulsions",
        "patterns": [
            r"\bseizure(?:s)?\b",
            r"\bconvulsion(?:s)?\b",
            r"\bepileptic\s*fit(?:s)?\b",
            r"\bfits\b",
            r"\bdaura\b",
            r"\bdaure\s*pad\s*rahe\b",
            r"\bmirgi\b",
            r"\bjhatke\s*aa\s*rahe\b",
        ],
    },
}


class SafetyService:
    """Evaluates symptoms for medical emergencies and enforces clinical safety protocols."""

    def detect_emergency(
        self, text: str, clinic: Optional[Clinic] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Conservative safety gate. Returns (is_emergency, category_key, label).
        Checks standard emergency patterns and clinician-configured emergency signs.
        """
        if not text:
            return False, None, None

        clean_text = text.lower().strip()

        # 1. Standard emergency regex matching
        for key, data in EMERGENCY_SIGN_PATTERNS.items():
            for pattern in data["patterns"]:
                if re.search(pattern, clean_text):
                    logger.warning(f"[EMERGENCY_SAFETY_TRIGGER] Matched {key} on text: '{text[:80]}'")
                    return True, key, data["label"]

        # 2. Clinician-configured emergency keywords on Clinic model
        if clinic and clinic.emergency_keywords:
            raw_keywords = [k.strip().lower() for k in clinic.emergency_keywords.split(",") if k.strip()]
            for kw in raw_keywords:
                if kw in clean_text:
                    logger.warning(f"[CLINICIAN_EMERGENCY_TRIGGER] Matched custom keyword '{kw}' on text: '{text[:80]}'")
                    return True, "custom_clinic_emergency", f"Clinic Emergency Warning Sign ({kw})"

        return False, None, None

    def build_emergency_message(
        self, clinic: Optional[Clinic], warning_label: str
    ) -> str:
        """
        Builds urgent emergency escalation guidance directing patient to immediate care.
        Advises calling 112 in India and displays clinic's emergency desk if available.
        """
        clinic_name = clinic.name if (clinic and clinic.name) else "our clinic"

        clinic_instructions = ""
        if clinic and clinic.emergency_contact:
            clinic_instructions += f"\n• *Clinic Emergency Helpline:* 📞 {clinic.emergency_contact}"
        if clinic and clinic.address:
            clinic_instructions += f"\n• *Emergency Casualty Desk:* 📍 {clinic.address}"

        text = (
            f"🚨 *URGENT MEDICAL EMERGENCY ALERT* 🚨\n\n"
            f"⚠️ *Warning Signs Detected:* *{warning_label}*\n\n"
            f"The symptoms you described may indicate a life-threatening medical emergency "
            f"that requires *immediate Medical Consultation and clinical evaluation*.\n\n"
            f"🚑 *IMMEDIATE EMERGENCY ACTIONS:*\n"
            f"• *National Emergency Ambulance:* 📞 *Call 112* immediately.\n"
            f"{clinic_instructions}\n\n"
            f"⏱️ *Do not wait for an automated appointment booking.* "
            f"Please proceed immediately to the nearest hospital emergency room or casualty ward."
        )
        return text


safety_service = SafetyService()
