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
  FiExternalLink,
  FiList,
  FiGrid
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
  const [desktopViewMode, setDesktopViewMode] = useState("table"); // 'table' | 'cards'

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
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    const term = typeof e === "string" ? e : searchTerm;
    loadData({ search: term });
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

        {/* Queue Sub-Section Tabs (Style identical to Prescriptions & Consultations) */}
        <div className="wa-tabs-container">
          <button
            type="button"
            onClick={() => {
              setQueueTab("active");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${queueTab === "active" ? "active" : ""}`}
          >
            <span>Active ({activeCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setQueueTab("completed");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${queueTab === "completed" ? "active" : ""}`}
          >
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
            <span>All Tokens ({totalCount})</span>
          </button>
        </div>

        {/* CONTROLS & TOOLBAR */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search token, patient ID, name, doctor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onSearch={handleSearchSubmit}
            onClear={handleClearFilters}
          />

          <div className="dir-toolbar-right">
            {/* Desk Mode Switcher (Front Desk / Doctor Desk) */}
            <div className="hidden sm:inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5" style={{ height: "34px" }}>
              <button
                type="button"
                onClick={() => handleModeChange("FRONT_DESK")}
                className={`inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === "FRONT_DESK"
                    ? "bg-white text-slate-900 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                style={{ height: "28px" }}
                title="All Cabins & Central Lobby Queue"
              >
                <FiLayers size={13} />
                <span>Front Desk</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("DOCTOR")}
                className={`inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === "DOCTOR"
                    ? "bg-white text-slate-900 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                style={{ height: "28px" }}
                title="Doctor Cabin Queue"
              >
                <FiUserCheck size={13} />
                <span>Doctor Desk</span>
              </button>
            </div>

            {viewMode === "DOCTOR" && doctors.length > 0 && (
              <select
                value={selectedDoctorId}
                onChange={(e) => handleDoctorChange(e.target.value)}
                className="dir-filter-select"
                style={{ height: "34px", padding: "0 10px", fontSize: "12px" }}
              >
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.specialization || "Doctor"})
                  </option>
                ))}
              </select>
            )}

            {/* Desktop View Switcher: List vs Cards (Identical to PrescriptionsView) */}
            <div className="hidden md:inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5" style={{ height: "34px" }}>
              <button
                type="button"
                onClick={() => setDesktopViewMode("table")}
                className={`inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer ${
                  desktopViewMode === "table"
                    ? "bg-white text-slate-900 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                style={{ height: "28px" }}
                title="Spreadsheet List View"
              >
                <FiList size={13} />
                <span>List View</span>
              </button>
              <button
                type="button"
                onClick={() => setDesktopViewMode("cards")}
                className={`inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer ${
                  desktopViewMode === "cards"
                    ? "bg-white text-slate-900 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                style={{ height: "28px" }}
                title="Compact Card View"
              >
                <FiGrid size={13} />
                <span>Cards View</span>
              </button>
            </div>

            {searchTerm && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="btn-cancel"
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
          <>
            {/* Desktop View: Full 10-Column Horizontal Scroll Table (1 at a time when desktopViewMode === 'table') */}
            {desktopViewMode === "table" && (
              <div className="dir-table-wrapper queue-desktop-table hidden md:flex">
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

      {/* Cards View: ONLY view on mobile (< md), and shown on PC (md+) when desktopViewMode === 'cards' */}
      <div className={`${desktopViewMode === "cards" ? "block" : "block md:hidden"} w-full`}>
        <div className="space-y-3.5 md:space-y-0 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4">
          {paginatedQueueList.map((q) => {
            const isUpdating = actionLoadingId === q.id;
            const isCalled = q.status === "CALLED";
            const isInConsult = q.status === "IN_CONSULTATION";
            const isCompleted = q.status === "COMPLETED";
            const isSkipped = q.status === "SKIPPED";
            const isWaiting = q.status === "WAITING";

            return (
              <div
                key={q.id}
                className={`bg-white rounded-xl border p-4 shadow-xs flex flex-col gap-3 transition ${
                  isCalled
                    ? "border-amber-300 bg-amber-50/30"
                    : isInConsult
                    ? "border-teal-300 bg-teal-50/20"
                    : isCompleted
                    ? "border-slate-200 opacity-80"
                    : "border-slate-200"
                }`}
              >
                {/* 1. Header: Token display, UID, Status */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 flex-wrap">
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
                    <span className="font-mono text-[11px] font-semibold text-[#254d90] bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200/60">
                      {q.patient_uid || (q.patient_id ? `PAT-${String(q.patient_id).padStart(4, "0")}` : "—")}
                    </span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                      isCalled
                        ? "bg-amber-100 text-amber-800 border-amber-300 animate-pulse"
                        : isInConsult
                        ? "bg-teal-50 text-teal-800 border-teal-200"
                        : isCompleted
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : isSkipped
                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                        : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}
                  >
                    <span>{q.status}</span>
                  </span>
                </div>

                {/* 2. Patient & Cabin Info */}
                <div>
                  <h4 className="text-base font-bold text-slate-900 leading-tight">
                    {q.patient_name}
                  </h4>

                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200 text-xs flex flex-col gap-1.5 mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-slate-900 truncate">
                          {q.doctor_name}
                        </span>
                        {q.doctor_specialty && (
                          <span className="text-slate-400 text-[10.5px] truncate">
                            ({q.doctor_specialty})
                          </span>
                        )}
                      </div>
                      <span className="text-[10.5px] font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded border border-[#254d90]/20 shrink-0">
                        {q.cabin}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-slate-600 font-mono text-[11px]">
                      <span>Appt: {q.appointment_time || "Walk-in"}</span>
                      <div className="flex items-center gap-1">
                        <FiClock size={11} className="text-slate-400" />
                        <span>Wait: {q.wait_display}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Action Buttons Attached Directly to Card */}
                <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
                  {/* Actions for WAITING status */}
                  {q.can_call && (
                    <div className="flex items-center gap-2">
                      <button
                        disabled={isUpdating}
                        onClick={() => handleCallPatient(q.id, q.cabin)}
                        className="flex-1 py-2 px-3 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition cursor-pointer inline-flex items-center justify-center gap-1.5"
                      >
                        <FiBell size={13} />
                        <span>Call Patient</span>
                      </button>
                      {q.can_skip && (
                        <button
                          disabled={isUpdating}
                          onClick={() => handleSkipPatient(q.id)}
                          className="py-2 px-3 text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 rounded-lg transition cursor-pointer"
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  )}

                  {/* Actions for CALLED status */}
                  {(isCalled || q.can_start_consultation) && (
                    <div className="flex flex-col gap-1.5">
                      <div className="grid grid-cols-2 gap-2">
                        {q.can_notify_again && (
                          <button
                            disabled={isUpdating}
                            onClick={() => handleNotifyAgain(q.id)}
                            className="py-2 px-2 text-xs font-bold rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 shadow-xs transition cursor-pointer inline-flex items-center justify-center gap-1"
                          >
                            <FiBell size={13} />
                            <span>Recall</span>
                          </button>
                        )}
                        {q.can_start_consultation && (
                          <button
                            disabled={isUpdating}
                            onClick={() => handleStartConsultation(q)}
                            className="py-2 px-2 text-xs font-bold rounded-lg bg-[#126868] hover:bg-[#0e5252] text-white shadow-xs transition cursor-pointer inline-flex items-center justify-center gap-1"
                          >
                            <FiActivity size={13} />
                            <span>Start Consult</span>
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenWorkspace(q)}
                          className="flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg bg-[#254d90]/10 hover:bg-[#254d90]/20 text-[#254d90] transition cursor-pointer inline-flex items-center justify-center gap-1"
                        >
                          <FiActivity size={12} />
                          <span>Open Workspace</span>
                        </button>
                        {q.can_skip && (
                          <button
                            disabled={isUpdating}
                            onClick={() => handleSkipPatient(q.id)}
                            className="py-1.5 px-3 text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 rounded-lg transition cursor-pointer"
                          >
                            Skip
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions for IN_CONSULTATION status */}
                  {isInConsult && (
                    <div className="flex flex-col gap-1.5">
                      {q.can_finish_and_call_next && (
                        <button
                          disabled={isUpdating}
                          onClick={() => handleFinishAndCallNext(q.id, q.cabin)}
                          className="w-full py-2.5 px-3 text-xs font-bold rounded-lg bg-[#254d90] hover:bg-[#1b3a6d] text-white shadow-xs transition cursor-pointer inline-flex items-center justify-center gap-1.5"
                        >
                          <FiZap size={14} className="text-amber-300" />
                          <span>Finish &amp; Call Next</span>
                        </button>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {q.can_finish && (
                          <button
                            disabled={isUpdating}
                            onClick={() => handleFinishConsultation(q.id)}
                            className="py-2 px-2 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer inline-flex items-center justify-center gap-1"
                          >
                            <FiCheckCircle size={13} className="text-emerald-600" />
                            <span>Finish</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenWorkspace(q)}
                          className="py-2 px-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer inline-flex items-center justify-center gap-1"
                        >
                          <FiActivity size={12} />
                          <span>Workspace</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Actions for COMPLETED status */}
                  {isCompleted && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded font-semibold inline-flex items-center gap-1">
                        <FiCheckCircle size={12} />
                        <span>Completed Checkup</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenWorkspace(q)}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer inline-flex items-center gap-1"
                        >
                          <FiFolder size={11} />
                          <span>EMR</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/billing?patient_id=${q.patient_id}&appointment_id=${q.appointment_id}`)}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition cursor-pointer inline-flex items-center gap-1"
                        >
                          <span>Bill</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Skipped status */}
                  {isSkipped && (
                    <div className="text-xs text-slate-400 italic py-1">
                      Patient was skipped in queue.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile / Cards Pagination Control */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs mt-3.5">
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
        </div>
      </div>
    </>
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
