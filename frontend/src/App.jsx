import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import Login from "./pages/login/Login";
import SuperAdminLogin from "./pages/superadmin/login/SuperAdminLogin";
import MainLayout from "./components/layout/MainLayout";
import DashboardView from "./components/DashboardView";
import AppointmentsView from "./components/AppointmentsView";
import PatientsView from "./components/PatientsView";
import WhatsAppInbox from "./components/WhatsAppInbox";
import PrescriptionsView from "./components/PrescriptionsView";
import BillingView from "./components/BillingView";
import QueueView from "./components/QueueView";
import AnalyticsView from "./components/AnalyticsView";
import ConsultationsView from "./components/ConsultationsView";
import LaboratoryView from "./components/LaboratoryView";
import PharmacyView from "./components/PharmacyView";
import StaffView from "./components/StaffView";
import UsersView from "./components/UsersView";
import SuperAdminView from "./pages/superadmin/SuperAdminView";
import SettingsView from "./components/SettingsView";
import NewAppointmentModal from "./components/NewAppointmentModal";
import ErrorBoundary from "./components/ErrorBoundary";
import { fetchSettings } from "./api";

// Protected Layout Route for authenticated users (Staff, Doctor, Admin, SuperAdmin)
function ProtectedApp() {
  const { isAuthenticated, isSuperAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [clinicInfo, setClinicInfo] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings()
        .then((data) => setClinicInfo(data))
        .catch((err) => console.warn("Failed to load clinic settings:", err));
    }
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a1120] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#254d90]"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (location.pathname.startsWith("/superadmin")) {
      return <SuperAdminLogin />;
    }
    return <Navigate to="/login" replace />;
  }

  return (
    <MainLayout clinicName={clinicInfo?.clinic_name || "Aerostate Clinic"}>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={<Navigate to={isSuperAdmin ? "/superadmin" : "/dashboard"} replace />}
          />
          <Route
            path="/superadmin"
            element={isSuperAdmin ? <SuperAdminView /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/dashboard"
            element={
              <DashboardView
                onNavigate={(path) => navigate(path.startsWith("/") ? path : `/${path}`)}
                onOpenBookModal={() => setIsBookModalOpen(true)}
              />
            }
          />
          <Route
            path="/appointments"
            element={<AppointmentsView onOpenBookModal={() => setIsBookModalOpen(true)} />}
          />
          <Route
            path="/messages"
            element={<WhatsAppInbox onOpenBookModal={() => setIsBookModalOpen(true)} />}
          />
          <Route path="/queue" element={<QueueView />} />
          <Route path="/consultations" element={<ConsultationsView />} />
          <Route path="/prescriptions" element={<PrescriptionsView />} />
          <Route path="/laboratory" element={<LaboratoryView />} />
          <Route path="/pharmacy" element={<PharmacyView />} />
          <Route path="/billing" element={<BillingView />} />
          <Route path="/staff" element={<StaffView />} />
          <Route path="/users" element={<UsersView />} />
          <Route path="/analytics" element={<AnalyticsView />} />
          <Route path="/doctors" element={<Navigate to="/staff?tab=specialists" replace />} />
          <Route
            path="/patients"
            element={
              <PatientsView
                onSimulatePhone={(phone, name) => {
                  navigate("/messages");
                }}
              />
            }
          />
          <Route path="/settings" element={<SettingsView />} />
          <Route
            path="*"
            element={<Navigate to={isSuperAdmin ? "/superadmin" : "/dashboard"} replace />}
          />
        </Routes>
      </ErrorBoundary>

      {/* Reception Direct Booking Modal */}
      <NewAppointmentModal
        isOpen={isBookModalOpen}
        onClose={() => setIsBookModalOpen(false)}
        onCreated={() => setIsBookModalOpen(false)}
      />
    </MainLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* Normal Staff / Doctor Login */}
            <Route path="/login" element={<Login />} />

            {/* SuperAdmin Login Redirect */}
            <Route path="/superadmin/login" element={<SuperAdminLogin />} />

            {/* Protected App (handles /superadmin, /dashboard, /users, etc.) */}
            <Route path="/*" element={<ProtectedApp />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
