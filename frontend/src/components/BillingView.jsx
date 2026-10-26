import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { FaWhatsapp } from "react-icons/fa";
import {
  FiDollarSign,
  FiSearch,
  FiPlus,
  FiSend,
  FiPrinter,
  FiDownload,
  FiCheckCircle,
  FiClock,
  FiXCircle,
  FiX,
  FiTrash2,
  FiEye,
  FiCreditCard,
  FiFileText,
  FiRotateCw,
  FiRefreshCw,
  FiCheck,
  FiChevronLeft,
  FiChevronRight
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchBillingStats,
  fetchBillingOptions,
  fetchInvoices,
  createInvoice,
  updateInvoiceStatus,
  sendInvoiceWhatsApp,
  fetchPatients,
  fetchBillableServices,
  fetchUnbilledServices,
  recordInvoicePayment,
  recordInvoiceRefund,
  fetchInvoicePayments,
  downloadReceiptPdf,
  printReceiptPdf,
  fetchSettings
} from "../api";

export default function BillingView() {
  const { showToast } = useToast();
  const [stats, setStats] = useState(null);
  const [billingOptions, setBillingOptions] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("");

  // Pagination (20 entries per page default from LRS)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      const timeA = new Date(a.latest_activity || a.created_at || 0).getTime();
      const timeB = new Date(b.latest_activity || b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.id || 0) - (a.id || 0);
    });
  }, [invoices]);

  const paginatedInvoices = useMemo(() => {
    if (pageSize === "all") return sortedInvoices;
    const start = (currentPage - 1) * pageSize;
    return sortedInvoices.slice(start, start + pageSize);
  }, [sortedInvoices, currentPage, pageSize]);

  const [patients, setPatients] = useState([]);
  const [services, setServices] = useState([]);

  // Payment Recording Modal
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [payTargetInv, setPayTargetInv] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", payment_method: "UPI", transaction_ref: "", notes: "" });
  const [paying, setPaying] = useState(false);

  // Invoice Payment Transaction History
  const [invoiceTransactions, setInvoiceTransactions] = useState({ payments: [], refunds: [] });
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  // Refund Recording Modal
  const [isRefundOpen, setIsRefundOpen] = useState(false);
  const [refundTargetInv, setRefundTargetInv] = useState(null);
  const [refundForm, setRefundForm] = useState({ amount: "", reason: "" });
  const [refunding, setRefunding] = useState(false);

  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [importingUnbilled, setImportingUnbilled] = useState(false);
  const [formData, setFormData] = useState({
    patient_id: null,
    patient_phone: "",
    patient_name: "",
    appointment_id: null,
    encounter_id: null,
    items: [{ description: "Doctor Consultation Fee", quantity: 1, unit_price: 500 }],
    discount: 0,
    tax: 0,
    payment_method: "UPI",
    payment_status: "PAID",
    notes: "",
    send_whatsapp: true,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // View / Print Modal
  const [selectedInv, setSelectedInv] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingInvId, setDownloadingInvId] = useState(null);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [clinicSettings, setClinicSettings] = useState(null);
  const [sendingWhatsappId, setSendingWhatsappId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  // Table Scroll Controls
  const tableContainerRef = useRef(null);

  const handleScrollLeft = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: -350, behavior: "smooth" });
    }
  };

  const handleScrollRight = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: 350, behavior: "smooth" });
    }
  };

  const [searchParams] = useSearchParams();

  useEffect(() => {
    const phone = searchParams.get("patient_phone") || searchParams.get("phone");
    const name = searchParams.get("patient_name") || searchParams.get("name");
    const ptId = searchParams.get("patient_id");
    const apptId = searchParams.get("appointment_id") || searchParams.get("appt_id");
    const encId = searchParams.get("encounter_id");

    if (phone || name || apptId || encId || ptId) {
      setFormData((prev) => ({
        ...prev,
        patient_id: ptId ? Number(ptId) : prev.patient_id,
        patient_phone: phone || prev.patient_phone,
        patient_name: name || prev.patient_name,
        appointment_id: apptId ? Number(apptId) : null,
        encounter_id: encId ? Number(encId) : null,
      }));
      setIsCreateOpen(true);

      // Automatically import unbilled clinical services for this encounter/patient
      fetchUnbilledServices({ patient_id: ptId, encounter_id: encId, appointment_id: apptId })
        .then((data) => {
          if (data && data.suggested_items && data.suggested_items.length > 0) {
            setFormData((prev) => ({
              ...prev,
              patient_phone: data.patient_phone || prev.patient_phone,
              patient_name: data.patient_name || prev.patient_name,
              items: data.suggested_items,
            }));
          }
        })
        .catch((err) => console.warn("Failed to auto-import unbilled services:", err));
    }
  }, [searchParams]);

  const loadData = async (
    query = search,
    status = statusFilter,
    method = paymentMethodFilter,
    isBackground = false
  ) => {
    if (!isBackground) setLoading(true);
    try {
      const [statsData, invData, ptsData, srvData, optData] = await Promise.all([
        fetchBillingStats(),
        fetchInvoices({ search: query, status: status, payment_method: method }),
        fetchPatients(),
        fetchBillableServices(),
        fetchBillingOptions().catch(() => null),
      ]);
      setStats(statsData);
      setInvoices(invData.invoices || []);
      setPatients(ptsData || []);
      setServices(srvData || []);
      if (optData) setBillingOptions(optData);
      fetchSettings().then((st) => setClinicSettings(st)).catch(() => {});
    } catch (err) {
      if (!isBackground) {
        console.error("Failed to load billing:", err);
        showToast(err.message || "Failed to load billing records", "error");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(search, statusFilter, paymentMethodFilter);

    // Auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      if (!isCreateOpen && !isPayOpen && !isRefundOpen && !selectedInv) {
        loadData(search, statusFilter, paymentMethodFilter, true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [statusFilter, paymentMethodFilter, isCreateOpen, isPayOpen, isRefundOpen, selectedInv]);

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    loadData(search, statusFilter, paymentMethodFilter);
  };

  const handleClearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setPaymentMethodFilter("");
    loadData("", "", "");
  };

  // Line item handlers
  const handleAddItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { description: "", quantity: 1, unit_price: 0 }],
    }));
  };

  const handleRemoveItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...prev.items];
      updated[index][field] = field === "description" ? value : Number(value);
      return { ...prev, items: updated };
    });
  };

  const handleImportUnbilled = async () => {
    const matched = patients.find((p) => p.phone === formData.patient_phone.trim());
    const ptId = matched?.id || formData.patient_id;
    if (!ptId && !formData.encounter_id && !formData.appointment_id) {
      showToast("Please enter a valid patient phone first", "error");
      return;
    }
    setImportingUnbilled(true);
    try {
      const data = await fetchUnbilledServices({
        patient_id: ptId,
        encounter_id: formData.encounter_id,
        appointment_id: formData.appointment_id,
      });
      if (data.suggested_items && data.suggested_items.length > 0) {
        setFormData((prev) => ({
          ...prev,
          items: data.suggested_items,
        }));
        showToast(`Imported ${data.suggested_items.length} unbilled care items into invoice!`, "success");
      } else {
        showToast("No unbilled consultation, lab, or medicine records found.", "info");
      }
    } catch (err) {
      showToast("Failed to import unbilled care: " + err.message, "error");
    } finally {
      setImportingUnbilled(false);
    }
  };

  // Compute live subtotal & total
  const calculatedSubtotal = formData.items.reduce(
    (acc, item) => acc + (item.quantity || 1) * (item.unit_price || 0),
    0
  );
  const calculatedTotal = Math.max(
    0,
    calculatedSubtotal - (formData.discount || 0) + (formData.tax || 0)
  );

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!formData.patient_phone.trim()) {
      setFormError("Patient phone number is required.");
      return;
    }

    const cleanItems = formData.items.filter(
      (it) => it.description.trim().length > 0 && it.unit_price >= 0
    );
    if (cleanItems.length === 0) {
      setFormError("Please add at least one billed service or item.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await createInvoice({
        ...formData,
        items: cleanItems,
      });
      setIsCreateOpen(false);
      showToast("Invoice created successfully!", "success");
      loadData();
    } catch (err) {
      setFormError(err.message || "Failed to generate invoice");
      showToast(err.message || "Failed to generate invoice", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (invId, currentStatus) => {
    const nextStatus = currentStatus === "PAID" ? "PENDING" : "PAID";
    setUpdatingId(invId);
    try {
      await updateInvoiceStatus(invId, { payment_status: nextStatus });
      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invId ? { ...inv, payment_status: nextStatus } : inv
        )
      );
      // Reload stats
      fetchBillingStats().then((data) => setStats(data));
      showToast(`Invoice status marked as ${nextStatus}!`, "success");
    } catch (err) {
      showToast(err.message || "Could not update status", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const getBillTypeForInvoice = (inv) => {
    if (!inv) return "General";
    const notes = (inv.notes || "").toLowerCase();
    if (notes.includes("pharma") || notes.includes("dispense") || notes.includes("rx") || notes.includes("prescription")) return "Pharma";
    if (notes.includes("lab") || notes.includes("diagnostic") || notes.includes("pathology")) return "Lab";

    const items = Array.isArray(inv.items) ? inv.items : [];
    const itemStr = items.map((it) => (it.description || it.name || it.medicine_name || "")).join(" ").toLowerCase();
    if (["tablet", "capsule", "syrup", "injection", "ointment", "drops", "mg", "ml"].some((k) => itemStr.includes(k))) return "Pharma";
    if (["test", "blood", "scan", "profile", "cbc", "x-ray", "culture", "urine"].some((k) => itemStr.includes(k))) return "Lab";
    if (["consultation", "appointment", "opd", "follow-up", "doctor"].some((k) => itemStr.includes(k)) || inv.appointment_id || inv.encounter_id) return "Appointment";

    return "General";
  };

  const handleDownloadPdf = async (inv) => {
    if (!inv) return;
    setDownloadingInvId(inv.id);
    setDownloadingPdf(true);
    try {
      const cleanPatient = (inv.patient_name || "Patient").trim().replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
      const billType = getBillTypeForInvoice(inv);
      const filename = `${cleanPatient}_${billType}_Bill_${inv.invoice_number || "Receipt"}.pdf`;
      await downloadReceiptPdf(inv.id, false, filename);
      showToast("PDF Bill downloaded successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to download PDF receipt", "error");
    } finally {
      setDownloadingInvId(null);
      setDownloadingPdf(false);
    }
  };

  const handlePrintPdf = async (inv) => {
    if (!inv) return;
    setPrintingPdf(true);
    try {
      await printReceiptPdf(inv.id, false);
    } catch (err) {
      console.warn("Direct PDF print failed, falling back to window.print:", err);
      window.print();
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleSendWhatsApp = async (invId) => {
    setSendingWhatsappId(invId);
    try {
      await sendInvoiceWhatsApp(invId);
      showToast("Digital payment receipt sent to patient's WhatsApp successfully!", "success");
    } catch (err) {
      showToast(err.message || "Could not send WhatsApp receipt", "error");
    } finally {
      setSendingWhatsappId(null);
    }
  };

  const handleOpenPayModal = (inv) => {
    setPayTargetInv(inv);
    const defaultAmt = inv.balance_due != null && inv.balance_due > 0 ? inv.balance_due : (inv.total || "");
    const defaultReason = inv.balance_due != null && inv.balance_due > 0 
      ? "Outstanding Balance Clearance"
      : "Consultation Fee";
    setPayForm({
      amount: defaultAmt,
      payment_method: "UPI",
      transaction_ref: "",
      notes: defaultReason,
    });
    setIsPayOpen(true);
  };

  const handleOpenInvoiceDetails = async (inv) => {
    setSelectedInv(inv);
    loadTransactions(inv.id);
  };

  const loadTransactions = async (invId) => {
    setLoadingTransactions(true);
    try {
      const data = await fetchInvoicePayments(invId);
      setInvoiceTransactions(data || { payments: [], refunds: [] });
    } catch (err) {
      console.warn("Failed to load invoice transactions:", err);
      setInvoiceTransactions({ payments: [], refunds: [] });
    } finally {
      setLoadingTransactions(false);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!payForm.amount || Number(payForm.amount) <= 0) {
      showToast("Please enter a valid payment amount", "error");
      return;
    }
    if (!payForm.notes || !payForm.notes.trim()) {
      showToast("Please provide a reason for collecting this amount", "error");
      return;
    }
    setPaying(true);
    try {
      await recordInvoicePayment(payTargetInv.id, {
        amount: Number(payForm.amount),
        payment_method: payForm.payment_method,
        transaction_ref: payForm.transaction_ref,
        received_by: "Reception Cashier",
        notes: payForm.notes.trim(),
      });
      setIsPayOpen(false);
      loadData();
      showToast("Payment of ₹" + payForm.amount + " recorded successfully!", "success");
      if (selectedInv && selectedInv.id === payTargetInv.id) {
        loadTransactions(selectedInv.id);
      }
    } catch (err) {
      showToast(err.message || "Failed to record payment", "error");
    } finally {
      setPaying(false);
    }
  };

  const handleRecordRefund = async (e) => {
    e.preventDefault();
    if (!refundForm.amount || Number(refundForm.amount) <= 0) {
      showToast("Please enter a valid refund amount", "error");
      return;
    }
    setRefunding(true);
    try {
      await recordInvoiceRefund(refundTargetInv.id, {
        amount: Number(refundForm.amount),
        reason: refundForm.reason || "Patient requested refund",
      });
      setIsRefundOpen(false);
      loadData();
      showToast("Refund recorded successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to record refund", "error");
    } finally {
      setRefunding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Financial Management"
        title="Billing, Invoicing & Payments"
        icon={FiDollarSign}
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Billing Data"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={() => {
                setFormError("");
                setIsCreateOpen(true);
              }}
              className="portal-action-btn flex items-center gap-2"
            >
              <FiPlus size={16} />
              <span>Generate Invoice</span>
            </button>
          </div>
        }
      />

      {/* Stat Cards (aerostate-lrs Reusable Grid) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Collected Revenue"
          value={`₹${(stats?.total_revenue || 0).toLocaleString()}`}
          Icon={FiDollarSign}
          colorTheme="brand-blue"
          trend="All Time"
        />
        <StatCard
          title="Today's Collections"
          value={`₹${(stats?.today_revenue || 0).toLocaleString()}`}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
          trend="Today"
        />
        <StatCard
          title="Pending Payments"
          value={`₹${(stats?.pending_amount || 0).toLocaleString()}`}
          Icon={FiClock}
          colorTheme="brand-blue"
          trend={`${stats?.pending_count || 0} unpaid`}
        />
        <StatCard
          title="Average Bill Value"
          value={`₹${(stats?.average_bill || 0).toLocaleString()}`}
          Icon={FiCreditCard}
          colorTheme="brand-teal"
          trend="Per Visit"
        />
      </div>

      {/* Standard LRS Module Roster Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title="Invoices & Payments"
          description="Track OPD fees, digital receipts, pending dues, and WhatsApp invoice transmissions."
          badgeCount={invoices.length}
          badgeLabel="invoices"
        />

        {/* CONTROLS & TOOLBAR */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search by Invoice # (e.g. INV-2026-0001), Patient Name, or Phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={handleSearchSubmit}
            onClear={() => {
              setSearch("");
              loadData("", statusFilter, paymentMethodFilter);
            }}
          />

          <div className="dir-filter-group flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
              }}
              className="dir-select"
              style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
            >
              <option value="">All Payment Statuses</option>
              {(billingOptions?.payment_statuses || ["PAID", "PENDING", "REFUNDED", "CANCELLED"])
                .filter((st) => st !== "ALL")
                .map((st) => (
                  <option key={st} value={st}>
                    {st} Only
                  </option>
                ))}
            </select>

            <select
              value={paymentMethodFilter}
              onChange={(e) => {
                setPaymentMethodFilter(e.target.value);
              }}
              className="dir-select"
              style={{ height: "34px", fontSize: "12.5px", padding: "0 8px" }}
            >
              <option value="">All Payment Methods</option>
              {(billingOptions?.payment_methods || ["UPI", "Cash", "Debit Card", "Credit Card", "Net Banking"])
                .filter((pm) => pm !== "ALL")
                .map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
            </select>

            <button
              type="button"
              onClick={handleSearchSubmit}
              className="btn-submit"
              style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
            >
              Search
            </button>

            {(search || statusFilter || paymentMethodFilter) && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="btn-cancel"
                style={{ width: "auto", height: "34px", padding: "0 12px", fontSize: "12.5px" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Invoices Data Grid Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
            <FiDollarSign className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-800">No invoices generated yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Create and dispatch digital invoices for consultations and procedures.
            </p>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="mt-4 portal-action-btn portal-action-btn-blue inline-flex items-center gap-1.5"
            >
              <FiPlus size={15} />
              <span>Create First Invoice</span>
            </button>
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master Billing & Invoices (Scroll horizontally to view all columns)</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">
                  Showing {invoices.length} invoice record{invoices.length === 1 ? "" : "s"}
                </span>
                <div className="dir-scroll-actions">
                  <button
                    type="button"
                    className="dir-scroll-arrow-btn"
                    onClick={handleScrollLeft}
                    title="Scroll Table Left"
                  >
                    <FiChevronLeft size={13} />
                    <span>Scroll Left</span>
                  </button>
                  <button
                    type="button"
                    className="dir-scroll-arrow-btn"
                    onClick={handleScrollRight}
                    title="Scroll Table Right"
                  >
                    <span>Scroll Right</span>
                    <FiChevronRight size={13} />
                  </button>
                </div>
              </div>
            </div>

            <div
              ref={tableContainerRef}
              className="data-grid-container"
              style={{
                border: "none",
                borderRadius: 0,
                boxShadow: "none",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                width: "100%",
              }}
            >
              <table className="data-grid-table" style={{ minWidth: "1350px", width: "100%", tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th style={{ width: "140px", minWidth: "140px", fontSize: "12px", whiteSpace: "nowrap" }}>INVOICE #</th>
                    <th style={{ minWidth: "180px", fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT NAME</th>
                    <th style={{ width: "135px", minWidth: "135px", fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT PHONE</th>
                    <th style={{ width: "115px", minWidth: "115px", fontSize: "12px", whiteSpace: "nowrap" }}>GROSS AMOUNT</th>
                    <th style={{ width: "100px", minWidth: "100px", fontSize: "12px", whiteSpace: "nowrap" }}>DISCOUNT</th>
                    <th style={{ width: "115px", minWidth: "115px", fontSize: "12px", whiteSpace: "nowrap" }}>NET TOTAL</th>
                    <th style={{ width: "95px", minWidth: "95px", fontSize: "12px", whiteSpace: "nowrap" }}>METHOD</th>
                    <th style={{ width: "110px", minWidth: "110px", fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ width: "165px", minWidth: "165px", fontSize: "12px", whiteSpace: "nowrap" }}>DATE</th>
                    <th style={{ width: "280px", minWidth: "280px", maxWidth: "280px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "8px" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedInvoices.map((inv) => (
                    <tr key={inv.id}>
                      {/* Invoice # */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                          {inv.invoice_number}
                        </span>
                      </td>

                      {/* Patient Name */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-bold text-slate-900">{inv.patient_name}</span>
                      </td>

                      {/* Patient Phone */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-slate-700">
                          {inv.patient_phone || "—"}
                        </span>
                      </td>

                      {/* Gross Subtotal */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-slate-700">
                          ₹{(inv.subtotal || inv.total).toLocaleString()}
                        </span>
                      </td>

                      {/* Discount */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {inv.discount > 0 ? (
                          <span className="font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200" style={{ fontSize: "11px" }}>
                            -₹{inv.discount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">—</span>
                        )}
                      </td>

                      {/* Net Total Amount */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-bold font-mono text-slate-900">
                          ₹{inv.total.toLocaleString()}
                        </span>
                      </td>

                      {/* Method */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded" style={{ fontSize: "11px" }}>
                          {inv.payment_method}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(inv.id, inv.payment_status)}
                          disabled={updatingId === inv.id}
                          title="Click to toggle Paid/Pending"
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border transition cursor-pointer ${
                            inv.payment_status === "PAID"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                          }`}
                          style={{ fontSize: "11px" }}
                        >
                          {inv.payment_status === "PAID" ? <FiCheckCircle size={11} /> : <FiClock size={11} />}
                          <span>{inv.payment_status}</span>
                        </button>
                      </td>

                      {/* Date */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-700 font-mono">
                          {inv.created_date_display}
                        </span>
                      </td>

                      {/* Actions: 3 Columns x 2 Rows Layout (Matching Appointments & Prescriptions Section) */}
                      <td style={{ width: "280px", minWidth: "280px", maxWidth: "280px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "8px" }}>
                        <div className="flex items-center gap-1.5 flex-nowrap w-full">
                          {/* Column 1: Financial Collection & Refunds (w-[96px]) */}
                          <div className="flex flex-col gap-1 w-[96px]">
                            {/* Top: Collect Payment Button */}
                            {inv.payment_status !== "PAID" || (inv.balance_due && inv.balance_due > 0) ? (
                              <button
                                type="button"
                                title="Collect Outstanding Balance"
                                onClick={() => handleOpenPayModal(inv)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition cursor-pointer"
                              >
                                <FiDollarSign size={11} />
                                <span>Collect {inv.balance_due ? `₹${inv.balance_due}` : `₹${inv.total}`}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Collect Additional / Settlement Payment"
                                onClick={() => handleOpenPayModal(inv)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-xs transition cursor-pointer"
                              >
                                <FiDollarSign size={11} className="text-emerald-600" />
                                <span>+ Collect</span>
                              </button>
                            )}

                            {/* Bottom: Authorized Refund Button */}
                            <button
                              type="button"
                              title="Process Authorized Refund"
                              onClick={() => {
                                setRefundTargetInv(inv);
                                setRefundForm({ amount: inv.amount_paid || inv.total, reason: "Patient Request" });
                                setIsRefundOpen(true);
                              }}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-300 shadow-xs transition cursor-pointer"
                            >
                              <FiCreditCard size={11} className="text-rose-500" />
                              <span>Refund</span>
                            </button>
                          </div>

                          {/* Column 2: Document & Inspection (w-[86px]) */}
                          <div className="flex flex-col gap-1 w-[86px]">
                            {/* Top: View Bill */}
                            <button
                              type="button"
                              title="View Itemized Bill & Transaction History"
                              onClick={() => handleOpenInvoiceDetails(inv)}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                            >
                              <FiEye size={11} className="text-[#254d90]" />
                              <span>View</span>
                            </button>

                            {/* Bottom: PDF Receipt Print */}
                            <button
                              type="button"
                              title="Print Official PDF Receipt"
                              onClick={() => handlePrintPdf(inv)}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                            >
                              <FiPrinter size={11} className="text-slate-500" />
                              <span>Receipt</span>
                            </button>
                          </div>

                          {/* Column 3: 7th Single Full-Height WhatsApp Button (w-[78px]) */}
                          <div className="flex flex-col justify-center w-[78px]">
                            <button
                              type="button"
                              title="Send Official Receipt to Patient on WhatsApp"
                              disabled={sendingWhatsappId === inv.id}
                              onClick={() => handleSendWhatsApp(inv.id)}
                              className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer disabled:opacity-50"
                            >
                              <FaWhatsapp size={14} className="text-emerald-600" />
                              <span>{sendingWhatsappId === inv.id ? "Sending" : "WhatsApp"}</span>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          <Pagination
            currentPage={currentPage}
            totalItems={invoices.length}
            pageSize={pageSize}
            onPageChange={(p) => setCurrentPage(p)}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setCurrentPage(1);
            }}
            pageSizeOptions={[10, 20, 50, 100]}
            itemLabel="invoices"
          />

          <div className="dir-scroll-bar-footer">
            <span className="text-xs text-slate-500 font-medium">
              Audit log of clinical billing, payments received, and automated WhatsApp receipts.
            </span>
          </div>
        </div>
      )}
    </section>

      {/* CREATE INVOICE MODAL */}
      {isCreateOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "700px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Generate Patient Invoice</h2>
                <div className="modal-kicker">Itemized consultation &amp; clinical treatment billing</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsCreateOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            {formError && (
              <div className="mx-5 mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateInvoice} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                {/* Patient Selection */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Patient Phone *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 919758482859"
                      value={formData.patient_phone}
                      onChange={(e) => {
                        const ph = e.target.value;
                        const matched = patients.find((p) => p.phone === ph.trim());
                        setFormData({
                          ...formData,
                          patient_phone: ph,
                          patient_name: matched ? matched.name : formData.patient_name,
                        });
                      }}
                      className="font-mono"
                    />
                  </div>

                  <div className="form-group">
                    <label>Patient Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Ravi Bharti"
                      value={formData.patient_name}
                      onChange={(e) => setFormData({ ...formData, patient_name: e.target.value })}
                    />
                  </div>
                </div>

                {/* Dynamic Line Items */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700">Billable Services &amp; Products:</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleImportUnbilled}
                        disabled={importingUnbilled}
                        className="text-xs font-bold text-[#126868] bg-[#126868]/10 hover:bg-[#126868]/20 px-2 py-1 rounded transition flex items-center gap-1 cursor-pointer"
                        title="Import unbilled consultation, lab orders, and pharmacy dispenses"
                      >
                        <FiRefreshCw size={12} className={importingUnbilled ? "animate-spin" : ""} />
                        <span>{importingUnbilled ? "Importing..." : "Import Unbilled Care"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleAddItem}
                        className="text-xs font-bold text-[#254d90] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <FiPlus size={14} />
                        <span>Add Item</span>
                      </button>
                    </div>
                  </div>

                  {formData.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <input
                        type="text"
                        required
                        placeholder="Service (e.g. Dental Scaling / Consultation)"
                        value={item.description}
                        onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-medium"
                        style={{ height: "36px" }}
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                        className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white text-center"
                        style={{ height: "36px" }}
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-400">₹</span>
                        <input
                          type="number"
                          min="0"
                          placeholder="Price"
                          value={item.unit_price}
                          onChange={(e) => handleItemChange(idx, "unit_price", e.target.value)}
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-bold"
                          style={{ height: "36px" }}
                        />
                      </div>
                      {formData.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                        >
                          <FiTrash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Discount, Tax & Summary */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Discount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.discount}
                        onChange={(e) => setFormData({ ...formData, discount: Number(e.target.value) })}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                        style={{ height: "36px" }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tax / GST (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.tax}
                        onChange={(e) => setFormData({ ...formData, tax: Number(e.target.value) })}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                        style={{ height: "36px" }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Subtotal: ₹{calculatedSubtotal.toLocaleString()}</span>
                    <div className="text-right">
                      <span className="text-slate-500 text-xs block">Final Total Due:</span>
                      <span className="text-base font-extrabold text-[#254d90]">
                        ₹{calculatedTotal.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Payment Mode & Status */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Payment Method</label>
                    <select
                      value={formData.payment_method}
                      onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                    >
                      <option value="UPI">UPI (Google Pay / PhonePe / Paytm)</option>
                      <option value="Cash">Cash</option>
                      <option value="Card">Debit / Credit Card</option>
                      <option value="Net Banking">Net Banking</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Payment Status</label>
                    <select
                      value={formData.payment_status}
                      onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                    >
                      <option value="PAID">PAID (Received)</option>
                      <option value="PENDING">PENDING (Unpaid)</option>
                    </select>
                  </div>
                </div>

                {/* Deliver to WhatsApp Toggle */}
                <div className="info-box-note flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FiSend size={15} style={{ flexShrink: 0 }} />
                    <span>Send digital receipt to patient's WhatsApp immediately</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.send_whatsapp}
                    onChange={(e) => setFormData({ ...formData, send_whatsapp: e.target.checked })}
                    className="cursor-pointer"
                    style={{ width: "16px", height: "16px" }}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{saving ? "Generating & Sending..." : "Generate Invoice"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW & PRINT RECEIPT MODAL */}
      {selectedInv && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "600px", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="modal-header">
              <div>
                <h2>{selectedInv.invoice_number}</h2>
                <div className="modal-kicker">Patient billing invoice receipt</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInv(null)}
                className="modal-close"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Printable Content */}
            <div className="modal-body">
              <div className="border-b border-slate-200 pb-3 flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-slate-900 m-0">{clinicSettings?.clinic_name || "Aerostate Speciality Clinic"}</h3>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">
                    {clinicSettings?.clinic_address ? `${clinicSettings.clinic_address} • Phone: ${clinicSettings.clinic_phone || ""}` : "Outpatient & Clinical Services"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold font-mono text-slate-800">{selectedInv.invoice_number}</div>
                  <div className={`text-[11px] font-bold ${selectedInv.payment_status === "PAID" ? "text-emerald-600" : "text-amber-600"}`}>
                    {selectedInv.payment_status} ({selectedInv.payment_method})
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex justify-between text-xs">
                <div>
                  <span className="text-slate-400 font-semibold">Billed To:</span>{" "}
                  <strong className="text-slate-900">{selectedInv.patient_name}</strong>
                  <div className="text-slate-500 font-mono mt-0.5">{selectedInv.patient_phone}</div>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 font-semibold">Date:</span>{" "}
                  <div>{selectedInv.created_date_display}</div>
                </div>
              </div>

              {/* Items Table */}
              <div className="data-grid-container" style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                <table className="data-grid-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ fontSize: "12px" }}>Description</th>
                      <th style={{ fontSize: "12px", textAlign: "center" }}>Qty</th>
                      <th style={{ fontSize: "12px", textAlign: "right" }}>Unit Price</th>
                      <th style={{ fontSize: "12px", textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInv.items.map((it, idx) => (
                      <tr key={idx}>
                        <td style={{ fontSize: "12px" }} className="font-semibold text-slate-800">{it.description}</td>
                        <td style={{ fontSize: "12px", textAlign: "center" }} className="text-slate-600 font-mono">{it.quantity}</td>
                        <td style={{ fontSize: "12px", textAlign: "right" }} className="text-slate-600 font-mono">₹{it.unit_price}</td>
                        <td style={{ fontSize: "12px", textAlign: "right" }} className="font-bold text-slate-900 font-mono">
                          ₹{(it.total || it.quantity * it.unit_price).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-200 pt-3 space-y-1 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal:</span>
                  <span>₹{selectedInv.subtotal.toLocaleString()}</span>
                </div>
                {selectedInv.discount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount:</span>
                    <span>-₹{selectedInv.discount.toLocaleString()}</span>
                  </div>
                )}
                {selectedInv.tax > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Tax / GST:</span>
                    <span>+₹{selectedInv.tax.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-extrabold text-slate-900 border-t border-slate-200 pt-2">
                  <span>Total Amount:</span>
                  <span>₹{selectedInv.total.toLocaleString()}</span>
                </div>
              </div>

              {/* Transaction History & Payment Audit Ledger */}
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <FiCreditCard size={13} className="text-[#254d90]" />
                    <span>Transaction History &amp; Payment Ledger</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenPayModal(selectedInv)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded bg-emerald-700 text-white hover:bg-emerald-800 shadow-2xs transition cursor-pointer"
                    title="Collect payment or additional amount for this bill"
                  >
                    <FiDollarSign size={12} />
                    <span>+ Collect Amount</span>
                  </button>
                </div>

                {loadingTransactions ? (
                  <div className="p-3 bg-slate-50 rounded-lg text-center text-xs text-slate-500 animate-pulse">
                    Loading transaction records...
                  </div>
                ) : (invoiceTransactions.payments?.length > 0 || invoiceTransactions.refunds?.length > 0) ? (
                  <div className="space-y-1.5">
                    {invoiceTransactions.payments.map((p, idx) => (
                      <div
                        key={p.payment_uid || idx}
                        className="p-2.5 bg-emerald-50/50 border border-emerald-200/80 rounded-lg flex items-center justify-between text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-emerald-800 bg-emerald-100/80 px-1.5 py-0.2 rounded text-[10.5px]">
                              {p.payment_uid}
                            </span>
                            <span className="font-semibold text-slate-800">
                              via {p.payment_method}
                            </span>
                            {p.transaction_ref && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                Ref: {p.transaction_ref}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-700">
                            <span className="text-slate-500">Reason:</span>{" "}
                            <strong className="text-slate-900">{p.notes || "Invoice settlement"}</strong>
                            <span className="text-slate-400 mx-1.5">•</span>
                            <span className="text-slate-500">Received by: {p.received_by || "Reception"}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-emerald-700 text-sm block">
                            +₹{p.amount?.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {p.date}
                          </span>
                        </div>
                      </div>
                    ))}

                    {invoiceTransactions.refunds.map((r, idx) => (
                      <div
                        key={r.refund_uid || idx}
                        className="p-2.5 bg-rose-50/50 border border-rose-200/80 rounded-lg flex items-center justify-between text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-rose-800 bg-rose-100/80 px-1.5 py-0.2 rounded text-[10.5px]">
                              {r.refund_uid}
                            </span>
                            <span className="font-semibold text-rose-700">
                              Refund Processed
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-700">
                            <span className="text-slate-500">Reason:</span>{" "}
                            <strong className="text-rose-900">{r.reason}</strong>
                            <span className="text-slate-400 mx-1.5">•</span>
                            <span className="text-slate-500">Authorized: {r.authorized_by}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-rose-700 text-sm block">
                            -₹{r.amount?.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {r.date}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex justify-between items-center">
                    <div>
                      <span className="font-semibold text-slate-800">Initial Settlement:</span>{" "}
                      <span>Recorded via {selectedInv.payment_method} on {selectedInv.created_date_display}</span>
                      {selectedInv.notes && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Reason: <strong className="text-slate-700">{selectedInv.notes}</strong>
                        </div>
                      )}
                    </div>
                    <span className="font-mono font-bold text-emerald-700 text-sm">
                      ₹{selectedInv.amount_paid != null ? selectedInv.amount_paid.toLocaleString() : selectedInv.total?.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer flex items-center justify-end gap-2 bg-slate-50 p-3 rounded-b-xl border-t border-slate-200 no-print">
              <button
                type="button"
                onClick={() => handleSendWhatsApp(selectedInv.id)}
                disabled={sendingWhatsappId === selectedInv.id}
                className="h-9 px-3.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Send receipt to patient via WhatsApp"
              >
                <FiSend size={13} />
                <span>{sendingWhatsappId === selectedInv.id ? "Sending..." : "WhatsApp"}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintPdf(selectedInv)}
                disabled={printingPdf}
                className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Print Receipt"
              >
                <FiPrinter size={13} />
                <span>{printingPdf ? "Printing..." : "Print"}</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadPdf(selectedInv)}
                disabled={downloadingPdf}
                className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Download Receipt PDF"
              >
                <FiDownload size={13} />
                <span>{downloadingPdf ? "Downloading..." : "Download"}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedInv(null)}
                className="h-9 px-4 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {isPayOpen && payTargetInv && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Record Payment</h2>
                <div className="modal-kicker">Mark outstanding invoice balance as received</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsPayOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Invoice:</span>
                    <span className="font-mono font-bold text-slate-900">{payTargetInv.invoice_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Patient:</span>
                    <span className="font-bold text-slate-900">{payTargetInv.patient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Billed:</span>
                    <span className="font-bold text-[#254d90]">₹{payTargetInv.total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="form-group">
                  <label>Amount to Collect (₹) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    className="font-mono font-bold text-base text-emerald-800"
                  />
                </div>

                <div className="form-group">
                  <label className="flex items-center justify-between">
                    <span>Reason for Collecting Amount *</span>
                    <span className="text-[10px] text-slate-400 font-normal">Mandatory audit record</span>
                  </label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {[
                      "Consultation Fee",
                      "Lab Diagnostics",
                      "Pharmacy Medicines",
                      "Procedure Charges",
                      "Balance Clearance",
                      "Advance Deposit",
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setPayForm({ ...payForm, notes: preset })}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition cursor-pointer ${
                          payForm.notes === preset
                            ? "bg-[#254d90] text-white border-[#254d90]"
                            : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Doctor Consultation Fee / Follow-up / Lab tests"
                    value={payForm.notes}
                    onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Payment Method</label>
                  <select
                    value={payForm.payment_method}
                    onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                  >
                    <option value="UPI">UPI (Google Pay / PhonePe / Paytm)</option>
                    <option value="Cash">Cash</option>
                    <option value="Card">Debit / Credit Card</option>
                    <option value="Net Banking">Net Banking</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Transaction / Reference ID</label>
                  <input
                    type="text"
                    placeholder="e.g. UPI Ref / Bank Auth Code"
                    value={payForm.transaction_ref}
                    onChange={(e) => setPayForm({ ...payForm, transaction_ref: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsPayOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>{paying ? "Recording..." : "Confirm Payment"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD REFUND MODAL */}
      {isRefundOpen && refundTargetInv && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Authorize Refund</h2>
                <div className="modal-kicker">Issue patient credit reversal or fee reimbursement</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsRefundOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleRecordRefund} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Invoice:</span>
                    <span className="font-mono font-bold text-slate-900">{refundTargetInv.invoice_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Paid Amount:</span>
                    <span className="font-bold text-rose-800">₹{refundTargetInv.total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="form-group">
                  <label>Refund Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={refundTargetInv.total}
                    value={refundForm.amount}
                    onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
                    className="font-mono font-bold"
                  />
                </div>

                <div className="form-group">
                  <label>Reason for Refund *</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="e.g. Appointment cancelled by patient, double charge..."
                    value={refundForm.reason}
                    onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsRefundOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refunding}
                  className="btn-submit"
                  style={{ background: "#dc2626" }}
                >
                  <FiCheck size={14} />
                  <span>{refunding ? "Processing..." : "Authorize Refund"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
