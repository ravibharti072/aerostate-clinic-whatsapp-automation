import React, { useState, useEffect } from "react";
import { FiArrowUp } from "react-icons/fi";
import Sidebar from "../sidebar/Sidebar";
import { useAuth } from "../../context/AuthContext";

export default function MainLayout({ clinicName, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { user, logout } = useAuth();

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
        user={user}
        onLogout={logout}
      />

      {/* Main Content Area */}
      <main className="lrs-main-content">
        {/* Mobile Hamburger Button */}
        <button
          type="button"
          className="lrs-mobile-menu-btn"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label="Open menu"
        >
          ☰
        </button>

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
