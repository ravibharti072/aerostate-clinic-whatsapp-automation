import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FiUsers,
  FiSearch,
  FiPlus,
  FiCalendar,
  FiClock,
  FiShield,
  FiX,
  FiPhone,
  FiMail,
  FiUserCheck,
  FiUserX,
  FiRotateCw,
  FiCheck,
  FiLayers,
  FiFilter,
  FiEdit2,
  FiPower
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchStaffStats,
  fetchStaffOptions,
  fetchStaff,
  createStaff,
  updateStaff,
  toggleStaffStatus,
  fetchDutyShifts,
  assignDutyShift,
  fetchDoctorRoster,
  fetchDoctors,
  fetchDoctorOptions,
  toggleDoctorStatus
} from "../api";
import DoctorModal from "./DoctorModal";

export default function StaffView({ initialTab = "directory" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [stats, setStats] = useState(null);
  const [staffOptions, setStaffOptions] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [doctorRoster, setDoctorRoster] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);

  // Active Tab: Directory, Specialists (next to Directory), Shifts, Doctor Consultation Schedule
  const queryParams = new URLSearchParams(location.search);
  const requestedTab = queryParams.get("tab") || initialTab || "directory";
  const [activeTab, setActiveTab] = useState(requestedTab);

  useEffect(() => {
    const tabParam = new URLSearchParams(location.search).get("tab");
    if (tabParam && ["directory", "departed", "specialists", "shifts", "doctor-roster"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [location.search]);

  // Tab 1 Filters: Staff Directory
  const [searchStaff, setSearchStaff] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");

  // Tab 2 Filters: Specialists
  const [searchDoctor, setSearchDoctor] = useState("");
  const [specFilter, setSpecFilter] = useState("ALL");
  const [doctorStatusFilter, setDoctorStatusFilter] = useState("ALL");
  const [doctorOptions, setDoctorOptions] = useState(null);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [isDoctorModalOpen, setIsDoctorModalOpen] = useState(false);
  const [togglingDoctorId, setTogglingDoctorId] = useState(null);

  // Tab 3 Filters: Duty Shifts
  const [searchShift, setSearchShift] = useState("");
  const [shiftStatusFilter, setShiftStatusFilter] = useState("ALL");

  // Pagination for all tabs (20 per page from LRS standard)
  const [pageStaff, setPageStaff] = useState(1);
  const [pageSizeStaff, setPageSizeStaff] = useState(20);

  const [pageDoctorTab, setPageDoctorTab] = useState(1);
  const [pageSizeDoctorTab, setPageSizeDoctorTab] = useState(20);

  const [pageShift, setPageShift] = useState(1);
  const [pageSizeShift, setPageSizeShift] = useState(20);

  const activeStaffList = useMemo(() => {
    return staffList.filter((s) => s.employment_status === "ACTIVE");
  }, [staffList]);

  const departedStaffList = useMemo(() => {
    return staffList.filter((s) => s.employment_status !== "ACTIVE");
  }, [staffList]);

  const currentStaffList = useMemo(() => {
    return activeTab === "departed" ? departedStaffList : activeStaffList;
  }, [activeTab, departedStaffList, activeStaffList]);

  const paginatedStaff = useMemo(() => {
    if (pageSizeStaff === "all") return currentStaffList;
    const start = (pageStaff - 1) * pageSizeStaff;
    return currentStaffList.slice(start, start + pageSizeStaff);
  }, [currentStaffList, pageStaff, pageSizeStaff]);

  // Specialists filtering & pagination
  const filteredDoctors = useMemo(() => {
    let list = doctors;
    if (searchDoctor.trim()) {
      const q = searchDoctor.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.name?.toLowerCase().includes(q) ||
          d.specialization?.toLowerCase().includes(q) ||
          d.available_days?.toLowerCase().includes(q)
      );
    }
    if (specFilter !== "ALL") {
      list = list.filter((d) => d.specialization === specFilter);
    }
    if (doctorStatusFilter !== "ALL") {
      const isActiveWanted = doctorStatusFilter === "ACTIVE";
      list = list.filter((d) => d.is_active === isActiveWanted);
    }
    return list;
  }, [doctors, searchDoctor, specFilter, doctorStatusFilter]);

  const paginatedDoctorsTab = useMemo(() => {
    if (pageSizeDoctorTab === "all") return filteredDoctors;
    const start = (pageDoctorTab - 1) * pageSizeDoctorTab;
    return filteredDoctors.slice(start, start + pageSizeDoctorTab);
  }, [filteredDoctors, pageDoctorTab, pageSizeDoctorTab]);

  const paginatedShifts = useMemo(() => {
    if (pageSizeShift === "all") return shifts;
    const start = (pageShift - 1) * pageSizeShift;
    return shifts.slice(start, start + pageSizeShift);
  }, [shifts, pageShift, pageSizeShift]);

  // Specialist Handlers
  const handleToggleDoctorStatus = async (docId) => {
    setTogglingDoctorId(docId);
    try {
      const res = await toggleDoctorStatus(docId);
      setDoctors((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, is_active: !d.is_active } : d))
      );
      showToast(res.message || "Specialist status updated successfully!", "success");
    } catch (err) {
      showToast("Failed to toggle specialist status: " + err.message, "error");
    } finally {
      setTogglingDoctorId(null);
    }
  };

  const handleOpenAddDoctor = () => {
    setSelectedDoctor(null);
    setIsDoctorModalOpen(true);
  };

  const handleOpenEditDoctor = (doc) => {
    setSelectedDoctor(doc);
    setIsDoctorModalOpen(true);
  };

  // Staff Profile Modal (Create & Edit)
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState(null);
  const [staffForm, setStaffForm] = useState({
    full_name: "",
    role_category: "Receptionist",
    department: "Front Desk & Registration",
    designation: "Staff Member",
    contact_phone: "",
    email: "",
    registration_number: "",
    employment_status: "ACTIVE",
    joining_date: "",
  });

  const handleOpenCreateStaff = () => {
    setEditingStaffId(null);
    setStaffForm({
      full_name: "",
      role_category: "Receptionist",
      department: "Front Desk & Registration",
      designation: "Staff Member",
      contact_phone: "",
      email: "",
      registration_number: "",
      employment_status: "ACTIVE",
      joining_date: new Date().toISOString().split("T")[0],
    });
    setIsAddStaffOpen(true);
  };

  const handleOpenEditStaff = (staffMember) => {
    setEditingStaffId(staffMember.id);
    setStaffForm({
      full_name: staffMember.full_name || "",
      role_category: staffMember.role_category || "Receptionist",
      department: staffMember.department || "",
      designation: staffMember.designation || "",
      contact_phone: staffMember.contact_phone || "",
      email: staffMember.email || "",
      registration_number: staffMember.registration_number || "",
      employment_status: staffMember.employment_status || "ACTIVE",
      joining_date: staffMember.joining_date || "",
    });
    setIsAddStaffOpen(true);
  };

  // Assign Shift Modal
  const [isAssignShiftOpen, setIsAssignShiftOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    staff_id: "",
    doctor_id: "",
    shift_name: "Morning OPD",
    shift_date: new Date().toISOString().split("T")[0],
    start_time: "09:00",
    end_time: "17:00",
    notes: "",
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [sData, shData, rData, dData, stData, optData, docOptData] = await Promise.all([
        fetchStaff({
          role: roleFilter !== "ALL" ? roleFilter : "",
          department: deptFilter !== "ALL" ? deptFilter : "",
          search: searchStaff,
        }),
        fetchDutyShifts({
          search: searchShift,
          status: shiftStatusFilter !== "ALL" ? shiftStatusFilter : "",
        }),
        fetchDoctorRoster(),
        fetchDoctors(true),
        fetchStaffStats(),
        fetchStaffOptions(),
        fetchDoctorOptions().catch(() => null),
      ]);
      setStaffList(sData || []);
      setShifts(shData || []);
      setDoctorRoster(rData || []);
      setDoctors(dData || []);
      setStats(stData || null);
      setStaffOptions(optData || null);
      if (docOptData) setDoctorOptions(docOptData);
    } catch (err) {
      console.error("Staff load error:", err);
      showToast(err.message || "Failed to load staff records", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter Handlers for Tab 1
  const handleFilterStaff = async (
    q = searchStaff,
    rf = roleFilter,
    df = deptFilter
  ) => {
    try {
      const data = await fetchStaff({
        search: q,
        role: rf !== "ALL" ? rf : "",
        department: df !== "ALL" ? df : "",
      });
      setStaffList(data || []);
    } catch (err) {
      showToast("Failed to filter staff directory", "error");
    }
  };

  const handleClearStaffFilters = () => {
    setSearchStaff("");
    setRoleFilter("ALL");
    setDeptFilter("ALL");
    handleFilterStaff("", "ALL", "ALL");
  };

  // Filter Handlers for Tab 2
  const handleFilterShifts = async (q = searchShift, st = shiftStatusFilter) => {
    try {
      const data = await fetchDutyShifts({
        search: q,
        status: st !== "ALL" ? st : "",
      });
      setShifts(data || []);
    } catch (err) {
      showToast("Failed to filter duty shifts", "error");
    }
  };

  const handleClearShiftFilters = () => {
    setSearchShift("");
    setShiftStatusFilter("ALL");
    handleFilterShifts("", "ALL");
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    try {
      const rawDigits = (staffForm.contact_phone || "").replace(/\D/g, "");
      const clean10 = rawDigits.startsWith("91") && rawDigits.length > 10 ? rawDigits.slice(2) : rawDigits;
      const normalizedPhone = clean10.length === 10
        ? `+91${clean10}`
        : (staffForm.contact_phone.startsWith("+") ? staffForm.contact_phone : `+91${clean10}`);

      const payload = {
        ...staffForm,
        contact_phone: normalizedPhone,
      };

      if (editingStaffId) {
        await updateStaff(editingStaffId, payload);
        showToast("Staff profile updated successfully!", "success");
      } else {
        await createStaff(payload);
        showToast("Staff member profile created successfully!", "success");
      }
      setIsAddStaffOpen(false);
      setEditingStaffId(null);
      setStaffForm({
        full_name: "",
        role_category: "Receptionist",
        department: "Front Desk & Registration",
        designation: "Staff Member",
        contact_phone: "",
        email: "",
        registration_number: "",
        employment_status: "ACTIVE",
        joining_date: "",
      });
      loadData();
    } catch (err) {
      showToast(err.message || `Failed to ${editingStaffId ? "update" : "create"} staff member`, "error");
    }
  };

  const handleToggleStaff = async (staffMember) => {
    const isDeactivating = staffMember.employment_status === "ACTIVE";
    const confirmMsg = isDeactivating
      ? `Deactivate ${staffMember.full_name}? They will be marked as departed and moved to the "Past & Deactivated Staff" section. Past clinical records and shifts are fully preserved.`
      : `Reactivate ${staffMember.full_name} back to the Active Staff Directory?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await toggleStaffStatus(staffMember.id);
      showToast(res.message || "Staff status updated successfully", "success");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to update staff status", "error");
    }
  };

  const handleAssignShift = async (e) => {
    e.preventDefault();
    if (!shiftForm.staff_id) {
      showToast("Please select a staff member", "error");
      return;
    }
    try {
      await assignDutyShift({
        staff_id: parseInt(shiftForm.staff_id),
        doctor_id: shiftForm.doctor_id ? parseInt(shiftForm.doctor_id) : null,
        shift_name: shiftForm.shift_name,
        shift_date: shiftForm.shift_date,
        start_time: shiftForm.start_time,
        end_time: shiftForm.end_time,
        notes: shiftForm.notes,
      });
      setIsAssignShiftOpen(false);
      loadData();
      showToast("Shift assigned successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to assign shift", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Administration"
        title="Staff Directory, Roles & Duty Scheduling"
        icon={FiShield}
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Staff &amp; Specialists Data"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={() => setIsAssignShiftOpen(true)}
              className="portal-action-btn portal-action-btn-blue flex items-center gap-1.5"
            >
              <FiCalendar size={15} />
              <span>Assign Shift</span>
            </button>
            <button
              onClick={handleOpenCreateStaff}
              className="portal-action-btn flex items-center gap-1.5"
            >
              <FiPlus size={16} />
              <span>Add Staff Member</span>
            </button>
            <button
              type="button"
              onClick={handleOpenAddDoctor}
              className="portal-action-btn portal-action-btn-teal flex items-center gap-1.5"
            >
              <FiUserCheck size={16} />
              <span>Add Specialist</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/users")}
              className="portal-action-btn flex items-center gap-1.5"
              title="Manage login credentials & custom portals for staff"
            >
              <FiUsers size={15} />
              <span>User Portals &amp; Logins</span>
            </button>
          </div>
        }
      />

      {/* 4-Card Executive KPI Grid (aerostate-lrs Reusable Grid - Driven by Server) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Staff Members"
          value={stats?.total_staff ?? staffList.length}
          Icon={FiUsers}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Doctors & Specialists"
          value={stats?.doctors_count ?? 0}
          Icon={FiShield}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Assigned Shifts Today"
          value={stats?.shifts_today ?? 0}
          Icon={FiClock}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Support & Paramedical"
          value={stats?.clinical_support ?? 0}
          Icon={FiUserCheck}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Signature Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            activeTab === "specialists"
              ? "Specialists & Doctors"
              : activeTab === "shifts"
              ? "Staff Duty Shifts & Schedules"
              : activeTab === "departed"
              ? "Past & Deactivated Staff Directory"
              : "Active Staff Directory"
          }
          description={
            activeTab === "specialists"
              ? "Manage clinic specialists, their available days, and consultation slot durations."
              : activeTab === "shifts"
              ? "Manage clinical OPD duties, night coverage, front-desk duty slots, and timing allocations."
              : activeTab === "departed"
              ? "Historical personnel records for departed and inactive staff. Credentials, prescriptions, and shift history remain permanently preserved."
              : "Official personnel registry tracking active clinic employees, professional designations, and license credentials."
          }
          badgeCount={
            activeTab === "specialists"
              ? doctors.length
              : activeTab === "shifts"
              ? shifts.length
              : activeTab === "departed"
              ? departedStaffList.length
              : activeStaffList.length
          }
          badgeLabel={
            activeTab === "specialists"
              ? "specialists"
              : activeTab === "shifts"
              ? "duty assignments"
              : activeTab === "departed"
              ? "departed staff"
              : "active staff"
          }
        />

        {/* TABS NAVIGATION (Positioned below Section Header & Description) */}
        <div className="wa-tabs-container">
          <button
            type="button"
            onClick={() => { setActiveTab("directory"); setPageStaff(1); }}
            className={`wa-tab-btn ${activeTab === "directory" ? "active" : ""}`}
          >
            <FiUsers size={15} />
            <span>Active Staff ({activeStaffList.length})</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("departed"); setPageStaff(1); }}
            className={`wa-tab-btn ${activeTab === "departed" ? "active" : ""}`}
          >
            <FiUserX size={15} />
            <span>Past &amp; Deactivated Staff ({departedStaffList.length})</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("specialists"); setPageDoctorTab(1); }}
            className={`wa-tab-btn ${activeTab === "specialists" ? "active" : ""}`}
          >
            <FiUserCheck size={15} />
            <span>Specialists ({doctors.length})</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("shifts"); setPageShift(1); }}
            className={`wa-tab-btn ${activeTab === "shifts" ? "active" : ""}`}
          >
            <FiClock size={15} />
            <span>Duty Shifts &amp; Schedules ({shifts.length})</span>
          </button>
        </div>

        {/* ======================================================== */}
        {/* Tab 1 & 2: Active or Departed Staff Directory            */}
        {/* ======================================================== */}
        {(activeTab === "directory" || activeTab === "departed") && (
          <>
            {activeTab === "departed" && (
              <div className="mb-3.5 p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
                <FiShield className="shrink-0 text-amber-600 mt-0.5" size={16} />
                <div>
                  <span className="font-bold">Departed &amp; Deactivated Personnel Archive:</span> These staff members have departed the clinic or are currently inactive. All historical clinical records, prescriptions, and shift logs are permanently retained for medical audit compliance. Click <strong className="text-emerald-700">Reactivate</strong> if an employee returns to the clinic.
                </div>
              </div>
            )}
            <div className="dir-controls">
            <SearchBar
              placeholder="Search by staff name, ID, phone, department, or designation..."
              value={searchStaff}
              onChange={(e) => setSearchStaff(e.target.value)}
              onSearch={() => handleFilterStaff(searchStaff, roleFilter, deptFilter)}
              onClear={() => {
                setSearchStaff("");
                handleFilterStaff("", roleFilter, deptFilter);
              }}
            />

            <div className="dir-filter-group flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setRoleFilter(val);
                  handleFilterStaff(searchStaff, val, deptFilter);
                }}
                className="dir-select"
                style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              >
                <option value="ALL">All Staff Roles</option>
                {(staffOptions?.role_categories || [
                  "Doctor",
                  "Receptionist",
                  "Nurse",
                  "Lab Technician",
                  "Pharmacist",
                  "Billing Staff",
                  "Clinic Administrator",
                ])
                  .filter((r) => r !== "ALL")
                  .map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
              </select>

              <select
                value={deptFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setDeptFilter(val);
                  handleFilterStaff(searchStaff, roleFilter, val);
                }}
                className="dir-select"
                style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              >
                <option value="ALL">All Departments</option>
                {(staffOptions?.departments || [
                  "Dentistry & Maxillofacial",
                  "General OPD",
                  "Diagnostic Pathology",
                  "Central Pharmacy",
                  "Front Desk & Registration",
                  "Administration",
                  "Nursing & Patient Care",
                ])
                  .filter((d) => d !== "ALL")
                  .map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={() => handleFilterStaff(searchStaff, roleFilter, deptFilter)}
                className="btn-submit"
                style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
              >
                Search
              </button>

              {(searchStaff || roleFilter !== "ALL" || deptFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={handleClearStaffFilters}
                  className="btn-cancel"
                  style={{ width: "auto", height: "34px", padding: "0 12px", fontSize: "12.5px" }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master Staff Directory (Scroll horizontally to view all columns)</span>
              <span className="text-xs font-semibold text-slate-500">
                Showing {currentStaffList.length} staff member{currentStaffList.length === 1 ? "" : "s"}
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
              <table className="data-grid-table" style={{ minWidth: "1200px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STAFF ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STAFF NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ROLE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DEPARTMENT</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DESIGNATION</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CONTACT PHONE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>REG. / LICENSE NO.</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>JOINING DATE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {currentStaffList.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="text-center py-8 text-slate-500" style={{ fontSize: "12px" }}>
                        {activeTab === "departed"
                          ? "No departed or deactivated staff members in the archive."
                          : "No active staff members found matching your search criteria."}
                      </td>
                    </tr>
                  ) : (
                    paginatedStaff.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                            {s.staff_uid}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold text-slate-900">{s.full_name}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-semibold text-slate-800">{s.role_category}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-700 font-medium">{s.department || "—"}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-600">{s.designation || "—"}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-semibold text-slate-700">
                            {s.contact_phone}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-slate-600">
                            {s.registration_number || "Not required"}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-slate-600">
                            {s.joining_date}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-bold border ${
                              s.employment_status === "ACTIVE"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                            style={{ fontSize: "11px" }}
                          >
                            {s.employment_status}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditStaff(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-slate-100 text-slate-700 border border-slate-200 hover:bg-[#254d90] hover:text-white transition cursor-pointer"
                              title="Edit Staff Member Details"
                            >
                              <FiEdit2 size={12} />
                              <span>Edit</span>
                            </button>
                            {s.employment_status === "ACTIVE" ? (
                              <button
                                type="button"
                                onClick={() => handleToggleStaff(s)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                                title="Deactivate departed staff member (Preserves history & moves to Departed section)"
                              >
                                <FiUserX size={12} />
                                <span>Deactivate</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleToggleStaff(s)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-600 hover:text-white transition cursor-pointer"
                                title="Reactivate staff member back to active duty"
                              >
                                <FiUserCheck size={12} />
                                <span>Reactivate</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={pageStaff}
              totalItems={currentStaffList.length}
              pageSize={pageSizeStaff}
              onPageChange={(p) => setPageStaff(p)}
              onPageSizeChange={(sz) => {
                setPageSizeStaff(sz);
                setPageStaff(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="staff members"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Comprehensive employee records tracking clinical roles, medical council licenses, departments, and active employment status.
              </span>
            </div>
          </div>
        </>
      )}

      {/* ======================================================== */}
      {/* Tab 2: Specialists (Doctors & Clinical Specialists)      */}
      {/* ======================================================== */}
      {activeTab === "specialists" && (
        <>
          {/* CONTROLS & TOOLBAR */}
          <div className="dir-controls">
            <SearchBar
              placeholder="Search by specialist name, specialty, or working days..."
              value={searchDoctor}
              onChange={(e) => {
                setSearchDoctor(e.target.value);
                setPageDoctorTab(1);
              }}
              onClear={() => {
                setSearchDoctor("");
                setPageDoctorTab(1);
              }}
            />

            <div className="dir-filter-group flex items-center gap-2">
              <select
                value={specFilter}
                onChange={(e) => {
                  setSpecFilter(e.target.value);
                  setPageDoctorTab(1);
                }}
                className="dir-select"
                style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              >
                <option value="ALL">All Specializations</option>
                {(doctorOptions?.specializations || [
                  "Dentist",
                  "General Physician",
                  "Pediatrician",
                  "Cardiologist",
                  "Dermatologist",
                  "Orthopedic",
                  "Gynecologist",
                  "ENT Specialist",
                ])
                  .filter((s) => s !== "ALL")
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>

              <select
                value={doctorStatusFilter}
                onChange={(e) => {
                  setDoctorStatusFilter(e.target.value);
                  setPageDoctorTab(1);
                }}
                className="dir-select"
                style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>

              {(searchDoctor || specFilter !== "ALL" || doctorStatusFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDoctor("");
                    setSpecFilter("ALL");
                    setDoctorStatusFilter("ALL");
                    setPageDoctorTab(1);
                  }}
                  className="btn-cancel"
                  style={{ width: "auto", height: "34px", padding: "0 12px", fontSize: "12.5px" }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Data Grid Table with 12px font & horizontal scroll */}
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master Specialist Records (Scroll horizontally to view all columns)</span>
              <span className="text-xs font-semibold text-slate-500">
                Showing {filteredDoctors.length} clinical specialist{filteredDoctors.length === 1 ? "" : "s"}
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
              <table className="data-grid-table" style={{ minWidth: "1150px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SPECIALIST NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SPECIALIZATION</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CONSULTATION FEE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>WORKING HOURS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SLOT INTERVAL</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>AVAILABLE DAYS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CONFIRMED BOOKINGS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="9" className="text-center py-12" style={{ fontSize: "12px" }}>
                        <div className="inline-block animate-spin rounded-full h-7 w-7 border-b-2 border-[#254d90]"></div>
                      </td>
                    </tr>
                  ) : filteredDoctors.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center py-12 text-slate-500" style={{ fontSize: "12px" }}>
                        No specialists found matching your search criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedDoctorsTab.map((doc) => {
                      const daysList = (doc.available_days_short || (doc.available_days || "").split(",")).map(
                        (d) => d.trim().slice(0, 3)
                      );

                      return (
                        <tr
                          key={doc.id}
                          className={!doc.is_active ? "opacity-75 bg-slate-50/50" : ""}
                        >
                          {/* Specialist Name */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-bold text-slate-900">{doc.name}</span>
                          </td>

                          {/* Specialization */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span
                              className="font-bold uppercase tracking-wider text-[#254d90] bg-[#254d90]/10 border border-[#254d90]/20 px-2.5 py-0.5 rounded-full"
                              style={{ fontSize: "11px" }}
                            >
                              {doc.specialization}
                            </span>
                          </td>

                          {/* Consultation Fee */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded">
                              ₹{doc.consultation_fee ?? 500}
                            </span>
                          </td>

                          {/* Working Hours */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-700">
                              <FiClock className="text-slate-400" size={12} />
                              <span>{doc.working_hours_display || `${doc.start_time} - ${doc.end_time}`}</span>
                            </div>
                          </td>

                          {/* Slot Interval */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-mono font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                              {doc.duration_display || `${doc.slot_duration_mins} mins`}
                            </span>
                          </td>

                          {/* Available Days */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <div className="flex flex-wrap gap-1">
                              {daysList.map((d, i) => (
                                <span
                                  key={i}
                                  className="bg-slate-100 text-slate-700 font-semibold px-1.5 py-0.5 rounded border border-slate-200"
                                  style={{ fontSize: "11px" }}
                                >
                                  {d}
                                </span>
                              ))}
                            </div>
                          </td>

                          {/* Confirmed Bookings */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-bold font-mono text-slate-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                              {doc.total_confirmed_bookings ?? 0} booked
                            </span>
                          </td>

                          {/* Status */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span
                              className={`badge-${doc.is_active ? "active" : "inactive"}`}
                              style={{ fontSize: "11px" }}
                            >
                              {doc.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>

                          {/* Actions */}
                          <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleDoctorStatus(doc.id)}
                                disabled={togglingDoctorId === doc.id}
                                title={doc.is_active ? "Deactivate Doctor" : "Activate Doctor"}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border transition cursor-pointer ${
                                  doc.is_active
                                    ? "text-rose-700 bg-rose-50 hover:bg-rose-600 hover:text-white border-rose-200"
                                    : "text-emerald-700 bg-emerald-50 hover:bg-emerald-600 hover:text-white border-emerald-200"
                                }`}
                              >
                                <FiPower size={12} />
                                <span>{doc.is_active ? "Deactivate" : "Activate"}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenEditDoctor(doc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#254d90] bg-[#254d90]/10 hover:bg-[#254d90] hover:text-white border border-[#254d90]/20 rounded-md transition cursor-pointer"
                              >
                                <FiEdit2 size={12} />
                                <span>Edit</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={pageDoctorTab}
              totalItems={filteredDoctors.length}
              pageSize={pageSizeDoctorTab}
              onPageChange={(p) => setPageDoctorTab(p)}
              onPageSizeChange={(sz) => {
                setPageSizeDoctorTab(sz);
                setPageDoctorTab(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="specialists"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Real-time physician availability roster used by automated WhatsApp appointment scheduling and OPD queue management.
              </span>
            </div>
          </div>
        </>
      )}

      {/* ======================================================== */}
      {/* Tab 3: Duty Shifts & Rosters (Every field side by side) */}
      {/* ======================================================== */}
      {activeTab === "shifts" && (
        <>
          <div className="dir-controls">
            <SearchBar
              placeholder="Search by staff member, role, or shift name..."
              value={searchShift}
              onChange={(e) => setSearchShift(e.target.value)}
              onSearch={() => handleFilterShifts(searchShift, shiftStatusFilter)}
              onClear={() => {
                setSearchShift("");
                handleFilterShifts("", shiftStatusFilter);
              }}
            />

            <div className="dir-filter-group flex items-center gap-2">
              <select
                value={shiftStatusFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setShiftStatusFilter(val);
                  handleFilterShifts(searchShift, val);
                }}
                className="dir-select"
                style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
              >
                <option value="ALL">All Shift Statuses</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              <button
                type="button"
                onClick={() => handleFilterShifts(searchShift, shiftStatusFilter)}
                className="btn-submit"
                style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
              >
                Search
              </button>

              {(searchShift || shiftStatusFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={handleClearShiftFilters}
                  className="btn-cancel"
                  style={{ width: "auto", height: "34px", padding: "0 12px", fontSize: "12.5px" }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master Staff Duty &amp; Shifts (Scroll horizontally to view all columns)</span>
              <span className="text-xs font-semibold text-slate-500">
                Showing {shifts.length} shift schedule{shifts.length === 1 ? "" : "s"}
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
              <table className="data-grid-table" style={{ minWidth: "1150px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DATE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STAFF ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STAFF MEMBER</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ROLE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SHIFT NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>TIMING</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>NOTES</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-8 text-slate-500" style={{ fontSize: "12px" }}>
                        No shift schedules found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedShifts.map((sh) => (
                      <tr key={sh.id}>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold font-mono text-slate-900">
                            {sh.shift_date}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                            {sh.staff_uid || `STF-${sh.staff_id}`}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-semibold text-slate-800">{sh.staff_name}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-600">{sh.role}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold text-[#254d90] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded" style={{ fontSize: "11px" }}>
                            {sh.shift_name}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-semibold text-slate-700">{sh.timing}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-600">{sh.notes || "—"}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200" style={{ fontSize: "11px" }}>
                            {sh.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={pageShift}
              totalItems={shifts.length}
              pageSize={pageSizeShift}
              onPageChange={(p) => setPageShift(p)}
              onPageSizeChange={(sz) => {
                setPageSizeShift(sz);
                setPageShift(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="shifts"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Verified clinical staffing allocations ensuring continuous emergency and outpatient healthcare coverage.
              </span>
            </div>
          </div>
        </>
      )}
    </section>

      {/* ======================================================== */}
      {/* Modal 1: Add Staff Profile                               */}
      {/* ======================================================== */}
      {isAddStaffOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>{editingStaffId ? "Edit Staff Member" : "Add Staff Member"}</h2>
                <div className="modal-kicker">
                  {editingStaffId
                    ? "Update personnel information, role category, or employment status"
                    : "Create new clinical or administrative employee profile"}
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsAddStaffOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveStaff} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dr. Rajesh Kumar"
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Role Category *</label>
                    <select
                      value={staffForm.role_category}
                      onChange={(e) => setStaffForm({ ...staffForm, role_category: e.target.value })}
                    >
                      {(staffOptions?.role_categories || [
                        "Doctor",
                        "Receptionist",
                        "Nurse",
                        "Lab Technician",
                        "Pharmacist",
                        "Billing Staff",
                        "Clinic Administrator",
                      ])
                        .filter((r) => r !== "ALL")
                        .map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Department</label>
                    <input
                      type="text"
                      list="dept-options"
                      placeholder="e.g. Outpatient, Dentistry"
                      value={staffForm.department}
                      onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })}
                    />
                    <datalist id="dept-options">
                      {(staffOptions?.departments || [
                        "Dentistry & Maxillofacial",
                        "General OPD",
                        "Diagnostic Pathology",
                        "Central Pharmacy",
                        "Front Desk & Registration",
                        "Administration",
                        "Nursing & Patient Care",
                      ])
                        .filter((d) => d !== "ALL")
                        .map((d) => (
                          <option key={d} value={d} />
                        ))}
                    </datalist>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Designation</label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Dental Surgeon, Staff Nurse"
                      value={staffForm.designation}
                      onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Contact Phone (10 Digits) *</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-slate-500 font-bold font-mono text-xs pointer-events-none select-none">
                        +91
                      </span>
                      <input
                        type="tel"
                        required
                        maxLength={15}
                        placeholder="98765 43210"
                        value={(staffForm.contact_phone || "").replace(/^\+?91/, "")}
                        onChange={(e) => {
                          const rawDigits = e.target.value.replace(/\D/g, "");
                          setStaffForm({ ...staffForm, contact_phone: rawDigits ? `+91${rawDigits}` : "" });
                        }}
                        className="font-mono w-full"
                        style={{ paddingLeft: "42px" }}
                      />
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Council Registration No.</label>
                    <input
                      type="text"
                      placeholder="MCI / DCI / PCI / INC No."
                      value={staffForm.registration_number}
                      onChange={(e) => setStaffForm({ ...staffForm, registration_number: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Official Email</label>
                    <input
                      type="email"
                      placeholder="e.g. staff@clinic.com"
                      value={staffForm.email}
                      onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Employment Status</label>
                    <select
                      value={staffForm.employment_status}
                      onChange={(e) => setStaffForm({ ...staffForm, employment_status: e.target.value })}
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Joining Date</label>
                    <input
                      type="date"
                      value={staffForm.joining_date || ""}
                      onChange={(e) => setStaffForm({ ...staffForm, joining_date: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAddStaffOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{editingStaffId ? "Update Staff Profile" : "Save Staff Profile"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal 2: Assign Duty Shift                               */}
      {/* ======================================================== */}
      {isAssignShiftOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Assign Duty Shift</h2>
                <div className="modal-kicker">Schedule clinical or administrative duty coverage</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsAssignShiftOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignShift} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Select Staff Member *</label>
                  <select
                    required
                    value={shiftForm.staff_id}
                    onChange={(e) => setShiftForm({ ...shiftForm, staff_id: e.target.value })}
                  >
                    <option value="">-- Choose Staff Member --</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} ({s.role_category} - {s.department})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Shift Name</label>
                    <select
                      value={shiftForm.shift_name}
                      onChange={(e) => setShiftForm({ ...shiftForm, shift_name: e.target.value })}
                    >
                      {(staffOptions?.shift_names || [
                        "Morning OPD",
                        "Evening OPD",
                        "Night Duty",
                        "Full Day Reception",
                      ]).map((sn) => (
                        <option key={sn} value={sn}>
                          {sn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Date *</label>
                    <input
                      type="date"
                      required
                      value={shiftForm.shift_date}
                      onChange={(e) => setShiftForm({ ...shiftForm, shift_date: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Start Time</label>
                    <input
                      type="time"
                      value={shiftForm.start_time}
                      onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>End Time</label>
                    <input
                      type="time"
                      value={shiftForm.end_time}
                      onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Shift Notes / Coverage Area</label>
                  <input
                    type="text"
                    placeholder="e.g. Front desk duty, Ward rounding"
                    value={shiftForm.notes}
                    onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAssignShiftOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>Assign Shift</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Doctor Modal for Add / Edit Specialist */}
      <DoctorModal
        isOpen={isDoctorModalOpen}
        onClose={() => setIsDoctorModalOpen(false)}
        doctor={selectedDoctor}
        onSaved={loadData}
      />
    </div>
  );
}
