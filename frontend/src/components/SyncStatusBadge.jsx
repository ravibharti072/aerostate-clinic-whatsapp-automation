import React, { useState, useEffect } from "react";
import {
  FiWifi,
  FiWifiOff,
  FiRefreshCw,
  FiInbox,
  FiCloud,
  FiCheckCircle,
  FiAlertTriangle,
  FiX,
  FiTrash2,
} from "react-icons/fi";
import {
  fetchSyncStatus,
  triggerManualSync,
  fetchSyncOutbox,
  retryOutboxItem,
  deleteOutboxItem,
} from "../api";
import { useToast } from "../context/ToastContext";

export default function SyncStatusBadge() {
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [outboxItems, setOutboxItems] = useState([]);
  const [loadingOutbox, setLoadingOutbox] = useState(false);
  const [updater, setUpdater] = useState(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  const loadUpdater = async () => {
    try {
      const data = await fetchUpdaterStatus();
      setUpdater(data);
    } catch (e) {
      // quiet fail
    }
  };

  const loadStatus = async () => {
    try {
      const data = await fetchSyncStatus();
      setStatus(data);
    } catch (err) {
      setStatus((prev) => ({
        ...(prev || {}),
        is_online: false,
        mode: "Offline",
      }));
    }
  };

  useEffect(() => {
    loadStatus();
    loadUpdater();
    const interval = setInterval(loadStatus, 15000);
    const updateInterval = setInterval(loadUpdater, 60000);
    return () => {
      clearInterval(interval);
      clearInterval(updateInterval);
    };
  }, []);

  const handleApplyUpdate = async () => {
    if (applyingUpdate) return;
    try {
      setApplyingUpdate(true);
      showToast("Starting update download in background...", "info");
      const res = await applyUpdate(updater?.download_url);
      if (res.status === "applying") {
        showToast("Update applied! Restarting application...", "success");
      } else if (res.status === "dev_mode") {
        showToast(res.message, "info");
      }
    } catch (err) {
      showToast("Update error: " + err.message, "error");
    } finally {
      setApplyingUpdate(false);
    }
  };

  const handleManualSync = async () => {
    if (syncing) return;
    try {
      setSyncing(true);
      const res = await triggerManualSync();
      await loadStatus();
      if (modalOpen) {
        await loadOutbox();
      }
      const sent = res.result?.whatsapp_flush?.sent || 0;
      const isOnline = res.result?.is_online;
      if (isOnline) {
        showToast(
          `Sync complete! ${sent} WhatsApp message(s) delivered.`,
          "success"
        );
      } else {
        showToast(
          "Clinic is currently offline. All local actions remain queued.",
          "info"
        );
      }
    } catch (err) {
      showToast("Sync failed: " + err.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  const loadOutbox = async () => {
    try {
      setLoadingOutbox(true);
      const data = await fetchSyncOutbox();
      setOutboxItems(data.items || []);
    } catch (err) {
      console.warn("Failed to load outbox:", err);
    } finally {
      setLoadingOutbox(false);
    }
  };

  const openModal = () => {
    setModalOpen(true);
    loadOutbox();
  };

  const handleRetryItem = async (id) => {
    try {
      await retryOutboxItem(id);
      showToast("Retrying outbox message...", "info");
      loadOutbox();
      loadStatus();
    } catch (err) {
      showToast("Retry failed: " + err.message, "error");
    }
  };

  const handleDeleteItem = async (id) => {
    try {
      await deleteOutboxItem(id);
      showToast("Removed message from outbox queue", "info");
      loadOutbox();
      loadStatus();
    } catch (err) {
      showToast("Failed to delete item: " + err.message, "error");
    }
  };

  const isOnline = status?.is_online !== false;
  const pendingCount = status?.whatsapp_outbox?.pending || 0;

  return (
    <>
      <div className="portal-sync-widget inline-flex items-center gap-1.5 flex-shrink-0">
        {/* Status Pill matching Portal Header */}
        <button
          type="button"
          onClick={openModal}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
            isOnline
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
              : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
          }`}
          title="Click to view Offline & Sync Details"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
            }`}
          />
          <span>{isOnline ? "Online" : "Offline"}</span>

          {pendingCount > 0 && (
            <span className="bg-amber-200/80 text-amber-900 px-1.5 py-0.2 rounded-full text-[10px] font-bold">
              {pendingCount} queued
            </span>
          )}
        </button>

        {/* Compact Sync Button */}
        <button
          type="button"
          onClick={handleManualSync}
          disabled={syncing}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
            syncing
              ? "bg-blue-50 text-blue-600 border-blue-200 cursor-wait"
              : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
          }`}
          title="Sync Now (Flush Outbox & Sync Cloud)"
        >
          <FiRefreshCw
            size={12}
            className={`${syncing ? "animate-spin text-blue-600" : "text-slate-500"}`}
          />
          <span className="text-[11px] font-medium">{syncing ? "Syncing..." : "Sync"}</span>
        </button>
      </div>

      {/* Update Available Modal */}
      {updateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-teal-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600 text-white">
                  <FiDownloadCloud size={20} />
                </div>
                <div>
                  <h3 className="text-slate-900 font-bold text-base leading-tight">
                    Update Available: v{updater?.latest_version}
                  </h3>
                  <p className="text-slate-500 text-xs">
                    Current Version: v{updater?.current_version}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUpdateModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <FiX size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-slate-600">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="font-semibold text-slate-800 mb-1">What's New:</div>
                <div>{updater?.release_notes || "Performance optimizations and fixes."}</div>
              </div>
              <p className="text-slate-500">
                Updating will automatically download the new version and restart the application. Your database (<code className="bg-slate-100 px-1 py-0.5 rounded">clinic.db</code>) and records are safely preserved.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setUpdateModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl"
              >
                Later
              </button>
              <button
                type="button"
                onClick={handleApplyUpdate}
                disabled={applyingUpdate}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-xl shadow"
              >
                {applyingUpdate ? "Applying..." : "Update & Restart Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Details Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-xl ${
                    isOnline
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {isOnline ? <FiWifi size={18} /> : <FiWifiOff size={18} />}
                </div>
                <div>
                  <h3 className="text-slate-900 font-bold text-base leading-tight">
                    Offline Operations & Sync Hub
                  </h3>
                  <p className="text-slate-500 text-xs">
                    {isOnline
                      ? "Internet connected. Real-time WhatsApp Cloud & central sync active."
                      : "Working in Local Offline Mode. Normal clinic tasks work uninterrupted."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-sm text-slate-700">
              {/* Telemetry Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Internet Link</span>
                    <span
                      className={`font-bold ${
                        isOnline ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {isOnline ? "ONLINE" : "OFFLINE"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {isOnline
                      ? "WhatsApp Cloud API is directly reachable."
                      : "Local SQLite is serving all reception, OPD & billing."}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>WhatsApp Outbox</span>
                    <span className="font-bold text-blue-600">
                      {pendingCount} Pending
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {status?.whatsapp_outbox?.sent || 0} delivered |{" "}
                    {status?.whatsapp_outbox?.failed || 0} failed
                  </div>
                </div>
              </div>

              {/* Cloud Sync Status */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500 flex items-center gap-1.5 font-medium">
                    <FiCloud size={14} className="text-blue-600" />
                    Two-Way Central Cloud Sync
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      status?.cloud_sync?.cloud_sync_enabled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {status?.cloud_sync?.cloud_sync_enabled
                      ? "ENABLED"
                      : "STANDALONE LOCAL"}
                  </span>
                </div>
                <div className="text-xs text-slate-600 space-y-0.5 mt-2">
                  <p>
                    <span className="text-slate-400">Cloud URL:</span>{" "}
                    <span className="font-mono text-slate-800">
                      {status?.cloud_sync?.cloud_sync_url || "Not configured (Local SQLite only)"}
                    </span>
                  </p>
                  <p>
                    <span className="text-slate-400">Last Synced:</span>{" "}
                    <span className="text-slate-800">
                      {status?.cloud_sync?.last_cloud_sync_timestamp
                        ? new Date(status.cloud_sync.last_cloud_sync_timestamp).toLocaleTimeString()
                        : "Ready on next trigger"}
                    </span>
                  </p>
                </div>
              </div>

              {/* WhatsApp Offline Outbox Queue */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <FiInbox size={14} className="text-amber-600" />
                    WhatsApp Outbox Queue ({outboxItems.length})
                  </span>
                  <button
                    type="button"
                    onClick={loadOutbox}
                    className="text-[11px] text-blue-600 font-medium hover:underline cursor-pointer"
                  >
                    Refresh List
                  </button>
                </div>

                {loadingOutbox ? (
                  <div className="text-center py-6 text-slate-400 text-xs">
                    Loading queue items...
                  </div>
                ) : outboxItems.length === 0 ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-600">
                    <FiCheckCircle size={20} className="mx-auto text-emerald-500 mb-1" />
                    All WhatsApp messages and receipts are up to date!
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {outboxItems.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-3 text-xs shadow-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-bold text-slate-900">
                              {item.recipient || "Patient"}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                item.status === "SENT"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : item.status === "PENDING"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {item.status}
                            </span>
                            {item.retry_count > 0 && (
                              <span className="text-slate-400 text-[10px]">
                                ({item.retry_count} retries)
                              </span>
                            )}
                          </div>
                          <p className="text-slate-600 truncate text-[11px]">
                            {item.preview}
                          </p>
                          {item.last_error && (
                            <p className="text-red-500 text-[10px] truncate mt-0.5">
                              Error: {item.last_error}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.status !== "SENT" && (
                            <button
                              type="button"
                              onClick={() => handleRetryItem(item.id)}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md text-[10px] font-medium cursor-pointer"
                              title="Retry send now"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                            title="Remove from queue"
                          >
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Auto-sync background cycle: every {status?.cloud_sync?.auto_sync_interval || 30}s
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={syncing}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[#254d90] hover:bg-[#1e3f77] rounded-lg flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <FiRefreshCw size={13} className={syncing ? "animate-spin" : ""} />
                  <span>{syncing ? "Syncing..." : "Sync Now"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
