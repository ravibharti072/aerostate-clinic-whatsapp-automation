import httpx
import logging
from typing import List, Dict, Any, Optional
from app.config import settings

logger = logging.getLogger("whatsapp_service")


class WhatsAppClient:
    def __init__(self):
        pass

    def get_url(self, phone_number_id: Optional[str] = None) -> str:
        pid = phone_number_id or settings.PHONE_NUMBER_ID
        return f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}/{pid}/messages"

    def get_headers(self, token: Optional[str] = None) -> Dict[str, str]:
        auth_token = token or settings.WHATSAPP_TOKEN
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        }

    @property
    def base_url(self) -> str:
        return self.get_url()

    @property
    def headers(self) -> Dict[str, str]:
        return self.get_headers()

    async def test_connection(
        self, phone_number_id: Optional[str] = None, token: Optional[str] = None
    ) -> Dict[str, Any]:
        """Pings Meta Graph API to verify the Phone Number ID and Token."""
        auth_token = token or settings.WHATSAPP_TOKEN
        pid = phone_number_id or settings.PHONE_NUMBER_ID

        if not auth_token or auth_token.startswith("YOUR_"):
            return {
                "success": False,
                "status": "error",
                "message": "WhatsApp Access Token is missing. Please enter your Meta token and save.",
                "error": "WhatsApp Access Token is not configured.",
            }
        if not pid or pid.startswith("YOUR_"):
            return {
                "success": False,
                "status": "error",
                "message": "Phone Number ID is missing. Please enter your Meta Phone Number ID and save.",
                "error": "Phone Number ID is not configured.",
            }

        url = f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}/{pid}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(url, headers=self.get_headers(auth_token))
                data = res.json()
                if res.status_code == 200:
                    disp_num = data.get("display_phone_number", pid)
                    v_name = data.get("verified_name", "Verified")
                    return {
                        "success": True,
                        "status": "ok",
                        "message": f"Connected to Meta! Verified Phone: {disp_num} ({v_name})",
                        "display_phone_number": disp_num,
                        "verified_name": v_name,
                        "quality_rating": data.get("quality_rating"),
                        "id": data.get("id"),
                    }
                else:
                    err_msg = data.get("error", {}).get("message", f"Meta API Error (HTTP {res.status_code})")
                    return {
                        "success": False,
                        "status": "error",
                        "message": err_msg,
                        "error": err_msg,
                    }
        except Exception as e:
            return {
                "success": False,
                "status": "error",
                "message": str(e),
                "error": str(e),
            }

    async def _send_payload(
        self,
        payload: Dict[str, Any],
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Sends a JSON payload to the Meta WhatsApp Cloud API."""
        auth_token = token or settings.WHATSAPP_TOKEN
        if not auth_token or auth_token.startswith("YOUR_"):
            logger.info("WhatsApp token is placeholder. Skipping actual Meta API call.")
            return {"simulated": True}

        url = self.get_url(phone_number_id)
        headers = self.get_headers(auth_token)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code >= 400:
                    logger.error(f"WhatsApp API Error {response.status_code}: {response.text}")
                    return None
                return response.json()
        except Exception as e:
            logger.error(f"Failed to communicate with WhatsApp API: {e}")
            return None

    async def send_text(
        self,
        to: str,
        text: str,
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Send a plain text message to a WhatsApp user."""
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"preview_url": False, "body": text},
        }
        return await self._send_payload(payload, phone_number_id=phone_number_id, token=token)

    async def send_quick_reply_buttons(
        self,
        to: str,
        body_text: str,
        buttons: List[Dict[str, str]],
        header_text: Optional[str] = None,
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Send up to 3 quick-reply buttons.
        buttons format: [{"id": "btn_1", "title": "Option 1"}, ...]
        """
        meta_buttons = []
        for btn in buttons[:3]:  # WhatsApp enforces max 3 quick-reply buttons
            meta_buttons.append({
                "type": "reply",
                "reply": {
                    "id": btn["id"],
                    "title": btn["title"][:20]  # Max 20 chars per button title
                }
            })

        interactive: Dict[str, Any] = {
            "type": "button",
            "body": {"text": body_text},
            "action": {"buttons": meta_buttons}
        }
        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive
        }
        return await self._send_payload(payload, phone_number_id=phone_number_id, token=token)

    async def send_list_menu(
        self,
        to: str,
        body_text: str,
        button_label: str,
        sections: List[Dict[str, Any]],
        header_text: Optional[str] = None,
        footer_text: Optional[str] = None,
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Send an interactive list menu (up to 10 items per section).
        """
        interactive: Dict[str, Any] = {
            "type": "list",
            "body": {"text": body_text},
            "action": {
                "button": button_label[:20],
                "sections": sections
            }
        }
        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}
        if footer_text:
            interactive["footer"] = {"text": footer_text}

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive
        }
        return await self._send_payload(payload, phone_number_id=phone_number_id, token=token)


whatsapp_client = WhatsAppClient()
