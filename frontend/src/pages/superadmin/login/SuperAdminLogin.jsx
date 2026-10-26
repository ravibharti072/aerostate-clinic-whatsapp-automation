import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  FiShield,
  FiEye,
  FiEyeOff,
  FiLock,
  FiUser,
  FiLoader,
  FiArrowRight
} from "react-icons/fi";
import { useAuth } from "../../../context/AuthContext";
import AerostateLogo from "../../../components/common/AerostateLogo";
import "./superAdminLogin.css";

export default function SuperAdminLogin() {
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setError("Please enter both username and password.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const user = await login(cleanUser, password);

      if ((user?.role || "").toLowerCase() !== "superadmin") {
        setError("Access Denied: This portal is restricted to SuperAdmin master accounts only. Please use the Client Login.");
        return;
      }
      // On success, AuthContext state updates and App renders SuperAdminView automatically!
    } catch (err) {
      setError(err.message || "Invalid SuperAdmin credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="sa-login-page">
      {/* Left Branding Panel (#0a1120) */}
      <section className="sa-brand-panel">
        <div className="sa-brand-content">
          <div className="sa-brand-main">
            <div className="sa-logo-wrapper">
              <AerostateLogo size="xl" />
            </div>

            <div className="sa-brand-meta">
              <p className="sa-brand-kicker">Aerostate Lab</p>
              <h1>Clinic SuperAdmin</h1>
              <p className="sa-brand-text">
                Centralized master control, staff account provisioning, access
                permissions, and clinic system orchestration.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Right Form Panel */}
      <section className="sa-form-panel">
        <div className="sa-login-card">
          <div className="sa-login-header">
            <h2>SuperAdmin Access</h2>
            <p>Authenticate with master credentials to proceed.</p>
          </div>

          <form onSubmit={handleSubmit} className="sa-login-form" noValidate>
            {/* Username Field */}
            <div className="sa-field-group">
              <label htmlFor="saUsername">SuperAdmin Username</label>
              <div className={`sa-input-wrap ${error ? "has-error" : ""}`}>
                <FiUser className="sa-input-icon" />
                <input
                  id="saUsername"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    if (error) setError("");
                    setUsername(e.target.value);
                  }}
                  autoComplete="username"
                  placeholder="e.g. superadmin"
                  disabled={loading}
                  autoFocus
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="sa-field-group">
              <label htmlFor="saPassword">Master Password</label>
              <div className={`sa-input-wrap ${error ? "has-error" : ""}`}>
                <FiLock className="sa-input-icon" />
                <input
                  id="saPassword"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    if (error) setError("");
                    setPassword(e.target.value);
                  }}
                  autoComplete="current-password"
                  placeholder="Enter master password"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className="sa-password-toggle"
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
              <div className="sa-inline-error">
                <span>{error}</span>
              </div>
            )}

            {/* Action Button */}
            <button
              type="submit"
              className="sa-login-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <FiLoader className="sa-spinner" size={17} />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Authenticate Access</span>
                  <FiArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          {/* Switch link to normal client login */}
          <div className="sa-switch-link">
            <span>Clinic account? </span>
            <Link to="/login">Client Sign In &rarr;</Link>
          </div>

          {/* Clean Security Footer */}
          <div className="sa-secure-note">
            <FiShield size={14} />
            <span>Protected Master Area • Aerostate Security Protocol</span>
          </div>
        </div>
      </section>
    </main>
  );
}
