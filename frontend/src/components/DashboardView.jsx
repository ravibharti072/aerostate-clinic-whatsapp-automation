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
  FiDollarSign,
  FiFileText,
  FiTrendingUp
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import { fetchStats, fetchAppointments, fetchBillingStats, fetchQueue } from "../api";

export default function DashboardView({ onNavigate, onOpenBookModal }) {
  const [stats, setStats] = useState(null);
  const [todayAppts, setTodayAppts] = useState([]);
  const [billingStats, setBillingStats] = useState(null);
  const [queueStats, setQueueStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const [statsData, apptsData, billData, queueData] = await Promise.all([
        fetchStats().catch(() => null),
        fetchAppointments({ date: todayStr }).catch(() => ({ appointments: [] })),
        fetchBillingStats().catch(() => null),
        fetchQueue().catch(() => null),
      ]);
      setStats(statsData);
      setTodayAppts(apptsData.appointments || []);
      setBillingStats(billData);
      setQueueStats(queueData);
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      loadData();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
      </div>
    );
  }

  // Purely reading backend pre-calculated metrics & sparklines
  const kpis = stats?.kpis;
  const breakdown = stats?.breakdown;
  const recentMessages = stats?.recent_messages || [];

  return (
    <div className="space-y-6">
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
              <FiRotateCw className={`refresh-icon ${refreshing ? "spinning" : ""}`} size={15} />
            </button>

            <button
              onClick={() => onNavigate("appointments")}
              className="portal-action-btn"
            >
              <FiPlus size={16} />
              <span>New Appointment Entry</span>
            </button>
          </div>
        }
      />

      {/* 4 Stat Cards (aerostate-lrs Reusable Size & Design) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Today's Appointments"
          value={kpis?.today_appointments?.value ?? stats?.today_appointments ?? 0}
          Icon={FiClock}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Confirmed Bookings"
          value={kpis?.confirmed_appointments?.value ?? stats?.confirmed_bookings ?? 0}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Registered Patients"
          value={kpis?.registered_patients?.value ?? stats?.total_patients ?? 0}
          Icon={FiUsers}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Specialists on Duty"
          value={kpis?.active_doctors?.value ?? stats?.active_doctors ?? 0}
          Icon={FiUserCheck}
          colorTheme="brand-teal"
        />
      </div>

      {/* Clinical Operations Hub */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Waiting Room Queue Card */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#126868]/40 transition bg-gradient-to-br from-white to-amber-50/20">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-amber-100 text-amber-700">
                <FiClock size={16} />
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base m-0">Live OPD Queue</h4>
            <p className="text-sm text-slate-500 mt-1 m-0">
              Tokens & patient flow for reception and cabins
            </p>
          </div>
          <button
            onClick={() => onNavigate("queue")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-amber-900 bg-amber-100/70 hover:bg-amber-100 transition cursor-pointer"
          >
            <span>Open Queue Board</span>
            <FiArrowRight size={13} />
          </button>
        </div>

        {/* Billing & Invoices Card */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#254d90]/40 transition bg-gradient-to-br from-white to-blue-50/20">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-blue-100 text-[#254d90]">
                <FiDollarSign size={16} />
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base m-0">Billing & Invoices</h4>
            <p className="text-sm text-slate-500 mt-1 m-0">
              Auto-calculate taxes & WhatsApp receipts
            </p>
          </div>
          <button
            onClick={() => onNavigate("billing")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-[#254d90] bg-blue-50 hover:bg-blue-100 transition cursor-pointer"
          >
            <span>Manage Invoices</span>
            <FiArrowRight size={13} />
          </button>
        </div>

        {/* Prescriptions & EMR Card */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-[#126868]/40 transition bg-gradient-to-br from-white to-emerald-50/20">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-[#126868]/10 text-[#126868]">
                <FiFileText size={16} />
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base m-0">Prescriptions & EMR</h4>
            <p className="text-sm text-slate-500 mt-1 m-0">
              Standard dosages & 1-click WhatsApp Rx
            </p>
          </div>
          <button
            onClick={() => onNavigate("prescriptions")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-[#126868] bg-[#126868]/10 hover:bg-[#126868]/20 transition cursor-pointer"
          >
            <span>Write Prescription</span>
            <FiArrowRight size={13} />
          </button>
        </div>

        {/* Financial Analytics Card */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:border-purple-200 transition bg-gradient-to-br from-white to-purple-50/20">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-purple-100 text-purple-700">
                <FiTrendingUp size={16} />
              </span>
            </div>
            <h4 className="font-bold text-slate-900 text-base m-0">Clinic Analytics</h4>
            <p className="text-sm text-slate-500 mt-1 m-0">
              Retention rate & doctor productivity
            </p>
          </div>
          <button
            onClick={() => onNavigate("analytics")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-purple-800 bg-purple-50 hover:bg-purple-100 transition cursor-pointer"
          >
            <span>View Analytics</span>
            <FiArrowRight size={13} />
          </button>
        </div>
      </div>

      {/* Main Grid: Today's Schedule & Side Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Schedule Card (2 cols) */}
        <div className="lg:col-span-2 lrs-card">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900 m-0">Today's Appointment Schedule</h2>
              <p className="text-xs text-slate-500 m-0 mt-0.5">Live patient appointments booked for today</p>
            </div>
            <button
              onClick={() => onNavigate("appointments")}
              className="text-xs font-semibold text-[#254d90] hover:text-[#1e3f78] flex items-center space-x-1 cursor-pointer"
            >
              <span>View all</span>
              <FiArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {todayAppts.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <FiCalendar className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">No appointments scheduled for today</p>
              <p className="text-xs text-slate-500 mt-1">Book via WhatsApp or use the direct booking button</p>
              <button
                onClick={onOpenBookModal}
                className="mt-3 text-xs bg-[#166962] hover:bg-[#125751] text-white font-medium px-4 py-2 rounded-lg cursor-pointer transition"
              >
                + Book Now
              </button>
            </div>
          ) : (
            <div className="dir-table-wrapper">
              <div className="dir-scroll-bar-header">
                <span className="dir-scroll-hint">⇄ Today's Scheduled Appointments</span>
                <span className="text-xs font-semibold text-slate-500">
                  {todayAppts.length} scheduled visit{todayAppts.length === 1 ? "" : "s"}
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
                <table className="data-grid-table" style={{ minWidth: "650px", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>TIME</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SPECIALIST</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SOURCE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayAppts.map((appt) => (
                      <tr key={appt.id}>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="flex items-center space-x-1.5 font-mono text-slate-700 font-semibold">
                            <FiClock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{appt.formatted_time || appt.start_time}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <div className="font-bold text-slate-900">{appt.patient_name}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">{appt.patient_phone}</div>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-semibold text-slate-900">{appt.doctor_name}</span>
                          {appt.doctor_specialty && (
                            <span className="text-slate-500 ml-1.5 font-normal">
                              ({appt.doctor_specialty})
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          {(appt.source || "").toLowerCase() === "whatsapp" ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
                              style={{ fontSize: "11px" }}
                            >
                              <FiMessageCircle size={10} />
                              <span>WhatsApp</span>
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200"
                              style={{ fontSize: "11px" }}
                            >
                              <span>Direct</span>
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`badge-${
                              appt.status_theme === "emerald"
                                ? "active"
                                : appt.status_theme === "blue"
                                ? "blue"
                                : "inactive"
                            }`}
                            style={{ fontSize: "11px" }}
                          >
                            {appt.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dir-scroll-bar-footer">
                <span className="text-xs text-slate-500 font-medium">
                  Real-time synchronization of walk-ins and automated WhatsApp bookings for today.
                </span>
              </div>
            </div>
          )}

          {/* Recent WhatsApp Messages Section */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 m-0 flex items-center gap-1.5">
                  <FiMessageCircle className="text-[#126868]" />
                  <span>Recent WhatsApp Inquiries</span>
                </h3>
                <p className="text-[11px] text-slate-500 m-0 mt-0.5">Live incoming patient messages and Meta WhatsApp chat activity</p>
              </div>
              <button
                onClick={() => onNavigate("messages")}
                className="text-xs font-semibold text-[#126868] hover:text-[#0f5555] flex items-center space-x-1 cursor-pointer"
              >
                <span>Open WhatsApp Chats</span>
                <FiArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {recentMessages.length === 0 ? (
              <p className="text-sm text-slate-400 italic py-2">
                No WhatsApp messages logged yet. Incoming patient messages will appear here in real time.
              </p>
            ) : (
              <div className="space-y-2">
                {recentMessages.map((msg) => (
                  <div
                    key={msg.id}
                    onClick={() => onNavigate(`messages?phone=${encodeURIComponent(msg.phone)}`)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/90 transition cursor-pointer text-xs border border-slate-100"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-[#126868] shrink-0" />
                      <span className="font-semibold text-slate-900">{msg.patient_name}</span>
                      <span className="text-[11px] text-slate-400 font-mono">({msg.phone})</span>
                      <span className="text-slate-600 truncate max-w-sm">"{msg.body}"</span>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 font-medium ml-2">
                      {msg.created_at
                        ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Cards */}
        <div className="space-y-6">
          {/* Booking Status Breakdown (100% Calculated on Backend) */}
          <div className="lrs-card">
            <h3 className="text-sm font-bold text-slate-900 mb-3 m-0">Booking Status Breakdown</h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-emerald-50/80 border border-emerald-100">
                <span className="font-semibold text-emerald-950 flex items-center space-x-2">
                  <FiCheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Confirmed</span>
                </span>
                <span className="font-bold text-emerald-800 text-sm">
                  {breakdown?.confirmed_count ?? 0} ({breakdown?.confirmed_percent ?? 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-blue-50/80 border border-blue-100">
                <span className="font-semibold text-blue-950 flex items-center space-x-2">
                  <FiCheckCircle className="w-4 h-4 text-blue-600" />
                  <span>Completed</span>
                </span>
                <span className="font-bold text-blue-800 text-sm">
                  {breakdown?.completed_count ?? 0} ({breakdown?.completed_percent ?? 0}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-rose-50/80 border border-rose-100">
                <span className="font-semibold text-rose-950 flex items-center space-x-2">
                  <FiXCircle className="w-4 h-4 text-rose-600" />
                  <span>Cancelled</span>
                </span>
                <span className="font-bold text-rose-800 text-sm">
                  {breakdown?.cancelled_count ?? 0} ({breakdown?.cancelled_percent ?? 0}%)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
