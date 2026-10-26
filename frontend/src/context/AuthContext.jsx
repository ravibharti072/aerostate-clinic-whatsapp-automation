import React, { createContext, useContext, useState, useEffect } from "react";
import { loginUser, refreshSession, logoutUser, setAccessToken } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // In-memory user state (non-sensitive profile for UI display)
  const [user, setUser] = useState(null);

  // In-memory access token state (strictly kept in JS memory, NEVER in localStorage)
  const [token, setToken] = useState(null);

  const [loading, setLoading] = useState(true);

  // 1. Silent Session Initialization via HttpOnly Refresh Cookie
  useEffect(() => {
    let isMounted = true;
    const initializeAuth = async () => {
      try {
        const refreshed = await refreshSession();
        if (refreshed && refreshed.access_token && isMounted) {
          setToken(refreshed.access_token);
          setUser(refreshed.user);
        } else if (isMounted) {
          setToken(null);
          setUser(null);
        }
      } catch {
        if (isMounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    initializeAuth();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Silent Background Token Refresh (every 10 minutes; access token lasts 15 minutes)
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(async () => {
      try {
        const refreshed = await refreshSession();
        if (refreshed && refreshed.access_token) {
          setToken(refreshed.access_token);
          setUser(refreshed.user);
        }
      } catch (err) {
        console.warn("Silent background refresh failed:", err);
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(interval);
  }, [token]);

  const login = async (username, password) => {
    const res = await loginUser(username, password);
    setToken(res.access_token);
    setUser(res.user);
    // Note: No tokens are stored in localStorage!
    return res.user;
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    await logoutUser();
  };

  const isSuperAdmin = (user?.role || "").toLowerCase() === "superadmin";

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: Boolean(token && user),
        isSuperAdmin,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
