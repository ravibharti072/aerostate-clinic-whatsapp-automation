import React, { useState, useEffect } from "react";
import { FiCalendar, FiClock, FiUser, FiX, FiCheck, FiAlertCircle } from "react-icons/fi";
import { fetchDoctorSlots, rescheduleAppointment, fetchDoctors } from "../../api";

export default function RescheduleModal({ appointment, doctors: propDoctors = [], onClose, onSuccess }) {
  const [doctors, setDoctors] = useState(propDoctors);
  const [selectedDoctorId, setSelectedDoctorId] = useState(
    appointment?.doctor_id ? String(appointment.doctor_id) : ""
  );

  const getLocalDateIso = (date = new Date()) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayIso = getLocalDateIso();
  const [appointmentDate, setAppointmentDate] = useState(
    appointment?.appointment_date || appointment?.date || todayIso
  );
  const [slot, setSlot] = useState("");
  const [slotsList, setSlotsList] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Helper for current time comparison on today
  const getCurrentTimeStr = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // Load doctors if not provided
  useEffect(() => {
    if (!doctors || doctors.length === 0) {
      fetchDoctors(true)
        .then((docs) => {
          setDoctors(docs || []);
          if (!selectedDoctorId && docs && docs.length > 0) {
            setSelectedDoctorId(String(docs[0].id));
          }
        })
        .catch(() => {});
    }
  }, []);

  // Fetch slots whenever doctor or date changes
  useEffect(() => {
    if (!selectedDoctorId || !appointmentDate || appointmentDate < todayIso) {
      setSlotsList([]);
      setSlot("");
      return;
    }

    setLoadingSlots(true);
    setError(null);
    const nowTime = getCurrentTimeStr();

    fetchDoctorSlots(selectedDoctorId, appointmentDate)
      .then((res) => {
        let slots = res.available_slots || [];
        if (appointmentDate === todayIso) {
          slots = slots.filter((s) => s > nowTime);
        }
        setSlotsList(slots);
        // Default to first slot if available
        if (slots.length > 0) {
          setSlot(slots[0]);
        } else {
          setSlot("");
        }
      })
      .catch((err) => {
        setSlotsList([]);
        setSlot("");
        setError("Could not load available time slots for this doctor.");
      })
      .finally(() => {
        setLoadingSlots(false);
      });
  }, [selectedDoctorId, appointmentDate]);

  if (!appointment) return null;

  const currentDoctorName = appointment.doctor_name || appointment.doctor?.name || "Attending Doctor";
  const currentDate = appointment.appointment_date || appointment.date || "—";
  const currentTime = appointment.formatted_time || appointment.start_time || "—";
  const refCode = `APT-${String(appointment.id).padStart(4, "0")}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!slot) {
      setError("Please select an available upcoming time slot.");
      return;
    }
    if (appointmentDate < todayIso) {
      setError("Cannot reschedule to a past date.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await rescheduleAppointment(appointment.id, {
        appointment_date: appointmentDate,
        start_time: slot,
        doctor_id: Number(selectedDoctorId),
        notes: rescheduleReason.trim() || undefined,
      });

      if (onSuccess) {
        onSuccess(res);
      }
      onClose();
    } catch (err) {
      setError(err.message || "Failed to reschedule appointment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#254d90]/10 text-[#254d90] flex items-center justify-center">
              <FiCalendar size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Reschedule Appointment
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Ref <span className="font-mono font-bold text-[#254d90]">{refCode}</span> • {appointment.patient_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
          >
            <FiX size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* Current Booking Pill */}
          <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-start gap-3">
            <FiClock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-amber-900">Current Booking:</span> {currentDoctorName} on{" "}
              <span className="font-semibold text-slate-900">{currentDate}</span> at{" "}
              <span className="font-mono font-bold text-slate-900">{currentTime}</span>.
              <p className="text-[11px] text-slate-500 mt-0.5">
                Rescheduling will reassign the slot and update the patient's schedule.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
              <FiAlertCircle size={15} className="text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Doctor Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Consulting Specialist / Doctor *
            </label>
            <select
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90]"
              required
            >
              {doctors.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name} — {doc.specialization}
                </option>
              ))}
            </select>
          </div>

          {/* New Date Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              New Appointment Date *
            </label>
            <input
              type="date"
              min={todayIso}
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90]"
              required
            />
          </div>

          {/* Slot Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Available Upcoming Slots *
              </label>
              {loadingSlots && (
                <span className="text-[11px] text-slate-400 font-medium">Loading slots...</span>
              )}
            </div>

            {loadingSlots ? (
              <div className="py-6 flex items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#254d90]" />
              </div>
            ) : slotsList.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
                <p className="text-xs font-semibold text-slate-600">No slots available on this date</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  The doctor might be off duty or fully booked. Please try another date.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-40 overflow-y-auto p-1 bg-slate-50 rounded-xl border border-slate-200">
                {slotsList.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlot(s)}
                    className={`py-1.5 px-2 text-xs font-mono font-bold rounded-lg transition cursor-pointer text-center ${
                      slot === s
                        ? "bg-[#254d90] text-white shadow-xs"
                        : "bg-white text-slate-700 border border-slate-200 hover:border-[#254d90] hover:text-[#254d90]"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reschedule Reason */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Reason / Reception Note (Optional)
            </label>
            <input
              type="text"
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              placeholder="e.g. Patient requested morning slot, doctor delayed"
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !slot || slotsList.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-[#254d90] hover:bg-[#1e3e73] rounded-lg transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <FiCheck size={14} />
              <span>{submitting ? "Rescheduling..." : "Confirm Reschedule"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
