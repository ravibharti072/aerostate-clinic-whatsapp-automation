import React, { useState, useEffect, useMemo } from "react";
import {
  FiCalendar,
  FiUser,
  FiClock,
  FiCheckCircle,
  FiSearch,
  FiX,
  FiPrinter
} from "react-icons/fi";
import { fetchDoctors, fetchDoctorSlots, createManualAppointment, fetchPatients, fetchCabins } from "../../api";
import AppointmentSlipModal from "../common/AppointmentSlipModal";
import "./entryForm.css";

export default function AppointmentEntryForm({ onCreated }) {
  const [doctors, setDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [registeredPatients, setRegisteredPatients] = useState([]);

  // Patient Details Fields
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientAadhaar, setPatientAadhaar] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientGender, setPatientGender] = useState("Unspecified");
  const [patientAge, setPatientAge] = useState("");
  const [patientBloodGroup, setPatientBloodGroup] = useState("");

  // Consultation, Cabin & Payment Fields
  const [visitType, setVisitType] = useState("New Consultation");
  const [cabin, setCabin] = useState("Cabin 1");
  const [cabins, setCabins] = useState([
    { name: "Cabin 1" },
    { name: "Cabin 2" },
    { name: "Cabin 3" },
    { name: "Cabin 4 (Cardiac OPD)" },
    { name: "Procedure Room" }
  ]);
  const [paymentMethod, setPaymentMethod] = useState("UPI");

  const [checkInNow, setCheckInNow] = useState(false);
  const [lastCreatedAppt, setLastCreatedAppt] = useState(null);
  const [printSlipAppt, setPrintSlipAppt] = useState(null);

  // Accurate Local Client Date (avoiding UTC offset roll-backs)
  const getLocalDateIso = (date = new Date()) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayIso = getLocalDateIso();
  const [appointmentDate, setAppointmentDate] = useState(todayIso);
  const [note, setNote] = useState("");

  // Doctor Consultation Fields
  const [doctorId, setDoctorId] = useState("");
  const [slot, setSlot] = useState("");
  const [slotsList, setSlotsList] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Helper to get current HH:MM string in 24h format
  const getCurrentTimeStr = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // Load doctors from backend (synced with Staff Directory)
  useEffect(() => {
    setLoadingDoctors(true);
    fetchDoctors({ include_inactive: false, date: appointmentDate })
      .then((docs) => {
        setDoctors(docs || []);
        if (docs && docs.length > 0 && !doctorId) {
          setDoctorId(String(docs[0].id));
        }
      })
      .catch((err) => console.error("Error loading doctors:", err))
      .finally(() => setLoadingDoctors(false));

    fetchPatients()
      .then((data) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.patients)
          ? data.patients
          : [];
        setRegisteredPatients(list);
      })
      .catch((err) => console.warn("Could not load registered patients:", err));

    fetchCabins()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCabins(data);
          setCabin(data[0].name);
        }
      })
      .catch(() => {});
  }, [appointmentDate]);

  // Selected Doctor Object
  const selectedDoctor = useMemo(() => {
    if (!doctorId) return doctors[0] || null;
    return doctors.find((d) => String(d.id) === String(doctorId)) || doctors[0] || null;
  }, [doctorId, doctors]);

  const [customFee, setCustomFee] = useState(null);

  const selectedDoctorName = selectedDoctor ? selectedDoctor.name : "Assigned Doctor";
  const doctorBaseFee = selectedDoctor?.consultation_fee ?? 500;
  // If receptionist explicitly edited fee, use customFee; otherwise auto-apply policy
  const effectiveFee = customFee !== null
    ? customFee
    : (visitType === "Follow-up Visit" ? 0 : doctorBaseFee);
  const departmentName = selectedDoctor?.specialization || selectedDoctor?.department || "General Medicine";

  const handleDoctorChange = (newDocId) => {
    setDoctorId(newDocId);
    setCustomFee(null);
  };

  const handleVisitTypeChange = (newVisitType) => {
    setVisitType(newVisitType);
    if (newVisitType === "Follow-up Visit") {
      setCustomFee(0);
    } else if (customFee === 0) {
      setCustomFee(null);
    }
  };

  // Fetch available slots whenever doctor or date changes
  useEffect(() => {
    const activeDocId = doctorId || (doctors[0] ? String(doctors[0].id) : "");
    if (!activeDocId || !appointmentDate || appointmentDate < todayIso) {
      setSlotsList([]);
      setSlot("");
      return;
    }

    setLoadingSlots(true);
    const nowTimeStr = getCurrentTimeStr();

    fetchDoctorSlots(activeDocId, appointmentDate)
      .then((res) => {
        let slots = res.available_slots || [];
        if (appointmentDate === todayIso) {
          slots = slots.filter((s) => s > nowTimeStr);
        }
        setSlotsList(slots);
        setSlot(slots.length > 0 ? slots[0] : "");
      })
      .catch(() => {
        setSlotsList([]);
        setSlot("");
      })
      .finally(() => {
        setLoadingSlots(false);
      });
  }, [doctorId, appointmentDate, doctors]);

  const rawDigits = (patientPhone || "").replace(/\D/g, "");
  const cleanPhone = rawDigits.startsWith("91") && rawDigits.length > 10 ? rawDigits.slice(2) : rawDigits;
  const cleanName = (patientName || "").trim().toLowerCase();

  // Search database as user types name (case-insensitive)
  const nameSuggestions = useMemo(() => {
    if (!Array.isArray(registeredPatients) || !cleanName || cleanName.length < 2) return [];
    return registeredPatients
      .filter((p) => (p.name || "").trim().toLowerCase().includes(cleanName))
      .slice(0, 6);
  }, [cleanName, registeredPatients]);

  // Exact Match: Identifies patient case-insensitively and by 10-digit normalized phone
  const samePatientMatch = useMemo(() => {
    if (!Array.isArray(registeredPatients)) return null;
    return (
      registeredPatients.find((p) => {
        const pDigits = (p.phone || "").replace(/\D/g, "");
        const pNorm = pDigits.startsWith("91") && pDigits.length > 10 ? pDigits.slice(2) : pDigits;
        const pName = (p.name || "").trim().toLowerCase();
        
        // If 10-digit phone matches, it is the same patient
        if (cleanPhone && cleanPhone.length === 10 && pNorm === cleanPhone) {
          return true;
        }
        // If exact name matches case-insensitively (e.g. 'Ravi Bharti' vs 'Ravi bharti')
        if (cleanName && cleanName.length >= 2 && pName === cleanName) {
          return true;
        }
        return false;
      }) || null
    );
  }, [cleanName, cleanPhone, registeredPatients]);

  // Name exists in database, but phone number is different
  const nameExistsDiffPhone = useMemo(() => {
    if (!Array.isArray(registeredPatients) || !cleanName || cleanName.length < 2) return null;
    const nMatch = registeredPatients.find((p) => (p.name || "").trim().toLowerCase() === cleanName);
    if (!nMatch) return null;
    if (!cleanPhone || cleanPhone.length < 10) return null;
    const pDigits = (nMatch.phone || "").replace(/\D/g, "");
    const pNorm = pDigits.startsWith("91") && pDigits.length > 10 ? pDigits.slice(2) : pDigits;
    if (pNorm !== cleanPhone) return nMatch;
    return null;
  }, [cleanName, cleanPhone, registeredPatients]);

  // Phone is registered to a different name
  const phoneExistsDiffName = useMemo(() => {
    if (!Array.isArray(registeredPatients) || !cleanPhone || cleanPhone.length < 10) return null;
    const pMatch = registeredPatients.find((p) => {
      const pDigits = (p.phone || "").replace(/\D/g, "");
      const pNorm = pDigits.startsWith("91") && pDigits.length > 10 ? pDigits.slice(2) : pDigits;
      return pNorm === cleanPhone;
    });
    if (!pMatch) return null;
    if (cleanName && (pMatch.name || "").trim().toLowerCase() !== cleanName) return pMatch;
    return null;
  }, [cleanName, cleanPhone, registeredPatients]);

  const handleClear = () => {
    setPatientName("");
    setPatientPhone("");
    setPatientAadhaar("");
    setPatientAddress("");
    setPatientGender("Unspecified");
    setPatientAge("");
    setPatientBloodGroup("");
    setVisitType("New Consultation");
    setPaymentMethod("UPI");
    setCustomFee(null);
    if (cabins.length > 0) setCabin(cabins[0].name);
    setNote("");
    setShowSuggestions(false);
    setAppointmentDate(getLocalDateIso());
    if (doctors.length > 0) {
      setDoctorId(String(doctors[0].id));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patientName.trim()) {
      setStatusMessage({ type: "error", text: "Please enter patient full name." });
      return;
    }
    if (!patientPhone.trim()) {
      setStatusMessage({ type: "error", text: "Please enter patient phone number." });
      return;
    }

    const activeDocId = doctorId || (doctors[0]?.id ? String(doctors[0].id) : "");
    if (!activeDocId) {
      setStatusMessage({ type: "error", text: "Please select an attending doctor." });
      return;
    }

    if (appointmentDate < todayIso) {
      setStatusMessage({
        type: "error",
        text: "Cannot book an appointment for a past date. Please select today or a future date.",
      });
      return;
    }

    const nowTimeStr = getCurrentTimeStr();
    if (appointmentDate === todayIso && slot && slot <= nowTimeStr) {
      setStatusMessage({
        type: "error",
        text: `Time slot ${slot} has already passed for today. Please choose an upcoming time slot.`,
      });
      return;
    }

    if (!slot) {
      setStatusMessage({
        type: "error",
        text: "Please select an available upcoming time slot for this doctor.",
      });
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);

    try {
      const digitsOnly = (patientPhone || "").replace(/\D/g, "");
      const clean10 = digitsOnly.startsWith("91") && digitsOnly.length > 10 ? digitsOnly.slice(2) : digitsOnly;
      const finalPhone = clean10.length === 10 ? `+91${clean10}` : (patientPhone.startsWith("+") ? patientPhone : `+91${clean10}`);
      const shouldCheckIn = appointmentDate === todayIso && Boolean(checkInNow);
      const paymentStatus = paymentMethod === "Pending" ? "PENDING" : "PAID";
      const cleanPaymentMethod = paymentMethod === "Pending" ? "Cash" : paymentMethod;

      const res = await createManualAppointment({
        patient_name: patientName.trim(),
        patient_phone: finalPhone,
        aadhaar_number: patientAadhaar.trim() || undefined,
        address: patientAddress.trim() || undefined,
        gender: patientGender !== "Unspecified" ? patientGender : undefined,
        age: patientAge ? Number(patientAge) : undefined,
        blood_group: patientBloodGroup || undefined,
        doctor_id: Number(activeDocId),
        appointment_date: appointmentDate,
        start_time: slot,
        notes: note.trim() || undefined,
        visit_type: visitType,
        payment_status: paymentStatus,
        payment_method: cleanPaymentMethod,
        paid_amount: effectiveFee,
        cabin: cabin,
        check_in_now: shouldCheckIn,
      });

      const tokenNum = res?.token_number;
      const apptId = res?.appointment_id;

      const createdObj = {
        id: apptId,
        refCode: apptId ? `APT-${String(apptId).padStart(4, "0")}` : "APT-NEW",
        patient_name: patientName.trim(),
        patient_phone: finalPhone,
        gender: patientGender,
        age: patientAge,
        blood_group: patientBloodGroup,
        aadhaar_number: patientAadhaar.trim(),
        address: patientAddress.trim(),
        doctor_name: selectedDoctorName,
        doctor_specialty: departmentName,
        consultation_fee: effectiveFee,
        visit_type: visitType,
        payment_status: paymentStatus,
        payment_method: cleanPaymentMethod,
        cabin: cabin,
        queue_cabin: cabin,
        appointment_date: appointmentDate,
        start_time: slot,
        formatted_time: slot,
        notes: note.trim(),
        queue_token: tokenNum,
        queue_status: tokenNum ? "WAITING" : null,
        status: "CONFIRMED",
      };

      setLastCreatedAppt(createdObj);

      const successMsg = tokenNum
        ? `✓ Appointment registered & checked into queue! OPD Token #${String(tokenNum).padStart(2, "0")} assigned for ${patientName.trim()} with ${selectedDoctorName} at ${slot} (${cabin}).`
        : `✓ Appointment registered successfully for ${patientName.trim()} with ${selectedDoctorName} on ${appointmentDate} at ${slot}!`;

      setStatusMessage({
        type: "success",
        text: successMsg,
      });

      handleClear();
      if (onCreated) onCreated();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to submit appointment entry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="asr-unified-card">
      <div className="asr-unified-header">
        <div>
          <h2 className="asr-unified-title">Create Appointment Entry</h2>
          <p className="asr-unified-subtitle">
            Record patient visit details, consulting doctor, and time slot.
          </p>
        </div>
        <span className="asr-row-counter-badge" style={{ background: "#f0fdf4", color: "#166534", borderColor: "#bbf7d0" }}>
          Consultation Booking
        </span>
      </div>

      {statusMessage && (
        <div
          className={`p-3 rounded-lg text-sm font-semibold mt-3 flex items-center justify-between flex-wrap gap-2 ${
            statusMessage.type === "error"
              ? "bg-rose-50 text-rose-800 border border-rose-200"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "error" ? (
              <FiX className="text-rose-600 shrink-0" size={16} />
            ) : (
              <FiCheckCircle className="text-emerald-600 shrink-0" size={16} />
            )}
            <span>{statusMessage.text}</span>
          </div>
          {statusMessage.type === "success" && lastCreatedAppt && (
            <button
              type="button"
              onClick={() => setPrintSlipAppt(lastCreatedAppt)}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-700 text-white rounded-md text-xs font-bold hover:bg-emerald-800 transition cursor-pointer shadow-xs"
            >
              <FiPrinter size={13} />
              <span>Print OPD Slip</span>
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="asr-unified-form">
        {/* Patient Details, Address & Date Selection */}
        <div className="flex flex-col gap-2.5 w-full">
          <label className="asr-field-label">Patient Details &amp; Contact *</label>

          {/* Upper 3 Equally Sized Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
            <div className="relative w-full">
              <input
                type="text"
                className="asr-input w-full"
                placeholder="Patient Full Name *"
                value={patientName}
                onChange={(e) => {
                  setPatientName(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                required
              />
              {/* Live Database Search Suggestions */}
              {showSuggestions && nameSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-[48px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                  <div className="px-3 py-1 text-[11px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                    <span>Database Matches ({nameSuggestions.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowSuggestions(false)}
                      className="text-slate-400 hover:text-slate-600 font-bold"
                    >
                      ✕
                    </button>
                  </div>
                  {nameSuggestions.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => {
                        setPatientName(p.name);
                        const pDigits = (p.phone || "").replace(/\D/g, "");
                        const p10 = pDigits.startsWith("91") && pDigits.length > 10 ? pDigits.slice(2) : pDigits;
                        setPatientPhone(p10);
                        if (p.aadhaar_number) setPatientAadhaar(p.aadhaar_number);
                        if (p.address) setPatientAddress(p.address);
                        if (p.gender) setPatientGender(p.gender);
                        if (p.age !== undefined && p.age !== null) setPatientAge(String(p.age));
                        if (p.blood_group) setPatientBloodGroup(p.blood_group);
                        setShowSuggestions(false);
                      }}
                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between border-b border-slate-50 last:border-b-0 text-xs transition"
                    >
                      <div>
                        <span className="font-bold text-slate-900">{p.name}</span>
                        <span className="text-slate-500 font-mono text-[11px] ml-2">
                          {(p.phone || "").replace(/^\+?91/, "")}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-semibold text-[#254d90] bg-[#254d90]/10 px-1.5 py-0.5 rounded">
                        {p.patient_uid || `PAT-${p.id}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center w-full bg-white border border-[#cbd5e1] rounded-lg overflow-hidden focus-within:border-[#254d90] focus-within:ring-2 focus-within:ring-[#254d90]/20 transition" style={{ height: "44px" }}>
              <span className="px-3.5 bg-slate-50 border-r border-[#cbd5e1] text-sm font-bold text-slate-600 font-mono select-none shrink-0 h-full flex items-center justify-center">
                +91
              </span>
              <input
                type="tel"
                className="w-full px-3 text-sm font-mono outline-none border-none bg-transparent text-slate-800 placeholder-slate-400 h-full"
                placeholder="10-digit Mobile Number *"
                value={patientPhone}
                onChange={(e) => {
                  let val = e.target.value.replace(/\D/g, "");
                  if (val.startsWith("91") && val.length > 10) {
                    val = val.slice(2);
                  }
                  if (val.length <= 10) {
                    setPatientPhone(val);
                  }
                }}
                maxLength={10}
                required
              />
            </div>
            <input
              type="text"
              className="asr-input w-full"
              placeholder="Aadhaar No. (Optional)"
              value={patientAadhaar}
              onChange={(e) => setPatientAadhaar(e.target.value)}
              maxLength={14}
            />
          </div>

          {/* Lower Row: Address, Gender, Age, Blood Group & Entry Date */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
            <div className="flex-1 w-full min-w-[180px]">
              <input
                type="text"
                className="asr-input w-full"
                placeholder="Address (Optional)"
                value={patientAddress}
                onChange={(e) => setPatientAddress(e.target.value)}
              />
            </div>

            <div className="w-full sm:w-[125px] shrink-0">
              <select
                className="asr-input w-full cursor-pointer text-sm font-medium"
                value={patientGender}
                onChange={(e) => setPatientGender(e.target.value)}
                title="Patient Gender"
              >
                <option value="Unspecified">Gender: Any</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="w-full sm:w-[95px] shrink-0">
              <input
                type="number"
                className="asr-input w-full text-sm font-medium"
                placeholder="Age (Yrs)"
                value={patientAge}
                onChange={(e) => setPatientAge(e.target.value)}
                min={0}
                max={130}
                title="Patient Age in Years"
              />
            </div>

            <div className="w-full sm:w-[115px] shrink-0">
              <select
                className="asr-input w-full cursor-pointer text-sm font-medium"
                value={patientBloodGroup}
                onChange={(e) => setPatientBloodGroup(e.target.value)}
                title="Patient Blood Group (Optional)"
              >
                <option value="">Blood: Any</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>

            <div className="w-full sm:w-[180px] shrink-0">
              <div className="asr-date-box" title="Appointment Entry Date">
                <div className="asr-date-inner">
                  <FiCalendar className="text-slate-500 shrink-0" size={16} />
                  <input
                    type="date"
                    className="asr-date-input"
                    value={appointmentDate}
                    min={todayIso}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val && val < todayIso) {
                        setStatusMessage({
                          type: "error",
                          text: "Cannot select a past date. Please choose today or a future date.",
                        });
                        return;
                      }
                      setStatusMessage(null);
                      setAppointmentDate(val);
                    }}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Patient Identification Status: Same Patient vs Different Patient */}
          {samePatientMatch ? (
            <div className="mt-1 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-900">
              <div className="flex items-center gap-1.5">
                <FiCheckCircle className="text-emerald-700 shrink-0" size={14} />
                <span>
                  ✓ Verified Same Patient: <strong>{samePatientMatch.name}</strong> ({samePatientMatch.patient_uid || `PAT-${samePatientMatch.id}`} • +91 {((samePatientMatch.phone || "").replace(/\D/g, "").slice(-10))})
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPatientName(samePatientMatch.name);
                  const pDigits = (samePatientMatch.phone || "").replace(/\D/g, "");
                  setPatientPhone(pDigits.startsWith("91") && pDigits.length > 10 ? pDigits.slice(2) : pDigits);
                  if (samePatientMatch.aadhaar_number) setPatientAadhaar(samePatientMatch.aadhaar_number);
                  if (samePatientMatch.address) setPatientAddress(samePatientMatch.address);
                  if (samePatientMatch.gender) setPatientGender(samePatientMatch.gender);
                  if (samePatientMatch.age !== undefined && samePatientMatch.age !== null) setPatientAge(String(samePatientMatch.age));
                  if (samePatientMatch.blood_group) setPatientBloodGroup(samePatientMatch.blood_group);
                }}
                className="px-2.5 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold text-[11px] transition cursor-pointer"
              >
                Autofill Details
              </button>
            </div>
          ) : cleanPhone.length >= 7 && nameExistsDiffPhone ? (
            <div className="mt-1 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-1.5 text-xs text-amber-900">
              <span className="font-bold text-amber-700">ⓘ Different Patient:</span>
              <span>
                Name matches database record &apos;{nameExistsDiffPhone.name}&apos;, but phone number is different. Registering as a new unique patient.
              </span>
            </div>
          ) : cleanPhone.length >= 7 && phoneExistsDiffName ? (
            <div className="mt-1 p-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-1.5 text-xs text-blue-900">
              <span className="font-bold text-[#254d90]">ⓘ Note:</span>
              <span>
                Phone number is already registered to &apos;{phoneExistsDiffName.name}&apos;. If this is a different individual or family member, they will be registered with their own medical record.
              </span>
            </div>
          ) : (
            <div className="text-[11.5px] text-slate-500 flex items-center gap-1.5">
              <span className="font-semibold text-emerald-700">✓ Patient Registration:</span>
              <span>Direct registration source with optional Aadhaar &amp; Address.</span>
            </div>
          )}
        </div>

        {/* Doctor & Consultation Details Table */}
        <div className="asr-table-block">
          <div className="asr-table-bar">
            <div className="asr-table-bar-left">
              <span className="asr-table-title">Doctor &amp; Consultation Details</span>
              <span className="asr-items-count-tag" style={{ background: "#e0f2fe", color: "#0369a1", borderColor: "#bae6fd" }}>
                1 Doctor Consultation
              </span>
            </div>
          </div>

          <div className="asr-table-scroll-container">
            <table className="asr-items-table">
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>DOCTOR</th>
                  <th style={{ width: "15%", textAlign: "center" }}>TIME SLOT</th>
                  <th style={{ width: "19%" }}>VISIT TYPE</th>
                  <th style={{ width: "16%" }}>CABIN / ROOM</th>
                  <th style={{ width: "14%" }}>PAYMENT</th>
                  <th style={{ width: "12%", textAlign: "right" }}>CONSULTATION FEE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <select
                      className="asr-table-select"
                      value={doctorId}
                      onChange={(e) => handleDoctorChange(e.target.value)}
                      required
                    >
                      <option value="">Select Doctor...</option>
                      {doctors.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.name} (₹{doc.consultation_fee ?? 500})
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={{ textAlign: "center" }}>
                    <select
                      className="asr-table-select"
                      value={slot}
                      onChange={(e) => setSlot(e.target.value)}
                      required
                      disabled={loadingSlots}
                    >
                      {loadingSlots ? (
                        <option value="" disabled>Loading slots...</option>
                      ) : slotsList && slotsList.length > 0 ? (
                        slotsList.map((s, idx) => (
                          <option key={idx} value={s}>
                            {s}
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>
                          {appointmentDate < todayIso
                            ? "Past date not allowed"
                            : appointmentDate === todayIso
                            ? "No upcoming slots today"
                            : "No slots available"}
                        </option>
                      )}
                    </select>
                  </td>

                  <td>
                    <select
                      className="asr-table-select"
                      value={visitType}
                      onChange={(e) => handleVisitTypeChange(e.target.value)}
                      title="Consultation Visit Type"
                    >
                      <option value="New Consultation">New Consultation</option>
                      <option value="Follow-up Visit">Follow-up Visit (Free)</option>
                      <option value="Routine Checkup">Routine Checkup</option>
                      <option value="Emergency / Urgent">Emergency / Urgent</option>
                    </select>
                  </td>

                  <td>
                    <select
                      className="asr-table-select"
                      value={cabin}
                      onChange={(e) => setCabin(e.target.value)}
                      title="Assigned Examination Room / Cabin"
                    >
                      {cabins.map((c) => (
                        <option key={c.id || c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td>
                    <select
                      className="asr-table-select"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      title="Consultation Fee Payment"
                    >
                      <option value="UPI">Paid (UPI)</option>
                      <option value="Cash">Paid (Cash)</option>
                      <option value="Card">Paid (Card)</option>
                      <option value="Pending">Pay Later (Pending)</option>
                    </select>
                  </td>

                  <td style={{ textAlign: "right" }}>
                    <div className="inline-flex items-center justify-end relative" style={{ width: "105px" }}>
                      <span className="absolute left-2.5 text-slate-400 font-bold text-xs pointer-events-none">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="50"
                        value={effectiveFee}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomFee(val === "" ? 0 : Number(val));
                        }}
                        className="asr-compact-input text-right font-bold text-slate-900"
                        style={{
                          height: "32px",
                          paddingLeft: "20px",
                          paddingRight: "8px",
                          width: "100%",
                          fontSize: "13px",
                          background: effectiveFee === 0 ? "#f0fdf4" : "#ffffff",
                          color: effectiveFee === 0 ? "#166534" : "#0f172a",
                          borderColor: effectiveFee === 0 ? "#bbf7d0" : "#cbd5e1",
                        }}
                        title="Doctor standard rate (editable for concession / custom fee)"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Note (optional) */}
        <div className="asr-note-wrapper">
          <label className="asr-field-label">Note (optional)</label>
          <input
            type="text"
            className="asr-compact-input"
            placeholder="Add visit reason, symptoms, or special instructions..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Immediate Queue Check-in Option (for today's appointments) */}
        {appointmentDate === todayIso && (
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg">
            <input
              type="checkbox"
              id="checkInNowToggle"
              checked={checkInNow}
              onChange={(e) => setCheckInNow(e.target.checked)}
              className="w-4 h-4 text-[#126868] rounded border-slate-300 focus:ring-[#126868] cursor-pointer"
            />
            <label htmlFor="checkInNowToggle" className="text-xs font-semibold text-emerald-950 cursor-pointer select-none">
              Check-in patient to Waiting Room Queue immediately (Issues live OPD Token)
            </label>
          </div>
        )}

        {/* Executive Summary & Submit Panel */}
        <div className="asr-submit-panel">
          <div className="asr-submit-summary-strip">
            <div className="asr-summary-col">
              <span className="asr-summary-col-label">VISIT TYPE</span>
              <span className="asr-summary-col-val font-semibold text-[#254d90]">
                {visitType}
              </span>
            </div>

            <div className="asr-summary-divider" />

            <div className="asr-summary-col">
              <span className="asr-summary-col-label">CABIN / ROOM</span>
              <span className="asr-summary-col-val font-semibold text-slate-800">
                {cabin}
              </span>
            </div>

            <div className="asr-summary-divider" />

            <div className="asr-summary-col">
              <span className="asr-summary-col-label">PATIENT</span>
              <span className="asr-summary-col-val">
                {patientName
                  ? `${patientName} (${patientPhone ? patientPhone.replace(/^\+?91/, "") : "No Phone"})`
                  : "None selected"}
              </span>
            </div>

            <div className="asr-summary-divider" />

            <div className="asr-summary-col">
              <span className="asr-summary-col-label">DOCTOR &amp; SLOT</span>
              <span className="asr-summary-col-val">
                {selectedDoctorName} {slot ? `• ${slot}` : ""}
              </span>
            </div>

            <div className="asr-summary-divider" />

            <div className="asr-summary-col">
              <span className="asr-summary-col-label">CONSULTATION FEE</span>
              <span className="asr-summary-grand-total">
                ₹{Number(effectiveFee).toLocaleString()} <span className="text-xs font-normal text-slate-500">({paymentMethod === "Pending" ? "Pay Later" : `Paid ${paymentMethod}`})</span>
              </span>
            </div>
          </div>

          <div className="asr-submit-button-group">
            <button
              type="button"
              onClick={handleClear}
              className="asr-submit-clear-action"
            >
              Clear
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="asr-submit-primary-action"
            >
              <FiCheckCircle size={16} />
              <span>{submitting ? "Registering..." : "Submit Appointment Entry"}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Printable OPD Slip Modal */}
      {printSlipAppt && (
        <AppointmentSlipModal
          appointment={printSlipAppt}
          onClose={() => setPrintSlipAppt(null)}
        />
      )}
    </section>
  );
}
