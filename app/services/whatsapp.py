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

    async def send_raw_payload(
        self,
        payload: Dict[str, Any],
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Direct raw dispatch without offline queueing (used by outbox flusher)."""
        auth_token = token or settings.WHATSAPP_TOKEN
        if not auth_token or auth_token.startswith("YOUR_"):
            logger.info("WhatsApp token is placeholder. Simulated send.")
            return {"simulated": True}

        url = self.get_url(phone_number_id)
        headers = self.get_headers(auth_token)
        timeout = httpx.Timeout(timeout=10.0, connect=3.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code >= 400:
                logger.error(f"WhatsApp API Error {response.status_code}: {response.text}")
                return None
            return response.json()

    async def _send_payload(
        self,
        payload: Dict[str, Any],
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Sends a JSON payload to Meta. Automatically queues to SQLite outbox if offline or error."""
        from app.services.sync_service import is_internet_available, sync_service
        from app.database import SessionLocal

        auth_token = token or settings.WHATSAPP_TOKEN
        if not auth_token or auth_token.startswith("YOUR_"):
            logger.info("WhatsApp token is placeholder. Skipping actual Meta API call.")
            return {"simulated": True}

        recipient = payload.get("to")

        # 1. Immediate offline check: non-blocking auto-queue
        if not is_internet_available():
            logger.info(f"System offline: Auto-queuing WhatsApp to {recipient}")
            db = SessionLocal()
            try:
                sync_service.enqueue_whatsapp(
                    db=db,
                    recipient=recipient,
                    payload=payload,
                    phone_number_id=phone_number_id,
                    token=token,
                    last_error="Offline when message was generated",
                )
                return {
                    "status": "queued_offline",
                    "queued": True,
                    "simulated": False,
                    "message": "Message saved to offline outbox. Will be sent once internet connects.",
                }
            finally:
                db.close()

        # 2. Online send with fast connect timeout
        url = self.get_url(phone_number_id)
        headers = self.get_headers(auth_token)
        timeout = httpx.Timeout(timeout=8.0, connect=2.5)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code >= 400:
                    logger.error(f"WhatsApp API Error {response.status_code}: {response.text}")
                    if response.status_code in (429, 500, 502, 503, 504):
                        db = SessionLocal()
                        try:
                            sync_service.enqueue_whatsapp(
                                db=db,
                                recipient=recipient,
                                payload=payload,
                                phone_number_id=phone_number_id,
                                token=token,
                                last_error=f"HTTP {response.status_code}: {response.text[:200]}",
                            )
                            return {
                                "status": "queued_offline",
                                "queued": True,
                                "message": f"WhatsApp server error (HTTP {response.status_code}). Queued for retry.",
                            }
                        finally:
                            db.close()
                    return None
                return response.json()
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.NetworkError) as e:
            logger.warning(f"Connection failed ({e}). Auto-queuing message for {recipient}.")
            db = SessionLocal()
            try:
                sync_service.enqueue_whatsapp(
                    db=db,
                    recipient=recipient,
                    payload=payload,
                    phone_number_id=phone_number_id,
                    token=token,
                    last_error=str(e),
                )
                return {
                    "status": "queued_offline",
                    "queued": True,
                    "message": "Network disconnected. Message saved to offline outbox.",
                }
            finally:
                db.close()
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


    async def send_template(
        self,
        to: str,
        template_name: str,
        language_code: str = "en_US",
        body_parameters: Optional[List[str]] = None,
        components: Optional[List[Dict[str, Any]]] = None,
        phone_number_id: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Sends an approved Meta WhatsApp template message.
        Required for business-initiated notifications outside the 24-hour service window.
        """
        template_payload: Dict[str, Any] = {
            "name": template_name,
            "language": {"code": language_code},
        }

        if components:
            template_payload["components"] = components
        elif body_parameters:
            template_payload["components"] = [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": str(p)} for p in body_parameters],
                }
            ]

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": template_payload,
        }
        return await self._send_payload(payload, phone_number_id=phone_number_id, token=token)


whatsapp_client = WhatsAppClient()
