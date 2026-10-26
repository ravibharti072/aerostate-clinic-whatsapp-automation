import React, { useState, useEffect } from "react";
import {
  FiUsers,
  FiUserCheck,
  FiUserX,
  FiShield,
  FiUserPlus,
  FiSearch,
  FiCheck,
  FiX,
  FiKey,
  FiRotateCw,
  FiEye,
  FiEyeOff,
  FiEdit2,
  FiPower,
  FiActivity,
  FiPackage,
  FiCalendar,
  FiInfo
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchClinicUsers,
  fetchUserOptions,
  createClinicUser,
  updateClinicUser,
  toggleUserStatus,
  resetUserPassword
} from "../api";

export default function UsersView() {
  const { showToast } = useToast();

  const [userData, setUserData] = useState(null);
  const [options, setOptions] = useState({ roles: [], doctors: [], staff_members: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filter state passed to backend
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Role architecture information catalogue
  const ROLES_INFO = {
    ALL: {
      id: "ALL",
      title: "All Clinic User Accounts",
      portal: "All Operational & Clinical Portals",
      icon: FiUsers,
      badge: "Full System View",
      badgeColor: "bg-slate-100 text-slate-800 border-slate-300",
      description: "Complete list of active and deactivated staff accounts across the entire clinic ERP suite. Click any role tab above to view its dedicated permissions, portal responsibilities, and active credentials.",
      permissions: [
        "View all registered clinic user accounts",
        "Create custom role logins with cabin assignments",
        "Securely reset credentials and login passwords",
        "Instantly deactivate departed personnel without data loss",
      ],
    },
    frontdesk: {
      id: "frontdesk",
      title: "Front Desk & Reception Portal",
      portal: "All Front Desk & Cashier Operations",
      icon: FiCalendar,
      badge: "Role: Frontdesk",
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
      description: "Equipped with comprehensive access to patient registration (Direct & WhatsApp), appointment bookings & rescheduling, WhatsApp live chats, waiting room token generation, doctor cabin assignments, and cashier billing.",
      permissions: [
        "Direct Walk-in & WhatsApp Patient Registration",
        "OPD Appointment Scheduling & Calendar Slot Booking",
        "Waiting Room Token Assignment & Check-in",
        "Live 2-Way Patient WhatsApp Chat Thread Management",
        "Cashier Billing, Payment Collection & PDF Invoicing",
      ],
    },
    doctor: {
      id: "doctor",
      title: "Doctor Clinical Portal",
      portal: "Dedicated OPD Cabin Workspace",
      icon: FiActivity,
      badge: "Role: Doctor",
      badgeColor: "bg-teal-50 text-[#126868] border-teal-200",
      description: "Restricted strictly to clinical OPD practice: doctors view their assigned cabin patient queue, call next patients to the cabin via WhatsApp, record vitals & SOAP progress notes, write digital prescriptions, order diagnostics, and sign clinical encounters.",
      permissions: [
        "Cabin-Specific Live OPD Waiting Room Roster",
        "One-Click WhatsApp Patient Calling ('Please Enter Cabin')",
        "Clinical Consultation Encounters & SOAP Notes",
        "Digital Prescription (Rx) Creation & Advice",
        "Diagnostic Lab Orders & Pathologist Verification Access",
        "Finalize & Sign Clinical Encounter (Unblocks Dispense & Lab)",
      ],
    },
    pharma: {
      id: "pharma",
      title: "Pharmacy & Dispensary Portal",
      portal: "Dispensary & Medicine Inventory",
      icon: FiPackage,
      badge: "Role: Pharma",
      badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
      description: "Focused on medication fulfillment: batch inventory tracking, expiry alerts, dispensing signed doctor prescriptions, goods receipt notes (GRN), and dispensary cashier billing.",
      permissions: [
        "Live Prescription Dispensing Queue & Medication Fulfillment",
        "Atomic Batch Stock Decrement & Expiry Control",
        "Supplier Goods Receipt Note (GRN) Inbound Entry",
        "Stock Adjustment & Inventory Audit Trail Logging",
        "Medicine Counter Invoicing & Cashier Collection",
      ],
    },
    admin: {
      id: "admin",
      title: "Clinic Administrator Portal",
      portal: "Clinic Administration & ERP Control",
      icon: FiShield,
      badge: "Role: Admin",
      badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      description: "Full clinic administrative authority: staff user account provisioning, doctor specialization & shift scheduling, financial & operational KPI analytics, database maintenance, and WhatsApp webhook diagnostics.",
      permissions: [
        "Staff User Account Provisioning & Password Resets",
        "Doctor Specialist Cabin & Schedule Configuration",
        "Duty Shifts & Weekly Staff Coverage Allocation",
        "Clinic Financial, Operational & Patient Loyalty Analytics",
        "System Security & Meta WhatsApp Webhook Integration",
      ],
    },
  };

  // Create User Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    staff_id: "",
    name: "",
    username: "",
    password: "",
    role: "frontdesk",
    doctor_id: "",
    specialization: "General Consultation",
    is_active: true,
  });
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [savingUser, setSavingUser] = useState(false);

  // Edit User Modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editUser, setEditUser] = useState({
    id: null,
    staff_id: "",
    name: "",
    username: "",
    role: "frontdesk",
    doctor_id: "",
    is_active: true,
    password: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset Password Modal
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [savingReset, setSavingReset] = useState(false);

  // 100% Backend Data Fetching (Zero Frontend Calculation)
  const loadData = async (opts = {}) => {
    try {
      const pageToUse = opts.page !== undefined ? opts.page : currentPage;
      const sizeToUse = opts.pageSize !== undefined ? opts.pageSize : pageSize;
      const roleToUse = opts.role !== undefined ? opts.role : roleFilter;
      const statusToUse = opts.status !== undefined ? opts.status : statusFilter;
      const searchToUse = opts.search !== undefined ? opts.search : search;

      const [uRes, optRes] = await Promise.all([
        fetchClinicUsers({
          page: pageToUse,
          page_size: sizeToUse,
          role: roleToUse,
          status: statusToUse,
          search: searchToUse,
        }),
        fetchUserOptions().catch(() => ({ roles: [], doctors: [], staff_members: [] })),
      ]);

      setUserData(uRes);
      setOptions(optRes || { roles: [], doctors: [], staff_members: [] });
    } catch (err) {
      console.error("Failed to load users:", err);
      showToast(err.message || "Failed to load clinic users", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData({ page: currentPage, pageSize, role: roleFilter, status: statusFilter });
  }, [roleFilter, statusFilter, currentPage, pageSize]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(1);
    loadData({ page: 1, search });
  };

  const handleClearFilters = () => {
    setSearch("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
    setCurrentPage(1);
    loadData({ page: 1, search: "", role: "ALL", status: "ALL" });
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    setCreateForm({
      staff_id: "",
      name: "",
      username: "",
      password: "",
      role: "frontdesk",
      doctor_id: options.doctors?.[0]?.id ? String(options.doctors[0].id) : "",
      specialization: "General Consultation",
      is_active: true,
    });
    setShowCreatePassword(false);
    setIsCreateOpen(true);
  };

  // Handle Staff Selection in Create Modal
  const handleCreateStaffSelect = (staffIdStr) => {
    if (!staffIdStr) {
      setCreateForm((prev) => ({
        ...prev,
        staff_id: "",
      }));
      return;
    }
    const staffId = Number(staffIdStr);
    const selectedStaff = options.staff_members?.find((s) => s.id === staffId);
    if (!selectedStaff) return;

    const staffName = selectedStaff.name || "";
    const cleanSlug = staffName
      .toLowerCase()
      .replace(/^(dr\.|dr\s+|nurse\.|mr\.|mrs\.|ms\.)/i, "")
      .trim()
      .replace(/[^a-z0-9]/g, "");

    const suggestedRole = selectedStaff.suggested_role || "frontdesk";

    let matchingDoctorId = "";
    if (suggestedRole === "doctor" && options.doctors) {
      const doc = options.doctors.find(
        (d) =>
          d.name.toLowerCase().includes(staffName.toLowerCase()) ||
          staffName.toLowerCase().includes(d.name.toLowerCase())
      );
      if (doc) matchingDoctorId = String(doc.id);
    }

    setCreateForm((prev) => ({
      ...prev,
      staff_id: staffIdStr,
      name: staffName,
      username: prev.username ? prev.username : cleanSlug,
      role: suggestedRole,
      doctor_id: matchingDoctorId || prev.doctor_id,
      specialization: selectedStaff.department || prev.specialization,
    }));
  };

  // Submit Create User
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.username.trim() || !createForm.password.trim()) {
      showToast("Please fill in all required fields", "error");
      return;
    }

    setSavingUser(true);
    try {
      const payload = {
        staff_id: createForm.staff_id ? Number(createForm.staff_id) : null,
        name: createForm.name.trim(),
        username: createForm.username.trim().toLowerCase(),
        password: createForm.password.trim(),
        role: createForm.role,
        doctor_id: createForm.role === "doctor" && createForm.doctor_id ? Number(createForm.doctor_id) : null,
        specialization: createForm.specialization,
        is_active: createForm.is_active,
      };

      const res = await createClinicUser(payload);
      showToast(res.message || "User account created successfully!", "success");
      setIsCreateOpen(false);
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to create user", "error");
    } finally {
      setSavingUser(false);
    }
  };

  // Open Edit Modal (includes User Name / Login ID editing)
  const handleOpenEdit = (u) => {
    setEditUser({
      id: u.id,
      staff_id: u.staff_id ? String(u.staff_id) : "",
      name: u.name,
      username: u.username,
      role: (u.role || "frontdesk").toLowerCase(),
      doctor_id: u.doctor_id ? String(u.doctor_id) : "",
      is_active: u.is_active,
      password: "",
    });
    setIsEditOpen(true);
  };

  // Handle Staff Selection in Edit Modal
  const handleEditStaffSelect = (staffIdStr) => {
    if (!staffIdStr) {
      setEditUser((prev) => ({ ...prev, staff_id: "" }));
      return;
    }
    const staffId = Number(staffIdStr);
    const selectedStaff = options.staff_members?.find((s) => s.id === staffId);
    if (!selectedStaff) return;

    const staffName = selectedStaff.name || "";
    const suggestedRole = selectedStaff.suggested_role || editUser.role;

    let matchingDoctorId = editUser.doctor_id;
    if (suggestedRole === "doctor" && options.doctors) {
      const doc = options.doctors.find(
        (d) =>
          d.name.toLowerCase().includes(staffName.toLowerCase()) ||
          staffName.toLowerCase().includes(d.name.toLowerCase())
      );
      if (doc) matchingDoctorId = String(doc.id);
    }

    setEditUser((prev) => ({
      ...prev,
      staff_id: staffIdStr,
      name: staffName,
      role: suggestedRole,
      doctor_id: matchingDoctorId,
    }));
  };

  // Submit Edit User
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editUser.name.trim() || !editUser.username.trim()) {
      showToast("Staff Name and User Name are required", "error");
      return;
    }

    setSavingEdit(true);
    try {
      const payload = {
        staff_id: editUser.staff_id ? Number(editUser.staff_id) : null,
        name: editUser.name.trim(),
        username: editUser.username.trim().toLowerCase(),
        role: editUser.role,
        doctor_id: editUser.role === "doctor" && editUser.doctor_id ? Number(editUser.doctor_id) : null,
        is_active: editUser.is_active,
      };
      if (editUser.password && editUser.password.trim()) {
        payload.password = editUser.password.trim();
      }

      const res = await updateClinicUser(editUser.id, payload);
      showToast(res.message || "User updated successfully", "success");
      setIsEditOpen(false);
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to update user", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle Active Status
  const handleToggleStatus = async (userId, username) => {
    try {
      const res = await toggleUserStatus(userId);
      showToast(res.message || `Status updated for ${username}`, "info");
      loadData();
    } catch (err) {
      showToast(err.message || "Failed to toggle status", "error");
    }
  };

  // Open Reset Password
  const handleOpenReset = (u) => {
    setResetUser(u);
    setNewPassword("");
    setShowResetPassword(false);
    setIsResetOpen(true);
  };

  // Submit Reset Password
  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (!newPassword.trim() || newPassword.trim().length < 4) {
      showToast("Password must be at least 4 characters long", "error");
      return;
    }

    setSavingReset(true);
    try {
      const res = await resetUserPassword(resetUser.id, newPassword.trim());
      showToast(res.message || "Password reset successfully", "success");
      setIsResetOpen(false);
    } catch (err) {
      showToast(err.message || "Failed to reset password", "error");
    } finally {
      setSavingReset(false);
    }
  };

  // Data from backend directly (Zero calculation on frontend)
  const usersList = userData?.users || [];
  const stats = userData?.stats || {
    total_users: 0,
    active_users: 0,
    doctors_count: 0,
    frontdesk_count: 0,
    pharma_count: 0,
    admins_count: 0,
  };
  const pagination = userData?.pagination || {
    total_items: 0,
    total_pages: 1,
    current_page: 1,
    page_size: 20,
  };

  const currentRoleInfo = ROLES_INFO[roleFilter] || ROLES_INFO["ALL"];
  const hasActiveFilters = Boolean(search || roleFilter !== "ALL" || statusFilter !== "ALL");

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="CLINIC ACCESS & PERMISSIONS"
        title="Staff User Accounts & Custom Portals"
        icon={FiShield}
        showDateTime={true}
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
              title="Refresh User List"
            >
              <FiRotateCw className={`refresh-icon ${refreshing ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={handleOpenCreate}
              className="portal-action-btn portal-action-btn-blue flex items-center gap-2"
            >
              <FiUserPlus size={16} />
              <span>Create New User</span>
            </button>
          </div>
        }
      />

      {/* KPI Stat Cards (Calculated 100% on Backend) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Staff Users"
          value={stats.total_users}
          Icon={FiUsers}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Doctor Portals"
          value={stats.doctors_count}
          Icon={FiActivity}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Front Desk Accounts"
          value={stats.frontdesk_count}
          Icon={FiCalendar}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Pharmacy Accounts"
          value={stats.pharma_count}
          Icon={FiPackage}
          colorTheme="brand-teal"
        />
      </div>

      {/* Role Architecture Explanatory Option Tabs (Pending Dispatch Style) */}
      <div className="wa-tabs-container">
        <button
          type="button"
          onClick={() => { setRoleFilter("ALL"); setCurrentPage(1); }}
          className={`wa-tab-btn ${roleFilter === "ALL" ? "active" : ""}`}
        >
          <FiUsers size={15} />
          <span>All Roles ({stats.total_users || 0})</span>
        </button>
        <button
          type="button"
          onClick={() => { setRoleFilter("frontdesk"); setCurrentPage(1); }}
          className={`wa-tab-btn ${roleFilter === "frontdesk" ? "active" : ""}`}
        >
          <FiCalendar size={15} />
          <span>Front Desk ({stats.frontdesk_count || 0})</span>
        </button>
        <button
          type="button"
          onClick={() => { setRoleFilter("doctor"); setCurrentPage(1); }}
          className={`wa-tab-btn ${roleFilter === "doctor" ? "active" : ""}`}
        >
          <FiActivity size={15} />
          <span>Doctors ({stats.doctors_count || 0})</span>
        </button>
        <button
          type="button"
          onClick={() => { setRoleFilter("pharma"); setCurrentPage(1); }}
          className={`wa-tab-btn ${roleFilter === "pharma" ? "active" : ""}`}
        >
          <FiPackage size={15} />
          <span>Pharmacy ({stats.pharma_count || 0})</span>
        </button>
        <button
          type="button"
          onClick={() => { setRoleFilter("admin"); setCurrentPage(1); }}
          className={`wa-tab-btn ${roleFilter === "admin" ? "active" : ""}`}
        >
          <FiShield size={15} />
          <span>Clinic Admin ({stats.admins_count || 0})</span>
        </button>
      </div>

      {/* Role Explanation Card for Selected Role */}
      {currentRoleInfo && (
        <div className="bg-white border border-slate-200 rounded-xl p-4.5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-slate-100 text-slate-800 font-bold">
                <currentRoleInfo.icon size={18} />
              </span>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{currentRoleInfo.title}</h4>
                <span className="text-xs text-slate-500 font-medium">{currentRoleInfo.portal}</span>
              </div>
            </div>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${currentRoleInfo.badgeColor}`}>
              {currentRoleInfo.badge}
            </span>
          </div>

          <p className="mt-3 text-xs text-slate-600 leading-relaxed">
            {currentRoleInfo.description}
          </p>

          <div className="mt-3.5 pt-3 border-t border-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Authorized Portal Capabilities:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {currentRoleInfo.permissions.map((perm, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-700 rounded-md text-[11px] font-medium"
                >
                  <FiCheck className="text-emerald-600 shrink-0" size={12} />
                  <span>{perm}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Staff User Accounts Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title="Staff User Accounts"
          description="Every staff account is created and managed directly by the clinic administrator with custom portal permissions."
          badgeCount={pagination.total_items}
          badgeLabel="user accounts"
        />

        {/* Account Status Tabs (Same pill-option design as All Roles) */}
        <div className="wa-tabs-container mb-3.5">
          <button
            type="button"
            onClick={() => { setStatusFilter("ALL"); setCurrentPage(1); }}
            className={`wa-tab-btn ${statusFilter === "ALL" ? "active" : ""}`}
          >
            <FiUsers size={15} />
            <span>All Accounts ({stats.total_users || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setStatusFilter("ACTIVE"); setCurrentPage(1); }}
            className={`wa-tab-btn ${statusFilter === "ACTIVE" ? "active" : ""}`}
          >
            <FiUserCheck size={15} />
            <span>Active Accounts ({stats.active_users || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setStatusFilter("INACTIVE"); setCurrentPage(1); }}
            className={`wa-tab-btn ${statusFilter === "INACTIVE" ? "active" : ""}`}
          >
            <FiUserX size={15} />
            <span>Deactivated Accounts ({Math.max(0, (stats.total_users || 0) - (stats.active_users || 0))})</span>
          </button>
        </div>

        {statusFilter === "INACTIVE" && (
          <div className="mb-3.5 p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
            <FiShield className="shrink-0 text-amber-600 mt-0.5" size={16} />
            <div>
              <span className="font-bold">Deactivated User Logins Archive:</span> These staff accounts have been deactivated and cannot log into any clinic portal. Historical activities and audit trail records remain preserved. Click <strong className="text-emerald-700">Activate</strong> in the actions column to restore access.
            </div>
          </div>
        )}

        {/* Controls & Toolbar (Filtered directly on backend) */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search by User Name, Staff Name, or Role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={() => {
              setCurrentPage(1);
              loadData({ page: 1, search });
            }}
            onClear={handleClearFilters}
          />

          <div className="dir-toolbar-right">
            <select
              className="dir-filter-select"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="ALL">All Roles</option>
              <option value="frontdesk">Front Desk / Reception</option>
              <option value="doctor">Doctors / Specialists</option>
              <option value="pharma">Pharmacist / Inventory</option>
              <option value="admin">Clinic Administrators</option>
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
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Data Grid Table (Data Rendered Directly from Backend) */}
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
          </div>
        ) : usersList.length === 0 ? (
          <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
            <FiUsers className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-800">
              {hasActiveFilters ? "No matching staff accounts found" : "No user accounts registered"}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {hasActiveFilters
                ? "Try clearing your search query or role filter."
                : "Create login accounts for your receptionists, doctors, and pharmacists so they can access their dedicated portals."}
            </p>
            {!hasActiveFilters && (
              <button
                onClick={handleOpenCreate}
                className="mt-4 portal-action-btn portal-action-btn-blue inline-flex items-center gap-1.5"
              >
                <FiUserPlus size={15} />
                <span>Create First User</span>
              </button>
            )}
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master User Accounts Directory</span>
              <span className="text-xs font-semibold text-slate-500">
                {stats.active_users} active • {stats.total_users} total accounts
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
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>USER NAME (LOGIN ID)</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STAFF NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ROLE &amp; PORTAL ACCESS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>LINKED SPECIALIST / CABIN</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CREATED BY</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CREATED DATE</th>
                    <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((u) => (
                    <tr key={u.id} className={!u.is_active ? "opacity-60 bg-slate-50" : ""}>
                      {/* User Name / Login ID */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                          <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                            {u.username}
                          </span>
                          {u.is_self && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-sans px-1.5 py-0.2 rounded font-bold">
                              You
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Staff Name */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">{u.name}</span>
                          {u.staff_uid && (
                            <span
                              className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200 font-mono"
                              title={`Linked to staff directory profile ${u.staff_uid}`}
                            >
                              {u.staff_uid}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Role & Portal Badge (Pre-computed on Backend) */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border text-[11px] ${
                              u.role_theme === "teal"
                                ? "bg-teal-50 text-teal-800 border-teal-200"
                                : u.role_theme === "blue"
                                ? "bg-blue-50 text-blue-800 border-blue-200"
                                : u.role_theme === "purple"
                                ? "bg-purple-50 text-purple-800 border-purple-200"
                                : "bg-emerald-50 text-emerald-800 border-emerald-200"
                            }`}
                          >
                            {u.is_doctor && <FiActivity size={11} />}
                            {u.is_frontdesk && <FiCalendar size={11} />}
                            {u.is_pharma && <FiPackage size={11} />}
                            {u.is_admin && <FiShield size={11} />}
                            <span>{u.role_display}</span>
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            ({u.portal_name})
                          </span>
                        </div>
                      </td>

                      {/* Linked Doctor / Scope (Pre-computed on Backend) */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {u.is_doctor ? (
                          <span className="font-semibold text-[#126868]">
                            {u.doctor_display}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Clinic-wide</span>
                        )}
                      </td>

                      {/* Created By (Audit Tracking) */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-xs text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                          {u.created_by}
                        </span>
                      </td>

                      {/* Account Status */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border text-[11px] ${
                            u.status_theme === "emerald"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.status_theme === "emerald" ? "bg-emerald-500" : "bg-rose-500"
                            }`}
                          />
                          <span>{u.status_display}</span>
                        </span>
                      </td>

                      {/* Created Date */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-slate-600">{u.created_date_display}</span>
                      </td>

                      {/* Actions */}
                      <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {u.can_reset_password && (
                            <button
                              type="button"
                              onClick={() => handleOpenReset(u)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition cursor-pointer inline-flex items-center gap-1 shadow-xs"
                              title="Reset account password"
                            >
                              <FiKey size={12} />
                              <span>Reset Password</span>
                            </button>
                          )}

                          {u.can_edit && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(u)}
                              className="px-2 py-1 text-xs font-semibold rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer inline-flex items-center gap-1"
                              title="Edit user details and username"
                            >
                              <FiEdit2 size={12} />
                              <span>Edit</span>
                            </button>
                          )}

                          {u.can_deactivate && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(u.id, u.username)}
                              className={`px-2 py-1 text-xs font-semibold rounded-md transition cursor-pointer inline-flex items-center gap-1 ${
                                u.is_active
                                  ? "bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200"
                                  : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200"
                              }`}
                              title={u.is_active ? "Deactivate user" : "Activate user"}
                            >
                              <FiPower size={12} />
                              <span>{u.is_active ? "Deactivate" : "Activate"}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination using Backend-calculated totals */}
            <Pagination
              currentPage={pagination.current_page}
              totalItems={pagination.total_items}
              pageSize={pagination.page_size}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="staff users"
            />
          </div>
        )}
      </section>

      {/* CREATE NEW USER MODAL (With explicit Create User Name option) */}
      {isCreateOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Create Clinic User Account</h2>
                <div className="modal-kicker">
                  Created and authorized by clinic administrator
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsCreateOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body space-y-4">
                <div className="form-group">
                  <label className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">Select Staff Member (from Staff Directory)</span>
                    <span className="text-[11px] font-normal text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                      Auto-fills Name &amp; Role
                    </span>
                  </label>
                  <select
                    value={createForm.staff_id}
                    onChange={(e) => handleCreateStaffSelect(e.target.value)}
                    className="font-medium text-slate-800"
                  >
                    <option value="">-- Choose from Staff Directory (or enter custom name below) --</option>
                    {options.staff_members?.map((stf) => (
                      <option key={stf.id} value={stf.id}>
                        {stf.display_label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Staff Member Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dr. Priya Verma, Rajesh Sharma, Sneha Patil"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Create User Name (Login ID) *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. dr.priya, frontdesk1, pharma1"
                      value={createForm.username}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""),
                        })
                      }
                      className="font-mono"
                    />
                    <span className="text-[11px] text-slate-400 mt-0.5">
                      Unique lowercase login username
                    </span>
                  </div>

                  <div className="form-group">
                    <label>Login Password *</label>
                    <div className="relative">
                      <input
                        type={showCreatePassword ? "text" : "password"}
                        required
                        placeholder="Minimum 4 characters"
                        value={createForm.password}
                        onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                        style={{ paddingRight: "36px" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreatePassword(!showCreatePassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      >
                        {showCreatePassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Assigned System Role &amp; Portal *</label>
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                    className="font-bold text-slate-800"
                  >
                    {options.roles?.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {createForm.role === "doctor" && (
                  <div className="p-3.5 bg-teal-50/70 border border-teal-200 rounded-xl space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#126868]">
                      <FiActivity size={14} />
                      <span>Doctor Specialist Profile Configuration</span>
                    </div>

                    <div className="form-group m-0">
                      <label className="text-xs">Link to Existing Specialist (Optional)</label>
                      <select
                        value={createForm.doctor_id}
                        onChange={(e) => setCreateForm({ ...createForm, doctor_id: e.target.value })}
                      >
                        <option value="">-- Create new specialist profile from name --</option>
                        {options.doctors?.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.display_label || `${d.name} (${d.specialization})`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {!createForm.doctor_id && (
                      <div className="form-group m-0">
                        <label className="text-xs">Specialization / Department</label>
                        <input
                          type="text"
                          placeholder="e.g. Dentistry, Cardiology, Pediatrics, General Physician"
                          value={createForm.specialization}
                          onChange={(e) =>
                            setCreateForm({ ...createForm, specialization: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="info-box-note">
                  <FiInfo size={16} style={{ flexShrink: 0 }} />
                  <span>
                    Account will be created under the current Administrator. Permissions and sidebar navigation adapt automatically to the assigned role.
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{savingUser ? "Creating Account..." : "Create User Account"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL (With editable User Name option) */}
      {isEditOpen && editUser && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "520px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Edit Staff Account</h2>
                <div className="modal-kicker">
                  Modify credentials &amp; permissions
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsEditOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body space-y-4">
                <div className="form-group">
                  <label className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">Fetch / Sync from Staff Directory</span>
                    <span className="text-[11px] font-normal text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                      Direct Staff Sync
                    </span>
                  </label>
                  <select
                    value={editUser.staff_id}
                    onChange={(e) => handleEditStaffSelect(e.target.value)}
                    className="font-medium text-slate-800"
                  >
                    <option value="">-- Select from Staff Directory (or edit name below) --</option>
                    {options.staff_members?.map((stf) => (
                      <option key={stf.id} value={stf.id}>
                        {stf.display_label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Staff Member Full Name *</label>
                  <input
                    type="text"
                    required
                    value={editUser.name}
                    onChange={(e) => setEditUser({ ...editUser, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>User Name (Login ID) *</label>
                  <input
                    type="text"
                    required
                    value={editUser.username}
                    onChange={(e) =>
                      setEditUser({
                        ...editUser,
                        username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""),
                      })
                    }
                    className="font-mono"
                  />
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Login identifier used to access the portal
                  </span>
                </div>

                <div className="form-group">
                  <label>Assigned Role *</label>
                  <select
                    value={editUser.role}
                    onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
                    className="font-bold"
                  >
                    {options.roles?.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {editUser.role === "doctor" && (
                  <div className="form-group">
                    <label>Link to Doctor Record</label>
                    <select
                      value={editUser.doctor_id}
                      onChange={(e) => setEditUser({ ...editUser, doctor_id: e.target.value })}
                    >
                      <option value="">-- Match by staff name --</option>
                      {options.doctors?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.display_label || `${d.name} (${d.specialization})`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label>Update Password (Optional)</label>
                  <input
                    type="password"
                    placeholder="Leave blank to keep current password"
                    value={editUser.password}
                    onChange={(e) => setEditUser({ ...editUser, password: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="edit_is_active"
                    checked={editUser.is_active}
                    onChange={(e) => setEditUser({ ...editUser, is_active: e.target.checked })}
                    className="h-4 w-4 text-[#254d90] rounded"
                  />
                  <label htmlFor="edit_is_active" className="text-xs font-bold text-slate-700 m-0 cursor-pointer">
                    Account is Active and allowed to sign in
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{savingEdit ? "Saving..." : "Save Changes"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {isResetOpen && resetUser && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "460px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Reset User Password</h2>
                <div className="modal-kicker">
                  Set a new password for {resetUser.name} ({resetUser.username})
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsResetOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleResetSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body space-y-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  You are resetting the password for User Name <strong>{resetUser.username}</strong>. The user will need this new password to sign in.
                </div>

                <div className="form-group">
                  <label>New Password *</label>
                  <div className="relative">
                    <input
                      type={showResetPassword ? "text" : "password"}
                      required
                      placeholder="Enter at least 4 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      style={{ paddingRight: "36px" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      {showResetPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsResetOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingReset}
                  className="btn-submit"
                >
                  <FiKey size={14} />
                  <span>{savingReset ? "Resetting..." : "Reset Password"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
