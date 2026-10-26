import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiUsers,
  FiClock,
  FiCheckCircle,
  FiBell,
  FiPlus,
  FiRotateCw,
  FiRefreshCw,
  FiX,
  FiActivity,
  FiUserCheck,
  FiAlertCircle,
  FiCheck,
  FiInfo,
  FiZap,
  FiSearch,
  FiFilter,
  FiLayers,
  FiFolder,
  FiExternalLink
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import {
  fetchQueue,
  checkInPatient,
  callQueuePatient,
  startConsultationQueue,
  finishQueuePatient,
  skipQueuePatient,
  finishAndCallNextQueue,
  callNextQueue,
  notifyPatientTurn,
  fetchAppointments,
  fetchCabins,
  createCabin,
  fetchDoctors
} from "../api";

export default function QueueView() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user: currentUser } = useAuth();
  const [queueData, setQueueData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isLoggedDoctor = (currentUser?.role || "").toLowerCase() === "doctor";

  // Dual-Mode Architecture: 'FRONT_DESK' (All Cabins & Central Lobby) vs 'DOCTOR' (Doctor Cabin Desk)
  const [viewMode, setViewMode] = useState(() => {
    if (isLoggedDoctor) return "DOCTOR";
    return localStorage.getItem("clinic_queue_view_mode") || "FRONT_DESK";
  });
  const [selectedDoctorId, setSelectedDoctorId] = useState(() => {
    if (isLoggedDoctor && currentUser?.doctor_id) return String(currentUser.doctor_id);
    return localStorage.getItem("clinic_queue_doctor_id") || "";
  });
  const [doctors, setDoctors] = useState([]);

  // Search & Filter state (computed on backend)
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Cabins dynamic state (persisted in backend database)
  const [cabins, setCabins] = useState([]);
  const [isAddCabinOpen, setIsAddCabinOpen] = useState(false);
  const [cabinForm, setCabinForm] = useState({
    name: "",
    code: "",
    department: "General Consultation",
    floor: "Ground Floor",
  });
  const [savingCabin, setSavingCabin] = useState(false);

  // Check-in modal
  const [isCheckInOpen, setIsCheckInOpen] = useState(false);
  const [appointments, setAppointments] = useState([]);
  const [selectedApptId, setSelectedApptId] = useState("");
  const [selectedCabin, setSelectedCabin] = useState("Cabin 1");
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");

  const [actionLoadingId, setActionLoadingId] = useState(null);

  const activeDoctor = useMemo(() => {
    if (!selectedDoctorId) return doctors[0] || null;
    return doctors.find((d) => String(d.id) === String(selectedDoctorId)) || doctors[0] || null;
  }, [doctors, selectedDoctorId]);

  const loadData = async (opts = {}) => {
    try {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      
      const effectiveMode = opts.viewMode !== undefined ? opts.viewMode : viewMode;
      const effectiveDoctorId = opts.doctorId !== undefined ? opts.doctorId : selectedDoctorId;

      const params = {
        date: todayStr,
        status: opts.status !== undefined ? opts.status : statusFilter,
        search: opts.search !== undefined ? opts.search : searchTerm,
      };

      if (effectiveMode === "DOCTOR" && effectiveDoctorId) {
        params.doctor_id = effectiveDoctorId;
      }

      const [qData, apptsData, cabinsData, docsData] = await Promise.all([
        fetchQueue(params),
        fetchAppointments({ date: todayStr, status: "CONFIRMED" }),
        fetchCabins().catch(() => []),
        fetchDoctors(true).catch(() => []),
      ]);

      setQueueData(qData);
      setAppointments(apptsData.appointments || []);
      setCabins(cabinsData || []);
      setDoctors(docsData || []);

      if (docsData?.length > 0 && !effectiveDoctorId) {
        setSelectedDoctorId(String(docsData[0].id));
      }

      if (cabinsData?.length > 0 && (!selectedCabin || selectedCabin === "Cabin 1")) {
        setSelectedCabin(cabinsData[0].name);
      }
      if (apptsData.appointments?.length > 0 && !selectedApptId) {
        setSelectedApptId(apptsData.appointments[0].id);
      }
    } catch (err) {
      console.error("Failed to load queue:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    // Auto-refresh queue every 5 seconds for real-time front desk updates across portal
    const interval = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, [statusFilter, viewMode, selectedDoctorId]);

  const handleModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem("clinic_queue_view_mode", mode);
    loadData({ viewMode: mode });
  };

  const handleDoctorChange = (docId) => {
    setSelectedDoctorId(docId);
    localStorage.setItem("clinic_queue_doctor_id", docId);
    loadData({ doctorId: docId });
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadData({ search: searchTerm });
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    setStatusFilter("");
    loadData({ search: "", status: "" });
  };

  // Direct Backend Actions
  const handleCallPatient = async (entryId, cabin) => {
    setActionLoadingId(entryId);
    try {
      const res = await callQueuePatient(entryId, cabin);
      showToast(res.message, "success");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to call patient", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleStartConsultation = async (q) => {
    setActionLoadingId(q.id);
    try {
      const res = await startConsultationQueue(q.id);
      showToast(res.message || "Consultation in progress", "info");
      const docId = q.doctor_id || selectedDoctorId || (doctors[0]?.id || "");
      navigate(`/consultations?patient_id=${q.patient_id}&appointment_id=${q.appointment_id}&doctor_id=${docId}&auto_open=true`);
    } catch (err) {
      showToast(err.message || "Failed to start consultation", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleFinishConsultation = async (entryId) => {
    setActionLoadingId(entryId);
    try {
      const res = await finishQueuePatient(entryId);
      showToast(res.message || "Consultation completed", "success");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to finish consultation", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSkipPatient = async (entryId) => {
    setActionLoadingId(entryId);
    try {
      const res = await skipQueuePatient(entryId);
      showToast(res.message || "Patient skipped", "info");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to skip patient", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenWorkspace = (q) => {
    const docId = q.doctor_id || selectedDoctorId || (doctors[0]?.id || "");
    navigate(`/consultations?patient_id=${q.patient_id}&appointment_id=${q.appointment_id}&doctor_id=${docId}`);
  };

  const handleFinishAndCallNext = async (currentEntryId, cabin = "Cabin 1") => {
    setActionLoadingId(currentEntryId);
    try {
      const docId = viewMode === "DOCTOR" && selectedDoctorId ? selectedDoctorId : null;
      const res = await finishAndCallNextQueue(currentEntryId, cabin, docId);
      if (res.next_token) {
        showToast(
          `Consultation completed! Next patient (${res.next_token.patient_name}, Token ${res.next_token.token_display}) called into ${cabin}.`,
          "success"
        );
      } else {
        showToast("Consultation marked completed. No more waiting patients in lobby.", "success");
      }
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to advance queue", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCallNextInLine = async () => {
    try {
      const docId = viewMode === "DOCTOR" && selectedDoctorId ? selectedDoctorId : null;
      const res = await callNextQueue(selectedCabin || "Cabin 1", docId);
      showToast(res.message, "success");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to call next patient", "error");
    }
  };

  const handleNotifyAgain = async (entryId) => {
    setActionLoadingId(entryId);
    try {
      const res = await notifyPatientTurn(entryId);
      showToast(res.message || "Patient recalled!", "info");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to recall patient", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCheckInSubmit = async (e) => {
    e.preventDefault();
    if (!selectedApptId) {
      setCheckInError("Please select a patient appointment.");
      return;
    }

    setCheckingIn(true);
    setCheckInError("");
    try {
      const res = await checkInPatient(Number(selectedApptId), selectedCabin);
      setIsCheckInOpen(false);
      showToast(res.message || "Patient checked in successfully!", "success");
      loadData();
    } catch (err) {
      setCheckInError(err.message || "Check-in failed");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCreateCabin = async (e) => {
    e.preventDefault();
    if (!cabinForm.name.trim()) {
      showToast("Please enter a cabin name", "error");
      return;
    }
    setSavingCabin(true);
    try {
      const res = await createCabin(cabinForm);
      showToast(res.message || "Cabin added successfully!", "success");
      setIsAddCabinOpen(false);
      setCabinForm({
        name: "",
        code: "",
        department: "General Consultation",
        floor: "Ground Floor",
      });
      const cList = await fetchCabins();
      setCabins(cList || []);
      if (res.cabin?.name) {
        setSelectedCabin(res.cabin.name);
      }
    } catch (err) {
      showToast(err.message || "Failed to add cabin", "error");
    } finally {
      setSavingCabin(false);
    }
  };

  const queueList = queueData?.queue || [];
  const hasActiveFilters = Boolean(searchTerm || statusFilter);

  // Eligible appointments for check-in: scheduled for today, confirmed, and not already active in the queue
  const activeApptIds = useMemo(() => {
    const set = new Set();
    if (queueData?.queue) {
      queueData.queue.forEach((q) => {
        if (["WAITING", "CALLED", "IN_CONSULTATION"].includes(q.status)) {
          set.add(q.appointment_id);
        }
      });
    }
    return set;
  }, [queueData]);

  const eligibleAppointments = useMemo(() => {
    return appointments.filter((a) => !activeApptIds.has(a.id));
  }, [appointments, activeApptIds]);

  // Queue Sub-Sections: 'active' (Waiting & In-Consultation), 'completed' (Finished Checkups), 'skipped', 'all'
  const [queueTab, setQueueTab] = useState("active");

  const tabFilteredQueue = useMemo(() => {
    if (queueTab === "active") {
      return queueList.filter((q) => ["WAITING", "CALLED", "IN_CONSULTATION"].includes(q.status));
    }
    if (queueTab === "completed") {
      return queueList.filter((q) => q.status === "COMPLETED");
    }
    if (queueTab === "skipped") {
      return queueList.filter((q) => q.status === "SKIPPED");
    }
    return queueList;
  }, [queueList, queueTab]);

  const activeCount = useMemo(
    () => queueList.filter((q) => ["WAITING", "CALLED", "IN_CONSULTATION"].includes(q.status)).length,
    [queueList]
  );
  const completedCount = useMemo(
    () => queueList.filter((q) => q.status === "COMPLETED").length,
    [queueList]
  );
  const skippedCount = useMemo(
    () => queueList.filter((q) => q.status === "SKIPPED").length,
    [queueList]
  );
  const totalCount = queueList.length;

  // Pagination (20 entries per page default from LRS)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const paginatedQueueList = useMemo(() => {
    if (pageSize === "all") return tabFilteredQueue;
    const start = (currentPage - 1) * pageSize;
    return tabFilteredQueue.slice(start, start + pageSize);
  }, [tabFilteredQueue, currentPage, pageSize]);

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="WAITING ROOM & PATIENT FLOW"
        title="Live Patient Queue & Tokens"
        icon={FiUsers}
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setRefreshing(true);
                loadData();
              }}
              disabled={refreshing}
              className="portal-refresh-btn"
              title="Refresh Queue Data"
            >
              <FiRotateCw className={`refresh-icon ${refreshing ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={() => setIsAddCabinOpen(true)}
              className="portal-action-btn flex items-center gap-1.5"
            >
              <FiLayers size={15} />
              <span>+ Add Cabin</span>
            </button>
            <button
              onClick={() => {
                setCheckInError("");
                if (eligibleAppointments.length > 0) {
                  setSelectedApptId(eligibleAppointments[0].id);
                } else {
                  setSelectedApptId("");
                }
                setIsCheckInOpen(true);
              }}
              className="portal-action-btn portal-action-btn-blue flex items-center gap-2"
            >
              <FiPlus size={16} />
              <span>Check In Patient</span>
            </button>
          </div>
        }
      />

      {/* Reusable Stat Cards - Scoped dynamically by Mode */}
      <div className="dir-stats-grid">
        <StatCard
          title={viewMode === "DOCTOR" ? "Queued for You Today" : "Total Queued Today"}
          value={queueData?.total_queued || 0}
          Icon={FiUsers}
          colorTheme="brand-blue"
        />
        <StatCard
          title={viewMode === "DOCTOR" ? "Waiting for You" : "Currently Waiting"}
          value={queueData?.waiting_count || 0}
          Icon={FiClock}
          colorTheme="brand-teal"
        />
        <StatCard
          title={viewMode === "DOCTOR" ? "In Your Consultation" : "In Consultation / Called"}
          value={queueData?.in_consultation_count || 0}
          Icon={FiUserCheck}
          colorTheme="brand-blue"
        />
        <StatCard
          title={viewMode === "DOCTOR" ? "Completed by You" : "Completed Today"}
          value={queueData?.completed_count || 0}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Module Roster Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            queueTab === "completed"
              ? viewMode === "DOCTOR"
                ? `${activeDoctor?.name || "Doctor"} • Completed Checkups`
                : "Completed Consultations"
              : queueTab === "skipped"
              ? "Skipped Queue Tokens"
              : queueTab === "all"
              ? "All Daily Queue Tokens"
              : viewMode === "DOCTOR"
              ? `${activeDoctor?.name || "Doctor"} Cabin Queue`
              : "Waiting Room Roster"
          }
          description={
            queueTab === "completed"
              ? "Record of patient consultations completed today. Ready for prescription dispensing and cashier billing."
              : viewMode === "DOCTOR"
              ? `Doctor Consultation OPD Desk for ${activeDoctor?.specialization || "Clinical Practice"}. Call your next patient into your cabin.`
              : "Real-time patient waiting list. Completed checkups automatically advance to the Completed section."
          }
          badgeCount={tabFilteredQueue.length}
          badgeLabel={
            queueTab === "completed"
              ? "completed checkups"
              : queueTab === "skipped"
              ? "skipped tokens"
              : queueTab === "all"
              ? "total tokens"
              : "waiting / in consult"
          }
          subBadge={
            queueTab === "active" && queueData?.has_waiting ? (
              <button
                type="button"
                onClick={handleCallNextInLine}
                className="px-3 py-1 rounded-md text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5 cursor-pointer shadow-xs transition"
                title={viewMode === "DOCTOR" ? "Call next waiting patient for your cabin" : "Call next waiting patient"}
              >
                <FiBell size={13} />
                <span>{viewMode === "DOCTOR" ? "Call My Next Patient" : "Call Next Waiting"}</span>
                {queueData.next_waiting && (
                  <span className="bg-amber-700/50 px-1.5 py-0.5 rounded text-[10px] font-mono">
                    {queueData.next_waiting.token_display}
                  </span>
                )}
              </button>
            ) : null
          }
        />

        {/* Queue Filter Tabs & System Mode Desk Switcher (Positioned below Section Header & Description) */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Queue Sub-Sections */}
          <div className="wa-tabs-container">
            <button
              type="button"
              onClick={() => {
                setQueueTab("active");
                setCurrentPage(1);
              }}
              className={`wa-tab-btn ${queueTab === "active" ? "active" : ""}`}
            >
              <FiClock size={15} />
              <span>Active Queue ({activeCount})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setQueueTab("completed");
                setCurrentPage(1);
              }}
              className={`wa-tab-btn ${queueTab === "completed" ? "active" : ""}`}
            >
              <FiCheckCircle size={15} />
              <span>Completed ({completedCount})</span>
            </button>
            {skippedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQueueTab("skipped");
                  setCurrentPage(1);
                }}
                className={`wa-tab-btn ${queueTab === "skipped" ? "active" : ""}`}
              >
                <FiAlertCircle size={15} />
                <span>Skipped ({skippedCount})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setQueueTab("all");
                setCurrentPage(1);
              }}
              className={`wa-tab-btn ${queueTab === "all" ? "active" : ""}`}
            >
              <FiUsers size={15} />
              <span>All Tokens ({totalCount})</span>
            </button>
          </div>

          {/* Separate Section Next to All Tokens: System Desk Mode (Front Desk / Doctor Desk) */}
          <div className="flex items-center gap-2">
            <div className="wa-tabs-container items-center">
              <button
                type="button"
                onClick={() => handleModeChange("FRONT_DESK")}
                className={`wa-tab-btn ${viewMode === "FRONT_DESK" ? "active" : ""}`}
              >
                <FiLayers size={14} />
                <span>Front Desk</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("DOCTOR")}
                className={`wa-tab-btn ${viewMode === "DOCTOR" ? "active" : ""}`}
              >
                <FiUserCheck size={14} />
                <span>Doctor Desk</span>
              </button>

              {viewMode === "DOCTOR" && (
                <>
                  <div className="h-6 w-px bg-slate-200 mx-1 self-center" />
                  <div className="flex items-center gap-2 pl-1 pr-1">
                    <span className="text-[13px] font-semibold text-slate-500 whitespace-nowrap">
                      Doctor:
                    </span>
                    <select
                      value={selectedDoctorId}
                      onChange={(e) => handleDoctorChange(e.target.value)}
                      className="font-semibold text-slate-800 text-[13px] bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-md border border-slate-200 outline-none cursor-pointer transition"
                      style={{
                        height: "36px",
                        minWidth: "220px",
                        fontSize: "13px",
                        fontWeight: "600",
                      }}
                    >
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.specialization || "Doctor"})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* CONTROLS & TOOLBAR */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search by Token (e.g. #01), Patient ID, Name, or Doctor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onSearch={handleSearchSubmit}
          />

          <div className="dir-toolbar-right">
            <select
              className="dir-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="WAITING">Waiting in Lobby</option>
              <option value="CALLED">Called / Notified</option>
              <option value="IN_CONSULTATION">In Consultation</option>
              <option value="COMPLETED">Completed</option>
              <option value="SKIPPED">Skipped</option>
            </select>

            <button
              type="button"
              onClick={handleSearchSubmit}
              className="btn-submit"
              style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
            >
              Filter
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="btn-cancel"
                style={{ width: "auto", height: "34px", padding: "0 12px", fontSize: "12.5px" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Data Grid Table with Vertical Separating Lines */}
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
          </div>
        ) : tabFilteredQueue.length === 0 ? (
          <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
            {queueTab === "completed" ? (
              <FiCheckCircle className="w-10 h-10 mx-auto text-emerald-400 mb-3" />
            ) : (
              <FiUsers className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            )}
            <h3 className="text-sm font-bold text-slate-800">
              {hasActiveFilters
                ? "No matching queue entries found"
                : queueTab === "completed"
                ? "No completed checkups yet today"
                : queueTab === "skipped"
                ? "No skipped patients today"
                : "Active waiting queue is currently clear"}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {hasActiveFilters
                ? "Try adjusting or clearing your search / filter criteria."
                : queueTab === "completed"
                ? "Patients will automatically move into this Completed section when their doctor finishes their consultation."
                : completedCount > 0
                ? `${completedCount} patient checkup${completedCount === 1 ? "" : "s"} finished today. You can view them in the Completed section.`
                : "When a patient arrives at the clinic, click 'Check In Patient' to assign a token and start managing their queue status."}
            </p>
            {!hasActiveFilters && queueTab === "active" && completedCount > 0 && (
              <button
                type="button"
                onClick={() => setQueueTab("completed")}
                className="mt-4 portal-action-btn portal-action-btn-teal inline-flex items-center gap-1.5"
              >
                <FiCheckCircle size={15} />
                <span>View Completed Patients ({completedCount})</span>
              </button>
            )}
            {!hasActiveFilters && queueTab === "active" && completedCount === 0 && (
              <button
                onClick={() => setIsCheckInOpen(true)}
                className="mt-4 portal-action-btn portal-action-btn-blue inline-flex items-center gap-1.5"
              >
                <FiPlus size={15} />
                <span>Check In First Patient</span>
              </button>
            )}
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">
                {queueTab === "completed"
                  ? "⇄ Completed Checkups (Scroll horizontally to view all columns)"
                  : "⇄ Master Waiting Room Queue (Scroll horizontally to view all columns)"}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {queueTab === "completed"
                  ? `${completedCount} completed patient${completedCount === 1 ? "" : "s"}`
                  : `${activeCount} waiting / in consult`}
              </span>
            </div>
            <div
              className="data-grid-container"
              style={{
                border: "none",
                borderRadius: 0,
                boxShadow: "none",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                width: "100%",
              }}
            >
              <table className="data-grid-table" style={{ minWidth: "1250px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>TOKEN</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DOCTOR</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SPECIALTY</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ASSIGNED CABIN</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>APPT TIME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>WAIT TIME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedQueueList.map((q) => {
                    const isUpdating = actionLoadingId === q.id;
                    const isCalled = q.status === "CALLED";
                    const isInConsult = q.status === "IN_CONSULTATION";
                    const isCompleted = q.status === "COMPLETED";
                    const isSkipped = q.status === "SKIPPED";
                    const isWaiting = q.status === "WAITING";

                    return (
                      <tr
                        key={q.id}
                        className={
                          isCalled
                            ? "bg-amber-50/50"
                            : isInConsult
                            ? "bg-teal-50/30"
                            : isCompleted
                            ? "opacity-75"
                            : ""
                        }
                      >
                        {/* Token Column */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`font-mono text-xs font-bold px-2.5 py-1 rounded-md inline-flex items-center gap-1 shadow-xs border ${
                              isCalled
                                ? "bg-amber-500 text-white border-amber-600 animate-pulse"
                                : isInConsult
                                ? "bg-[#126868] text-white border-[#0e5252]"
                                : isCompleted
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : isSkipped
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : "bg-blue-50 text-[#1a56db] border-blue-200"
                            }`}
                          >
                            {q.token_display}
                          </span>
                        </td>

                        {/* Patient ID */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-xs font-semibold text-[#254d90] bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200/60 inline-block">
                            {q.patient_uid || (q.patient_id ? `PAT-${String(q.patient_id).padStart(4, "0")}` : "—")}
                          </span>
                        </td>

                        {/* Patient Name */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold text-slate-900">
                            {q.patient_name}
                          </span>
                        </td>

                        {/* Doctor Name */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-semibold text-slate-900">
                            {q.doctor_name}
                          </span>
                        </td>

                        {/* Doctor Specialty */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-600">
                            {q.doctor_specialty || "General"}
                          </span>
                        </td>

                        {/* Assigned Cabin */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                            {q.cabin}
                          </span>
                        </td>

                        {/* Appt Time */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-700 font-mono">
                            {q.appointment_time || "Walk-in"}
                          </span>
                        </td>

                        {/* Wait Time */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex items-center gap-1.5 text-slate-600 font-mono">
                            <FiClock size={12} className="text-slate-400 shrink-0" />
                            <span>{q.wait_display}</span>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border ${
                              isCalled
                                ? "bg-amber-100 text-amber-800 border-amber-300"
                                : isInConsult
                                ? "bg-teal-50 text-teal-800 border-teal-200"
                                : isCompleted
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : isSkipped
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}
                            style={{ fontSize: "11px" }}
                          >
                            <span>{q.status}</span>
                          </span>
                        </td>

                        {/* Medical Actions */}
                        <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <div className="inline-flex items-center justify-end gap-1.5">
                          {/* If WAITING: Call next into cabin */}
                          {q.can_call && (
                            <button
                              disabled={isUpdating}
                              onClick={() => handleCallPatient(q.id, q.cabin)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-500 hover:bg-amber-600 text-white transition cursor-pointer inline-flex items-center gap-1 shadow-xs"
                              title="Call patient into cabin"
                            >
                              <FiBell size={12} />
                              <span>Call Patient</span>
                            </button>
                          )}

                          {/* If CALLED: Recall / announce again */}
                          {q.can_notify_again && (
                            <button
                              disabled={isUpdating}
                              onClick={() => handleNotifyAgain(q.id)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 transition cursor-pointer inline-flex items-center gap-1 shadow-xs"
                              title="Recall patient (announce turn again)"
                            >
                              <FiBell size={12} />
                              <span>Recall</span>
                            </button>
                          )}

                          {/* If CALLED: Start consultation & navigate to workspace */}
                          {q.can_start_consultation && (
                            <button
                              disabled={isUpdating}
                              onClick={() => handleStartConsultation(q)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-[#126868] hover:bg-[#0e5252] text-white transition cursor-pointer inline-flex items-center gap-1 shadow-xs"
                              title="Begin consultation and open patient clinical workspace"
                            >
                              <FiActivity size={12} />
                              <span>Start Consult</span>
                            </button>
                          )}

                          {/* Doctor Clinical Workspace Quick Launch */}
                          {(isCalled || isInConsult) && (
                            <button
                              type="button"
                              onClick={() => handleOpenWorkspace(q)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-[#254d90]/10 hover:bg-[#254d90]/20 text-[#254d90] transition cursor-pointer inline-flex items-center gap-1 shadow-xs"
                              title="Open Doctor Clinical Encounter & Workspace"
                            >
                              <FiActivity size={12} />
                              <span>Workspace</span>
                            </button>
                          )}

                          {/* If IN_CONSULTATION: Finish & Call Next (Fast OPD Dynamic Flow) */}
                          {q.can_finish_and_call_next && (
                            <button
                              disabled={isUpdating}
                              onClick={() => handleFinishAndCallNext(q.id, q.cabin)}
                              className="px-2.5 py-1 text-xs font-bold rounded-md bg-[#254d90] hover:bg-[#1b3a6d] text-white transition cursor-pointer inline-flex items-center gap-1 shadow-xs"
                              title="Finish this consultation and call next waiting patient"
                            >
                              <FiZap size={12} className="text-amber-300" />
                              <span>Finish &amp; Call Next</span>
                            </button>
                          )}

                          {/* If IN_CONSULTATION: Finish without calling next */}
                          {q.can_finish && (
                            <button
                              disabled={isUpdating}
                              onClick={() => handleFinishConsultation(q.id)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer inline-flex items-center gap-1"
                              title="Mark consultation as complete"
                            >
                              <FiCheckCircle size={12} className="text-emerald-600" />
                              <span>Finish</span>
                            </button>
                          )}

                          {/* Skip option for waiting or called patients */}
                          {q.can_skip && (
                            <button
                              disabled={isUpdating}
                              onClick={() => handleSkipPatient(q.id)}
                              className="px-2 py-1 text-xs font-medium text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                              title="Skip Patient"
                            >
                              Skip
                            </button>
                          )}

                          {/* Completed or Skipped Read-Only Indicator */}
                          {isCompleted && (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-semibold inline-flex items-center gap-1">
                                <FiCheckCircle size={12} />
                                <span>Completed</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenWorkspace(q)}
                                className="px-2 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer inline-flex items-center gap-1"
                                title="Open Doctor Clinical Encounter & Workspace"
                              >
                                <FiFolder size={11} />
                                <span>EMR</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/billing?patient_id=${q.patient_id}&appointment_id=${q.appointment_id}`)}
                                className="px-2 py-1 text-xs font-semibold rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition cursor-pointer inline-flex items-center gap-1"
                                title="Open Billing & Cashier"
                              >
                                <span>Bill</span>
                              </button>
                            </div>
                          )}

                          {isSkipped && (
                            <span className="text-xs text-slate-400 italic">
                              Skipped
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={currentPage}
            totalItems={tabFilteredQueue.length}
            pageSize={pageSize}
            onPageChange={(p) => setCurrentPage(p)}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setCurrentPage(1);
            }}
            pageSizeOptions={[10, 20, 50, 100]}
            itemLabel={queueTab === "completed" ? "completed patients" : "queue tokens"}
          />

          <div className="dir-scroll-bar-footer">
            <span className="text-xs text-slate-500 font-medium">
              Real-time patient waiting list. Live queue status synchronizes seamlessly between reception desk and doctor cabins.
            </span>
          </div>
        </div>
      )}
    </section>

      {/* CHECK IN PATIENT MODAL */}
      {isCheckInOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "520px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Patient Check-In</h2>
                <div className="modal-kicker">
                  Assign consultation cabin and issue next sequential queue token
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsCheckInOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleCheckInSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                {checkInError && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
                    {checkInError}
                  </div>
                )}

                <div className="form-group">
                  <label>Select Today's Confirmed Booking *</label>
                  {eligibleAppointments.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-3 bg-slate-50 border border-slate-200 rounded-lg m-0">
                      {appointments.length > 0
                        ? "All scheduled patients for today are already checked into the queue or completed."
                        : "No confirmed bookings found for today. Create an appointment first to check in."}
                    </p>
                  ) : (
                    <select
                      value={selectedApptId}
                      onChange={(e) => setSelectedApptId(e.target.value)}
                    >
                      {eligibleAppointments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.start_time} - {a.patient_name} (Dr. {a.doctor_name || "Doctor"})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="form-group">
                  <div className="flex items-center justify-between mb-1">
                    <label className="m-0">Assign Consultation Cabin *</label>
                    <button
                      type="button"
                      onClick={() => setIsAddCabinOpen(true)}
                      className="text-xs text-[#254d90] font-bold hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <FiPlus size={12} />
                      <span>+ Add New Cabin</span>
                    </button>
                  </div>
                  {cabins.length === 0 ? (
                    <input
                      type="text"
                      placeholder="e.g. Cabin 1"
                      value={selectedCabin}
                      onChange={(e) => setSelectedCabin(e.target.value)}
                    />
                  ) : (
                    <select
                      value={selectedCabin}
                      onChange={(e) => setSelectedCabin(e.target.value)}
                    >
                      {cabins.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.display_label || `${c.name} (${c.department})`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="info-box-note">
                  <FiInfo size={16} style={{ flexShrink: 0 }} />
                  <span>Next sequential token is assigned automatically upon confirmation.</span>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsCheckInOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={checkingIn || eligibleAppointments.length === 0}
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{checkingIn ? "Assigning Token..." : "Issue Token"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD CABIN MODAL */}
      {isAddCabinOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "500px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Add Consultation Cabin</h2>
                <div className="modal-kicker">
                  Configure examination room or operatory for this clinic
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsAddCabinOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCabin} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Cabin / Room Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Cabin 4, Dental Operatory B, Cardiac OPD"
                    value={cabinForm.name}
                    onChange={(e) => setCabinForm({ ...cabinForm, name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Room Code / Identifier</label>
                    <input
                      type="text"
                      placeholder="e.g. CAB-04, DENT-B"
                      value={cabinForm.code}
                      onChange={(e) => setCabinForm({ ...cabinForm, code: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Floor / Wing</label>
                    <input
                      type="text"
                      placeholder="e.g. Ground Floor, 1st Floor"
                      value={cabinForm.floor}
                      onChange={(e) => setCabinForm({ ...cabinForm, floor: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Clinical Department / Purpose</label>
                  <input
                    type="text"
                    placeholder="e.g. General Consultation, Dental, Minor Procedures"
                    value={cabinForm.department}
                    onChange={(e) => setCabinForm({ ...cabinForm, department: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAddCabinOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCabin}
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{savingCabin ? "Saving..." : "Add Cabin"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
