# 🏥 Aerostate Clinic WhatsApp Automation ERP

An enterprise-ready, multi-tenant automated WhatsApp appointment scheduling and clinic ERP platform tailored for medical clinics, healthcare networks, polyclinics, dental practices, and diagnostic centers.

Built with **FastAPI**, **Meta WhatsApp Cloud API (Graph API v21.0)**, **SQLAlchemy (SQLite / PostgreSQL)**, **Razorpay Payment Gateway**, **Ayushman Bharat Digital Mission (ABDM/ABHA)** integration, and optional **Google Gemini AI**.

---

## 🌟 Key Architecture & Capabilities

### 1. Multi-Tenant Clinic Isolation
- **Strict Webhook Clinic Resolution:** Maps incoming Meta `phone_number_id` directly to configured clinic tenants. Zero cross-clinic fallback; unrecognized phone IDs are safely rejected with sanitized logging.
- **Data Scoping:** Every doctor, appointment, patient contact, invoice, payment, FAQ, and conversation session is strictly scoped to its clinic tenant.
- **Isolated Policies:** Each clinic independently configures consultation fees, operating hours, reception working hours, payment policies (`PAY_AT_CLINIC`, `ONLINE_REQUIRED`, `ADVANCE_PAYMENT`), reminder templates, and post-appointment features.

### 2. Complete WhatsApp Conversational Navigation
- **Interactive List Menus & Quick Reply Buttons:** Replaces fragile text prompts with intuitive WhatsApp native lists:
  - 📅 **Book Appointment** (Myself or Someone Else)
  - 🔄 **Reschedule Appointment** (Atomic slot swapping with 2-hour cutoff rule)
  - ❌ **Cancel Appointment** (Confirmation step, slot release, cancellation cutoff policy)
  - 📋 **My Appointments** (Clinic-scoped upcoming visit details, payment status, doctor names)
  - 🏥 **Doctors & Clinic Info** (Specialties, schedules, timings, address)
  - 💬 **Talk to Receptionist** (Staff handover dispatching with working-hours detection)
- **Natural Language & Text Command Parser:** Case-insensitive, fault-tolerant keyword recognition (`HI`, `HELLO`, `MENU`, `BOOK`, `RESCHEDULE`, `CANCEL`, `DOCTORS`, `HELP`, `HUMAN`).
- **Graceful Error Recovery:** Unexpected messages during active flows guide patients back without session breakage; typing `MENU` or `CANCEL` cleanly resets state.

### 3. Patient Details Collection & Atomic Slot Booking
- Multi-step booking collects target (*Myself* vs *Someone Else*), full name, optional reason for consultation, or symptom triage.
- **Double-Booking Prevention:** Concurrency-safe slot reservation. If a slot is taken before final confirmation, the patient is alerted and presented with alternative available slots.
- **Review & Confirm Step:** Complete appointment summary (Doctor, Date, Time, Fee, Clinic Address) presented before database commit.

### 4. Medical Safety & Clinical Triage
- **Strict Non-Diagnostic Guardrails:** The automated system does **not** diagnose conditions, prescribe medications, or recommend drug dosages.
- **Prominent Medical Disclaimers:** Accompanies all symptom triage suggestions.
- **Emergency Red Flag Escalation:** Automatic pattern matching detects life-threatening emergency symptoms (severe chest pain, breathing difficulty, stroke signs, sudden loss of consciousness, heavy hemorrhage) and halts booking to display immediate emergency contact numbers and hospital directions.
- **ABHA / ABDM Verification:** Ayushman Bharat Health Account validation with OTP simulation and clinic registry linking.

### 5. Automated Reminders & Timezone-Aware Background Scheduler
- Scheduled notifications at **24 hours** and **2 hours** before consultation.
- Clinic administrators can independently toggle 24h and 2h reminders.
- **Duplicate Prevention:** Persistent tracking in `NotificationLog` prevents repeat dispatches for identical slot bookings.
- **Automatic Retries:** Temporary Meta API connectivity failures are marked `FAILED` with retry tracking and recovered by `retry_failed_notifications()`.
- **Cancellation & Reschedule Sync:** Reminders are automatically rescheduled when an appointment date/time changes, and silenced if cancelled.

### 6. Post-Appointment Care & Secure Patient Document Portal
- **Consultation Completion:** Clinic staff explicitly mark visits `COMPLETED` in the ERP.
- **Feedback Collection:** WhatsApp star rating (`1` to `5`) with optional written patient reviews.
- **Expiring Document Access Tokens:** Cryptographically random, URL-safe expiring tokens for digital prescriptions and lab reports:
  - Tamper-proof validation (HTTP 404 on tampered tokens).
  - Enforced expiration (HTTP 410 when token expires).
  - Cross-patient isolation (HTTP 403 on mismatched patient requests).
- **Automated Payment Receipts:** Generated and dispatched immediately upon verified online capture or counter payment.

---

## 🔒 Security Hardening & Zero-Trust Safeguards

1. **Meta Webhook Cryptographic Verification:**
   - Raw incoming request payload verified using HMAC SHA-256 against `META_APP_SECRET`.
   - Constant-time string comparison protects against timing attacks.
   - Missing or tampered signatures are rejected with **HTTP 403 Forbidden**.
2. **Webhook Message Idempotency:**
   - Incoming Meta message IDs (`wamid`) recorded in `ProcessedWebhookMessage`. Redelivered webhooks are acknowledged without duplicate side effects.
3. **Razorpay Webhook Verification:**
   - Validates `X-Razorpay-Signature` against `RAZORPAY_WEBHOOK_SECRET` before updating invoice or appointment status.
4. **Session Expiration:**
   - Conversation sessions expire after 30 minutes of inactivity, resetting abandoned sessions safely.
5. **No Data Leakage:**
   - Error messages are sanitized and never leak database schemas, clinic IDs, or internal stack traces.

---

## 📁 Project Structure

```
aerostate-clinic-whatsapp-automation/
├── app/
│   ├── config.py                 # Pydantic environment configuration & defaults
│   ├── database.py               # SQLAlchemy database session & engine
│   ├── models.py                 # Complete DB schema (Clinic, Doctor, Appointment, Feedback, etc.)
│   ├── routers/
│   │   ├── webhook.py            # Meta WhatsApp Webhook, lists, buttons & flows
│   │   ├── admin.py              # Clinic staff admin & appointment management
│   │   ├── payments.py           # Razorpay payment orders & webhooks
│   │   ├── post_appointment.py   # Completion, feedback, follow-ups & document portal
│   │   ├── queue.py              # Real-time OPD queue management
│   │   ├── abha.py               # ABDM & ABHA verification endpoints
│   │   └── analytics.py          # Operational KPIs & metrics
│   └── services/
│       ├── whatsapp.py           # Meta Cloud API client (text, buttons, list menus)
│       ├── booking.py            # Slot calculations, session state machine, concurrency locks
│       ├── notifications.py      # Scheduled 24h/2h reminders & retry dispatcher
│       ├── post_appointment.py   # Feedback collection, document access grants & receipts
│       ├── razorpay_service.py   # Razorpay client & signature verification
│       ├── safety.py             # Medical disclaimers & emergency triage red flags
│       └── reception.py          # Receptionist handover requests & working hours
├── tests/                        # 97 End-to-End Automated Tests (Phases 1 - 9)
│   ├── test_phase1_security_reliability.py
│   ├── test_phase2_menu_navigation.py
│   ├── test_phase3_patient_booking.py
│   ├── test_phase4_reschedule_cancel.py
│   ├── test_phase5_reminders_notifications.py
│   ├── test_phase6_reception_and_faq.py
│   ├── test_phase7_symptom_safety_abha.py
│   ├── test_phase8_post_appointment.py
│   └── test_phase9_production_readiness.py
├── main.py                       # FastAPI application setup, router mounting & DB migrations
├── create_superadmin.py          # CLI utility to create initial admin credentials
├── requirements.txt              # Production Python dependencies
├── .env.example                  # Environment variables template
└── README.md                     # Complete production guide
```

---

## 🚀 Quick Start & Deployment Guide

### 1. Prerequisites
- Python 3.10+ (tested through Python 3.14)
- PostgreSQL (recommended for production) or SQLite (default)
- Meta Business Account with WhatsApp Cloud API access
- Razorpay account (for online payment collection)

### 2. Installation
```bash
git clone https://github.com/ravibharti072/aerostate-clinic-whatsapp-automation.git
cd aerostate-clinic-whatsapp-automation
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Environment Configuration (`.env`)
Copy the sample environment file:
```bash
cp .env.example .env
```
Key production variables:
```env
# Meta WhatsApp Cloud API
WHATSAPP_TOKEN=EAAB...
PHONE_NUMBER_ID=1005...
VERIFY_TOKEN=aerostate_secret_verify_token_2026
META_APP_SECRET=a1b2c3d4...
ENVIRONMENT=production
ALLOW_INSECURE_WEBHOOKS=false
WHATSAPP_SESSION_TIMEOUT_MINUTES=30

# Security
SECRET_KEY=generate_with_python_secrets_token_hex_32

# Database (PostgreSQL recommended for production)
DATABASE_URL=postgresql://clinic_user:strong_password@localhost:5432/clinic_erp

# Razorpay Payment Gateway
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_ENABLED=true
```

### 4. Create SuperAdmin Account
```bash
python create_superadmin.py superadmin "YourStrongPassword123!" "Clinic SuperAdmin"
```

### 5. Launch the Server
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```
- **Staff ERP Dashboard:** `http://localhost:8000`
- **Interactive API Documentation:** `http://localhost:8000/docs`

---

## 📋 Clinic Onboarding Checklist

When registering a new clinic tenant in the system:

1. **Clinic Profile Setup:**
   - Record unique `code`, `name`, `address`, `phone`, and `timezone` (e.g. `Asia/Kolkata`).
   - Register the clinic's dedicated Meta `phone_number_id` and optional custom `whatsapp_token`.
2. **Reception Configuration:**
   - Define reception working hours (`reception_start_time` & `reception_end_time`).
   - Configure `reception_phone` for staff handover escalations.
3. **Payment Policies:**
   - Select payment mode: `PAY_AT_CLINIC`, `ONLINE_REQUIRED`, or `ADVANCE_PAYMENT`.
   - Set consultation fee per doctor.
4. **Doctors & Schedules:**
   - Add doctors, specify specialization, working days, consultation fee, and slot duration (e.g. 15 or 30 mins).
5. **Reminders & Post-Appointment Toggles:**
   - Enable/disable 24-hour and 2-hour automated reminders (`reminder_24h_enabled`, `reminder_2h_enabled`).
   - Enable/disable feedback requests (`feedback_enabled`), follow-up reminders (`followup_reminders_enabled`), and digital document access (`document_access_enabled`).
6. **Clinic FAQs:**
   - Populate common clinic questions under categories (e.g., Timings, Insurance, Location, Parking).

---

## 🧪 Automated Test Suite (Phases 1 – 9)

Run the full regression test suite covering all security, reliability, multi-tenant isolation, and clinical workflows:

```bash
python -m pytest tests/ -v
```

### Test Coverage Breakdown:
| Test Suite | Focus Area | Status |
| :--- | :--- | :---: |
| `test_phase1_security_reliability.py` | Strict Clinic ID, HMAC SHA-256 Meta Signatures, Session Scoping | ✅ 10 Passed |
| `test_phase2_menu_navigation.py` | Interactive List Menu, Command Variations, Flow Routing | ✅ 11 Passed |
| `test_phase3_patient_booking.py` | Patient Details (Myself/Other), Slot Double-Booking Prevention | ✅ 10 Passed |
| `test_phase4_reschedule_cancel.py` | Rescheduling, Cancellations, 2h Cutoff Policy, History | ✅ 11 Passed |
| `test_phase5_reminders_notifications.py` | 24h/2h Reminders, Duplicate Prevention, Scheduler Retries | ✅ 10 Passed |
| `test_phase6_reception_and_faq.py` | Reception Handover, Working Hours Logic, Dynamic FAQs | ✅ 11 Passed |
| `test_phase7_symptom_safety_abha.py` | Multilingual Triage, Emergency Red Flags, ABHA/ADBM Gating | ✅ 14 Passed |
| `test_phase8_post_appointment.py` | Explicit Completion, Feedback Collection, Expiring Document Tokens | ✅ 10 Passed |
| `test_phase9_production_readiness.py` | E2E Patient Lifecycle, Multi-Clinic Isolation, Security & Reliability | ✅ 10 Passed |
| **Total Test Count** | **Comprehensive Full System Regression** | **✅ 97 / 97 Passed** |

---

## 🛡️ License & Compliance
This software is designed to assist healthcare administration and patient communication. It adheres to standard security best practices for patient privacy, tokenized document access, and non-diagnostic automated communication guardrails.
