import React, { useState, useEffect } from "react";
import {
  FiTrendingUp,
  FiDollarSign,
  FiUsers,
  FiCheckCircle,
  FiMessageCircle,
  FiRotateCw,
  FiCalendar,
  FiSend,
  FiCreditCard,
  FiActivity,
  FiAlertCircle,
  FiPackage,
  FiLayers,
  FiArrowUpRight,
  FiPieChart,
  FiAward,
  FiClock,
  FiUserCheck
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import {
  fetchAnalytics,
  runReminders,
  runFeedbackFollowups,
  fetchAutomationStatus
} from "../api";

export default function AnalyticsView() {
  const [data, setData] = useState(null);
  const [automationStatus, setAutomationStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runningReminders, setRunningReminders] = useState(false);
  const [runningFeedback, setRunningFeedback] = useState(false);

  const loadData = async () => {
    try {
      const [anaData, autoData] = await Promise.all([
        fetchAnalytics(),
        fetchAutomationStatus(),
      ]);
      setData(anaData);
      setAutomationStatus(autoData);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRunReminders = async () => {
    setRunningReminders(true);
    try {
      const res = await runReminders();
      alert(`Automated reminders dispatched: ${res.reminders_sent} patient(s) notified on WhatsApp!`);
      loadData();
    } catch (err) {
      alert(err.message || "Failed to trigger reminders");
    } finally {
      setRunningReminders(false);
    }
  };

  const handleRunFeedback = async () => {
    setRunningFeedback(true);
    try {
      const res = await runFeedbackFollowups();
      alert(`Follow-up check-ins dispatched: ${res.followups_sent} patient(s) contacted on WhatsApp!`);
      loadData();
    } catch (err) {
      alert(err.message || "Failed to trigger follow-ups");
    } finally {
      setRunningFeedback(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-3">
        <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-[#254d90]"></div>
        <p className="text-xs font-semibold text-slate-500">Calculating clinical & financial intelligence...</p>
      </div>
    );
  }

  const fin = data?.financial || {};
  const ops = data?.operations || {};
  const pts = data?.patients || {};
  const msg = data?.messaging || {};

  // Extract department stream objects
  const streams = fin.department_streams || [];
  const opdStream = streams.find((s) => s.id === "opd") || { revenue: 0, percentage: 0, count: 0 };
  const pharmaStream = streams.find((s) => s.id === "pharma") || { revenue: 0, percentage: 0, count: 0 };
  const labStream = streams.find((s) => s.id === "lab") || { revenue: 0, percentage: 0, count: 0 };

  // Calculate 7-day trend metrics
  const trendList = fin.revenue_trend || [];
  const trendTotal = trendList.reduce((acc, d) => acc + (d.revenue || 0), 0);
  const maxDayRevenue = Math.max(...trendList.map((d) => d.revenue || 0), 1);
  const trendAvg = trendList.length > 0 ? Math.round(trendTotal / trendList.length) : 0;

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Executive Intelligence & Auditing"
        title="Financial & Operational Analytics"
        icon={FiTrendingUp}
        rightAction={
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Audited Data
            </span>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Analytics Data"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
          </div>
        }
      />

      {/* Row 1: Executive KPI Grid (6 High-Density Metric Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Total Revenue */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 border-l-[#254d90]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Net Collections</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#254d90] flex items-center justify-center">
              <FiDollarSign size={16} />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl font-extrabold text-slate-900 tracking-tight">
              ₹{(fin.total_revenue || 0).toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Today: ₹{(fin.today_revenue || 0).toLocaleString()}</span>
              <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                {fin.collection_rate || 100}% Paid
              </span>
            </div>
          </div>
        </div>

        {/* Total Invoiced */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Gross Invoiced</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <FiCreditCard size={16} />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl font-extrabold text-slate-900 tracking-tight">
              ₹{(fin.total_invoiced || 0).toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Avg / Bill: ₹{(fin.average_bill || 0).toLocaleString()}</span>
              <span className="text-indigo-700 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">
                {fin.paid_invoices_count || 0} Bills
              </span>
            </div>
          </div>
        </div>

        {/* Pending Receivables */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pending Dues</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <FiAlertCircle size={16} />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl font-extrabold text-amber-900 tracking-tight">
              ₹{(fin.pending_dues || 0).toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{fin.pending_invoices_count || 0} Unpaid</span>
              <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded">
                Receivables
              </span>
            </div>
          </div>
        </div>

        {/* OPD Consultation Stream */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 border-l-[#254d90]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">OPD Revenue</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#254d90] flex items-center justify-center">
              <FiActivity size={16} />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl font-extrabold text-slate-900 tracking-tight">
              ₹{opdStream.revenue.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{opdStream.count} Visits</span>
              <span className="text-[#254d90] font-bold bg-blue-50 px-1.5 py-0.5 rounded">
                {opdStream.percentage}%
              </span>
            </div>
          </div>
        </div>

        {/* Pharmacy Stream */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 border-l-purple-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pharmacy</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <FiPackage size={16} />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl font-extrabold text-slate-900 tracking-tight">
              ₹{pharmaStream.revenue.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{pharmaStream.count} Items</span>
              <span className="text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded">
                {pharmaStream.percentage}%
              </span>
            </div>
          </div>
        </div>

        {/* Diagnostics / Lab Stream */}
        <div className="lrs-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 border-l-[#126868]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Diagnostics</span>
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-[#126868] flex items-center justify-center">
              <FiCheckCircle size={16} />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl font-extrabold text-slate-900 tracking-tight">
              ₹{labStream.revenue.toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{labStream.count} Tests</span>
              <span className="text-[#126868] font-bold bg-teal-50 px-1.5 py-0.5 rounded">
                {labStream.percentage}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: 7-Day Revenue Collections Bar Chart + Multi-Department Stream Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual 7-Day Revenue Collections Chart (2/3 col) */}
        <div className="lg:col-span-2 lrs-card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-100 gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 m-0">7-Day Daily Collections Trend</h3>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  Reconciled
                </span>
              </div>
              <p className="text-xs text-slate-500 m-0 mt-0.5">
                Daily receipts across all consultation visits, dispensed prescriptions, and diagnostic orders
              </p>
            </div>
            {fin.peak_day && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold self-start sm:self-auto">
                <FiArrowUpRight size={14} className="text-emerald-600" />
                <span>Peak: {fin.peak_day}</span>
              </div>
            )}
          </div>

          {/* Visual Vertical Bar Chart */}
          <div className="pt-4 pb-2">
            <div className="h-48 flex items-end justify-between gap-3 px-2 border-b border-slate-200">
              {trendList.map((day, idx) => {
                const heightPct = maxDayRevenue > 0 ? Math.max(10, Math.round((day.revenue / maxDayRevenue) * 100)) : 10;
                const isPeak = day.is_peak && day.revenue > 0;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                    {/* Hover Tooltip / Value on top */}
                    <div className="mb-2 text-center transition-all transform group-hover:-translate-y-1">
                      {isPeak && (
                        <span className="inline-block px-1.5 py-0.5 mb-1 text-[9px] font-black uppercase tracking-wider rounded bg-emerald-500 text-white shadow-xs">
                          Peak
                        </span>
                      )}
                      <div className={`text-[11px] font-bold font-mono ${day.revenue > 0 ? "text-slate-800" : "text-slate-400"}`}>
                        ₹{day.revenue.toLocaleString()}
                      </div>
                    </div>

                    {/* Bar Pillar */}
                    <div className="w-full max-w-[48px] bg-slate-100 rounded-t-lg overflow-hidden flex flex-col justify-end transition-all">
                      <div
                        className={`w-full rounded-t-lg transition-all duration-500 ${
                          isPeak
                            ? "bg-gradient-to-t from-emerald-600 to-teal-500 shadow-sm"
                            : day.revenue > 0
                            ? "bg-gradient-to-t from-[#254d90] to-blue-500 group-hover:from-[#1d3d74] group-hover:to-blue-400"
                            : "bg-slate-200 h-2"
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* X-Axis Labels */}
            <div className="grid grid-cols-7 gap-3 px-2 pt-2.5 text-center">
              {trendList.map((day, idx) => (
                <div key={idx} className="flex flex-col items-center">
                  <span className={`text-[11px] font-bold uppercase ${day.is_peak ? "text-emerald-700 font-extrabold" : "text-slate-700"}`}>
                    {day.display}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">{day.full_date}</span>
                  <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded mt-0.5">
                    {day.count} txns
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Trend Summary Bar */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-500 font-medium">7-Day Revenue Total</span>
              <div className="text-sm font-extrabold text-slate-900 font-mono mt-0.5">
                ₹{trendTotal.toLocaleString()}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-500 font-medium">Daily Average</span>
              <div className="text-sm font-extrabold text-slate-900 font-mono mt-0.5">
                ₹{trendAvg.toLocaleString()} / day
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-500 font-medium">Collection Efficiency</span>
              <div className="text-sm font-extrabold text-emerald-700 font-mono mt-0.5">
                {fin.collection_rate || 100}% of gross billed
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Department Revenue Stream Breakdown (1/3 col) */}
        <div className="lrs-card space-y-4 flex flex-col justify-between">
          <div>
            <div className="pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 m-0">Departmental Revenue Share</h3>
              <p className="text-xs text-slate-500 m-0 mt-0.5">Contribution across core clinical care divisions</p>
            </div>

            <div className="space-y-4 pt-3">
              {/* OPD Stream */}
              <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#254d90]" />
                    <span className="text-xs font-bold text-slate-900">OPD Consultations</span>
                  </div>
                  <span className="text-xs font-extrabold text-[#254d90]">
                    ₹{opdStream.revenue.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-blue-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#254d90] h-full rounded-full transition-all"
                    style={{ width: `${opdStream.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                  <span>{opdStream.count} Visits Completed</span>
                  <span className="font-bold text-slate-700">{opdStream.percentage}% share</span>
                </div>
              </div>

              {/* Pharmacy Stream */}
              <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-600" />
                    <span className="text-xs font-bold text-slate-900">Pharmacy Dispensary</span>
                  </div>
                  <span className="text-xs font-extrabold text-purple-700">
                    ₹{pharmaStream.revenue.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-purple-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-purple-600 h-full rounded-full transition-all"
                    style={{ width: `${pharmaStream.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                  <span>{pharmaStream.count} Items Dispensed</span>
                  <span className="font-bold text-slate-700">{pharmaStream.percentage}% share</span>
                </div>
              </div>

              {/* Lab & Diagnostics Stream */}
              <div className="p-3 rounded-xl bg-teal-50/50 border border-teal-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#126868]" />
                    <span className="text-xs font-bold text-slate-900">Diagnostics &amp; Lab</span>
                  </div>
                  <span className="text-xs font-extrabold text-[#126868]">
                    ₹{labStream.revenue.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-teal-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#126868] h-full rounded-full transition-all"
                    style={{ width: `${labStream.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                  <span>{labStream.count} Diagnostic Panels</span>
                  <span className="font-bold text-slate-700">{labStream.percentage}% share</span>
                </div>
              </div>
            </div>
          </div>

          {/* Realization Rate Footer */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5 mt-2">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-700">Audit Realization Rate</span>
              <span className="text-emerald-700">{fin.collection_rate || 100}%</span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full rounded-full transition-all"
                style={{ width: `${fin.collection_rate || 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>Realized: ₹{(fin.total_revenue || 0).toLocaleString()}</span>
              <span>Dues: ₹{(fin.pending_dues || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Specialist Clinical & Revenue Yield Matrix */}
      <div className="lrs-card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 border-b border-slate-100 gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 m-0">Specialist Clinical &amp; Revenue Yield</h3>
            <p className="text-xs text-slate-500 m-0 mt-0.5">
              Doctor consultation volume, completion efficiency, digital prescription conversion, and earnings yield
            </p>
          </div>
          <span className="text-xs font-bold text-[#254d90] bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md self-start sm:self-auto">
            {(ops.doctor_performance || []).length} Active Specialist{(ops.doctor_performance || []).length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="dir-table-wrapper mt-2">
          <div className="dir-scroll-bar-header">
            <span className="dir-scroll-hint">⇄ Doctor Performance Audit</span>
            <span className="text-xs font-semibold text-slate-500">
              Aggregated across all scheduled clinic consultations
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
            <table className="data-grid-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SPECIALIST &amp; DEPARTMENT</th>
                  <th style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>BOOKINGS</th>
                  <th style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>COMPLETED VISITS</th>
                  <th style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>PRESCRIPTIONS (Rx)</th>
                  <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>REVENUE GENERATED</th>
                  <th style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>CLINICAL STATUS</th>
                </tr>
              </thead>
              <tbody>
                {(ops.doctor_performance || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-slate-400 italic text-xs">
                      No active specialist data available.
                    </td>
                  </tr>
                ) : (
                  (ops.doctor_performance || []).map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-[#254d90] flex items-center justify-center font-bold text-xs">
                            {doc.name.replace("Dr. ", "").charAt(0)}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block">{doc.name}</span>
                            <span className="text-slate-500 text-[11px] font-medium">
                              {doc.specialization || "General Medicine"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }} className="font-bold font-mono text-slate-700">
                        {doc.total_appointments}
                      </td>
                      <td style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span>{doc.completed_appointments}</span>
                          <span className="text-[10px] text-emerald-600 font-mono">({doc.completion_rate}%)</span>
                        </div>
                      </td>
                      <td style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-blue-50 text-[#254d90] border border-blue-200">
                          <span>{doc.prescriptions_written} Rx</span>
                          <span className="text-[10px] text-[#254d90]/80 font-mono">({doc.rx_conversion_rate}%)</span>
                        </div>
                      </td>
                      <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-extrabold text-slate-900 text-[13px]">
                          ₹{(doc.revenue_generated || 0).toLocaleString()}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700">
                          <FiUserCheck size={12} className="text-emerald-600" />
                          <span>Active Practicing</span>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="dir-scroll-bar-footer">
            <span className="text-xs text-slate-500 font-medium">
              Real-time consultant load and financial performance calculated from all logged patient sessions.
            </span>
          </div>
        </div>
      </div>

      {/* Row 4: Collections by Payment Method & Clinic Patient Conversion Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Methods Distribution */}
        <div className="lrs-card space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 m-0">Collections by Payment Method</h3>
            <p className="text-xs text-slate-500 m-0 mt-0.5">Reconciled breakdown of payments across cash and digital modes</p>
          </div>

          <div className="space-y-3 pt-1">
            {(fin.payment_distribution || []).length === 0 ? (
              <p className="text-xs text-slate-400 italic">No paid transactions recorded yet.</p>
            ) : (
              fin.payment_distribution.map((pm, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-teal-50 text-[#126868] flex items-center justify-center font-bold">
                        <FiCreditCard size={14} />
                      </div>
                      <div>
                        <span className="font-bold text-slate-900">{pm.method}</span>
                        <span className="text-slate-400 font-mono text-[11px] ml-1.5">
                          ({pm.count} transactions)
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-extrabold text-slate-900 font-mono text-xs">
                        ₹{pm.revenue.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-slate-500 ml-1.5 font-bold">
                        ({pm.percentage}%)
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#126868] h-full rounded-full transition-all"
                      style={{ width: `${pm.percentage}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 flex items-center justify-between text-xs">
            <span className="text-slate-600 font-medium">Average Receipt Ticket Size:</span>
            <span className="font-bold font-mono text-[#254d90] text-sm">
              ₹{(fin.average_bill || 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Patient Care & Conversion Funnel */}
        <div className="lrs-card space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 m-0">Clinic Patient Journey &amp; Conversion Funnel</h3>
            <p className="text-xs text-slate-500 m-0 mt-0.5">End-to-end patient velocity from initial booking to settlement</p>
          </div>

          <div className="space-y-3 pt-1">
            {(ops.conversion_funnel || []).map((step, idx) => {
              const colors = [
                { bg: "bg-blue-500", light: "bg-blue-50", text: "text-blue-700" },
                { bg: "bg-teal-500", light: "bg-teal-50", text: "text-teal-700" },
                { bg: "bg-emerald-500", light: "bg-emerald-50", text: "text-emerald-700" },
                { bg: "bg-purple-500", light: "bg-purple-50", text: "text-purple-700" },
                { bg: "bg-indigo-500", light: "bg-indigo-50", text: "text-indigo-700" },
              ];
              const c = colors[idx % colors.length];

              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">{step.stage}</span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-slate-900">{step.count}</span>
                      <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${c.light} ${c.text}`}>
                        {step.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${c.bg}`}
                      style={{ width: `${step.percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100 flex items-center justify-between text-xs mt-2">
            <span className="text-slate-600 font-medium">Patient Consultation Completion Rate:</span>
            <span className="font-bold font-mono text-emerald-800 text-sm">
              {ops.total_appointments > 0
                ? `${Math.round(((ops.conversion_funnel?.[2]?.count || 0) / ops.total_appointments) * 100)}%`
                : "0%"}
            </span>
          </div>
        </div>
      </div>

      {/* Row 5: WhatsApp Automation & Proactive Patient Engagement Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Engagement & Retention Metrics (2/3 col) */}
        <div className="lg:col-span-2 lrs-card space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <FiMessageCircle className="text-[#126868]" size={18} />
            <div>
              <h3 className="text-sm font-bold text-slate-900 m-0">Patient Retention &amp; WhatsApp Engagement</h3>
              <p className="text-xs text-slate-500 m-0 mt-0.5">Automated channels driving clinic loyalty and inbound inquiries</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase">Retention Rate</span>
              <div className="text-xl font-extrabold text-slate-900 font-mono mt-1">
                {pts.retention_rate || 0}%
              </div>
              <span className="text-[10px] text-slate-400">{pts.returning_patients || 0} returning patients</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase">WhatsApp Share</span>
              <div className="text-xl font-extrabold text-[#126868] font-mono mt-1">
                {ops.whatsapp_percentage || 0}%
              </div>
              <span className="text-[10px] text-slate-400">{ops.whatsapp_appointments || 0} bookings</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase">Patient Inbound</span>
              <div className="text-xl font-extrabold text-[#254d90] font-mono mt-1">
                {msg.patient_inbound || 0}
              </div>
              <span className="text-[10px] text-slate-400">Total inquiries</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase">Bot Replies</span>
              <div className="text-xl font-extrabold text-emerald-700 font-mono mt-1">
                {msg.bot_replies || 0}
              </div>
              <span className="text-[10px] text-slate-400">AI auto-answers</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-700 font-medium">WhatsApp Cloud Webhook Listener</span>
            </div>
            <span className="text-xs font-mono font-bold text-slate-600">
              {msg.total_messages || 0} Total Messages Handled
            </span>
          </div>
        </div>

        {/* Automated WhatsApp Tasks Controller (1/3 col) */}
        <div className="lrs-card space-y-4 bg-gradient-to-br from-[#0a1120] to-[#162238] text-white flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/10">
              <FiSend className="text-[#38bdf8]" size={17} />
              <div>
                <h3 className="text-sm font-bold m-0 text-white">Automated Outreach Triggers</h3>
                <p className="text-xs text-slate-300 m-0">Trigger proactive patient communication</p>
              </div>
            </div>

            <div className="space-y-3 text-xs pt-3">
              {/* Reminder Trigger */}
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200">2-Hour Appointment Reminders</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                    {automationStatus?.total_reminders_sent || 0} Sent
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 m-0">
                  Notifies patients with confirmed bookings today with clinic address and arrival guidelines.
                </p>
                <button
                  onClick={handleRunReminders}
                  disabled={runningReminders}
                  className="w-full mt-1.5 py-2 rounded-xl text-xs font-bold text-white bg-[#126868] hover:bg-[#0f5555] transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <FiSend size={13} />
                  <span>{runningReminders ? "Dispatching..." : "Send Today's Reminders"}</span>
                </button>
              </div>

              {/* Post-Visit Feedback Trigger */}
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200">Post-Visit Follow-Up &amp; Care</span>
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-bold">
                    {automationStatus?.total_followups_sent || 0} Sent
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 m-0">
                  Sends a care follow-up note and check-in to all patients completed today.
                </p>
                <button
                  onClick={handleRunFeedback}
                  disabled={runningFeedback}
                  className="w-full mt-1.5 py-2 rounded-xl text-xs font-bold text-white bg-[#254d90] hover:bg-[#1a386b] transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <FiCheckCircle size={13} />
                  <span>{runningFeedback ? "Dispatching..." : "Send Post-Visit Follow-Ups"}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 text-center pt-2 border-t border-white/10">
            Automated via Meta WhatsApp Cloud API
          </div>
        </div>
      </div>
    </div>
  );
}
