import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  FiArrowRight,
  FiEye,
  FiEyeOff,
  FiLock,
  FiShield,
  FiUser,
  FiLoader
} from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import AerostateLogo from "../../components/common/AerostateLogo";
import "./login.css";

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated, isSuperAdmin } = useAuth();

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

          {/* Clean Security Footer */}
          <div className="asl-secure-note">
            <FiShield size={14} />
            <span>Secure access for authorized clinic personnel only.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
