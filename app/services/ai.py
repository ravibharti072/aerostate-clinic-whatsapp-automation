import json
import logging
import re
from typing import Optional, Dict, Any, List
import httpx
from app.config import settings
from app.models import Doctor

logger = logging.getLogger("ai_service")

# Clinical keyword taxonomy for multilingual / Hinglish symptoms
CLINICAL_SYMPTOM_MAP = {
    "dental": {
        "keywords": [
            "tooth", "teeth", "dant", "daant", "cavity", "gum", "gums", "masuda", "masude",
            "bleeding gum", "root canal", "rct", "braces", "tartar", "toothache", "danto",
            "dant dard", "daath", "daad", "akal daad", "wisdom tooth", "filling", "dentist",
            "dental", "enamel", "jaw pain", "mouth ulcer", "oral"
        ],
        "specialties": ["dentist", "dentistry", "dental", "maxillofacial", "orthodontist", "endodontist"],
        "display_name": "Dentist & Oral Healthcare",
    },
    "general_medicine": {
        "keywords": [
            "fever", "bukhar", "bukhaar", "cold", "sardi", "jukaam", "jukam", "cough", "khasi", "khaasi",
            "flu", "chills", "headache", "sar dard", "sirdard", "vomit", "vomiting", "ulti",
            "loose motion", "dast", "pet kharab", "diarrhea", "stomach pain", "pet dard", "pet dukh",
            "acidity", "gas", "indigestion", "weakness", "kamzori", "fatigue", "thakan",
            "dizziness", "chakkar", "blood pressure", "bp", "sugar", "diabetes", "infection",
            "viral", "typhoid", "malaria", "dengue", "body pain", "badan dard", "general checkup"
        ],
        "specialties": ["general physician", "general medicine", "internal medicine", "physician", "family medicine", "mbbs", "opd"],
        "display_name": "General Physician / Internal Medicine",
    },
    "pediatrics": {
        "keywords": [
            "child", "baccha", "bacha", "baby", "kid", "newborn", "infant", "toddler",
            "vaccination", "teeka", "tika", "pediatric", "paediatric", "child fever", "bachhe ko"
        ],
        "specialties": ["pediatrician", "pediatrics", "child specialist", "paediatrics"],
        "display_name": "Child Specialist / Pediatrician",
    },
    "dermatology": {
        "keywords": [
            "skin", "chamdi", "rash", "rashes", "khujli", "itching", "pimple", "pimples",
            "acne", "daag", "dhabbe", "fungal", "fungus", "ringworm", "eczema", "psoriasis",
            "hair fall", "baal", "dandruff", "allergy", "skin infection"
        ],
        "specialties": ["dermatologist", "dermatology", "skin specialist", "cosmetologist"],
        "display_name": "Dermatologist / Skin Specialist",
    },
    "orthopedics": {
        "keywords": [
            "bone", "haddi", "haddiyan", "joint", "joint pain", "jod me dard", "knee", "ghutna",
            "ghutne", "back pain", "kamar dard", "spine", "fracture", "sprain", "moch",
            "ligament", "shoulder pain", "kandhe me dard", "neck pain", "gardan dard", "arthritis", "ortho"
        ],
        "specialties": ["orthopedic", "orthopedics", "orthopaedic", "bone specialist"],
        "display_name": "Orthopedic / Bone & Joint Specialist",
    },
    "cardiology": {
        "keywords": [
            "heart", "dil", "chest pain", "seene me dard", "chhati me dard", "palpitation",
            "heart beat", "dharkan", "breathless", "saans phulna", "saans lene me takleef", "cardiac"
        ],
        "specialties": ["cardiologist", "cardiology", "heart specialist"],
        "display_name": "Cardiologist / Heart Specialist",
    },
    "gynecology": {
        "keywords": [
            "period", "periods", "menses", "mahwari", "pregnancy", "pregnant", "garbh",
            "gynae", "gynaecology", "pcos", "pcod", "pelvic", "white discharge", "delivery"
        ],
        "specialties": ["gynecologist", "gynecology", "gynaecologist", "obstetrics", "women specialist"],
        "display_name": "Gynecologist & Obstetrician",
    },
    "ent": {
        "keywords": [
            "ear", "kaan", "ear pain", "nose", "naak", "throat", "gala", "gale me dard",
            "sore throat", "tonsil", "tonsils", "hearing", "sunai", "sinus", "sinusitis"
        ],
        "specialties": ["ent", "ear nose throat", "otolaryngologist"],
        "display_name": "ENT Specialist",
    },
    "ophthalmology": {
        "keywords": [
            "eye", "aankh", "aankhe", "vision", "nazar", "chashma", "motiyabind", "cataract",
            "red eye", "eye drops", "aankh me dard"
        ],
        "specialties": ["ophthalmologist", "ophthalmology", "eye specialist"],
        "display_name": "Eye Specialist / Ophthalmologist",
    },
}


class AIService:
    def __init__(self):
        self.api_key = (settings.GEMINI_API_KEY or "").strip()
        self.gemini_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

    def _is_api_configured(self) -> bool:
        return bool(self.api_key and not self.api_key.startswith("YOUR_") and len(self.api_key) > 10)

    async def recommend_doctor_by_symptoms(
        self, symptoms_text: str, doctors: List[Doctor]
    ) -> Dict[str, Any]:
        """
        Determines the most suitable doctor based on user symptoms.
        Tries Gemini API first; falls back seamlessly to rule-based keyword matcher.
        """
        if not doctors:
            return {
                "doctor_id": None,
                "doctor_name": None,
                "specialization": None,
                "confidence": "LOW",
                "reasoning": "No doctors are currently available at the clinic.",
            }

        # 1. Try Gemini LLM if API key is configured
        if self._is_api_configured():
            try:
                ai_result = await self._call_gemini_recommender(symptoms_text, doctors)
                if ai_result and ai_result.get("doctor_id"):
                    return ai_result
            except Exception as e:
                logger.warning(f"Gemini API symptom recommendation call failed: {e}. Falling back to rule-based engine.")

        # 2. Seamless Rule-Based Fallback Engine
        return self._rule_based_matcher(symptoms_text, doctors)

    async def _call_gemini_recommender(
        self, symptoms_text: str, doctors: List[Doctor]
    ) -> Optional[Dict[str, Any]]:
        """Invokes Gemini REST API to analyze symptoms in English/Hindi/Hinglish."""
        docs_catalogue = "\n".join([
            f"- Doctor ID {d.id}: {d.name} (Specialization: {d.specialization})"
            for d in doctors
        ])

        prompt = f"""
You are an expert medical triage assistant for {settings.CLINIC_NAME}.
The patient is contacting our clinic on WhatsApp with symptoms in English, Hindi, or Hinglish.

Available Clinic Specialists:
{docs_catalogue}

Patient's Symptoms / Query:
"{symptoms_text}"

TASK:
1. Analyze the symptoms described by the patient.
2. Select the most relevant doctor from the available doctors list above.
3. If no specific specialist matches (or symptoms are general like fever, weakness, or pain), assign the General Physician or the best fit available.
4. Provide a warm, reassuring 1-sentence reasoning suitable for patient WhatsApp message.

Return ONLY a valid JSON object with this exact structure (no markdown fences, no extra text):
{{
  "doctor_id": <int: id from the list above>,
  "doctor_name": "<string: doctor name>",
  "specialization": "<string: doctor specialization>",
  "confidence": "HIGH" | "MEDIUM",
  "reasoning": "<1 concise sentence explaining why this specialist is right>"
}}
"""
        payload = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 300,
            }
        }

        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(
                f"{self.gemini_url}?key={self.api_key}",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                text_out = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                # Clean possible markdown wrapping
                if text_out.startswith("```"):
                    text_out = re.sub(r"^```(?:json)?\s*", "", text_out)
                    text_out = re.sub(r"\s*```$", "", text_out)
                parsed = json.loads(text_out)
                # Verify doctor_id exists in our list
                valid_ids = {d.id for d in doctors}
                if parsed.get("doctor_id") in valid_ids:
                    return parsed
            else:
                logger.warning(f"Gemini API returned status {resp.status_code}: {resp.text}")
        return None

    def _rule_based_matcher(
        self, symptoms_text: str, doctors: List[Doctor]
    ) -> Dict[str, Any]:
        """
        Multilingual clinical keyword heuristic engine.
        Scores each specialty category based on token matches and finds corresponding doctor.
        """
        clean_text = symptoms_text.lower()
        words = re.findall(r"\b[a-zA-Z\u0900-\u097F]+\b", clean_text)
        word_set = set(words)

        matched_category = None
        highest_score = 0

        for cat_name, data in CLINICAL_SYMPTOM_MAP.items():
            score = 0
            for kw in data["keywords"]:
                if " " in kw:
                    if kw in clean_text:
                        score += 3
                elif kw in word_set:
                    score += 2

            if score > highest_score:
                highest_score = score
                matched_category = cat_name

        # If we found a matching clinical category, match with doctors
        if matched_category and highest_score > 0:
            target_specialties = CLINICAL_SYMPTOM_MAP[matched_category]["specialties"]
            for doc in doctors:
                doc_spec = (doc.specialization or "").lower()
                if any(sp in doc_spec for sp in target_specialties):
                    cat_display = CLINICAL_SYMPTOM_MAP[matched_category]["display_name"]
                    return {
                        "doctor_id": doc.id,
                        "doctor_name": doc.name,
                        "specialization": doc.specialization,
                        "confidence": "HIGH",
                        "reasoning": f"Based on your symptoms, our {cat_display} is best suited for your consultation.",
                    }

        # Check for general physician among doctors
        general_keywords = ["general", "physician", "medicine", "internal", "family", "opd", "mbbs"]
        for doc in doctors:
            doc_spec = (doc.specialization or "").lower()
            if any(k in doc_spec for k in general_keywords):
                return {
                    "doctor_id": doc.id,
                    "doctor_name": doc.name,
                    "specialization": doc.specialization,
                    "confidence": "MEDIUM",
                    "reasoning": "Our General Physician will examine you and provide comprehensive diagnosis and care.",
                }

        # If clinic has specialized doctors (e.g. only Dental or specific field), assign top active doctor
        primary_doc = doctors[0]
        return {
            "doctor_id": primary_doc.id,
            "doctor_name": primary_doc.name,
            "specialization": primary_doc.specialization,
            "confidence": "MEDIUM",
            "reasoning": f"We recommend consulting {primary_doc.name} ({primary_doc.specialization}) at our clinic.",
        }


ai_service = AIService()
