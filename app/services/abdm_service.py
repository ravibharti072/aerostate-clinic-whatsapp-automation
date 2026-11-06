"""
Ayushman Bharat Digital Mission (ABDM) & ABHA Service
Module 1 (M1): ABHA Creation, Verification, and Card Generation

Supports both direct connection to the National Health Authority (NHA)
Gateway (https://dev.abdm.gov.in) and a high-fidelity Sandbox Simulation mode
for development and testing without credential blockage.
"""

import datetime
import json
import logging
import random
import re
import uuid
import httpx
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Patient

logger = logging.getLogger("aerostate_clinic.abdm")


class ABDMService:
    def __init__(self):
        self.client_id = settings.ABDM_CLIENT_ID or ""
        self.client_secret = settings.ABDM_CLIENT_SECRET or ""
        self.base_url = settings.ABDM_BASE_URL.rstrip("/")
        self.mock_mode = (
            getattr(settings, "ABDM_MOCK_MODE", True)
            or not self.client_id
            or not self.client_secret
            or self.client_id.startswith("YOUR_")
        )
        self._session_token: Optional[str] = None
        self._token_expires_at: Optional[datetime.datetime] = None

        # In-memory transaction cache for OTP verification
        self._active_txns: Dict[str, Dict[str, Any]] = {}

    def get_status(self) -> Dict[str, Any]:
        """Returns the current ABDM service configuration status."""
        return {
            "mode": "Sandbox Simulation" if self.mock_mode else "Live NHA Gateway",
            "mock_mode": self.mock_mode,
            "has_credentials": bool(self.client_id and self.client_secret and not self.client_id.startswith("YOUR_")),
            "base_url": self.base_url,
            "m1_supported": True,
            "milestones": ["M1 (ABHA Creation & Verification)", "M2 (HIP Health Records)", "M3 (HIU Data Exchange)"],
            "mock_otp": "111111 (or any 6-digit OTP in Sandbox mode)" if self.mock_mode else "Delivered to patient's Aadhaar/Mobile number",
        }

    async def _get_auth_token(self) -> str:
        """Retrieves or refreshes the NHA Gateway session token."""
        now = datetime.datetime.utcnow()
        if self._session_token and self._token_expires_at and now < self._token_expires_at:
            return self._session_token

        if self.mock_mode:
            self._session_token = f"mock_nha_token_{uuid.uuid4().hex[:16]}"
            self._token_expires_at = now + datetime.timedelta(minutes=30)
            return self._session_token

        url = f"{self.base_url}/v0.5/sessions"
        payload = {"clientId": self.client_id, "clientSecret": self.client_secret}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                self._session_token = data.get("accessToken")
                expires_in = data.get("expiresIn", 1800)
                self._token_expires_at = now + datetime.timedelta(seconds=expires_in - 60)
                return self._session_token
            else:
                logger.error(f"Failed to authenticate with NHA Gateway: {resp.status_code} {resp.text}")
                raise RuntimeError(f"NHA Gateway Auth Failed: {resp.text}")

    # ==========================================
    # 1. AADHAAR OTP: GENERATE & VERIFY
    # ==========================================

    async def generate_aadhaar_otp(self, aadhaar_number: str) -> Dict[str, Any]:
        """
        Initiates ABHA creation/verification by sending an OTP to the Aadhaar-linked mobile.
        """
        clean_aadhaar = re.sub(r"\D", "", str(aadhaar_number))
        if len(clean_aadhaar) != 12:
            raise ValueError("Invalid Aadhaar number. Must be exactly 12 digits.")

        txn_id = f"TXN-AADHAAR-{uuid.uuid4().hex[:12].upper()}"

        if self.mock_mode:
            # Sandbox Simulation
            self._active_txns[txn_id] = {
                "type": "aadhaar",
                "aadhaar": clean_aadhaar,
                "created_at": datetime.datetime.utcnow(),
                "test_otp": "111111",
            }
            return {
                "status": "SUCCESS",
                "txn_id": txn_id,
                "message": "OTP sent successfully to the Aadhaar-linked mobile number.",
                "is_mock": True,
                "hint": "In Sandbox mode, use test OTP: 111111 (or any 6 digits).",
                "masked_mobile": f"XXXX-XX-{random.randint(1000, 9999)}",
            }

        token = await self._get_auth_token()
        url = f"{self.base_url}/v1/registration/aadhaar/generateOtp"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"aadhaar": clean_aadhaar}

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                live_txn = data.get("txnId")
                self._active_txns[live_txn] = {
                    "type": "aadhaar",
                    "aadhaar": clean_aadhaar,
                    "created_at": datetime.datetime.utcnow(),
                }
                return {
                    "status": "SUCCESS",
                    "txn_id": live_txn,
                    "message": "OTP sent to Aadhaar-registered mobile.",
                    "is_mock": False,
                }
            else:
                logger.error(f"NHA Aadhaar OTP Error: {resp.text}")
                raise RuntimeError(f"NHA Aadhaar OTP generation failed: {resp.text}")

    async def verify_aadhaar_otp(
        self, txn_id: str, otp: str, mobile_for_comm: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Verifies the Aadhaar OTP and generates or retrieves the official ABHA profile.
        """
        clean_otp = str(otp).strip()
        if not clean_otp or len(clean_otp) < 4:
            raise ValueError("Please provide a valid 6-digit OTP.")

        txn_data = self._active_txns.get(txn_id)
        if not txn_data and not self.mock_mode:
            raise ValueError("Transaction expired or invalid. Please request a new OTP.")

        if self.mock_mode:
            # Format 14-digit ABHA: 91-XXXX-XXXX-XXXX
            p1 = random.randint(1000, 9999)
            p2 = random.randint(1000, 9999)
            p3 = random.randint(1000, 9999)
            mock_abha_number = f"91-{p1}-{p2}-{p3}"

            first_names = ["Ravi", "Aarav", "Neha", "Pooja", "Vikram", "Sneha", "Ankit", "Priya"]
            last_names = ["Bharti", "Sharma", "Verma", "Patel", "Gupta", "Singh", "Yadav"]
            fname = random.choice(first_names)
            lname = random.choice(last_names)
            full_name = f"{fname} {lname}"
            username_prefix = f"{fname.lower()}{random.randint(10, 99)}"
            mock_abha_address = f"{username_prefix}@abdm"

            birth_year = random.randint(1980, 2004)
            birth_month = random.randint(1, 12)
            birth_day = random.randint(1, 28)
            dob_str = f"{birth_year:04d}-{birth_month:02d}-{birth_day:02d}"

            profile = {
                "abha_number": mock_abha_number,
                "abha_address": mock_abha_address,
                "name": full_name,
                "gender": random.choice(["M", "F"]),
                "dob": dob_str,
                "year_of_birth": str(birth_year),
                "month_of_birth": str(birth_month),
                "day_of_birth": str(birth_day),
                "mobile": mobile_for_comm or f"98765{random.randint(10000, 99999)}",
                "email": f"{username_prefix}@gmail.com",
                "address": "Plot 14, Tajganj, Fatehabad Road",
                "district": "Agra",
                "state": "Uttar Pradesh",
                "pincode": "282001",
                "status": "VERIFIED",
                "verification_method": "AADHAAR_OTP",
                "verified_at": datetime.datetime.utcnow().isoformat(),
                "is_mock": True,
            }
            # Clean up transaction
            self._active_txns.pop(txn_id, None)
            return profile

        token = await self._get_auth_token()
        url = f"{self.base_url}/v1/registration/aadhaar/verifyOTP"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"otp": clean_otp, "txnId": txn_id}

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                self._active_txns.pop(txn_id, None)
                return {
                    "abha_number": data.get("healthIdNumber"),
                    "abha_address": data.get("healthId"),
                    "name": data.get("name"),
                    "gender": data.get("gender"),
                    "dob": f"{data.get('yearOfBirth')}-{data.get('monthOfBirth')}-{data.get('dayOfBirth')}",
                    "mobile": data.get("mobile"),
                    "email": data.get("email"),
                    "address": data.get("address"),
                    "state": data.get("stateName"),
                    "district": data.get("districtName"),
                    "pincode": data.get("pincode"),
                    "photo": data.get("profilePhoto"),
                    "status": "VERIFIED",
                    "verification_method": "AADHAAR_OTP",
                    "verified_at": datetime.datetime.utcnow().isoformat(),
                    "jwt_token": data.get("token"),
                    "is_mock": False,
                }
            else:
                logger.error(f"NHA Aadhaar OTP Verify Error: {resp.text}")
                raise RuntimeError(f"NHA verification failed: {resp.text}")

    # ==========================================
    # 2. MOBILE OTP: GENERATE & VERIFY
    # ==========================================

    async def generate_mobile_otp(self, mobile_number: str) -> Dict[str, Any]:
        """
        Sends an OTP to the given mobile number for ABHA generation / authentication.
        """
        clean_mobile = re.sub(r"\D", "", str(mobile_number))
        if len(clean_mobile) > 10:
            clean_mobile = clean_mobile[-10:]
        if len(clean_mobile) != 10:
            raise ValueError("Invalid mobile number. Must be 10 digits.")

        txn_id = f"TXN-MOB-{uuid.uuid4().hex[:12].upper()}"

        if self.mock_mode:
            self._active_txns[txn_id] = {
                "type": "mobile",
                "mobile": clean_mobile,
                "created_at": datetime.datetime.utcnow(),
                "test_otp": "111111",
            }
            return {
                "status": "SUCCESS",
                "txn_id": txn_id,
                "message": f"OTP sent to +91 {clean_mobile}.",
                "is_mock": True,
                "hint": "In Sandbox mode, use test OTP: 111111.",
            }

        token = await self._get_auth_token()
        url = f"{self.base_url}/v1/registration/mobile/generateOtp"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"mobile": clean_mobile}

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                live_txn = data.get("txnId")
                self._active_txns[live_txn] = {
                    "type": "mobile",
                    "mobile": clean_mobile,
                    "created_at": datetime.datetime.utcnow(),
                }
                return {
                    "status": "SUCCESS",
                    "txn_id": live_txn,
                    "message": "OTP sent to mobile.",
                    "is_mock": False,
                }
            else:
                raise RuntimeError(f"NHA Mobile OTP error: {resp.text}")

    async def verify_mobile_otp(self, txn_id: str, otp: str) -> Dict[str, Any]:
        """Verifies the mobile OTP."""
        clean_otp = str(otp).strip()
        if self.mock_mode:
            clean_mobile = "9876543210"
            if txn_id in self._active_txns:
                clean_mobile = self._active_txns[txn_id].get("mobile", clean_mobile)
            self._active_txns.pop(txn_id, None)

            p1, p2, p3 = random.randint(1000, 9999), random.randint(1000, 9999), random.randint(1000, 9999)
            return {
                "abha_number": f"91-{p1}-{p2}-{p3}",
                "abha_address": f"patient{clean_mobile[-4:]}@abdm",
                "name": "Self-Verified Patient",
                "mobile": clean_mobile,
                "status": "VERIFIED",
                "verification_method": "MOBILE_OTP",
                "verified_at": datetime.datetime.utcnow().isoformat(),
                "is_mock": True,
            }

        token = await self._get_auth_token()
        url = f"{self.base_url}/v1/registration/mobile/verifyOTP"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"otp": clean_otp, "txnId": txn_id}

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                self._active_txns.pop(txn_id, None)
                return {
                    "abha_number": data.get("healthIdNumber"),
                    "abha_address": data.get("healthId"),
                    "name": data.get("name"),
                    "mobile": data.get("mobile"),
                    "status": "VERIFIED",
                    "verification_method": "MOBILE_OTP",
                    "verified_at": datetime.datetime.utcnow().isoformat(),
                    "jwt_token": data.get("token"),
                    "is_mock": False,
                }
            else:
                raise RuntimeError(f"NHA Mobile OTP Verify error: {resp.text}")

    # ==========================================
    # 3. SEARCH & VERIFY EXISTING ABHA
    # ==========================================

    async def search_by_abha(self, query: str) -> Dict[str, Any]:
        """
        Searches and validates an existing ABHA number or address (e.g. 'ravi@abdm' or '91-1234-5678-9012').
        """
        clean_query = query.strip()
        if not clean_query:
            raise ValueError("Please provide an ABHA Address or 14-digit ABHA Number.")

        if self.mock_mode:
            # Deterministic mock lookup
            if "@" not in clean_query and len(re.sub(r"\D", "", clean_query)) == 14:
                abha_num = clean_query
                abha_addr = f"user{re.sub(r'\D', '', clean_query)[-4:]}@abdm"
            else:
                abha_addr = clean_query if "@" in clean_query else f"{clean_query}@abdm"
                abha_num = "91-4456-7890-1234"

            return {
                "status": "FOUND",
                "abha_number": abha_num,
                "abha_address": abha_addr,
                "name": "Verified ABHA Holder",
                "gender": "M",
                "dob": "1995-05-15",
                "mobile": "9876543210",
                "district": "Agra",
                "state": "Uttar Pradesh",
                "is_active": True,
                "is_mock": True,
            }

        token = await self._get_auth_token()
        url = f"{self.base_url}/v1/search/searchByHealthId"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"healthId": clean_query}

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "status": "FOUND",
                    "abha_number": data.get("healthIdNumber"),
                    "abha_address": data.get("healthId"),
                    "name": data.get("name"),
                    "gender": data.get("gender"),
                    "dob": f"{data.get('yearOfBirth')}-{data.get('monthOfBirth')}-{data.get('dayOfBirth')}",
                    "mobile": data.get("mobile"),
                    "is_active": data.get("status") == "ACTIVE",
                    "is_mock": False,
                }
            else:
                raise ValueError(f"ABHA record not found on NHA registry: {resp.text}")

    # ==========================================
    # 4. DATABASE LINKING & CARD RETRIEVAL
    # ==========================================

    def link_patient_abha(
        self,
        db: Session,
        patient_id: int,
        abha_number: str,
        abha_address: str,
        profile_data: Optional[Dict[str, Any]] = None,
    ) -> Patient:
        """Persists verified ABHA details directly onto the patient's record."""
        patient = db.query(Patient).filter(Patient.id == patient_id).first()
        if not patient:
            raise ValueError(f"Patient with ID {patient_id} not found.")

        # Check if ABHA is already linked to another patient
        existing = (
            db.query(Patient)
            .filter(
                (Patient.abha_number == abha_number) | (Patient.abha_address == abha_address),
                Patient.id != patient_id,
            )
            .first()
        )
        if existing:
            raise ValueError(f"This ABHA is already linked to another patient: {existing.name} ({existing.phone})")

        patient.abha_number = abha_number
        patient.abha_address = abha_address
        patient.abha_status = "VERIFIED"

        meta = {}
        if patient.abha_meta:
            try:
                meta = json.loads(patient.abha_meta)
            except Exception:
                meta = {}

        if profile_data:
            meta.update(profile_data)
            # Sync name/gender/dob if missing
            if profile_data.get("gender") and patient.gender in [None, "Unspecified"]:
                patient.gender = "Male" if profile_data.get("gender") == "M" else "Female"
            if profile_data.get("dob") and not patient.dob:
                patient.dob = profile_data.get("dob")

        patient.abha_meta = json.dumps(meta)
        db.commit()
        db.refresh(patient)
        return patient

    def unlink_patient_abha(self, db: Session, patient_id: int) -> Patient:
        """Removes ABHA linkage from a patient record."""
        patient = db.query(Patient).filter(Patient.id == patient_id).first()
        if not patient:
            raise ValueError(f"Patient with ID {patient_id} not found.")

        patient.abha_number = None
        patient.abha_address = None
        patient.abha_status = "UNLINKED"
        patient.abha_profile_photo = None
        db.commit()
        db.refresh(patient)
        return patient

    def get_abha_card_data(self, db: Session, patient_id: int) -> Dict[str, Any]:
        """
        Retrieves official ABHA Digital Card details, formatting QR data string.
        """
        patient = db.query(Patient).filter(Patient.id == patient_id).first()
        if not patient:
            raise ValueError("Patient not found.")

        if not patient.abha_number and not patient.abha_address:
            raise ValueError("Patient has no verified ABHA linked.")

        meta = {}
        if patient.abha_meta:
            try:
                meta = json.loads(patient.abha_meta)
            except Exception:
                meta = {}

        qr_content = json.dumps({
            "hid": patient.abha_number or "",
            "phr": patient.abha_address or "",
            "name": patient.name,
            "gender": patient.gender,
            "dob": patient.dob or "",
            "state": patient.state or "Uttar Pradesh",
            "dist": patient.city or "Agra",
            "issuer": "National Health Authority - ABDM",
        })

        return {
            "patient_id": patient.id,
            "patient_uid": patient.patient_uid,
            "name": patient.name,
            "gender": patient.gender,
            "dob": patient.dob or meta.get("dob", "N/A"),
            "mobile": patient.phone,
            "abha_number": patient.abha_number,
            "abha_address": patient.abha_address,
            "status": patient.abha_status,
            "verified_at": meta.get("verified_at", datetime.datetime.utcnow().strftime("%d-%b-%Y")),
            "qr_content": qr_content,
            "state": patient.state or "Uttar Pradesh",
            "district": patient.city or "Agra",
            "address": patient.address or "Aerostate Speciality Clinic Registered Citizen",
            "clinic_name": settings.CLINIC_NAME,
        }


abdm_service = ABDMService()
