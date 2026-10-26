import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FiShield,
  FiUsers,
  FiUserCheck,
  FiUserPlus,
  FiEdit2,
  FiTrash2,
  FiKey,
  FiCheckCircle,
  FiXCircle,
  FiSearch,
  FiLock,
  FiX,
  FiCheck,
  FiHome,
  FiPhoneCall,
  FiPlus,
  FiRefreshCw,
  FiSend,
  FiCalendar,
  FiClock,
  FiMail,
} from "react-icons/fi";
import PortalHeader from "../../components/portalheader/PortalHeader";
import StatCard from "../../components/statcard/StatCard";
import {
  fetchSuperAdminUsers,
  fetchSuperAdminStats,
  createSuperAdminUser,
  updateSuperAdminUser,
  deleteSuperAdminUser,
  fetchClinics,
  createClinic,
  updateClinic,
  deleteClinic,
  testClinicMeta,
  setClinicAdminCredentials,
} from "../../api";

export default function SuperAdminView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "admins" ? "admins" : "clinics";
  const [activeTab, setActiveTab] = useState(initialTab); // "clinics" or "admins"

  const [clinics, setClinics] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Meta Test State
  const [testingMetaId, setTestingMetaId] = useState(null);
  const [metaTestResult, setMetaTestResult] = useState(null);

  // Clinic Modal State
  const [isClinicModalOpen, setIsClinicModalOpen] = useState(false);
  const [editingClinic, setEditingClinic] = useState(null);
  const [clinicFormData, setClinicFormData] = useState({
    code: "",
    name: "",
    tagline: "",
    address: "",
    city: "Agra",
    state: "Uttar Pradesh",
    phone: "",
    email: "",
    operating_hours: "Mon-Sat: 09:00 AM - 08:00 PM",
    phone_number_id: "",
    display_phone_number: "",
    whatsapp_token: "",
    verify_token: "",
    is_active: true,
    admin_username: "",
    admin_password: "",
    admin_name: "",
  });
  const [clinicSaving, setClinicSaving] = useState(false);
  const [clinicError, setClinicError] = useState(null);

  // Clinic Admin Credentials Modal State
  const [isCredsModalOpen, setIsCredsModalOpen] = useState(false);
  const [selectedClinicForCreds, setSelectedClinicForCreds] = useState(null);
  const [credsFormData, setCredsFormData] = useState({
    username: "",
    name: "",
    password: "",
  });
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsError, setCredsError] = useState(null);
  const [credsSuccess, setCredsSuccess] = useState(null);

  // SuperAdmin User Modal State (Only for Platform Master Admins)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: "",
    name: "",
    password: "",
    role: "SuperAdmin",
    is_active: true,
  });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Reset password modal state
  const [passwordModalUser, setPasswordModalUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    const tabParam = searchParams.get("tab") === "admins" ? "admins" : "clinics";
    setActiveTab(tabParam);
  }, [searchParams]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, statsData, clinicsData] = await Promise.all([
        fetchSuperAdminUsers().catch(() => []),
        fetchSuperAdminStats().catch(() => null),
        fetchClinics().catch(() => []),
      ]);
      setUsers(usersData || []);
      setStats(statsData || null);
      setClinics(clinicsData || []);
    } catch (err) {
      console.error("Failed to load superadmin data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ------------------------------------
  // Clinic Branch Handlers
  // ------------------------------------
  const openCreateClinicModal = () => {
    setEditingClinic(null);
    const nextIdx = clinics.length + 1;
    setClinicFormData({
      code: `CLN-${String(nextIdx).padStart(3, "0")}`,
      name: "",
      tagline: "",
      address: "",
      city: "Agra",
      state: "Uttar Pradesh",
      phone: "",
      email: "",
      operating_hours: "Mon-Sat: 09:00 AM - 08:00 PM",
      phone_number_id: "",
      display_phone_number: "",
      whatsapp_token: "",
      verify_token: "",
      is_active: true,
      admin_username: `admin_cln${nextIdx}`,
      admin_password: "",
      admin_name: "",
    });
    setClinicError(null);
    setIsClinicModalOpen(true);
  };

  const openEditClinicModal = (c) => {
    setEditingClinic(c);
    setClinicFormData({
      code: c.code || "",
      name: c.name || "",
      tagline: c.tagline || "",
      address: c.address || "",
      city: c.city || "Agra",
      state: c.state || "Uttar Pradesh",
      phone: c.phone || "",
      email: c.email || "",
      operating_hours: c.operating_hours || "Mon-Sat: 09:00 AM - 08:00 PM",
      phone_number_id: c.phone_number_id || "",
      display_phone_number: c.display_phone_number || "",
      whatsapp_token: "",
      verify_token: c.verify_token || "",
      is_active: c.is_active,
      admin_username: c.admin_username || "",
      admin_password: "",
      admin_name: c.admin_name || "",
    });
    setClinicError(null);
    setIsClinicModalOpen(true);
  };

  const handleSaveClinic = async (e) => {
    e.preventDefault();
    setClinicError(null);
    setClinicSaving(true);

    try {
      const payload = { ...clinicFormData };
      if (!payload.whatsapp_token.trim()) {
        delete payload.whatsapp_token;
      }

      if (editingClinic) {
        delete payload.admin_username;
        delete payload.admin_password;
        delete payload.admin_name;
        await updateClinic(editingClinic.id, payload);
      } else {
        await createClinic(payload);
      }
      setIsClinicModalOpen(false);
      await loadData();
    } catch (err) {
      setClinicError(err.message || "Failed to save clinic branch");
    } finally {
      setClinicSaving(false);
    }
  };

  // ------------------------------------
  // Clinic Admin Credentials Handlers
  // ------------------------------------
  const openAdminCredsModal = (c) => {
    setSelectedClinicForCreds(c);
    setCredsFormData({
      username: c.admin_username || `admin_${(c.code || "cln").toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      name: c.admin_name || `${c.name} Admin`,
      password: "",
    });
    setCredsError(null);
    setCredsSuccess(null);
    setIsCredsModalOpen(true);
  };

  const handleSaveAdminCreds = async (e) => {
    e.preventDefault();
    setCredsError(null);
    setCredsSuccess(null);
    setCredsSaving(true);
    try {
      const res = await setClinicAdminCredentials(selectedClinicForCreds.id, credsFormData);
      setCredsSuccess(res.message || "Admin credentials updated successfully!");
      await loadData();
      setTimeout(() => {
        setIsCredsModalOpen(false);
        setCredsSuccess(null);
      }, 1000);
    } catch (err) {
      setCredsError(err.message || "Failed to configure clinic admin credentials");
    } finally {
      setCredsSaving(false);
    }
  };

  const handleDeleteClinic = async (c) => {
    if (!window.confirm(`Are you sure you want to deactivate clinic branch '${c.name}' (${c.code})?`)) {
      return;
    }
    try {
      await deleteClinic(c.id);
      loadData();
    } catch (err) {
      alert("Failed to deactivate clinic: " + err.message);
    }
  };

  const handleTestMeta = async (c) => {
    setTestingMetaId(c.id);
    setMetaTestResult(null);
    try {
      const res = await testClinicMeta(c.id);
      setMetaTestResult({ clinicId: c.id, ...res });
    } catch (err) {
      setMetaTestResult({ clinicId: c.id, success: false, error: err.message });
    } finally {
      setTestingMetaId(null);
    }
  };

  // ------------------------------------
  // SuperAdmin Platform Admin Handlers
  // ------------------------------------
  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({
      username: "",
      name: "",
      password: "",
      role: "SuperAdmin",
      is_active: true,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (u) => {
    setEditingUser(u);
    setFormData({
      username: u.username,
      name: u.name,
      password: "",
      role: "SuperAdmin",
      is_active: u.is_active,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    try {
      if (editingUser) {
        const updatePayload = {
          name: formData.name,
          role: "SuperAdmin",
          is_active: formData.is_active,
        };
        if (formData.password.trim()) {
          updatePayload.password = formData.password.trim();
        }
        await updateSuperAdminUser(editingUser.id, updatePayload);
      } else {
        await createSuperAdminUser({ ...formData, role: "SuperAdmin" });
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      setFormError(err.message || "Failed to save administrator");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (u) => {
    if (!window.confirm(`Are you sure you want to permanently delete administrator '${u.username}'?`)) {
      return;
    }
    try {
      await deleteSuperAdminUser(u.id);
      loadData();
    } catch (err) {
      alert("Failed to delete user: " + err.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!newPassword.trim()) return;

    setPasswordSaving(true);
    try {
      await updateSuperAdminUser(passwordModalUser.id, { password: newPassword.trim() });
      alert(`Password for '${passwordModalUser.username}' updated successfully!`);
      setPasswordModalUser(null);
      setNewPassword("");
    } catch (err) {
      alert("Failed to reset password: " + err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  // Only Platform SuperAdmins
  const superadminUsers = users.filter((u) => (u.role || "").toLowerCase() === "superadmin");

  const filteredClinics = clinics.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.code || "").toLowerCase().includes(q) ||
      (c.city || "").toLowerCase().includes(q) ||
      (c.phone_number_id || "").toLowerCase().includes(q)
    );
  });

  const filteredAdmins = superadminUsers.filter((u) => {
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
  });

  // Calculate newest clinic activation date
  const latestClinic = clinics.length > 0 ? clinics[clinics.length - 1] : null;

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Multi-Tenant SaaS Platform"
        title={
          activeTab === "clinics"
            ? "Registered Clinics & WhatsApp Routing"
            : "Platform Master Administrators"
        }
        description={
          activeTab === "clinics"
            ? "Manage registered clinic profiles, activation dates, contact information, and Meta WhatsApp Phone IDs."
            : "Manage master SuperAdmin logins with root access to the platform."
        }
        icon={activeTab === "clinics" ? FiHome : FiShield}
        rightAction={
          activeTab === "clinics" ? (
            <button
              onClick={openCreateClinicModal}
              className="portal-action-btn portal-action-btn-blue cursor-pointer"
            >
              <FiPlus size={16} />
              <span>Register New Clinic</span>
            </button>
          ) : (
            <button
              onClick={openCreateModal}
              className="portal-action-btn portal-action-btn-blue cursor-pointer"
            >
              <FiUserPlus size={16} />
              <span>Add SuperAdmin</span>
            </button>
          )
        }
      />

      {/* Primary Navigation Tabs */}
      <div className="wa-tabs-container">
        <button
          onClick={() => {
            setActiveTab("clinics");
            setSearchParams({ tab: "clinics" });
            setSearch("");
          }}
          className={`wa-tab-btn ${activeTab === "clinics" ? "active" : ""}`}
        >
          <FiHome size={15} />
          <span>Registered Clinics ({clinics.length})</span>
        </button>
        <button
          onClick={() => {
            setActiveTab("admins");
            setSearchParams({ tab: "admins" });
            setSearch("");
          }}
          className={`wa-tab-btn ${activeTab === "admins" ? "active" : ""}`}
        >
          <FiShield size={15} />
          <span>SuperAdmin Admins ({superadminUsers.length})</span>
        </button>
      </div>

      {/* Meta Test Live Feedback Banner */}
      {metaTestResult && (
        <div
          className={`p-4 rounded-2xl border transition-all ${
            metaTestResult.success
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              {metaTestResult.success ? (
                <FiCheckCircle className="text-emerald-600 shrink-0" size={20} />
              ) : (
                <FiXCircle className="text-rose-600 shrink-0" size={20} />
              )}
              <div>
                <h4 className="text-sm font-bold m-0">
                  {metaTestResult.success
                    ? "Meta WhatsApp Cloud API Connected Successfully!"
                    : "Meta WhatsApp Connection Failed"}
                </h4>
                {metaTestResult.success ? (
                  <p className="text-xs text-emerald-700 m-0 mt-0.5">
                    Display Phone: <strong>{metaTestResult.display_phone_number}</strong> | Verified Name:{" "}
                    <strong>{metaTestResult.verified_name}</strong> | Quality:{" "}
                    <span className="font-semibold uppercase">{metaTestResult.quality_rating || "NORMAL"}</span>
                  </p>
                ) : (
                  <p className="text-xs text-rose-700 m-0 mt-0.5">{metaTestResult.error}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setMetaTestResult(null)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
            >
              <FiX size={16} />
            </button>
          </div>
        </div>
      )}

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {activeTab === "clinics" ? (
          <>
            <StatCard
              title="Registered Clinics"
              value={clinics.length}
              Icon={FiHome}
              colorTheme="blue"
              trend="Multi-Tenant Platform"
            />
            <StatCard
              title="Active Clinics"
              value={clinics.filter((c) => c.is_active).length}
              Icon={FiCheckCircle}
              colorTheme="green"
              trend="Live & Operational"
            />
            <StatCard
              title="WhatsApp Configured"
              value={clinics.filter((c) => c.meta_configured).length}
              Icon={FiPhoneCall}
              colorTheme="teal"
              trend="Meta Routing Active"
            />
            <StatCard
              title="Latest Activation"
              value={latestClinic?.activation_date || "25 Oct 2026"}
              Icon={FiCalendar}
              colorTheme="purple"
              trend={latestClinic?.code || "CLN-001"}
            />
          </>
        ) : (
          <>
            <StatCard
              title="SuperAdmin Accounts"
              value={superadminUsers.length}
              Icon={FiShield}
              colorTheme="purple"
              trend="Root SaaS Authorities"
            />
            <StatCard
              title="Active Admins"
              value={superadminUsers.filter((u) => u.is_active).length}
              Icon={FiCheckCircle}
              colorTheme="green"
              trend="Active Sessions"
            />
            <StatCard
              title="Clinics Under Control"
              value={clinics.length}
              Icon={FiHome}
              colorTheme="blue"
              trend="Total Branches"
            />
            <StatCard
              title="WhatsApp Channels"
              value={clinics.filter((c) => c.phone_number_id).length}
              Icon={FiPhoneCall}
              colorTheme="teal"
              trend="Configured Numbers"
            />
          </>
        )}
      </div>

      {/* Search Bar */}
      <div className="lrs-card p-4">
        <div className="flex gap-3">
          <div className="flex-1 lrs-search-bar">
            <FiSearch className="text-[#254d90] shrink-0" size={16} />
            <input
              type="text"
              placeholder={
                activeTab === "clinics"
                  ? "Search by Clinic Name, Branch Code (CLN-001), City, or WhatsApp Phone ID..."
                  : "Search SuperAdmin by Username or Full Name..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* TAB 1: CLINICS DIRECTORY */}
      {activeTab === "clinics" && (
        <div className="lrs-card p-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
            </div>
          ) : filteredClinics.length === 0 ? (
            <div className="text-center py-20 px-4">
              <FiHome className="w-10 h-10 mx-auto text-slate-300 mb-3" />
              <h3 className="text-sm font-bold text-slate-800">No clinics registered</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Register a clinic branch with its Meta Phone Number ID to activate automated WhatsApp booking.
              </p>
              <button
                onClick={openCreateClinicModal}
                className="mt-4 bg-[#2d5696] hover:bg-[#234477] text-white font-medium text-xs px-4 py-2 rounded-xl transition cursor-pointer"
              >
                + Register First Clinic
              </button>
            </div>
          ) : (
            <div className="dir-table-wrapper">
              <div className="dir-scroll-bar-header">
                <span className="dir-scroll-hint">
                  ⇄ Multi-Tenant Clinics (Clinic Details, Activation Dates & WhatsApp Routing)
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  Showing {filteredClinics.length} clinic{filteredClinics.length === 1 ? "" : "s"}
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
                <table className="data-grid-table" style={{ minWidth: "1100px", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CODE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CLINIC NAME & ADDRESS</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PRIMARY ADMIN ID</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ACTIVATION DATE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>WHATSAPP PHONE ID</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CONTACT / DISPLAY PHONE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>OPERATING HOURS</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                      <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClinics.map((c) => {
                      return (
                        <tr key={c.id}>
                          {/* 1. CODE */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                              {c.code}
                            </span>
                          </td>

                          {/* 2. CLINIC NAME & ADDRESS */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 text-sm">{c.name}</span>
                              {c.tagline && (
                                <span className="text-[11px] text-slate-500 italic">{c.tagline}</span>
                              )}
                              <span className="text-[11px] text-slate-500 mt-0.5">
                                {c.address ? `${c.address}, ` : ""}{c.city}, {c.state}
                              </span>
                            </div>
                          </td>

                          {/* 3. PRIMARY ADMIN ID */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            {c.admin_username ? (
                              <div className="flex flex-col">
                                <span className="inline-flex items-center gap-1 font-mono font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs w-fit">
                                  <FiKey size={11} className="text-amber-600" />
                                  {c.admin_username}
                                </span>
                                {c.admin_name && (
                                  <span className="text-[10px] text-slate-500 mt-0.5 font-medium">
                                    {c.admin_name}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openAdminCredsModal(c)}
                                className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded border border-amber-200 cursor-pointer font-semibold"
                              >
                                <FiKey size={11} /> + Create Admin
                              </button>
                            )}
                          </td>

                          {/* 3. ACTIVATION DATE */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <FiCalendar size={13} className="text-emerald-600" />
                              <span>{c.activation_date || "25 Oct 2026"}</span>
                            </span>
                          </td>

                          {/* 4. WHATSAPP PHONE ID */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            {c.phone_number_id ? (
                              <div className="flex flex-col">
                                <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-xs">
                                  {c.phone_number_id}
                                </span>
                                <span className="text-[10px] text-teal-700 font-semibold mt-0.5">
                                  {c.has_custom_token ? "Custom WABA Token" : "Master Token"}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                Not Configured
                              </span>
                            )}
                          </td>

                          {/* 5. CONTACT / DISPLAY PHONE */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <div className="flex flex-col">
                              <span className="font-mono font-semibold text-slate-800 text-xs">
                                {c.display_phone_number || c.phone || "—"}
                              </span>
                              {c.email && (
                                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                                  <FiMail size={11} /> {c.email}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 6. OPERATING HOURS */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                              <FiClock size={12} className="text-slate-400" />
                              <span>{c.operating_hours || "Mon-Sat: 09:00 AM - 08:00 PM"}</span>
                            </span>
                          </td>

                          {/* 7. STATUS */}
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span
                              className={`badge-${c.is_active ? "active" : "inactive"}`}
                              style={{ fontSize: "11px" }}
                            >
                              {c.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>

                          {/* 8. ACTIONS */}
                          <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                title="Test Meta WhatsApp Connection"
                                disabled={testingMetaId === c.id}
                                onClick={() => handleTestMeta(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-emerald-700 bg-emerald-50 hover:bg-emerald-600 hover:text-white border border-emerald-200 transition cursor-pointer disabled:opacity-50"
                              >
                                {testingMetaId === c.id ? (
                                  <FiRefreshCw className="animate-spin" size={12} />
                                ) : (
                                  <FiSend size={12} />
                                )}
                                <span>Test</span>
                              </button>

                              <button
                                type="button"
                                title="Set / Reset Clinic Admin Credentials (ID & Password)"
                                onClick={() => openAdminCredsModal(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-amber-800 bg-amber-50 hover:bg-amber-600 hover:text-white border border-amber-200 transition cursor-pointer"
                              >
                                <FiKey size={12} />
                                <span>Admin Pass</span>
                              </button>

                              <button
                                type="button"
                                title="Edit Clinic Profile"
                                onClick={() => openEditClinicModal(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-[#254d90] bg-[#254d90]/10 hover:bg-[#254d90] hover:text-white border border-[#254d90]/20 transition cursor-pointer"
                              >
                                <FiEdit2 size={12} />
                                <span>Edit</span>
                              </button>

                              {c.is_active && (
                                <button
                                  type="button"
                                  title="Deactivate Clinic"
                                  onClick={() => handleDeleteClinic(c)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-rose-700 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200 transition cursor-pointer"
                                >
                                  <FiTrash2 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="dir-scroll-bar-footer">
                <span className="text-xs text-slate-500 font-medium">
                  WhatsApp automation automatically routes patient messages to the clinic matched with the receiving Phone Number ID.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PLATFORM MASTER ADMINS */}
      {activeTab === "admins" && (
        <div className="lrs-card p-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
            </div>
          ) : filteredAdmins.length === 0 ? (
            <div className="text-center py-20 px-4">
              <FiShield className="w-10 h-10 mx-auto text-slate-300 mb-3" />
              <h3 className="text-sm font-bold text-slate-800">No SuperAdmin administrators found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Create platform master administrators to manage registered clinics and platform settings.
              </p>
              <button
                onClick={openCreateModal}
                className="mt-4 bg-[#2d5696] hover:bg-[#234477] text-white font-medium text-xs px-4 py-2 rounded-xl transition cursor-pointer"
              >
                + Create SuperAdmin Administrator
              </button>
            </div>
          ) : (
            <div className="dir-table-wrapper">
              <div className="dir-scroll-bar-header">
                <span className="dir-scroll-hint">⇄ Platform Master Administrators (Root SaaS Authority)</span>
                <span className="text-xs font-semibold text-slate-500">
                  Showing {filteredAdmins.length} SuperAdmin{filteredAdmins.length === 1 ? "" : "s"}
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
                <table className="data-grid-table" style={{ minWidth: "900px", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ADMIN USERNAME</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>FULL NAME</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ROLE AUTHORITY</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ACTIVATION DATE</th>
                      <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdmins.map((u) => {
                      return (
                        <tr key={u.id}>
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-mono font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              {u.username}
                            </span>
                          </td>

                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-bold text-slate-900">{u.name}</span>
                          </td>

                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full font-bold border bg-purple-50 text-purple-700 border-purple-200"
                              style={{ fontSize: "11px" }}
                            >
                              SuperAdmin (Master Platform Access)
                            </span>
                          </td>

                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span
                              className={`badge-${u.is_active ? "active" : "inactive"}`}
                              style={{ fontSize: "11px" }}
                            >
                              {u.status_display}
                            </span>
                          </td>

                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <span className="font-mono text-slate-700">{u.created_date_display}</span>
                          </td>

                          <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                title="Reset Password"
                                onClick={() => {
                                  setPasswordModalUser(u);
                                  setNewPassword("");
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-amber-700 bg-amber-50 hover:bg-amber-600 hover:text-white border border-amber-200 transition cursor-pointer"
                              >
                                <FiKey size={12} />
                                <span>Reset Password</span>
                              </button>

                              <button
                                type="button"
                                title="Edit Admin"
                                onClick={() => openEditModal(u)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-[#254d90] bg-[#254d90]/10 hover:bg-[#254d90] hover:text-white border border-[#254d90]/20 transition cursor-pointer"
                              >
                                <FiEdit2 size={12} />
                                <span>Edit</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT CLINIC MODAL */}
      {isClinicModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl p-6 relative animate-in fade-in zoom-in-95 duration-150 my-8">
            <button
              onClick={() => setIsClinicModalOpen(false)}
              className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <FiX size={18} />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="portal-header-icon-box">
                <FiHome size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 m-0">
                  {editingClinic ? "Edit Clinic Profile" : "Register New Clinic"}
                </h2>
                <p className="text-xs text-slate-500 m-0 mt-0.5">
                  Configure clinic profile, activation details, and Meta WhatsApp Phone Number ID
                </p>
              </div>
            </div>

            {clinicError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {clinicError}
              </div>
            )}

            <form onSubmit={handleSaveClinic} className="space-y-4 text-xs sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Clinic Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apex Health & Dental Clinic"
                    value={clinicFormData.name}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Branch Code (Unique) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CLN-002"
                    value={clinicFormData.code}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, code: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono font-bold uppercase focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tagline / Speciality Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Multi-Specialty Dental & General OPD Consultation"
                  value={clinicFormData.tagline}
                  onChange={(e) => setClinicFormData({ ...clinicFormData, tagline: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                />
              </div>

              {/* Meta WhatsApp Section Highlight */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center space-x-2">
                  <FiPhoneCall className="text-[#254d90]" size={16} />
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                    Meta WhatsApp Routing Configuration
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Meta Phone Number ID *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 584285741438920"
                      value={clinicFormData.phone_number_id}
                      onChange={(e) =>
                        setClinicFormData({ ...clinicFormData, phone_number_id: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                    />
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      Routes incoming Meta WhatsApp messages to this clinic
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Display WhatsApp Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91 97584 82859"
                      value={clinicFormData.display_phone_number}
                      onChange={(e) =>
                        setClinicFormData({ ...clinicFormData, display_phone_number: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                    />
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      Shown to patients in booking confirmations
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Dedicated WhatsApp Access Token (Optional)
                    </label>
                    <input
                      type="password"
                      placeholder={
                        editingClinic?.has_custom_token
                          ? "•••••••• (Leave blank to keep existing)"
                          : "Leave blank to inherit platform Master Token"
                      }
                      value={clinicFormData.whatsapp_token}
                      onChange={(e) =>
                        setClinicFormData({ ...clinicFormData, whatsapp_token: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Verify Token (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Leave blank to use default verify token"
                      value={clinicFormData.verify_token}
                      onChange={(e) =>
                        setClinicFormData({ ...clinicFormData, verify_token: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Physical Location & Hours */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 14, Commercial Center"
                    value={clinicFormData.address}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, address: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City & State
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="City"
                      value={clinicFormData.city}
                      onChange={(e) => setClinicFormData({ ...clinicFormData, city: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-900"
                    />
                    <input
                      type="text"
                      placeholder="State"
                      value={clinicFormData.state}
                      onChange={(e) => setClinicFormData({ ...clinicFormData, state: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +91 97584 82859"
                    value={clinicFormData.phone}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Operating Hours
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Mon-Sat: 09:00 AM - 08:00 PM"
                    value={clinicFormData.operating_hours}
                    onChange={(e) =>
                      setClinicFormData({ ...clinicFormData, operating_hours: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                  />
                </div>
              </div>

              {/* Primary Clinic Admin Initial Credentials */}
              {!editingClinic && (
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-3">
                  <div className="flex items-center space-x-2">
                    <FiKey className="text-amber-600" size={16} />
                    <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider m-0">
                      Primary Clinic Admin Account (Initial Login Credentials)
                    </h4>
                  </div>
                  <p className="text-[11px] text-amber-900/80 m-0">
                    SuperAdmin provisions the initial Admin ID & password so this clinic's manager can log in and manage doctors, staff, and appointments independently.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Admin Login ID (Username) *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. agra_admin"
                        value={clinicFormData.admin_username}
                        onChange={(e) =>
                          setClinicFormData({ ...clinicFormData, admin_username: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Admin Initial Password *
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="Min 4 characters (e.g. AeroPass@2026)"
                        value={clinicFormData.admin_password}
                        onChange={(e) =>
                          setClinicFormData({ ...clinicFormData, admin_password: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Admin Full Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. Rajesh / Clinic Manager"
                      value={clinicFormData.admin_name}
                      onChange={(e) =>
                        setClinicFormData({ ...clinicFormData, admin_name: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white text-slate-900"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="clinicActiveToggle"
                  checked={clinicFormData.is_active}
                  onChange={(e) =>
                    setClinicFormData({ ...clinicFormData, is_active: e.target.checked })
                  }
                  className="w-4 h-4 text-[#254d90] rounded border-slate-300 focus:ring-[#254d90]"
                />
                <label
                  htmlFor="clinicActiveToggle"
                  className="text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Active Clinic (Accepting Appointments & WhatsApp messages)
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsClinicModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={clinicSaving}
                  className="portal-action-btn portal-action-btn-blue cursor-pointer"
                >
                  {clinicSaving ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <FiCheck size={16} />
                      <span>{editingClinic ? "Save Changes" : "Register Clinic"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLINIC ADMIN CREDENTIALS MODAL */}
      {isCredsModalOpen && selectedClinicForCreds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setIsCredsModalOpen(false)}
              className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <FiX size={18} />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="portal-header-icon-box" style={{ background: "rgba(245, 158, 11, 0.12)", color: "#d97706" }}>
                <FiKey size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 m-0">Clinic Admin Credentials</h2>
                <p className="text-xs text-slate-500 m-0 mt-0.5">
                  Manage primary login ID and password for <strong>{selectedClinicForCreds.name}</strong> ({selectedClinicForCreds.code})
                </p>
              </div>
            </div>

            {credsError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                <FiXCircle size={14} className="shrink-0" />
                <span>{credsError}</span>
              </div>
            )}

            {credsSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2">
                <FiCheckCircle size={14} className="shrink-0" />
                <span>{credsSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSaveAdminCreds} className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinic Admin Login ID (Username) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. agra_admin"
                  value={credsFormData.username}
                  onChange={(e) => setCredsFormData({ ...credsFormData, username: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white text-slate-900"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Used by the clinic manager to log into their clinic portal
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Admin Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Clinic Administrator"
                  value={credsFormData.name}
                  onChange={(e) => setCredsFormData({ ...credsFormData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {selectedClinicForCreds.admin_username ? "New Password *" : "Initial Password *"}
                </label>
                <input
                  type="password"
                  required
                  placeholder="Min 4 characters (e.g. ClinicPass@2026)"
                  value={credsFormData.password}
                  onChange={(e) => setCredsFormData({ ...credsFormData, password: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white text-slate-900"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  SuperAdmin sets this password. Share it securely with the clinic manager.
                </span>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCredsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={credsSaving}
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  {credsSaving ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <FiCheck size={14} />
                      <span>Save Credentials</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE / EDIT SUPERADMIN MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <FiX size={18} />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="portal-header-icon-box">
                <FiShield size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 m-0">
                  {editingUser ? "Edit SuperAdmin" : "Create SuperAdmin"}
                </h2>
                <p className="text-xs text-slate-500 m-0 mt-0.5">
                  Configure root platform master administrator account
                </p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SuperAdmin Username *
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingUser)}
                  placeholder="e.g. master_admin"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Platform Administrator"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {editingUser ? "New Password (Leave blank to keep existing)" : "Password *"}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  placeholder={editingUser ? "••••••••" : "Enter secure master password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="userActiveToggle"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 text-[#254d90] rounded border-slate-300 focus:ring-[#254d90]"
                />
                <label htmlFor="userActiveToggle" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Active Administrator (Can sign in to SuperAdmin console)
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="portal-action-btn portal-action-btn-blue cursor-pointer"
                >
                  {saving ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <FiCheck size={16} />
                      <span>{editingUser ? "Save Changes" : "Create SuperAdmin"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setPasswordModalUser(null)}
              className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <FiX size={18} />
            </button>

            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center">
                <FiKey size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 m-0">Reset Password</h3>
                <p className="text-xs text-slate-500 m-0 mt-0.5">
                  SuperAdmin: <strong className="font-mono text-slate-800">{passwordModalUser.username}</strong>
                </p>
              </div>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Master Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter new master password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#254d90]/20 focus:border-[#254d90] bg-white text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPasswordModalUser(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordSaving || !newPassword.trim()}
                  className="portal-action-btn portal-action-btn-blue cursor-pointer"
                >
                  {passwordSaving ? "Updating..." : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
