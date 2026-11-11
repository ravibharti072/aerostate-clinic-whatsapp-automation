import React, { useState, useEffect } from "react";
import {
  FiSettings,
  FiHome,
  FiGlobe,
  FiClock,
  FiCalendar,
  FiShield,
  FiUsers,
  FiEdit3,
  FiSave,
  FiX,
  FiRotateCw,
  FiCheckCircle,
  FiAlertCircle,
  FiActivity,
  FiFileText,
  FiPhone,
  FiMail,
  FiMapPin,
  FiLayers,
  FiLock,
  FiEye,
  FiEyeOff,
  FiCheck,
  FiCopy,
  FiAward,
  FiCheckSquare
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import { useToast } from "../context/ToastContext";
import { fetchSettings, updateSettings, testMetaConnection } from "../api";
import SyncSettingsCard from "./SyncSettingsCard";
import UpdateSettingsCard from "./UpdateSettingsCard";
import "./settings.css";

export default function SettingsView() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState("facility");
  const [loading, setLoading] = useState(true);
  const [isEditingFacility, setIsEditingFacility] = useState(false);
  const [isEditingPolicies, setIsEditingPolicies] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);

  // Copy feedback states
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Status and submission states
  const [savingSection, setSavingSection] = useState(null);
  const [testingMeta, setTestingMeta] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Master Form Data
  const [formData, setFormData] = useState({
    clinic_name: "",
    clinic_tagline: "",
    clinic_reg_no: "",
    clinic_address: "",
    clinic_city: "",
    clinic_state: "",
    clinic_phone: "",
    clinic_email: "",
    clinic_hours: "",
    
    // WhatsApp Meta API
    whatsapp_token: "",
    phone_number_id: "",
    verify_token: "",

    // Clinical Policies & TATs
    opd_slot_duration: 15,
    checkin_grace_period: 15,
    emergency_tat: 30,
    lab_tat_standard: 24,
    followup_days: 7,

    // Security
    admin_current_password: "",
    admin_new_password: "",
    admin_confirm_password: ""
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await fetchSettings();
      if (data) {
        setSubscriptionInfo(data);
        setFormData(prev => ({
          ...prev,
          clinic_name: data.clinic_name ?? "",
          clinic_tagline: data.clinic_tagline ?? "",
          clinic_reg_no: data.clinic_reg_no ?? "",
          clinic_address: data.clinic_address ?? "",
          clinic_city: data.clinic_city ?? "",
          clinic_state: data.clinic_state ?? "",
          clinic_phone: data.clinic_phone ?? "",
          clinic_email: data.clinic_email ?? "",
          clinic_hours: data.clinic_hours ?? "",
          whatsapp_token: data.whatsapp_token || "",
          phone_number_id: data.phone_number_id || "",
          verify_token: data.verify_token || "",
          opd_slot_duration: data.opd_slot_duration ?? prev.opd_slot_duration,
          checkin_grace_period: data.checkin_grace_period ?? prev.checkin_grace_period,
          emergency_tat: data.emergency_tat ?? prev.emergency_tat,
          lab_tat_standard: data.lab_tat_standard ?? prev.lab_tat_standard,
          followup_days: data.followup_days ?? prev.followup_days
        }));
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
      showToast("Failed to load settings configuration.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveFacility = async (e) => {
    e?.preventDefault();
    try {
      setSavingSection("facility");
      await updateSettings({
        clinic_name: formData.clinic_name,
        clinic_tagline: formData.clinic_tagline,
        clinic_reg_no: formData.clinic_reg_no,
        clinic_address: formData.clinic_address,
        clinic_city: formData.clinic_city,
        clinic_state: formData.clinic_state,
        clinic_phone: formData.clinic_phone,
        clinic_email: formData.clinic_email,
        clinic_hours: formData.clinic_hours,
      });
      showToast("Facility profile updated successfully", "success");
      setIsEditingFacility(false);
    } catch (err) {
      showToast("Failed to update facility profile", "error");
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveWhatsApp = async (e) => {
    e?.preventDefault();
    try {
      setSavingSection("whatsapp");
      await updateSettings({
        whatsapp_token: formData.whatsapp_token,
        phone_number_id: formData.phone_number_id,
        verify_token: formData.verify_token,
      });
      showToast("WhatsApp Cloud API configuration saved", "success");
    } catch (err) {
      showToast("Failed to save WhatsApp credentials", "error");
    } finally {
      setSavingSection(null);
    }
  };

  const handleSavePolicies = async (e) => {
    e?.preventDefault();
    try {
      setSavingSection("policies");
      await updateSettings({
        opd_slot_duration: parseInt(formData.opd_slot_duration, 10) || 15,
        checkin_grace_period: parseInt(formData.checkin_grace_period, 10) || 15,
        emergency_tat: parseInt(formData.emergency_tat, 10) || 30,
        lab_tat_standard: parseInt(formData.lab_tat_standard, 10) || 24,
        followup_days: parseInt(formData.followup_days, 10) || 7,
      });
      showToast("Clinical operational policies saved", "success");
      setIsEditingPolicies(false);
    } catch (err) {
      showToast("Failed to save operational policies", "error");
    } finally {
      setSavingSection(null);
    }
  };

  const handleUpdatePassword = (e) => {
    e.preventDefault();
    if (!formData.admin_new_password) {
      showToast("Please enter a new password", "warning");
      return;
    }
    if (formData.admin_new_password !== formData.admin_confirm_password) {
      showToast("New passwords do not match", "error");
      return;
    }
    setSavingSection("security");
    setTimeout(() => {
      setSavingSection(null);
      setFormData(prev => ({
        ...prev,
        admin_current_password: "",
        admin_new_password: "",
        admin_confirm_password: ""
      }));
      showToast("Administrator password updated successfully", "success");
    }, 700);
  };

  const handleTestMeta = async () => {
    try {
      setTestingMeta(true);
      setTestResult(null);
      const res = await testMetaConnection({
        phone_number_id: formData.phone_number_id,
        whatsapp_token: formData.whatsapp_token,
      });
      const isOk = res.status === "ok" || res.success === true;
      const msg = res.message || res.error || (isOk ? "Meta Cloud API connection validated!" : "Connection failed");
      const normalizedResult = { ...res, status: isOk ? "ok" : "error", message: msg };
      setTestResult(normalizedResult);
      if (isOk) {
        showToast(msg, "success");
      } else {
        showToast(`API Ping Failed: ${msg}`, "error");
      }
    } catch (err) {
      setTestResult({
        status: "error",
        message: err.message || "Failed to reach WhatsApp service",
      });
      showToast("Meta API test failed", "error");
    } finally {
      setTestingMeta(false);
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === "webhook") {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
      showToast("Webhook URL copied to clipboard", "info");
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
      showToast("Verify Token copied to clipboard", "info");
    }
  };

  const webhookUrl = `${window.location.origin}/api/webhook`;

  // RBAC Matrix Data
  const rolePermissions = [
    { role: "Clinic Administrator", users: "3 Active", opd: "Full Access", rx: "Full Access", lab: "Full Access", billing: "Full Access", settings: "Full Access", reports: "Export & Audit" },
    { role: "Attending Physician / Doctor", users: "12 Doctors", opd: "Consult & STAT", rx: "Issue & Sign", lab: "Order & Review", billing: "View Billables", settings: "Profile Only", reports: "Clinical Only" },
    { role: "OPD Frontdesk Receptionist", users: "6 Staff", opd: "Check-in & Tokens", rx: "No Access", lab: "Sample Slip View", billing: "Generate Invoices", settings: "No Access", reports: "Daily Footfall" },
    { role: "Diagnostic Lab Technician", users: "4 Techs", opd: "No Access", rx: "No Access", lab: "Full (Results/Upload)", billing: "No Access", settings: "No Access", reports: "Lab TAT Log" },
    { role: "Clinical Pharmacist", users: "3 Staff", opd: "No Access", rx: "Dispense & Stock", lab: "No Access", billing: "Pharma Counter", settings: "No Access", reports: "Stock Movement" }
  ];

  return (
    <div className="space-y-6">
      {/* 1. Portal Header (Matching LaboratoryView & LRS Standards) */}
      <PortalHeader
        kicker="System & Master Controls"
        title="System Configuration & Master Settings"
        icon={FiSettings}
        rightAction={
          <div className="lead-header-actions flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50/80 border border-blue-200/90 text-[#254d90] text-xs font-semibold shadow-xs">
              <FiCalendar className="text-[#254d90] shrink-0" size={14} />
              <span>{subscriptionInfo?.subscription_plan || "Monthly"}</span>
              <span className="text-blue-300">•</span>
              <span className="font-mono text-slate-700">Expires: {subscriptionInfo?.subscription_expiry_display || subscriptionInfo?.subscription_expiry_date || "25 Nov 2026"}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                subscriptionInfo?.is_expired
                  ? "bg-rose-100 text-rose-700 border border-rose-200"
                  : subscriptionInfo?.days_remaining != null && subscriptionInfo.days_remaining <= 5
                  ? "bg-amber-100 text-amber-700 border border-amber-200"
                  : "bg-emerald-100 text-emerald-700 border border-emerald-200"
              }`}>
                {subscriptionInfo?.is_expired ? "Expired" : `${subscriptionInfo?.days_remaining ?? 30}d left`}
              </span>
            </div>
            <button
              type="button"
              onClick={loadSettings}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Settings"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTab === "facility") setIsEditingFacility(!isEditingFacility);
                else if (activeTab === "policies") setIsEditingPolicies(!isEditingPolicies);
              }}
              className="portal-action-btn portal-action-btn-blue flex items-center gap-1.5"
            >
              <FiEdit3 size={15} />
              <span>
                {activeTab === "facility"
                  ? (isEditingFacility ? "Cancel Edit" : "Edit Facility")
                  : activeTab === "policies"
                  ? (isEditingPolicies ? "Cancel Edit" : "Edit Policies")
                  : "Quick Action"}
              </span>
            </button>
          </div>
        }
      />

      {/* 2. 4-Card Executive KPI Grid (Identical to LaboratoryView Image 2) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Facility Status"
          value="NABH Ready"
          Icon={FiHome}
          colorTheme="brand-blue"
        />
        <StatCard
          title="WhatsApp Cloud API"
          value={formData.phone_number_id ? "Online & Ready" : "Unconfigured"}
          Icon={FiGlobe}
          colorTheme="brand-teal"
        />
        <StatCard
          title="OPD Consult Slot"
          value={`${formData.opd_slot_duration} Minutes`}
          Icon={FiClock}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Subscription Expiry"
          value={subscriptionInfo?.subscription_expiry_display || subscriptionInfo?.subscription_expiry_date || "25 Nov 2026"}
          Icon={FiCalendar}
          colorTheme="brand-teal"
          trend={`${subscriptionInfo?.subscription_plan || "Monthly"} • ${subscriptionInfo?.is_expired ? "Expired" : `${subscriptionInfo?.days_remaining ?? 30} Days Left`}`}
        />
      </div>

      {/* 3. Standard LRS Signature Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            activeTab === "facility"
              ? "Clinic Profile & Facility Identity"
              : activeTab === "whatsapp"
              ? "WhatsApp Cloud API & Meta Integration"
              : activeTab === "policies"
              ? "Clinical Operational Policies & TAT Targets"
              : activeTab === "sync"
              ? "Offline Operations & Two-Way Cloud Sync"
              : activeTab === "security"
              ? "Administrator Profile & Security Credentials"
              : activeTab === "updates"
              ? "Software Version & Over-The-Air Updates"
              : "Role-Based Access Control (RBAC) Matrix"
          }
          description={
            activeTab === "facility"
              ? "Official clinic details reflected on WhatsApp notifications, prescriptions, and billing receipts."
              : activeTab === "whatsapp"
              ? "Meta Developer credentials used for patient queue tokens, appointment alerts, and digital prescriptions."
              : activeTab === "policies"
              ? "Configure automated queuing priorities, arrival grace windows, emergency escalation, and diagnostic targets."
              : activeTab === "sync"
              ? "Local-first offline management, pending WhatsApp outbox queue, and bidirectional database cloud synchronization."
              : activeTab === "security"
              ? "Primary administrative credentials and current authenticated system session telemetry."
              : activeTab === "updates"
              ? "Automatic application updates, release telemetry, deployment environment, and binary integrity."
              : "Departmental privilege definitions and feature boundaries enforced across clinical workstations."
          }
          badgeCount={7}
          badgeLabel="categories"
          subBadge="System Configuration"
        />

        {/* 4. TABS NAVIGATION (Identical to LaboratoryView .wa-tabs-container) */}
        <div className="wa-tabs-container">
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "facility" ? "active" : ""}`}
            onClick={() => setActiveTab("facility")}
          >
            <span>Facility Profile</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "whatsapp" ? "active" : ""}`}
            onClick={() => setActiveTab("whatsapp")}
          >
            <span>WhatsApp Cloud API</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "policies" ? "active" : ""}`}
            onClick={() => setActiveTab("policies")}
          >
            <span>Operational Policies</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "sync" ? "active" : ""}`}
            onClick={() => setActiveTab("sync")}
          >
            <span>Offline & Cloud Sync</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "updates" ? "active" : ""}`}
            onClick={() => setActiveTab("updates")}
          >
            <span>Software & Updates</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "security" ? "active" : ""}`}
            onClick={() => setActiveTab("security")}
          >
            <span>Login & Security</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "permissions" ? "active" : ""}`}
            onClick={() => setActiveTab("permissions")}
          >
            <span>Staff RBAC Matrix</span>
          </button>
        </div>

        {/* 5. TAB CONTENT CARDS */}
        <div className="settings-content-stack mt-4">

          {/* TAB 1: FACILITY PROFILE */}
          {activeTab === "facility" && (
            <>
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon blue">
                      <FiHome size={18} />
                    </div>
                    <div>
                      <h2>Clinic Profile & Facility Identity</h2>
                      <p className="card-subtitle">Official details reflected on WhatsApp notifications, prescriptions, and invoices.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`btn-action-outline ${isEditingFacility ? "active" : ""}`}
                    onClick={() => setIsEditingFacility(!isEditingFacility)}
                  >
                    {isEditingFacility ? (
                      <>
                        <FiX size={14} /> Cancel Edit
                      </>
                    ) : (
                      <>
                        <FiEdit3 size={14} /> Edit Details
                      </>
                    )}
                  </button>
                </div>

                <div className="card-body">
                  {!isEditingFacility ? (
                    /* VIEW MODE */
                    <div className="clinic-info-grid">
                      <div className="info-tile">
                        <span className="info-tile-label"><FiHome size={13} /> Legal Clinic Name</span>
                        <span className="info-tile-value">{formData.clinic_name || "Not Configured"}</span>
                      </div>

                      <div className="info-tile">
                        <span className="info-tile-label"><FiFileText size={13} /> Registration / NABH License</span>
                        <span className="info-tile-value">{formData.clinic_reg_no || "Not Specified"}</span>
                      </div>

                      <div className="info-tile">
                        <span className="info-tile-label"><FiActivity size={13} /> Specialty & Tagline</span>
                        <span className="info-tile-value">{formData.clinic_tagline || "Medical Center & OPD Consultation Services"}</span>
                      </div>

                      <div className="info-tile">
                        <span className="info-tile-label"><FiPhone size={13} /> Helpline & Emergency Phone</span>
                        <span className="info-tile-value">{formData.clinic_phone || "+91 98765 43210"}</span>
                      </div>

                      <div className="info-tile full-width">
                        <span className="info-tile-label"><FiMail size={13} /> Official Clinical Email</span>
                        <span className="info-tile-value">{formData.clinic_email || "Not Provided"}</span>
                      </div>

                      <div className="info-tile full-width">
                        <span className="info-tile-label"><FiMapPin size={13} /> Registered Physical Address</span>
                        <span className="info-tile-value">{[formData.clinic_address, formData.clinic_city, formData.clinic_state].filter(Boolean).join(", ") || "Not Configured Yet"}</span>
                      </div>

                      <div className="info-tile">
                        <span className="info-tile-label"><FiAward size={13} /> SaaS Subscription Model</span>
                        <span className="info-tile-value text-[#254d90] font-bold">
                          {subscriptionInfo?.subscription_plan || "Monthly Plan"}
                        </span>
                      </div>

                      <div className="info-tile">
                        <span className="info-tile-label"><FiCalendar size={13} /> Subscription Expiry Date</span>
                        <span className="info-tile-value font-mono font-bold flex items-center justify-between">
                          <span>{subscriptionInfo?.subscription_expiry_display || subscriptionInfo?.subscription_expiry_date || "25 Nov 2026"}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            subscriptionInfo?.is_expired
                              ? "bg-rose-100 text-rose-700"
                              : subscriptionInfo?.days_remaining != null && subscriptionInfo.days_remaining <= 5
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {subscriptionInfo?.is_expired ? "Expired" : `${subscriptionInfo?.days_remaining ?? 30}d left`}
                          </span>
                        </span>
                      </div>

                      <div className="info-tile full-width go-live-tile">
                        <div className="go-live-header">
                          <span className="info-tile-label bold-blue"><FiClock size={13} /> OPD Operating Schedule & Emergency Readiness</span>
                          <span className="go-live-badge">Clinic Active</span>
                        </div>
                        <span className="go-live-value">{formData.clinic_hours || "Not Configured Yet"}</span>
                        <p className="go-live-note">
                          Consultation token dispatch, doctor availability schedules, and WhatsApp bot replies adhere strictly to this operational timeline.
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* EDIT MODE */
                    <form onSubmit={handleSaveFacility} className="settings-form-layout">
                      <div className="form-grid-2">
                        <div className="settings-form-group">
                          <label>Clinic Legal Name *</label>
                          <input
                            type="text"
                            name="clinic_name"
                            value={formData.clinic_name}
                            onChange={handleChange}
                            placeholder="e.g. Aerostate Speciality Clinic"
                            required
                          />
                        </div>

                        <div className="settings-form-group">
                          <label>Registration / NABH License (Optional)</label>
                          <input
                            type="text"
                            name="clinic_reg_no"
                            value={formData.clinic_reg_no}
                            onChange={handleChange}
                            placeholder="e.g. UP-AGR-2026-MED (Optional)"
                          />
                        </div>

                        <div className="settings-form-group span-2">
                          <label>Tagline / Specialty Description</label>
                          <input
                            type="text"
                            name="clinic_tagline"
                            value={formData.clinic_tagline}
                            onChange={handleChange}
                            placeholder="e.g. Medical Center & OPD Consultation Services"
                          />
                        </div>

                        <div className="settings-form-group">
                          <label>Contact Phone Number</label>
                          <input
                            type="text"
                            name="clinic_phone"
                            value={formData.clinic_phone}
                            onChange={handleChange}
                            placeholder="+91 98765 43210"
                          />
                        </div>

                        <div className="settings-form-group">
                          <label>Official Email Address (Optional)</label>
                          <input
                            type="email"
                            name="clinic_email"
                            value={formData.clinic_email}
                            onChange={handleChange}
                            placeholder="contact@aerostateclinic.com (Optional)"
                          />
                        </div>

                        <div className="settings-form-group span-2">
                          <label>Street Address</label>
                          <textarea
                            rows={2}
                            name="clinic_address"
                            value={formData.clinic_address}
                            onChange={handleChange}
                            placeholder="e.g. 14, Commercial Center"
                          />
                        </div>

                        <div className="settings-form-group">
                          <label>City</label>
                          <input
                            type="text"
                            name="clinic_city"
                            value={formData.clinic_city || ""}
                            onChange={handleChange}
                            placeholder="e.g. Agra"
                          />
                        </div>

                        <div className="settings-form-group">
                          <label>State</label>
                          <input
                            type="text"
                            name="clinic_state"
                            value={formData.clinic_state || ""}
                            onChange={handleChange}
                            placeholder="e.g. Uttar Pradesh"
                          />
                        </div>

                        <div className="settings-form-group span-2">
                          <label>OPD Operating Hours & Emergency Info</label>
                          <input
                            type="text"
                            name="clinic_hours"
                            value={formData.clinic_hours}
                            onChange={handleChange}
                            placeholder="e.g. Mon - Sat: 08:00 AM - 08:00 PM (Emergency 24/7)"
                          />
                        </div>
                      </div>

                      <div className="form-actions-bar">
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => setIsEditingFacility(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn-submit"
                          disabled={savingSection === "facility"}
                        >
                          <FiSave size={14} />
                          {savingSection === "facility" ? "Saving..." : "Save Facility Details"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>

                            {/* SaaS Subscription & License Validity Card */}
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon blue">
                      <FiAward size={18} />
                    </div>
                    <div>
                      <h2>SaaS Subscription &amp; Licensing Validity</h2>
                      <p className="card-subtitle">Active licensing plan, portal validity, and automated renewal status.</p>
                    </div>
                  </div>

                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      subscriptionInfo?.is_expired
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : subscriptionInfo?.days_remaining != null && subscriptionInfo.days_remaining <= 5
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    ● {subscriptionInfo?.subscription_status || "Active Plan"}
                  </span>
                </div>

                <div className="card-body">
                  <div className="clinic-info-grid">
                    <div className="info-tile">
                      <span className="info-tile-label"><FiAward size={13} /> Active Plan Model</span>
                      <span className="info-tile-value text-[#254d90] font-bold">
                        {subscriptionInfo?.subscription_plan || "Monthly Plan"}
                      </span>
                    </div>

                    <div className="info-tile">
                      <span className="info-tile-label"><FiClock size={13} /> Expiration Date</span>
                      <span className="info-tile-value font-mono">
                        {subscriptionInfo?.subscription_expiry_display || subscriptionInfo?.subscription_expiry_date || "25 Nov 2026"}
                      </span>
                    </div>

                    <div className="info-tile">
                      <span className="info-tile-label"><FiActivity size={13} /> Validity Countdown</span>
                      <span className={`info-tile-value font-bold ${
                        subscriptionInfo?.is_expired
                          ? "text-rose-600"
                          : subscriptionInfo?.days_remaining != null && subscriptionInfo.days_remaining <= 5
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }`}>
                        {subscriptionInfo?.is_expired
                          ? "Expired (Contact Admin)"
                          : `${subscriptionInfo?.days_remaining ?? 30} Days Remaining`}
                      </span>
                    </div>

                    <div className="info-tile">
                      <span className="info-tile-label"><FiShield size={13} /> Multi-Tenant License</span>
                      <span className="info-tile-value text-slate-700">Enterprise OPD &amp; Meta WhatsApp</span>
                    </div>

                    <div className="info-tile full-width go-live-tile">
                      <div className="go-live-header">
                        <span className="info-tile-label bold-blue"><FiShield size={13} /> Subscription Management Policy</span>
                        <span className="go-live-badge">SaaS Managed</span>
                      </div>
                      <span className="go-live-value">
                        {subscriptionInfo?.subscription_plan || "Monthly"} Plan • Valid through {subscriptionInfo?.subscription_expiry_display || subscriptionInfo?.subscription_expiry_date || "Continuous Active"}
                      </span>
                      <p className="go-live-note">
                        Subscription plans and validity dates are managed by the platform SuperAdministrator. For license extensions, plan upgrades (Quarterly/Annual), or custom integrations, please contact your AeroState platform administrator.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Accreditation Card */}
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon teal">
                      <FiAward size={18} />
                    </div>
                    <div>
                      <h2>Accreditation & Statutory Compliance</h2>
                      <p className="card-subtitle">Verified health certifications and operational regulatory status.</p>
                    </div>
                  </div>
                </div>

                <div className="card-body">
                  <div className="compliance-grid">
                    <div className="compliance-card">
                      <div className="compliance-dot"></div>
                      <div className="compliance-info">
                        <h4>NABH Certified Clinic</h4>
                        <p>National Accreditation Board for Hospitals & Healthcare Providers</p>
                        <span className="compliance-meta">Valid through Dec 2027 • Standard Entry Level</span>
                      </div>
                    </div>

                    <div className="compliance-card">
                      <div className="compliance-dot"></div>
                      <div className="compliance-info">
                        <h4>ABDM / Ayushman Bharat Digital</h4>
                        <p>M1, M2, M3 Milestone Compliant Health Records Bridge</p>
                        <span className="compliance-meta">API Bridge Active • Secure Health ID</span>
                      </div>
                    </div>

                    <div className="compliance-card">
                      <div className="compliance-dot"></div>
                      <div className="compliance-info">
                        <h4>Bio-Medical Waste Management</h4>
                        <p>State Pollution Control Board Authorized Facility</p>
                        <span className="compliance-meta">Yellow/Red Barcode Segregation Active</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: WHATSAPP CLOUD API */}
          {activeTab === "whatsapp" && (
            <>
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon green">
                      <FiGlobe size={18} />
                    </div>
                    <div>
                      <h2>WhatsApp Cloud API Credentials</h2>
                      <p className="card-subtitle">Meta Developer credentials used for patient queue tokens, appointment alerts, and digital prescriptions.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-action-outline primary"
                    onClick={handleTestMeta}
                    disabled={testingMeta}
                  >
                    <FiActivity size={14} className={testingMeta ? "animate-spin" : ""} />
                    {testingMeta ? "Pinging Meta..." : "Test Meta Connection"}
                  </button>
                </div>

                <div className="card-body">
                  {testResult && (
                    <div className={`p-3 rounded-lg mb-4 text-xs font-semibold flex items-center gap-2 ${testResult.status === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                      {testResult.status === "ok" ? <FiCheckCircle size={16} /> : <FiAlertCircle size={16} />}
                      <span>{testResult.message}</span>
                    </div>
                  )}

                  <form onSubmit={handleSaveWhatsApp} className="settings-form-layout">
                    <div className="form-grid-2">
                      <div className="settings-form-group">
                        <label>WhatsApp Phone Number ID (Optional)</label>
                        <input
                          type="text"
                          name="phone_number_id"
                          value={formData.phone_number_id}
                          onChange={handleChange}
                          placeholder="e.g. 104589239854721"
                        />
                        <span className="text-xs text-slate-500 font-medium mt-1">Obtained from Meta App Dashboard &gt; WhatsApp &gt; API Setup</span>
                      </div>

                      <div className="settings-form-group">
                        <label>Permanent System Access Token (Optional)</label>
                        <div className="password-input-wrap">
                          <input
                            type={showToken ? "text" : "password"}
                            name="whatsapp_token"
                            value={formData.whatsapp_token}
                            onChange={handleChange}
                            placeholder="EAAG..."
                          />
                          <button
                            type="button"
                            className="password-toggle-btn"
                            onClick={() => setShowToken(!showToken)}
                            title={showToken ? "Hide Token" : "Show Token"}
                          >
                            {showToken ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                          </button>
                        </div>
                        <span className="text-xs text-slate-500 font-medium mt-1">System User permanent token with whatsapp_business_messaging permission</span>
                      </div>
                    </div>

                    <div className="form-actions-bar">
                      <button
                        type="submit"
                        className="btn-submit"
                        disabled={savingSection === "whatsapp"}
                      >
                        <FiSave size={14} />
                        {savingSection === "whatsapp" ? "Saving..." : "Save WhatsApp Credentials"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Webhook Card */}
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon teal">
                      <FiLayers size={18} />
                    </div>
                    <div>
                      <h2>Meta Webhook Endpoint &amp; Event Subscriptions</h2>
                      <p className="card-subtitle">Configure these parameters inside Meta App Dashboard &gt; WhatsApp &gt; Configuration.</p>
                    </div>
                  </div>
                </div>

                <div className="card-body">
                  <div className="webhook-meta-grid">
                    <div className="webhook-field-box">
                      <div className="webhook-box-header">
                        <span className="webhook-box-label">Callback URL</span>
                        <button
                          type="button"
                          className="btn-copy-code"
                          onClick={() => copyToClipboard(webhookUrl, "webhook")}
                        >
                          {copiedWebhook ? <><FiCheck size={12} /> Copied</> : <><FiCopy size={12} /> Copy URL</>}
                        </button>
                      </div>
                      <div className="webhook-code-copy">
                        <code>{webhookUrl}</code>
                      </div>
                      <p className="webhook-box-note">Point your Meta WhatsApp webhook to this secure endpoint. Must be HTTPS in production.</p>
                    </div>

                    <div className="webhook-field-box">
                      <div className="webhook-box-header">
                        <span className="webhook-box-label">Verify Token</span>
                        <button
                          type="button"
                          className="btn-copy-code"
                          onClick={() => copyToClipboard(formData.verify_token, "token")}
                        >
                          {copiedToken ? <><FiCheck size={12} /> Copied</> : <><FiCopy size={12} /> Copy Token</>}
                        </button>
                      </div>
                      <div className="webhook-code-copy">
                        <code>{formData.verify_token}</code>
                      </div>
                      <p className="webhook-box-note">Match this token in Meta App Dashboard during webhook handshake verification.</p>
                    </div>
                  </div>

                  <div className="events-container">
                    <span className="events-label">Required Subscribed Webhook Events:</span>
                    <div className="events-chip-list">
                      <span className="event-chip active"><FiCheckCircle size={12} /> messages</span>
                      <span className="event-chip active"><FiCheckCircle size={12} /> message_echoes</span>
                      <span className="event-chip active"><FiCheckCircle size={12} /> message_deliveries</span>
                      <span className="event-chip active"><FiCheckCircle size={12} /> message_reads</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: OPERATIONAL POLICIES */}
          {activeTab === "policies" && (
            <div className="settings-card">
              <div className="card-header">
                <div className="card-header-left">
                  <div className="header-icon teal">
                    <FiClock size={18} />
                  </div>
                  <div>
                    <h2>Clinical Operational Policies &amp; Turnaround Times (TAT)</h2>
                    <p className="card-subtitle">Configure automated queuing priorities, arrival grace windows, emergency escalation, and diagnostic targets.</p>
                  </div>
                </div>

                <button
                  type="button"
                  className={`btn-action-outline ${isEditingPolicies ? "active" : ""}`}
                  onClick={() => setIsEditingPolicies(!isEditingPolicies)}
                >
                  {isEditingPolicies ? (
                    <>
                      <FiX size={14} /> Cancel Edit
                    </>
                  ) : (
                    <>
                      <FiEdit3 size={14} /> Edit Policies
                    </>
                  )}
                </button>
              </div>

              <div className="card-body">
                {!isEditingPolicies ? (
                  /* POLICIES VIEW */
                  <div className="policies-summary-grid">
                    <div className="policy-card">
                      <span className="policy-label"><FiClock size={13} /> Standard OPD Slot Duration</span>
                      <span className="policy-value">{formData.opd_slot_duration} Minutes</span>
                      <span className="policy-desc">Average consultation time allocated per doctor consultation slot</span>
                      <span className="policy-badge flexible">Configurable</span>
                    </div>

                    <div className="policy-card">
                      <span className="policy-label"><FiActivity size={13} /> Check-in Arrival Grace Period</span>
                      <span className="policy-value">{formData.checkin_grace_period} Minutes</span>
                      <span className="policy-desc">Automated priority bump on live queue screen for on-time patient arrivals</span>
                      <span className="policy-badge enabled">Automated</span>
                    </div>

                    <div className="policy-card">
                      <span className="policy-label" style={{ color: '#ef4444' }}><FiAlertCircle size={13} /> Emergency / STAT Queue TAT</span>
                      <span className="policy-value" style={{ color: '#ef4444' }}>&le; {formData.emergency_tat} Minutes</span>
                      <span className="policy-desc">Mandatory immediate physician dispatch target for critical emergency walk-ins</span>
                      <span className="policy-badge warning">STAT Protocol</span>
                    </div>

                    <div className="policy-card">
                      <span className="policy-label"><FiFileText size={13} /> Diagnostic Lab Routine TAT</span>
                      <span className="policy-value">{formData.lab_tat_standard} Minutes</span>
                      <span className="policy-desc">Target sample-to-result turnaround for routine hematology & biochemistry</span>
                      <span className="policy-badge flexible">Standard TAT</span>
                    </div>

                    <div className="policy-card" style={{ gridColumn: '1 / -1' }}>
                      <span className="policy-label"><FiCheckCircle size={13} /> Complimentary Follow-up Window</span>
                      <span className="policy-value">{formData.followup_days} Days from Primary Visit</span>
                      <span className="policy-desc">Patients re-consulting within this window are automatically exempt from new OPD registration fees</span>
                      <span className="policy-badge enabled">Patient Benefit</span>
                    </div>
                  </div>
                ) : (
                  /* POLICIES EDIT */
                  <form onSubmit={handleSavePolicies} className="settings-form-layout">
                    <div className="form-grid-2">
                      <div className="settings-form-group">
                        <label>OPD Consultation Slot Duration (Minutes) *</label>
                        <input
                          type="number"
                          name="opd_slot_duration"
                          min="5"
                          max="60"
                          value={formData.opd_slot_duration}
                          onChange={handleChange}
                          required
                        />
                        <span className="text-xs text-slate-500 font-medium mt-1">Recommended: 15 minutes for general OPD, 20 for specialties</span>
                      </div>

                      <div className="settings-form-group">
                        <label>Patient Arrival Grace Period (Minutes) *</label>
                        <input
                          type="number"
                          name="checkin_grace_period"
                          min="0"
                          max="120"
                          value={formData.checkin_grace_period}
                          onChange={handleChange}
                          required
                        />
                        <span className="text-xs text-slate-500 font-medium mt-1">Arrivals within this threshold take priority on live queue screen</span>
                      </div>

                      <div className="settings-form-group">
                        <label>Emergency / STAT Triage TAT (Minutes) *</label>
                        <input
                          type="number"
                          name="emergency_tat"
                          min="1"
                          max="30"
                          value={formData.emergency_tat}
                          onChange={handleChange}
                          required
                        />
                        <span className="text-xs text-slate-500 font-medium mt-1">Emergency queue escalation trigger threshold</span>
                      </div>

                      <div className="settings-form-group">
                        <label>Routine Lab Turnaround Time (Minutes) *</label>
                        <input
                          type="number"
                          name="lab_tat_standard"
                          min="30"
                          max="1440"
                          value={formData.lab_tat_standard}
                          onChange={handleChange}
                          required
                        />
                        <span className="text-xs text-slate-500 font-medium mt-1">Standard benchmark for hematology & routine blood tests</span>
                      </div>

                      <div className="settings-form-group span-2">
                        <label>Complimentary Follow-up Window (Days) *</label>
                        <input
                          type="number"
                          name="followup_days"
                          min="0"
                          max="30"
                          value={formData.followup_days}
                          onChange={handleChange}
                          required
                        />
                        <span className="text-xs text-slate-500 font-medium mt-1">Zero consultation charges applied during this post-op/post-visit window</span>
                      </div>
                    </div>

                    <div className="form-actions-bar">
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => setIsEditingPolicies(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-submit"
                        disabled={savingSection === "policies"}
                      >
                        <FiSave size={14} />
                        {savingSection === "policies" ? "Saving..." : "Save Operational Policies"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SECURITY & ADMIN */}
          {activeTab === "security" && (
            <>
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon blue">
                      <FiShield size={18} />
                    </div>
                    <div>
                      <h2>Administrator Profile &amp; Session Security</h2>
                      <p className="card-subtitle">Primary administrative credentials and current system session status.</p>
                    </div>
                  </div>
                </div>

                <div className="card-body">
                  <div className="security-profile-banner">
                    <div className="security-avatar">AD</div>
                    <div className="security-details">
                      <h4>Super Administrator (Chief Medical Officer)</h4>
                      <p>aerostate.admin@clinic.internal • Role: Master Admin</p>
                      <div className="security-badges">
                        <span className="badge-pill">JWT Session Active</span>
                        <span className="badge-pill">FastAPI Backend Authenticated</span>
                        <span className="badge-pill">SQLite Database Online</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Update Password Form Card */}
              <div className="settings-card">
                <div className="card-header">
                  <div className="card-header-left">
                    <div className="header-icon red">
                      <FiLock size={18} />
                    </div>
                    <div>
                      <h2>Update Administrator Passphrase</h2>
                      <p className="card-subtitle">Ensure strong alphanumeric passphrase for the master administrative workstation.</p>
                    </div>
                  </div>
                </div>

                <div className="card-body">
                  <form onSubmit={handleUpdatePassword} className="settings-form-layout">
                    <div className="form-grid-2">
                      <div className="settings-form-group span-2">
                        <label>Current Master Password *</label>
                        <input
                          type="password"
                          name="admin_current_password"
                          value={formData.admin_current_password}
                          onChange={handleChange}
                          placeholder="••••••••••••"
                          required
                        />
                      </div>

                      <div className="settings-form-group">
                        <label>New Passphrase *</label>
                        <input
                          type="password"
                          name="admin_new_password"
                          value={formData.admin_new_password}
                          onChange={handleChange}
                          placeholder="Minimum 8 characters with numbers"
                          required
                        />
                      </div>

                      <div className="settings-form-group">
                        <label>Confirm New Passphrase *</label>
                        <input
                          type="password"
                          name="admin_confirm_password"
                          value={formData.admin_confirm_password}
                          onChange={handleChange}
                          placeholder="Re-enter new passphrase"
                          required
                        />
                      </div>
                    </div>

                    <div className="form-actions-bar">
                      <button
                        type="submit"
                        className="btn-submit"
                        disabled={savingSection === "security"}
                      >
                        <FiLock size={14} />
                        {savingSection === "security" ? "Updating..." : "Update Master Passphrase"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          )}

          {/* TAB 5: STAFF RBAC MATRIX */}
          {activeTab === "permissions" && (
            <div className="settings-card">
              <div className="card-header">
                <div className="card-header-left">
                  <div className="header-icon teal">
                    <FiUsers size={18} />
                  </div>
                  <div>
                    <h2>Role-Based Access Control (RBAC) Matrix</h2>
                    <p className="card-subtitle">Departmental privilege definitions and feature boundaries enforced across clinical workstations.</p>
                  </div>
                </div>
                <div>
                  <a href="/staff" className="btn-action-outline">
                    <FiUsers size={16} /> Manage Staff Accounts
                  </a>
                </div>
              </div>

              <div className="card-body">
                <div className="rbac-table-wrap">
                  <table className="rbac-table">
                    <thead>
                      <tr>
                        <th>Clinical Role</th>
                        <th>Active Count</th>
                        <th>OPD Queue</th>
                        <th>Prescriptions</th>
                        <th>Lab Diagnostics</th>
                        <th>Billing / POS</th>
                        <th>Settings</th>
                        <th>Reports</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rolePermissions.map((row, idx) => (
                        <tr key={idx}>
                          <td>
                            <span className="role-title">{row.role}</span>
                          </td>
                          <td>
                            <span className="user-count-badge">{row.users}</span>
                          </td>
                          <td>
                            <span className={`rbac-tag ${row.opd.includes('Full') || row.opd.includes('Consult') ? 'allowed' : 'restricted'}`}>
                              {row.opd}
                            </span>
                          </td>
                          <td>
                            <span className={`rbac-tag ${row.rx.includes('Full') || row.rx.includes('Issue') || row.rx.includes('Dispense') ? 'allowed' : 'restricted'}`}>
                              {row.rx}
                            </span>
                          </td>
                          <td>
                            <span className={`rbac-tag ${row.lab.includes('Full') || row.lab.includes('Order') ? 'allowed' : 'restricted'}`}>
                              {row.lab}
                            </span>
                          </td>
                          <td>
                            <span className={`rbac-tag ${row.billing.includes('Full') || row.billing.includes('Generate') || row.billing.includes('Pharma') ? 'allowed' : 'restricted'}`}>
                              {row.billing}
                            </span>
                          </td>
                          <td>
                            <span className={`rbac-tag ${row.settings.includes('Full') ? 'admin' : 'restricted'}`}>
                              {row.settings}
                            </span>
                          </td>
                          <td>
                            <span className="rbac-tag allowed">
                              {row.reports}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: OFFLINE & CLOUD SYNC */}
          {activeTab === "sync" && (
            <SyncSettingsCard />
          )}

          {/* TAB 7: SOFTWARE & UPDATES */}
          {activeTab === "updates" && (
            <UpdateSettingsCard />
          )}

        </div>
      </section>
    </div>
  );
}
