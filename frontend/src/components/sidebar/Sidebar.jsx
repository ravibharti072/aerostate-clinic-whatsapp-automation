import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FiHome,
  FiCalendar,
  FiUsers,
  FiUserCheck,
  FiMessageCircle,
  FiSettings,
  FiSearch,
  FiX,
  FiShield,
  FiLogOut,
  FiFileText,
  FiDollarSign,
  FiTrendingUp,
  FiClock,
  FiActivity,
  FiPackage
} from "react-icons/fi";
import AerostateLogo from "../common/AerostateLogo";
import "./sidebar.css";

export default function Sidebar({
  isOpen,
  onClose,
  clinicName = "Aerostate Clinic",
  user,
  onLogout,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");

  const userRole = (user?.role || "Admin").toLowerCase();
  const isSuperAdmin = userRole === "superadmin";
  const isDoctor = userRole === "doctor";
  const isPharma = userRole === "pharma" || userRole === "pharmacist";
  const isFrontdesk = userRole === "frontdesk" || userRole === "receptionist";
  const isAdmin = !isDoctor && !isPharma && !isFrontdesk;

  let navigationSections = [];

  if (isSuperAdmin) {
    navigationSections = [
      {
        title: "Multi-Clinic Platform",
        items: [
          { path: "/superadmin", label: "Registered Clinics", icon: <FiHome />, badge: "SaaS" },
          { path: "/superadmin?tab=admins", label: "SuperAdmin Admins", icon: <FiShield />, badge: "Master" },
        ],
      },
    ];
  } else if (isDoctor) {
    navigationSections = [
      {
        title: "Doctor Clinical Desk",
        items: [
          { path: "/dashboard", label: "Doctor Dashboard", icon: <FiHome />, badge: null },
          { path: "/queue", label: "My OPD Queue", icon: <FiClock />, badge: "Cabin Desk" },
          { path: "/consultations", label: "Clinical Encounters", icon: <FiActivity />, badge: null },
          { path: "/prescriptions", label: "Prescriptions & EMR", icon: <FiFileText />, badge: null },
        ],
      },
      {
        title: "Patient Care & Diagnostics",
        items: [
          { path: "/patients", label: "Master Patient Directory", icon: <FiUsers />, badge: null },
          { path: "/appointments", label: "My Appointments", icon: <FiCalendar />, badge: null },
          { path: "/laboratory", label: "Laboratory & Reports", icon: <FiActivity />, badge: null },
        ],
      },
    ];
  } else if (isPharma) {
    navigationSections = [
      {
        title: "Pharmacy & Dispensary",
        items: [
          { path: "/pharmacy", label: "Pharmacy & Inventory", icon: <FiPackage />, badge: "Stock" },
          { path: "/prescriptions", label: "Prescriptions & Dispense", icon: <FiFileText />, badge: null },
          { path: "/billing", label: "Billing & Receipts", icon: <FiDollarSign />, badge: null },
          { path: "/patients", label: "Master Patient Directory", icon: <FiUsers />, badge: null },
        ],
      },
    ];
  } else if (isFrontdesk) {
    navigationSections = [
      {
        title: null,
        items: [
          { path: "/dashboard", label: "Front Desk Dashboard", icon: <FiHome />, badge: null },
        ],
      },
      {
        title: "Reception & Appointments",
        items: [
          { path: "/messages", label: "WhatsApp Live Chats", icon: <FiMessageCircle />, badge: null },
          { path: "/appointments", label: "Appointments", icon: <FiCalendar />, badge: null },
          { path: "/queue", label: "Waiting Room Queue", icon: <FiClock />, badge: "Lobby" },
        ],
      },
      {
        title: "Clinical ERP Suite",
        items: [
          { path: "/patients", label: "Master Patient Directory", icon: <FiUsers />, badge: null },
          { path: "/consultations", label: "Doctor Consultations", icon: <FiActivity />, badge: null },
          { path: "/prescriptions", label: "Prescriptions & EMR", icon: <FiFileText />, badge: null },
          { path: "/laboratory", label: "Laboratory & Diagnostics", icon: <FiActivity />, badge: null },
          { path: "/pharmacy", label: "Pharmacy & Inventory", icon: <FiPackage />, badge: null },
          { path: "/billing", label: "Billing & Cashier", icon: <FiDollarSign />, badge: null },
        ],
      },
      {
        title: "Staff & Duty Scheduling",
        items: [
          { path: "/staff", label: "Staff & Duty Scheduling", icon: <FiShield />, badge: null },
        ],
      },
    ];
  } else {
    // Admin / Clinic Administrator
    navigationSections = [
      {
        title: null,
        items: [
          { path: "/dashboard", label: "Admin Dashboard", icon: <FiHome />, badge: null },
        ],
      },
      {
        title: "OPD & Appointments",
        items: [
          { path: "/messages", label: "WhatsApp Live Chats", icon: <FiMessageCircle />, badge: null },
          { path: "/appointments", label: "Appointments", icon: <FiCalendar />, badge: null },
          { path: "/queue", label: "Waiting Room Queue", icon: <FiClock />, badge: null },
        ],
      },
      {
        title: "Clinical ERP Suite",
        items: [
          { path: "/patients", label: "Master Patient Directory", icon: <FiUsers />, badge: null },
          { path: "/consultations", label: "Doctor Consultations", icon: <FiActivity />, badge: null },
          { path: "/prescriptions", label: "Prescriptions & EMR", icon: <FiFileText />, badge: null },
          { path: "/laboratory", label: "Laboratory & Diagnostics", icon: <FiActivity />, badge: null },
          { path: "/pharmacy", label: "Pharmacy & Inventory", icon: <FiPackage />, badge: null },
          { path: "/billing", label: "Billing & Invoices", icon: <FiDollarSign />, badge: null },
        ],
      },
      {
        title: "Administration & Control",
        items: [
          { path: "/users", label: "Staff User Accounts", icon: <FiUsers />, badge: null },
          { path: "/staff", label: "Staff & Duty Scheduling", icon: <FiShield />, badge: null },
          { path: "/analytics", label: "Financial Analytics", icon: <FiTrendingUp />, badge: null },
          { path: "/settings", label: "System & Webhook", icon: <FiSettings />, badge: null },
        ],
      },
    ];
  }

  const getRoleLabel = () => {
    if (isSuperAdmin) return "SuperAdmin Master";
    if (isDoctor) return `Doctor • ${user?.specialization || "Clinical OPD"}`;
    if (isPharma) return "Pharmacist";
    if (isFrontdesk) return "Front Desk Reception";
    return "Clinic Administrator";
  };

  const getPortalTitle = () => {
    if (isSuperAdmin) return "SuperAdmin Console";
    if (isDoctor) return "Doctor Clinical Portal";
    if (isPharma) return "Pharmacy & Dispensary";
    if (isFrontdesk) return "Front Desk Reception";
    return "Clinic Administration";
  };

  const handleSelect = (path) => {
    navigate(path);
    if (window.innerWidth <= 900 && onClose) {
      onClose();
    }
  };

  const currentPath = location.pathname;
  const currentSearch = location.search;
  const currentFullPath = currentPath + (currentSearch || "");

  const filteredSections = navigationSections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((sec) => sec.items.length > 0);

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className={`rs-backdrop ${isOpen ? "open" : ""}`}
        onClick={onClose}
      />

      <aside className={`rs-container ${isOpen ? "open" : ""}`}>
        {/* Brand Header */}
        <div className="rs-header">
          <div className="rs-header-content">
            <AerostateLogo size="md" animateOnParentHover={true} />
            <div>
              <div className="rs-brand-header">
                <span className="rs-brand-name">AeroState</span>
                <span className="rs-version-badge">v1.0.0</span>
              </div>
              <p className="rs-brand-sub">{getPortalTitle()}</p>
            </div>
          </div>
          <button className="rs-mobile-close" onClick={onClose}>
            <FiX size={18} />
          </button>
        </div>

        {/* Search Bar with signature AeroState gradient dividers */}
        <div className="rs-search-wrap">
          <div className="rs-search-divider-top" />
          <div className="rs-search-box">
            <FiSearch size={14} color="#5d5d6e" />
            <input
              type="text"
              placeholder="Search navigation..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="rs-search-divider" />
        </div>

        {/* Navigation Items */}
        <nav className="rs-nav">
          {filteredSections.map((sec, sIdx) => (
            <div key={sIdx}>
              {sec.title && <div className="rs-section-title">{sec.title}</div>}
              {sec.items.map((item) => {
                const isQueryItem = item.path.includes("?");
                const isActive = isQueryItem
                  ? currentFullPath === item.path
                  : (currentPath === item.path && (!currentSearch || currentSearch === "")) ||
                    (item.path === "/dashboard" && currentPath === "/");
                return (
                  <div
                    key={item.path}
                    className={`rs-item ${isActive ? "active" : ""}`}
                    onClick={() => handleSelect(item.path)}
                  >
                    <span className="rs-item-icon">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.badge && <span className="rs-badge">{item.badge}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer Divider & User Profile */}
        <div className="rs-footer-divider" />
        <div className="rs-footer">
          <div className="rs-avatar">
            {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
          </div>
          <div className="rs-user-info">
            <div className="rs-username">{user?.name || user?.username || "Staff User"}</div>
            <div className="rs-user-role">{getRoleLabel()}</div>
          </div>
          <button
            onClick={onLogout}
            title="Sign out of system"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 transition cursor-pointer"
          >
            <FiLogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
