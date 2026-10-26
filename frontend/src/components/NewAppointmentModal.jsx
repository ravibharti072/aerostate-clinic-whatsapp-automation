import React, { useState, useEffect } from "react";
import { FiX, FiCalendar, FiClock, FiUser, FiPhone, FiCheck } from "react-icons/fi";
import { fetchDoctors, fetchDoctorSlots, createManualAppointment } from "../api";

export default function NewAppointmentModal({ isOpen, onClose, onCreated }) {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const getLocalDateIso = (date = new Date()) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayIso = getLocalDateIso();

  useEffect(() => {
    if (isOpen) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setAppointmentDate(getLocalDateIso(tomorrow));
      setError(null);
      setSelectedSlot("");
      setNotes("");

      setLoadingDoctors(true);
      fetchDoctors(false)
        .then((docs) => {
          setDoctors(docs);
          if (docs.length > 0) {
            setSelectedDoctorId(docs[0].id);
          }
        })
        .finally(() => setLoadingDoctors(false));
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedDoctorId && appointmentDate) {
      if (appointmentDate < todayIso) {
        setAvailableSlots([]);
        return;
      }
      setLoadingSlots(true);
      setSelectedSlot("");
      const nowTimeStr = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
      fetchDoctorSlots(selectedDoctorId, appointmentDate)
        .then((res) => {
          let slots = res.available_slots || [];
          if (appointmentDate === todayIso) {
            slots = slots.filter((s) => s > nowTimeStr);
          }
          setAvailableSlots(slots);
        })
        .catch((err) => {
          console.error("Error fetching slots:", err);
          setAvailableSlots([]);
        })
        .finally(() => setLoadingSlots(false));
    }
  }, [selectedDoctorId, appointmentDate]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSlot) {
      setError("Please select an available time slot");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await createManualAppointment({
        patient_name: patientName,
        patient_phone: patientPhone,
        doctor_id: Number(selectedDoctorId),
        appointment_date: appointmentDate,
        start_time: selectedSlot,
        notes,
      });

      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to book appointment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-content"
        style={{ maxWidth: "580px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Book Patient Appointment</h2>
            <div className="modal-kicker">
              Manual reception booking with instant slot confirmation
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
          >
            <FiX size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="modal-body">
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
                {error}
              </div>
            )}

            {/* Patient Details */}
            <div className="form-row">
              <div className="form-group">
                <label>Patient Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>WhatsApp Phone *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +15551234567"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>

            {/* Doctor Selection & Date */}
            <div className="form-row">
              <div className="form-group">
                <label>Select Specialist *</label>
                <select
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Appointment Date *</label>
                <input
                  type="date"
                  required
                  min={todayIso}
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                />
              </div>
            </div>

            {/* Slot Selection */}
            <div className="form-group">
              <div className="flex items-center justify-between mb-1">
                <label>
                  Available Time Slots ({appointmentDate}) *
                </label>
                {loadingSlots && <span className="text-[11px] text-slate-400">Loading slots...</span>}
              </div>

              {loadingSlots ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  Calculating available slots...
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="p-3 text-center rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                  No slots available on this date. Doctor may not be working or all slots are taken.
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-36 overflow-y-auto p-1.5 bg-slate-50/50 rounded-lg border border-slate-200">
                  {availableSlots.map((slot) => {
                    const isSelected = selectedSlot === slot;
                    return (
                      <button
                        type="button"
                        key={slot}
                        onClick={() => setSelectedSlot(slot)}
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                          isSelected
                            ? "bg-[#254d90] text-white border-[#254d90] shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Optional Notes */}
            <div className="form-group">
              <label>
                Visit Reason / Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Routine cleaning, Consultation"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="btn-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedSlot}
              className="btn-submit"
            >
              <FiCheck size={14} />
              <span>{submitting ? "Confirming..." : "Confirm Booking"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
