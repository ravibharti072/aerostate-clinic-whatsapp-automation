import React, { useState, useEffect, useMemo } from "react";
import { FaRupeeSign } from "react-icons/fa";
import {
  FiX,
  FiUser,
  FiCalendar,
  FiSearch,
  FiShield,
  FiActivity,
  FiDroplet,
  FiCheck,
  FiAlertTriangle,
  FiDollarSign,
} from "react-icons/fi";
import { useToast } from "../../context/ToastContext";
import {
  createLabOrder,
  fetchLabTests,
  fetchPatients,
  fetchDoctors,
} from "../../api";

export default function PlaceDiagnosticOrderModal({
  isOpen,
  onClose,
  initialData = {},
  onOrderCreated,
  patients: propPatients,
  doctors: propDoctors,
  tests: propTests,
}) {
  const { showToast } = useToast();

  const [internalTests, setInternalTests] = useState([]);
  const [internalPatients, setInternalPatients] = useState([]);
  const [internalDoctors, setInternalDoctors] = useState([]);

  const todayDateStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [creatingOrder, setCreatingOrder] = useState(false);
  const [createOrderForm, setCreateOrderForm] = useState({
    patient_id: "",
    doctor_id: "",
    encounter_id: null,
    priority: "ROUTINE",
    clinical_indication: "",
    test_ids: [],
  });

  const [patientFilterMode, setPatientFilterMode] = useState("today"); // "today", "date", "all"
  const [patientSelectedDate, setPatientSelectedDate] = useState(todayDateStr);
  const [patientSearchTerm, setPatientSearchTerm] = useState("");

  const [orderModalTestSearch, setOrderModalTestSearch] = useState("");
  const [orderModalTestCategory, setOrderModalTestCategory] = useState("All");

  // Payment collection options (100% backend calculated)
  const [collectPaymentNow, setCollectPaymentNow] = useState(true);
  const [paymentMode, setPaymentMode] = useState("Cash"); // "Cash", "UPI", "Card", "Net Banking"
  const [cashTendered, setCashTendered] = useState("");
  const [transactionRef, setTransactionRef] = useState("");

  // Load tests, patients, and doctors if not supplied via props
  useEffect(() => {
    if (!isOpen) return;

    if (!propTests || propTests.length === 0) {
      fetchLabTests()
        .then((t) => setInternalTests(t.tests || t || []))
        .catch((err) => console.warn("Failed to load lab tests in modal:", err));
    }
    if (!propPatients || propPatients.length === 0) {
      fetchPatients()
        .then((p) => setInternalPatients(p.patients || p || []))
        .catch((err) => console.warn("Failed to load patients in modal:", err));
    }
    if (!propDoctors || propDoctors.length === 0) {
      fetchDoctors(true)
        .then((d) => setInternalDoctors(d || []))
        .catch((err) => console.warn("Failed to load doctors in modal:", err));
    }
  }, [isOpen, propTests, propPatients, propDoctors]);

  const testsList = useMemo(() => {
    return propTests && propTests.length > 0 ? propTests : internalTests;
  }, [propTests, internalTests]);

  const patientsList = useMemo(() => {
    return propPatients && propPatients.length > 0 ? propPatients : internalPatients;
  }, [propPatients, internalPatients]);

  const doctorsList = useMemo(() => {
    return propDoctors && propDoctors.length > 0 ? propDoctors : internalDoctors;
  }, [propDoctors, internalDoctors]);

  // Sync initialData into form state when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const ptId = initialData?.patient_id;
    const docId = initialData?.doctor_id;
    const encId = initialData?.encounter_id;
    const diag = initialData?.clinical_indication || initialData?.diagnosis || "";
    const priority = initialData?.priority || "ROUTINE";
    const labTestsStr = initialData?.lab_tests || "";

    let matchedTestIds = Array.isArray(initialData?.test_ids) ? [...initialData.test_ids] : [];
    if (labTestsStr && testsList.length > 0) {
      const requestedNames = labTestsStr
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const fromNames = testsList
        .filter((t) =>
          requestedNames.some(
            (rn) =>
              t.name.toLowerCase().includes(rn) ||
              rn.includes(t.name.toLowerCase()) ||
              (t.test_code && (rn.includes(t.test_code.toLowerCase()) || t.test_code.toLowerCase().includes(rn)))
          )
        )
        .map((t) => t.id);
      matchedTestIds = Array.from(new Set([...matchedTestIds, ...fromNames]));
    }

    setCreateOrderForm({
      patient_id: ptId ? Number(ptId) : "",
      doctor_id: docId ? Number(docId) : "",
      encounter_id: encId ? Number(encId) : null,
      priority,
      clinical_indication: diag,
      test_ids: matchedTestIds,
    });
  }, [isOpen, initialData, testsList]);

  const selectedPatient = useMemo(() => {
    if (!createOrderForm.patient_id) return null;
    const found = patientsList.find((p) => p.id === Number(createOrderForm.patient_id));
    if (found) return found;
    if (initialData?.patient && (initialData.patient.id === Number(createOrderForm.patient_id) || !createOrderForm.patient_id)) {
      return initialData.patient;
    }
    return null;
  }, [patientsList, createOrderForm.patient_id, initialData]);

  const filteredModalPatients = useMemo(() => {
    let list = [...patientsList];

    if (patientFilterMode === "today") {
      list = list.filter((p) => p.is_today || p.created_date === todayDateStr || p.today_token != null);
    } else if (patientFilterMode === "date" && patientSelectedDate) {
      list = list.filter(
        (p) => p.created_date === patientSelectedDate || p.last_visit === patientSelectedDate
      );
    }

    if (patientSearchTerm.trim()) {
      const q = patientSearchTerm.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.phone?.includes(q) ||
          p.patient_uid?.toLowerCase().includes(q)
      );
    }

    // Sort today's arrivals & queue tokens on top
    list.sort((a, b) => {
      const aToday = a.is_today || a.created_date === todayDateStr || a.today_token != null ? 1 : 0;
      const bToday = b.is_today || b.created_date === todayDateStr || b.today_token != null ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      if (a.today_token && b.today_token) return a.today_token - b.today_token;
      return (b.id || 0) - (a.id || 0);
    });

    return list;
  }, [patientsList, patientFilterMode, patientSelectedDate, patientSearchTerm, todayDateStr]);

  const availableCategories = useMemo(() => {
    const list = new Set();
    testsList.forEach((t) => {
      if (t.category) list.add(t.category);
    });
    const defaults = ["Hematology", "Biochemistry", "Clinical Pathology", "Microbiology"];
    defaults.forEach((d) => list.add(d));
    return Array.from(list);
  }, [testsList]);

  const filteredModalTests = useMemo(() => {
    return testsList.filter((t) => {
      const matchCat =
        orderModalTestCategory === "All" || t.category === orderModalTestCategory;
      const q = orderModalTestSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.test_code && t.test_code.toLowerCase().includes(q)) ||
        (t.sample_type && t.sample_type.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [testsList, orderModalTestCategory, orderModalTestSearch]);

  const totalSelectedPrice = useMemo(() => {
    return createOrderForm.test_ids.reduce((sum, id) => {
      const found = testsList.find((t) => t.id === Number(id));
      return sum + (found?.price || 0);
    }, 0);
  }, [testsList, createOrderForm.test_ids]);

  const handleCreateOrder = async (e) => {
    if (e) e.preventDefault();
    if (!createOrderForm.patient_id) {
      showToast("Please choose a registered patient for the lab requisition.", "error");
      return;
    }
    if (!createOrderForm.doctor_id) {
      showToast("Clinical Rule: Please select the Prescribing Doctor who assigned this diagnosis.", "error");
      return;
    }
    if (!createOrderForm.clinical_indication || !createOrderForm.clinical_indication.trim()) {
      showToast("Clinical Rule: Please enter the doctor's provisional diagnosis or clinical indication.", "error");
      return;
    }
    if (createOrderForm.test_ids.length === 0) {
      showToast("Please select at least one diagnostic test.", "error");
      return;
    }

    setCreatingOrder(true);
    try {
      const res = await createLabOrder({
        patient_id: Number(createOrderForm.patient_id),
        doctor_id: Number(createOrderForm.doctor_id),
        encounter_id: createOrderForm.encounter_id ? Number(createOrderForm.encounter_id) : null,
        priority: createOrderForm.priority,
        clinical_indication: createOrderForm.clinical_indication.trim(),
        test_ids: createOrderForm.test_ids.map(Number),
        collect_payment: collectPaymentNow,
        payment_method: paymentMode,
        cash_tendered: paymentMode === "Cash" && cashTendered !== "" ? parseFloat(cashTendered) : null,
        transaction_ref: transactionRef.trim() || null,
      });

      const selectedTests = testsList.filter((t) => createOrderForm.test_ids.includes(t.id));
      if (createOrderForm.encounter_id) {
        showToast("Diagnostic order attached to consultation! Specimen collection & processing will unlock once consultation is Finalized & Signed.", "success");
      } else if (res.change_return && res.change_return > 0) {
        showToast(`${res.message || "Diagnostic order generated!"} • Change to Return: ₹${res.change_return}`, "success");
      } else {
        showToast(res.message || "Diagnostic order generated successfully and queued in Laboratory!", "success");
      }

      if (onOrderCreated) {
        onOrderCreated(res, selectedTests);
      }
      onClose();
    } catch (err) {
      showToast(err.message || "Failed to place diagnostic order", "error");
    } finally {
      setCreatingOrder(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div
        className="modal-content"
        style={{ maxWidth: "840px", maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="flex items-center gap-2">
              <h2>Place Diagnostic Order</h2>
              {createOrderForm.encounter_id && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#254d90] border border-blue-200">
                  Draft (In Consultation)
                </span>
              )}
            </div>
            {createOrderForm.encounter_id && (
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Encounter: <strong className="text-slate-800">{initialData?.encounter_uid || `ENC-${createOrderForm.encounter_id}`}</strong>
              </p>
            )}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
          >
            <FiX size={18} />
          </button>
        </div>

        <form onSubmit={handleCreateOrder} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="modal-body" style={{ gap: "16px" }}>
            {/* ------------------------------------------ */}
            {/* A. Smart Patient Selector with Date Filter */}
            {/* ------------------------------------------ */}
            <div className="form-group mb-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Select Patient *
              </label>

              {selectedPatient ? (
                /* Selected Patient Display Card */
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="staff-avatar shrink-0"
                      style={{
                        background: "#254d90",
                        color: "#ffffff",
                        width: "38px",
                        height: "38px",
                        fontSize: "14px",
                        fontWeight: "700",
                      }}
                    >
                      {selectedPatient.name ? selectedPatient.name.charAt(0).toUpperCase() : "P"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm truncate">
                          {selectedPatient.name}
                        </span>
                        <span className="font-mono font-bold text-xs text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded border border-[#254d90]/20 shrink-0">
                          {selectedPatient.patient_uid || `PAT-${String(selectedPatient.id).padStart(4, "0")}`}
                        </span>
                        {selectedPatient.today_token_display ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#254d90] border border-blue-200 shrink-0">
                            {selectedPatient.today_token_display}
                          </span>
                        ) : selectedPatient.is_today ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#254d90] border border-blue-200 shrink-0">
                            Today's Visit
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap font-medium">
                        <span>{selectedPatient.phone_display || selectedPatient.phone}</span>
                        <span>•</span>
                        <span>{selectedPatient.gender_age_display || `${selectedPatient.gender || ""}, ${selectedPatient.age || ""}`}</span>
                        <span>•</span>
                        <span>{selectedPatient.registration_source || "Direct"}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreateOrderForm({ ...createOrderForm, patient_id: "" })}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#254d90] bg-blue-50 hover:bg-[#254d90] hover:text-white border border-blue-200 transition shrink-0 cursor-pointer ml-2"
                  >
                    Change
                  </button>
                </div>
              ) : (
                /* Patient Search & Selection Widget with Date Filters */
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  {/* Date Filter & Mode Selection Row */}
                  <div className="p-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPatientFilterMode("today")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          patientFilterMode === "today"
                            ? "bg-[#254d90] text-white shadow-xs"
                            : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 font-medium"
                        }`}
                      >
                        Today's Patients
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatientFilterMode("date")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          patientFilterMode === "date"
                            ? "bg-[#254d90] text-white shadow-xs"
                            : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 font-medium"
                        }`}
                      >
                        Select Date
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatientFilterMode("all")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          patientFilterMode === "all"
                            ? "bg-[#254d90] text-white shadow-xs"
                            : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 font-medium"
                        }`}
                      >
                        All Patients ({patientsList.length})
                      </button>
                    </div>

                    {patientFilterMode === "date" && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-500">Date:</span>
                        <input
                          type="date"
                          value={patientSelectedDate}
                          onChange={(e) => setPatientSelectedDate(e.target.value)}
                          className="px-2 py-1 rounded-md border border-slate-300 text-xs font-medium text-slate-700 bg-white outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* Search Input for Older / Existing Patients */}
                  <div className="p-2 border-b border-slate-200 flex items-center gap-2 bg-white">
                    <input
                      type="text"
                      placeholder="Search patients by name, mobile, or PAT UID..."
                      value={patientSearchTerm}
                      onChange={(e) => setPatientSearchTerm(e.target.value)}
                      className="w-full px-2 py-1 text-sm outline-none bg-transparent"
                    />
                    {patientSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setPatientSearchTerm("")}
                        className="text-xs text-slate-400 hover:text-slate-600 p-1"
                      >
                        <FiX size={14} />
                      </button>
                    )}
                  </div>

                  {/* Scrollable Patient Cards */}
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 p-1">
                    {filteredModalPatients.length === 0 ? (
                      <div className="py-4 text-center text-xs text-slate-500">
                        No registered patients found.
                      </div>
                    ) : (
                      filteredModalPatients.map((p) => {
                        return (
                          <div
                            key={p.id}
                            onClick={() => setCreateOrderForm({ ...createOrderForm, patient_id: p.id })}
                            className="p-2 rounded-lg flex items-center justify-between cursor-pointer transition hover:bg-slate-50"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="staff-avatar shrink-0"
                                style={{
                                  width: "34px",
                                  height: "34px",
                                  fontSize: "13px",
                                  background: "#254d90",
                                  color: "#ffffff",
                                  fontWeight: "700",
                                }}
                              >
                                {p.name ? p.name.charAt(0).toUpperCase() : "P"}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                                  <span className="font-mono font-bold text-xs text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded border border-[#254d90]/20">
                                    {p.patient_uid || `PAT-${String(p.id).padStart(4, "0")}`}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                                  <span>{p.phone_display || p.phone}</span>
                                  <span>•</span>
                                  <span>{p.gender_age_display || p.gender}</span>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="px-3 py-1 rounded-md text-xs font-semibold text-[#254d90] bg-blue-50/80 hover:bg-[#254d90] hover:text-white border border-blue-200 transition cursor-pointer shrink-0"
                            >
                              Select
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ------------------------------------------ */}
            {/* B. Doctor & Priority Row                   */}
            {/* ------------------------------------------ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Prescribing Doctor *
                </label>
                <select
                  value={createOrderForm.doctor_id}
                  onChange={(e) => setCreateOrderForm({ ...createOrderForm, doctor_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 bg-white focus:border-[#254d90] outline-none"
                >
                  <option value="">-- Select Prescribing Doctor --</option>
                  {doctorsList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name.startsWith("Dr.") ? d.name : `Dr. ${d.name}`} ({d.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Order Priority</label>
                <select
                  value={createOrderForm.priority}
                  onChange={(e) => setCreateOrderForm({ ...createOrderForm, priority: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 bg-white focus:border-[#254d90] outline-none"
                >
                  <option value="ROUTINE">ROUTINE (Standard TAT)</option>
                  <option value="URGENT">URGENT (Priority Queue)</option>
                  <option value="STAT">STAT (Immediate Emergency)</option>
                </select>
              </div>
            </div>

            {/* ------------------------------------------ */}
            {/* C. Modern Diagnostic Tests Selection       */}
            {/* ------------------------------------------ */}
            <div className="form-group">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Select Diagnostic Tests *
                </label>
                <span className="text-xs font-bold text-[#254d90] bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                  {createOrderForm.test_ids.length} selected (Total: ₹{totalSelectedPrice.toLocaleString()})
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                {/* Search & Category Filter Toolbar */}
                <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex items-center gap-1.5 flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1">
                    <input
                      type="text"
                      placeholder="Filter tests by name, test code, or specimen..."
                      value={orderModalTestSearch}
                      onChange={(e) => setOrderModalTestSearch(e.target.value)}
                      className="w-full text-sm outline-none bg-transparent py-1"
                    />
                    {orderModalTestSearch && (
                      <button
                        type="button"
                        onClick={() => setOrderModalTestSearch("")}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        <FiX size={14} />
                      </button>
                    )}
                  </div>

                  {/* Horizontal categories scroll */}
                  <div className="flex items-center gap-1 overflow-x-auto py-0.5" style={{ maxWidth: "260px" }}>
                    {["All", ...availableCategories.slice(0, 6)].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setOrderModalTestCategory(cat)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
                          orderModalTestCategory === cat
                            ? "bg-[#254d90] text-white shadow-xs"
                            : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 font-medium"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scrollable Test Items Grid / List */}
                <div className="max-h-56 overflow-y-auto p-2 space-y-2 bg-slate-50">
                  {filteredModalTests.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      No diagnostic tests found matching your filter.
                    </div>
                  ) : (
                    filteredModalTests.map((t) => {
                      const isChecked = createOrderForm.test_ids.includes(t.id);
                      return (
                        <label
                          key={t.id}
                          onClick={() => {
                            const newIds = isChecked
                              ? createOrderForm.test_ids.filter((id) => id !== t.id)
                              : [...createOrderForm.test_ids, t.id];
                            setCreateOrderForm({ ...createOrderForm, test_ids: newIds });
                          }}
                          className={`flex items-center justify-between p-3 rounded-lg cursor-pointer text-sm transition border ${
                            isChecked
                              ? "bg-blue-50/40 border-[#254d90]/60 shadow-xs"
                              : "bg-white border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                const newIds = e.target.checked
                                  ? [...createOrderForm.test_ids, t.id]
                                  : createOrderForm.test_ids.filter((id) => id !== t.id);
                                setCreateOrderForm({ ...createOrderForm, test_ids: newIds });
                              }}
                              className="w-4 h-4 rounded text-[#254d90] cursor-pointer shrink-0 accent-[#254d90]"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900 text-sm">{t.name}</span>
                                <span className="font-mono font-bold text-xs text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded border border-[#254d90]/20 shrink-0">
                                  {t.test_code}
                                </span>
                                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                                  {t.category || "General"}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                <span>{t.sample_type || "Specimen"}</span>
                                <span>•</span>
                                <span>TAT: {t.tat_hours || 24}h</span>
                              </div>
                            </div>
                          </div>
                          <span className="font-bold font-mono text-[#254d90] text-sm shrink-0 ml-2">
                            ₹{t.price}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ------------------------------------------ */}
            {/* D. Doctor's Provisional Diagnosis          */}
            {/* ------------------------------------------ */}
            <div className="form-group">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Doctor's Provisional Diagnosis / Clinical Indication *
              </label>
              <input
                type="text"
                placeholder="e.g. Suspected Typhoid / Fever for 4 days, Type-2 Diabetes review"
                value={createOrderForm.clinical_indication}
                onChange={(e) => setCreateOrderForm({ ...createOrderForm, clinical_indication: e.target.value })}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-[#254d90] outline-none"
              />
            </div>

            {/* ------------------------------------------ */}
            {/* E. Billing & Payment Collection Section    */}
            {/* ------------------------------------------ */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FiDollarSign className="text-[#254d90]" size={16} />
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Billing &amp; Payment Collection
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={collectPaymentNow}
                    onChange={(e) => setCollectPaymentNow(e.target.checked)}
                    className="w-4 h-4 rounded text-[#254d90] cursor-pointer accent-[#254d90]"
                  />
                  Collect Payment Now
                </label>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                <span className="text-slate-600 font-medium">Total Diagnostic Charges ({createOrderForm.test_ids.length} tests):</span>
                <span className="text-base font-bold font-mono text-[#254d90]">₹{totalSelectedPrice.toLocaleString()}</span>
              </div>

              {collectPaymentNow && totalSelectedPrice > 0 && (
                <div className="space-y-2.5 pt-1">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {["Cash", "UPI", "Card", "Net Banking"].map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPaymentMode(mode)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition cursor-pointer text-center ${
                            paymentMode === mode
                              ? "bg-[#254d90] text-white border-[#254d90] shadow-xs"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {mode === "UPI" ? "UPI / QR" : mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentMode === "Cash" ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                          Cash Tendered (₹)
                        </label>
                        <div className="relative flex items-center">
                          <div className="absolute left-2.5 flex items-center pointer-events-none text-slate-400">
                            <FaRupeeSign size={11} />
                          </div>
                          <input
                            type="number"
                            min="0"
                            placeholder="Amount received..."
                            value={cashTendered}
                            onChange={(e) => setCashTendered(e.target.value)}
                            style={{ paddingLeft: "26px", height: "36px" }}
                            className="w-full rounded-lg border border-slate-300 text-xs font-mono font-bold bg-white text-slate-900 focus:border-[#254d90] outline-none"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                          Change to Return (₹)
                        </label>
                        {(() => {
                          const change = Math.max(0, (parseFloat(cashTendered) || 0) - totalSelectedPrice);
                          return (
                            <div
                              className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center justify-between ${
                                change > 0
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                  : "bg-slate-50 border-slate-200 text-slate-500"
                              }`}
                              style={{ height: "34px" }}
                            >
                              <span className="text-[11px] font-medium font-sans">
                                {change > 0 ? "Return:" : "Change:"}
                              </span>
                              <span className={`text-xs font-bold font-mono ${change > 0 ? "text-emerald-700" : "text-slate-700"}`}>
                                ₹{change.toLocaleString()}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                        Transaction / UTR Reference (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. GPay / PhonePe UTR / Auth Code"
                        value={transactionRef}
                        onChange={(e) => setTransactionRef(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="btn-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                creatingOrder ||
                !createOrderForm.patient_id ||
                !createOrderForm.doctor_id ||
                !createOrderForm.clinical_indication?.trim() ||
                createOrderForm.test_ids.length === 0
              }
              className="btn-submit"
              style={{ background: "#254d90" }}
            >
              <span>{creatingOrder ? "Generating Order..." : `Generate Order & Collect (₹${totalSelectedPrice})`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
