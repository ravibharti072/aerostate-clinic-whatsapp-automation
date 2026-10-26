# 🏥 Aerostate Clinic WhatsApp Automation

An automated WhatsApp appointment scheduling and booking system tailored for medical clinics, dental practices, consultants, and service businesses.

Built with **FastAPI**, **Meta WhatsApp Cloud API**, **SQLAlchemy (SQLite / PostgreSQL)**, and optional **Google Gemini AI**.

---

## 🌟 Key Features

1. **Self-Service Appointment Booking:**
   - Interactive WhatsApp buttons and list menus (eliminates customer typing mistakes).
   - Step 1: Select Specialist / Doctor.
   - Step 2: Select Available Date.
   - Step 3: Select Available Time Slot.
   - Instant Confirmation with appointment details and clinic address.
2. **Prevent Double Booking:**
   - Real-time slot calculation based on doctor working hours and existing confirmed bookings.
3. **Appointment Management:**
   - Patients can send `my appointments` to view upcoming visits and cancel with 1 click.
4. **Clinic Admin API:**
   - REST endpoints at `/admin/appointments` and `/admin/doctors` to view and manage appointments.
   - Interactive Swagger API docs available at `http://localhost:8000/docs`.
5. **100% Free Tier Compatible:**
   - Uses Meta's 1,000 free monthly service conversations, local/Supabase database, and free Cloudflare/ngrok tunnels.

---

## 📁 Project Structure

```
aerostate-clinic-whatsapp-automation/
│
├── app/
│   ├── config.py              # Configuration & environment variables
│   ├── database.py            # SQLAlchemy database engine
│   ├── models.py              # Patient, Doctor, Appointment, Session models
│   ├── routers/
│   │   ├── webhook.py         # Meta Webhook GET (verify) & POST (messages)
│   │   └── admin.py           # Clinic staff admin endpoints
│   └── services/
│       ├── whatsapp.py        # WhatsApp Cloud API client (text, buttons, lists)
│       ├── booking.py         # Slot availability, scheduling, cancellations
│       └── ai.py              # Optional Gemini AI intent parser
│
├── main.py                    # FastAPI server entrypoint & seed data
├── requirements.txt           # Python dependencies
├── .env.example               # Environment variables template
└── README.md                  # Complete documentation
```

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
Open your terminal in this directory and run:

```bash
pip install -r requirements.txt
```

### 2. Configure Environment (`.env`)
The `.env` file is pre-configured with local defaults. When ready to connect to live WhatsApp, update your credentials:

```env
WHATSAPP_TOKEN=your_meta_token_here
PHONE_NUMBER_ID=your_meta_phone_number_id_here
VERIFY_TOKEN=aerostate_secret_verify_token_2026
```

### 3. Initialize SuperAdmin & Start Server
Create your master SuperAdmin account:
```bash
python create_superadmin.py superadmin Admin@123 "Clinic SuperAdmin"
```

Then launch the production server:
```bash
python main.py
```
* **Production Web Suite & Login:** `http://localhost:8000`
* **Swagger API Documentation:** `http://localhost:8000/docs`

> [!IMPORTANT]
> **Default SuperAdmin Credentials:**
> - **User ID:** `superadmin`
> - **Password:** `Admin@123`
>
> Log in as SuperAdmin to access the **Staff & User Access** portal, where you can create normal staff accounts (Receptionists, Doctors, Managers) with their own credentials.

> [!NOTE]
> All dummy test records have been eliminated. Doctors, working schedules, and patient appointments are now 100% created and managed by you directly via the reception dashboard, SuperAdmin portal, or live Meta WhatsApp messages.

### 4. Interactive WhatsApp Simulator & Dashboard
Open `http://localhost:8000` in your browser. You get:
1. **📊 Operational Dashboard:** Live KPIs (Today's visits, confirmed/completed/cancelled bookings, active doctors).
2. **📅 Appointments Roster:** Search by patient name/phone, filter by date/doctor/status, and update statuses.
3. **👨‍⚕️ Doctors & Specialties:** Add new doctors, configure working hours/days, and customize slot lengths (15, 30, 45, 60 mins).
4. **👥 Patient Directory:** Track patient history and total bookings.
5. **💬 WhatsApp Simulator:** A realistic WhatsApp phone interface to test the bot live (sending "Hi", selecting doctors, choosing dates and slots, or viewing appointments) right in your browser!
6. **⚙️ Settings & Webhooks:** Copy-paste ready Webhook URLs and verify status flags.
---

## 🌐 Connecting with Meta WhatsApp Cloud API

### Step 1: Get Meta Credentials
1. Go to [Meta for Developers](https://developers.facebook.com) and click **Create App** (Select *Business* or *Other* -> *Business*).
2. Under "Add products to your app", click **Set up** on **WhatsApp**.
3. Under **API Setup**, copy:
   - **Temporary Access Token** -> Paste into `.env` as `WHATSAPP_TOKEN`
   - **Phone Number ID** -> Paste into `.env` as `PHONE_NUMBER_ID`

### Step 2: Expose Your Local Server via Tunnel
Meta requires an HTTPS endpoint to send incoming messages. Run either:

**Using ngrok:**
```bash
ngrok http 8000
```
*ngrok will output a URL like:* `https://abc-123.ngrok-free.app`

**Or using Cloudflare Tunnel (100% Free):**
```bash
cloudflared tunnel --url http://localhost:8000
```

### Step 3: Configure Webhook in Meta Dashboard
1. In the Meta Developer portal, go to **WhatsApp** -> **Configuration**.
2. Click **Edit** under **Webhook**:
   - **Callback URL:** `https://your-tunnel-url/webhook`
   - **Verify Token:** `aerostate_secret_verify_token_2026` (must match your `.env`)
3. Click **Verify and Save**.
4. Under **Webhook Fields**, click **Subscribe** to `messages`.

### Step 4: Send a WhatsApp Message!
Send a WhatsApp message saying `Hi` to the test number shown on your Meta dashboard. Your bot will greet you with interactive buttons!

---

## 🩺 Admin Endpoints

- **`GET /admin/appointments`**: View all appointments (filter by `date` or `status`).
- **`GET /admin/doctors`**: View active doctors and specializations.
- **`POST /admin/doctors`**: Add a new doctor to the clinic.
