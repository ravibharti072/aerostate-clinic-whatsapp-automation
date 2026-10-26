import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FiX, FiClock, FiCalendar, FiUserCheck, FiCheck, FiAlertCircle, FiArrowRight } from "react-icons/fi";
import { createDoctor, updateDoctor, fetchEligibleStaffForDoctor, fetchStaff } from "../api";

const ALL_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export default function DoctorModal({ isOpen, onClose, doctor, onSaved }) {
  const navigate = useNavigate();
  const isEditing = Boolean(doctor && doctor.id);

  const [eligibleStaff, setEligibleStaff] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [availableDays, setAvailableDays] = useState([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [slotDurationMins, setSlotDurationMins] = useState(30);
  const [consultationFee, setConsultationFee] = useState(500);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load eligible staff from Staff Directory whenever modal opens for creation
  useEffect(() => {
    if (isOpen && !isEditing) {
      setLoadingStaff(true);
      fetchEligibleStaffForDoctor()
        .then((data) => {
          setEligibleStaff(data || []);
          // Auto-select first unassigned doctor if available
          const firstDoctor = (data || []).find((s) => s.is_doctor_role && !s.is_already_specialist) || (data || [])[0];
          if (firstDoctor) {
            setSelectedStaffId(String(firstDoctor.id));
            setName(firstDoctor.full_name);
            setSpecialization(firstDoctor.department || "General Medicine");
          }
        })
        .catch(async () => {
          // Fallback to fetchStaff
          try {
            const rawStaff = await fetchStaff();
            setEligibleStaff(rawStaff || []);
            if (rawStaff && rawStaff.length > 0) {
              const doc = rawStaff.find((s) => (s.role_category || "").toLowerCase() === "doctor") || rawStaff[0];
              setSelectedStaffId(String(doc.id));
              setName(doc.full_name);
              setSpecialization(doc.department || "General Medicine");
            }
          } catch (err) {
            console.error("Failed to load staff for specialist selection:", err);
          }
        })
        .finally(() => setLoadingStaff(false));
    }
  }, [isOpen, isEditing]);

  useEffect(() => {
    if (doctor) {
      setName(doctor.name || "");
      setSpecialization(doctor.specialization || "");
      const days = (doctor.available_days || "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      setAvailableDays(days.length ? days : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
      setStartTime(doctor.start_time || "09:00");
      setEndTime(doctor.end_time || "17:00");
      setSlotDurationMins(doctor.slot_duration_mins || 30);
      setConsultationFee(doctor.consultation_fee !== undefined ? doctor.consultation_fee : 500);
      setIsActive(doctor.is_active !== undefined ? doctor.is_active : true);
    } else {
      setAvailableDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
      setStartTime("09:00");
      setEndTime("17:00");
      setSlotDurationMins(30);
      setConsultationFee(500);
      setIsActive(true);
    }
    setError(null);
  }, [doctor, isOpen]);

  if (!isOpen) return null;

  const handleStaffChange = (staffIdStr) => {
    setSelectedStaffId(staffIdStr);
    const chosen = eligibleStaff.find((s) => String(s.id) === String(staffIdStr));
    if (chosen) {
      setName(chosen.full_name);
      setSpecialization(chosen.department || chosen.designation || "General Medicine");
    } else {
      setName("");
      setSpecialization("");
    }
  };

  const toggleDay = (day) => {
    if (availableDays.includes(day)) {
      if (availableDays.length === 1) return;
      setAvailableDays(availableDays.filter((d) => d !== day));
    } else {
      setAvailableDays([...availableDays, day]);
    }
  };

  const selectedStaffObj = eligibleStaff.find((s) => String(s.id) === String(selectedStaffId));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!isEditing && !selectedStaffId) {
      setError("Please select a registered doctor or staff member from the Staff Directory.");
      return;
    }

    if (!name.trim()) {
      setError("Specialist name is required.");
      return;
    }

    if (!specialization.trim()) {
      setError("Specialization / Department is required.");
      return;
    }

    setLoading(true);

    const payload = {
      staff_id: selectedStaffId ? Number(selectedStaffId) : undefined,
      name: name.trim(),
      specialization: specialization.trim(),
      available_days: availableDays.join(","),
      start_time: startTime,
      end_time: endTime,
      slot_duration_mins: Number(slotDurationMins),
      consultation_fee: Number(consultationFee) || 500,
      is_active: isActive,
    };

    try {
      if (isEditing) {
        await updateDoctor(doctor.id, payload);
      } else {
        await createDoctor(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save specialist schedule");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-content"
        style={{ maxWidth: "560px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{isEditing ? "Edit Specialist Schedule" : "Configure Specialist Schedule"}</h2>
            <div className="modal-kicker">
              Specialists are linked directly to personnel in Staff & Duty Directory
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
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold flex items-center gap-2">
                <FiAlertCircle size={15} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Specialist Personnel Selection (Fetched Strictly from Staff Directory) */}
            <div className="form-group">
              <label className="flex items-center justify-between">
                <span className="font-bold text-slate-800">
                  {isEditing ? "Assigned Specialist" : "Select Specialist from Staff Directory *"}
                </span>
                <span className="text-[11px] text-slate-500 font-normal">
                  (Single Source: Staff Directory)
                </span>
              </label>

              {isEditing ? (
                <div>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Doctor Name (e.g. Dr. Amit Sharma)"
                    className="dir-input w-full"
                    style={{ height: "40px", fontSize: "13px" }}
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Specialist's professional name shown to patients and on OPD slips.
                  </span>
                </div>
              ) : loadingStaff ? (
                <div className="py-2 text-xs text-slate-400">Loading registered clinic staff...</div>
              ) : (
                <>
                  <select
                    value={selectedStaffId}
                    onChange={(e) => handleStaffChange(e.target.value)}
                    required
                    className="dir-select w-full"
                    style={{ height: "40px", fontSize: "13px" }}
                  >
                    <option value="">-- Choose Registered Doctor from Staff Directory --</option>
                    {eligibleStaff.map((stf) => (
                      <option key={stf.id} value={stf.id}>
                        {stf.staff_uid} • {stf.full_name} ({stf.department || stf.role_category})
                        {stf.is_already_specialist ? " [Already on Roster]" : ""}
                      </option>
                    ))}
                  </select>

                  {selectedStaffObj && (
                    <div className="mt-2 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[#254d90] text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {selectedStaffObj.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">
                            {selectedStaffObj.full_name}{" "}
                            <span className="font-mono font-normal text-slate-500 text-[11px]">
                              ({selectedStaffObj.staff_uid})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Role: {selectedStaffObj.role_category} • Dept: {selectedStaffObj.department} • Phone: {selectedStaffObj.contact_phone}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {eligibleStaff.length === 0 && !loadingStaff && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 mt-2">
                      <p className="font-semibold">No doctors found in Staff Directory.</p>
                      <p className="mt-1 text-[11px] text-amber-700">
                        All staff (Doctors, Specialists, Nurses, Receptionists) must be registered in the Staff Directory first.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate("/staff");
                        }}
                        className="mt-2 px-3 py-1 rounded bg-[#254d90] text-white font-semibold text-xs hover:bg-[#1b3868] transition cursor-pointer flex items-center gap-1.5"
                      >
                        <span>Open Staff Directory & Register Doctor</span>
                        <FiArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="form-group">
              <label>Medical Specialization / Clinical Department *</label>
              <input
                type="text"
                required
                placeholder="e.g. Dentistry, Cardiology, General Medicine, Pediatrics"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Standard Consultation Fee (₹) *</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">₹</span>
                <input
                  type="number"
                  required
                  min="0"
                  step="50"
                  placeholder="500"
                  value={consultationFee}
                  onChange={(e) => setConsultationFee(e.target.value)}
                  style={{ paddingLeft: "26px" }}
                />
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">
                Default OPD fee charged when booking consultations with this specialist.
              </span>
            </div>

            <div className="form-group">
              <label>Available Days of the Week</label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ALL_DAYS.map((day) => {
                  const selected = availableDays.includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                        selected
                          ? "bg-[#254d90] text-white border-[#254d90] shadow-xs"
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-row-3">
              <div className="form-group">
                <label>Start Time</label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Slot Duration</label>
                <select
                  value={slotDurationMins}
                  onChange={(e) => setSlotDurationMins(e.target.value)}
                >
                  <option value={10}>10 mins (Fast OPD / Follow-up)</option>
                  <option value={15}>15 mins (Standard OPD)</option>
                  <option value={20}>20 mins (General Consultation)</option>
                  <option value={30}>30 mins (Detailed / Procedures)</option>
                  <option value={45}>45 mins</option>
                  <option value={60}>60 mins</option>
                </select>
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="checkbox"
                id="activeToggle"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-slate-300 text-[#254d90] focus:ring-[#254d90] cursor-pointer"
                style={{ width: "16px", height: "16px" }}
              />
              <label
                htmlFor="activeToggle"
                className="text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Active Specialist (Visible in WhatsApp interactive menu & OPD bookings)
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (!isEditing && !selectedStaffId)}
              className="btn-submit"
            >
              <FiCheck size={14} />
              <span>{loading ? "Saving..." : isEditing ? "Save Changes" : "Activate Specialist Schedule"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
