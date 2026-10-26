"""
Interactive WhatsApp Clinic Bot Terminal Simulator
Allows you to chat with the WhatsApp bot directly in your terminal
to test greetings, symptom triage, doctor selection, dates, and slot booking!
"""

import sys
import asyncio

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from app.database import SessionLocal
from app.routers.webhook import handle_user_text, handle_user_button, handle_user_list_selection
from app.services.booking import booking_service
from app.models import WhatsAppMessage

def print_recent_bot_replies(db, phone, last_seen_id):
    messages = (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.phone == phone, WhatsAppMessage.id > last_seen_id, WhatsAppMessage.sender == "bot")
        .order_by(WhatsAppMessage.id.asc())
        .all()
    )
    for m in messages:
        print("\n" + "=" * 55)
        print("🤖 [BOT REPLY TO WHATSAPP]:")
        print(m.body)
        print("=" * 55 + "\n")
        last_seen_id = max(last_seen_id, m.id)
    return last_seen_id

async def main():
    db = SessionLocal()
    phone = "+919876500000"
    name = "Test Patient"
    
    # Reset session for clean testing
    booking_service.update_session(db, phone, step="IDLE", context={})
    
    last_id = db.query(WhatsAppMessage).order_by(WhatsAppMessage.id.desc()).first()
    last_seen_id = last_id.id if last_id else 0

    print("=" * 65)
    print(" 🏥 AEROSTATE CLINIC - WHATSAPP BOT TERMINAL SIMULATOR")
    print("=" * 65)
    print("You are simulating a WhatsApp patient (+919876500000).")
    print("\nQuick Commands to try:")
    print("  • Type 'hi' or 'book'")
    print("  • Type symptoms: 'dant me dard hai' or 'severe toothache'")
    print("  • Simulate Button: type 'btn:mode_general', 'btn:mode_symptoms', 'btn:mode_doctors', or 'btn:rec_accept_1'")
    print("  • Simulate List Menu: type 'list:doc_1', 'list:date_YYYY-MM-DD', or 'list:slot_09:00'")
    print("  • Type 'status' for your appointments")
    print("  • Type 'exit' to quit\n")

    # Send initial greeting
    await handle_user_text(db, phone, name, "hi")
    last_seen_id = print_recent_bot_replies(db, phone, last_seen_id)

    while True:
        try:
            user_input = input("👤 You (WhatsApp message): ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit", "q"]:
                print("\nExiting WhatsApp Simulator. Bye!")
                break
            
            if user_input.startswith("btn:"):
                btn_id = user_input.replace("btn:", "").strip()
                await handle_user_button(db, phone, name, button_id=btn_id)
            elif user_input.startswith("list:"):
                item_id = user_input.replace("list:", "").strip()
                await handle_user_list_selection(db, phone, name, item_id=item_id)
            else:
                await handle_user_text(db, phone, name, user_input)
            
            last_seen_id = print_recent_bot_replies(db, phone, last_seen_id)
        except (KeyboardInterrupt, EOFError):
            print("\nExiting WhatsApp Simulator.")
            break

    db.close()

if __name__ == "__main__":
    asyncio.run(main())
