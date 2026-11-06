import hmac
import hashlib
import logging
from typing import Optional, Dict, Any
import httpx

from app.config import settings

logger = logging.getLogger("aerostate_clinic.razorpay")


class RazorpayService:
    """
    Direct REST integration with Razorpay Cloud API for Payment Links & Webhooks.
    Zero external heavy libraries required; uses high-performance httpx.
    """

    BASE_URL = "https://api.razorpay.com/v1"

    @property
    def is_configured(self) -> bool:
        return bool(
            settings.RAZORPAY_KEY_ID
            and settings.RAZORPAY_KEY_SECRET
            and not settings.RAZORPAY_KEY_ID.startswith("YOUR_")
            and not settings.RAZORPAY_KEY_ID.startswith("rzp_test_placeholder")
        )

    def verify_webhook_signature(self, body_bytes: bytes, signature_header: Optional[str]) -> bool:
        """
        Validates Razorpay Webhook HMAC-SHA256 signature using RAZORPAY_WEBHOOK_SECRET.
        """
        secret = (settings.RAZORPAY_WEBHOOK_SECRET or "").strip()
        if not secret or not signature_header:
            return False

        calculated = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
        return hmac.compare_digest(calculated, signature_header.strip())

    async def create_payment_link(
        self,
        amount_rupees: float,
        description: str,
        customer_name: str,
        customer_phone: str,
        appointment_id: Optional[int] = None,
        invoice_id: Optional[int] = None,
        clinic_id: Optional[int] = None,
        expire_minutes: int = 60,
    ) -> Optional[Dict[str, Any]]:
        """
        Creates an official Razorpay Standard Payment Link supporting UPI (GPay, PhonePe, Paytm),
        Credit/Debit cards, and Net Banking.
        """
        if not self.is_configured:
            logger.info("Razorpay is not configured or disabled. Skipping payment link generation.")
            return None

        clean_phone = "".join(filter(str.isdigit, customer_phone))
        if len(clean_phone) == 10:
            clean_phone = f"+91{clean_phone}"
        elif not clean_phone.startswith("+"):
            clean_phone = f"+{clean_phone}"

        amount_paise = int(round(amount_rupees * 100))

        payload = {
            "amount": amount_paise,
            "currency": "INR",
            "accept_partial": False,
            "description": description[:200],
            "customer": {
                "name": customer_name[:100],
                "contact": clean_phone,
            },
            "notify": {
                "sms": False,
                "email": False,
            },
            "reminder_enable": False,
            "notes": {
                "appointment_id": str(appointment_id) if appointment_id else "",
                "invoice_id": str(invoice_id) if invoice_id else "",
                "clinic_id": str(clinic_id) if clinic_id else "",
                "clinic_name": settings.CLINIC_NAME,
            },
        }

        auth = (settings.RAZORPAY_KEY_ID.strip(), settings.RAZORPAY_KEY_SECRET.strip())

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    f"{self.BASE_URL}/payment_links",
                    json=payload,
                    auth=auth,
                )

                if res.status_code in (200, 201):
                    data = res.json()
                    link_id = data.get("id")
                    short_url = data.get("short_url")
                    logger.info(f"Razorpay Payment Link generated successfully: {short_url} ({link_id})")
                    return {
                        "payment_link_id": link_id,
                        "payment_url": short_url,
                        "amount": amount_rupees,
                        "status": data.get("status"),
                    }
                else:
                    logger.error(f"Razorpay API Error ({res.status_code}): {res.text}")
                    return None
        except Exception as e:
            logger.error(f"Failed to create Razorpay payment link: {e}")
            return None


razorpay_service = RazorpayService()
