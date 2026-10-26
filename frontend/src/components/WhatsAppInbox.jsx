import React, { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FiMessageCircle,
  FiSend,
  FiSearch,
  FiRotateCw,
  FiUser,
  FiPhone,
  FiCalendar,
  FiClock,
  FiCheck,
  FiCheckCircle,
  FiPlus,
  FiShield,
  FiZap,
  FiX
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import { useToast } from "../context/ToastContext";
import {
  fetchWhatsAppThreads,
  fetchWhatsAppMessages,
  sendWhatsAppMessage,
  fetchWhatsAppStats,
  fetchWhatsAppTemplates
} from "../api";
import "./whatsappInbox.css";

// Helper function to format WhatsApp markdown (*bold*, _italic_, ~strike~) safely into JSX
function formatWhatsAppBody(text) {
  if (!text) return "";
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    const regex = /(\*[^*]+\*|_[^_]+_|~[^~]+~)/g;
    let lastIdx = 0;
    let match;
    const elements = [];
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIdx) {
        elements.push(line.substring(lastIdx, match.index));
      }
      const token = match[0];
      if (token.startsWith("*") && token.endsWith("*")) {
        elements.push(
          <strong key={`${lineIdx}-${match.index}`} className="font-bold">
            {token.slice(1, -1)}
          </strong>
        );
      } else if (token.startsWith("_") && token.endsWith("_")) {
        elements.push(
          <em key={`${lineIdx}-${match.index}`} className="italic">
            {token.slice(1, -1)}
          </em>
        );
      } else if (token.startsWith("~") && token.endsWith("~")) {
        elements.push(
          <del key={`${lineIdx}-${match.index}`} className="line-through">
            {token.slice(1, -1)}
          </del>
        );
      }
      lastIdx = match.index + token.length;
    }
    if (lastIdx < line.length) {
      elements.push(line.substring(lastIdx));
    }
    return (
      <React.Fragment key={lineIdx}>
        {elements}
        {lineIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

export default function WhatsAppInbox({ onOpenBookModal }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const phoneParam = searchParams.get("phone");

  const [stats, setStats] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [threads, setThreads] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(phoneParam || "");
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [sendError, setSendError] = useState("");

  const messagesEndRef = useRef(null);

  const loadStatsAndTemplates = async () => {
    try {
      const [sData, tData] = await Promise.all([
        fetchWhatsAppStats(),
        fetchWhatsAppTemplates(),
      ]);
      setStats(sData);
      setTemplates(tData || []);
    } catch (err) {
      console.warn("Failed to load WhatsApp metadata:", err);
    }
  };

  const loadThreads = async (query = search) => {
    setLoadingThreads(true);
    try {
      const data = await fetchWhatsAppThreads(query);
      setThreads(data || []);
      // If no phone selected yet, select the first thread if available
      if (!selectedPhone && data && data.length > 0 && !phoneParam) {
        setSelectedPhone(data[0].phone);
      }
    } catch (err) {
      console.error("Failed to load threads:", err);
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadMessages = async (phone) => {
    if (!phone) return;
    setLoadingMessages(true);
    setSendError("");
    try {
      const data = await fetchWhatsAppMessages(phone);
      setMessages(data || []);
    } catch (err) {
      console.error("Failed to load messages for", phone, err);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadStatsAndTemplates();
    loadThreads("");
  }, []);

  useEffect(() => {
    if (phoneParam) {
      setSelectedPhone(phoneParam);
    }
  }, [phoneParam]);

  useEffect(() => {
    if (selectedPhone) {
      loadMessages(selectedPhone);
    }
  }, [selectedPhone]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadThreads(search);
  };

  const handleClearSearch = () => {
    setSearch("");
    loadThreads("");
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    const cleanText = replyText.trim();
    if (!cleanText || !selectedPhone) return;

    setSending(true);
    setSendError("");
    try {
      const sent = await sendWhatsAppMessage(selectedPhone, cleanText);
      setMessages((prev) => [...prev, sent]);
      setReplyText("");
      showToast("WhatsApp message dispatched successfully!", "whatsapp");
      // Refresh thread preview & stats in backend
      loadThreads(search);
      loadStatsAndTemplates();
    } catch (err) {
      setSendError(err.message || "Failed to send WhatsApp message");
      showToast(err.message || "Failed to send message", "error");
    } finally {
      setSending(false);
    }
  };

  const handleApplyTemplate = (tmplText) => {
    setReplyText(tmplText);
  };

  const selectedThread = threads.find((t) => t.phone === selectedPhone);

  return (
    <div className="space-y-6">
      {/* Signature Portal Header with Meta API Status Badge */}
      <PortalHeader
        kicker="COMMUNICATION & META INTEGRATION"
        title="WhatsApp Live Messages & Bookings"
        icon={FiMessageCircle}
        rightAction={
          <div className="flex items-center gap-3">
            {/* Meta API Live Status Pill */}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{stats?.service_status?.channel_mode || "Meta Cloud API Live"}</span>
            </span>

            <button
              type="button"
              onClick={() => {
                loadStatsAndTemplates();
                loadThreads(search);
                if (selectedPhone) loadMessages(selectedPhone);
              }}
              disabled={loadingThreads}
              className="portal-refresh-btn"
              title="Refresh Messages"
            >
              <FiRotateCw size={15} className={`refresh-icon ${loadingThreads ? "spinning" : ""}`} />
            </button>
            {onOpenBookModal && (
              <button onClick={onOpenBookModal} className="portal-action-btn">
                <FiPlus size={16} />
                <span>Book Appointment</span>
              </button>
            )}
          </div>
        }
      />

      {/* Aerostate LRS Executive Stats Grid */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Messages"
          value={stats?.total_messages || 0}
          Icon={FiMessageCircle}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Patient Inbound"
          value={stats?.inbound_messages || 0}
          Icon={FiUser}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Clinic & Bot Dispatches"
          value={stats?.outbound_messages || 0}
          Icon={FiCheckCircle}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Active WhatsApp Threads"
          value={stats?.total_threads || threads.length}
          Icon={FiPhone}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title="WhatsApp Live Chat Roster"
          description="Real-time patient chat sessions, automated booking confirmations, and direct reception messaging."
          badgeCount={threads.length}
          badgeLabel="conversations"
        />

        {/* Main Split-Pane Container */}
        <div className="inbox-container">
          {/* Left Panel: Conversation Threads */}
          <aside className="inbox-sidebar">
            <div className="inbox-sidebar-header">
              <form onSubmit={handleSearchSubmit} className="inbox-search-box">
                <FiSearch size={15} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search patient, phone, or message..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSearchSubmit(e);
                    }
                  }}
                />
                {search && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <FiX size={14} />
                  </button>
                )}
              </form>
            </div>

            <div className="inbox-threads-list">
              {loadingThreads ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#254d90]"></div>
                </div>
              ) : threads.length === 0 ? (
                <div className="text-center py-12 px-4 text-slate-400">
                  <FiMessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs font-semibold">No WhatsApp threads found</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {search ? "Try adjusting your search criteria." : "Send a message to your clinic WhatsApp number to start a conversation."}
                  </p>
                </div>
              ) : (
                threads.map((t) => {
                  const isSelected = t.phone === selectedPhone;
                  return (
                    <div
                      key={t.phone}
                      onClick={() => setSelectedPhone(t.phone)}
                      className={`inbox-thread-item ${isSelected ? "selected" : ""}`}
                    >
                      <div className="inbox-avatar">
                        {(t.patient_name || "P").charAt(0).toUpperCase()}
                      </div>
                      <div className="inbox-thread-info">
                        <div className="inbox-thread-top">
                          <span className="inbox-patient-name">{t.patient_name || "Valued Patient"}</span>
                          {t.latest_message?.created_at && (
                            <span className="inbox-time">
                              {new Date(t.latest_message.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>

                        <div className="inbox-phone-number flex items-center gap-1">
                          <FiPhone size={10} className="text-[#126868]" />
                          <span>{t.phone}</span>
                          {t.patient_uid && (
                            <span className="text-[10px] text-[#254d90] font-mono ml-1">
                              • {t.patient_uid}
                            </span>
                          )}
                        </div>

                        <p className="inbox-snippet">
                          {t.latest_message?.sender === "clinic" && (
                            <span className="text-[#254d90] font-bold mr-1">You:</span>
                          )}
                          {t.latest_message?.sender === "bot" && (
                            <span className="text-[#126868] font-bold mr-1">Bot:</span>
                          )}
                          {t.latest_message?.body || "Conversation active"}
                        </p>

                        {t.upcoming_appointment && (
                          <div className="inbox-thread-booking-badge">
                            <FiCalendar size={11} />
                            <span>
                              {t.upcoming_appointment.date} @ {t.upcoming_appointment.time} ({t.upcoming_appointment.doctor_name})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right Panel: Chat Thread */}
          <section className="inbox-chat-view">
            {selectedPhone ? (
              <>
                {/* Chat Header */}
                <div className="inbox-chat-header">
                  <div className="flex items-center gap-3">
                    <div className="inbox-avatar inbox-avatar-lg">
                      {(selectedThread?.patient_name || "P").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 m-0">
                        <span>{selectedThread?.patient_name || "Valued Patient"}</span>
                        <span className="inbox-meta-badge">
                          <FiShield size={10} /> Meta Verified
                        </span>
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                        <span>{selectedPhone}</span>
                        {selectedThread?.patient_uid && (
                          <span className="text-[#254d90] font-semibold">({selectedThread.patient_uid})</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedThread?.upcoming_appointment && (
                      <div className="hidden sm:flex items-center gap-2 text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg shadow-xs">
                        <FiCheckCircle className="text-emerald-600 shrink-0" size={14} />
                        <span>
                          Appt with <strong>{selectedThread.upcoming_appointment.doctor_name}</strong> on{" "}
                          <strong>{selectedThread.upcoming_appointment.date}</strong> at{" "}
                          <strong>{selectedThread.upcoming_appointment.time}</strong>
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => navigate(`/appointments?search=${encodeURIComponent(selectedPhone)}`)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-50 text-[#254d90] border border-blue-200 hover:bg-blue-100 transition cursor-pointer flex items-center gap-1.5"
                      title="View appointments for this patient"
                    >
                      <FiCalendar size={13} />
                      <span>Appointments</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate(`/patients?search=${encodeURIComponent(selectedPhone)}`)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1.5"
                      title="View Patient Registry record"
                    >
                      <FiUser size={13} />
                      <span>Patient Registry</span>
                    </button>
                  </div>
                </div>

                {/* Quick Reply Clinical Templates Bar */}
                {templates.length > 0 && (
                  <div className="inbox-templates-bar">
                    <span className="inbox-templates-label">Quick Replies:</span>
                    {templates.map((tmpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleApplyTemplate(tmpl.text)}
                        className="inbox-template-chip"
                        title={tmpl.text}
                      >
                        <FiZap size={11} className="text-amber-500" />
                        <span>{tmpl.title}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Messages Scroll Area with WhatsApp Markdown Formatting */}
                <div className="inbox-chat-messages">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-24 text-slate-400">
                      <FiMessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm font-medium">No messages in this conversation yet</p>
                      <p className="text-xs text-slate-400 mt-1">Send a direct message below to reach this patient.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isPatient = m.sender === "patient";
                      const isBot = m.sender === "bot";
                      const isClinic = m.sender === "clinic";
                      const isBooking = m.message_type === "booking_confirmation";

                      return (
                        <div
                          key={m.id}
                          className={`chat-bubble-wrapper ${
                            isPatient ? "incoming" : isClinic ? "outgoing-clinic" : "outgoing-bot"
                          }`}
                        >
                          <div
                            className={`chat-bubble ${
                              isBooking
                                ? "chat-bubble-booking"
                                : isPatient
                                ? "chat-bubble-patient"
                                : isClinic
                                ? "chat-bubble-clinic"
                                : "chat-bubble-bot"
                            }`}
                          >
                            <div className="chat-bubble-sender">
                              {isPatient && "👤 Patient"}
                              {isBot && "🤖 AeroState Bot"}
                              {isClinic && "🏥 Clinic Reception"}
                            </div>

                            <div className="chat-bubble-body">
                              {formatWhatsAppBody(m.body)}
                            </div>

                            <div className="chat-bubble-meta">
                              <span>
                                {new Date(m.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {!isPatient && <FiCheck size={12} className="inline ml-1" />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Chat Input Bar */}
                <form onSubmit={handleSendMessage} className="inbox-chat-input-bar">
                  {sendError && (
                    <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg mb-2">
                      {sendError}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type a direct WhatsApp reply to patient..."
                      disabled={sending}
                      className="inbox-input"
                    />
                    <button
                      type="submit"
                      disabled={sending || !replyText.trim()}
                      className="inbox-send-btn"
                    >
                      {sending ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      ) : (
                        <>
                          <FiSend size={15} />
                          <span className="hidden sm:inline">Send</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-24 text-slate-400">
                <FiMessageCircle className="w-16 h-16 text-slate-200 mb-3" />
                <h4 className="text-base font-bold text-slate-700">Select a WhatsApp Conversation</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm text-center">
                  Click on any patient thread on the left to view incoming Meta WhatsApp messages, appointment details, and reply directly.
                </p>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
