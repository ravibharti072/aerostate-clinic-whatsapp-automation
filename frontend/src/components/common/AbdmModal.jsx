import React, { useState, useEffect } from "react";
import {
  FiX,
  FiShield,
  FiCheckCircle,
  FiAlertCircle,
  FiSearch,
  FiSmartphone,
  FiCreditCard,
  FiShare2,
  FiPrinter,
  FiLink,
  FiUnlock,
  FiCopy,
  FiInfo,
} from "react-icons/fi";
import {
  generateAadhaarOtp,
  verifyAadhaarOtp,
  generateMobileOtp,
  verifyMobileOtp,
  searchAbha,
  linkPatientAbha,
  unlinkPatientAbha,
  fetchAbhaCard,
  sendAbhaCardWhatsApp,
} from "../../api";

export default function AbdmModal({ isOpen, onClose, patient, onUpdated }) {
  if (!isOpen || !patient) return null;

  const [activeTab, setActiveTab] = useState(
    patient.abha_number ? "card" : "aadhaar"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Aadhaar flow state
  const [aadhaarNumber, setAadhaarNumber] = useState(
    patient.aadhaar_number && patient.aadhaar_number !== "-"
      ? patient.aadhaar_number.replace(/\D/g, "")
      : ""
  );
  const [aadhaarTxnId, setAadhaarTxnId] = useState("");
  const [aadhaarOtp, setAadhaarOtp] = useState("");
  const [aadhaarStep, setAadhaarStep] = useState("input"); // 'input' | 'otp'

  // Mobile flow state
  const [mobileNumber, setMobileNumber] = useState(
    patient.phone ? patient.phone.replace(/\D/g, "").slice(-10) : ""
  );
  const [mobileTxnId, setMobileTxnId] = useState("");
  const [mobileOtp, setMobileOtp] = useState("");
  const [mobileStep, setMobileStep] = useState("input");

  // Search existing state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null);

  // Card view state
  const [cardData, setCardData] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setError("");
    setSuccessMsg("");
    if (patient.abha_number && patient.abha_number !== "-") {
      setActiveTab("card");
      loadCardData();
    } else {
      setActiveTab("aadhaar");
    }
  }, [patient]);

  const loadCardData = async () => {
    setCardLoading(true);
    try {
      const data = await fetchAbhaCard(patient.id);
      setCardData(data);
    } catch (err) {
      console.warn("Card load note:", err);
    } finally {
      setCardLoading(false);
    }
  };

  // 1. Aadhaar Flow
  const handleSendAadhaarOtp = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await generateAadhaarOtp(aadhaarNumber);
      setAadhaarTxnId(res.txn_id);
      setAadhaarStep("otp");
      setSuccessMsg(res.message || "OTP sent successfully.");
    } catch (err) {
      setError(err.message || "Failed to generate Aadhaar OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAadhaarOtp = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const profile = await verifyAadhaarOtp({
        txnId: aadhaarTxnId,
        otp: aadhaarOtp,
        patientId: patient.id,
        mobile: patient.phone,
      });
      setSuccessMsg(`ABHA Successfully Created & Linked! (${profile.abha_number})`);
      if (onUpdated) onUpdated();
      setActiveTab("card");
      loadCardData();
    } catch (err) {
      setError(err.message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  // 2. Mobile Flow
  const handleSendMobileOtp = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await generateMobileOtp(mobileNumber);
      setMobileTxnId(res.txn_id);
      setMobileStep("otp");
      setSuccessMsg(res.message || "OTP sent to mobile.");
    } catch (err) {
      setError(err.message || "Failed to generate mobile OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMobileOtp = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const profile = await verifyMobileOtp({
        txnId: mobileTxnId,
        otp: mobileOtp,
        patientId: patient.id,
      });
      setSuccessMsg(`ABHA Successfully Linked! (${profile.abha_number})`);
      if (onUpdated) onUpdated();
      setActiveTab("card");
      loadCardData();
    } catch (err) {
      setError(err.message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  // 3. Search Flow
  const handleSearchAbha = async (e) => {
    e.preventDefault();
    setError("");
    setSearchResult(null);
    setLoading(true);
    try {
      const res = await searchAbha(searchQuery);
      setSearchResult(res);
    } catch (err) {
      setError(err.message || "No ABHA found for this query");
    } finally {
      setLoading(false);
    }
  };

  const handleLinkSearchResult = async () => {
    if (!searchResult) return;
    setLoading(true);
    setError("");
    try {
      await linkPatientAbha(
        patient.id,
        searchResult.abha_number,
        searchResult.abha_address,
        searchResult
      );
      setSuccessMsg("ABHA linked to patient successfully!");
      if (onUpdated) onUpdated();
      setActiveTab("card");
      loadCardData();
    } catch (err) {
      setError(err.message || "Failed to link ABHA");
    } finally {
      setLoading(false);
    }
  };

  // 4. Unlink
  const handleUnlink = async () => {
    if (!window.confirm(`Unlink ABHA from ${patient.name}?`)) return;
    setLoading(true);
    setError("");
    try {
      await unlinkPatientAbha(patient.id);
      setSuccessMsg("ABHA unlinked successfully.");
      setCardData(null);
      if (onUpdated) onUpdated();
      setActiveTab("aadhaar");
    } catch (err) {
      setError(err.message || "Failed to unlink ABHA");
    } finally {
      setLoading(false);
    }
  };

  // 5. WhatsApp Dispatch
  const handleSendWhatsApp = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await sendAbhaCardWhatsApp(patient.id);
      setSuccessMsg(res.message || "ABHA Details sent to WhatsApp!");
    } catch (err) {
      setError(err.message || "Failed to dispatch via WhatsApp");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#0f172a] border border-emerald-500/30 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        
        {/* Header with National Tricolor Accent */}
        <div className="relative bg-gradient-to-r from-[#1e293b] via-[#0f172a] to-[#1e293b] p-5 border-b border-slate-700/60">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <FiShield className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-lg font-bold text-white tracking-wide">
                    Ayushman Bharat Digital Mission (ABDM)
                  </h3>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    M1 Compliant
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Government of India National Health Authority (NHA) • Patient:{" "}
                  <span className="text-white font-medium">{patient.name}</span>{" "}
                  ({patient.phone})
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <FiX className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-2 mt-4">
            <button
              onClick={() => {
                setActiveTab("aadhaar");
                setError("");
              }}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "aadhaar"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-800/60 text-slate-400 hover:text-white"
              }`}
            >
              <FiCreditCard className="w-3.5 h-3.5" />
              <span>Generate via Aadhaar</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("mobile");
                setError("");
              }}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "mobile"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-800/60 text-slate-400 hover:text-white"
              }`}
            >
              <FiSmartphone className="w-3.5 h-3.5" />
              <span>Generate via Mobile</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("search");
                setError("");
              }}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "search"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-800/60 text-slate-400 hover:text-white"
              }`}
            >
              <FiSearch className="w-3.5 h-3.5" />
              <span>Link Existing ABHA</span>
            </button>
            {patient.abha_number && (
              <button
                onClick={() => {
                  setActiveTab("card");
                  setError("");
                  loadCardData();
                }}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === "card"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-800/60 text-emerald-400 hover:text-white"
                }`}
              >
                <FiCheckCircle className="w-3.5 h-3.5" />
                <span>View ABHA Card</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="flex items-center space-x-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
              <FiAlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center space-x-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
              <FiCheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: AADHAAR GENERATION */}
          {activeTab === "aadhaar" && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl text-xs text-slate-300 space-y-1">
                <div className="flex items-center space-x-1.5 font-semibold text-emerald-400">
                  <FiInfo className="w-3.5 h-3.5" />
                  <span>Aadhaar-Based Official ABHA Creation (M1)</span>
                </div>
                <p className="text-slate-400">
                  An OTP will be delivered by UIDAI / NHA to the mobile registered with this Aadhaar. In Sandbox test mode, use test OTP:{" "}
                  <code className="text-emerald-300 bg-slate-900 px-1 py-0.5 rounded">111111</code>.
                </p>
              </div>

              {aadhaarStep === "input" ? (
                <form onSubmit={handleSendAadhaarOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      12-Digit Aadhaar Number:
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={aadhaarNumber}
                      onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, ""))}
                      placeholder="e.g. 5432 1098 7654"
                      className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 tracking-wider font-mono"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || aadhaarNumber.length !== 12}
                    className="w-full py-2.5 rounded-xl font-medium text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition disabled:opacity-50 flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/20"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <FiShield className="w-4 h-4" />
                        <span>Send Aadhaar OTP</span>
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyAadhaarOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Enter 6-Digit OTP received on registered mobile:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={aadhaarOtp}
                      onChange={(e) => setAadhaarOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="111111"
                      className="w-full bg-slate-900/90 border border-emerald-500/50 rounded-xl px-4 py-2.5 text-center text-lg tracking-widest font-mono text-white focus:outline-none focus:border-emerald-500"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      💡 Sandbox Mode Hint: Enter{" "}
                      <span className="text-emerald-400 font-bold">111111</span> to verify immediately.
                    </p>
                  </div>

                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => setAadhaarStep("input")}
                      className="flex-1 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:text-white"
                    >
                      Change Aadhaar
                    </button>
                    <button
                      type="submit"
                      disabled={loading || aadhaarOtp.length < 4}
                      className="flex-1 py-2.5 rounded-xl font-medium text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition disabled:opacity-50 flex items-center justify-center space-x-2"
                    >
                      {loading ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <FiCheckCircle className="w-4 h-4" />
                          <span>Verify & Link ABHA</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: MOBILE GENERATION */}
          {activeTab === "mobile" && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl text-xs text-slate-300">
                <p className="text-slate-400">
                  Create an ABHA address using the patient's verified mobile number (+91).
                </p>
              </div>

              {mobileStep === "input" ? (
                <form onSubmit={handleSendMobileOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      10-Digit Mobile Number:
                    </label>
                    <div className="flex">
                      <span className="px-3 py-2.5 bg-slate-800 border border-r-0 border-slate-700 rounded-l-xl text-sm text-slate-400">
                        +91
                      </span>
                      <input
                        type="text"
                        maxLength={10}
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ""))}
                        placeholder="9876543210"
                        className="w-full bg-slate-900/90 border border-slate-700 rounded-r-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 tracking-wider font-mono"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || mobileNumber.length !== 10}
                    className="w-full py-2.5 rounded-xl font-medium text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <FiSmartphone className="w-4 h-4" />
                        <span>Send Mobile OTP</span>
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyMobileOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Enter 6-Digit Mobile OTP:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={mobileOtp}
                      onChange={(e) => setMobileOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="111111"
                      className="w-full bg-slate-900/90 border border-emerald-500/50 rounded-xl px-4 py-2.5 text-center text-lg tracking-widest font-mono text-white focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>

                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={() => setMobileStep("input")}
                      className="flex-1 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:text-white"
                    >
                      Change Number
                    </button>
                    <button
                      type="submit"
                      disabled={loading || mobileOtp.length < 4}
                      className="flex-1 py-2.5 rounded-xl font-medium text-sm bg-gradient-to-r from-emerald-600 to-teal-600 text-white transition flex items-center justify-center space-x-2"
                    >
                      <span>Verify & Link</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: SEARCH & LINK EXISTING */}
          {activeTab === "search" && (
            <div className="space-y-4">
              <form onSubmit={handleSearchAbha} className="flex space-x-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter ABHA Address (e.g. user@abdm) or 14-digit Number"
                  className="flex-1 bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  required
                />
                <button
                  type="submit"
                  disabled={loading || !searchQuery.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50"
                >
                  <FiSearch className="w-3.5 h-3.5" />
                  <span>Search</span>
                </button>
              </form>

              {searchResult && (
                <div className="p-4 bg-slate-800/60 border border-emerald-500/30 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">
                        {searchResult.name}
                      </h4>
                      <p className="text-xs text-emerald-400 font-mono">
                        {searchResult.abha_address}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                      Verified Active
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-400">ABHA Number:</span>{" "}
                      <span className="font-mono text-white">
                        {searchResult.abha_number}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Gender / DOB:</span>{" "}
                      <span className="text-white">
                        {searchResult.gender || "-"} / {searchResult.dob || "-"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleLinkSearchResult}
                    disabled={loading}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition"
                  >
                    <FiLink className="w-3.5 h-3.5" />
                    <span>Link to {patient.name}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: OFFICIAL DIGITAL ABHA CARD */}
          {activeTab === "card" && (
            <div className="space-y-4">
              {cardLoading ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-2">
                  <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                  <span className="text-xs text-slate-400">Loading ABHA Card...</span>
                </div>
              ) : (
                <>
                  {/* Digital Card Preview Box */}
                  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0c2a20] via-[#0d1e2e] to-[#121c2b] border border-emerald-500/40 p-5 shadow-2xl">
                    {/* Top Tricolor Strip */}
                    <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />

                    {/* Card Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
                          ABHA
                        </div>
                        <div>
                          <div className="text-[11px] font-bold tracking-wider text-slate-300 uppercase">
                            National Health Authority
                          </div>
                          <div className="text-xs font-bold text-emerald-300">
                            Ayushman Bharat Digital Mission
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        ABDM M1 Verified
                      </span>
                    </div>

                    {/* Card Content Grid */}
                    <div className="grid grid-cols-3 gap-4 pt-4 items-center">
                      {/* Photo / Silhouette */}
                      <div className="flex flex-col items-center justify-center bg-slate-900/60 border border-slate-700/60 rounded-xl p-3">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-xl font-bold">
                          {patient.name.charAt(0)}
                        </div>
                        <span className="text-[10px] text-slate-400 mt-2 font-mono">
                          {cardData?.gender || patient.gender || "Citizen"}
                        </span>
                      </div>

                      {/* Details Column */}
                      <div className="col-span-2 space-y-2">
                        <div>
                          <div className="text-[10px] text-slate-400 uppercase font-semibold">
                            Full Name
                          </div>
                          <div className="text-sm font-bold text-white">
                            {patient.name}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              ABHA Address
                            </div>
                            <div className="text-emerald-400 font-mono text-xs">
                              {patient.abha_address || cardData?.abha_address || "N/A"}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              Gender / YOB
                            </div>
                            <div className="text-white text-xs">
                              {patient.gender || "M"} / {patient.dob || "1995"}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-slate-400 uppercase font-semibold">
                            14-Digit ABHA Number
                          </div>
                          <div className="text-base font-extrabold font-mono text-emerald-300 tracking-wider">
                            {patient.abha_number || cardData?.abha_number || "91-XXXX-XXXX-XXXX"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer verification tag */}
                    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                      <span>Linked Facility: Aerostate Speciality Clinic</span>
                      <span className="text-emerald-400 flex items-center space-x-1">
                        <FiCheckCircle className="w-3 h-3" />
                        <span>Registry Active</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions under card */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={() =>
                        copyToClipboard(patient.abha_number || cardData?.abha_number || "")
                      }
                      className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center space-x-1.5 transition"
                    >
                      <FiCopy className="w-3.5 h-3.5" />
                      <span>{copied ? "Copied!" : "Copy ABHA"}</span>
                    </button>

                    <button
                      onClick={handleSendWhatsApp}
                      disabled={loading}
                      className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium flex items-center justify-center space-x-1.5 transition disabled:opacity-50"
                    >
                      <FiShare2 className="w-3.5 h-3.5" />
                      <span>Send to WhatsApp</span>
                    </button>

                    <button
                      onClick={() => window.print()}
                      className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition"
                    >
                      <FiPrinter className="w-3.5 h-3.5" />
                      <span>Print</span>
                    </button>

                    <button
                      onClick={handleUnlink}
                      disabled={loading}
                      className="py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition"
                    >
                      <FiUnlock className="w-3.5 h-3.5" />
                      <span>Unlink</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-1.5 text-slate-400">
            <FiShield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Encrypted under ABDM National Health Guidelines</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
