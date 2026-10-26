// API Client for Aerostate Clinic Backend

const BASE_URL = "";

// ------------------------------------
// Secure In-Memory Token Management
// Tokens are strictly held in JavaScript memory, completely isolated from localStorage
// ------------------------------------
let _inMemoryAccessToken = null;

export function setAccessToken(token) {
  _inMemoryAccessToken = token;
}

export function getAccessToken() {
  return _inMemoryAccessToken;
}

export function clearAccessToken() {
  _inMemoryAccessToken = null;
}

export function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (_inMemoryAccessToken) {
    headers["Authorization"] = `Bearer ${_inMemoryAccessToken}`;
  }
  return headers;
}

// ------------------------------------
// Authentication APIs
// ------------------------------------

export async function loginUser(username, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // Receive HttpOnly refresh token cookie
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Login failed. Check your credentials.");
  }
  const data = await res.json();
  setAccessToken(data.access_token);
  return data;
}

export async function refreshSession() {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include", // Sends the secure HttpOnly cookie
    });
    if (!res.ok) {
      clearAccessToken();
      return null;
    }
    const data = await res.json();
    setAccessToken(data.access_token);
    return data;
  } catch {
    clearAccessToken();
    return null;
  }
}

export async function logoutUser() {
  try {
    await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include", // Clears server HttpOnly cookie
    });
  } catch {
    // Ignore network error on logout
  } finally {
    clearAccessToken();
  }
}

export async function fetchCurrentUser() {
  const res = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch user session");
  return res.json();
}

// ------------------------------------
// SuperAdmin User Management APIs
// ------------------------------------

export async function fetchSuperAdminUsers() {
  const res = await fetch(`${BASE_URL}/api/superadmin/users`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to fetch users");
  }
  return res.json();
}

export async function fetchSuperAdminStats() {
  const res = await fetch(`${BASE_URL}/api/superadmin/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to fetch superadmin stats");
  }
  return res.json();
}

export async function createSuperAdminUser(userData) {
  const res = await fetch(`${BASE_URL}/api/superadmin/users`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create user");
  }
  return res.json();
}

export async function updateSuperAdminUser(userId, userData) {
  const res = await fetch(`${BASE_URL}/api/superadmin/users/${userId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update user");
  }
  return res.json();
}

export async function deleteSuperAdminUser(userId) {
  const res = await fetch(`${BASE_URL}/api/superadmin/users/${userId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete user");
  }
  return res.json();
}

// ------------------------------------
// Multi-Clinic SaaS Management APIs
// ------------------------------------

export async function fetchClinics() {
  const res = await fetch(`${BASE_URL}/api/clinics`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to fetch clinics");
  }
  return res.json();
}

export async function fetchClinicDetail(clinicId) {
  const res = await fetch(`${BASE_URL}/api/clinics/${clinicId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to fetch clinic details");
  }
  return res.json();
}

export async function createClinic(clinicData) {
  const res = await fetch(`${BASE_URL}/api/clinics`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(clinicData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create clinic");
  }
  return res.json();
}

export async function updateClinic(clinicId, clinicData) {
  const res = await fetch(`${BASE_URL}/api/clinics/${clinicId}`, {
    method: "PUT",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(clinicData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update clinic");
  }
  return res.json();
}

export async function deleteClinic(clinicId) {
  const res = await fetch(`${BASE_URL}/api/clinics/${clinicId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete clinic");
  }
  return res.json();
}

export async function testClinicMeta(clinicId) {
  const res = await fetch(`${BASE_URL}/api/clinics/${clinicId}/test-meta`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to test Meta connection");
  }
  return res.json();
}

export async function setClinicAdminCredentials(clinicId, credentialsData) {
  const res = await fetch(`${BASE_URL}/api/clinics/${clinicId}/admin-credentials`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(credentialsData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to configure clinic admin credentials");
  }
  return res.json();
}

// ------------------------------------
// Clinic Operations APIs
// ------------------------------------

export async function fetchStats() {
  const res = await fetch(`${BASE_URL}/admin/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchAppointments(params = {}) {
  const query = new URLSearchParams();
  if (params.date) query.append("date", params.date);
  if (params.status) query.append("status", params.status);
  if (params.doctor_id) query.append("doctor_id", params.doctor_id);
  if (params.clinic_id) query.append("clinic_id", params.clinic_id);
  if (params.source) query.append("source", params.source);
  if (params.search) query.append("search", params.search);

  const res = await fetch(`${BASE_URL}/admin/appointments?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch appointments");
  return res.json();
}

export async function updateAppointmentStatus(id, status) {
  const res = await fetch(`${BASE_URL}/admin/appointments/${id}/status`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update status");
  }
  return res.json();
}

export async function collectAppointmentPayment(id, data = {}) {
  const res = await fetch(`${BASE_URL}/admin/appointments/${id}/collect-payment`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to collect payment");
  }
  return res.json();
}

export async function rescheduleAppointment(id, data) {
  const res = await fetch(`${BASE_URL}/admin/appointments/${id}/reschedule`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to reschedule appointment");
  }
  return res.json();
}

export async function createManualAppointment(data) {
  const res = await fetch(`${BASE_URL}/admin/appointments`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create appointment");
  }
  return res.json();
}

export async function fetchDoctorStats() {
  const res = await fetch(`${BASE_URL}/admin/doctors/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch doctor statistics");
  return res.json();
}

export async function fetchDoctorOptions() {
  const res = await fetch(`${BASE_URL}/admin/doctors/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch doctor options");
  return res.json();
}

export async function fetchDoctors(params = true) {
  const query = new URLSearchParams();
  if (typeof params === "boolean") {
    query.append("include_inactive", params);
  } else if (params && typeof params === "object") {
    query.append("include_inactive", params.include_inactive !== undefined ? params.include_inactive : true);
    if (params.search) query.append("search", params.search);
    if (params.specialization && params.specialization !== "ALL") query.append("specialization", params.specialization);
    if (params.status && params.status !== "ALL") query.append("status", params.status);
    if (params.date) query.append("date", params.date);
  }

  const res = await fetch(`${BASE_URL}/admin/doctors?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch doctors");
  return res.json();
}

export async function fetchEligibleStaffForDoctor() {
  const res = await fetch(`${BASE_URL}/admin/doctors/eligible-staff`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load eligible staff for doctor configuration");
  return res.json();
}

export async function createDoctor(doctorData) {
  const res = await fetch(`${BASE_URL}/admin/doctors`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(doctorData),
  });
  if (!res.ok) throw new Error("Failed to create doctor");
  return res.json();
}

export async function updateDoctor(doctorId, doctorData) {
  const res = await fetch(`${BASE_URL}/admin/doctors/${doctorId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(doctorData),
  });
  if (!res.ok) throw new Error("Failed to update doctor");
  return res.json();
}

export async function toggleDoctorStatus(doctorId) {
  const res = await fetch(`${BASE_URL}/admin/doctors/${doctorId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to toggle doctor status");
  return res.json();
}

export async function fetchDoctorSlots(doctorId, date) {
  const res = await fetch(`${BASE_URL}/admin/doctors/${doctorId}/slots?date=${date}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch slots");
  return res.json();
}

export async function fetchPatients(params = {}) {
  const query = new URLSearchParams();
  if (typeof params === "string") {
    if (params) query.append("search", params);
  } else if (params && typeof params === "object") {
    if (params.search) query.append("search", params.search);
    if (params.gender) query.append("gender", params.gender);
    if (params.source) query.append("source", params.source);
    if (params.date) query.append("date", params.date);
    if (params.page !== undefined && params.page !== null) query.append("page", params.page);
    if (params.page_size !== undefined && params.page_size !== null) query.append("page_size", params.page_size);
  }
  const queryString = query.toString() ? `?${query.toString()}` : "";
  const res = await fetch(`${BASE_URL}/admin/patients${queryString}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch patients");
  return res.json();
}

export async function fetchSettings() {
  const res = await fetch(`${BASE_URL}/admin/settings`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(payload) {
  const res = await fetch(`${BASE_URL}/admin/settings`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update settings");
  }
  return res.json();
}

export async function testMetaConnection() {
  const res = await fetch(`${BASE_URL}/admin/settings/test-meta`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Meta connection test failed");
  }
  return res.json();
}

// ------------------------------------
// WhatsApp Live Messages & Threads
// ------------------------------------

export async function fetchWhatsAppStats() {
  const res = await fetch(`${BASE_URL}/admin/messages/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load WhatsApp statistics");
  return res.json();
}

export async function fetchWhatsAppTemplates() {
  const res = await fetch(`${BASE_URL}/admin/messages/templates`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load WhatsApp templates");
  return res.json();
}

export async function fetchWhatsAppThreads(search = "") {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${BASE_URL}/admin/messages${query}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load WhatsApp conversation threads");
  return res.json();
}

export async function fetchWhatsAppMessages(phone) {
  const res = await fetch(`${BASE_URL}/admin/messages/${encodeURIComponent(phone)}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load patient messages");
  return res.json();
}

export async function sendWhatsAppMessage(phone, text) {
  const res = await fetch(`${BASE_URL}/admin/messages/send`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ phone, text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to send WhatsApp message");
  }
  return res.json();
}

// ------------------------------------
// Prescriptions & EMR APIs
// ------------------------------------

export async function fetchPrescriptions(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}/admin/prescriptions${query ? `?${query}` : ""}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to load prescriptions");
  return res.json();
}

export async function fetchPrescriptionStats() {
  const res = await fetch(`${BASE_URL}/admin/prescriptions/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load prescription statistics");
  return res.json();
}

export async function fetchPrescriptionTemplates() {
  const res = await fetch(`${BASE_URL}/admin/prescriptions/templates`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load prescription templates");
  return res.json();
}

export async function fetchPrescription(id) {
  const res = await fetch(`${BASE_URL}/admin/prescriptions/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load prescription details");
  return res.json();
}

export async function createPrescription(payload) {
  const res = await fetch(`${BASE_URL}/admin/prescriptions`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create prescription");
  }
  return res.json();
}

export async function sendPrescriptionWhatsApp(id) {
  const res = await fetch(`${BASE_URL}/admin/prescriptions/${id}/send-whatsapp`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to send prescription via WhatsApp");
  }
  return res.json();
}

export async function updatePrescriptionFulfillment(id, payload) {
  const res = await fetch(`${BASE_URL}/admin/prescriptions/${id}/fulfillment`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update prescription fulfillment");
  }
  return res.json();
}

// ------------------------------------
// Billing & Invoicing APIs
// ------------------------------------

export async function fetchBillingStats() {
  const res = await fetch(`${BASE_URL}/admin/billing/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load billing statistics");
  return res.json();
}

export async function fetchBillingOptions() {
  const res = await fetch(`${BASE_URL}/admin/billing/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load billing options");
  return res.json();
}

export async function fetchInvoices(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}/admin/billing/invoices${query ? `?${query}` : ""}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to load invoices");
  return res.json();
}

export async function fetchInvoice(id) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load invoice details");
  return res.json();
}

export async function fetchUnbilledServices(params = {}) {
  const query = new URLSearchParams();
  if (params.patient_id) query.append("patient_id", params.patient_id);
  if (params.encounter_id) query.append("encounter_id", params.encounter_id);
  if (params.appointment_id) query.append("appointment_id", params.appointment_id);

  const res = await fetch(`${BASE_URL}/admin/billing/unbilled-services?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch unbilled services");
  return res.json();
}

export async function createInvoice(payload) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate invoice");
  }
  return res.json();
}

export async function updateInvoiceStatus(id, payload) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices/${id}/status`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update invoice status");
  return res.json();
}

export async function sendInvoiceWhatsApp(id) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices/${id}/send-whatsapp`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to send invoice receipt via WhatsApp");
  }
  return res.json();
}

// ------------------------------------
// Waiting Room & Queue APIs
// ------------------------------------

// ------------------------------------
// Cabins Management APIs
// ------------------------------------

export async function fetchCabins(includeInactive = false) {
  const res = await fetch(`${BASE_URL}/admin/queue/cabins?include_inactive=${includeInactive}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load clinic cabins");
  return res.json();
}

export async function createCabin(payload) {
  const res = await fetch(`${BASE_URL}/admin/queue/cabins`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create cabin");
  }
  return res.json();
}

export async function updateCabin(cabinId, payload) {
  const res = await fetch(`${BASE_URL}/admin/queue/cabins/${cabinId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update cabin");
  }
  return res.json();
}

export async function toggleCabinStatus(cabinId) {
  const res = await fetch(`${BASE_URL}/admin/queue/cabins/${cabinId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to toggle cabin status");
  return res.json();
}

export async function fetchQueueOptions() {
  const res = await fetch(`${BASE_URL}/admin/queue/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load queue options");
  return res.json();
}

export async function fetchQueue(params = {}) {
  const query = new URLSearchParams();
  if (typeof params === "string") {
    query.append("date", params);
  } else {
    if (params.date) query.append("date", params.date);
    if (params.status) query.append("status", params.status);
    if (params.search) query.append("search", params.search);
    if (params.doctor_id) query.append("doctor_id", params.doctor_id);
    if (params.cabin) query.append("cabin", params.cabin);
  }
  const queryString = query.toString();
  const url = `${BASE_URL}/admin/queue${queryString ? `?${queryString}` : ""}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to load waiting room queue");
  return res.json();
}

export async function checkInPatient(appointmentId, cabin = "Cabin 1") {
  const res = await fetch(`${BASE_URL}/admin/queue/checkin`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ appointment_id: appointmentId, cabin }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to check in patient");
  }
  return res.json();
}

export async function callQueuePatient(entryId, cabin = "Cabin 1") {
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/call`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ cabin }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to call patient");
  }
  return res.json();
}

export async function startConsultationQueue(entryId) {
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/start-consultation`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to start consultation");
  }
  return res.json();
}

export async function finishQueuePatient(entryId) {
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/finish`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to mark consultation complete");
  }
  return res.json();
}

export async function skipQueuePatient(entryId) {
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/skip`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to skip queue entry");
  }
  return res.json();
}

export async function updateQueueStatus(entryId, status, cabin) {
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/status`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, cabin }),
  });
  if (!res.ok) throw new Error("Failed to update queue status");
  return res.json();
}

export async function notifyPatientTurn(entryId) {
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/notify`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to send turn alert");
  return res.json();
}

export async function finishAndCallNextQueue(entryId, cabin = "Cabin 1", doctorId = null) {
  const payload = { cabin };
  if (doctorId) payload.doctor_id = Number(doctorId);
  const res = await fetch(`${BASE_URL}/admin/queue/${entryId}/finish-and-call-next`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to finish and call next");
  }
  return res.json();
}

export async function callNextQueue(cabin = "Cabin 1", doctorId = null) {
  const payload = { cabin };
  if (doctorId) payload.doctor_id = Number(doctorId);
  const res = await fetch(`${BASE_URL}/admin/queue/call-next`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to call next patient");
  }
  return res.json();
}

// ------------------------------------
// Analytics APIs
// ------------------------------------

export async function fetchAnalytics() {
  const res = await fetch(`${BASE_URL}/admin/analytics`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load analytics");
  return res.json();
}

// ------------------------------------
// Automation APIs
// ------------------------------------

export async function runReminders() {
  const res = await fetch(`${BASE_URL}/admin/automation/run-reminders`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to trigger automated reminders");
  return res.json();
}

export async function runFeedbackFollowups() {
  const res = await fetch(`${BASE_URL}/admin/automation/run-feedback`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to trigger follow-up messages");
  return res.json();
}

export async function fetchAutomationStatus() {
  const res = await fetch(`${BASE_URL}/admin/automation/status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load automation status");
  return res.json();
}

// ------------------------------------
// Complete Patient Registry & EMR APIs (Module 1)
// ------------------------------------

export async function fetchPatientStats() {
  const res = await fetch(`${BASE_URL}/admin/patients/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch patient statistics");
  return res.json();
}

export async function fetchPatientRegistrationOptions() {
  const res = await fetch(`${BASE_URL}/admin/patients/registration-options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load registration options");
  return res.json();
}

export async function registerPatient(payload) {
  const res = await fetch(`${BASE_URL}/admin/patients`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to register patient");
  }
  return res.json();
}

export async function fetchPatientProfile(patientId) {
  const res = await fetch(`${BASE_URL}/admin/patients/${patientId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load patient medical profile");
  return res.json();
}

export async function updatePatientProfile(patientId, payload) {
  const res = await fetch(`${BASE_URL}/admin/patients/${patientId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update patient profile");
  return res.json();
}

export async function checkDuplicatePatient(phone, name) {
  const params = new URLSearchParams({ phone: phone || "" });
  if (name) params.append("name", name);
  const res = await fetch(`${BASE_URL}/admin/patients/check-duplicate?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return { has_potential_duplicates: false, matches: [] };
  return res.json();
}

// ------------------------------------
// Doctor Consultations & Clinical Notes APIs (Module 2)
// ------------------------------------

export async function fetchConsultations(params = {}) {
  const query = new URLSearchParams();
  if (params.doctor_id) query.append("doctor_id", params.doctor_id);
  if (params.status) query.append("status", params.status);
  if (params.date) query.append("date", params.date);
  if (params.search) query.append("search", params.search);

  const res = await fetch(`${BASE_URL}/admin/consultations?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load consultations");
  return res.json();
}

export async function fetchConsultationStats() {
  const res = await fetch(`${BASE_URL}/admin/consultations/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load consultation statistics");
  return res.json();
}

export async function fetchConsultationOptions() {
  const res = await fetch(`${BASE_URL}/admin/consultations/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load consultation options");
  return res.json();
}

export async function addConsultationLabTest(name, category = "General Diagnostic") {
  const res = await fetch(`${BASE_URL}/admin/consultations/lab-tests`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, category }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to add quick diagnostic test");
  }
  return res.json();
}

export async function fetchConsultation(encounterId) {
  const res = await fetch(`${BASE_URL}/admin/consultations/${encounterId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load consultation encounter");
  return res.json();
}

export async function startConsultation(payload) {
  const res = await fetch(`${BASE_URL}/admin/consultations`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to start consultation");
  }
  return res.json();
}

export async function updateConsultationDraft(encounterId, payload) {
  const res = await fetch(`${BASE_URL}/admin/consultations/${encounterId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to save consultation draft");
  }
  return res.json();
}

export async function finalizeConsultation(encounterId, doctorName, notes) {
  const res = await fetch(`${BASE_URL}/admin/consultations/${encounterId}/finalize`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ doctor_name: doctorName, notes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to sign consultation");
  }
  return res.json();
}

export async function cancelConsultation(encounterId) {
  const res = await fetch(`${BASE_URL}/admin/consultations/${encounterId}/cancel`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to cancel consultation");
  }
  return res.json();
}

export async function calculateConsultationVitals(height, weight) {
  const res = await fetch(`${BASE_URL}/admin/consultations/calculate-vitals`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ height, weight }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to calculate vitals on backend");
  }
  return res.json();
}

// ------------------------------------
// Laboratory & Diagnostics APIs (Module 3)
// ------------------------------------

export async function fetchLabTests(params = {}) {
  const query = new URLSearchParams();
  if (params.category) query.append("category", params.category);
  if (params.search) query.append("search", params.search);

  const res = await fetch(`${BASE_URL}/admin/laboratory/tests?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory tests");
  return res.json();
}

export async function addLabTest(payload) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/tests`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to add laboratory test");
  }
  return res.json();
}

export async function updateLabTest(testId, payload) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/tests/${testId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update laboratory test");
  }
  return res.json();
}

export async function deleteLabTest(testId) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/tests/${testId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete laboratory test");
  }
  return res.json();
}

export async function fetchLabCategories() {
  const res = await fetch(`${BASE_URL}/admin/laboratory/categories`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory categories");
  return res.json();
}

export async function createLabCategory(name) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/categories`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create diagnostic category");
  }
  return res.json();
}

export async function deleteLabCategory(payload) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/categories/delete`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete diagnostic category");
  }
  return res.json();
}

export async function fetchLabSampleTypes() {
  const res = await fetch(`${BASE_URL}/admin/laboratory/sample-types`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory sample types");
  return res.json();
}

export async function createLabSampleType(name) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/sample-types`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create sample type");
  }
  return res.json();
}

export async function deleteLabSampleType(payload) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/sample-types/delete`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete sample type");
  }
  return res.json();
}

export async function fetchLabStats() {
  const res = await fetch(`${BASE_URL}/admin/laboratory/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory statistics");
  return res.json();
}

export async function fetchLabOptions() {
  const res = await fetch(`${BASE_URL}/admin/laboratory/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory options");
  return res.json();
}

export async function fetchLabOrders(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.append("status", params.status);
  if (params.priority) query.append("priority", params.priority);
  if (params.search) query.append("search", params.search);

  const res = await fetch(`${BASE_URL}/admin/laboratory/orders?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory orders");
  return res.json();
}

export async function createLabOrder(payload) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate laboratory order");
  }
  return res.json();
}

export async function fetchLabOrder(orderId) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders/${orderId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load laboratory order");
  return res.json();
}

export async function collectLabOrderPayment(orderId, payload) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders/${orderId}/collect-payment`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to collect laboratory payment");
  }
  return res.json();
}

export async function resetLabOrderPayment(orderId, reason = "") {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders/${orderId}/reset-payment`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      reason: (reason || "").trim(),
      reset_by: "Laboratory Cashier",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to reset laboratory payment");
  }
  return res.json();
}

export function getInvoicePdfUrl(invoiceId, download = false) {
  return `${BASE_URL}/admin/billing/invoices/${invoiceId}/pdf${download ? "?download=true" : ""}`;
}

export function getLabOrderReceiptPdfUrl(orderId, download = false) {
  return `${BASE_URL}/admin/laboratory/orders/${orderId}/receipt/pdf${download ? "?download=true" : ""}`;
}

export async function downloadReceiptPdf(orderIdOrInvoiceId, isOrder = false, filename = "Receipt.pdf") {
  const url = isOrder
    ? getLabOrderReceiptPdfUrl(orderIdOrInvoiceId, true)
    : getInvoicePdfUrl(orderIdOrInvoiceId, true);

  const token = getAccessToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("Failed to download PDF receipt from server");

  // Prefer the dynamic server-provided filename in Content-Disposition if present
  let resolvedFilename = filename;
  const disposition = res.headers.get("content-disposition");
  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename=["']?([^"';]+)["']?/i);
    if (match && match[1]) {
      resolvedFilename = match[1].trim();
    }
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = resolvedFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

export async function printReceiptPdf(orderIdOrInvoiceId, isOrder = false) {
  const url = isOrder
    ? getLabOrderReceiptPdfUrl(orderIdOrInvoiceId, false)
    : getInvoicePdfUrl(orderIdOrInvoiceId, false);

  const token = getAccessToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("Failed to load PDF for printing");
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const printWindow = window.open(blobUrl, "_blank");
  if (printWindow) {
    printWindow.onload = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (e) {
        console.warn("Print trigger error:", e);
      }
    };
  } else {
    let iframe = document.getElementById("pdf-print-iframe");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "pdf-print-iframe";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      document.body.appendChild(iframe);
    }
    iframe.src = blobUrl;
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        window.location.href = blobUrl;
      }
    };
  }
}

export async function updateSampleStatus(orderId, status, notes, collector) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders/${orderId}/sample`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, notes, collector_name: collector }),
  });
  if (!res.ok) throw new Error("Failed to update sample status");
  return res.json();
}

export async function recordLabResults(orderId, technicianName, results) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders/${orderId}/results`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ technician_name: technicianName, results }),
  });
  if (!res.ok) throw new Error("Failed to record laboratory results");
  return res.json();
}

export async function verifyLabOrder(orderId, verifiedBy, notes) {
  const res = await fetch(`${BASE_URL}/admin/laboratory/orders/${orderId}/verify`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ verified_by: verifiedBy, notes }),
  });
  if (!res.ok) throw new Error("Failed to verify laboratory order");
  return res.json();
}

// ------------------------------------
// Pharmacy & Inventory APIs (Module 4)
// ------------------------------------

export async function fetchPharmacyStats() {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load pharmacy statistics");
  return res.json();
}

export async function fetchPharmacyOptions() {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load pharmacy options");
  return res.json();
}

export async function fetchMedicines(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.append("search", params.search);
  if (params.dosage_form && params.dosage_form !== "ALL") query.append("dosage_form", params.dosage_form);
  if (params.stock_status && params.stock_status !== "ALL") query.append("stock_status", params.stock_status);

  const res = await fetch(`${BASE_URL}/admin/pharmacy/medicines?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load medicines catalogue");
  return res.json();
}
export const fetchPharmacyMedicines = fetchMedicines;

export async function addMedicine(payload) {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/medicines`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to add medicine");
  }
  return res.json();
}

export async function updateMedicine(id, payload) {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/medicines/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update medicine");
  }
  return res.json();
}

export async function updateBatch(id, payload) {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/batches/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update batch");
  }
  return res.json();
}

export async function fetchBatches(params = {}) {
  const query = new URLSearchParams();
  if (typeof params === "number" || typeof params === "string") {
    if (params) query.append("medicine_id", params);
  } else if (params && typeof params === "object") {
    if (params.medicine_id) query.append("medicine_id", params.medicine_id);
    if (params.search) query.append("search", params.search);
    if (params.status && params.status !== "ALL") query.append("status", params.status);
  }

  const res = await fetch(`${BASE_URL}/admin/pharmacy/batches?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load medicine batches");
  return res.json();
}

export async function recordGoodsReceipt(payload) {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/batches/goods-receipt`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to record goods receipt");
  return res.json();
}

export async function dispensePrescription(payload) {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/dispense`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = "Dispensing failed";
    if (typeof err.detail === "string") {
      msg = err.detail;
    } else if (Array.isArray(err.detail)) {
      msg = err.detail.map((d) => d.msg || JSON.stringify(d)).join(", ");
    } else if (err.message) {
      msg = err.message;
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function fetchInventoryTransactions(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.append("search", params.search);
  if (params.transaction_type && params.transaction_type !== "ALL") query.append("transaction_type", params.transaction_type);
  if (params.limit) query.append("limit", params.limit);

  const res = await fetch(`${BASE_URL}/admin/pharmacy/transactions?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load inventory audit log");
  return res.json();
}

export async function fetchInventoryAlerts() {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/alerts`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load inventory alerts");
  return res.json();
}

export async function fetchPharmacyPrescriptions(params = {}) {
  const query = new URLSearchParams();
  if (params.patient_id) query.append("patient_id", params.patient_id);
  if (params.status) query.append("status", params.status);
  if (params.search) query.append("search", params.search);
  if (params.date) query.append("date", params.date);

  const res = await fetch(`${BASE_URL}/admin/pharmacy/prescriptions?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load pharmacy prescriptions");
  return res.json();
}

export async function sendPrescriptionToFrontDesk(rxId) {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/prescriptions/${rxId}/send-to-frontdesk-billing`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to forward prescription to Front Desk for billing");
  }
  return res.json();
}

export async function cancelPrescriptionDispatch(rxId, reason, cancelledBy = "Pharmacist") {
  const res = await fetch(`${BASE_URL}/admin/pharmacy/prescriptions/${rxId}/cancel`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ reason, cancelled_by: cancelledBy }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to cancel prescription");
  }
  return res.json();
}

// ------------------------------------
// Complete Billing & Payment APIs (Module 5)
// ------------------------------------

export async function fetchBillableServices(category) {
  const url = `${BASE_URL}/admin/billing/services${category ? `?category=${category}` : ""}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to load billable services");
  return res.json();
}

export async function addBillableService(payload) {
  const res = await fetch(`${BASE_URL}/admin/billing/services`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to add billable service");
  return res.json();
}

export async function recordInvoicePayment(invoiceId, payload) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Payment recording failed");
  }
  return res.json();
}

export async function recordInvoiceRefund(invoiceId, payload) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices/${invoiceId}/refunds`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Refund recording failed");
  }
  return res.json();
}

export async function fetchInvoicePayments(invoiceId) {
  const res = await fetch(`${BASE_URL}/admin/billing/invoices/${invoiceId}/payments`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load invoice payment history");
  return res.json();
}

// ------------------------------------
// Staff & Scheduling APIs (Module 6)
// ------------------------------------
// Staff & Scheduling APIs (Module 6)
// ------------------------------------

export async function fetchStaffStats() {
  const res = await fetch(`${BASE_URL}/admin/staff/stats`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load staff statistics");
  return res.json();
}

export async function fetchStaffOptions() {
  const res = await fetch(`${BASE_URL}/admin/staff/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load staff options");
  return res.json();
}

export async function fetchStaff(params = {}) {
  const query = new URLSearchParams();
  if (params.role && params.role !== "ALL") query.append("role", params.role);
  if (params.department && params.department !== "ALL") query.append("department", params.department);
  if (params.search) query.append("search", params.search);

  const res = await fetch(`${BASE_URL}/admin/staff?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load staff directory");
  return res.json();
}

export async function createStaff(payload) {
  const res = await fetch(`${BASE_URL}/admin/staff`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create staff member");
  return res.json();
}

export async function updateStaff(staffId, payload) {
  const res = await fetch(`${BASE_URL}/admin/staff/${staffId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update staff member");
  return res.json();
}

export async function toggleStaffStatus(staffId) {
  const res = await fetch(`${BASE_URL}/admin/staff/${staffId}/toggle-status`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update staff status");
  }
  return res.json();
}

export async function fetchDutyShifts(params = {}) {
  const query = new URLSearchParams();
  if (typeof params === "string") {
    query.append("date", params);
  } else if (params && typeof params === "object") {
    if (params.date) query.append("date", params.date);
    if (params.staff_id) query.append("staff_id", params.staff_id);
    if (params.search) query.append("search", params.search);
    if (params.status && params.status !== "ALL") query.append("status", params.status);
  }

  const res = await fetch(`${BASE_URL}/admin/staff/shifts?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load duty shifts");
  return res.json();
}

export async function assignDutyShift(payload) {
  const res = await fetch(`${BASE_URL}/admin/staff/shifts`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to assign shift");
  return res.json();
}

export async function fetchDoctorRoster() {
  const res = await fetch(`${BASE_URL}/admin/staff/doctor-roster`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load doctor roster");
  return res.json();
}

// ------------------------------------
// Clinic User Management & Roles
// ------------------------------------

export async function fetchClinicUsers(params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.append("page", params.page);
  if (params.page_size) query.append("page_size", params.page_size);
  if (params.role && params.role !== "ALL") query.append("role", params.role);
  if (params.status && params.status !== "ALL") query.append("status", params.status);
  if (params.search) query.append("search", params.search);

  const res = await fetch(`${BASE_URL}/admin/users?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to load clinic users");
  }
  return res.json();
}

export async function fetchUserOptions() {
  const res = await fetch(`${BASE_URL}/admin/users/options`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load user options");
  return res.json();
}

export async function createClinicUser(payload) {
  const res = await fetch(`${BASE_URL}/admin/users`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create user");
  }
  return res.json();
}

export async function updateClinicUser(userId, payload) {
  const res = await fetch(`${BASE_URL}/admin/users/${userId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update user");
  }
  return res.json();
}

export async function toggleUserStatus(userId) {
  const res = await fetch(`${BASE_URL}/admin/users/${userId}/toggle-status`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to toggle user status");
  }
  return res.json();
}

export async function resetUserPassword(userId, newPassword) {
  const res = await fetch(`${BASE_URL}/admin/users/${userId}/reset-password`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to reset password");
  }
  return res.json();
}
