import React, { useState, useEffect } from "react";
import { FiArrowUp, FiMenu } from "react-icons/fi";
import Sidebar from "../sidebar/Sidebar";
import { useAuth } from "../../context/AuthContext";

export default function MainLayout({ clinicName, clinicInfo, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { user, logout, isSuperAdmin } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 220);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add("lrs-sidebar-lock");
    } else {
      document.body.classList.remove("lrs-sidebar-lock");
    }
    return () => {
      document.body.classList.remove("lrs-sidebar-lock");
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 900) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="lrs-layout">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        clinicName={clinicName}
        clinicInfo={clinicInfo}
        user={user}
        onLogout={logout}
      />

      {/* Main Content Area */}
      <main className="lrs-main-content">
        {/* Sleek Mobile Navigation Bar */}
        <header className="lrs-mobile-app-bar">
          <div className="lrs-mobile-bar-left">
            <button
              type="button"
              className="lrs-mobile-menu-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Open menu"
            >
              <FiMenu size={20} />
            </button>
            <div className="lrs-mobile-brand">
              <span className="lrs-mobile-clinic-name">{clinicName || "Aerostate Clinic"}</span>
            </div>
          </div>
          <div className="lrs-mobile-bar-right">
            <div className="lrs-mobile-user-chip" title={user?.username || "Staff"}>
              <span>{(user?.username || "A").charAt(0).toUpperCase()}</span>
            </div>
          </div>
        </header>

        {/* Subscription Expiry Alert Banner (shows only when expired or <= 5 days) */}
        {!isSuperAdmin && clinicInfo?.subscription_plan && (clinicInfo.is_expired || (clinicInfo.days_remaining != null && clinicInfo.days_remaining <= 5)) && (
          <div
            className={`mx-6 mt-4 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between border ${
              clinicInfo.is_expired
                ? "bg-rose-50 text-rose-800 border-rose-200"
                : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{clinicInfo.is_expired ? "⚠️" : "⏰"}</span>
              <span>
                {clinicInfo.is_expired
                  ? `Subscription Notice: Your clinic's license expired on ${clinicInfo.subscription_expiry_display || clinicInfo.subscription_expiry_date}. Please contact SuperAdmin to renew.`
                  : `Subscription Notice: Your clinic's ${clinicInfo.subscription_plan} plan expires in ${clinicInfo.days_remaining} day(s).`}
              </span>
            </div>
            <span className="text-[11px] underline opacity-90">
              Exp: {clinicInfo.subscription_expiry_display || clinicInfo.subscription_expiry_date}
            </span>
          </div>
        )}

        <div className="lrs-page-container">
          {children}
        </div>

        {/* Scroll to Top Button */}
        {showScrollTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="lrs-scroll-top-btn"
            title="Scroll to top of page"
            aria-label="Scroll to top"
          >
            <FiArrowUp size={18} />
          </button>
        )}
      </main>
    </div>
  );
}
