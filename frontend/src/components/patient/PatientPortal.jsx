import React, { useState, useEffect } from "react";
import {
  FiCalendar,
  FiClock,
  FiUser,
  FiPhone,
  FiCheckCircle,
  FiAlertCircle,
  FiSearch,
  FiXCircle,
  FiSettings,
  FiLogIn,
  FiUserCheck,
  FiHeart
} from "react-icons/fi";
import AerostateLogo from "../common/AerostateLogo";
import {
  fetchDoctors,
  fetchDoctorSlots,
  createManualAppointment,
  fetchAppointments,
  updateAppointmentStatus,
  getBaseUrl,
  setApiBaseUrl,
  generateAadhaarOtp,
  verifyAadhaarOtp,
  generateMobileOtp,
  verifyMobileOtp,
  searchAbha,
} from "../../api";

export default function PatientPortal({ onSwitchToStaffLogin }) {
  const [activeTab, setActiveTab] = useState("book"); // 'book' | 'my-appointments' | 'doctors'
  const [doctors, setDoctors] = useState([]);
  // ABHA Self-Service State
  const [abhaAadhaar, setAbhaAadhaar] = useState("");
  const [abhaTxnId, setAbhaTxnId] = useState("");
  const [abhaOtp, setAbhaOtp] = useState("");
  const [abhaStep, setAbhaStep] = useState("input"); // 'input' | 'otp' | 'card'
  const [abhaProfile, setAbhaProfile] = useState(null);
  const [abhaLoading, setAbhaLoading] = useState(false);
  const [abhaError, setAbhaError] = useState("");
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [clinicName, setClinicName] = useState("Aerostate Clinic");

  // Booking Form State
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(null);
  const [bookingError, setBookingError] = useState("");

  // My Appointments Search State
  const [searchPhone, setSearchPhone] = useState(
    localStorage.getItem("AEROSTATE_PATIENT_PHONE") || ""
  );
  const [myAppointments, setMyAppointments] = useState([]);
  const [loadingMyAppointments, setLoadingMyAppointments] = useState(false);
  const [myApptError, setMyApptError] = useState("");

  // Server URL Modal (for Android / Network settings)
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(getBaseUrl() || "");
  const [serverStatusMsg, setServerStatusMsg] = useState("");

  const getLocalDateIso = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayIso = getLocalDateIso();

  // Load doctors on mount
  useEffect(() => {
    loadDoctors();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setAppointmentDate(getLocalDateIso(tomorrow));
  }, []);

  const loadDoctors = async () => {
    try {
      setLoadingDoctors(true);
      const docs = await fetchDoctors(false);
      setDoctors(docs || []);
      if (docs && docs.length > 0 && !selectedDoctorId) {
        setSelectedDoctorId(docs[0].id);
      }
    } catch (err) {
      console.warn("Failed to load doctors:", err);
    } finally {
      setLoadingDoctors(false);
    }
  };

  // Load slots when doctor or date changes
  useEffect(() => {
    if (!selectedDoctorId || !appointmentDate) {
      setAvailableSlots([]);
      return;
    }
    if (appointmentDate < todayIso) {
      setAvailableSlots([]);
      return;
    }

    setLoadingSlots(true);
    setSelectedSlot("");
    fetchDoctorSlots(selectedDoctorId, appointmentDate)
      .then((slots) => {
        setAvailableSlots(slots || []);
      })
      .catch((err) => {
        console.warn("Failed to load slots:", err);
        setAvailableSlots([]);
      })
      .finally(() => setLoadingSlots(false));
  }, [selectedDoctorId, appointmentDate]);

  const handleBookSubmit = async (e) => {
    e.preventDefault();
    setBookingError("");

    if (!selectedDoctorId) return setBookingError("Please select a doctor.");
    if (!appointmentDate) return setBookingError("Please select an appointment date.");
    if (!selectedSlot) return setBookingError("Please select an available time slot.");
    if (!patientName.trim()) return setBookingError("Please enter your name.");
    if (!patientPhone.trim()) return setBookingError("Please enter your mobile phone number.");

    try {
      setBookingLoading(true);
      const res = await createManualAppointment({
        doctor_id: parseInt(selectedDoctorId, 10),
        appointment_date: appointmentDate,
        appointment_time: selectedSlot,
        patient_name: patientName.trim(),
        patient_phone: patientPhone.trim(),
        notes: notes.trim(),
      });

      localStorage.setItem("AEROSTATE_PATIENT_PHONE", patientPhone.trim());
      setBookingSuccess(res.appointment || {
        doctor_name: doctors.find((d) => d.id == selectedDoctorId)?.name,
        appointment_date: appointmentDate,
        appointment_time: selectedSlot,
        patient_name: patientName.trim(),
      });
      // Clear form
      setSelectedSlot("");
      setNotes("");
    } catch (err) {
      setBookingError(err.message || "Failed to book appointment. Please try again.");
    } finally {
      setBookingLoading(false);
    }
  };

  const handleSearchMyAppointments = async (phoneToSearch = searchPhone) => {
    const trimmed = phoneToSearch.trim();
    if (!trimmed) {
      setMyApptError("Please enter your phone number");
      return;
    }
    setMyApptError("");
    setLoadingMyAppointments(true);
    try {
      localStorage.setItem("AEROSTATE_PATIENT_PHONE", trimmed);
      const data = await fetchAppointments({ search: trimmed });
      setMyAppointments(data.appointments || []);
      if (!data.appointments || data.appointments.length === 0) {
        setMyApptError("No appointments found for this phone number.");
      }
    } catch (err) {
      setMyApptError("Failed to fetch appointments. Check connection.");
    } finally {
      setLoadingMyAppointments(false);
    }
  };

  const handleCancelAppointment = async (apptId) => {
    if (!window.confirm("Are you sure you want to cancel this appointment?")) return;
    try {
      await updateAppointmentStatus(apptId, "CANCELLED");
      setMyAppointments((prev) =>
        prev.map((a) => (a.id === apptId ? { ...a, status: "CANCELLED" } : a))
      );
    } catch (err) {
      alert("Failed to cancel appointment: " + err.message);
    }
  };

  const handleSaveServerUrl = () => {
    setApiBaseUrl(serverUrlInput.trim());
    setServerStatusMsg("Server URL saved! Reloading data...");
    setTimeout(() => {
      setShowServerModal(false);
      setServerStatusMsg("");
      loadDoctors();
    }, 800);
  };

  const selectedDoctorObj = doctors.find((d) => d.id == selectedDoctorId);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Mobile/Desktop Navigation Bar */}
      <header className="bg-slate-800/80 backdrop-blur border-b border-slate-700/80 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <AerostateLogo size="sm" />
            <div>
              <h1 className="text-base font-bold text-white tracking-wide leading-tight">
                {clinicName}
              </h1>
              <p className="text-xs text-blue-400 font-medium">Patient Self-Service</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowServerModal(true)}
              title="Server Connection Settings"
              className="p-2 rounded-lg bg-slate-700/70 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs flex items-center gap-1.5"
            >
              <FiSettings size={15} />
              <span className="hidden sm:inline">Server</span>
            </button>
            <button
              onClick={onSwitchToStaffLogin}
              className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 text-blue-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <FiLogIn size={14} />
              <span>Staff Login</span>
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="max-w-4xl mx-auto mt-3 flex border-b border-slate-700">
          <button
            onClick={() => {
              setActiveTab("book");
              setBookingSuccess(null);
            }}
            className={`flex-1 pb-2.5 text-xs sm:text-sm font-semibold text-center border-b-2 transition ${
              activeTab === "book"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Book Appointment
          </button>
          <button
            onClick={() => {
              setActiveTab("my-appointments");
              if (searchPhone) handleSearchMyAppointments(searchPhone);
            }}
            className={`flex-1 pb-2.5 text-xs sm:text-sm font-semibold text-center border-b-2 transition ${
              activeTab === "my-appointments"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            My Appointments
          </button>
          <button
            onClick={() => setActiveTab("doctors")}
            className={`flex-1 pb-2.5 text-xs sm:text-sm font-semibold text-center border-b-2 transition ${
              activeTab === "doctors"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Specialists ({doctors.length})
          </button>
          <button
            onClick={() => setActiveTab("abha")}
            className={`flex-1 pb-2.5 text-xs sm:text-sm font-semibold text-center border-b-2 transition ${
              activeTab === "abha"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🇮🇳 ABHA Health ID
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6">
        {/* TAB 1: BOOK APPOINTMENT */}
        {activeTab === "book" && (
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 sm:p-7 shadow-xl">
            {bookingSuccess ? (
              <div className="text-center py-6">
                <FiCheckCircle className="mx-auto text-emerald-400 mb-3" size={56} />
                <h2 className="text-xl font-bold text-white mb-1">Appointment Confirmed!</h2>
                <p className="text-slate-400 text-sm mb-5">
                  Your appointment has been registered successfully in our clinic system.
                </p>

                <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 max-w-md mx-auto text-left text-sm space-y-2 mb-6">
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Patient:</span>
                    <span className="font-semibold text-white">{bookingSuccess.patient_name}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Doctor / Specialist:</span>
                    <span className="font-semibold text-white">{bookingSuccess.doctor_name || selectedDoctorObj?.name}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Date:</span>
                    <span className="font-semibold text-white">{bookingSuccess.appointment_date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Time Slot:</span>
                    <span className="font-semibold text-emerald-400">{bookingSuccess.appointment_time}</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    onClick={() => {
                      setBookingSuccess(null);
                      setActiveTab("my-appointments");
                      handleSearchMyAppointments(patientPhone);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition"
                  >
                    View My Appointments
                  </button>
                  <button
                    onClick={() => setBookingSuccess(null)}
                    className="px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm transition"
                  >
                    Book Another Slot
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBookSubmit} className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <FiCalendar className="text-blue-400" /> Book an Appointment
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Select your specialist, preferred date, and suitable time slot.
                  </p>
                </div>

                {bookingError && (
                  <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-300 text-xs flex items-center gap-2">
                    <FiAlertCircle size={16} className="shrink-0" />
                    <span>{bookingError}</span>
                  </div>
                )}

                {/* 1. Doctor Selection */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    1. Select Doctor / Specialist
                  </label>
                  {loadingDoctors ? (
                    <div className="text-xs text-slate-400 py-2">Loading specialists...</div>
                  ) : doctors.length === 0 ? (
                    <div className="text-xs text-amber-400 py-2">
                      No doctors available at this time. Please check your clinic server connection.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {doctors.map((doc) => {
                        const isSelected = selectedDoctorId == doc.id;
                        return (
                          <div
                            key={doc.id}
                            onClick={() => setSelectedDoctorId(doc.id)}
                            className={`cursor-pointer rounded-xl p-3 border transition flex items-center justify-between ${
                              isSelected
                                ? "bg-blue-900/40 border-blue-500 shadow-md"
                                : "bg-slate-900/60 border-slate-700 hover:border-slate-600"
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <p className="font-semibold text-sm text-white truncate">{doc.name}</p>
                              <p className="text-xs text-blue-400 truncate">
                                {doc.specialization || "General Physician"}
                              </p>
                              {doc.fee ? (
                                <p className="text-[11px] text-slate-400 mt-0.5">Fee: ₹{doc.fee}</p>
                              ) : null}
                            </div>
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                isSelected ? "border-blue-400 bg-blue-500" : "border-slate-600"
                              }`}
                            >
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Date Picker */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    2. Choose Date
                  </label>
                  <div className="relative max-w-xs">
                    <input
                      type="date"
                      min={todayIso}
                      value={appointmentDate}
                      onChange={(e) => setAppointmentDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                {/* 3. Slot Selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    3. Select Time Slot
                  </label>
                  {loadingSlots ? (
                    <div className="text-xs text-slate-400 py-3 flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
                      Checking real-time slot availability...
                    </div>
                  ) : availableSlots.length === 0 ? (
                    <div className="p-3 bg-slate-900/50 border border-slate-700/60 rounded-xl text-xs text-amber-300">
                      No slots available on this date for this specialist. Please choose another date.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {availableSlots.map((slot) => {
                        const isSelected = selectedSlot === slot;
                        return (
                          <button
                            type="button"
                            key={slot}
                            onClick={() => setSelectedSlot(slot)}
                            className={`py-2 px-1 text-center rounded-xl text-xs font-semibold transition border ${
                              isSelected
                                ? "bg-blue-600 text-white border-blue-400 shadow-md"
                                : "bg-slate-900/80 text-slate-300 border-slate-700 hover:border-blue-500/60 hover:text-white"
                            }`}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Patient Information */}
                <div className="border-t border-slate-700/80 pt-4">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                    4. Patient Details
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="relative">
                        <FiUser className="absolute left-3.5 top-3 text-slate-500" />
                        <input
                          type="text"
                          placeholder="Your Full Name *"
                          value={patientName}
                          onChange={(e) => setPatientName(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <div className="relative">
                        <FiPhone className="absolute left-3.5 top-3 text-slate-500" />
                        <input
                          type="tel"
                          placeholder="WhatsApp Phone Number *"
                          value={patientPhone}
                          onChange={(e) => setPatientPhone(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                          required
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        placeholder="Reason / Symptoms (Optional)"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={bookingLoading || !selectedSlot || !selectedDoctorId}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#254d90] to-[#126868] hover:from-[#1e3f78] hover:to-[#0e5252] disabled:opacity-50 text-white font-semibold text-sm shadow-lg transition flex items-center justify-center gap-2"
                >
                  {bookingLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      <span>Securing Appointment...</span>
                    </>
                  ) : (
                    <>
                      <FiCheckCircle size={17} />
                      <span>Confirm &amp; Book Appointment</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* TAB 2: MY APPOINTMENTS */}
        {activeTab === "my-appointments" && (
          <div className="space-y-4">
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-xl">
              <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1">
                <FiClock className="text-blue-400" /> Check Your Bookings
              </h2>
              <p className="text-xs text-slate-400 mb-3">
                Enter your mobile phone number to find your scheduled appointments.
              </p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <FiPhone className="absolute left-3.5 top-3 text-slate-500" />
                  <input
                    type="tel"
                    placeholder="Enter phone number (e.g. 9876543210)"
                    value={searchPhone}
                    onChange={(e) => setSearchPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchMyAppointments()}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => handleSearchMyAppointments()}
                  disabled={loadingMyAppointments}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <FiSearch size={15} />
                  <span>Search</span>
                </button>
              </div>

              {myApptError && (
                <p className="text-xs text-amber-400 mt-2.5">{myApptError}</p>
              )}
            </div>

            {loadingMyAppointments ? (
              <div className="text-center py-10 text-slate-400 text-sm flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
                Fetching your bookings...
              </div>
            ) : myAppointments.length > 0 ? (
              <div className="space-y-3">
                {myAppointments.map((appt) => {
                  const isCancelled = appt.status === "CANCELLED";
                  const isCompleted = appt.status === "COMPLETED";

                  return (
                    <div
                      key={appt.id}
                      className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">
                            {appt.doctor_name || "Doctor"}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isCancelled
                                ? "bg-red-950 text-red-400 border border-red-800"
                                : isCompleted
                                ? "bg-slate-700 text-slate-300"
                                : "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            }`}
                          >
                            {appt.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          {appt.appointment_date} &bull; {appt.appointment_time}
                        </p>
                        <p className="text-xs text-slate-400">
                          Patient: <span className="text-slate-200">{appt.patient_name}</span> ({appt.patient_phone})
                        </p>
                        {appt.notes && (
                          <p className="text-[11px] text-slate-500 italic">Notes: {appt.notes}</p>
                        )}
                      </div>

                      {!isCancelled && !isCompleted && (
                        <button
                          onClick={() => handleCancelAppointment(appt.id)}
                          className="self-start sm:self-center px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-medium flex items-center gap-1.5 transition"
                        >
                          <FiXCircle size={14} />
                          <span>Cancel Appointment</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        {/* TAB 3: DOCTORS DIRECTORY */}
        {activeTab === "doctors" && (
          <div className="space-y-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FiUserCheck className="text-blue-400" /> Clinic Specialists &amp; Doctors
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {doctors.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 flex items-center justify-between shadow-md"
                >
                  <div className="min-w-0 pr-3">
                    <h3 className="font-bold text-sm text-white truncate">{doc.name}</h3>
                    <p className="text-xs text-blue-400 font-medium">
                      {doc.specialization || "General Medicine"}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Working Hours: {doc.working_hours_start || "09:00"} - {doc.working_hours_end || "17:00"}
                    </p>
                    {doc.fee ? (
                      <p className="text-xs text-emerald-400 font-medium mt-0.5">
                        Consultation: ₹{doc.fee}
                      </p>
                    ) : null}
                  </div>

                  <button
                    onClick={() => {
                      setSelectedDoctorId(doc.id);
                      setActiveTab("book");
                    }}
                    className="shrink-0 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                  >
                    Book Slot
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: AYUSHMAN BHARAT ABHA HEALTH ID */}
        {activeTab === "abha" && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-emerald-950/40 border border-emerald-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
              
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-lg">
                  🇮🇳
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    National Health Authority (NHA) • ABHA Health ID
                  </h2>
                  <p className="text-xs text-slate-400">
                    Create or verify your 14-digit Ayushman Bharat Health Account (ABDM M1)
                  </p>
                </div>
              </div>

              {abhaError && (
                <div className="my-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
                  <FiAlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{abhaError}</span>
                </div>
              )}

              {abhaStep === "input" && (
                <div className="mt-5 space-y-4">
                  <div className="p-4 bg-slate-900/80 border border-slate-700/60 rounded-xl text-xs text-slate-300 space-y-1">
                    <p className="font-semibold text-emerald-400">Fast &amp; 100% Free Government Health Account</p>
                    <p className="text-slate-400">
                      Enter your 12-digit Aadhaar number to generate or retrieve your digital health card. In Sandbox mode, test OTP: <strong className="text-emerald-300">111111</strong>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      12-Digit Aadhaar Number:
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={abhaAadhaar}
                      onChange={(e) => setAbhaAadhaar(e.target.value.replace(/\D/g, ""))}
                      placeholder="e.g. 5432 1098 7654"
                      className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 tracking-wider font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={abhaLoading || abhaAadhaar.length !== 12}
                    onClick={async () => {
                      setAbhaError("");
                      setAbhaLoading(true);
                      try {
                        const res = await generateAadhaarOtp(abhaAadhaar);
                        setAbhaTxnId(res.txn_id);
                        setAbhaStep("otp");
                      } catch (err) {
                        setAbhaError(err.message || "Failed to generate Aadhaar OTP");
                      } finally {
                        setAbhaLoading(false);
                      }
                    }}
                    className="w-full py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 text-white transition disabled:opacity-50 flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950/50"
                  >
                    {abhaLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <span>Send Verification OTP</span>
                    )}
                  </button>
                </div>
              )}

              {abhaStep === "otp" && (
                <div className="mt-5 space-y-4">
                  <div className="p-3 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-slate-300">
                    <p>Enter the 6-digit OTP sent to your Aadhaar-registered mobile.</p>
                    <p className="text-[11px] text-emerald-400 mt-0.5">Sandbox Mode: Enter <strong>111111</strong>.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      6-Digit OTP:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={abhaOtp}
                      onChange={(e) => setAbhaOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="111111"
                      className="w-full bg-slate-900 border border-emerald-500/50 rounded-xl px-4 py-3 text-center text-lg tracking-widest font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setAbhaStep("input")}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
                    >
                      Change Aadhaar
                    </button>
                    <button
                      type="button"
                      disabled={abhaLoading || abhaOtp.length < 4}
                      onClick={async () => {
                        setAbhaError("");
                        setAbhaLoading(true);
                        try {
                          const profile = await verifyAadhaarOtp({
                            txnId: abhaTxnId,
                            otp: abhaOtp,
                          });
                          setAbhaProfile(profile);
                          setAbhaStep("card");
                        } catch (err) {
                          setAbhaError(err.message || "OTP Verification Failed");
                        } finally {
                          setAbhaLoading(false);
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-semibold flex items-center justify-center space-x-1"
                    >
                      {abhaLoading ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <span>Verify &amp; Generate Card</span>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {abhaStep === "card" && abhaProfile && (
                <div className="mt-5 space-y-4">
                  {/* Digital Card Preview */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-[#0c2a20] via-[#0d1e2e] to-[#121c2b] border border-emerald-500/40 relative overflow-hidden shadow-2xl">
                    <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
                    <div className="flex justify-between items-center pb-3 border-b border-emerald-500/20">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-white">ABHA</span>
                        <span className="text-[11px] text-emerald-300">National Health Authority (NHA)</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        ABDM Verified
                      </span>
                    </div>

                    <div className="pt-4 space-y-2">
                      <div className="text-base font-bold text-white">{abhaProfile.name}</div>
                      <div className="text-xs text-emerald-400 font-mono">{abhaProfile.abha_address}</div>
                      <div className="pt-2 text-lg font-extrabold font-mono text-emerald-300 tracking-wider">
                        {abhaProfile.abha_number}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Gender: {abhaProfile.gender || "M"} • DOB: {abhaProfile.dob || "N/A"}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAbhaStep("input");
                      setAbhaAadhaar("");
                      setAbhaOtp("");
                      setAbhaProfile(null);
                    }}
                    className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition"
                  >
                    Check Another ABHA
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Server Configuration Modal (Handy for Android) */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
              <FiSettings className="text-blue-400" /> Clinic Server Connection
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              When running this Android app, enter your clinic server address (e.g.{" "}
              <code className="text-blue-300">http://192.168.1.5:8000</code> or your public domain).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  API Base URL
                </label>
                <input
                  type="url"
                  placeholder="e.g. http://192.168.1.10:8000"
                  value={serverUrlInput}
                  onChange={(e) => setServerUrlInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {serverStatusMsg && (
                <p className="text-xs text-emerald-400 font-medium">{serverStatusMsg}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowServerModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveServerUrl}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                >
                  Save &amp; Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
