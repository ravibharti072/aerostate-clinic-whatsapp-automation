import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  FiArrowRight,
  FiEye,
  FiEyeOff,
  FiLock,
  FiShield,
  FiUser,
  FiLoader,
  FiSettings
} from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import AerostateLogo from "../../components/common/AerostateLogo";
import { getBaseUrl, setApiBaseUrl } from "../../api";
import "./login.css";

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated, isSuperAdmin } = useAuth();

  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(getBaseUrl() || "");
  const [serverStatusMsg, setServerStatusMsg] = useState("");

  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      if (isSuperAdmin) {
        navigate("/superadmin", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    }
  }, [isAuthenticated, isSuperAdmin, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (error) setError("");
    setCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const username = credentials.username.trim();
    if (!username || !credentials.password) {
      setError("Please enter your User ID and password.");
      return;
    }

    try {
      setError("");
      setLoading(true);
      const user = await login(username, credentials.password);
      const role = (user?.role || "").toLowerCase();
      if (role === "superadmin") {
        navigate("/superadmin", { replace: true });
      } else if (role === "doctor") {
        navigate("/queue", { replace: true });
      } else if (role === "pharma" || role === "pharmacist") {
        navigate("/pharmacy", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      console.error("Login failed:", err);
      setError(err.message || "Unable to log in. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveServerUrl = () => {
    setApiBaseUrl(serverUrlInput.trim());
    setServerStatusMsg("Server URL saved!");
    setTimeout(() => {
      setShowServerModal(false);
      setServerStatusMsg("");
    }, 600);
  };

  return (
    <main className="asl-login-page">
      {/* Left Branding Panel (#0a1120) */}
      <section className="asl-brand-panel">
        <div className="asl-brand-content">
          <div className="asl-brand-main">
            <div className="asl-logo-wrapper">
              <AerostateLogo size="xl" />
            </div>

            <div className="asl-brand-meta">
              <p className="asl-brand-kicker">Aerostate Lab</p>
              <h1>Clinic WhatsApp Suite</h1>
              <p className="asl-brand-text">
                Client portal for clinics to manage patient bookings,
                consultation schedules, and automated WhatsApp appointments.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Right Form Panel */}
      <section className="asl-form-panel">
        <div className="asl-login-card">
          <div className="asl-login-header">
            <h2>Welcome Back</h2>
            <p>Login to manage your clinic appointments &amp; services.</p>
          </div>

          <form onSubmit={handleSubmit} className="asl-login-form" noValidate>
            {/* User ID Field */}
            <div className="asl-field-group">
              <label htmlFor="username">User ID</label>
              <div className={`asl-input-wrap ${error ? "has-error" : ""}`}>
                <FiUser className="asl-input-icon" />
                <input
                  id="username"
                  type="text"
                  name="username"
                  value={credentials.username}
                  onChange={handleChange}
                  autoComplete="username"
                  placeholder="Enter your user ID"
                  disabled={loading}
                  autoFocus
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="asl-field-group">
              <div className="asl-label-row">
                <label htmlFor="password">Password</label>
                <a
                  href="#forgot"
                  className="asl-forgot-link"
                  onClick={(e) => {
                    e.preventDefault();
                    alert("Please contact your Clinic SuperAdmin to reset your credentials.");
                  }}
                >
                  Forgot password?
                </a>
              </div>

              <div className={`asl-input-wrap ${error ? "has-error" : ""}`}>
                <FiLock className="asl-input-icon" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={credentials.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className="asl-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={loading}
                  tabIndex={-1}
                >
                  {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                </button>
              </div>
            </div>

            {/* Inline Error State */}
            {error && (
              <div className="asl-inline-error">
                <span>{error}</span>
              </div>
            )}

            {/* Submit Action Button */}
            <button
              type="submit"
              className="asl-login-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <FiLoader className="asl-spinner" size={17} />
                  <span>Logging in...</span>
                </>
              ) : (
                <>
                  <span>Login</span>
                  <FiArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          {/* Switch link to SuperAdmin master login */}
          <div className="mt-4 text-center text-xs text-slate-500">
            <span>Are you a SuperAdmin? </span>
            <Link to="/superadmin" className="text-[#2d5696] font-semibold hover:underline">
              Master Sign In &rarr;
            </Link>
          </div>

          {/* Server Config & Security Footer */}
          <div className="mt-4 pt-3 border-t border-slate-700/40 flex items-center justify-between text-xs text-slate-500">
            <button
              type="button"
              onClick={() => setShowServerModal(true)}
              className="flex items-center gap-1 text-slate-400 hover:text-blue-400 transition"
            >
              <FiSettings size={13} />
              <span>Server Connection</span>
            </button>
            <div className="flex items-center gap-1">
              <FiShield size={12} />
              <span>Encrypted</span>
            </div>
          </div>
        </div>
      </section>

      {/* Server Configuration Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
              <FiSettings className="text-blue-400" /> Clinic Server Connection
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Enter your backend server address (e.g.{" "}
              <code className="text-blue-300">http://192.168.1.5:8000</code> or your domain).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  API Base URL
                </label>
                <input
                  type="url"
                  placeholder="e.g. http://192.168.1.10:8000"
                  value={serverUrlInput}
                  onChange={(e) => setServerUrlInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {serverStatusMsg && (
                <p className="text-xs text-emerald-400 font-medium">{serverStatusMsg}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowServerModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveServerUrl}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                >
                  Save &amp; Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
