import React, { useEffect, useState } from "react";
import {
  FiClock,
  FiCheckCircle,
  FiUsers,
  FiUserCheck,
  FiActivity,
  FiRotateCw,
  FiMessageCircle,
  FiPlus,
  FiCalendar,
  FiArrowRight,
  FiXCircle,
  FiFileText,
  FiTrendingUp,
  FiSearch,
  FiAlertTriangle,
  FiBox,
  FiLayers,
  FiCheck,
  FiUserPlus,
  FiEye,
} from "react-icons/fi";
import { FaRupeeSign, FaWhatsapp } from "react-icons/fa";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import {
  fetchStats,
  fetchAppointments,
  fetchBillingStats,
  fetchQueue,
  fetchCabins,
  fetchPharmacyStats,
  fetchLabStats,
  fetchConsultationStats,
  checkInPatient,
} from "../api";

export default function DashboardView({ onNavigate, onOpenBookModal }) {
  const [stats, setStats] = useState(null);
  const [todayAppts, setTodayAppts] = useState([]);
  const [billingStats, setBillingStats] = useState(null);
  const [queueStats, setQueueStats] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [pharmacyStats, setPharmacyStats] = useState(null);
  const [labStats, setLabStats] = useState(null);
  const [consultationStats, setConsultationStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Table filtering & view toggles
  const [scheduleTab, setScheduleTab] = useState("today"); // "today" | "recent"
  const [sourceFilter, setSourceFilter] = useState("ALL"); // "ALL" | "WHATSAPP" | "DIRECT"
  const [searchQuery, setSearchQuery] = useState("");
  const [checkingInId, setCheckingInId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const loadData = async () => {
    try {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      const [
        statsData,
        apptsData,
        billData,
        queueData,
        cabinsData,
        pharmData,
        labData,
        consultData,
      ] = await Promise.all([
        fetchStats().catch(() => null),
        fetchAppointments({ date: todayStr }).catch(() => ({ appointments: [] })),
        fetchBillingStats().catch(() => null),
        fetchQueue().catch(() => null),
        fetchCabins().catch(() => []),
        fetchPharmacyStats().catch(() => null),
        fetchLabStats().catch(() => null),
        fetchConsultationStats().catch(() => null),
      ]);

      setStats(statsData);
      setTodayAppts(apptsData?.appointments || []);
      setBillingStats(billData);
      setQueueStats(queueData);
      setCabins(Array.isArray(cabinsData) ? cabinsData : []);
      setPharmacyStats(pharmData);
      setLabStats(labData);
      setConsultationStats(consultData);
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Auto-refresh every 10 seconds across portal
    const interval = setInterval(() => {
      loadData();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleCheckIn = async (appt) => {
    try {
      setCheckingInId(appt.id);
      const cabinName = appt.cabin || "Cabin 1";
      await checkInPatient(appt.id, cabinName);
      showToast(`Token generated for ${appt.patient_name} in ${cabinName}`);
      await loadData();
    } catch (err) {
      showToast(err.message || "Failed to check in patient");
    } finally {
      setCheckingInId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
      </div>
    );
  }

  // Backend pre-calculated metrics & breakdowns
  const kpis = stats?.kpis;
  const breakdown = stats?.breakdown;
  const recentMessages = stats?.recent_messages || [];
  const recentAppointments = stats?.recent_appointments || [];

  // Determine active appointments to display based on tab
  const baseAppts = scheduleTab === "today" ? todayAppts : recentAppointments;

  // Filter by source and search query
  const filteredAppts = baseAppts.filter((appt) => {
    if (sourceFilter === "WHATSAPP" && (appt.source || "").toLowerCase() !== "whatsapp") {
      return false;
    }
    if (sourceFilter === "DIRECT" && (appt.source || "").toLowerCase() === "whatsapp") {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = (appt.patient_name || "").toLowerCase();
      const phone = (appt.patient_phone || "").toLowerCase();
      const doc = (appt.doctor_name || "").toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !doc.includes(q)) {
        return false;
      }
    }
    return true;
  });

  // Calculate live cabin counts
  const occupiedCabinsCount = cabins.filter((c) => c.is_occupied).length;
  const totalCabinsCount = cabins.length > 0 ? cabins.length : 2;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 bg-[#0f172a] text-white rounded-xl shadow-lg border border-slate-700 text-sm font-medium animate-in fade-in slide-in-from-top-3">
          <FiCheck className="text-emerald-400" size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Signature AeroState Portal Header */}
      <PortalHeader
        kicker="Overview"
        title="Clinic Operations & WhatsApp Automation"
        icon={FiActivity}
        isDashboard={true}
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="portal-refresh-btn"
              title="Refresh Data"
            >
              <FiRotateCw className={`refresh-icon ${refreshing ? "spinning" : ""}`} size={16} />
            </button>

            <button
              onClick={onOpenBookModal}
              className="portal-action-btn text-sm font-semibold"
            >
              <FiPlus size={16} />
              <span>New Appointment Entry</span>
            </button>
          </div>
        }
      />

      {/* Section 1: Executive KPI Cards Grid */}
      <div className="dir-stats-grid">
        <StatCard
          title="Today's Appointments"
          value={kpis?.today_appointments?.value ?? todayAppts.length}
          Icon={FiCalendar}
          colorTheme="brand-blue"
          trend={kpis?.today_appointments?.trend || `${todayAppts.length} today`}
        />
        <StatCard
          title="Live OPD Queue"
          value={`${queueStats?.waiting_count ?? 0} Waiting`}
          Icon={FiClock}
          colorTheme="brand-teal"
          trend={`${queueStats?.in_consultation_count ?? 0} In Cabin`}
        />
        <StatCard
          title="Today's Collections"
          value={`₹${(billingStats?.today_revenue ?? 0).toLocaleString("en-IN")}`}
          Icon={FaRupeeSign}
          colorTheme="brand-blue"
          trend={
            billingStats?.pending_amount > 0
              ? `₹${Number(billingStats.pending_amount).toLocaleString("en-IN")} pending`
              : "All settled"
          }
        />
        <StatCard
          title="Specialists on Duty"
          value={kpis?.active_doctors?.value ?? stats?.active_doctors ?? 0}
          Icon={FiUserCheck}
          colorTheme="brand-teal"
          trend={`${occupiedCabinsCount} / ${totalCabinsCount} cabins busy`}
        />
      </div>

      {/* Section 2: Live Doctor & Cabin Status Tracker */}
      <div className="lrs-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900 m-0 flex items-center gap-2">
              <FiUserCheck className="text-[#126868]" size={19} />
              <span>Doctor Cabins & Room Occupancy</span>
            </h3>
            <p className="text-sm text-slate-500 m-0 mt-0.5">
              Live consultation room occupancy, attending specialists, and patient flow
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {totalCabinsCount - occupiedCabinsCount} Available
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm font-bold bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              {occupiedCabinsCount} In Consult
            </span>
            <button
              onClick={() => onNavigate("queue")}
              className="text-xs sm:text-sm font-bold text-[#254d90] hover:text-[#1e3f78] flex items-center gap-1 ml-1 cursor-pointer"
            >
              <span>Manage Cabins</span>
              <FiArrowRight size={14} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cabins.length === 0 ? (
            <div className="col-span-full text-center py-6 text-sm text-slate-400 italic">
              No cabins registered yet. Configure consultation cabins in Queue Settings.
            </div>
          ) : (
            cabins.map((cabin) => {
              const isOccupied = cabin.occupancy_status === "IN_CONSULTATION";
              const isCalled = cabin.occupancy_status === "CALLED";
              const isAvailable = cabin.occupancy_status === "AVAILABLE" || (!isOccupied && !isCalled);

              return (
                <div
                  key={cabin.id}
                  className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                    isOccupied
                      ? "bg-amber-50/40 border-amber-200 shadow-sm"
                      : isCalled
                      ? "bg-blue-50/40 border-blue-200 shadow-sm"
                      : "bg-slate-50/60 border-slate-200/90 hover:border-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-900 text-base">{cabin.name}</span>
                      {isOccupied && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          In Consult
                        </span>
                      )}
                      {isCalled && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
                          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          Called
                        </span>
                      )}
                      {isAvailable && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          Available
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 font-medium truncate m-0">
                      {cabin.department || "General Consultation"}
                    </p>

                    <div className="mt-3.5 pt-3 border-t border-slate-200/70">
                      {isOccupied ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs sm:text-sm font-mono font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded">
                              #{String(cabin.current_token || "01").padStart(2, "0")}
                            </span>
                            <span className="text-sm font-bold text-slate-900 truncate">
                              {cabin.current_patient || "Patient in cabin"}
                            </span>
                          </div>
                        </div>
                      ) : isCalled ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs sm:text-sm font-mono font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded">
                              #{String(cabin.current_token || "01").padStart(2, "0")}
                            </span>
                            <span className="text-sm font-bold text-slate-900 truncate">
                              {cabin.current_patient || "Patient called"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs sm:text-sm text-slate-600 flex items-center justify-between">
                          <span className="font-medium">Ready for patient</span>
                          <span className="font-bold text-slate-800">
                            {cabin.today_completed || 0} seen
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3.5">
                    {isOccupied || isCalled ? (
                      <button
                        onClick={() => onNavigate("consultations")}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold text-amber-900 bg-amber-100/90 hover:bg-amber-200 transition cursor-pointer"
                      >
                        <span>Open Workspace</span>
                        <FiArrowRight size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => onNavigate("queue")}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold text-[#126868] bg-[#126868]/10 hover:bg-[#126868]/20 transition cursor-pointer"
                      >
                        <span>Assign Token</span>
                        <FiArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Section 3: Departmental Operations Hub */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Waiting Room Queue */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#126868]/40 transition bg-gradient-to-br from-white to-amber-50/20">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="p-2.5 rounded-lg bg-amber-100 text-amber-700">
                <FiClock size={18} />
              </span>
              <span className="text-xs sm:text-sm font-mono font-bold text-amber-800 bg-amber-100/80 px-2.5 py-1 rounded-full">
                {queueStats?.waiting_count ?? 0} in wait
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base sm:text-lg m-0">Live OPD Queue</h4>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 m-0">
              {queueStats?.next_waiting
                ? `Next: ${queueStats.next_waiting.token_display} (${queueStats.next_waiting.patient_name})`
                : "Reception tokens & cabin dispatch flow"}
            </p>
          </div>
          <button
            onClick={() => onNavigate("queue")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg text-xs sm:text-sm font-bold text-amber-900 bg-amber-100/70 hover:bg-amber-100 transition cursor-pointer"
          >
            <span>Open Queue Board</span>
            <FiArrowRight size={14} />
          </button>
        </div>

        {/* Doctor Consultations */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#126868]/40 transition bg-gradient-to-br from-white to-emerald-50/20">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="p-2.5 rounded-lg bg-[#126868]/10 text-[#126868]">
                <FiFileText size={18} />
              </span>
              <span className="text-xs sm:text-sm font-mono font-bold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-full">
                {consultationStats?.completed_today ?? 0} done today
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base sm:text-lg m-0">Doctor Consultations</h4>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 m-0">
              {consultationStats?.in_consultation ?? 0} active drafts • Standard EMR & digital Rx
            </p>
          </div>
          <button
            onClick={() => onNavigate("consultations")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg text-xs sm:text-sm font-bold text-[#126868] bg-[#126868]/10 hover:bg-[#126868]/20 transition cursor-pointer"
          >
            <span>Clinical Workspace</span>
            <FiArrowRight size={14} />
          </button>
        </div>

        {/* Pharmacy & Dispensary */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#254d90]/40 transition bg-gradient-to-br from-white to-blue-50/20">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="p-2.5 rounded-lg bg-blue-100 text-[#254d90]">
                <FiBox size={18} />
              </span>
              <span className="text-xs sm:text-sm font-mono font-bold text-blue-800 bg-blue-100/80 px-2.5 py-1 rounded-full">
                {pharmacyStats?.pending_dispatch_count ?? 0} pending
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base sm:text-lg m-0">Dispensary & Pharmacy</h4>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 m-0">
              {pharmacyStats?.low_stock_count > 0 ? (
                <span className="text-amber-800 font-semibold">
                  ⚠️ {pharmacyStats.low_stock_count} item(s) below reorder level
                </span>
              ) : (
                `${pharmacyStats?.total_stock_units ?? 0} units • ${pharmacyStats?.dispensed_count ?? 0} fulfilled`
              )}
            </p>
          </div>
          <button
            onClick={() => onNavigate("pharmacy")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg text-xs sm:text-sm font-bold text-[#254d90] bg-blue-50 hover:bg-blue-100 transition cursor-pointer"
          >
            <span>Dispensary Counter</span>
            <FiArrowRight size={14} />
          </button>
        </div>

        {/* Laboratory & Diagnostics */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#126868]/40 transition bg-gradient-to-br from-white to-teal-50/20">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="p-2.5 rounded-lg bg-[#126868]/10 text-[#126868]">
                <FiActivity size={18} />
              </span>
              <span className="text-xs sm:text-sm font-mono font-bold text-[#126868] bg-[#126868]/10 px-2.5 py-1 rounded-full">
                {labStats?.pending_processing ?? 0} pending
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base sm:text-lg m-0">Diagnostics & Lab</h4>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 m-0">
              {labStats?.completed_verified ?? 0} verified • {labStats?.catalogue_tests ?? 0} active test profiles
            </p>
          </div>
          <button
            onClick={() => onNavigate("laboratory")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg text-xs sm:text-sm font-bold text-[#126868] bg-[#126868]/10 hover:bg-[#126868]/20 transition cursor-pointer"
          >
            <span>Lab Diagnostic Orders</span>
            <FiArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Section 4: Main 2-Column Command Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3 width): Today's Schedule & Recent WhatsApp Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today's Schedule Card */}
          <div className="lrs-card">
            {/* Header with Title & Quick Switchers */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900 m-0">Appointment & OPD Schedule</h2>
                <p className="text-sm text-slate-500 m-0 mt-0.5">
                  Live appointment roster with 1-click token check-in to waiting room
                </p>
              </div>
              <button
                onClick={() => onNavigate("appointments")}
                className="text-xs sm:text-sm font-bold text-[#254d90] hover:text-[#1e3f78] flex items-center gap-1.5 cursor-pointer"
              >
                <span>View Full Registry</span>
                <FiArrowRight size={15} />
              </button>
            </div>

            {/* Filter Toolbar: Tabs & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              {/* Tab Pills */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setScheduleTab("today")}
                  className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-md transition cursor-pointer ${
                    scheduleTab === "today"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Today ({todayAppts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleTab("recent")}
                  className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-md transition cursor-pointer ${
                    scheduleTab === "recent"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Recent Bookings ({recentAppointments.length})
                </button>
              </div>

              {/* Source Filter & Search */}
              <div className="flex items-center gap-2">
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="h-[36px] px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#254d90]"
                >
                  <option value="ALL">All Sources</option>
                  <option value="WHATSAPP">WhatsApp Only</option>
                  <option value="DIRECT">Direct / Walk-in</option>
                </select>

                {/* Search Box */}
                <div className="relative">
                  <FiSearch className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search patient, phone..."
                    className="h-[36px] pl-9 pr-3 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#254d90] w-48 sm:w-56"
                  />
                </div>
              </div>
            </div>

            {/* Schedule Table */}
            {filteredAppts.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <FiCalendar className="w-9 h-9 mx-auto text-slate-300 mb-2" />
                <p className="text-base font-bold text-slate-800">
                  {scheduleTab === "today"
                    ? "No appointments scheduled for today"
                    : "No matching bookings found"}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Book via WhatsApp or use the direct booking entry button
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    onClick={onOpenBookModal}
                    className="text-sm bg-[#126868] hover:bg-[#0e5252] text-white font-semibold px-4 py-2 rounded-lg cursor-pointer transition flex items-center gap-2"
                  >
                    <FiPlus size={15} />
                    <span>Book Appointment</span>
                  </button>
                  {scheduleTab === "today" && recentAppointments.length > 0 && (
                    <button
                      onClick={() => setScheduleTab("recent")}
                      className="text-sm bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold px-3.5 py-2 rounded-lg cursor-pointer transition"
                    >
                      View Recent Bookings
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="dir-table-wrapper">
                <div className="dir-scroll-bar-header">
                  <span className="dir-scroll-hint text-xs sm:text-sm font-semibold">
                    ⇄ {scheduleTab === "today" ? "Today's Patient Schedule" : "Recent Active Bookings"}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-slate-600">
                    Showing {filteredAppts.length} of {baseAppts.length} appointment{baseAppts.length === 1 ? "" : "s"}
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
                  <table className="data-grid-table" style={{ minWidth: "720px", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" }}>TIME / DATE</th>
                        <th style={{ fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" }}>PATIENT</th>
                        <th style={{ fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" }}>SPECIALIST & ROOM</th>
                        <th style={{ fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" }}>SOURCE</th>
                        <th style={{ fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap" }}>STATUS & QUEUE</th>
                        <th style={{ fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap", textAlign: "right" }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAppts.map((appt) => {
                        // Check if patient already has a live queue token today
                        const queueItem = queueStats?.queue?.find(
                          (q) =>
                            q.appointment_id === appt.id ||
                            (q.patient_phone && q.patient_phone === appt.patient_phone && q.status !== "COMPLETED")
                        );

                        return (
                          <tr key={appt.id}>
                            <td style={{ fontSize: "13px", whiteSpace: "nowrap" }}>
                              <div className="flex items-center space-x-1.5 font-mono text-slate-800 font-bold">
                                <FiClock className="w-4 h-4 text-slate-400" />
                                <span>{appt.formatted_time || appt.start_time}</span>
                              </div>
                              {scheduleTab === "recent" && appt.date && (
                                <div className="text-xs text-slate-500 font-medium mt-0.5">{appt.date}</div>
                              )}
                            </td>
                            <td style={{ fontSize: "13px", whiteSpace: "nowrap" }}>
                              <div className="font-bold text-slate-900 text-sm">{appt.patient_name}</div>
                              <div className="text-xs text-slate-500 font-mono mt-0.5 font-medium">
                                {appt.patient_phone}
                              </div>
                            </td>
                            <td style={{ fontSize: "13px", whiteSpace: "nowrap" }}>
                              <div className="font-bold text-slate-900 text-sm">{appt.doctor_name}</div>
                              <div className="text-xs text-slate-500 font-medium mt-0.5">
                                {appt.specialty || appt.doctor_specialty || "Specialist"}
                              </div>
                            </td>
                            <td style={{ fontSize: "13px", whiteSpace: "nowrap" }}>
                              {(appt.source || "").toLowerCase() === "whatsapp" ? (
                                <span
                                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs"
                                >
                                  <FaWhatsapp size={13} className="text-emerald-600" />
                                  <span>WhatsApp</span>
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200 text-xs"
                                >
                                  <span>Direct</span>
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: "13px", whiteSpace: "nowrap" }}>
                              {queueItem ? (
                                <span
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                                    queueItem.status === "IN_CONSULTATION"
                                      ? "bg-amber-100 text-amber-900 border border-amber-300"
                                      : queueItem.status === "CALLED"
                                      ? "bg-blue-100 text-blue-900 border border-blue-300"
                                      : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                                  }`}
                                >
                                  <span>Token {queueItem.token_display}</span>
                                  <span className="text-[11px] opacity-80">({queueItem.status})</span>
                                </span>
                              ) : (
                                <span
                                  className={`badge-${
                                    appt.status === "CONFIRMED"
                                      ? "active"
                                      : appt.status === "COMPLETED"
                                      ? "blue"
                                      : "inactive"
                                  } text-xs font-bold`}
                                >
                                  {appt.status}
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: "13px", whiteSpace: "nowrap", textAlign: "right" }}>
                              {queueItem ? (
                                <button
                                  onClick={() => onNavigate("queue")}
                                  className="text-xs sm:text-sm font-bold text-[#126868] hover:text-[#0e5252] cursor-pointer"
                                >
                                  View Token →
                                </button>
                              ) : appt.status === "CONFIRMED" ? (
                                <button
                                  onClick={() => handleCheckIn(appt)}
                                  disabled={checkingInId === appt.id}
                                  className="text-xs sm:text-sm px-3 py-1.5 bg-[#126868] hover:bg-[#0e5252] text-white rounded-lg font-bold transition cursor-pointer disabled:opacity-50"
                                >
                                  {checkingInId === appt.id ? "Checking in..." : "Check-in"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => onNavigate("appointments")}
                                  className="text-xs sm:text-sm font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                                >
                                  Details
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="dir-scroll-bar-footer">
                  <span className="text-xs sm:text-sm text-slate-500 font-medium">
                    Real-time synchronization of walk-in entries and automated WhatsApp patient bookings.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Recent WhatsApp Activity */}
          <div className="lrs-card">
            <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 m-0 flex items-center gap-2">
                  <FaWhatsapp className="text-emerald-600" size={18} />
                  <span>Recent WhatsApp Inquiries & Chat Logs</span>
                </h3>
                <p className="text-sm text-slate-500 m-0 mt-0.5">
                  Live incoming patient messages and Meta WhatsApp cloud automation
                </p>
              </div>
              <button
                onClick={() => onNavigate("messages")}
                className="text-xs sm:text-sm font-bold text-[#126868] hover:text-[#0f5555] flex items-center gap-1 cursor-pointer"
              >
                <span>Open WhatsApp Chats</span>
                <FiArrowRight size={14} />
              </button>
            </div>

            {recentMessages.length === 0 ? (
              <p className="text-sm text-slate-400 italic py-5 text-center">
                No WhatsApp messages logged yet. Incoming patient messages will appear here in real time.
              </p>
            ) : (
              <div className="space-y-2.5">
                {recentMessages.map((msg) => (
                  <div
                    key={msg.id}
                    onClick={() => onNavigate(`messages?phone=${encodeURIComponent(msg.phone)}`)}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100/90 transition cursor-pointer border border-slate-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-bold text-slate-900 text-sm">{msg.patient_name || "Patient"}</span>
                      <span className="text-xs text-slate-500 font-mono">({msg.phone})</span>
                      <span className="text-xs sm:text-sm text-slate-700 truncate max-w-sm">"{msg.body}"</span>
                    </div>
                    <span
                      className="text-xs text-slate-500 shrink-0 font-medium ml-2"
                      title={msg.created_at ? new Date(msg.created_at).toLocaleString() : ""}
                    >
                      {msg.created_at
                        ? (() => {
                            const d = new Date(msg.created_at);
                            if (isNaN(d.getTime())) return "";
                            const datePart = d.toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            });
                            const timePart = d.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            });
                            return `${datePart}, ${timePart}`;
                          })()
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Waiting Room Queue Roster */}
          <div className="lrs-card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-3.5 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 m-0 flex items-center gap-2">
                  <FiClock className="text-amber-600" size={18} />
                  <span>Live Waiting Room Queue Roster</span>
                </h3>
                <p className="text-sm text-slate-500 m-0 mt-0.5">
                  Patients currently waiting in the clinic lobby for consultation
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {queueStats?.waiting_count ?? 0} Waiting
                </span>
                <button
                  onClick={() => onNavigate("queue")}
                  className="text-xs sm:text-sm font-bold text-[#254d90] hover:text-[#1e3f78] flex items-center gap-1 ml-1 cursor-pointer"
                >
                  <span>Queue Board</span>
                  <FiArrowRight size={14} />
                </button>
              </div>
            </div>

            {(() => {
              const waitingList = (queueStats?.queue || []).filter(
                (q) => q.status === "WAITING" || q.status === "CALLED"
              );

              if (waitingList.length === 0) {
                return (
                  <div className="p-6 rounded-xl bg-slate-50/70 border border-dashed border-slate-200 text-center">
                    <FiClock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-700 m-0">
                      Waiting Room Lobby is Currently Clear
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {queueStats?.total_queued || 0} total tokens issued today • {queueStats?.completed_count || 0} completed
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <button
                        onClick={() => onNavigate("queue")}
                        className="px-3.5 py-1.5 bg-[#126868] hover:bg-[#0e5252] text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <FiPlus size={13} />
                        <span>Issue Queue Token</span>
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-2.5">
                  {waitingList.slice(0, 5).map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100/90 border border-slate-200/80 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="px-2.5 py-1 rounded-lg font-mono font-bold text-xs sm:text-sm bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                          {q.token_display || `#${String(q.token_number).padStart(2, "0")}`}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm truncate">
                              {q.patient_name}
                            </span>
                            {q.patient_phone && (
                              <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                                ({q.patient_phone})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 m-0 mt-0.5 truncate">
                            {q.doctor_name} • <span className="font-semibold text-slate-700">{q.cabin || "Cabin 1"}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-slate-500 hidden md:inline">
                          {q.wait_display || "Checked in"}
                        </span>
                        {q.status === "CALLED" ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-300 animate-pulse">
                            Called
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            Waiting
                          </span>
                        )}
                        <button
                          onClick={() => onNavigate("consultations")}
                          className="px-2.5 py-1 bg-white hover:bg-slate-50 text-[#126868] border border-slate-200 font-bold text-xs rounded-lg transition cursor-pointer"
                        >
                          Encounter →
                        </button>
                      </div>
                    </div>
                  ))}
                  {waitingList.length > 5 && (
                    <div className="text-center pt-1">
                      <button
                        onClick={() => onNavigate("queue")}
                        className="text-xs font-bold text-[#254d90] hover:underline cursor-pointer"
                      >
                        + View all {waitingList.length} patients in queue board →
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Clinic Infrastructure & Automation Gateway Status */}
          <div className="lrs-card p-4 bg-gradient-to-br from-white to-slate-50/70">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="text-sm font-bold text-slate-900 m-0">Clinic System & Automation Health</h3>
              </div>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                ● All Services Operational
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80">
                <span className="text-slate-500 text-[11px] font-medium block">Meta WhatsApp API</span>
                <span className="font-bold text-emerald-700 flex items-center gap-1 mt-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Live (v21.0)
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80">
                <span className="text-slate-500 text-[11px] font-medium block">Booking Automation</span>
                <span className="font-bold text-emerald-700 flex items-center gap-1 mt-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Bot Online
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80">
                <span className="text-slate-500 text-[11px] font-medium block">ABDM Health Gateway</span>
                <span className="font-bold text-[#126868] flex items-center gap-1 mt-1">
                  <span className="w-2 h-2 rounded-full bg-[#126868]" />
                  Sandbox Ready
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80">
                <span className="text-slate-500 text-[11px] font-medium block">Database & Sync</span>
                <span className="font-bold text-[#254d90] flex items-center gap-1 mt-1">
                  <span className="w-2 h-2 rounded-full bg-[#254d90]" />
                  Synced
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (1/3 width): Financials, Breakdown, Pipeline & Shortcuts */}
        <div className="space-y-6">
          {/* Financials & Revenue Collections */}
          <div className="lrs-card">
            <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 m-0">Financials & Revenue Summary</h3>
                <p className="text-sm text-slate-500 m-0 mt-0.5">Today's billing counter & collections</p>
              </div>
              <button
                onClick={() => onNavigate("billing")}
                className="text-xs sm:text-sm font-bold text-[#254d90] hover:text-[#1e3f78] flex items-center gap-1 cursor-pointer"
              >
                <span>Invoices</span>
                <FiArrowRight size={14} />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Today's Collections Hero Box */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50/50 border border-emerald-100">
                <span className="text-xs sm:text-sm font-bold text-emerald-900 uppercase tracking-wider">
                  Today's Collected Revenue
                </span>
                <div className="text-3xl font-extrabold text-emerald-900 mt-1 flex items-center gap-1">
                  <FaRupeeSign size={22} />
                  <span>{(billingStats?.today_revenue ?? 0).toLocaleString("en-IN")}</span>
                </div>
                <div className="text-xs sm:text-sm text-emerald-700 mt-1.5 font-medium">
                  {billingStats?.total_invoices ?? 0} total invoices processed
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-600 text-xs sm:text-sm font-semibold">Outstanding Due</span>
                  <div className="font-bold text-rose-700 text-base sm:text-lg mt-0.5 flex items-center gap-0.5">
                    <FaRupeeSign size={13} />
                    <span>{(billingStats?.pending_amount ?? 0).toLocaleString("en-IN")}</span>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    {billingStats?.pending_count ?? 0} unpaid bills
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-600 text-xs sm:text-sm font-semibold">Average Bill Size</span>
                  <div className="font-bold text-slate-900 text-base sm:text-lg mt-0.5 flex items-center gap-0.5">
                    <FaRupeeSign size={13} />
                    <span>{(billingStats?.average_bill ?? 0).toLocaleString("en-IN")}</span>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">Per patient ticket</span>
                </div>
              </div>
            </div>
          </div>

          {/* Booking Status Breakdown */}
          <div className="lrs-card">
            <h3 className="text-base font-bold text-slate-900 mb-3.5 m-0">Booking Status Breakdown</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-100">
                <span className="font-bold text-emerald-950 flex items-center space-x-2 text-sm">
                  <FiCheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Confirmed</span>
                </span>
                <span className="font-extrabold text-emerald-900 text-sm sm:text-base">
                  {breakdown?.confirmed_count ?? 0} ({breakdown?.confirmed_percent ?? 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-blue-50/80 border border-blue-100">
                <span className="font-bold text-blue-950 flex items-center space-x-2 text-sm">
                  <FiCheckCircle className="w-4 h-4 text-blue-600" />
                  <span>Completed</span>
                </span>
                <span className="font-extrabold text-blue-900 text-sm sm:text-base">
                  {breakdown?.completed_count ?? 0} ({breakdown?.completed_percent ?? 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-50/80 border border-rose-100">
                <span className="font-bold text-rose-950 flex items-center space-x-2 text-sm">
                  <FiXCircle className="w-4 h-4 text-rose-600" />
                  <span>Cancelled</span>
                </span>
                <span className="font-extrabold text-rose-900 text-sm sm:text-base">
                  {breakdown?.cancelled_count ?? 0} ({breakdown?.cancelled_percent ?? 0}%)
                </span>
              </div>
            </div>
          </div>

          {/* Clinical Care Pipeline & Inventory Warnings */}
          <div className="lrs-card">
            <h3 className="text-base font-bold text-slate-900 mb-3.5 m-0">Care Fulfillment Pipeline</h3>
            <div className="space-y-2.5">
              <div
                onClick={() => onNavigate("pharmacy")}
                className="p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-100 transition cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-blue-100 text-[#254d90]">
                    <FiBox size={16} />
                  </span>
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Pharmacy Dispensary</span>
                    <p className="text-xs sm:text-sm text-slate-600 m-0 mt-0.5">
                      {pharmacyStats?.pending_dispatch_count ?? 0} prescriptions awaiting dispatch
                    </p>
                  </div>
                </div>
                <FiArrowRight className="text-slate-400" size={15} />
              </div>

              {pharmacyStats?.low_stock_count > 0 && (
                <div
                  onClick={() => onNavigate("pharmacy")}
                  className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 transition cursor-pointer flex items-center gap-2.5"
                >
                  <FiAlertTriangle className="text-amber-600 shrink-0" size={17} />
                  <span className="text-xs sm:text-sm font-bold">
                    {pharmacyStats.low_stock_count} medicine(s) below minimum stock threshold
                  </span>
                </div>
              )}

              <div
                onClick={() => onNavigate("laboratory")}
                className="p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-100 transition cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-lg bg-[#126868]/10 text-[#126868]">
                    <FiActivity size={16} />
                  </span>
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Diagnostic Laboratory</span>
                    <p className="text-xs sm:text-sm text-slate-600 m-0 mt-0.5">
                      {labStats?.pending_processing ?? 0} sample tests in processing
                    </p>
                  </div>
                </div>
                <FiArrowRight className="text-slate-400" size={15} />
              </div>
            </div>
          </div>

          {/* Quick Clinical Launchpad */}
          <div className="lrs-card">
            <h3 className="text-base font-bold text-slate-900 mb-1 m-0">Quick Action Command Hub</h3>
            <p className="text-sm text-slate-500 mb-3.5">Fast shortcuts to clinical workflows</p>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={onOpenBookModal}
                className="p-3 rounded-xl bg-slate-50 hover:bg-[#254d90]/5 hover:border-[#254d90]/30 border border-slate-200/80 text-left transition cursor-pointer group"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#254d90] flex items-center gap-1.5">
                  <FiPlus size={15} className="text-[#254d90]" />
                  <span>New Booking</span>
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">Appointment entry</span>
              </button>

              <button
                onClick={() => onNavigate("queue")}
                className="p-3 rounded-xl bg-slate-50 hover:bg-amber-50 hover:border-amber-300 border border-slate-200/80 text-left transition cursor-pointer group"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-amber-800 flex items-center gap-1.5">
                  <FiClock size={15} className="text-amber-600" />
                  <span>Issue Token</span>
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">Waiting room queue</span>
              </button>

              <button
                onClick={() => onNavigate("consultations")}
                className="p-3 rounded-xl bg-slate-50 hover:bg-[#126868]/5 hover:border-[#126868]/30 border border-slate-200/80 text-left transition cursor-pointer group"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#126868] flex items-center gap-1.5">
                  <FiFileText size={15} className="text-[#126868]" />
                  <span>Consultations</span>
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">Doctor EMR notes</span>
              </button>

              <button
                onClick={() => onNavigate("prescriptions")}
                className="p-3 rounded-xl bg-slate-50 hover:bg-[#126868]/5 hover:border-[#126868]/30 border border-slate-200/80 text-left transition cursor-pointer group"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#126868] flex items-center gap-1.5">
                  <FiFileText size={15} className="text-[#126868]" />
                  <span>Write Rx</span>
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">WhatsApp prescription</span>
              </button>

              <button
                onClick={() => onNavigate("pharmacy")}
                className="p-3 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 border border-slate-200/80 text-left transition cursor-pointer group"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-blue-800 flex items-center gap-1.5">
                  <FiBox size={15} className="text-[#254d90]" />
                  <span>Dispense Meds</span>
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">Pharmacy counter</span>
              </button>

              <button
                onClick={() => onNavigate("billing")}
                className="p-3 rounded-xl bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 border border-slate-200/80 text-left transition cursor-pointer group"
              >
                <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-emerald-800 flex items-center gap-1.5">
                  <FaRupeeSign size={14} className="text-emerald-600" />
                  <span>Collect Bill</span>
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">Instant receipts</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
