import React, { useState, useEffect } from "react";
import {
  FiDownloadCloud,
  FiRefreshCw,
  FiCheckCircle,
  FiAlertCircle,
  FiInfo,
  FiServer,
  FiCpu,
  FiExternalLink,
} from "react-icons/fi";
import { fetchUpdaterStatus, checkForUpdates, applyUpdate } from "../api";
import { useToast } from "../context/ToastContext";

export default function UpdateSettingsCard() {
  const { showToast } = useToast();
  const [updater, setUpdater] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadStatus = async () => {
    try {
      const data = await fetchUpdaterStatus();
      setUpdater(data);
    } catch (err) {
      console.warn("Could not load updater status:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleCheck = async () => {
    try {
      setChecking(true);
      const res = await checkForUpdates();
      setUpdater(res);
      if (res.update_available) {
        showToast(
          `New version v${res.latest_version} is available!`,
          "success"
        );
      } else {
        showToast(
          `You are already on the latest version (v${res.current_version}).`,
          "info"
        );
      }
    } catch (err) {
      showToast("Update check failed: " + err.message, "error");
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    if (applying) return;
    try {
      setApplying(true);
      showToast("Starting update download in background...", "info");
      const res = await applyUpdate(updater?.download_url);
      if (res.status === "applying") {
        showToast(
          "Update applied successfully! Application is restarting...",
          "success"
        );
      } else if (res.status === "dev_mode") {
        showToast(res.message, "info");
      }
    } catch (err) {
      showToast("Update failed: " + err.message, "error");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-500">
        <FiRefreshCw className="animate-spin inline-block mr-2" />
        Loading update information...
      </div>
    );
  }

  const isUpdateAvailable = updater?.update_available;
  const isFrozen = updater?.is_frozen;

  return (
    <div className="space-y-6">
      {/* 1. Header Overview Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xl border border-blue-100">
              <FiDownloadCloud size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900">
                  AeroState Clinic Software Updates
                </h3>
                <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  v{updater?.current_version || "2.2.5"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatic over-the-air binary updates & version management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCheck}
              disabled={checking}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                checking
                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-wait"
                  : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300 shadow-sm"
              }`}
            >
              <FiRefreshCw size={13} className={checking ? "animate-spin text-blue-600" : ""} />
              <span>{checking ? "Checking..." : "Check for Updates"}</span>
            </button>
          </div>
        </div>

        {/* Status Callout */}
        <div className="mt-5">
          {isUpdateAvailable ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg mt-0.5">
                  <FiCheckCircle size={20} />
                </div>
                <div>
                  <h4 className="text-emerald-900 font-bold text-sm">
                    New Version Available: v{updater?.latest_version}
                  </h4>
                  <p className="text-emerald-700 text-xs mt-0.5">
                    {updater?.release_notes || "Includes performance enhancements and fixes."}
                  </p>
                  <p className="text-[11px] text-emerald-600 mt-1 font-mono">
                    Target: {updater?.release_name || `v${updater?.latest_version}`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md flex items-center gap-2 flex-shrink-0 cursor-pointer ${
                  applying
                    ? "bg-slate-400 cursor-wait"
                    : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98]"
                }`}
              >
                <FiDownloadCloud size={16} />
                <span>{applying ? "Applying & Restarting..." : "Update & Restart Now"}</span>
              </button>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-200 text-slate-600 rounded-lg">
                  <FiCheckCircle size={18} />
                </div>
                <div>
                  <h4 className="text-slate-800 font-semibold text-sm">
                    You're using the latest version
                  </h4>
                  <p className="text-slate-500 text-xs">
                    Current version v{updater?.current_version} is up to date.
                    {updater?.last_checked && (
                      <span className="ml-1 text-slate-400">
                        (Last checked: {new Date(updater.last_checked).toLocaleTimeString()})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <span className="text-xs bg-slate-200/70 text-slate-700 px-3 py-1 rounded-full font-medium">
                Up to Date
              </span>
            </div>
          )}
        </div>

        {/* Runtime & Technical Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <FiCpu size={14} />
              <span>Deployment Mode</span>
            </div>
            <div className="text-slate-800 font-bold text-sm">
              {isFrozen ? "Windows Executable (.exe)" : "Developer / Python Mode"}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {isFrozen ? "Self-contained portable binary" : "Local Git repository"}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <FiServer size={14} />
              <span>Update Mechanism</span>
            </div>
            <div className="text-slate-800 font-bold text-sm">
              Hot-swap Self-Restart
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Preserves clinic.db & all patient records
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <FiInfo size={14} />
              <span>Auto-Check on Launch</span>
            </div>
            <div className="text-emerald-700 font-bold text-sm flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Enabled
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Checks GitHub / update manifest on start
            </div>
          </div>
        </div>
      </div>

      {/* 2. How Automatic Updates Work Info Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <FiInfo className="text-blue-600" />
          <span>How Automatic Updates Work</span>
        </h4>
        <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
              1
            </span>
            <div>
              <strong className="text-slate-800">Automatic Background Check:</strong> When the app launches with an internet connection, it checks the central repository for newer releases without slowing down startup.
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
              2
            </span>
            <div>
              <strong className="text-slate-800">One-Click Hot Swap:</strong> When you click "Update & Restart", the application downloads the updated binary, seamlessly replaces `AerostateClinic.exe`, and restarts.
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
              3
            </span>
            <div>
              <strong className="text-slate-800">Zero Data Loss:</strong> Your database (<code className="bg-slate-200/60 px-1 py-0.5 rounded">clinic.db</code>), patient records, prescriptions, billing history, and settings remain 100% intact through every update.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
