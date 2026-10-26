import React, { useState, useEffect } from "react";
import { FiPrinter, FiX, FiCheckCircle, FiUser, FiCalendar, FiClock, FiMapPin, FiPhone } from "react-icons/fi";
import { fetchSettings } from "../../api";

export default function AppointmentSlipModal({ appointment, onClose }) {
  const [clinicSettings, setClinicSettings] = useState(null);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        if (data) setClinicSettings(data);
      })
      .catch((err) => console.warn("Failed to load clinic settings for slip:", err));
  }, []);

  if (!appointment) return null;

  const clinicName = clinicSettings?.clinic_name || "AEROSTATE SPECIALITY CLINIC";
  const clinicTagline = clinicSettings?.clinic_tagline || "Medical Center & OPD Consultation Services";
  const clinicRegNo = clinicSettings?.clinic_reg_no || "UP-AGR-2026-MED";
  const clinicAddress = clinicSettings?.clinic_address || "Plot 14, Fatehabad Road, Tajganj, Agra (U.P.)";
  const clinicPhone = clinicSettings?.clinic_phone || "+91 98765 43210";
  const clinicEmail = clinicSettings?.clinic_email || "";
  const clinicHours = clinicSettings?.clinic_hours || "";

  const refCode = appointment.refCode || `APT-${String(appointment.id || "").padStart(4, "0")}`;
  const tokenNum = appointment.token_number || appointment.queue_token;
  const tokenDisplay = tokenNum ? `#${String(tokenNum).padStart(2, "0")}` : null;
  const patientUid = appointment.patient_uid || (appointment.patient_id ? `PAT-${String(appointment.patient_id).padStart(4, "0")}` : "PAT-NEW");
  const fee = appointment.consultation_fee || 500;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-appointment-slip, #printable-appointment-slip * {
            visibility: visible;
          }
          #printable-appointment-slip {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 20px;
            box-shadow: none !important;
            border: 1px solid #000 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Top Actions Bar */}
        <div className="no-print px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm">OPD Appointment Slip</span>
            <span className="text-xs bg-[#254d90]/10 text-[#254d90] font-mono px-2 py-0.5 rounded font-bold">
              {refCode}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#126868] text-white hover:bg-[#0e5252] text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
            >
              <FiPrinter size={13} />
              <span>Print Slip</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              title="Close"
            >
              <FiX size={18} />
            </button>
          </div>
        </div>

        {/* Printable OPD Slip Body */}
        <div id="printable-appointment-slip" className="p-6 overflow-y-auto space-y-4 text-slate-800">
          {/* Clinic Header - Dynamically Fetched from Backend Settings */}
          <div className="text-center border-b-2 border-dashed border-slate-300 pb-3">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#126868]"></span>
              <h1 className="text-base font-extrabold tracking-tight text-slate-900 uppercase">
                {clinicName}
              </h1>
            </div>
            <p className="text-[11.5px] text-slate-600 font-medium">
              {clinicTagline} {clinicRegNo ? `• Reg. No: ${clinicRegNo}` : ""}
            </p>
            <p className="text-[11px] text-slate-500">
              {clinicAddress} • Phone: {clinicPhone}
            </p>
            {clinicEmail && (
              <p className="text-[10px] text-slate-400 font-mono">
                Email: {clinicEmail} {clinicHours ? `• Hours: ${clinicHours}` : ""}
              </p>
            )}
            <div className="mt-2 inline-block bg-slate-900 text-white text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded">
              OPD Patient Visit Slip
            </div>
          </div>

          {/* Token Banner if present */}
          {tokenDisplay && (
            <div className="bg-emerald-50 border-2 border-emerald-500/30 rounded-xl p-3 text-center">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Waiting Room OPD Token
              </div>
              <div className="text-3xl font-black font-mono text-emerald-700 tracking-tight my-0.5">
                {tokenDisplay}
              </div>
              <div className="text-[11px] text-emerald-800 font-medium">
                Cabin: <span className="font-bold">{appointment.queue_cabin || "Cabin 1"}</span> • Status: <span className="font-semibold">{appointment.queue_status || "WAITING"}</span>
              </div>
            </div>
          )}

          {/* Reference & Slot Row */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Appointment Ref</span>
              <span className="font-mono font-bold text-[#254d90] text-sm">{refCode}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Booking Date &amp; Time</span>
              <span className="font-semibold text-slate-800">
                {appointment.appointment_date || appointment.date} • {appointment.formatted_time || appointment.start_time}
              </span>
            </div>
          </div>

          {/* Patient Details */}
          <div className="border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
            <div className="font-bold text-[11px] uppercase tracking-wider text-[#126868] border-b border-slate-100 pb-1 flex justify-between items-center">
              <span>Patient Information</span>
              <span className="font-mono text-slate-600 font-semibold">{patientUid}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-slate-400 text-[10.5px] block">Full Name:</span>
                <span className="font-bold text-slate-900 text-sm">{appointment.patient_name}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Gender &amp; Age:</span>
                <span className="font-semibold text-slate-800">
                  {appointment.gender && appointment.gender !== "Unspecified" ? appointment.gender : "—"}
                  {appointment.age ? ` / ${appointment.age} Yrs` : ""}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Blood Group:</span>
                <span className="font-semibold text-rose-700">
                  {appointment.blood_group && appointment.blood_group !== "—" ? appointment.blood_group : "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Phone:</span>
                <span className="font-mono font-medium text-slate-800">
                  {appointment.patient_phone || "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Aadhaar (UIDAI):</span>
                <span className="font-mono font-medium text-slate-800">
                  {appointment.aadhaar_number || "—"}
                </span>
              </div>
              {appointment.address && (
                <div className="col-span-2">
                  <span className="text-slate-400 text-[10.5px] block">Address:</span>
                  <span className="font-medium text-slate-700">{appointment.address}</span>
                </div>
              )}
            </div>
          </div>

          {/* Doctor & Consultation Details */}
          <div className="border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
            <div className="font-bold text-[11px] uppercase tracking-wider text-[#126868] border-b border-slate-100 pb-1 flex justify-between items-center">
              <span>Doctor Consultation</span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-semibold border border-blue-200 text-[10.5px]">
                {appointment.visit_type || "New Consultation"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-slate-400 text-[10.5px] block">Attending Specialist:</span>
                <span className="font-bold text-slate-900">
                  {appointment.doctor_name || "General Practitioner"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Department &amp; Room:</span>
                <span className="font-semibold text-slate-800">
                  {appointment.doctor_specialty || "General OPD"} • <span className="font-bold text-[#126868]">{appointment.cabin || appointment.queue_cabin || "Cabin 1"}</span>
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Fee &amp; Payment Mode:</span>
                <span className="font-bold text-emerald-700 text-sm">
                  ₹{Number(fee).toLocaleString()} <span className="text-xs text-slate-600 font-semibold">({appointment.payment_status || "PAID"} • {appointment.payment_method || "UPI"})</span>
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10.5px] block">Appointment Status:</span>
                <span className="inline-block px-1.5 py-0.2 rounded font-semibold text-[10.5px] bg-slate-100 text-slate-800 border border-slate-200">
                  {appointment.status || "CONFIRMED"}
                </span>
              </div>
              {appointment.notes && (
                <div className="col-span-2 bg-amber-50/70 border border-amber-200/60 rounded p-2 text-[11px] text-amber-900">
                  <span className="font-bold block text-amber-800">Visit Reason / Clinical Notes:</span>
                  {appointment.notes}
                </div>
              )}
            </div>
          </div>

          {/* Footer Notice */}
          <div className="text-center pt-2 border-t border-dashed border-slate-300 space-y-1">
            <p className="text-[10px] text-slate-500 font-medium">
              Please be seated in the patient waiting area. Your token will be announced on screen.
            </p>
            <p className="text-[9.5px] text-slate-400 font-mono">
              Printed on {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} at {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} • {clinicName} HMS
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
