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
              <h3 className="card-title">Real-Time Connectivity & Sync Status</h3>
              <p className="card-subtitle">
                System automatically detects internet connection and synchronizes queued data
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing}
            className="portal-action-btn portal-action-btn-blue flex items-center gap-1.5"
          >
            <FiRefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            <span>{syncing ? "Syncing..." : "Sync All Now"}</span>
          </button>
        </div>

        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Box 1 */}
            <div className="bg-[#122135] border border-[#1e3450] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">Network State</span>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    isOnline
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
              <div className="text-xl font-bold text-white mb-1">
                {isOnline ? "Direct Internet Active" : "Local-Only Operation"}
              </div>
              <p className="text-xs text-slate-400">
                {isOnline
                  ? "Meta WhatsApp Cloud API and web services reachable."
                  : "All clinic tasks (reception, OPD, bills, rx) work 100% locally."}
              </p>
            </div>

            {/* Box 2 */}
            <div className="bg-[#122135] border border-[#1e3450] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">WhatsApp Outbox</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-500/20 text-blue-300">
                  {status?.whatsapp_outbox?.pending || 0} Pending
                </span>
              </div>
              <div className="text-xl font-bold text-white mb-1">
                {status?.whatsapp_outbox?.sent || 0} Sent
              </div>
              <p className="text-xs text-slate-400">
                Messages, prescriptions, and receipts queued during offline mode.
              </p>
            </div>

            {/* Box 3 */}
            <div className="bg-[#122135] border border-[#1e3450] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">Central Cloud Sync</span>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    config.cloud_sync_enabled
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-slate-700/40 text-slate-400"
                  }`}
                >
                  {config.cloud_sync_enabled ? "Enabled" : "Standby"}
                </span>
              </div>
              <div className="text-xl font-bold text-white mb-1 truncate">
                {config.cloud_sync_enabled ? "Two-Way Active" : "Local Standalone"}
              </div>
              <p className="text-xs text-slate-400 truncate">
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
              <h3 className="card-title">Two-Way Central Cloud Database Sync</h3>
              <p className="card-subtitle">
                Synchronize offline walk-ins, consultations, and receipts with your central server
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveConfig} className="card-body">
          <div className="space-y-4">
            {/* Toggle Enable */}
            <div className="flex items-center justify-between p-3.5 bg-[#122135] border border-[#1e3450] rounded-xl">
              <div>
                <div className="text-sm font-semibold text-white">
                  Enable Cloud Server Synchronization
                </div>
                <div className="text-xs text-slate-400">
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
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Central Cloud Endpoint URL
                </label>
                <div className="relative">
                  <FiServer className="absolute left-3 top-3 text-slate-500" size={15} />
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
                    className="w-full pl-9 pr-3 py-2 bg-[#0c1624] border border-[#233a57] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Base URL of your central deployed clinic instance (without trailing slash).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Cloud Sync API Secret Key
                </label>
                <div className="relative">
                  <FiLock className="absolute left-3 top-3 text-slate-500" size={15} />
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
                    className="w-full pl-9 pr-10 py-2 bg-[#0c1624] border border-[#233a57] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                  >
                    {showApiKey ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Used for mutual HMAC Bearer token authorization between local and cloud.
                </p>
              </div>
            </div>

            {/* Auto-Sync Interval */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Auto-Sync Cycle Interval
                </label>
                <div className="relative">
                  <FiClock className="absolute left-3 top-3 text-slate-500" size={15} />
                  <select
                    value={config.auto_sync_interval}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        auto_sync_interval: parseInt(e.target.value, 10),
                      }))
                    }
                    className="w-full pl-9 pr-3 py-2 bg-[#0c1624] border border-[#233a57] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
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
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow"
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
              <h3 className="card-title">WhatsApp Offline Outbox Log</h3>
              <p className="card-subtitle">
                Queue of patient messages, prescriptions, and invoice receipts dispatched or pending delivery
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={outboxFilter}
              onChange={(e) => setOutboxFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#0c1624] border border-[#233a57] rounded-lg text-xs text-slate-300 focus:outline-none"
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
            <div className="text-center py-8 text-slate-400 text-xs">
              <FiCheckCircle size={28} className="mx-auto text-emerald-400 mb-2" />
              <p className="font-semibold text-slate-200">Outbox Queue is Empty</p>
              <p className="text-slate-500 mt-0.5">
                All patient notifications and receipts have been successfully delivered to WhatsApp.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="text-[11px] uppercase tracking-wider text-slate-400 bg-[#0d1828] border-b border-[#1e3450]">
                  <tr>
                    <th className="py-2.5 px-3">Recipient Phone</th>
                    <th className="py-2.5 px-3">Message Type</th>
                    <th className="py-2.5 px-3">Content Preview</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Queued At</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#182a42]">
                  {outboxItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#122238]/60 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-medium text-white">
                        {item.recipient}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 uppercase text-[10px]">
                        {item.queue_type}
                      </td>
                      <td className="py-2.5 px-3 max-w-xs truncate text-slate-300" title={item.preview}>
                        {item.preview}
                        {item.last_error && (
                          <div className="text-[10px] text-red-400 truncate mt-0.5">
                            {item.last_error}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.status === "SENT"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : item.status === "PENDING"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {item.status}
                        </span>
                        {item.retry_count > 0 && (
                          <span className="text-[10px] text-slate-500 ml-1">
                            ({item.retry_count}x)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {item.created_at ? new Date(item.created_at).toLocaleTimeString() : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.status !== "SENT" && (
                            <button
                              type="button"
                              onClick={() => handleRetry(item.id)}
                              className="px-2 py-1 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded text-[10px] font-medium"
                              title="Retry send now"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-300 rounded"
                            title="Remove from queue"
                          >
                            <FiTrash2 size={13} />
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
      <div className="bg-[#0f1d30] border border-[#213752] rounded-xl p-4 text-xs text-slate-300 flex items-start gap-3">
        <FiHelpCircle className="text-teal-400 shrink-0 mt-0.5" size={18} />
        <div>
          <h4 className="font-semibold text-white mb-1">How Offline Operation Works</h4>
          <p className="text-slate-400 leading-relaxed">
            When internet connectivity drops, your clinic system switches instantly to{" "}
            <strong className="text-white">Local-First Mode</strong>. Doctors and reception staff can continue
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
