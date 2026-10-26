import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FiCalendar,
  FiSearch,
  FiCheckCircle,
  FiXCircle,
  FiClock,
  FiPhone,
  FiUser,
  FiFileText,
  FiUsers,
  FiUserCheck,
  FiPlus,
  FiFilter,
  FiDollarSign,
  FiActivity,
  FiRotateCw,
  FiExternalLink,
  FiCheck,
  FiPrinter,
  FiDownload,
  FiSend,
  FiChevronLeft,
  FiChevronRight
} from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import AppointmentEntryForm from "./entry/AppointmentEntryForm";
import SearchBar from "./common/SearchBar";
import Pagination from "./common/Pagination";
import AppointmentSlipModal from "./common/AppointmentSlipModal";
import RescheduleModal from "./common/RescheduleModal";
import CollectPaymentModal from "./common/CollectPaymentModal";
import { useToast } from "../context/ToastContext";
import {
  fetchAppointments,
  updateAppointmentStatus,
  fetchDoctors,
  checkInPatient,
  fetchStats,
  sendWhatsAppMessage,
  fetchClinics,
} from "../api";

export default function AppointmentsView({ onOpenBookModal }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [printModalAppt, setPrintModalAppt] = useState(null);
  const [rescheduleModalAppt, setRescheduleModalAppt] = useState(null);
  const [collectPaymentAppt, setCollectPaymentAppt] = useState(null);
  const [sendingWhatsAppId, setSendingWhatsAppId] = useState(null);
  const [searchParams] = useSearchParams();
  const searchParam = searchParams.get("search") || "";

  // Date helpers for Quick Filter Pills
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const getTomorrowStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Sub-section Tab Filter (Matches Consultations View design: open | completed | cancelled | all)
  const [appointmentTab, setAppointmentTab] = useState("open");

  // Filters
  const [search, setSearch] = useState(searchParam);
  const [clinicFilter, setClinicFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  // Pagination (20 entries per page default from LRS)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Table Scroll Controls
  const tableContainerRef = useRef(null);

  const handleScrollLeft = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: -450, behavior: "smooth" });
    }
  };

  const handleScrollRight = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: 450, behavior: "smooth" });
    }
  };

  // Sort appointments according to arrival and proximity to current check-in time
  const sortedAppointments = useMemo(() => {
    if (!appointments || appointments.length === 0) return [];

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const nowTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    return [...appointments].sort((a, b) => {
      const dateA = a.appointment_date || a.date || "";
      const dateB = b.appointment_date || b.date || "";
      const timeA = a.start_time || "";
      const timeB = b.start_time || "";

      // Priority grouping:
      // 0: Today's appointments whose arrival slot has arrived or passed (time <= nowTimeStr) -> ON TOP
      // 1: Today's upcoming appointments in arrival order
      // 2: Past dates (overdue backlog) -> most recent past date first, then arrival time
      // 3: Future dates (tomorrow and beyond) -> chronological date order, then arrival time
      const getPriority = (d, t) => {
        if (d === todayStr) {
          return t <= nowTimeStr ? 0 : 1;
        }
        if (d < todayStr) return 2;
        return 3;
      };

      const pA = getPriority(dateA, timeA);
      const pB = getPriority(dateB, timeB);

      if (pA !== pB) return pA - pB;

      if (pA === 0 || pA === 1) {
        return timeA.localeCompare(timeB);
      }
      if (pA === 2) {
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return timeA.localeCompare(timeB);
      }
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return timeA.localeCompare(timeB);
    });
  }, [appointments]);

  // Tab Counts for Header Badges
  const openCount = useMemo(() => {
    return (appointments || []).filter((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED").length;
  }, [appointments]);

  const completedCount = useMemo(() => {
    return (appointments || []).filter((a) => a.status === "COMPLETED").length;
  }, [appointments]);

  const cancelledCount = useMemo(() => {
    return (appointments || []).filter((a) => a.status === "CANCELLED").length;
  }, [appointments]);

  const totalCount = (appointments || []).length;

  // Filter appointments according to active sub-section tab
  const tabFilteredAppointments = useMemo(() => {
    return sortedAppointments.filter((a) => {
      if (appointmentTab === "open") {
        return a.status !== "COMPLETED" && a.status !== "CANCELLED";
      }
      if (appointmentTab === "completed") {
        return a.status === "COMPLETED";
      }
      if (appointmentTab === "cancelled") {
        return a.status === "CANCELLED";
      }
      return true; // "all"
    });
  }, [sortedAppointments, appointmentTab]);

  const paginatedAppointments = useMemo(() => {
    if (pageSize === "all") return tabFilteredAppointments;
    const start = (currentPage - 1) * pageSize;
    return tabFilteredAppointments.slice(start, start + pageSize);
  }, [tabFilteredAppointments, currentPage, pageSize]);

  const loadData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const [apptsData, docsData, statsData, clinicsData] = await Promise.all([
        fetchAppointments({
          search,
          status: "", // Fetch all to power instant sub-section tab counters & zero-latency tab switching
          clinic_id: clinicFilter || undefined,
          doctor_id: doctorFilter || undefined,
          source: sourceFilter || undefined,
          date: dateFilter || undefined,
        }),
        fetchDoctors(true),
        fetchStats().catch(() => null),
        fetchClinics().catch(() => []),
      ]);
      setAppointments(apptsData.appointments || []);
      setDoctors(docsData || []);
      setClinics(clinicsData || []);
      setStats(statsData);
    } catch (err) {
      if (!isBackground) console.error("Failed to load appointments:", err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    if (searchParam && searchParam !== search) {
      setSearch(searchParam);
    }
    loadData();

    // Auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      loadData(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [appointmentTab, clinicFilter, doctorFilter, sourceFilter, dateFilter, searchParam]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadData();
  };

  const handleStatusChange = async (id, newStatus) => {
    setUpdatingId(id);
    try {
      await updateAppointmentStatus(id, newStatus);
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      );
      showToast(`Appointment status changed to ${newStatus}`, "info");
    } catch (err) {
      showToast(err.message || "Could not update status", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCheckInQueue = async (appt) => {
    try {
      const res = await checkInPatient(appt.id);
      showToast(res.message || `Patient checked into queue! Token: #${res.token_number}`, "success");
      if (res.token_number) {
        setAppointments((prev) =>
          prev.map((a) =>
            a.id === appt.id
              ? {
                  ...a,
                  queue_token: res.token_number,
                  queue_status: res.status || "WAITING",
                  queue_cabin: res.cabin || "Cabin 1"
                }
              : a
          )
        );
      }
    } catch (err) {
      showToast(err.message || "Could not check in patient to queue", "error");
    }
  };

  const handleSendWhatsAppNotification = async (appt) => {
    const phone = appt.patient_phone;
    if (!phone) {
      showToast("Patient does not have a recorded phone number.", "warning");
      return;
    }
    setSendingWhatsAppId(appt.id);
    try {
      const tokenMsg = appt.queue_token ? ` Token: #${String(appt.queue_token).padStart(2, "0")}.` : "";
      const msg = `Hello ${appt.patient_name}, this is a reminder for your upcoming OPD appointment with ${appt.doctor_name || "Doctor"} on ${appt.appointment_date || appt.date} at ${appt.formatted_time || appt.start_time} at Aerostate Clinic.${tokenMsg} For queries or rescheduling, call +91 98765 43210.`;

      await sendWhatsAppMessage(phone, msg);
      showToast(`WhatsApp appointment notification sent to ${phone}!`, "success");
    } catch (err) {
      showToast(err.message || "Failed to deliver WhatsApp reminder.", "error");
    } finally {
      setSendingWhatsAppId(null);
    }
  };

  const handleExportCSV = () => {
    if (!appointments || appointments.length === 0) {
      showToast("No appointment records to export", "warning");
      return;
    }

    const headers = [
      "Ref Code",
      "Patient UID",
      "Patient Name",
      "Gender",
      "Age",
      "Blood Group",
      "Phone",
      "Aadhaar Number",
      "Doctor",
      "Specialization",
      "Cabin / Room",
      "Visit Type",
      "Payment Status",
      "Payment Method",
      "Paid Amount",
      "Appointment Date",
      "Time Slot",
      "Entry Date",
      "Entry Time",
      "Source",
      "Status",
      "Queue Token",
      "Queue Status",
      "Notes"
    ];

    const rows = sortedAppointments.map((a) => [
      `APT-${String(a.id).padStart(4, "0")}`,
      a.patient_uid || `PAT-${String(a.patient_id).padStart(4, "0")}`,
      `"${(a.patient_name || "").replace(/"/g, '""')}"`,
      a.gender || "",
      a.age ?? "",
      a.blood_group || "",
      a.patient_phone || "",
      a.aadhaar_number || "",
      `"${(a.doctor_name || "").replace(/"/g, '""')}"`,
      `"${(a.doctor_specialty || "").replace(/"/g, '""')}"`,
      `"${(a.cabin || a.queue_cabin || "").replace(/"/g, '""')}"`,
      `"${(a.visit_type || "New Consultation").replace(/"/g, '""')}"`,
      a.payment_status || "PENDING",
      a.payment_method || "Cash",
      a.paid_amount ?? "",
      a.appointment_date || a.date || "",
      a.formatted_time || a.start_time || "",
      a.entry_date || (a.created_at ? a.created_at.slice(0, 10) : a.appointment_date || ""),
      a.entry_time || "",
      a.source || "Direct",
      a.status || "",
      a.queue_token ? `#${String(a.queue_token).padStart(2, "0")}` : "",
      a.queue_status || "",
      `"${(a.notes || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `appointments_${dateFilter || "all"}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${appointments.length} appointments to CSV!`, "success");
  };

  const clearFilters = () => {
    setSearch("");
    setAppointmentTab("open");
    setClinicFilter("");
    setDoctorFilter("");
    setSourceFilter("");
    setDateFilter("");
  };

  const hasActiveFilters = Boolean(
    search || (appointmentTab && appointmentTab !== "open") || clinicFilter || doctorFilter || sourceFilter || dateFilter
  );

  // Stats calculation
  const totalInList = appointments.length;
  const totalToday = totalInList;
  const confirmedCount = appointments.filter((a) => a.status === "CONFIRMED").length;
  const confirmedToday = confirmedCount;
  const totalPatients = stats?.kpis?.registered_patients?.value ?? stats?.total_patients ?? 4;
  const activeSpecialists = doctors.length || stats?.kpis?.active_doctors?.value || 1;

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="OPD & APPOINTMENT OPERATIONS"
        title="Appointment Entry"
        icon={FiCalendar}
        rightAction={
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="portal-refresh-btn"
            title="Refresh Appointments Data"
          >
            <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
          </button>
        }
      />

      {/* Synchronized Stats Grid */}
      <div className="dir-stats-grid">
        <StatCard
          title="Open Appointments"
          value={openCount}
          Icon={FiClock}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Confirmed Bookings"
          value={confirmedCount}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Registered Patients"
          value={totalPatients}
          Icon={FiUsers}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Doctors on Duty"
          value={activeSpecialists}
          Icon={FiUserCheck}
          colorTheme="brand-teal"
        />
      </div>

      {/* Unified Create Appointment Entry Card */}
      <AppointmentEntryForm onCreated={loadData} />

      {/* Standard LRS Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            appointmentTab === "open"
              ? "Open Patient Appointments"
              : appointmentTab === "completed"
              ? "Completed Patient Appointments"
              : appointmentTab === "cancelled"
              ? "Cancelled Appointments"
              : "All Patient Appointments"
          }
          description={
            appointmentTab === "open"
              ? "Open appointments awaiting doctor consultation. Completed visits are automatically archived."
              : appointmentTab === "completed"
              ? "Record of completed clinical checkups and finalized consultations."
              : appointmentTab === "cancelled"
              ? "Record of appointments cancelled by patient on WhatsApp or by reception staff."
              : "Audit log of all patient appointment entries across all channels and statuses."
          }
          badgeCount={tabFilteredAppointments.length}
          badgeLabel={
            appointmentTab === "open"
              ? "open appointments"
              : appointmentTab === "completed"
              ? "completed checkups"
              : appointmentTab === "cancelled"
              ? "cancelled"
              : "total appointments"
          }
        />

        {/* 3 Sub-Section Tabs (Open, Completed, Cancelled + All) styled like Consultations Active Encounters */}
        <div className="wa-tabs-container">
          <button
            type="button"
            onClick={() => {
              setAppointmentTab("open");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${appointmentTab === "open" ? "active" : ""}`}
          >
            <FiActivity size={15} />
            <span>Open Bookings ({openCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAppointmentTab("completed");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${appointmentTab === "completed" ? "active" : ""}`}
          >
            <FiCheckCircle size={15} />
            <span>Completed Bookings ({completedCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAppointmentTab("cancelled");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${appointmentTab === "cancelled" ? "active" : ""}`}
          >
            <FiXCircle size={15} />
            <span>Cancelled Bookings ({cancelledCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAppointmentTab("all");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${appointmentTab === "all" ? "active" : ""}`}
          >
            <FiFileText size={15} />
            <span>All Bookings ({totalCount})</span>
          </button>
        </div>

        {/* CONTROLS & TOOLBAR (Compact 34px size) */}
        <div className="dir-controls" style={{ padding: "8px 14px", flexWrap: "wrap", gap: "8px" }}>
          <SearchBar
            placeholder="Search patient, phone, UID, Aadhaar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={handleSearchSubmit}
          />

          {/* Quick Date Selector Pills */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5" style={{ height: "34px" }}>
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className={`transition cursor-pointer rounded-md font-medium ${
                dateFilter === ""
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              style={{ fontSize: "12.5px", height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center" }}
            >
              All Dates
            </button>
            <button
              type="button"
              onClick={() => setDateFilter(getTodayStr())}
              className={`transition cursor-pointer rounded-md font-medium ${
                dateFilter === getTodayStr()
                  ? "bg-[#126868] text-white shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              style={{ fontSize: "12.5px", height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center" }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setDateFilter(getTomorrowStr())}
              className={`transition cursor-pointer rounded-md font-medium ${
                dateFilter === getTomorrowStr()
                  ? "bg-[#254d90] text-white shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              style={{ fontSize: "12.5px", height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center" }}
            >
              Tomorrow
            </button>
          </div>

          <div className="dir-toolbar-right" style={{ gap: "8px", flexWrap: "wrap" }}>
            {clinics && clinics.length > 0 && (
              <select
                value={clinicFilter}
                onChange={(e) => setClinicFilter(e.target.value)}
                className="dir-filter-select"
                style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
                title="Filter by Clinic Branch"
              >
                <option value="">All Clinic Branches</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            )}

            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="dir-filter-select"
              style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              title="Custom Date Filter"
            />

            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="dir-filter-select"
              style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
            >
              <option value="">All Doctors</option>
              {doctors.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                </option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="dir-filter-select"
              style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              title="Filter by Booking Channel / Source"
            >
              <option value="">All Sources</option>
              <option value="Direct">Direct (Reception)</option>
              <option value="WhatsApp">WhatsApp Bot</option>
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
                onClick={clearFilters}
                className="btn-cancel"
                style={{ width: "auto", height: "34px", padding: "0 12px", fontSize: "12.5px" }}
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer text-xs shadow-xs"
              style={{ height: "34px" }}
              title="Export appointments to CSV spreadsheet"
            >
              <FiDownload size={13} className="text-[#126868]" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Data Grid Table with side scroll and uniform font size */}
        {loading ? (
          <div className="flex items-center justify-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]" />
          </div>
        ) : appointments.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-slate-200">
            <FiCalendar className="mx-auto h-10 w-10 text-slate-300 mb-2" />
            <p className="font-semibold text-sm">No appointment records found</p>
            <p className="text-xs text-slate-400 mt-1">
              {hasActiveFilters ? "Try clearing search or filter selections." : "Create an entry above to record your first appointment."}
            </p>
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header" style={{ justifyContent: "flex-end", padding: "6px 14px" }}>
              <div className="dir-scroll-actions">
                <button
                  type="button"
                  className="dir-scroll-arrow-btn"
                  onClick={handleScrollLeft}
                  title="Scroll Table Left"
                >
                  <FiChevronLeft size={13} />
                  <span>Scroll Left</span>
                </button>
                <button
                  type="button"
                  className="dir-scroll-arrow-btn"
                  onClick={handleScrollRight}
                  title="Scroll Table Right"
                >
                  <span>Scroll Right</span>
                  <FiChevronRight size={13} />
                </button>
              </div>
            </div>

            <div
              ref={tableContainerRef}
              className="data-grid-container"
              style={{
                border: "none",
                borderRadius: 0,
                boxShadow: "none",
                overflowX: "auto",
                overflowY: "hidden",
                WebkitOverflowScrolling: "touch",
                width: "100%",
              }}
            >
              <table
                className="data-grid-table"
                style={{
                  minWidth: "2325px",
                  width: "2325px",
                  tableLayout: "fixed",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ width: "90px", minWidth: "90px", fontSize: "12px", whiteSpace: "nowrap" }}>REF #</th>
                    <th style={{ width: "130px", minWidth: "130px", fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT UID</th>
                    <th style={{ width: "220px", minWidth: "220px", fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT NAME</th>
                    <th style={{ width: "80px", minWidth: "80px", fontSize: "12px", whiteSpace: "nowrap" }}>GENDER</th>
                    <th style={{ width: "75px", minWidth: "75px", fontSize: "12px", whiteSpace: "nowrap" }}>AGE</th>
                    <th style={{ width: "75px", minWidth: "75px", fontSize: "12px", whiteSpace: "nowrap" }}>BLOOD</th>
                    <th style={{ width: "130px", minWidth: "130px", fontSize: "12px", whiteSpace: "nowrap" }}>PHONE</th>
                    <th style={{ width: "140px", minWidth: "140px", fontSize: "12px", whiteSpace: "nowrap" }}>AADHAAR NO</th>
                    <th style={{ width: "135px", minWidth: "135px", fontSize: "12px", whiteSpace: "nowrap" }}>VISIT & SOURCE</th>
                    <th style={{ width: "115px", minWidth: "115px", fontSize: "12px", whiteSpace: "nowrap" }}>APPT DATE</th>
                    <th style={{ width: "125px", minWidth: "125px", fontSize: "12px", whiteSpace: "nowrap" }}>TIME SLOT</th>
                    <th style={{ width: "115px", minWidth: "115px", fontSize: "12px", whiteSpace: "nowrap" }}>ENTRY DATE</th>
                    <th style={{ width: "105px", minWidth: "105px", fontSize: "12px", whiteSpace: "nowrap" }}>ENTRY TIME</th>
                    <th style={{ width: "220px", minWidth: "220px", fontSize: "12px", whiteSpace: "nowrap" }}>DOCTOR & ROOM</th>
                    <th style={{ width: "220px", minWidth: "220px", fontSize: "12px", whiteSpace: "nowrap" }}>STATUS & PAYMENT</th>
                    <th style={{ width: "350px", minWidth: "350px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "14px" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedAppointments.map((appt) => {
                    const isUpdating = updatingId === appt.id;
                    const refCode = `APT-${String(appt.id).padStart(4, "0")}`;

                    return (
                      <tr key={appt.id}>
                        {/* 1. REF # */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                            {refCode}
                          </span>
                        </td>

                        {/* 2. PATIENT UID */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-semibold text-slate-700">
                            {appt.patient_uid || `PAT-${String(appt.patient_id).padStart(4, "0")}`}
                          </span>
                        </td>

                        {/* 3. PATIENT NAME */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900">{appt.patient_name}</span>
                            {appt.notes && (
                              <span
                                className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-amber-900 bg-amber-50/90 border border-amber-200/80 px-1.5 py-0.5 rounded max-w-[210px] truncate"
                                title={`Reason / Clinical Note: ${appt.notes}`}
                              >
                                💬 {appt.notes}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 4. GENDER */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          {appt.gender && appt.gender !== "Unspecified" ? (
                            <span className="px-2 py-0.5 rounded font-semibold text-[11px] bg-slate-100 text-slate-800 border border-slate-200">
                              {appt.gender}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* 5. AGE */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          {appt.age != null && appt.age !== "" ? (
                            <span className="font-mono text-slate-800 font-medium">
                              {appt.age} yrs
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* 6. BLOOD GROUP */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          {appt.blood_group ? (
                            <span className="font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded text-[11px]">
                              {appt.blood_group}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* 7. PHONE */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex items-center space-x-1.5 font-mono text-slate-700">
                            <FiPhone className="w-3 h-3 text-[#126868]" />
                            <span>{(appt.patient_phone || "").replace(/^\+?91/, "")}</span>
                          </div>
                        </td>

                        {/* 8. AADHAAR NO */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          {appt.aadhaar_number ? (
                            <span className="font-mono text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {appt.aadhaar_number}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* 9. VISIT & SOURCE */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold border ${
                                (appt.source || "").toLowerCase().includes("whatsapp")
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                              }`}
                              style={{ fontSize: "11px" }}
                            >
                              {(appt.source || "").toLowerCase().includes("whatsapp") ? "WhatsApp" : "Direct"}
                            </span>
                            {appt.visit_type && (
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                  appt.visit_type === "Follow-up Visit"
                                    ? "bg-teal-50 text-teal-800 border-teal-200"
                                    : appt.visit_type === "Emergency / Urgent"
                                    ? "bg-rose-50 text-rose-800 border-rose-200"
                                    : "bg-slate-100 text-slate-700 border-slate-200"
                                }`}
                              >
                                {appt.visit_type}
                              </span>
                            )}
                            {appt.clinic_name && (
                              <span className="text-[10px] text-slate-500 font-medium" title={`Clinic Branch: ${appt.clinic_name}`}>
                                🏥 {appt.clinic_name}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 10. APPT DATE */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-700">
                            {appt.appointment_date || appt.date || "—"}
                          </span>
                        </td>

                        {/* 11. TIME SLOT */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex flex-col gap-1 items-start">
                            <div className="flex items-center space-x-1 font-mono text-slate-700">
                              <FiClock className="w-3 h-3 text-slate-400" />
                              <span>{appt.formatted_time || appt.start_time || "—"}</span>
                            </div>
                            {(() => {
                              const isToday = (appt.appointment_date || appt.date) === getTodayStr();
                              const nowTime = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
                              if (isToday && (appt.start_time || "") <= nowTime && appt.status === "CONFIRMED" && !appt.queue_token) {
                                return (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
                                    Due for Check-in
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </td>

                        {/* 12. ENTRY DATE */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-slate-700">
                            {appt.entry_date || (appt.created_at ? appt.created_at.slice(0, 10) : (appt.appointment_date || "—"))}
                          </span>
                        </td>

                        {/* 13. ENTRY TIME */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                            {appt.entry_time || "—"}
                          </span>
                        </td>

                        {/* 13. DOCTOR & ROOM */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900">
                                {appt.doctor_name || appt.doctor?.name || "General Practitioner"}
                              </span>
                              {(appt.cabin || appt.queue_cabin) && (
                                <span className="text-[10.5px] font-bold text-[#126868] bg-[#126868]/10 px-1.5 py-0.2 rounded border border-[#126868]/20">
                                  {appt.cabin || appt.queue_cabin}
                                </span>
                              )}
                            </div>
                            {appt.doctor_specialty && (
                              <span className="text-slate-500 font-normal text-[11px]">
                                {appt.doctor_specialty}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 14. STATUS & PAYMENT */}
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex flex-col gap-1 items-start">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {appt.status === "CONFIRMED" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  Confirmed
                                </span>
                              ) : appt.status === "IN_CONSULTATION" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                  In Consultation
                                </span>
                              ) : appt.status === "COMPLETED" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                  Completed
                                </span>
                              ) : appt.status === "CANCELLED" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                  Cancelled
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                  {appt.status}
                                </span>
                              )}

                              {appt.queue_token && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-bold font-mono bg-purple-50 text-purple-700 border border-purple-200"
                                  title={`Queue Token #${appt.queue_token}`}
                                >
                                  Token #{String(appt.queue_token).padStart(2, "0")}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                              {appt.payment_status === "PAID" ? (
                                <>
                                  <span className="font-bold text-slate-900 font-mono">
                                    ₹{appt.paid_amount ?? appt.consultation_fee ?? 500}
                                  </span>
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold border bg-emerald-50 text-emerald-800 border-emerald-200">
                                    PAID
                                  </span>
                                  {appt.payment_method && (
                                    <span className="text-[10px] text-slate-400">({appt.payment_method})</span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="font-bold text-rose-700 font-mono">
                                    ₹{appt.consultation_fee || 500}
                                  </span>
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold border bg-rose-50 text-rose-700 border-rose-200">
                                    UNPAID
                                  </span>
                                  {appt.status !== "CANCELLED" && (
                                    <button
                                      type="button"
                                      onClick={() => setCollectPaymentAppt(appt)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#126868] text-white hover:bg-[#0e5252] shadow-xs transition cursor-pointer"
                                      title="Collect Consultation Fee at Reception"
                                    >
                                      <FiDollarSign size={10} />
                                      <span>Collect Fee</span>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 15. ACTIONS: 3 Columns x 2 Rows (3x2) + 7th Single Button at End */}
                        <td style={{ fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "12px" }}>
                          <div className="flex items-center gap-1.5 flex-nowrap">
                            {/* Column 1: 2 Buttons (Check In top, Consult bottom) OR 1 prominent Consult if checked in */}
                            {appt.status === "CONFIRMED" && !appt.queue_token ? (
                              <div className="flex flex-col gap-1 w-[86px]">
                                {/* Top: Check In */}
                                <button
                                  type="button"
                                  onClick={() => handleCheckInQueue(appt)}
                                  className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-[#126868] text-white hover:bg-[#0e5252] shadow-xs transition cursor-pointer"
                                  title="Check In patient to Waiting Room Queue"
                                >
                                  <FiUserCheck size={11} />
                                  <span>Check In</span>
                                </button>
                                {/* Bottom: Consult */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const params = new URLSearchParams();
                                    if (appt.patient_id) params.set("patient_id", appt.patient_id);
                                    if (appt.doctor_id) params.set("doctor_id", appt.doctor_id);
                                    if (appt.id) params.set("appointment_id", appt.id);
                                    if (appt.patient_name) params.set("patient_name", appt.patient_name);
                                    if (appt.patient_phone) params.set("patient_phone", appt.patient_phone);
                                    navigate(`/consultations?${params.toString()}`);
                                  }}
                                  className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                  title="Open Doctor Consultation Workspace"
                                >
                                  <FiExternalLink size={11} className="text-[#254d90]" />
                                  <span>Consult</span>
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 w-[86px]">
                                {/* Already checked in / in consultation: Consult is primary full-height action */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const params = new URLSearchParams();
                                    if (appt.patient_id) params.set("patient_id", appt.patient_id);
                                    if (appt.doctor_id) params.set("doctor_id", appt.doctor_id);
                                    if (appt.id) params.set("appointment_id", appt.id);
                                    if (appt.patient_name) params.set("patient_name", appt.patient_name);
                                    if (appt.patient_phone) params.set("patient_phone", appt.patient_phone);
                                    navigate(`/consultations?${params.toString()}`);
                                  }}
                                  className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                                  title="Open Doctor Consultation Workspace"
                                >
                                  <FiExternalLink size={13} />
                                  <span>Consult</span>
                                </button>
                              </div>
                            )}

                            {/* Column 2: 2 Buttons (Slip top, Notify bottom) */}
                            <div className="flex flex-col gap-1 w-[80px]">
                              {/* Top: Slip */}
                              <button
                                type="button"
                                onClick={() => setPrintModalAppt(appt)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                title="Print OPD / Token Slip"
                              >
                                <FiPrinter size={11} className="text-slate-500" />
                                <span>Slip</span>
                              </button>
                              {/* Bottom: Notify */}
                              <button
                                type="button"
                                disabled={sendingWhatsAppId === appt.id}
                                onClick={() => handleSendWhatsAppNotification(appt)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer disabled:opacity-50"
                                title="Send WhatsApp confirmation / reminder to patient"
                              >
                                <FaWhatsapp size={11} className="text-emerald-600" />
                                <span>{sendingWhatsAppId === appt.id ? "Sending" : "Notify"}</span>
                              </button>
                            </div>

                            {/* Column 3: 2 Buttons (Complete top, Reschedule bottom) */}
                            <div className="flex flex-col gap-1 w-[92px]">
                              {/* Top: Complete */}
                              {appt.status !== "COMPLETED" && appt.status !== "CANCELLED" ? (
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleStatusChange(appt.id, "COMPLETED")}
                                  className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer disabled:opacity-50"
                                  title="Mark Appointment as Completed"
                                >
                                  <FiCheckCircle size={11} className="text-emerald-600" />
                                  <span>Complete</span>
                                </button>
                              ) : (
                                <div className="w-full h-[24px] inline-flex items-center justify-center text-[10.5px] text-slate-400 font-medium">
                                  —
                                </div>
                              )}
                              {/* Bottom: Reschedule */}
                              {appt.status !== "COMPLETED" && appt.status !== "CANCELLED" ? (
                                <button
                                  type="button"
                                  onClick={() => setRescheduleModalAppt(appt)}
                                  className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300 shadow-xs transition cursor-pointer"
                                  title="Reschedule appointment date, doctor, or time slot"
                                >
                                  <FiCalendar size={11} className="text-amber-600" />
                                  <span>Reschedule</span>
                                </button>
                              ) : (
                                <div className="w-full h-[24px] inline-flex items-center justify-center text-[10.5px] text-slate-400 font-medium">
                                  —
                                </div>
                              )}
                            </div>

                            {/* Column 4: 7th Single Button at the End (Cancel) */}
                            <div className="flex flex-col justify-center w-[74px]">
                              {appt.status !== "CANCELLED" && appt.status !== "COMPLETED" ? (
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => handleStatusChange(appt.id, "CANCELLED")}
                                  className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-semibold rounded bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 shadow-xs transition cursor-pointer disabled:opacity-50"
                                  title="Cancel Appointment"
                                >
                                  <FiXCircle size={14} className="text-rose-500" />
                                  <span>Cancel</span>
                                </button>
                              ) : (
                                <div className="w-full h-[52px] flex items-center justify-center text-xs text-slate-400 italic">
                                  —
                                </div>
                              )}
                            </div>
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
            totalItems={tabFilteredAppointments.length}
            pageSize={pageSize}
            onPageChange={(p) => setCurrentPage(p)}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setCurrentPage(1);
            }}
            pageSizeOptions={[10, 20, 50, 100]}
            itemLabel="appointments"
          />

          <div className="dir-scroll-bar-footer">
            <span className="text-xs text-slate-500 font-medium">
              Audit log of patient appointment entries. Search, filter, or manage check-ins.
            </span>
          </div>
        </div>
      )}
    </section>

    {/* Printable OPD Appointment Slip Modal */}
    {printModalAppt && (
      <AppointmentSlipModal
        appointment={printModalAppt}
        onClose={() => setPrintModalAppt(null)}
      />
    )}

    {/* Reschedule Appointment Modal */}
    {rescheduleModalAppt && (
      <RescheduleModal
        appointment={rescheduleModalAppt}
        doctors={doctors}
        onClose={() => setRescheduleModalAppt(null)}
        onSuccess={(res) => {
          showToast(res.message || "Appointment successfully rescheduled!", "success");
          loadData();
        }}
      />
    )}

    {/* Collect Payment Modal (At Clinic Visit) */}
    {collectPaymentAppt && (
      <CollectPaymentModal
        appointment={collectPaymentAppt}
        onClose={() => setCollectPaymentAppt(null)}
        onSuccess={(updated) => {
          setAppointments((prev) =>
            prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
          );
          showToast(
            `Payment of ₹${updated.paid_amount} collected successfully via ${updated.payment_method}!`,
            "success"
          );
        }}
      />
    )}
  </div>
  );
}
