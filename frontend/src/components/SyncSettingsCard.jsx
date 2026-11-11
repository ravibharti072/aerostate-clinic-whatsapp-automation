import React, { useState, useEffect } from "react";
import {
  FiCloud,
  FiSave,
  FiRefreshCw,
  FiCheckCircle,
  FiAlertCircle,
  FiInbox,
  FiWifi,
  FiWifiOff,
  FiLock,
  FiEye,
  FiEyeOff,
  FiTrash2,
  FiServer,
  FiClock,
  FiShield,
  FiHelpCircle,
} from "react-icons/fi";
import {
  fetchSyncConfig,
  updateSyncConfig,
  fetchSyncStatus,
  fetchSyncOutbox,
  retryOutboxItem,
  deleteOutboxItem,
  triggerManualSync,
} from "../api";
import { useToast } from "../context/ToastContext";

export default function SyncSettingsCard() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [outboxFilter, setOutboxFilter] = useState("");

  const [config, setConfig] = useState({
    cloud_sync_enabled: false,
    cloud_sync_url: "",
    cloud_sync_api_key: "",
    auto_sync_interval: 30,
  });

  const [status, setStatus] = useState(null);
  const [outboxItems, setOutboxItems] = useState([]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [cfgData, statusData, outboxData] = await Promise.all([
        fetchSyncConfig(),
        fetchSyncStatus(),
        fetchSyncOutbox(outboxFilter || null),
      ]);
      setConfig({
        cloud_sync_enabled: cfgData.cloud_sync_enabled || false,
        cloud_sync_url: cfgData.cloud_sync_url || "",
        cloud_sync_api_key: cfgData.cloud_sync_api_key || "",
        auto_sync_interval: cfgData.auto_sync_interval || 30,
      });
      setStatus(statusData);
      setOutboxItems(outboxData.items || []);
    } catch (err) {
      console.error("Failed to load sync settings:", err);
      showToast("Failed to load sync settings.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [outboxFilter]);

  const handleSaveConfig = async (e) => {
    e?.preventDefault();
    try {
      setSaving(true);
      await updateSyncConfig(config);
      showToast("Offline & Cloud Sync configuration saved!", "success");
      const updatedStatus = await fetchSyncStatus();
      setStatus(updatedStatus);
    } catch (err) {
      showToast("Failed to save config: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleManualSync = async () => {
    try {
      setSyncing(true);
      const res = await triggerManualSync();
      const sent = res.result?.whatsapp_flush?.sent || 0;
      const isOnline = res.result?.is_online;
      if (isOnline) {
        showToast(
          `Sync successful! ${sent} WhatsApp message(s) dispatched.`,
          "success"
        );
      } else {
        showToast(
          "Clinic is currently offline. All local actions remain queued.",
          "info"
        );
      }
      loadAll();
    } catch (err) {
      showToast("Manual sync error: " + err.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = async (id) => {
    try {
      await retryOutboxItem(id);
      showToast("Retrying outbox item...", "info");
      loadAll();
    } catch (err) {
      showToast("Retry failed: " + err.message, "error");
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteOutboxItem(id);
      showToast("Deleted message from outbox queue", "info");
      loadAll();
    } catch (err) {
      showToast("Delete failed: " + err.message, "error");
    }
  };

  const isOnline = status?.is_online !== false;

  return (
    <div className="space-y-6">
      {/* 1. Status Overview Banner */}
      <div className="settings-card">
        <div className="card-header">
          <div className="card-header-left">
            <div className={`header-icon ${isOnline ? "teal" : "blue"}`}>
              {isOnline ? <FiWifi size={18} /> : <FiWifiOff size={18} />}
            </div>
            <div>
              <h2 className="text-[17px] font-bold text-slate-900 leading-tight">Real-Time Connectivity &amp; Sync Status</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                System automatically detects internet connection and synchronizes queued data
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing}
            className="px-4 py-2 h-[36px] bg-[#254d90] hover:bg-[#1b3a6e] text-white rounded-lg text-[13px] font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
          >
            <FiRefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            <span>{syncing ? "Syncing..." : "Sync All Now"}</span>
          </button>
        </div>

        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Box 1 */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-lg p-3.5 transition-all hover:border-slate-300">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11.5px] text-slate-600 font-bold tracking-wider uppercase">Network State</span>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${
                    isOnline
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
              <div className="text-[17px] font-bold text-slate-900 mb-1 leading-snug">
                {isOnline ? "Direct Internet Active" : "Local-Only Operation"}
              </div>
              <p className="text-[12.5px] text-slate-600 leading-relaxed">
                {isOnline
                  ? "Meta WhatsApp Cloud API and web services reachable."
                  : "All clinic tasks (reception, OPD, bills, rx) work 100% locally."}
              </p>
            </div>

            {/* Box 2 */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-lg p-3.5 transition-all hover:border-slate-300">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11.5px] text-slate-600 font-bold tracking-wider uppercase">WhatsApp Outbox</span>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  {status?.whatsapp_outbox?.pending || 0} Pending
                </span>
              </div>
              <div className="text-[17px] font-bold text-slate-900 mb-1 leading-snug">
                {status?.whatsapp_outbox?.sent || 0} Sent
              </div>
              <p className="text-[12.5px] text-slate-600 leading-relaxed">
                Messages, prescriptions, and receipts queued during offline mode.
              </p>
            </div>

            {/* Box 3 */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-lg p-3.5 transition-all hover:border-slate-300">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11.5px] text-slate-600 font-bold tracking-wider uppercase">Central Cloud Sync</span>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${
                    config.cloud_sync_enabled
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-600 border border-slate-200"
                  }`}
                >
                  {config.cloud_sync_enabled ? "Enabled" : "Standby"}
                </span>
              </div>
              <div className="text-[17px] font-bold text-slate-900 mb-1 truncate leading-snug">
                {config.cloud_sync_enabled ? "Two-Way Active" : "Local Standalone"}
              </div>
              <p className="text-[12.5px] text-slate-600 truncate leading-relaxed">
                {status?.cloud_sync?.last_cloud_sync_timestamp
                  ? `Last sync: ${new Date(status.cloud_sync.last_cloud_sync_timestamp).toLocaleTimeString()}`
                  : "No cloud sync executed yet."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Cloud Server Synchronization Settings */}
      <div className="settings-card">
        <div className="card-header">
          <div className="card-header-left">
            <div className="header-icon teal">
              <FiCloud size={18} />
            </div>
            <div>
              <h2 className="text-[17px] font-bold text-slate-900 leading-tight">Two-Way Central Cloud Database Sync</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Synchronize offline walk-ins, consultations, and receipts with your central server
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveConfig} className="card-body">
          <div className="space-y-4">
            {/* Toggle Enable */}
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div>
                <div className="text-[14px] font-bold text-slate-900">
                  Enable Cloud Server Synchronization
                </div>
                <div className="text-[12.5px] text-slate-600 mt-0.5">
                  When enabled and online, local data merges with the remote cloud database automatically
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.cloud_sync_enabled}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      cloud_sync_enabled: e.target.checked,
                    }))
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#254d90]"></div>
              </label>
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">
                  Central Cloud Endpoint URL
                </label>
                <div className="relative">
                  <FiServer className="absolute left-3 top-2.5 text-slate-400" size={15} />
                  <input
                    type="url"
                    value={config.cloud_sync_url}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        cloud_sync_url: e.target.value,
                      }))
                    }
                    placeholder="https://clinic-cloud.yourdomain.com"
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-md text-[13.5px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#254d90] focus:ring-2 focus:ring-blue-100 font-mono transition"
                  />
                </div>
                <p className="text-[12px] text-slate-500 mt-1 font-medium">
                  Base URL of your central deployed clinic instance (without trailing slash).
                </p>
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">
                  Cloud Sync API Secret Key
                </label>
                <div className="relative">
                  <FiLock className="absolute left-3 top-2.5 text-slate-400" size={15} />
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={config.cloud_sync_api_key}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        cloud_sync_api_key: e.target.value,
                      }))
                    }
                    placeholder="Enter secret token configured on remote server"
                    className="w-full pl-9 pr-9 py-2 bg-white border border-slate-300 rounded-md text-[13.5px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#254d90] focus:ring-2 focus:ring-blue-100 font-mono transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition"
                  >
                    {showApiKey ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
                <p className="text-[12px] text-slate-500 mt-1 font-medium">
                  Used for mutual HMAC Bearer token authorization between local and cloud.
                </p>
              </div>
            </div>

            {/* Auto-Sync Interval */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-slate-800 mb-1.5">
                  Auto-Sync Cycle Interval
                </label>
                <div className="relative">
                  <FiClock className="absolute left-3 top-2.5 text-slate-400" size={15} />
                  <select
                    value={config.auto_sync_interval}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        auto_sync_interval: parseInt(e.target.value, 10),
                      }))
                    }
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-md text-[13.5px] text-slate-900 focus:outline-none focus:border-[#254d90] focus:ring-2 focus:ring-blue-100 transition"
                  >
                    <option value={15}>Every 15 Seconds (Rapid OPD updates)</option>
                    <option value={30}>Every 30 Seconds (Recommended standard)</option>
                    <option value={60}>Every 1 Minute</option>
                    <option value={120}>Every 2 Minutes</option>
                    <option value={300}>Every 5 Minutes (Low bandwidth)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 h-[38px] bg-[#254d90] hover:bg-[#1b3a6e] text-white rounded-lg text-[13.5px] font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
              >
                <FiSave size={14} />
                <span>{saving ? "Saving..." : "Save Sync Settings"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* 3. WhatsApp Offline Outbox Inspector */}
      <div className="settings-card">
        <div className="card-header">
          <div className="card-header-left">
            <div className="header-icon blue">
              <FiInbox size={18} />
            </div>
            <div>
              <h2 className="text-[17px] font-bold text-slate-900 leading-tight">WhatsApp Offline Outbox Log</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Queue of patient messages, prescriptions, and invoice receipts dispatched or pending delivery
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={outboxFilter}
              onChange={(e) => setOutboxFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-[13px] font-semibold text-slate-700 focus:outline-none focus:border-[#254d90]"
            >
              <option value="">All Outbox Messages</option>
              <option value="PENDING">Pending Only</option>
              <option value="SENT">Delivered Only</option>
              <option value="FAILED">Failed Only</option>
            </select>
          </div>
        </div>

        <div className="card-body">
          {outboxItems.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <FiCheckCircle size={32} className="mx-auto text-emerald-500 mb-2.5" />
              <p className="font-bold text-slate-800 text-[15px]">Outbox Queue is Empty</p>
              <p className="text-slate-500 mt-1 text-[13px] max-w-sm mx-auto">
                All patient notifications and receipts have been successfully delivered to WhatsApp.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-[13px] text-left text-slate-700">
                <thead className="text-[11.5px] uppercase tracking-wider text-slate-700 bg-slate-50 border-b border-slate-200 font-bold">
                  <tr>
                    <th className="py-2.5 px-3.5">Recipient Phone</th>
                    <th className="py-2.5 px-3.5">Message Type</th>
                    <th className="py-2.5 px-3.5">Content Preview</th>
                    <th className="py-2.5 px-3.5">Status</th>
                    <th className="py-2.5 px-3.5">Queued At</th>
                    <th className="py-2.5 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150">
                  {outboxItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3.5 font-mono font-bold text-slate-900 text-[13px]">
                        {item.recipient}
                      </td>
                      <td className="py-3 px-3.5 text-slate-600 uppercase text-[11px] font-bold">
                        {item.queue_type}
                      </td>
                      <td className="py-3 px-3.5 max-w-xs truncate text-slate-800 text-[13px]" title={item.preview}>
                        {item.preview}
                        {item.last_error && (
                          <div className="text-[11px] text-rose-600 truncate mt-0.5">
                            {item.last_error}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase border ${
                            item.status === "SENT"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : item.status === "PENDING"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}
                        >
                          {item.status}
                        </span>
                        {item.retry_count > 0 && (
                          <span className="text-[11px] text-slate-500 font-medium ml-1">
                            ({item.retry_count}x)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-slate-600 text-[12px]">
                        {item.created_at ? new Date(item.created_at).toLocaleTimeString() : "—"}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.status !== "SENT" && (
                            <button
                              type="button"
                              onClick={() => handleRetry(item.id)}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11.5px] font-semibold transition"
                              title="Retry send now"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                            title="Remove from queue"
                          >
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 4. Architecture Explainer */}
      <div className="bg-blue-50/70 border border-blue-200/80 rounded-lg p-4 text-[13px] text-slate-700 flex items-start gap-3">
        <FiHelpCircle className="text-[#254d90] shrink-0 mt-0.5" size={18} />
        <div>
          <h4 className="font-bold text-[#1e3a8a] text-[14px] mb-1">How Offline Operation Works</h4>
          <p className="text-slate-700 leading-relaxed text-[13px]">
            When internet connectivity drops, your clinic system switches instantly to{" "}
            <strong className="text-slate-800 font-semibold">Local-First Mode</strong>. Doctors and reception staff can continue
            creating appointments, registering patients, writing prescriptions, and printing billing receipts with zero lag.
            All outgoing WhatsApp alerts are safely staged in the local SQLite Outbox. The moment the computer reconnects
            to Wi-Fi or internet, all pending messages are dispatched to patients automatically, and local clinical records sync
            with the central cloud.
          </p>
        </div>
      </div>
    </div>
  );
}
