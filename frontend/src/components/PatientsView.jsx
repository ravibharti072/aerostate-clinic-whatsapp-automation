import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaWhatsapp } from "react-icons/fa";
import {
  FiUsers,
  FiPhone,
  FiCalendar,
  FiClock,
  FiMessageCircle,
  FiFileText,
  FiDollarSign,
  FiX,
  FiActivity,
  FiAlertTriangle,
  FiShield,
  FiUser,
  FiChevronLeft,
  FiChevronRight,
  FiExternalLink,
  FiLayers
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchPatients,
  fetchPatientStats,
  fetchPatientProfile
} from "../api";

export default function PatientsView({ onSimulatePhone }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchParam = searchParams.get("search") || "";
  const [patients, setPatients] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParam);
  const [genderFilter, setGenderFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  // Server-side managed pagination state (all logic/calculations processed on backend)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pagination, setPagination] = useState({
    total_items: 0,
    total_pages: 1,
    current_page: 1,
    page_size: 20,
  });

  // 360-degree Patient Medical Profile Modal State
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Table Scroll Controls
  const tableContainerRef = useRef(null);

  const handleScrollLeft = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: -380, behavior: "smooth" });
    }
  };

  const handleScrollRight = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: 380, behavior: "smooth" });
    }
  };

  const loadPatients = async (opts = {}) => {
    const q = opts.search !== undefined ? opts.search : search;
    const g = opts.gender !== undefined ? opts.gender : genderFilter;
    const s = opts.source !== undefined ? opts.source : sourceFilter;
    const p = opts.page !== undefined ? opts.page : currentPage;
    const sz = opts.pageSize !== undefined ? opts.pageSize : pageSize;

    if (!opts.silent) setLoading(true);
    try {
      const data = await fetchPatients({
        search: q,
        gender: g,
        source: s,
        page: p,
        page_size: sz,
      });
      setPatients(data.patients || []);
      if (data.stats) {
        setStats(data.stats);
      }
      if (data.pagination) {
        setPagination(data.pagination);
      } else {
        setPagination({
          total_items: data.total || (data.patients || []).length,
          total_pages: 1,
          current_page: p,
          page_size: sz,
          has_next: false,
          has_prev: false,
        });
      }
    } catch (err) {
      if (!opts.silent) {
        console.error("Failed to load patients:", err);
        showToast(err.message || "Could not retrieve patient records", "error");
      }
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (searchParam && searchParam !== search) {
      setSearch(searchParam);
      setCurrentPage(1);
      loadPatients({ search: searchParam, page: 1 });
    } else {
      loadPatients();
    }

    // Auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      if (!selectedProfileId) {
        loadPatients({ silent: true });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [searchParam, selectedProfileId, genderFilter, sourceFilter, currentPage, pageSize]);

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    setCurrentPage(1);
    loadPatients({ page: 1, search });
  };

  const handleClearFilters = () => {
    setSearch("");
    setGenderFilter("");
    setSourceFilter("");
    setCurrentPage(1);
    loadPatients({ page: 1, search: "", gender: "", source: "" });
  };

  // Open 360-degree patient chart
  const handleOpenChart = async (patientId) => {
    setSelectedProfileId(patientId);
    setProfileLoading(true);
    setActiveTab("overview");
    try {
      const data = await fetchPatientProfile(patientId);
      setProfileData(data);
    } catch (err) {
      showToast("Failed to load medical history: " + err.message, "error");
      setSelectedProfileId(null);
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Central Registry"
        title="Master Patient Directory"
        icon={FiUsers}
      />

      {/* Reusable Stat Cards - Driven 100% by backend statistics */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Registered Patients"
          value={stats?.total_patients ?? 0}
          Icon={FiUsers}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Direct Walk-in Registrations"
          value={stats?.direct_count ?? 0}
          Icon={FiUser}
          colorTheme="brand-teal"
        />
        <StatCard
          title="WhatsApp Registrations"
          value={stats?.whatsapp_booking_count ?? 0}
          Icon={FiMessageCircle}
          colorTheme="brand-blue"
        />
        <StatCard
          title="WhatsApp Contact Linked"
          value={stats?.whatsapp_linked ?? 0}
          Icon={FiPhone}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Master Patient Directory Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title="Master Patient Directory"
          description="View, sort, filter, and manage registered clinic patient accounts and 360° medical history."
          badgeCount={pagination.total_items}
          badgeLabel="patients"
        />

        {/* CONTROLS & TOOLBAR */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search by Patient Name, Phone, UID, Attending Doctor, Specialization, Aadhaar, or Reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={() => {
              setCurrentPage(1);
              loadPatients({ page: 1, search });
            }}
            onClear={handleClearFilters}
          />

          <div className="dir-toolbar-right">
            <select
              className="dir-filter-select"
              value={sourceFilter}
              onChange={(e) => {
                const val = e.target.value;
                setSourceFilter(val);
                setCurrentPage(1);
                loadPatients({ page: 1, source: val });
              }}
            >
              <option value="">All Sources</option>
              <option value="Direct">Direct</option>
              <option value="WhatsApp">WhatsApp</option>
            </select>

            <select
              className="dir-filter-select"
              value={genderFilter}
              onChange={(e) => {
                const val = e.target.value;
                setGenderFilter(val);
                setCurrentPage(1);
                loadPatients({ page: 1, gender: val });
              }}
            >
              <option value="">All Genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>

            <button
              type="button"
              onClick={handleSearch}
              className="btn-submit"
              style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
            >
              Search
            </button>

            {(search || genderFilter || sourceFilter) && (
              <button
                type="button"
                className="btn-cancel"
                onClick={handleClearFilters}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
          </div>
        ) : patients.length === 0 ? (
          <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
            <FiUsers className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-800">No patients recorded yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Patients are automatically registered when they book an appointment via reception or WhatsApp.
            </p>
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master Patient Records (Scroll horizontally to view all columns)</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">
                  Showing {pagination.total_items} registered patient{pagination.total_items === 1 ? "" : "s"}
                </span>
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
            </div>

            <div
              ref={tableContainerRef}
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
              <table className="data-grid-table" style={{ minWidth: "2050px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>AADHAAR NUMBER</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PHONE NUMBER</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>GENDER / AGE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>BLOOD GROUP</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CITY</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>LATEST VISIT</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ATTENDING DOCTOR</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>VISIT TYPE & CABIN</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CHIEF SYMPTOMS / REASON</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>NEXT APPOINTMENT</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SOURCE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>VISITS</th>
                    <th style={{ width: "350px", minWidth: "350px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "14px" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((p) => (
                    <tr key={p.id}>
                      {/* 1. Patient ID (Clean ID without UID/Aadhaar) */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2.5 py-1 rounded text-xs">
                          {p.patient_uid || `PAT-${String(p.id).padStart(4, "0")}`}
                        </span>
                      </td>

                      {/* 2. Separate Aadhaar Number column */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.aadhaar_number && p.aadhaar_number !== "-" ? (
                          <span className="font-mono font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-xs tracking-wider">
                            {p.aadhaar_number}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Not provided</span>
                        )}
                      </td>

                      {/* 3. Patient Name (+ Today's active queue token badge) */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">{p.name}</span>
                          {p.is_today && p.today_token_display && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-300">
                              {p.today_token_display}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 4. Phone Number */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center space-x-1.5 font-mono text-slate-700">
                          <FiPhone className="w-3 h-3 text-[#126868] shrink-0" />
                          <span>{p.phone_display || p.phone}</span>
                        </div>
                      </td>

                      {/* 5. Gender / Age */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-700 font-medium">
                          {p.gender_age_display || p.gender || "Unspecified"}
                        </span>
                      </td>

                      {/* 6. Blood Group */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.blood_group && p.blood_group !== "-" ? (
                          <span className="inline-block px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-bold border border-rose-200 text-[11px]">
                            {p.blood_group}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* 7. City */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-700 font-medium">{p.city || "Agra"}</span>
                      </td>

                      {/* 8. Latest Visit Date & Time */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.last_visit && p.last_visit !== "None yet" ? (
                          <div>
                            <span className="font-semibold text-slate-900">{p.last_visit}</span>
                            {p.last_visit_time && (
                              <span className="text-[11px] text-slate-500 font-mono ml-1.5">
                                ({p.last_visit_time})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">No visits recorded</span>
                        )}
                      </td>

                      {/* 9. Attending Doctor & Specialization */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.last_doctor_name && p.last_doctor_name !== "—" ? (
                          <div>
                            <span className="font-semibold text-slate-900">{p.last_doctor_name}</span>
                            {p.last_doctor_specialization && p.last_doctor_specialization !== "—" && (
                              <div className="text-[11px] text-slate-500">{p.last_doctor_specialization}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* 10. Visit Type & Cabin */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.last_visit && p.last_visit !== "None yet" ? (
                          <div>
                            <span className="text-slate-800 font-medium">{p.last_visit_type}</span>
                            <div className="text-[10px] text-slate-400">{p.last_cabin}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* 11. Visit Status */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.last_visit && p.last_visit !== "None yet" ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[10px] border ${
                              p.last_appointment_status === "COMPLETED"
                                ? "bg-slate-100 text-slate-700 border-slate-200"
                                : p.last_appointment_status === "IN_CONSULTATION"
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            {p.last_appointment_status}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* 12. Chief Symptoms / Reason */}
                      <td style={{ fontSize: "12px" }}>
                        {p.last_reason && p.last_reason !== "—" ? (
                          <div
                            className="max-w-[200px] text-[11.5px] text-slate-700 leading-snug line-clamp-2"
                            title={p.last_reason}
                          >
                            {p.last_reason}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Routine / None noted</span>
                        )}
                      </td>

                      {/* 13. Next Upcoming Appointment */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {p.next_appointment && p.next_appointment !== "None scheduled" ? (
                          <div>
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200 text-[11px]">
                              <FiCalendar className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>
                                {p.next_appointment} {p.next_appointment_time ? `(${p.next_appointment_time})` : ""}
                              </span>
                            </div>
                            {p.next_doctor_name && (
                              <div className="text-[10.5px] text-slate-600 mt-0.5">
                                {p.next_doctor_name}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">None scheduled</span>
                        )}
                      </td>

                      {/* 14. Registration Source */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold border ${
                            (p.registration_source || "").toLowerCase().includes("whatsapp")
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          }`}
                          style={{ fontSize: "10.5px" }}
                        >
                          {(p.registration_source || "").toLowerCase().includes("whatsapp") ? "WhatsApp" : "Direct"}
                        </span>
                      </td>

                      {/* 15. Total Visits */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div>
                          <span
                            className="font-mono font-semibold text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200"
                            style={{ fontSize: "10.5px" }}
                          >
                            {p.visits_display || `${p.total_visits || 0} visits`}
                          </span>
                          {p.completed_visits > 0 && (
                            <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                              ✓ {p.completed_visits} completed
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 16. Actions: 3 Columns x 2 Rows + 7th WhatsApp Button (Matching Appointments Section) */}
                      <td style={{ fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "12px" }}>
                        <div className="flex items-center gap-1.5 flex-nowrap">
                          {/* Column 1: Primary Clinical Action (w-[88px]) */}
                          <div className="flex flex-col gap-1 w-[88px]">
                            {/* Top: 360° Medical Chart */}
                            <button
                              type="button"
                              onClick={() => handleOpenChart(p.id)}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                              title="Open 360° Comprehensive Medical Chart"
                            >
                              <FiActivity size={11} />
                              <span>Chart</span>
                            </button>
                            {/* Bottom: Doctor Consultation */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/consultations?patient_id=${p.id}&patient_name=${encodeURIComponent(
                                    p.name || ""
                                  )}&patient_phone=${encodeURIComponent(p.phone || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                              title="Start Doctor Consultation Workspace"
                            >
                              <FiExternalLink size={11} className="text-[#254d90]" />
                              <span>Consult</span>
                            </button>
                          </div>

                          {/* Column 2: Clinical ERP - Rx & Lab (w-[80px]) */}
                          <div className="flex flex-col gap-1 w-[80px]">
                            {/* Top: Digital Prescription */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/prescriptions?patient_phone=${encodeURIComponent(
                                    p.phone || ""
                                  )}&patient_name=${encodeURIComponent(p.name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer"
                              title="Write Digital Prescription (EMR)"
                            >
                              <FiFileText size={11} className="text-emerald-600" />
                              <span>Rx</span>
                            </button>
                            {/* Bottom: Diagnostics / Lab */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/laboratory?search=${encodeURIComponent(p.phone || p.name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 shadow-xs transition cursor-pointer"
                              title="Order or View Diagnostic Tests"
                            >
                              <FiLayers size={11} className="text-[#254d90]" />
                              <span>Lab</span>
                            </button>
                          </div>

                          {/* Column 3: Billing & Appointments (w-[80px]) */}
                          <div className="flex flex-col gap-1 w-[80px]">
                            {/* Top: Billing & Invoices */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/billing?patient_phone=${encodeURIComponent(
                                    p.phone || ""
                                  )}&patient_name=${encodeURIComponent(p.name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                              title="Generate Patient Invoice & Billing"
                            >
                              <FiDollarSign size={11} className="text-slate-600" />
                              <span>Bill</span>
                            </button>
                            {/* Bottom: Book / View Appointment */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/appointments?search=${encodeURIComponent(p.phone || p.name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300 shadow-xs transition cursor-pointer"
                              title="Book or View Patient Appointments"
                            >
                              <FiCalendar size={11} className="text-amber-600" />
                              <span>Appt</span>
                            </button>
                          </div>

                          {/* Column 4: 7th Single Full-Height Button at End (WhatsApp Chat, w-[74px]) */}
                          <div className="flex flex-col justify-center w-[74px]">
                            <button
                              type="button"
                              onClick={() => {
                                if (onSimulatePhone && p.phone) {
                                  onSimulatePhone(p.phone);
                                }
                                navigate(`/messages?phone=${encodeURIComponent(p.phone || "")}`);
                              }}
                              className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer"
                              title="Open WhatsApp Live Chat & Communication History"
                            >
                              <FaWhatsapp size={14} className="text-emerald-600" />
                              <span>Chat</span>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          <Pagination
            currentPage={currentPage}
            totalItems={pagination.total_items}
            pageSize={pageSize}
            onPageChange={(p) => {
              setCurrentPage(p);
              loadPatients({ page: p });
            }}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setCurrentPage(1);
              loadPatients({ page: 1, pageSize: sz });
            }}
            pageSizeOptions={[10, 20, 50, 100]}
            itemLabel="patients"
          />

          <div className="dir-scroll-bar-footer">
            <span className="text-xs text-slate-500 font-medium">
              Unified master patient index linking WhatsApp self-bookings, OPD consultations, prescriptions, labs, and billing.
            </span>
          </div>
        </div>
      )}
    </section>

      {/* ======================================================== */}
      {/* Full 360-degree Patient Medical Chart (8 Tabs)           */}
      {/* ======================================================== */}
      {selectedProfileId && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "980px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {profileLoading || !profileData ? (
              <div className="py-20 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90] mx-auto"></div>
                <p className="text-xs text-slate-500 mt-2">Loading complete medical chart...</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="modal-header">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-[#254d90] text-white flex items-center justify-center font-bold text-sm">
                      {profileData.overview.name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 style={{ fontSize: "16px" }}>{profileData.overview.name}</h2>
                        <span className="font-mono text-xs font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                          {profileData.overview.patient_uid}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          {profileData.overview.gender} • Age: {profileData.overview.age} • Blood Group: {profileData.overview.blood_group}
                        </span>
                      </div>
                      <div className="modal-kicker">
                        📞 {profileData.overview.phone} • Registered: {profileData.overview.created_at} ({profileData.overview.registration_source})
                        {profileData.overview.aadhaar_number && profileData.overview.aadhaar_number !== "-" && (
                          <span className="ml-2 font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                            Aadhaar: {profileData.overview.aadhaar_number}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedProfileId(null)}
                    className="modal-close"
                  >
                    <FiX size={18} />
                  </button>
                </div>

                {/* 8-Tab Navigation Bar */}
                <div className="flex border-b border-slate-200 overflow-x-auto text-xs font-semibold gap-1">
                  {[
                    { id: "overview", label: "Overview" },
                    { id: "history", label: "Medical History & Alerts" },
                    { id: "consultations", label: `Consultations (${profileData.consultations.length})` },
                    { id: "prescriptions", label: `Prescriptions (${profileData.prescriptions.length})` },
                    { id: "lab", label: `Lab & Diagnostics (${profileData.laboratory.length})` },
                    { id: "appointments", label: `Appointments (${profileData.appointments.length})` },
                    { id: "billing", label: `Billing & Invoices (${profileData.billing.length})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-2 border-b-2 whitespace-nowrap transition cursor-pointer ${
                        activeTab === tab.id
                          ? "border-[#254d90] text-[#254d90] font-bold"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab Contents */}
                <div className="flex-1 overflow-y-auto pr-1 text-xs">
                  {/* Tab 1: Overview */}
                  {activeTab === "overview" && (
                    <div className="space-y-4 py-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl">
                        <div>
                          <span className="text-slate-400 font-medium">Full Name:</span>
                          <div className="font-bold text-slate-800">{profileData.overview.name}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">WhatsApp Phone:</span>
                          <div className="font-bold font-mono text-slate-800">{profileData.overview.phone}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">Patient ID:</span>
                          <div className="font-bold font-mono text-[#254d90]">{profileData.overview.patient_uid}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">Blood Group:</span>
                          <div className="font-bold text-rose-600">{profileData.overview.blood_group}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">Address:</span>
                          <div className="font-bold text-slate-800">{profileData.overview.address || "Agra, Uttar Pradesh"}</div>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">Emergency Contact:</span>
                          <div className="font-bold text-slate-800">
                            {profileData.overview.emergency_name} ({profileData.overview.emergency_phone || "Not recorded"})
                          </div>
                        </div>
                      </div>

                      {/* Appointment & Customer Directory Summary Card */}
                      <div className="p-4 bg-gradient-to-r from-[#254d90]/5 via-[#126868]/5 to-transparent border border-slate-200 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                            <FiCalendar className="text-[#254d90]" />
                            <span>Appointment & Customer Directory Summary</span>
                          </h4>
                          <span className="text-[11px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                            Total Visits: {profileData.overview.total_visits || 0} ({profileData.overview.completed_visits || 0} completed)
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <span className="text-slate-400 font-medium text-[11px]">Latest Visit / Doctor:</span>
                            <div className="font-bold text-slate-800 mt-0.5">
                              {profileData.overview.last_visit_date ? `${profileData.overview.last_visit_date} ${profileData.overview.last_visit_time ? `(${profileData.overview.last_visit_time})` : ""}` : "No prior visits"}
                            </div>
                            <div className="text-[11px] text-slate-600 font-medium mt-0.5">
                              {profileData.overview.last_doctor ? `${profileData.overview.last_doctor} • ${profileData.overview.last_specialization || "OPD"}` : "—"}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              {profileData.overview.last_visit_type || "Consultation"} • {profileData.overview.last_cabin || "Cabin 1"}
                            </div>
                          </div>
                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <span className="text-slate-400 font-medium text-[11px]">Next Scheduled Appointment:</span>
                            <div className="font-bold text-[#126868] mt-0.5">
                              {profileData.overview.next_appointment_date ? `${profileData.overview.next_appointment_date} ${profileData.overview.next_appointment_time ? `(${profileData.overview.next_appointment_time})` : ""}` : "None scheduled"}
                            </div>
                            <div className="text-[11px] text-slate-600 font-medium mt-0.5">
                              {profileData.overview.next_doctor ? `${profileData.overview.next_doctor} • ${profileData.overview.next_specialization || "OPD"}` : "Open for booking"}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              {profileData.overview.next_visit_type || "Follow-up / Routine"}
                            </div>
                          </div>
                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <span className="text-slate-400 font-medium text-[11px]">Chief Clinical Reason / Symptoms:</span>
                            <div className="font-medium text-slate-700 italic line-clamp-2 mt-0.5">
                              {profileData.overview.last_reason ? `"${profileData.overview.last_reason}"` : "Routine consultation / No specific complaint noted"}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              UIDAI Aadhaar: <span className="font-mono text-slate-600 font-semibold">{profileData.overview.aadhaar_number || "Not provided"}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Clinical Highlights Banner */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                          <span className="font-bold text-rose-800 flex items-center gap-1.5">
                            <FiAlertTriangle />
                            <span>Recorded Allergies</span>
                          </span>
                          <div className="mt-1">
                            {profileData.clinical.allergies.length === 0 ? (
                              <span className="text-slate-500">No known drug allergies reported.</span>
                            ) : (
                              profileData.clinical.allergies.map((a, i) => (
                                <span key={i} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px]">
                                  {a.allergen || a}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                          <span className="font-bold text-amber-800 flex items-center gap-1.5">
                            <FiActivity />
                            <span>Chronic Conditions</span>
                          </span>
                          <div className="mt-1">
                            {profileData.clinical.chronic_conditions.length === 0 ? (
                              <span className="text-slate-500">No chronic medical conditions listed.</span>
                            ) : (
                              profileData.clinical.chronic_conditions.map((c, i) => (
                                <span key={i} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[11px]">
                                  {c}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tab 2: Medical History */}
                  {activeTab === "history" && (
                    <div className="space-y-4 py-2">
                      <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                        <h4 className="font-bold text-slate-800 text-xs">Chronic Illnesses & Past Medical History</h4>
                        {profileData.clinical.chronic_conditions.length === 0 ? (
                          <p className="text-slate-500">No past hospitalizations, chronic diseases, or surgical history recorded.</p>
                        ) : (
                          <ul className="list-disc list-inside space-y-1 text-slate-700">
                            {profileData.clinical.chronic_conditions.map((item, idx) => (
                              <li key={idx} className="font-semibold">{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tab 3: Consultations */}
                  {activeTab === "consultations" && (
                    <div className="space-y-3 py-2">
                      {profileData.consultations.length === 0 ? (
                        <p className="text-slate-500 italic py-6 text-center">No clinical consultation encounters recorded yet.</p>
                      ) : (
                        profileData.consultations.map((c) => (
                          <div key={c.id} className="p-3 border border-slate-200 rounded-xl bg-slate-50/50 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#254d90] font-mono">{c.encounter_uid}</span>
                              <span className="text-slate-400">{c.date} • {c.doctor_name} ({c.specialization})</span>
                            </div>
                            <div className="text-slate-800">
                              <span className="font-semibold">Diagnosis: </span>
                              <span className="font-bold text-slate-900">{c.diagnosis}</span>
                            </div>
                            {c.chief_complaint && (
                              <div className="text-slate-600">
                                <span className="font-medium">Chief Complaint: </span>
                                <span>{c.chief_complaint}</span>
                              </div>
                            )}
                            {c.treatment_plan && (
                              <div className="text-slate-600">
                                <span className="font-medium">Advice / Plan: </span>
                                <span>{c.treatment_plan}</span>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 4: Prescriptions */}
                  {activeTab === "prescriptions" && (
                    <div className="space-y-3 py-2">
                      {profileData.prescriptions.length === 0 ? (
                        <p className="text-slate-500 italic py-6 text-center">No prescriptions issued yet.</p>
                      ) : (
                        profileData.prescriptions.map((rx) => (
                          <div key={rx.id} className="p-3 border border-slate-200 rounded-xl bg-slate-50/50 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#126868] font-mono">{rx.prescription_uid}</span>
                              <span className="text-slate-400">{rx.created_at} • {rx.doctor_name}</span>
                            </div>
                            <div className="font-semibold text-slate-800">Rx: {rx.diagnosis}</div>
                            <div className="space-y-1">
                              {rx.medicines.map((m, i) => (
                                <div key={i} className="text-[11px] text-slate-700 font-mono">
                                  • {m.name} ({m.dosage}) - {m.duration} {m.notes ? `[${m.notes}]` : ""}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 5: Laboratory */}
                  {activeTab === "lab" && (
                    <div className="space-y-3 py-2">
                      {profileData.laboratory.length === 0 ? (
                        <p className="text-slate-500 italic py-6 text-center">No diagnostic test orders placed yet.</p>
                      ) : (
                        profileData.laboratory.map((lo) => (
                          <div key={lo.id} className="p-3 border border-slate-200 rounded-xl bg-slate-50/50 flex items-center justify-between">
                            <div>
                              <div className="font-bold text-slate-900 font-mono">{lo.order_uid}</div>
                              <div className="text-slate-500">{lo.created_at} • Priority: {lo.priority}</div>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full font-bold text-xs bg-blue-50 text-blue-700 border border-blue-200">
                              {lo.status}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 6: Appointments */}
                  {activeTab === "appointments" && (
                    <div className="space-y-3 py-2">
                      {profileData.appointments.length === 0 ? (
                        <p className="text-slate-500 italic py-6 text-center">No appointments on record.</p>
                      ) : (
                        profileData.appointments.map((a) => (
                          <div key={a.id} className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/50 space-y-2.5">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-sm font-mono">
                                  {a.date}
                                </span>
                                <span className="text-xs text-slate-600 font-mono">
                                  ({a.time})
                                </span>
                                <span
                                  className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${
                                    a.status === "COMPLETED"
                                      ? "bg-slate-100 text-slate-700 border-slate-200"
                                      : a.status === "IN_CONSULTATION"
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : a.status === "CANCELLED"
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}
                                >
                                  {a.status}
                                </span>
                                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                  {a.visit_type}
                                </span>
                              </div>
                              <span className="text-xs text-slate-500">
                                Booked via <strong className="text-slate-700">{a.source}</strong>
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-slate-400 font-medium text-[11px]">Attending Doctor:</span>
                                <div className="font-bold text-slate-800">
                                  {a.doctor_name} <span className="font-normal text-slate-500">• {a.specialization}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Assigned Room: <strong className="text-slate-700">{a.cabin}</strong>
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400 font-medium text-[11px]">Billing & Aadhaar:</span>
                                <div className="text-slate-700">
                                  Fee: <strong className="text-slate-900">₹{a.paid_amount || 500}</strong> ({a.payment_method || "UPI"}) -{" "}
                                  <span className={`font-bold ${a.payment_status === "PAID" ? "text-emerald-600" : "text-amber-600"}`}>
                                    {a.payment_status || "PAID"}
                                  </span>
                                </div>
                                {a.aadhaar_number && a.aadhaar_number !== "-" && (
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    Aadhaar: <span className="font-mono text-slate-700">{a.aadhaar_number}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {a.notes && (
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs">
                                <span className="font-semibold text-slate-700">Reason / Clinical Complaint: </span>
                                <span className="text-slate-800 italic">{a.notes}</span>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 7: Billing */}
                  {activeTab === "billing" && (
                    <div className="space-y-2 py-2">
                      {profileData.billing.length === 0 ? (
                        <p className="text-slate-500 italic py-6 text-center">No invoices generated yet.</p>
                      ) : (
                        profileData.billing.map((inv) => (
                          <div key={inv.id} className="p-3 border border-slate-200 rounded-xl flex items-center justify-between">
                            <div>
                              <span className="font-bold font-mono text-slate-900">{inv.invoice_number}</span>
                              <div className="text-slate-500">{inv.created_at} • {inv.payment_method}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-slate-900">Total: ₹{inv.total.toLocaleString()}</div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                inv.payment_status === "PAID"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}>
                                {inv.payment_status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    onClick={() => setSelectedProfileId(null)}
                    className="btn-cancel"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
