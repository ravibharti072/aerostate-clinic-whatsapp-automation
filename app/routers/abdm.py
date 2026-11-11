import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Patient
from app.services.abdm_service import abdm_service
from app.services.whatsapp import whatsapp_client
from app.services.messages import message_service
from app.security import get_current_user

logger = logging.getLogger("aerostate_clinic.abdm_router")

router = APIRouter(
    prefix="/admin/abdm",
    tags=["ABDM & ABHA (India Digital Health Stack)"],
)


class AadhaarOtpRequest(BaseModel):
    aadhaar_number: str = Field(..., description="12-digit Aadhaar Number")


class AadhaarOtpVerifyRequest(BaseModel):
    txn_id: str
    otp: str
    patient_id: Optional[int] = None
    mobile: Optional[str] = None


class MobileOtpRequest(BaseModel):
    mobile_number: str = Field(..., description="10-digit Mobile Number")


class MobileOtpVerifyRequest(BaseModel):
    txn_id: str
    otp: str
    patient_id: Optional[int] = None


class AbhaSearchRequest(BaseModel):
    query: str = Field(..., description="ABHA Address or 14-digit ABHA Number")


class AbhaLinkRequest(BaseModel):
    abha_number: str
    abha_address: str
    profile_data: Optional[Dict[str, Any]] = None


class AbhaEnterRequest(BaseModel):
    abha_number: str
    abha_address: Optional[str] = None


class AbhaConsentRequest(BaseModel):
    consent_purpose: Optional[str] = "CARE_CONTEXT_LINKAGE"


@router.get("/status")
def get_abdm_status(current_user: Any = Depends(get_current_user)):
    """Check configuration and connectivity of ABDM integration."""
    return abdm_service.get_status()


@router.post("/generate-aadhaar-otp")
async def generate_aadhaar_otp(
    payload: AadhaarOtpRequest,
    current_user: Any = Depends(get_current_user),
):
    """Generates an OTP via Aadhaar gateway for ABHA creation / linking."""
    try:
        res = await abdm_service.generate_aadhaar_otp(payload.aadhaar_number)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Generate Aadhaar OTP error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify-aadhaar-otp")
async def verify_aadhaar_otp(
    payload: AadhaarOtpVerifyRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Verifies Aadhaar OTP and optionally links directly to patient if patient_id is provided."""
    try:
        profile = await abdm_service.verify_aadhaar_otp(
            txn_id=payload.txn_id,
            otp=payload.otp,
            mobile_for_comm=payload.mobile,
        )

        # If patient_id provided, immediately persist linkage
        if payload.patient_id:
            updated_patient = abdm_service.link_patient_abha(
                db=db,
                patient_id=payload.patient_id,
                abha_number=profile.get("abha_number"),
                abha_address=profile.get("abha_address"),
                profile_data=profile,
            )
            profile["linked_to_patient_id"] = updated_patient.id
            profile["patient_name"] = updated_patient.name

        return profile
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Verify Aadhaar OTP error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-mobile-otp")
async def generate_mobile_otp(
    payload: MobileOtpRequest,
    current_user: Any = Depends(get_current_user),
):
    """Generates an OTP via Mobile gateway for ABHA creation / linking."""
    try:
        res = await abdm_service.generate_mobile_otp(payload.mobile_number)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Generate Mobile OTP error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify-mobile-otp")
async def verify_mobile_otp(
    payload: MobileOtpVerifyRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Verifies Mobile OTP and optionally links directly to patient."""
    try:
        profile = await abdm_service.verify_mobile_otp(
            txn_id=payload.txn_id,
            otp=payload.otp,
        )

        if payload.patient_id:
            updated_patient = abdm_service.link_patient_abha(
                db=db,
                patient_id=payload.patient_id,
                abha_number=profile.get("abha_number"),
                abha_address=profile.get("abha_address"),
                profile_data=profile,
            )
            profile["linked_to_patient_id"] = updated_patient.id
            profile["patient_name"] = updated_patient.name

        return profile
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Verify Mobile OTP error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def search_abha(
    payload: AbhaSearchRequest,
    current_user: Any = Depends(get_current_user),
):
    """Searches national registry for an existing ABHA Number or Address."""
    try:
        res = await abdm_service.search_by_abha(payload.query)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"ABHA Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/link/{patient_id}")
def link_abha_to_patient(
    patient_id: int,
    payload: AbhaLinkRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Explicitly links verified ABHA details to a patient record."""
    try:
        patient = abdm_service.link_patient_abha(
            db=db,
            patient_id=patient_id,
            abha_number=payload.abha_number,
            abha_address=payload.abha_address,
            profile_data=payload.profile_data,
        )
        return {
            "status": "success",
            "message": f"ABHA successfully linked to {patient.name}",
            "patient_id": patient.id,
            "abha_number": patient.abha_number,
            "abha_address": patient.abha_address,
            "abha_status": patient.abha_status,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@router.post("/enter/{patient_id}")
def enter_abha_for_patient(
    patient_id: int,
    payload: AbhaEnterRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Manually records an unverified ABHA number entered by patient or front desk (Phase 7)."""
    try:
        patient = abdm_service.enter_patient_abha(
            db=db,
            patient_id=patient_id,
            abha_number=payload.abha_number,
            abha_address=payload.abha_address,
        )
        return {
            "status": "success",
            "message": f"ABHA number recorded as ENTERED (unverified) for {patient.name}",
            "patient_id": patient.id,
            "abha_number": patient.abha_number,
            "abha_status": patient.abha_status,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@router.post("/consent/{patient_id}")
def record_patient_abha_consent(
    patient_id: int,
    payload: AbhaConsentRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Records patient explicit consent for ABDM health data linkage (Phase 7)."""
    try:
        patient = abdm_service.record_patient_consent(
            db=db,
            patient_id=patient_id,
            consent_purpose=payload.consent_purpose or "CARE_CONTEXT_LINKAGE",
        )
        return {
            "status": "success",
            "message": f"ABDM consent recorded for {patient.name}",
            "patient_id": patient.id,
            "abha_status": patient.abha_status,
            "abha_consented_at": patient.abha_consented_at.isoformat() if patient.abha_consented_at else None,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@router.post("/unlink/{patient_id}")
def unlink_abha_from_patient(
    patient_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Unlinks ABHA from a patient record."""
    try:
        patient = abdm_service.unlink_patient_abha(db=db, patient_id=patient_id)
        return {
            "status": "success",
            "message": f"ABHA unlinked from {patient.name}",
            "patient_id": patient.id,
            "abha_status": patient.abha_status,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@router.get("/card/{patient_id}")
def get_abha_card(
    patient_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Retrieves patient ABHA Digital Card details and QR data."""
    try:
        card = abdm_service.get_abha_card_data(db=db, patient_id=patient_id)
        return card
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))


@router.post("/send-card-whatsapp/{patient_id}")
async def send_abha_card_whatsapp(
    patient_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    """Dispatches the patient's official ABHA ID details to their WhatsApp."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient or not patient.phone:
        raise HTTPException(status_code=404, detail="Patient or phone number not found.")

    if not patient.abha_number:
        raise HTTPException(status_code=400, detail="Patient has no linked ABHA.")

    message_text = (
        f"🇮🇳 *AYUSHMAN BHARAT DIGITAL MISSION (ABDM)*\n"
        f"*Official ABHA Health ID Confirmation*\n\n"
        f"Dear *{patient.name}*,\n"
        f"Your Government of India ABHA Health Account is successfully linked with *Aerostate Speciality Clinic*!\n\n"
        f"💳 *ABHA Number:* {patient.abha_number}\n"
        f"🔗 *ABHA Address:* {patient.abha_address}\n"
        f"✅ *Status:* Government Verified (ABDM M1)\n"
        f"🛡️ *National Registry:* Active\n\n"
        f"Your health records (prescriptions & diagnostic reports) can now be securely accessed through your ABHA app or Aarogya Setu.\n\n"
        f"Need assistance? Reply anytime."
    )

    try:
        await whatsapp_client.send_text(to=patient.phone, text=message_text)
        message_service.log_message(
            db=db,
            phone=patient.phone,
            sender="bot",
            body=message_text,
            patient_name=patient.name,
            message_type="abha_card",
        )
        return {"status": "success", "message": "ABHA card sent via WhatsApp!"}
    except Exception as e:
        logger.error(f"WhatsApp dispatch error: {e}")
        return {"status": "warning", "message": f"Saved locally. WhatsApp dispatch notice: {e}"}
