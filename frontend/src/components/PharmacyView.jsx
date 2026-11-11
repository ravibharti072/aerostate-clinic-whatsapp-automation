import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { FaRupeeSign } from "react-icons/fa";
import {
  FiPackage,
  FiSearch,
  FiPlus,
  FiCheckCircle,
  FiAlertTriangle,
  FiClock,
  FiX,
  FiTrendingUp,
  FiFileText,
  FiLayers,
  FiFilter,
  FiArrowDownRight,
  FiArrowUpRight,
  FiRotateCw,
  FiCheck,
  FiEdit2,
  FiChevronLeft,
  FiChevronRight,
  FiTrash2,
  FiDollarSign,
  FiCreditCard,
  FiPrinter,
  FiSend,
  FiDownload,
  FiXCircle,
  FiList,
  FiGrid,
  FiPhone,
  FiCalendar,
  FiUser,
  FiInfo,
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchPharmacyStats,
  fetchPharmacyOptions,
  fetchMedicines,
  addMedicine,
  updateMedicine,
  fetchBatches,
  updateBatch,
  recordGoodsReceipt,
  dispensePrescription,
  fetchInventoryTransactions,
  fetchInventoryAlerts,
  fetchPharmacyPrescriptions,
  fetchPatients,
  fetchInvoice,
  recordInvoicePayment,
  sendInvoiceWhatsApp,
  sendPrescriptionToFrontDesk,
  cancelPrescriptionDispatch,
  downloadReceiptPdf,
  printReceiptPdf,
  fetchSettings
} from "../api";

export default function PharmacyView() {
  const { showToast } = useToast();
  const [medicines, setMedicines] = useState([]);
  const [batches, setBatches] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [alerts, setAlerts] = useState(null);
  const [stats, setStats] = useState(null);
  const [pharmacyOptions, setPharmacyOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending"); // "pending" (DEFAULT), "dispensed", "outside", "catalogue", "batches", "transactions"
  const [searchDispatch, setSearchDispatch] = useState("");
  const [dateDispatch, setDateDispatch] = useState("");
  const [pharmacyPrescriptions, setPharmacyPrescriptions] = useState([]);
  const [pageDispatch, setPageDispatch] = useState(1);
  const [pageSizeDispatch, setPageSizeDispatch] = useState(20);
  const [desktopViewMode, setDesktopViewMode] = useState("table");

  const getTodayStr = () => new Date().toISOString().slice(0, 10);
  const getYesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };


  const dispatchTableRef = useRef(null);

  const handleScrollDispatchLeft = () => {
    if (dispatchTableRef.current) {
      dispatchTableRef.current.scrollBy({ left: -350, behavior: "smooth" });
    }
  };


  const handleScrollDispatchRight = () => {
    if (dispatchTableRef.current) {
      dispatchTableRef.current.scrollBy({ left: 350, behavior: "smooth" });
    }
  };


  // Filters Tab 2: Catalogue
  const [searchMed, setSearchMed] = useState("");
  const [dosageFormFilter, setDosageFormFilter] = useState("ALL");
  const [stockStatusFilter, setStockStatusFilter] = useState("ALL");

  // Filters Tab 3: Batches
  const [searchBatch, setSearchBatch] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState("ALL");

  // Filters Tab 4: Transactions
  const [searchTxn, setSearchTxn] = useState("");
  const [txnTypeFilter, setTxnTypeFilter] = useState("ALL");

  // Pagination for all tabs (20 per page from LRS)
  const [pageMed, setPageMed] = useState(1);
  const [pageSizeMed, setPageSizeMed] = useState(20);
  const [pageBatch, setPageBatch] = useState(1);
  const [pageSizeBatch, setPageSizeBatch] = useState(20);
  const [pageTxn, setPageTxn] = useState(1);
  const [pageSizeTxn, setPageSizeTxn] = useState(20);

  // 100% backend-calculated metrics and backend-filtered prescription list
  const filteredPrescriptions = pharmacyPrescriptions || [];

  const paginatedDispatch = useMemo(() => {
    if (pageSizeDispatch === "all") return filteredPrescriptions;
    const start = (pageDispatch - 1) * pageSizeDispatch;
    return filteredPrescriptions.slice(start, start + pageSizeDispatch);
  }, [filteredPrescriptions, pageDispatch, pageSizeDispatch]);

  // Driven 100% by backend-aggregated KPI metrics
  const pendingDispatchCount = stats?.pending_dispatch_count ?? (pharmacyPrescriptions || []).filter(
    (rx) => !rx.is_cancelled && rx.status !== "CANCELLED" && (rx.status === "PENDING" || (!rx.is_dispensed && rx.fulfillment_type !== "OUTSIDE"))
  ).length;

  const dispensedDispatchCount = stats?.dispensed_count ?? (pharmacyPrescriptions || []).filter((rx) => rx.is_dispensed && !rx.is_cancelled && rx.status !== "CANCELLED").length;

  const outsideDispatchCount = stats?.outside_count ?? (pharmacyPrescriptions || []).filter(
    (rx) => !rx.is_cancelled && rx.status !== "CANCELLED" && (rx.status === "OUTSIDE" || rx.fulfillment_type === "OUTSIDE")
  ).length;

  const cancelledDispatchCount = stats?.cancelled_count ?? (pharmacyPrescriptions || []).filter(
    (rx) => rx.status === "CANCELLED" || rx.is_cancelled
  ).length;

  const paginatedMeds = useMemo(() => {
    if (pageSizeMed === "all") return medicines;
    const start = (pageMed - 1) * pageSizeMed;
    return medicines.slice(start, start + pageSizeMed);
  }, [medicines, pageMed, pageSizeMed]);

  const paginatedBatches = useMemo(() => {
    if (pageSizeBatch === "all") return batches;
    const start = (pageBatch - 1) * pageSizeBatch;
    return batches.slice(start, start + pageSizeBatch);
  }, [batches, pageBatch, pageSizeBatch]);

  const paginatedTxns = useMemo(() => {
    if (pageSizeTxn === "all") return transactions;
    const start = (pageTxn - 1) * pageSizeTxn;
    return transactions.slice(start, start + pageSizeTxn);
  }, [transactions, pageTxn, pageSizeTxn]);

  const [patients, setPatients] = useState([]);

  // Goods Receipt Modal
  const [isGrnOpen, setIsGrnOpen] = useState(false);
  const [grnMedSearch, setGrnMedSearch] = useState("");
  const [grnForm, setGrnForm] = useState({
    medicine_id: "",
    batch_number: "",
    supplier_name: "AeroHealth Pharma Distributors",
    expiry_date: "2027-12-31",
    quantity: 100,
    purchase_cost: 30,
    selling_price: 50,
  });

  const filteredGrnMedicines = useMemo(() => {
    if (!medicines || !Array.isArray(medicines)) return [];
    if (!grnMedSearch.trim()) {
      return medicines.slice(0, 15);
    }
    const q = grnMedSearch.toLowerCase().trim();
    return medicines.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const generic = (m.generic_name || "").toLowerCase();
      const brand = (m.brand || "").toLowerCase();
      const code = (m.code || "").toLowerCase();
      return name.includes(q) || generic.includes(q) || brand.includes(q) || code.includes(q);
    });
  }, [medicines, grnMedSearch]);

  const selectedGrnMed = useMemo(() => {
    if (!grnForm.medicine_id || !medicines) return null;
    return medicines.find((m) => String(m.id) === String(grnForm.medicine_id)) || null;
  }, [grnForm.medicine_id, medicines]);

  // Add Medicine to Catalogue Modal
  const [isAddMedOpen, setIsAddMedOpen] = useState(false);
  const [medForm, setMedForm] = useState({
    code: "",
    name: "",
    generic_name: "",
    brand: "",
    dosage_form: "Tablet",
    strength: "500mg",
    reorder_level: 20,
    purchase_price: 30,
    selling_price: 50,
    tax_percent: 12,
  });

  // Edit Medicine Modal
  const [isEditMedOpen, setIsEditMedOpen] = useState(false);
  const [editingMed, setEditingMed] = useState(null);
  const [editMedForm, setEditMedForm] = useState({
    code: "",
    name: "",
    generic_name: "",
    brand: "",
    dosage_form: "Tablet",
    strength: "500mg",
    reorder_level: 20,
    purchase_price: 30,
    selling_price: 50,
    tax_percent: 12,
  });

  // Edit Batch Modal
  const [isEditBatchOpen, setIsEditBatchOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [editBatchForm, setEditBatchForm] = useState({
    batch_number: "",
    supplier_name: "",
    expiry_date: "",
    purchase_cost: 0,
    selling_price: 0,
    quantity_available: 0,
  });

  // Dispense Modal
  const [isDispenseOpen, setIsDispenseOpen] = useState(false);
  const [dispenseForm, setDispenseForm] = useState({
    patient_id: "",
    prescription_id: "",
    dispensed_by: "Sanjay Gupta (Pharmacist)",
    collect_payment: true,
    payment_method: "Cash",
    amount_collected: "",
    cash_tendered: "",
    transaction_ref: "",
    items: [
      {
        id: "item-init",
        medicine_name: "",
        dosage: "",
        duration: "",
        instructions: "",
        batch_id: "",
        quantity: 10,
        fulfillment: "CLINIC",
      },
    ],
  });
  const [dispensing, setDispensing] = useState(false);
  const [patientPrescriptions, setPatientPrescriptions] = useState([]);
  const [createInvoiceOnDispense, setCreateInvoiceOnDispense] = useState(true);
  const [dispensePatientSearch, setDispensePatientSearch] = useState("");

  const filteredDispensePatients = useMemo(() => {
    if (!patients || !Array.isArray(patients)) return [];
    if (!dispensePatientSearch.trim()) {
      return patients.slice(0, 15);
    }
    const q = dispensePatientSearch.toLowerCase().trim();
    return patients.filter((p) => {
      const name = (p.name || "").toLowerCase();
      const phone = (p.phone || "").toLowerCase();
      const uid = (p.patient_uid || `PAT-${String(p.id).padStart(4, "0")}`).toLowerCase();
      return name.includes(q) || phone.includes(q) || uid.includes(q);
    });
  }, [patients, dispensePatientSearch]);

  const selectedDispensePatient = useMemo(() => {
    if (!dispenseForm.patient_id || !patients) return null;
    return patients.find((p) => String(p.id) === String(dispenseForm.patient_id)) || null;
  }, [dispenseForm.patient_id, patients]);

  // Dedicated Collect Payment Modal State
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [collectTargetRx, setCollectTargetRx] = useState(null);
  const [collectForm, setCollectForm] = useState({
    amount: "",
    payment_method: "Cash",
    cash_tendered: "",
    transaction_ref: "",
    notes: "",
  });
  const [collecting, setCollecting] = useState(false);

  // Pharmacy Receipt / Invoice Modal State
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [sendingReceiptWhatsApp, setSendingReceiptWhatsApp] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [clinicSettings, setClinicSettings] = useState(null);

  // Send for Billing to Front Desk & Cancel Modal States
  const [sendingBillingId, setSendingBillingId] = useState(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [selectedRxToCancel, setSelectedRxToCancel] = useState(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellingRx, setCancellingRx] = useState(false);

  const QUICK_CANCEL_REASONS = [
    "Patient declined medication",
    "Purchased from outside chemist",
    "Doctor modified / cancelled prescription",
    "Medicine out of stock",
    "Duplicate prescription",
  ];

  // Computed total for dispenseForm items
  const estimatedDispenseTotal = useMemo(() => {
    return (dispenseForm.items || []).reduce((acc, it) => {
      const b = batches.find((bat) => String(bat.id) === String(it.batch_id));
      return acc + (parseInt(it.quantity, 10) || 0) * (b ? (b.selling_price || 0) : 0);
    }, 0);
  }, [dispenseForm.items, batches]);

  // Helper to build dynamic medicine items matching prescription
  const buildItemsFromRx = (rx, availableBatches = batches) => {
    if (!rx) return [];
    const validBatches = (availableBatches || []).filter(
      (b) => !b.is_expired && b.quantity_available > 0
    );

    // Filter medicines that are fulfilled by CLINIC (default to CLINIC if not specified)
    const clinicMeds = (rx.clinic_meds && rx.clinic_meds.length > 0)
      ? rx.clinic_meds
      : (rx.medicines || []).filter(
          (m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC"
        );

    const medsToUse = clinicMeds.length > 0 ? clinicMeds : (rx.medicines || []);

    if (medsToUse.length === 0) {
      return [
        {
          id: `item-${Date.now()}`,
          medicine_name: "",
          dosage: "",
          duration: "",
          instructions: "",
          batch_id: "",
          quantity: 10,
          fulfillment: "CLINIC",
        },
      ];
    }

    return medsToUse.map((m, idx) => {
      const cleanName = (m.name || "")
        .toLowerCase()
        .replace(/\d+(\.\d+)?\s*(mg|g|ml|mcg|iu)/gi, "")
        .trim();

      // Find best matching batch with positive stock
      let matchedBatch = validBatches.find((b) => {
        const bName = (b.medicine_name || "").toLowerCase();
        return (
          bName.includes(cleanName) ||
          cleanName.includes(bName) ||
          (m.name && bName.includes(m.name.toLowerCase()))
        );
      });

      // Secondary token matching if no direct match
      if (!matchedBatch && cleanName.length > 2) {
        const tokens = cleanName.split(/[\s+&/,]+/).filter((t) => t.length > 2);
        matchedBatch = validBatches.find((b) => {
          const bName = (b.medicine_name || "").toLowerCase();
          return tokens.some((t) => bName.includes(t));
        });
      }

      // Smart quantity calculation from dosage and duration
      let smartQty = 10;
      try {
        let pillsPerDay = 0;
        if (m.dosage && /^\d+-\d+-\d+/.test(m.dosage.trim())) {
          pillsPerDay = m.dosage
            .trim()
            .split("-")
            .reduce((acc, p) => acc + (parseFloat(p) || 0), 0);
        } else if (m.frequency) {
          const f = m.frequency.toLowerCase();
          if (f.includes("once") || f.includes("od")) pillsPerDay = 1;
          else if (f.includes("twice") || f.includes("bd") || f.includes("bid")) pillsPerDay = 2;
          else if (f.includes("thrice") || f.includes("tds") || f.includes("tid")) pillsPerDay = 3;
          else if (f.includes("four") || f.includes("qid")) pillsPerDay = 4;
        }

        let days = 5;
        if (m.duration) {
          const numMatch = m.duration.match(/\d+/);
          if (numMatch) days = parseInt(numMatch[0], 10);
          if (m.duration.toLowerCase().includes("week")) days *= 7;
          if (m.duration.toLowerCase().includes("month")) days *= 30;
        }

        if (pillsPerDay > 0 && days > 0) {
          smartQty = pillsPerDay * days;
        }
      } catch (err) {
        smartQty = 10;
      }

      return {
        id: `rx-med-${idx}-${Date.now()}`,
        medicine_name: m.name || `Prescribed Medicine #${idx + 1}`,
        dosage: m.dosage || "",
        duration: m.duration || "",
        instructions: m.instructions || m.notes || "",
        batch_id: matchedBatch ? String(matchedBatch.id) : "",
        quantity: smartQty,
        fulfillment: m.fulfillment || "CLINIC",
      };

    });
  };


  const [searchParams, setSearchParams] = useSearchParams();
  const openedRxRef = useRef("");

  const handleCloseDispenseModal = () => {
    setIsDispenseOpen(false);
    setDispensePatientSearch("");
    if (searchParams.get("patient_id") || searchParams.get("prescription_id")) {
      setSearchParams({}, { replace: true });
    }
  };


  useEffect(() => {
    const ptId = searchParams.get("patient_id");
    const rxId = searchParams.get("prescription_id");
    if (!ptId && !rxId) {
      openedRxRef.current = "";
      return;
    }
    const currentKey = `${ptId || ""}_${rxId || ""}`;
    if (openedRxRef.current === currentKey) {
      return;
    }
    openedRxRef.current = currentKey;
    setActiveTab("pending");
    const matchedRx = pharmacyPrescriptions.find((p) => String(p.id) === String(rxId));
    if (matchedRx) {
      setDispenseForm({
        patient_id: String(matchedRx.patient_id || ptId),
        prescription_id: String(matchedRx.id),
        dispensed_by: "Sanjay Gupta (Pharmacist)",
        items: buildItemsFromRx(matchedRx, batches),
      });
    } else {
      setDispenseForm((prev) => ({
        ...prev,
        patient_id: ptId || prev.patient_id,
        prescription_id: rxId || prev.prescription_id,
      }));
    }
    setIsDispenseOpen(true);
  }, [searchParams]);

  useEffect(() => {
    if (dispenseForm.patient_id) {
      fetchPharmacyPrescriptions({ patient_id: dispenseForm.patient_id })
        .then((rxs) => {
          setPatientPrescriptions(rxs || []);
          if (
            dispenseForm.prescription_id &&
            (!dispenseForm.items ||
              dispenseForm.items.length === 0 ||
              !dispenseForm.items[0].medicine_name)
          ) {
            const rx = (rxs || []).find(
              (p) => String(p.id) === String(dispenseForm.prescription_id)
            );
            if (rx) {
              setDispenseForm((prev) => ({
                ...prev,
                items: buildItemsFromRx(rx, batches),
              }));
            }
          }
        })
        .catch((err) => console.warn("Failed to load patient prescriptions:", err));
    } else {
      setPatientPrescriptions([]);
    }
  }, [dispenseForm.patient_id, dispenseForm.prescription_id, batches]);

  // Initial Full Load and Silent Auto-Update
  const loadData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const [mList, bList, tList, aData, pList, sData, oData, rxs] = await Promise.all([
        fetchMedicines({
          search: searchMed,
          dosage_form: dosageFormFilter !== "ALL" ? dosageFormFilter : "",
          stock_status: stockStatusFilter !== "ALL" ? stockStatusFilter : "",
        }),
        fetchBatches({
          search: searchBatch,
          status: batchStatusFilter !== "ALL" ? batchStatusFilter : "",
        }),
        fetchInventoryTransactions({
          search: searchTxn,
          transaction_type: txnTypeFilter !== "ALL" ? txnTypeFilter : "",
        }),
        fetchInventoryAlerts(),
        fetchPatients(),
        fetchPharmacyStats(),
        fetchPharmacyOptions(),
        fetchPharmacyPrescriptions({
          status: ["pending", "dispensed", "outside", "cancelled"].includes(activeTab) ? activeTab.toUpperCase() : "ALL",
          search: searchDispatch,
          date: dateDispatch,
        }),
      ]);
      setMedicines(mList || []);
      setBatches(bList || []);
      setTransactions(tList || []);
      setAlerts(aData || null);
      setPatients(pList.patients || []);
      setStats(sData || null);
      setPharmacyOptions(oData || null);
      setPharmacyPrescriptions(rxs || []);
      fetchSettings().then((st) => setClinicSettings(st)).catch(() => {});
    } catch (err) {
      if (!isBackground) {
        console.error("Failed to load pharmacy data:", err);
        showToast(err.message || "Failed to load pharmacy data", "error");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };


  // Live Auto-Refresh Every 5 Seconds (Silent polling across portal)
  useEffect(() => {
    loadData(false);

    const interval = setInterval(() => {
      // Do not interrupt active modal interaction
      if (!isDispenseOpen && !isGrnOpen && !isAddMedOpen && !isEditMedOpen && !isEditBatchOpen) {
        loadData(true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeTab, searchDispatch, dateDispatch, isDispenseOpen, isGrnOpen, isAddMedOpen, isEditMedOpen, isEditBatchOpen]);

  const handleOpenDispenseForRx = (rx) => {
    const rxItems = buildItemsFromRx(rx, batches);
    setDispenseForm({
      patient_id: String(rx.patient_id),
      prescription_id: String(rx.id),
      dispensed_by: "Sanjay Gupta (Pharmacist)",
      collect_payment: true,
      payment_method: "Cash",
      amount_collected: "",
      cash_tendered: "",
      transaction_ref: "",
      items: rxItems,
    });
    setIsDispenseOpen(true);
  };
  const handleSendToFrontDesk = async (rx) => {
    try {
      setSendingBillingId(rx.id);
      const res = await sendPrescriptionToFrontDesk(rx.id);
      showToast(res.message || "Prescription forwarded to Front Desk for billing successfully!", "success");
      await loadData();
    } catch (err) {
      showToast(err.message || "Failed to forward to Front Desk", "error");
    } finally {
      setSendingBillingId(null);
    }
  };

  const handleOpenCancelModal = (rx) => {
    setSelectedRxToCancel(rx);
    setCancellationReason("");
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancel = async (e) => {
    e?.preventDefault();
    if (!selectedRxToCancel) return;
    if (!cancellationReason.trim()) {
      showToast("Cancellation reason is required. Please provide a reason.", "error");
      return;
    }

    try {
      setCancellingRx(true);
      const res = await cancelPrescriptionDispatch(selectedRxToCancel.id, cancellationReason.trim());
      showToast(res.message || "Prescription cancelled successfully.", "success");
      setIsCancelModalOpen(false);
      setSelectedRxToCancel(null);
      setCancellationReason("");
      await loadData();
    } catch (err) {
      showToast(err.message || "Failed to cancel prescription", "error");
    } finally {
      setCancellingRx(false);
    }
  };



  const handleOpenDispenseModal = () => {
    setDispenseForm({
      patient_id: "",
      prescription_id: "",
      dispensed_by: "Sanjay Gupta (Pharmacist)",
      collect_payment: true,
      payment_method: "Cash",
      amount_collected: "",
      cash_tendered: "",
      transaction_ref: "",
      items: [
        {
          id: `item-${Date.now()}`,
          medicine_name: "",
          dosage: "",
          duration: "",
          instructions: "",
          batch_id: "",
          quantity: 10,
          fulfillment: "CLINIC",
        },
      ],
    });
    setIsDispenseOpen(true);
  };


  const handleAddItem = () => {
    setDispenseForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          medicine_name: "",
          dosage: "",
          duration: "",
          instructions: "",
          batch_id: "",
          quantity: 10,
          fulfillment: "CLINIC",
        },
      ],
    }));
  };


  const handleRemoveItem = (index) => {
    setDispenseForm((prev) => {
      if (prev.items.length <= 1) return prev;
      const next = [...prev.items];
      next.splice(index, 1);
      return { ...prev, items: next };
    });
  };


  const handleItemChange = (index, field, value) => {
    setDispenseForm((prev) => {
      const next = [...prev.items];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, items: next };
    });
  };


  const handleBatchSelect = (index, batchId) => {
    setDispenseForm((prev) => {
      const next = [...prev.items];
      const selectedB = batches.find((b) => String(b.id) === String(batchId));
      next[index] = {
        ...next[index],
        batch_id: batchId,
        medicine_name: next[index].medicine_name || (selectedB ? selectedB.medicine_name : ""),
      };

      return { ...prev, items: next };
    });
  };


  const handlePrescriptionChange = (selRxId) => {
    if (!selRxId) {
      setDispenseForm((prev) => ({
        ...prev,
        prescription_id: "",
        items: [
          {
            id: `item-${Date.now()}`,
            medicine_name: "",
            dosage: "",
            duration: "",
            instructions: "",
            batch_id: "",
            quantity: 10,
            fulfillment: "CLINIC",
          },
        ],
      }));
      return;
    }

    const activeRx =
      patientPrescriptions.find((p) => String(p.id) === String(selRxId)) ||
      pharmacyPrescriptions.find((p) => String(p.id) === String(selRxId));

    if (activeRx) {
      const rxItems = buildItemsFromRx(activeRx, batches);
      setDispenseForm((prev) => ({
        ...prev,
        prescription_id: String(activeRx.id),
        patient_id: String(activeRx.patient_id || prev.patient_id),
        items: rxItems,
      }));
    } else {
      setDispenseForm((prev) => ({ ...prev, prescription_id: selRxId }));
    }
  };


  // Filter Handlers for Tab 1
  const handleFilterMedicines = async (
    q = searchMed,
    df = dosageFormFilter,
    ss = stockStatusFilter
  ) => {
    try {
      const data = await fetchMedicines({
        search: q,
        dosage_form: df !== "ALL" ? df : "",
        stock_status: ss !== "ALL" ? ss : "",
      });
      setMedicines(data || []);
    } catch (err) {
      showToast("Failed to filter medicines catalogue", "error");
    }
  };


  const handleClearMedFilters = () => {
    setSearchMed("");
    setDosageFormFilter("ALL");
    setStockStatusFilter("ALL");
    handleFilterMedicines("", "ALL", "ALL");
  };


  // Filter Handlers for Tab 2
  const handleFilterBatches = async (q = searchBatch, bs = batchStatusFilter) => {
    try {
      const data = await fetchBatches({
        search: q,
        status: bs !== "ALL" ? bs : "",
      });
      setBatches(data || []);
    } catch (err) {
      showToast("Failed to filter batches", "error");
    }
  };


  const handleClearBatchFilters = () => {
    setSearchBatch("");
    setBatchStatusFilter("ALL");
    handleFilterBatches("", "ALL");
  };


  // Filter Handlers for Tab 3
  const handleFilterTransactions = async (q = searchTxn, tt = txnTypeFilter) => {
    try {
      const data = await fetchInventoryTransactions({
        search: q,
        transaction_type: tt !== "ALL" ? tt : "",
      });
      setTransactions(data || []);
    } catch (err) {
      showToast("Failed to filter inventory audit log", "error");
    }
  };


  const handleClearTxnFilters = () => {
    setSearchTxn("");
    setTxnTypeFilter("ALL");
    handleFilterTransactions("", "ALL");
  };


  // Actions
  const handleCreateMedicine = async (e) => {
    e.preventDefault();
    try {
      await addMedicine(medForm);
      setIsAddMedOpen(false);
      setMedForm({
        code: "",
        name: "",
        generic_name: "",
        brand: "",
        dosage_form: "Tablet",
        strength: "500mg",
        reorder_level: 20,
        purchase_price: 30,
        selling_price: 50,
        tax_percent: 12,
      });
      loadData();
      showToast("Medicine added to catalogue successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to add medicine", "error");
    }
  };


  const handleOpenEditMed = (m) => {
    setEditingMed(m);
    setEditMedForm({
      code: m.code || "",
      name: m.name || "",
      generic_name: m.generic_name || "",
      brand: m.brand || "",
      dosage_form: m.dosage_form || "Tablet",
      strength: m.strength || "",
      reorder_level: m.reorder_level ?? 20,
      purchase_price: m.purchase_price ?? 30,
      selling_price: m.selling_price ?? 50,
      tax_percent: m.tax_percent ?? 12,
    });
    setIsEditMedOpen(true);
  };


  const handleUpdateMedicine = async (e) => {
    e.preventDefault();
    if (!editingMed) return;
    try {
      await updateMedicine(editingMed.id, editMedForm);
      setIsEditMedOpen(false);
      setEditingMed(null);
      await loadData();
      showToast("Medicine updated in catalogue successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to update medicine", "error");
    }
  };


  const handleOpenEditBatch = (b) => {
    setEditingBatch(b);
    setEditBatchForm({
      batch_number: b.batch_number || "",
      supplier_name: b.supplier_name || "",
      expiry_date: b.expiry_date || "",
      purchase_cost: b.purchase_cost ?? 0,
      selling_price: b.selling_price ?? 0,
      quantity_available: b.quantity_available ?? 0,
    });
    setIsEditBatchOpen(true);
  };


  const handleUpdateBatch = async (e) => {
    e.preventDefault();
    if (!editingBatch) return;
    try {
      await updateBatch(editingBatch.id, editBatchForm);
      setIsEditBatchOpen(false);
      setEditingBatch(null);
      await loadData();
      showToast("Batch details updated successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to update batch", "error");
    }
  };


  const handleGoodsReceipt = async (e) => {
    e.preventDefault();
    if (!grnForm.medicine_id) {
      showToast("Please select a medicine from catalogue", "error");
      return;
    }
    try {
      await recordGoodsReceipt({
        received_by: "Pharmacist",
        items: [
          {
            medicine_id: parseInt(grnForm.medicine_id),
            batch_number: grnForm.batch_number.trim().toUpperCase(),
            supplier_name: grnForm.supplier_name,
            expiry_date: grnForm.expiry_date,
            quantity: parseInt(grnForm.quantity),
            purchase_cost: parseFloat(grnForm.purchase_cost) || 0,
            selling_price: parseFloat(grnForm.selling_price) || 0,
          },
        ],
      });
      setIsGrnOpen(false);
      setGrnMedSearch("");
      loadData();
      showToast("Stock successfully received and added to dispensary inventory!", "success");
    } catch (err) {
      showToast(err.message || "Failed to receive goods", "error");
    }
  };


  const handleDispense = async (e) => {
    e.preventDefault();
    if (!dispenseForm.patient_id) {
      showToast("Please select a patient", "error");
      return;
    }
    if (!dispenseForm.items || dispenseForm.items.length === 0) {
      showToast("Please add at least one medicine to dispense", "error");
      return;
    }

    // Validate every item has a batch selected and valid positive quantity
    for (let i = 0; i < dispenseForm.items.length; i++) {
      const it = dispenseForm.items[i];
      if (!it.batch_id) {
        showToast(
          `Please select an active stock batch for Medicine #${i + 1} (${it.medicine_name || "Item"})`,
          "error"
        );
        return;
      }
      const qty = parseInt(it.quantity, 10);
      if (!qty || qty <= 0) {
        showToast(`Please enter a valid quantity (> 0) for Medicine #${i + 1}`, "error");
        return;
      }
      const batchObj = batches.find((b) => String(b.id) === String(it.batch_id));
      if (batchObj && qty > batchObj.quantity_available) {
        showToast(
          `Quantity ${qty} for Medicine #${i + 1} exceeds available stock (${batchObj.quantity_available}) in batch ${batchObj.batch_number}`,
          "error"
        );
        return;
      }
    }

    setDispensing(true);
    try {
      const totalAmount = (dispenseForm.items || []).reduce((acc, it) => {
        const b = batches.find((bat) => String(bat.id) === String(it.batch_id));
        return acc + (parseInt(it.quantity, 10) || 0) * (b ? (b.selling_price || 0) : 0);
      }, 0);

      const collectedAmount = dispenseForm.collect_payment
        ? (dispenseForm.amount_collected !== "" && dispenseForm.amount_collected !== undefined
            ? parseFloat(dispenseForm.amount_collected)
            : null)
        : 0;

      const res = await dispensePrescription({
        patient_id: parseInt(dispenseForm.patient_id),
        prescription_id: dispenseForm.prescription_id ? parseInt(dispenseForm.prescription_id) : null,
        dispensed_by: dispenseForm.dispensed_by,
        create_invoice: true,
        collect_payment: dispenseForm.collect_payment,
        payment_method: dispenseForm.payment_method || "Cash",
        payment_status: dispenseForm.collect_payment ? "PAID" : "PENDING",
        amount_collected: collectedAmount,
        transaction_ref: dispenseForm.transaction_ref || "",
        items: dispenseForm.items.map((it) => ({
          batch_id: parseInt(it.batch_id),
          quantity: parseInt(it.quantity),
        })),
      });

      handleCloseDispenseModal();
      loadData();
      showToast(
        res.invoice_number
          ? `Successfully dispensed ${dispenseForm.items.length} item(s)! Invoice #${res.invoice_number} generated (${dispenseForm.collect_payment ? `Collected ₹${collectedAmount}` : "Payment Pending"}).`
          : `Successfully dispensed ${dispenseForm.items.length} medicine(s)! Stock deducted.`,
        "success"
      );

      // Open receipt automatically if invoice was created
      if (res.invoice_id) {
        fetchInvoice(res.invoice_id)
          .then((inv) => setSelectedReceipt(inv))
          .catch((err) => console.warn("Failed to load invoice receipt:", err));
      }
    } catch (err) {
      showToast(err.message || "Dispensing failed", "error");
    } finally {
      setDispensing(false);
    }
  };


  const handleOpenCollectModal = (rx) => {
    if (!rx.invoice) return;
    setCollectTargetRx(rx);
    const balance = rx.invoice.balance_due > 0 ? rx.invoice.balance_due : rx.invoice.total;
    setCollectForm({
      amount: String(balance),
      payment_method: rx.invoice.payment_method || "Cash",
      cash_tendered: "",
      transaction_ref: "",
      notes: "",
    });
    setIsCollectModalOpen(true);
  };


  const handleConfirmCollectPayment = async (e) => {
    e.preventDefault();
    if (!collectTargetRx || !collectTargetRx.invoice) return;
    const amountNum = parseFloat(collectForm.amount);
    if (!amountNum || amountNum <= 0) {
      showToast("Please enter a valid payment amount (> 0)", "error");
      return;
    }

    setCollecting(true);
    try {
      const res = await recordInvoicePayment(collectTargetRx.invoice.id, {
        amount: amountNum,
        payment_method: collectForm.payment_method || "Cash",
        transaction_ref: collectForm.transaction_ref || "",
        received_by: "Sanjay Gupta (Pharmacist)",
        notes: collectForm.notes || "Collected at Pharmacy Dispensary counter",
      });
      showToast(res.message || `Payment of ₹${amountNum} recorded!`, "success");
      setIsCollectModalOpen(false);
      loadData();
      // Load and open receipt
      fetchInvoice(collectTargetRx.invoice.id)
        .then((inv) => setSelectedReceipt(inv))
        .catch(() => {});
    } catch (err) {
      showToast(err.message || "Failed to record payment", "error");
    } finally {
      setCollecting(false);
    }
  };


  const handleViewReceipt = async (invoiceId) => {
    try {
      const inv = await fetchInvoice(invoiceId);
      setSelectedReceipt(inv);
    } catch (err) {
      showToast(err.message || "Failed to fetch invoice details", "error");
    }
  };


  const handleSendReceiptWhatsApp = async (invoiceId) => {
    setSendingReceiptWhatsApp(true);
    try {
      const res = await sendInvoiceWhatsApp(invoiceId);
      showToast(res.message || "Dispensary receipt sent via WhatsApp!", "success");
    } catch (err) {
      showToast(err.message || "Failed to send WhatsApp receipt", "error");
    } finally {
      setSendingReceiptWhatsApp(false);
    }
  };


  const handleDownloadPdf = async (receipt) => {
    if (!receipt) return;
    setDownloadingPdf(true);
    try {
      const cleanPatient = (receipt.patient_name || "Patient").trim().replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
      const filename = `${cleanPatient}_Pharma_Bill_${receipt.invoice_number || "Receipt"}.pdf`;
      await downloadReceiptPdf(receipt.id, false, filename);
      showToast("PDF Receipt downloaded successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to download PDF receipt", "error");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrintPdf = async (receipt) => {
    if (!receipt) return;
    setPrintingPdf(true);
    try {
      await printReceiptPdf(receipt.id, false);
    } catch (err) {
      console.warn("Direct PDF print failed, falling back to window.print:", err);
      window.print();
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleDownloadReceipt = handleDownloadPdf;


  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Dispensary"
        title="Pharmacy & Medicine Inventory"
        icon={FiPackage}
        actionsBelowOnMobile={true}
        rightAction={
          <div className="lead-header-actions flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Pharmacy Data"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={handleOpenDispenseModal}
              className="portal-action-btn flex items-center justify-center gap-1.5 flex-1 sm:flex-initial"
            >
              <FiCheckCircle size={15} />
              <span>Dispense Rx</span>
            </button>
            <button
              onClick={() => setIsGrnOpen(true)}
              className="portal-action-btn flex items-center justify-center gap-1.5 flex-1 sm:flex-initial"
            >
              <FiPlus size={15} />
              <span className="hidden sm:inline">Receive Stock (GRN)</span>
              <span className="inline sm:hidden">Stock (GRN)</span>
            </button>
            <button
              onClick={() => setIsAddMedOpen(true)}
              className="portal-action-btn portal-action-btn-blue flex items-center justify-center gap-1.5 flex-1 sm:flex-initial"
            >
              <FiPlus size={15} />
              <span className="hidden sm:inline">Add Medicine</span>
              <span className="inline sm:hidden">Add Med</span>
            </button>
          </div>
        }
      />

      {/* 4-Card Executive KPI Grid (aerostate-lrs Reusable Grid - Driven by Server) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Awaiting Med Dispatch"
          value={pendingDispatchCount}
          Icon={FiPackage}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Dispensed & Fulfilled"
          value={dispensedDispatchCount}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Total Stock Units"
          value={stats?.total_stock_units ?? 0}
          Icon={FiLayers}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Low Stock Alert"
          value={alerts?.low_stock_count ?? stats?.low_stock_count ?? 0}
          Icon={FiAlertTriangle}
          colorTheme="brand-teal"
        />
      </div>

      {/* Expiry & Stock Alert Banners */}
      {alerts && (alerts.low_stock_count > 0 || alerts.expiry_alerts_count > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {alerts.low_stock_count > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900">
              <div className="flex items-center gap-2">
                <FiAlertTriangle className="text-amber-600 shrink-0" size={16} />
                <span>
                  <strong>{alerts.low_stock_count} item(s)</strong> below reorder threshold.
                </span>
              </div>
              <span className="font-bold underline cursor-pointer" onClick={() => setActiveTab("catalogue")}>
                Review Stock
              </span>
            </div>
          )}

          {alerts.expiry_alerts_count > 0 && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs text-rose-900">
              <div className="flex items-center gap-2">
                <FiClock className="text-rose-600 shrink-0" size={16} />
                <span>
                  <strong>{alerts.expiry_alerts_count} batch(es)</strong> near expiry (&lt; 90 days) or expired.
                </span>
              </div>
              <span className="font-bold underline cursor-pointer" onClick={() => setActiveTab("batches")}>
                View Batches
              </span>
            </div>
          )}
        </div>
      )}

      {/* Standard LRS Signature Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            activeTab === "pending"
              ? "Pending Medicine Dispatch Queue"
              : activeTab === "dispensed"
              ? "Dispensed & Fulfilled Prescriptions"
              : activeTab === "outside"
              ? "Outside Chemist Prescriptions"
              : activeTab === "batches"
              ? "Batch Inventory & Shelf-Life Management"
              : activeTab === "transactions"
              ? "Dispensary Movement & Audit Log"
              : "Dispensary Drug Catalogue"
          }
          description={
            activeTab === "pending"
              ? "Live clinical prescriptions requiring medicine packaging, batch deduction, and dispensary counter issue."
              : activeTab === "dispensed"
              ? "Verified dispensary record of issued medications, batch stock deductions, and settled prescriptions."
              : activeTab === "outside"
              ? "Prescriptions routed for external purchase from licensed retail chemist pharmacies."
              : activeTab === "batches"
              ? "Live pharmaceutical batch-level ledger linking physical supplier consignments with real-time dispensary stock and expiry locks."
              : activeTab === "transactions"
              ? "Cryptographically audited stock delta logs ensuring strict accountability and compliance across all pharmaceutical dispensing."
              : "Comprehensive pharmaceutical formulation specifications with side-by-side pricing, inventory levels, and stock alert indicators."
          }
          badgeCount={
            activeTab === "pending"
              ? pendingDispatchCount
              : activeTab === "dispensed"
              ? dispensedDispatchCount
              : activeTab === "outside"
              ? outsideDispatchCount
              : activeTab === "batches"
              ? batches.length
              : activeTab === "transactions"
              ? transactions.length
              : medicines.length
          }
          badgeLabel={
            activeTab === "pending"
              ? "awaiting dispatch"
              : activeTab === "dispensed"
              ? "dispensed"
              : activeTab === "outside"
              ? "outside chemist"
              : activeTab === "batches"
              ? "batches"
              : activeTab === "transactions"
              ? "movements"
              : "formulations"
          }
          subBadge={
            activeTab === "pending"
              ? `${pendingDispatchCount} Prescriptions to Fulfill`
              : activeTab === "dispensed"
              ? `${dispensedDispatchCount} Dispensed Prescriptions`
              : activeTab === "outside"
              ? `${outsideDispatchCount} External Retail`
              : activeTab === "batches"
              ? `${alerts?.expiry_alerts_count ?? stats?.expiry_alerts_count ?? 0} Near Expiry (< 90d)`
              : activeTab === "transactions"
              ? "Cryptographic Stock Ledger"
              : `${alerts?.low_stock_count ?? stats?.low_stock_count ?? 0} Low Stock Alert(s)`
          }
        />

        {/* UNIFIED TABS (All tabs arranged side by side in one single clean bar) */}
        <div className="wa-tabs-container">
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "pending" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("pending");
              setPageDispatch(1);
            }}
          >
            <FiCheckCircle size={15} />
            <span>Pending Dispatch ({pendingDispatchCount})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "dispensed" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("dispensed");
              setPageDispatch(1);
            }}
          >
            <FiCheck size={15} />
            <span>Dispensed &amp; Fulfilled ({dispensedDispatchCount})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "outside" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("outside");
              setPageDispatch(1);
            }}
          >
            <FiPackage size={15} />
            <span>Outside Chemist ({outsideDispatchCount})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "cancelled" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("cancelled");
              setPageDispatch(1);
            }}
          >
            <FiXCircle size={15} />
            <span>Cancelled ({cancelledDispatchCount})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "catalogue" ? "active" : ""}`}
            onClick={() => setActiveTab("catalogue")}
          >
            <FiLayers size={15} />
            <span>Drug Catalogue ({medicines.length})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "batches" ? "active" : ""}`}
            onClick={() => setActiveTab("batches")}
          >
            <FiClock size={15} />
            <span>Batch Stock &amp; Expiry ({batches.length})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "transactions" ? "active" : ""}`}
            onClick={() => setActiveTab("transactions")}
          >
            <FiFileText size={15} />
            <span>Inventory Audit Trail ({transactions.length})</span>
          </button>
        </div>

        {/* ======================================================== */}
        {/* PRIMARY MAIN SCREEN: Medicine Dispatch Queue             */}
        {/* ======================================================== */}
        {["pending", "dispensed", "outside"].includes(activeTab) && (
          <>
            {/* Dispatch Search & Date Controls */}
            <div className="dir-controls flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[280px]">
                <SearchBar
                  placeholder="Search dispatch queue by patient name, phone, doctor, Rx ID, or medicine..."
                  value={searchDispatch}
                  onChange={(e) => setSearchDispatch(e.target.value)}
                  onSearch={() => setPageDispatch(1)}
                  onClear={() => {
                    setSearchDispatch("");
                    setPageDispatch(1);
                  }}
                />
              </div>

              {/* Date Filters & Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Quick Date Selector Pills */}
                <div
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5"
                  style={{ height: "34px" }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDateDispatch("");
                      setPageDispatch(1);
                    }}
                    className={`transition cursor-pointer rounded-md font-medium ${
                      dateDispatch === ""
                        ? "bg-white text-slate-900 shadow-xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    style={{ fontSize: "12px", height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center" }}
                  >
                    All Dates
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDateDispatch(getTodayStr());
                      setPageDispatch(1);
                    }}
                    className={`transition cursor-pointer rounded-md font-medium ${
                      dateDispatch === getTodayStr()
                        ? "bg-[#254d90] text-white shadow-xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    style={{ fontSize: "12px", height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center" }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDateDispatch(getYesterdayStr());
                      setPageDispatch(1);
                    }}
                    className={`transition cursor-pointer rounded-md font-medium ${
                      dateDispatch === getYesterdayStr()
                        ? "bg-[#254d90] text-white shadow-xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    style={{ fontSize: "12px", height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center" }}
                  >
                    Yesterday
                  </button>
                </div>

                {/* Calendar Input */}
                <input
                  type="date"
                  value={dateDispatch}
                  onChange={(e) => {
                    setDateDispatch(e.target.value);
                    setPageDispatch(1);
                  }}
                  className="dir-filter-select"
                  style={{ height: "34px", fontSize: "12px", padding: "0 8px", minWidth: "135px" }}
                  title="Filter by Specific Date"
                />

                {/* Desktop View Switcher */}
                <div
                  className="hidden md:inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5"
                  style={{ height: "34px" }}
                >
                  <button
                    type="button"
                    onClick={() => setDesktopViewMode("table")}
                    className={`inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer ${
                      desktopViewMode === "table"
                        ? "bg-white text-slate-900 shadow-xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    style={{ height: "28px" }}
                    title="Spreadsheet List View"
                  >
                    <FiList size={13} />
                    <span>List View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDesktopViewMode("cards")}
                    className={`inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer ${
                      desktopViewMode === "cards"
                        ? "bg-[#254d90] text-white shadow-xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    style={{ height: "28px" }}
                    title="Responsive Cards View"
                  >
                    <FiGrid size={13} />
                    <span>Cards View</span>
                  </button>
                </div>
                {(searchDispatch || dateDispatch) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchDispatch("");
                      setDateDispatch("");
                      setPageDispatch(1);
                    }}
                    className="btn-cancel"
                    style={{ height: "34px", fontSize: "12px", padding: "0 12px" }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {loading && pharmacyPrescriptions.length === 0 ? (
              <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90] mx-auto"></div>
              </div>
            ) : filteredPrescriptions.length === 0 ? (
              <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
                <FiPackage className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h4 className="font-bold text-slate-800 text-sm">
                  {activeTab === "pending"
                    ? "No pending prescriptions waiting for medicine dispatch"
                    : activeTab === "dispensed"
                    ? "No dispensed prescriptions found"
                    : activeTab === "outside"
                    ? "No outside chemist prescriptions found"
                    : activeTab === "cancelled"
                    ? "No cancelled prescriptions found"
                    : "No prescriptions found matching your search"}
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Doctor prescriptions with in-house clinic medications automatically arrive here within 5 seconds.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                {desktopViewMode === "table" && (
                  <div className="dir-table-wrapper pharmacy-desktop-table hidden md:flex flex-col">
                <div className="dir-scroll-bar-header">
                  <span className="dir-scroll-hint">Prescription Medicine Dispatch Queue (Scroll horizontally to view all columns)</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-500">
                      Showing {paginatedDispatch.length} of {filteredPrescriptions.length} prescription{filteredPrescriptions.length === 1 ? "" : "s"}
                    </span>
                    <div className="dir-scroll-actions">
                      <button
                        type="button"
                        className="dir-scroll-arrow-btn"
                        onClick={handleScrollDispatchLeft}
                        title="Scroll Table Left"
                      >
                        <FiChevronLeft size={13} />
                        <span>Scroll Left</span>
                      </button>
                      <button
                        type="button"
                        className="dir-scroll-arrow-btn"
                        onClick={handleScrollDispatchRight}
                        title="Scroll Table Right"
                      >
                        <span>Scroll Right</span>
                        <FiChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  ref={dispatchTableRef}
                  className="data-grid-container"
                  style={{
                    border: "none",
                    borderRadius: 0,
                    boxShadow: "none",
                    overflowX: "auto",
                    WebkitOverflowScrolling: "touch",
                    width: "100%",
                    scrollBehavior: "smooth",
                  }}
                >
                  <table className="data-grid-table" style={{ minWidth: "1820px", width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "140px", minWidth: "140px" }}>PRESCRIPTION ID</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "165px", minWidth: "165px" }}>
                          DATE &amp; TIME
                        </th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "150px", minWidth: "150px" }}>PATIENT NAME</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "135px", minWidth: "135px" }}>PHONE NUMBER</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "150px", minWidth: "150px" }}>ATTENDING DOCTOR</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "160px", minWidth: "160px" }}>DIAGNOSIS</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "240px", minWidth: "240px" }}>PRESCRIBED MEDICINES</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "110px", minWidth: "110px" }}>TOTAL MEDS</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "130px", minWidth: "130px" }}>FULFILLMENT</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "150px", minWidth: "150px" }}>DISPATCH STATUS</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap", width: "160px", minWidth: "160px" }}>BILLING / PAYMENT</th>
                        <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap", width: "260px", minWidth: "260px", paddingRight: "16px" }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedDispatch.map((rx) => {
                        const meds = rx.medicines || [];
                        const clinicCount = rx.clinic_meds_count ?? meds.filter((m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC").length;
                        const outsideCount = rx.outside_meds_count ?? meds.filter((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE").length;
                        const isAllOutside = rx.fulfillment_type === "OUTSIDE" || (outsideCount > 0 && clinicCount === 0);

                        return (
                          <tr key={rx.id}>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                                {rx.prescription_uid || `#RX-${rx.id}`}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-mono font-medium text-slate-800">
                                {activeTab === "dispensed" ? (rx.dispensed_at || rx.created_at || "—") : (rx.created_at || "—")}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-bold text-slate-900">{rx.patient_name || "Patient"}</span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-mono text-slate-700">{rx.patient_phone || "—"}</span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-bold text-slate-900">{rx.doctor_name || "Doctor"}</span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-semibold text-slate-800">{rx.diagnosis || "—"}</span>
                            </td>
                            <td style={{ fontSize: "12px" }}>
                              <div className="flex flex-wrap gap-1 max-w-[320px]">
                                {meds && meds.length > 0 ? (
                                  meds.map((m, idx) => {
                                    const isOutside = (m.fulfillment || "").toUpperCase() === "OUTSIDE";
                                    return (
                                      <span
                                        key={idx}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold border ${
                                          isOutside
                                            ? "bg-amber-50 text-amber-900 border-amber-300"
                                            : "bg-slate-100 text-slate-800 border-slate-200"
                                        }`}
                                        style={{ fontSize: "11px" }}
                                        title={`${m.name} - ${m.dosage || "1-0-1"} (${m.duration || "5d"})`}
                                      >
                                        <span>{m.name}</span>
                                        {m.dosage && <span className="text-[9.5px] text-slate-500 font-normal">({m.dosage})</span>}
                                        {isOutside && (
                                          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100/90 px-1 rounded ml-0.5">
                                            Outside
                                          </span>
                                        )}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span className="text-slate-400 font-normal">—</span>
                                )}
                              </div>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              {clinicCount > 0 && outsideCount > 0 ? (
                                <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                                  <span className="text-[#1a56db] font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                    {clinicCount} Clinic
                                  </span>
                                  <span className="text-amber-800 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                    {outsideCount} Outside
                                  </span>
                                </div>
                              ) : outsideCount > 0 ? (
                                <span className="font-mono font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[11px]">
                                  {outsideCount} Outside
                                </span>
                              ) : (
                                <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                                  {clinicCount || meds.length} Clinic
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                                  rx.fulfillment_type === "HYBRID"
                                    ? "bg-teal-50 text-teal-700 border-teal-200"
                                    : rx.fulfillment_type === "OUTSIDE" || isAllOutside
                                    ? "bg-slate-100 text-slate-700 border-slate-300"
                                    : "bg-blue-50 text-blue-700 border-blue-200"
                                }`}
                              >
                                {rx.fulfillment_type === "HYBRID"
                                  ? "Hybrid Issue"
                                  : rx.fulfillment_type === "OUTSIDE" || isAllOutside
                                  ? "Outside Chemist"
                                  : "Clinic In-House"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              {rx.is_dispensed ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border text-[11px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span>Dispensed</span>
                                </span>
                              ) : isAllOutside ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border text-[11px] bg-slate-100 text-slate-700 border-slate-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                  <span>Outside Chemist</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border text-[11px] bg-amber-50 text-amber-700 border-amber-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span>Pending Dispense</span>
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              {rx.invoice ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-slate-900">
                                      ₹{rx.invoice.total.toLocaleString()}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                        rx.invoice.payment_status === "PAID"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : rx.invoice.payment_status === "PARTIALLY_PAID"
                                          ? "bg-blue-50 text-blue-700 border-blue-200"
                                          : "bg-amber-50 text-amber-700 border-amber-200"
                                      }`}
                                    >
                                      {rx.invoice.payment_status}
                                    </span>
                                  </div>
                                  <div className="text-[10.5px] text-slate-500 font-mono flex items-center gap-1">
                                    <span>{rx.invoice.invoice_number}</span>
                                    <span>•</span>
                                    <span>{rx.invoice.payment_method}</span>
                                  </div>
                                </div>
                              ) : rx.is_dispensed ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                  Direct Dispense
                                </span>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center w-max px-2 py-0.5 rounded text-[10.5px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                    Unbilled
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono">Billed on Dispense</span>
                                </div>
                              )}
                            </td>
                            <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap", width: "260px", minWidth: "260px", paddingRight: "16px" }}>
                              <div className="flex items-center justify-end gap-1.5 w-full">
                                {rx.is_cancelled || rx.status === "CANCELLED" ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                      <FiXCircle size={12} />
                                      <span>Cancelled</span>
                                    </span>
                                    {rx.cancellation_reason && (
                                      <span className="text-[10px] text-slate-500 italic max-w-[230px] text-right truncate block" title={rx.cancellation_reason}>
                                        Reason: {rx.cancellation_reason}
                                      </span>
                                    )}
                                  </div>
                                ) : !rx.is_dispensed && !isAllOutside ? (
                                  <div className="flex flex-col items-end gap-1.5 w-full">
                                    {/* Primary Action: Dispense & Collect */}
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDispenseForRx(rx)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#254d90] text-white hover:bg-[#1b396b] shadow-2xs transition cursor-pointer"
                                      title="Dispense medications and collect payment immediately at pharmacy counter"
                                    >
                                      <FiDollarSign size={13} />
                                      <span>Dispense &amp; Collect</span>
                                    </button>

                                    {/* Secondary Actions: Send to Frontdesk + Cancel */}
                                    <div className="flex items-center gap-1.5 justify-end">
                                      {rx.invoice ? (
                                        <span
                                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-bold rounded bg-blue-50 text-blue-700 border border-blue-200"
                                          title={`Billed at Front Desk (${rx.invoice.invoice_number})`}
                                        >
                                          <FiCheck size={11} />
                                          <span>Billed at Front Desk</span>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={sendingBillingId === rx.id}
                                          onClick={() => handleSendToFrontDesk(rx)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-600 hover:text-white transition cursor-pointer disabled:opacity-50"
                                          title="Send medication bill to Front Desk / Reception billing counter"
                                        >
                                          {sendingBillingId === rx.id ? (
                                            <span className="animate-spin text-xs">⌛</span>
                                          ) : (
                                            <FiSend size={11} />
                                          )}
                                          <span>Send to Frontdesk</span>
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => handleOpenCancelModal(rx)}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                                        title="Cancel prescription dispatch with mandatory reason"
                                      >
                                        <FiXCircle size={11} />
                                        <span>Cancel</span>
                                      </button>
                                    </div>
                                  </div>
                                ) : rx.is_dispensed ? (
                                  <div className="inline-flex items-center gap-1.5 justify-end">
                                    {rx.invoice && rx.invoice.payment_status !== "PAID" && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenCollectModal(rx)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs transition cursor-pointer"
                                        title="Collect pending pharmacy bill payment"
                                      >
                                        <FiDollarSign size={12} />
                                        <span>Collect ₹{rx.invoice.balance_due || rx.invoice.total}</span>
                                      </button>
                                    )}
                                    {rx.invoice ? (
                                      <button
                                        type="button"
                                        onClick={() => handleViewReceipt(rx.invoice.id)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition cursor-pointer shadow-2xs"
                                        title="View & Print Pharmacy Receipt / Invoice"
                                      >
                                        <FiFileText size={12} className="text-[#254d90]" />
                                        <span>Receipt</span>
                                      </button>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        <FiCheck size={12} />
                                        <span>Fulfilled</span>
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-300">
                                    Outside Chemist
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  currentPage={pageDispatch}
                  totalItems={filteredPrescriptions.length}
                  pageSize={pageSizeDispatch}
                  onPageChange={(p) => setPageDispatch(p)}
                  onPageSizeChange={(sz) => {
                    setPageSizeDispatch(sz);
                    setPageDispatch(1);
                  }}
                  pageSizeOptions={[10, 20, 50, "all"]}
                  itemLabel="prescriptions"
                />
              </div>
            )}

            {/* Mobile & Cards View */}
            <div className={`${desktopViewMode === "cards" ? "block" : "block md:hidden"} w-full space-y-3`}>
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold px-1 py-1">
                <span>Showing {paginatedDispatch.length} of {filteredPrescriptions.length} prescriptions</span>
                {dateDispatch && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[11px] font-bold">
                    Date: {dateDispatch}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {paginatedDispatch.map((rx) => {
                  const meds = rx.medicines || [];
                  const clinicCount = rx.clinic_meds_count ?? meds.filter((m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC").length;
                  const outsideCount = rx.outside_meds_count ?? meds.filter((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE").length;
                  const isAllOutside = rx.fulfillment_type === "OUTSIDE" || (outsideCount > 0 && clinicCount === 0);

                  return (
                    <div
                      key={rx.id}
                      className="bg-white rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all p-3.5 flex flex-col justify-between gap-3 text-slate-800"
                    >
                      {/* Top: Rx UID, Date, Fulfillment & Status */}
                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-bold text-xs text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                              {rx.prescription_uid || `#RX-${rx.id}`}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                rx.fulfillment_type === "HYBRID"
                                  ? "bg-teal-50 text-teal-700 border-teal-200"
                                  : rx.fulfillment_type === "OUTSIDE" || isAllOutside
                                  ? "bg-slate-100 text-slate-700 border-slate-300"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                              }`}
                            >
                              {rx.fulfillment_type === "HYBRID"
                                ? "Hybrid"
                                : rx.fulfillment_type === "OUTSIDE" || isAllOutside
                                ? "Outside"
                                : "Clinic"}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-1 font-mono">
                            <FiCalendar size={11} className="text-slate-400 shrink-0" />
                            <span>{activeTab === "dispensed" ? (rx.dispensed_at || rx.created_at || "—") : (rx.created_at || "—")}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          {rx.is_cancelled || rx.status === "CANCELLED" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <FiXCircle size={11} />
                              <span>Cancelled</span>
                            </span>
                          ) : rx.is_dispensed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border text-[10.5px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span>Dispensed</span>
                            </span>
                          ) : isAllOutside ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border text-[10.5px] bg-slate-100 text-slate-700 border-slate-300">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              <span>Outside</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border text-[10.5px] bg-amber-50 text-amber-700 border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span>Pending</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Patient, Phone & Doctor */}
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-sm truncate" title={rx.patient_name}>
                            {rx.patient_name || "Patient"}
                          </span>
                          {rx.patient_phone && (
                            <a
                              href={`tel:${rx.patient_phone}`}
                              className="inline-flex items-center gap-1 text-[11px] font-mono text-[#254d90] hover:text-[#1e3f78] bg-blue-50/60 hover:bg-blue-50 px-2 py-0.5 rounded transition shrink-0 ml-2"
                            >
                              <FiPhone size={10} />
                              <span>{rx.patient_phone}</span>
                            </a>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[11.5px] text-slate-600">
                          <div className="flex items-center gap-1 truncate">
                            <FiUser size={12} className="text-slate-400 shrink-0" />
                            <span className="font-medium text-slate-700 truncate">{rx.doctor_name || "Doctor"}</span>
                          </div>
                          {rx.diagnosis && (
                            <span className="text-slate-500 text-[11px] truncate max-w-[150px]" title={rx.diagnosis}>
                              {rx.diagnosis}
                            </span>
                          )}
                        </div>

                        {/* Medicines List */}
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 space-y-1">
                          <div className="flex items-center justify-between font-semibold text-[11px] text-slate-600">
                            <span>Prescribed Medicines</span>
                            <span className="font-mono text-slate-500">
                              {clinicCount > 0 && `${clinicCount} Clinic`}
                              {clinicCount > 0 && outsideCount > 0 && " • "}
                              {outsideCount > 0 && `${outsideCount} Outside`}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1 max-h-[85px] overflow-y-auto">
                            {meds && meds.length > 0 ? (
                              meds.map((m, idx) => {
                                const isOutside = (m.fulfillment || "").toUpperCase() === "OUTSIDE";
                                return (
                                  <span
                                    key={idx}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold border ${
                                      isOutside
                                        ? "bg-amber-50 text-amber-900 border-amber-300"
                                        : "bg-white text-slate-800 border-slate-200"
                                    }`}
                                    style={{ fontSize: "10.5px" }}
                                    title={`${m.name} - ${m.dosage || "1-0-1"} (${m.duration || "5d"})`}
                                  >
                                    <span>{m.name}</span>
                                    {m.dosage && <span className="text-[9px] text-slate-500 font-normal">({m.dosage})</span>}
                                    {isOutside && (
                                      <span className="text-[8.5px] font-bold uppercase text-amber-700 bg-amber-100 px-1 rounded">
                                        Out
                                      </span>
                                    )}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </div>
                        </div>

                        {/* Billing & Invoice Status */}
                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <span className="text-slate-500 font-medium">Billing / Payment:</span>
                          {rx.invoice ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900">
                                ₹{rx.invoice.total?.toLocaleString()}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                  rx.invoice.payment_status === "PAID"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : rx.invoice.payment_status === "PARTIALLY_PAID"
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                              >
                                {rx.invoice.payment_status}
                              </span>
                            </div>
                          ) : rx.is_dispensed ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              Direct Dispense
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              Unbilled (On Dispense)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                        {rx.is_cancelled || rx.status === "CANCELLED" ? (
                          <div className="w-full text-center py-1 text-xs text-rose-600 font-semibold bg-rose-50 rounded border border-rose-100">
                            Prescription Cancelled {rx.cancellation_reason ? `(${rx.cancellation_reason})` : ""}
                          </div>
                        ) : !rx.is_dispensed && !isAllOutside ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenDispenseForRx(rx)}
                              className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#254d90] text-white hover:bg-[#1b396b] shadow-2xs transition"
                            >
                              <FiDollarSign size={13} />
                              <span>Dispense &amp; Collect</span>
                            </button>

                            {rx.invoice ? (
                              <span
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-blue-50 text-blue-700 border border-blue-200"
                                title={`Billed at Front Desk (${rx.invoice.invoice_number})`}
                              >
                                <FiCheck size={11} />
                                <span>Frontdesk Billed</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={sendingBillingId === rx.id}
                                onClick={() => handleSendToFrontDesk(rx)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-600 hover:text-white transition disabled:opacity-50"
                              >
                                {sendingBillingId === rx.id ? (
                                  <span className="animate-spin text-xs">⌛</span>
                                ) : (
                                  <FiSend size={11} />
                                )}
                                <span>Send to Frontdesk</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenCancelModal(rx)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-600 hover:text-white transition"
                            >
                              <FiXCircle size={11} />
                              <span>Cancel</span>
                            </button>
                          </>
                        ) : rx.is_dispensed ? (
                          <div className="flex items-center gap-1.5 w-full justify-end">
                            {rx.invoice && rx.invoice.payment_status !== "PAID" && (
                              <button
                                type="button"
                                onClick={() => handleOpenCollectModal(rx)}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs transition"
                              >
                                <FiDollarSign size={12} />
                                <span>Collect ₹{rx.invoice.balance_due || rx.invoice.total}</span>
                              </button>
                            )}
                            {rx.invoice ? (
                              <button
                                type="button"
                                onClick={() => handleViewReceipt(rx.invoice.id)}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs transition"
                              >
                                <FiFileText size={12} className="text-[#254d90]" />
                                <span>Receipt</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <FiCheck size={12} />
                                <span>Fulfilled</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-300">
                            Outside Chemist
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mobile Pagination */}
              <Pagination
                currentPage={pageDispatch}
                totalItems={filteredPrescriptions.length}
                pageSize={pageSizeDispatch}
                onPageChange={(p) => setPageDispatch(p)}
                onPageSizeChange={(sz) => {
                  setPageSizeDispatch(sz);
                  setPageDispatch(1);
                }}
                pageSizeOptions={[10, 20, 50, "all"]}
                itemLabel="prescriptions"
              />
            </div>
          </>
        )}
          </>
        )}

        {/* ======================================================== */}
        {/* SECONDARY SECTION: Drug Catalogue (Formulation Specs)    */}
        {/* ======================================================== */}
        {activeTab === "catalogue" && (
          <>
            {/* Dispensary Roster Search & Filter Toolbar */}
          <div className="dir-controls">
            <SearchBar
              placeholder="Search by code, brand, commercial name, or molecule..."
              value={searchMed}
              onChange={(e) => setSearchMed(e.target.value)}
              onSearch={() => handleFilterMedicines(searchMed, dosageFormFilter, stockStatusFilter)}
              onClear={() => {
                setSearchMed("");
                handleFilterMedicines("", dosageFormFilter, stockStatusFilter);
              }}
            />

            <div className="dir-toolbar-right">
              <select
                value={dosageFormFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setDosageFormFilter(val);
                  handleFilterMedicines(searchMed, val, stockStatusFilter);
                }}
                className="dir-filter-select"
              >
                <option value="ALL">All Dosage Forms</option>
                {(pharmacyOptions?.dosage_forms || [
                  "Tablet",
                  "Capsule",
                  "Syrup",
                  "Injection",
                  "Ointment",
                  "Drops",
                ]).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>

              <select
                value={stockStatusFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setStockStatusFilter(val);
                  handleFilterMedicines(searchMed, dosageFormFilter, val);
                }}
                className="dir-filter-select"
              >
                <option value="ALL">All Stock Statuses</option>
                <option value="IN_STOCK">In Stock</option>
                <option value="LOW_STOCK">Low Stock</option>
                <option value="OUT_OF_STOCK">Out of Stock</option>
              </select>

              <button
                type="button"
                onClick={() => handleFilterMedicines(searchMed, dosageFormFilter, stockStatusFilter)}
                className="btn-submit"
                style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
              >
                Search
              </button>

              {(searchMed || dosageFormFilter !== "ALL" || stockStatusFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={handleClearMedFilters}
                  className="btn-cancel"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90] mx-auto"></div>
            </div>
          ) : medicines.length === 0 ? (
            <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
              <FiPackage className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">No medicines found in catalogue</h4>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your search criteria or register a new formulation.</p>
            </div>
          ) : (
            <div className="dir-table-wrapper">
              <div className="dir-scroll-bar-header">
                <span className="dir-scroll-hint">⇄ Master Drug Catalogue (Scroll horizontally to view all columns)</span>
                <span className="text-xs font-semibold text-slate-500">
                  Showing {paginatedMeds.length} of {medicines.length} catalogue item{medicines.length === 1 ? "" : "s"}
                </span>
              </div>
              <div
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
                <table className="data-grid-table" style={{ minWidth: "1450px", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CODE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MEDICINE NAME</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>BRAND</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>GENERIC MOLECULE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DOSAGE FORM</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STRENGTH</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PURCHASE PRICE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SELLING PRICE</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>REORDER LEVEL</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>AVAILABLE STOCK</th>
                      <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                      <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMeds.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                            {m.code}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold text-slate-900">{m.name}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-semibold text-slate-700">{m.brand || "—"}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-600 font-medium">{m.generic_name || "—"}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-700">{m.dosage_form}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-semibold text-slate-700">{m.strength}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-slate-600">₹{m.purchase_price}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold font-mono text-slate-900">₹{m.selling_price}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono text-slate-600">{m.reorder_level} units</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold font-mono text-slate-900">{m.total_stock} units</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold border ${
                              m.stock_status === "IN_STOCK"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : m.stock_status === "LOW_STOCK"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                            style={{ fontSize: "11px" }}
                          >
                            {m.stock_status.replace("_", " ")}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title={`Receive inward stock for ${m.name}`}
                              onClick={() => {
                                setGrnForm((prev) => ({ ...prev, medicine_id: String(m.id) }));
                                setIsGrnOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-[#254d90] bg-[#254d90]/10 hover:bg-[#254d90] hover:text-white border border-[#254d90]/20 transition cursor-pointer"
                            >
                              <FiPlus size={12} />
                              <span>+ Stock</span>
                            </button>
                            <button
                              type="button"
                              title={`Edit catalogue specs for ${m.name}`}
                              onClick={() => handleOpenEditMed(m)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-[#0a1120] hover:bg-[#1a2234] transition cursor-pointer"
                            >
                              <FiEdit2 size={12} />
                              <span>Edit</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            <Pagination
              currentPage={pageMed}
              totalItems={medicines.length}
              pageSize={pageSizeMed}
              onPageChange={(p) => setPageMed(p)}
              onPageSizeChange={(sz) => {
                setPageSizeMed(sz);
                setPageMed(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="medicines"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Comprehensive pharmaceutical formulation specifications with side-by-side pricing, inventory levels, and stock alert indicators.
              </span>
            </div>
          </div>
        )}
      </>
    )}

      {/* ======================================================== */}
      {/* Tab 2: Batch Stock & Expiry (Every field side by side)   */}
      {/* ======================================================== */}
      {activeTab === "batches" && (
        <>
          <div className="dir-controls">
            <SearchBar
              placeholder="Search batch number, supplier, or medicine..."
              value={searchBatch}
              onChange={(e) => setSearchBatch(e.target.value)}
              onSearch={() => handleFilterBatches(searchBatch, batchStatusFilter)}
              onClear={() => {
                setSearchBatch("");
                handleFilterBatches("", batchStatusFilter);
              }}
            />

            <div className="dir-toolbar-right">
              <select
                value={batchStatusFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setBatchStatusFilter(val);
                  handleFilterBatches(searchBatch, val);
                }}
                className="dir-filter-select"
              >
                <option value="ALL">All Batch Statuses</option>
                <option value="ACTIVE">Active &amp; Usable</option>
                <option value="EXPIRING_SOON">Expiring Soon (&lt; 90 days)</option>
                <option value="EXPIRED">Expired (Locked)</option>
              </select>

              <button
                type="button"
                onClick={() => handleFilterBatches(searchBatch, batchStatusFilter)}
                className="btn-submit"
                style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
              >
                Search
              </button>

              {(searchBatch || batchStatusFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={handleClearBatchFilters}
                  className="btn-cancel"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90] mx-auto"></div>
            </div>
          ) : batches.length === 0 ? (
            <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
              <FiClock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">No batch records found</h4>
              <p className="text-xs text-slate-500 mt-1">Receive inward shipments using GRN to populate batch inventory.</p>
            </div>
          ) : (
            <div className="dir-table-wrapper">
              <div className="dir-scroll-bar-header">
                <span className="dir-scroll-hint">⇄ Master Batch Stock &amp; Expiry (Scroll horizontally to view all columns)</span>
                <span className="text-xs font-semibold text-slate-500">
                  Showing {paginatedBatches.length} of {batches.length} stock batch{batches.length === 1 ? "" : "es"}
                </span>
              </div>
            <div
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
              <table className="data-grid-table" style={{ minWidth: "1300px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>BATCH NUMBER</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MEDICINE CODE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MEDICINE NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SUPPLIER ORIGIN</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>EXPIRY DATE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PURCHASE COST</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SELLING PRICE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>AVAILABLE QTY</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedBatches.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                          {b.batch_number}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-semibold text-slate-700">
                          {b.medicine_code || "—"}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-bold text-slate-900">{b.medicine_name}</span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-700 font-medium">{b.supplier_name || "—"}</span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-semibold text-slate-800">{b.expiry_date}</span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-slate-700">₹{b.purchase_cost}</span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-bold text-slate-900">₹{b.selling_price}</span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-bold font-mono text-slate-900">{b.quantity_available} units</span>
                      </td>
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-bold border ${
                            b.is_expired
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : b.is_near_expiry
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                          style={{ fontSize: "11px" }}
                        >
                          {b.status || (b.is_expired ? "EXPIRED (LOCKED)" : "ACTIVE")}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditBatch(b)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-[#0a1120] hover:bg-[#1a2234] transition cursor-pointer"
                            title={`Edit batch ${b.batch_number}`}
                          >
                            <FiEdit2 size={12} />
                            <span>Edit</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={pageBatch}
              totalItems={batches.length}
              pageSize={pageSizeBatch}
              onPageChange={(p) => setPageBatch(p)}
              onPageSizeChange={(sz) => {
                setPageSizeBatch(sz);
                setPageBatch(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="batches"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Live pharmaceutical batch-level ledger linking physical supplier consignments with real-time dispensary stock and expiry locks.
              </span>
            </div>
          </div>
        )}
      </>
    )}

      {/* ======================================================== */}
      {/* Tab 3: Inventory Audit Trail (Every field side by side) */}
      {/* ======================================================== */}
      {activeTab === "transactions" && (
        <>
          <div className="dir-controls">
            <SearchBar
              placeholder="Search by medicine, batch, recipient, or staff member..."
              value={searchTxn}
              onChange={(e) => setSearchTxn(e.target.value)}
              onSearch={() => handleFilterTransactions(searchTxn, txnTypeFilter)}
              onClear={() => {
                setSearchTxn("");
                handleFilterTransactions("", txnTypeFilter);
              }}
            />

            <div className="dir-toolbar-right">
              <select
                value={txnTypeFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setTxnTypeFilter(val);
                  handleFilterTransactions(searchTxn, val);
                }}
                className="dir-filter-select"
              >
                <option value="ALL">All Movement Types</option>
                <option value="GOODS_RECEIPT">Goods Receipt (GRN)</option>
                <option value="DISPENSED">Patient Dispensed</option>
                <option value="ADJUSTMENT">Stock Adjustment</option>
              </select>

              <button
                type="button"
                onClick={() => handleFilterTransactions(searchTxn, txnTypeFilter)}
                className="btn-submit"
                style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
              >
                Search
              </button>

              {(searchTxn || txnTypeFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={handleClearTxnFilters}
                  className="btn-cancel"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90] mx-auto"></div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
              <FiFileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">No transaction audit logs</h4>
              <p className="text-xs text-slate-500 mt-1">Dispensing and stock receiving actions generate permanent audit trails.</p>
            </div>
          ) : (
            <div className="dir-table-wrapper">
              <div className="dir-scroll-bar-header">
                <span className="dir-scroll-hint">⇄ Complete Dispensary Movement Ledger (Scroll horizontally to view all columns)</span>
                <span className="text-xs font-semibold text-slate-500">
                  Showing {paginatedTxns.length} of {transactions.length} recorded movement{transactions.length === 1 ? "" : "s"}
                </span>
              </div>
            <div
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
              <table className="data-grid-table" style={{ minWidth: "1200px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>TIMESTAMP</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MEDICINE NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MEDICINE CODE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>BATCH NUMBER</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MOVEMENT TYPE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>QTY CHANGED</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PERFORMED BY</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>AUDIT REASON</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-8 text-slate-500" style={{ fontSize: "12px" }}>
                        No transactions recorded matching the specified filter criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedTxns.map((t) => (
                      <tr key={t.id}>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-700 font-mono">
                            {t.created_at}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-bold text-slate-900">{t.medicine_name}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-semibold text-slate-700">
                            {t.medicine_code || "—"}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                            {t.batch_number}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold border ${
                              t.transaction_type === "GOODS_RECEIPT"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}
                            style={{ fontSize: "11px" }}
                          >
                            {t.transaction_type}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span
                            className={`font-bold font-mono ${
                              t.quantity > 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="font-semibold text-slate-800">{t.performed_by}</span>
                        </td>
                        <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                          <span className="text-slate-600">{t.reason || "—"}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={pageTxn}
              totalItems={transactions.length}
              pageSize={pageSizeTxn}
              onPageChange={(p) => setPageTxn(p)}
              onPageSizeChange={(sz) => {
                setPageSizeTxn(sz);
                setPageTxn(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="movements"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Cryptographically audited stock delta logs ensuring strict accountability and compliance across all pharmaceutical dispensing.
              </span>
            </div>
          </div>
        )}
      </>
    )}
      </section>

      {/* ======================================================== */}
      {/* Modal 1: Goods Receipt (GRN)                             */}
      {/* ======================================================== */}
      {isGrnOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "640px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Receive Stock (Goods Receipt)</h2>
                <div className="modal-kicker">Record inward shipment batch and update inventory</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => { setIsGrnOpen(false); setGrnMedSearch(""); }}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleGoodsReceipt} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div className="modal-body space-y-3.5" style={{ overflowY: "auto", maxHeight: "calc(92vh - 140px)", flex: 1 }}>
                {/* Searchable Medicine Selector */}
                {selectedGrnMed ? (
                  /* Selected Medicine Banner */
                  <div className="p-3 bg-blue-50/60 border border-blue-200/80 rounded-xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-xs"
                        style={{
                          width: "38px",
                          height: "38px",
                          fontSize: "14px",
                          background: "#254d90",
                        }}
                      >
                        {selectedGrnMed.name ? selectedGrnMed.name.charAt(0).toUpperCase() : "M"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm truncate">
                            {selectedGrnMed.name}
                          </span>
                          <span className="font-mono font-bold text-xs text-[#254d90] bg-white px-2 py-0.5 rounded border border-[#254d90]/30 shrink-0">
                            {selectedGrnMed.code || `MED-${selectedGrnMed.id}`}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-2 flex-wrap font-medium">
                          <span>{selectedGrnMed.dosage_form || "Medicine"} • {selectedGrnMed.strength || "Standard"}</span>
                          {selectedGrnMed.generic_name && (
                            <>
                              <span>•</span>
                              <span className="italic">{selectedGrnMed.generic_name}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setGrnForm((prev) => ({ ...prev, medicine_id: "" }));
                        setGrnMedSearch("");
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#254d90] bg-white hover:bg-[#254d90] hover:text-white border border-[#254d90]/30 transition shrink-0 cursor-pointer shadow-xs"
                    >
                      Change Medicine
                    </button>
                  </div>
                ) : (
                  /* Search Bar & Filtered Medicines List */
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700 block">
                        Select Medicine *
                      </label>
                      <span className="text-[11px] text-slate-500 font-medium">
                        {medicines.length} catalogue medicines
                      </span>
                    </div>

                    <div className="relative flex items-center">
                      <FiSearch className="absolute left-3 text-slate-400 pointer-events-none" size={15} />
                      <input
                        type="text"
                        placeholder="Search medicine by brand name, generic formula, or code..."
                        value={grnMedSearch}
                        onChange={(e) => setGrnMedSearch(e.target.value)}
                        style={{ paddingLeft: "34px", paddingRight: "32px", height: "40px" }}
                        className="w-full rounded-lg border border-slate-300 text-sm bg-white text-slate-900 focus:border-[#254d90] outline-none"
                      />
                      {grnMedSearch && (
                        <button
                          type="button"
                          onClick={() => setGrnMedSearch("")}
                          className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                        >
                          <FiX size={14} />
                        </button>
                      )}
                    </div>

                    {/* Dropdown list of matching medicines */}
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg mt-1.5 bg-white shadow-xs">
                      {filteredGrnMedicines.length === 0 ? (
                        <div className="p-3 text-center text-xs text-slate-500">
                          {grnMedSearch ? `No medicines matching "${grnMedSearch}"` : "No medicines in catalogue."}
                        </div>
                      ) : (
                        filteredGrnMedicines.map((m) => (
                          <div
                            key={m.id}
                            onClick={() => {
                              setGrnForm((prev) => ({
                                ...prev,
                                medicine_id: String(m.id),
                                purchase_cost: m.purchase_price !== undefined ? m.purchase_price : prev.purchase_cost,
                                selling_price: m.selling_price !== undefined ? m.selling_price : prev.selling_price,
                              }));
                              setGrnMedSearch("");
                            }}
                            className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="shrink-0 rounded-full flex items-center justify-center font-bold text-white"
                                style={{
                                  width: "30px",
                                  height: "30px",
                                  fontSize: "12px",
                                  background: "#254d90",
                                }}
                              >
                                {m.name ? m.name.charAt(0).toUpperCase() : "M"}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900 text-xs">{m.name}</span>
                                  <span className="font-mono font-bold text-[10px] text-[#254d90] bg-[#254d90]/10 px-1.5 py-0.2 rounded border border-[#254d90]/20">
                                    {m.code || `MED-${m.id}`}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  {m.dosage_form} • {m.strength} {m.generic_name ? `(${m.generic_name})` : ""}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="px-2.5 py-1 rounded text-xs font-semibold text-[#254d90] bg-blue-50 hover:bg-[#254d90] hover:text-white border border-blue-200 transition shrink-0 cursor-pointer"
                            >
                              Select
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Batch Number & Quantity */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Batch Number *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BN-AUG28-01"
                      value={grnForm.batch_number}
                      onChange={(e) => setGrnForm({ ...grnForm, batch_number: e.target.value })}
                      style={{ height: "40px" }}
                      className="font-mono font-bold"
                    />
                  </div>
                  <div className="form-group">
                    <label>Quantity Received *</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={grnForm.quantity}
                      onChange={(e) => setGrnForm({ ...grnForm, quantity: e.target.value })}
                      style={{ height: "40px" }}
                      className="font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Unit Purchase Cost & Selling Price */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Purchase Cost per Unit (₹) *</label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                        <FaRupeeSign size={12} />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="e.g. 30"
                        value={grnForm.purchase_cost}
                        onChange={(e) => setGrnForm({ ...grnForm, purchase_cost: e.target.value })}
                        style={{ paddingLeft: "32px", height: "40px" }}
                        className="font-mono font-bold text-sm w-full rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Selling Price / MRP per Unit (₹) *</label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                        <FaRupeeSign size={12} />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="e.g. 50"
                        value={grnForm.selling_price}
                        onChange={(e) => setGrnForm({ ...grnForm, selling_price: e.target.value })}
                        style={{ paddingLeft: "32px", height: "40px" }}
                        className="font-mono font-bold text-sm w-full rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Expiry Date & Supplier Name */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Expiry Date *</label>
                    <input
                      type="date"
                      required
                      value={grnForm.expiry_date}
                      onChange={(e) => setGrnForm({ ...grnForm, expiry_date: e.target.value })}
                      style={{ height: "40px" }}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Supplier Name</label>
                    <input
                      type="text"
                      list="supplier-options"
                      placeholder="e.g. AeroHealth Pharma Distributors"
                      value={grnForm.supplier_name}
                      onChange={(e) => setGrnForm({ ...grnForm, supplier_name: e.target.value })}
                      style={{ height: "40px" }}
                    />
                    <datalist id="supplier-options">
                      {(pharmacyOptions?.suppliers || [
                        "AeroHealth Pharma Distributors",
                        "Medico Supplies Ltd",
                        "Apex Pharma Solutions",
                        "Sun Medical Distributors",
                      ]).map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Total Value Summary Chip */}
                {grnForm.quantity && grnForm.purchase_cost ? (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">Estimated Inward Batch Valuation:</span>
                    <span className="font-mono font-bold text-[#254d90] text-sm inline-flex items-center gap-0.5">
                      <FaRupeeSign size={12} />
                      <span>{((parseFloat(grnForm.quantity) || 0) * (parseFloat(grnForm.purchase_cost) || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </span>
                  </div>
                ) : null}

                {/* Clinical / Audit Info Note */}
                <div className="info-box-note flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FiInfo size={15} style={{ flexShrink: 0 }} className="text-[#254d90]" />
                    <span>Received stock batches are immediately available for clinical prescription fulfillment and OPD counter dispatch.</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => { setIsGrnOpen(false); setGrnMedSearch(""); }}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} className="shrink-0" />
                  <span>Confirm &amp; Receive Stock</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal 2: Dispense Prescription                           */}
      {/* ======================================================== */}
      {isDispenseOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "760px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Dispense Medicine</h2>
                <div className="modal-kicker">Fulfill prescriptions &amp; clinical dispensary dispatch</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={handleCloseDispenseModal}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleDispense} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(92vh - 140px)" }}>
                {/* Patient Selection & Optional Prescription Linkage */}
                <div className="space-y-3 mb-4">
                  {selectedDispensePatient ? (
                    /* Selected Patient Banner */
                    <div className="p-3 bg-blue-50/60 border border-blue-200/80 rounded-xl flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-xs"
                          style={{
                            width: "38px",
                            height: "38px",
                            fontSize: "14px",
                            background: "#254d90",
                          }}
                        >
                          {selectedDispensePatient.name ? selectedDispensePatient.name.charAt(0).toUpperCase() : "P"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm truncate">
                              {selectedDispensePatient.name}
                            </span>
                            <span className="font-mono font-bold text-xs text-[#254d90] bg-white px-2 py-0.5 rounded border border-[#254d90]/30 shrink-0">
                              {selectedDispensePatient.patient_uid || `PAT-${String(selectedDispensePatient.id).padStart(4, "0")}`}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-2 flex-wrap font-medium">
                            <span>{selectedDispensePatient.phone_display || selectedDispensePatient.phone}</span>
                            {(selectedDispensePatient.gender || selectedDispensePatient.age) && (
                              <>
                                <span>•</span>
                                <span>{[selectedDispensePatient.gender, selectedDispensePatient.age ? `${selectedDispensePatient.age} yrs` : null].filter(Boolean).join(", ")}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDispenseForm({
                            ...dispenseForm,
                            patient_id: "",
                            prescription_id: "",
                            items: [
                              {
                                id: `item-${Date.now()}`,
                                medicine_name: "",
                                dosage: "",
                                duration: "",
                                instructions: "",
                                batch_id: "",
                                quantity: 10,
                                fulfillment: "CLINIC",
                              },
                            ],
                          });
                          setDispensePatientSearch("");
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#254d90] bg-white hover:bg-[#254d90] hover:text-white border border-[#254d90]/30 transition shrink-0 cursor-pointer shadow-xs"
                      >
                        Change Patient
                      </button>
                    </div>
                  ) : (
                    /* Searchable Patient Input & Results List */
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 block">
                          Select Patient *
                        </label>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {patients.length} registered patients
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <FiSearch className="absolute left-3 text-slate-400 pointer-events-none" size={15} />
                        <input
                          type="text"
                          placeholder="Search patient by name, mobile, or PAT UID..."
                          value={dispensePatientSearch}
                          onChange={(e) => setDispensePatientSearch(e.target.value)}
                          style={{ paddingLeft: "34px", paddingRight: "32px", height: "40px" }}
                          className="w-full rounded-lg border border-slate-300 text-sm bg-white text-slate-900 focus:border-[#254d90] outline-none"
                        />
                        {dispensePatientSearch && (
                          <button
                            type="button"
                            onClick={() => setDispensePatientSearch("")}
                            className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                          >
                            <FiX size={14} />
                          </button>
                        )}
                      </div>

                      {/* Dropdown list of matching patients */}
                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg mt-1.5 bg-white shadow-xs">
                        {filteredDispensePatients.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-500">
                            {dispensePatientSearch ? `No registered patients matching "${dispensePatientSearch}"` : "No patients found in directory."}
                          </div>
                        ) : (
                          filteredDispensePatients.map((p) => (
                            <div
                              key={p.id}
                              onClick={() => {
                                setDispenseForm({
                                  ...dispenseForm,
                                  patient_id: String(p.id),
                                  prescription_id: "",
                                  items: [
                                    {
                                      id: `item-${Date.now()}`,
                                      medicine_name: "",
                                      dosage: "",
                                      duration: "",
                                      instructions: "",
                                      batch_id: "",
                                      quantity: 10,
                                      fulfillment: "CLINIC",
                                    },
                                  ],
                                });
                                setDispensePatientSearch("");
                              }}
                              className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className="shrink-0 rounded-full flex items-center justify-center font-bold text-white"
                                  style={{
                                    width: "30px",
                                    height: "30px",
                                    fontSize: "12px",
                                    background: "#254d90",
                                  }}
                                >
                                  {p.name ? p.name.charAt(0).toUpperCase() : "P"}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-slate-900 text-xs">{p.name}</span>
                                    <span className="font-mono font-bold text-[10px] text-[#254d90] bg-[#254d90]/10 px-1.5 py-0.2 rounded border border-[#254d90]/20">
                                      {p.patient_uid || `PAT-${String(p.id).padStart(4, "0")}`}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    {p.phone}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="px-2.5 py-1 rounded text-xs font-semibold text-[#254d90] bg-blue-50 hover:bg-[#254d90] hover:text-white border border-blue-200 transition shrink-0 cursor-pointer"
                              >
                                Select
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Prescription Linkage */}
                  <div className="form-group mb-0">
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Fulfill Prescription (Optional)
                      {patientPrescriptions.length > 0 && (
                        <span className="ml-1.5 font-semibold text-[#254d90]">
                          ({patientPrescriptions.length} active prescription{patientPrescriptions.length > 1 ? "s" : ""} found)
                        </span>
                      )}
                    </label>
                    <select
                      value={dispenseForm.prescription_id || ""}
                      onChange={(e) => handlePrescriptionChange(e.target.value)}
                      disabled={!dispenseForm.patient_id}
                      style={{ height: "40px" }}
                      className="w-full rounded-lg border border-slate-300 text-xs font-medium text-slate-800 bg-white focus:border-[#254d90] outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">-- Direct / Walk-in Dispense --</option>
                      {patientPrescriptions.map((rx) => {
                        const tag = rx.fulfillment_type === "HYBRID"
                          ? ` (Split: ${rx.clinic_meds_count || 0} Clinic + ${rx.outside_meds_count || 0} Outside)`
                          : rx.fulfillment_type === "OUTSIDE"
                          ? " (Outside Chemist)"
                          : "";
                        return (
                          <option key={rx.id} value={rx.id}>
                            {rx.prescription_uid} ({rx.diagnosis}) — {rx.status}{tag}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Active Prescription Summary Card */}
                {dispenseForm.prescription_id && (() => {
                  const activeRx =
                    patientPrescriptions.find((p) => String(p.id) === String(dispenseForm.prescription_id)) ||
                    pharmacyPrescriptions.find((p) => String(p.id) === String(dispenseForm.prescription_id));
                  if (!activeRx) return null;

                  const outsideMeds = (activeRx.outside_meds && activeRx.outside_meds.length > 0)
                    ? activeRx.outside_meds
                    : (activeRx.medicines || []).filter((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE");

                  return (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5 my-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Prescription Details</span>
                        <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {activeRx.prescription_uid || `#RX-${activeRx.id}`}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 font-medium">
                        Doctor: <strong className="text-slate-800">{activeRx.doctor_name || "Doctor"}</strong> • Diagnosis: <strong className="text-slate-800">{activeRx.diagnosis || "—"}</strong>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 mb-1.5">Prescribed Medicines ({activeRx.medicines?.length || 0}):</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(activeRx.medicines || []).map((m, idx) => {
                            const isOut = (m.fulfillment || "").toUpperCase() === "OUTSIDE";
                            return (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 text-xs font-medium bg-white text-slate-800"
                              >
                                <span>{m.name}</span>
                                {m.dosage && <span className="text-slate-500 font-normal">({m.dosage})</span>}
                                {isOut ? (
                                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Outside</span>
                                ) : (
                                  <span className="text-[10px] font-bold text-[#254d90] bg-blue-50 px-1.5 py-0.5 rounded">Clinic</span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      {outsideMeds.length > 0 && (
                        <div className="text-xs text-slate-600 bg-white px-2.5 py-1.5 rounded border border-slate-200 font-medium">
                          {outsideMeds.length} medicine(s) marked for Outside Chemist have been omitted from clinic dispatch.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Medicines To Dispense */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Medicines to Dispense ({dispenseForm.items.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="px-3 py-1.5 text-xs font-bold text-[#254d90] bg-[#254d90]/10 hover:bg-[#254d90]/20 rounded-lg cursor-pointer transition flex items-center gap-1.5"
                    >
                      <FiPlus size={14} />
                      <span>Add Medicine</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {dispenseForm.items.map((item, idx) => {
                      const activeBatches = batches.filter((b) => !b.is_expired && b.quantity_available > 0);
                      const cleanMedName = (item.medicine_name || "")
                        .toLowerCase()
                        .replace(/\d+(\.\d+)?\s*(mg|g|ml|mcg|iu)/gi, "")
                        .trim();

                      const matchingBatches = activeBatches.filter((b) => {
                        if (!cleanMedName) return false;
                        const bName = (b.medicine_name || "").toLowerCase();
                        return bName.includes(cleanMedName) || cleanMedName.includes(bName);
                      });

                      const otherBatches = activeBatches.filter(
                        (b) => !matchingBatches.some((mb) => mb.id === b.id)
                      );

                      const selectedBatch = batches.find((b) => String(b.id) === String(item.batch_id));
                      const lineTotal = selectedBatch
                        ? (parseInt(item.quantity, 10) || 0) * (selectedBatch.selling_price || 0)
                        : 0;

                      return (
                        <div
                          key={item.id || idx}
                          className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
                        >
                          {/* Item Header */}
                          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#254d90] text-white text-xs font-bold shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-sm font-bold text-slate-900 truncate max-w-[320px]">
                                {item.medicine_name || `Medicine Item #${idx + 1}`}
                              </span>
                              {item.dosage && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-200 text-slate-700">
                                  {item.dosage}
                                </span>
                              )}
                              {item.duration && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-200 text-slate-700">
                                  {item.duration}
                                </span>
                              )}
                              {item.instructions && (
                                <span className="text-xs text-slate-500 font-medium">
                                  • {item.instructions}
                                </span>
                              )}
                            </div>

                            {/* Delete Button */}
                            <button
                              type="button"
                              disabled={dispenseForm.items.length <= 1}
                              onClick={() => handleRemoveItem(idx)}
                              className={`p-1.5 rounded-lg border transition ${
                                dispenseForm.items.length <= 1
                                  ? "text-slate-300 border-transparent bg-transparent cursor-not-allowed"
                                  : "text-slate-500 hover:text-red-600 bg-white hover:bg-red-50 border-slate-200 hover:border-red-200 cursor-pointer"
                              }`}
                              title={
                                dispenseForm.items.length <= 1
                                  ? "At least one medicine item is required"
                                  : "Remove this medicine item"
                              }
                            >
                              <FiTrash2 size={14} />
                            </button>
                          </div>

                          {/* Fields: Batch Selector + Qty */}
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                            <div className="md:col-span-8 flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                                <span>Select Batch *</span>
                                {selectedBatch && (
                                  <span className="text-xs text-emerald-800 font-mono font-bold">
                                    Stock: {selectedBatch.quantity_available} units
                                  </span>
                                )}
                              </label>
                              <select
                                required
                                value={item.batch_id}
                                onChange={(e) => handleBatchSelect(idx, e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 bg-white focus:border-[#254d90] outline-none"
                                style={{ height: "40px" }}
                              >
                                <option value="">-- Choose Stock Batch --</option>
                                {matchingBatches.length > 0 && (
                                  <optgroup label="Matching Clinic Stock">
                                    {matchingBatches.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.medicine_name} | Batch: {b.batch_number} (Exp: {b.expiry_date}, Avail: {b.quantity_available})
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label={matchingBatches.length > 0 ? "All Other Batches" : "All Available Batches"}>
                                  {otherBatches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.medicine_name} | Batch: {b.batch_number} (Exp: {b.expiry_date}, Avail: {b.quantity_available})
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>

                            <div className="md:col-span-4 flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                                <span>Quantity *</span>
                                {selectedBatch && (
                                  <span className="text-xs text-slate-600 font-mono font-semibold inline-flex items-center gap-0.5">
                                    <FaRupeeSign size={10} />
                                    <span>{selectedBatch.selling_price || 0}/ea</span>
                                  </span>
                                )}
                              </label>
                              <input
                                type="number"
                                required
                                min={1}
                                max={selectedBatch ? selectedBatch.quantity_available : 9999}
                                value={item.quantity}
                                onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 bg-white focus:border-[#254d90] outline-none text-center"
                                style={{ height: "40px" }}
                              />
                            </div>
                          </div>

                          {/* Warning Banner */}
                          {!item.batch_id && matchingBatches.length === 0 && (
                            <div className="px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center gap-2">
                              <FiAlertTriangle size={15} className="shrink-0 text-amber-600" />
                              <span>No exact matching batch found in clinic stock. Please select an available alternative batch from the dropdown or remove this item.</span>
                            </div>
                          )}

                          {/* Line summary */}
                          {selectedBatch && (
                            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200 text-slate-600 font-medium">
                              <span className="inline-flex items-center gap-1">
                                Unit Price: <strong className="font-mono text-slate-900 inline-flex items-center"><FaRupeeSign size={10} />{selectedBatch.selling_price || 0}</strong>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                Line Total: <strong className="text-[#254d90] font-mono font-bold text-sm inline-flex items-center"><FaRupeeSign size={11} />{lineTotal.toLocaleString("en-IN")}</strong>
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Overall Dispense Summary Bar */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs text-slate-700">
                    <div className="flex items-center gap-5">
                      <span>Total Items: <strong className="text-slate-900 font-mono font-bold text-sm">{dispenseForm.items.length}</strong></span>
                      <span>Total Units: <strong className="text-slate-900 font-mono font-bold text-sm">{dispenseForm.items.reduce((acc, it) => acc + (parseInt(it.quantity, 10) || 0), 0)}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-600 font-medium">Estimated Total:</span>
                      <span className="text-[#254d90] font-mono font-extrabold text-base inline-flex items-center gap-0.5">
                        <FaRupeeSign size={13} />
                        <span>{dispenseForm.items.reduce((acc, it) => {
                          const b = batches.find((bat) => String(bat.id) === String(it.batch_id));
                          return acc + (parseInt(it.quantity, 10) || 0) * (b ? (b.selling_price || 0) : 0);
                        }, 0).toLocaleString("en-IN")}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Money Collection Panel in Dispense Modal */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-[#254d90] text-white shrink-0">
                        <FiDollarSign size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          Payment Collection at Dispensary
                        </div>
                        <div className="text-xs text-slate-500 font-normal">
                          Collect payment directly at the pharmacy counter
                        </div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <span className="text-xs font-semibold text-slate-800">Collect Payment</span>
                      <input
                        type="checkbox"
                        checked={dispenseForm.collect_payment}
                        onChange={(e) => setDispenseForm({ ...dispenseForm, collect_payment: e.target.checked })}
                        className="cursor-pointer accent-[#254d90]"
                        style={{ width: "16px", height: "16px" }}
                      />
                    </label>
                  </div>

                  {dispenseForm.collect_payment ? (
                    <div className="space-y-3 pt-2.5 border-t border-slate-200 animate-in fade-in duration-150">
                      {/* Payment Methods */}
                      <div>
                        <label className="text-xs font-bold text-slate-700 block mb-1.5">
                          Payment Method *
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                          {["Cash", "UPI", "Card", "Net Banking"].map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setDispenseForm({ ...dispenseForm, payment_method: mode })}
                              className={`py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer text-center h-10 flex items-center justify-center ${
                                dispenseForm.payment_method === mode
                                  ? "bg-[#254d90] text-white border-[#254d90] shadow-xs"
                                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                              }`}
                            >
                              {mode === "UPI" ? "UPI / QR" : mode}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Amount to Collect */}
                        <div>
                          <label className="text-xs font-bold text-slate-700 block mb-1.5">
                            Amount to Collect (₹) *
                          </label>
                          <div className="relative flex items-center">
                            <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                              <FaRupeeSign size={12} />
                            </div>
                            <input
                              type="number"
                              min="0"
                              placeholder={String(estimatedDispenseTotal)}
                              value={dispenseForm.amount_collected !== "" && dispenseForm.amount_collected !== undefined ? dispenseForm.amount_collected : estimatedDispenseTotal}
                              onChange={(e) => setDispenseForm({ ...dispenseForm, amount_collected: e.target.value })}
                              style={{ paddingLeft: "34px", height: "40px" }}
                              className="w-full pr-3 py-2 rounded-lg border border-slate-300 text-sm font-bold font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                            />
                          </div>
                        </div>

                        {/* If Cash: Cash Received & Change Return Calculator */}
                        {dispenseForm.payment_method === "Cash" ? (
                          <div>
                            <label className="text-xs font-bold text-slate-700 block mb-1.5">
                              Cash Received &amp; Change Calculator
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="relative flex items-center">
                                <div className="absolute left-2.5 flex items-center pointer-events-none text-slate-400">
                                  <FaRupeeSign size={11} />
                                </div>
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="Amount received"
                                  value={dispenseForm.cash_tendered || ""}
                                  onChange={(e) => setDispenseForm({ ...dispenseForm, cash_tendered: e.target.value })}
                                  style={{ paddingLeft: "30px", height: "40px" }}
                                  className="w-full pr-2 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold bg-white text-slate-900 focus:border-[#254d90] outline-none"
                                />
                              </div>
                              <div className="px-3 py-2 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs font-mono text-emerald-900 flex items-center justify-between h-10">
                                <span className="font-sans font-medium text-emerald-800 text-xs">Change:</span>
                                <span className="font-bold text-sm text-emerald-900 inline-flex items-center gap-0.5">
                                  <FaRupeeSign size={11} />
                                  <span>{Math.max(0, (parseFloat(dispenseForm.cash_tendered) || 0) - (parseFloat(dispenseForm.amount_collected !== "" && dispenseForm.amount_collected !== undefined ? dispenseForm.amount_collected : estimatedDispenseTotal) || 0)).toLocaleString("en-IN")}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Transaction Reference for UPI / Card */
                          <div>
                            <label className="text-xs font-bold text-slate-700 block mb-1.5">
                              Transaction / UTR Reference
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. GPay / PhonePe UTR / Auth Code"
                              value={dispenseForm.transaction_ref || ""}
                              onChange={(e) => setDispenseForm({ ...dispenseForm, transaction_ref: e.target.value })}
                              style={{ height: "40px", paddingLeft: "12px", paddingRight: "12px" }}
                              className="w-full py-2 rounded-lg border border-slate-300 text-xs font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs font-medium text-amber-900 flex items-center justify-between">
                      <span>Invoice will be generated as <strong>PENDING</strong> for payment at central billing counter.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={handleCloseDispenseModal}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dispensing}
                  className="btn-submit"
                >
                  <FiCheck size={14} className="shrink-0" />
                  <span>
                    {dispensing
                      ? "Processing..."
                      : dispenseForm.collect_payment
                      ? `Dispense & Collect ₹${(dispenseForm.amount_collected !== "" && dispenseForm.amount_collected !== undefined ? dispenseForm.amount_collected : estimatedDispenseTotal).toLocaleString()}`
                      : "Dispense Meds (Pay Later)"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal 3: Add Medicine to Catalogue                       */}
      {/* ======================================================== */}
      {isAddMedOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "640px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Add Medicine to Catalogue</h2>
                <div className="modal-kicker">Register pharmaceutical product and pricing</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsAddMedOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateMedicine} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div className="modal-body space-y-3.5" style={{ overflowY: "auto", maxHeight: "calc(92vh - 140px)", flex: 1 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Medicine Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. MED-007"
                      value={medForm.code}
                      onChange={(e) => setMedForm({ ...medForm, code: e.target.value.toUpperCase() })}
                      style={{ height: "40px" }}
                      className="font-mono font-bold"
                    />
                  </div>
                  <div className="form-group">
                    <label>Brand Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Augmentin"
                      value={medForm.brand}
                      onChange={(e) => setMedForm({ ...medForm, brand: e.target.value })}
                      style={{ height: "40px" }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Commercial Medicine Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Amoxicillin & Potassium Clavulanate"
                    value={medForm.name}
                    onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
                    style={{ height: "40px" }}
                    className="font-medium"
                  />
                </div>

                <div className="form-group">
                  <label>Generic Molecule / Formula</label>
                  <input
                    type="text"
                    placeholder="e.g. Amoxicillin 500mg + Potassium Clavulanate 125mg"
                    value={medForm.generic_name}
                    onChange={(e) => setMedForm({ ...medForm, generic_name: e.target.value })}
                    style={{ height: "40px" }}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Dosage Form</label>
                    <select
                      value={medForm.dosage_form}
                      onChange={(e) => setMedForm({ ...medForm, dosage_form: e.target.value })}
                      style={{ height: "40px" }}
                    >
                      {(pharmacyOptions?.dosage_forms || [
                        "Tablet",
                        "Capsule",
                        "Syrup",
                        "Injection",
                        "Ointment",
                        "Drops",
                        "Inhaler",
                        "Suspension",
                        "Gel",
                        "Powder",
                      ]).map((df) => (
                        <option key={df} value={df}>
                          {df}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Strength</label>
                    <input
                      type="text"
                      placeholder="e.g. 625mg"
                      value={medForm.strength}
                      onChange={(e) => setMedForm({ ...medForm, strength: e.target.value })}
                      style={{ height: "40px" }}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Purchase Price (₹)</label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                        <FaRupeeSign size={12} />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={medForm.purchase_price}
                        onChange={(e) => setMedForm({ ...medForm, purchase_price: parseFloat(e.target.value) || 0 })}
                        style={{ paddingLeft: "32px", height: "40px" }}
                        className="font-mono font-bold text-sm w-full rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Selling Price / MRP (₹)</label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                        <FaRupeeSign size={12} />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={medForm.selling_price}
                        onChange={(e) => setMedForm({ ...medForm, selling_price: parseFloat(e.target.value) || 0 })}
                        style={{ paddingLeft: "32px", height: "40px" }}
                        className="font-mono font-bold text-sm w-full rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Gross Margin Preview */}
                {medForm.selling_price > 0 && (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">Estimated Gross Margin / Unit:</span>
                    <span className="font-mono font-bold text-[#254d90] text-sm inline-flex items-center gap-0.5">
                      <FaRupeeSign size={12} />
                      <span>{(medForm.selling_price - medForm.purchase_price).toFixed(2)}</span>
                      <span className="text-xs text-slate-500 font-normal ml-1">
                        ({medForm.purchase_price > 0 ? (((medForm.selling_price - medForm.purchase_price) / medForm.purchase_price) * 100).toFixed(0) : 100}%)
                      </span>
                    </span>
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label>Reorder Level (units)</label>
                    <input
                      type="number"
                      min={0}
                      value={medForm.reorder_level}
                      onChange={(e) => setMedForm({ ...medForm, reorder_level: parseInt(e.target.value) || 0 })}
                      style={{ height: "40px" }}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Tax Rate (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={medForm.tax_percent}
                      onChange={(e) => setMedForm({ ...medForm, tax_percent: parseInt(e.target.value) || 0 })}
                      style={{ height: "40px" }}
                      className="font-mono"
                    />
                  </div>
                </div>

                {/* Clinical / Catalogue Info Note */}
                <div className="info-box-note flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FiInfo size={15} style={{ flexShrink: 0 }} className="text-[#254d90]" />
                    <span>Newly registered medicines appear immediately in the clinic dispensary catalogue and doctor prescription templates.</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAddMedOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} className="shrink-0" />
                  <span>Save Medicine</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal 4: Edit Medicine in Catalogue                      */}
      {/* ======================================================== */}
      {isEditMedOpen && editingMed && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "640px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Edit Medicine</h2>
                <div className="modal-kicker">Update catalogue specifications, formulations, and pricing</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsEditMedOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateMedicine} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div className="modal-body space-y-3.5" style={{ overflowY: "auto", maxHeight: "calc(92vh - 140px)", flex: 1 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Medicine Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. MED-007"
                      value={editMedForm.code}
                      onChange={(e) => setEditMedForm({ ...editMedForm, code: e.target.value.toUpperCase() })}
                      style={{ height: "40px" }}
                      className="font-mono font-bold"
                    />
                  </div>
                  <div className="form-group">
                    <label>Brand Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Augmentin"
                      value={editMedForm.brand}
                      onChange={(e) => setEditMedForm({ ...editMedForm, brand: e.target.value })}
                      style={{ height: "40px" }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Commercial Medicine Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Amoxicillin & Potassium Clavulanate"
                    value={editMedForm.name}
                    onChange={(e) => setEditMedForm({ ...editMedForm, name: e.target.value })}
                    style={{ height: "40px" }}
                    className="font-medium"
                  />
                </div>

                <div className="form-group">
                  <label>Generic Molecule / Formula</label>
                  <input
                    type="text"
                    placeholder="e.g. Amoxicillin 500mg + Potassium Clavulanate 125mg"
                    value={editMedForm.generic_name}
                    onChange={(e) => setEditMedForm({ ...editMedForm, generic_name: e.target.value })}
                    style={{ height: "40px" }}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Dosage Form</label>
                    <select
                      value={editMedForm.dosage_form}
                      onChange={(e) => setEditMedForm({ ...editMedForm, dosage_form: e.target.value })}
                      style={{ height: "40px" }}
                    >
                      {(pharmacyOptions?.dosage_forms || [
                        "Tablet",
                        "Capsule",
                        "Syrup",
                        "Injection",
                        "Ointment",
                        "Drops",
                        "Inhaler",
                        "Suspension",
                        "Gel",
                        "Powder",
                      ]).map((df) => (
                        <option key={df} value={df}>
                          {df}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Strength</label>
                    <input
                      type="text"
                      placeholder="e.g. 625mg"
                      value={editMedForm.strength}
                      onChange={(e) => setEditMedForm({ ...editMedForm, strength: e.target.value })}
                      style={{ height: "40px" }}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Purchase Price (₹)</label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                        <FaRupeeSign size={12} />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={editMedForm.purchase_price}
                        onChange={(e) => setEditMedForm({ ...editMedForm, purchase_price: parseFloat(e.target.value) || 0 })}
                        style={{ paddingLeft: "32px", height: "40px" }}
                        className="font-mono font-bold text-sm w-full rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Selling Price / MRP (₹)</label>
                    <div className="relative flex items-center">
                      <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
                        <FaRupeeSign size={12} />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={editMedForm.selling_price}
                        onChange={(e) => setEditMedForm({ ...editMedForm, selling_price: parseFloat(e.target.value) || 0 })}
                        style={{ paddingLeft: "32px", height: "40px" }}
                        className="font-mono font-bold text-sm w-full rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Gross Margin Preview */}
                {editMedForm.selling_price > 0 && (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">Estimated Gross Margin / Unit:</span>
                    <span className="font-mono font-bold text-[#254d90] text-sm inline-flex items-center gap-0.5">
                      <FaRupeeSign size={12} />
                      <span>{(editMedForm.selling_price - editMedForm.purchase_price).toFixed(2)}</span>
                      <span className="text-xs text-slate-500 font-normal ml-1">
                        ({editMedForm.purchase_price > 0 ? (((editMedForm.selling_price - editMedForm.purchase_price) / editMedForm.purchase_price) * 100).toFixed(0) : 100}%)
                      </span>
                    </span>
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label>Reorder Level (units)</label>
                    <input
                      type="number"
                      min={0}
                      value={editMedForm.reorder_level}
                      onChange={(e) => setEditMedForm({ ...editMedForm, reorder_level: parseInt(e.target.value) || 0 })}
                      style={{ height: "40px" }}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Tax Rate (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editMedForm.tax_percent}
                      onChange={(e) => setEditMedForm({ ...editMedForm, tax_percent: parseInt(e.target.value) || 0 })}
                      style={{ height: "40px" }}
                      className="font-mono"
                    />
                  </div>
                </div>

                {/* Clinical / Catalogue Info Note */}
                <div className="info-box-note flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FiInfo size={15} style={{ flexShrink: 0 }} className="text-[#254d90]" />
                    <span>Modifications to catalogue specifications update standard prescribing options and dispensary records.</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsEditMedOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} className="shrink-0" />
                  <span>Update Medicine</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal 5: Edit Batch Stock                                */}
      {/* ======================================================== */}
      {isEditBatchOpen && editingBatch && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Edit Batch Stock</h2>
                <div className="modal-kicker">
                  Adjust batch lifecycle, supplier, pricing, or stock count for {editingBatch.medicine_name}
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsEditBatchOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateBatch} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>Batch Number *</label>
                    <input
                      type="text"
                      required
                      value={editBatchForm.batch_number}
                      onChange={(e) => setEditBatchForm({ ...editBatchForm, batch_number: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Expiry Date *</label>
                    <input
                      type="date"
                      required
                      value={editBatchForm.expiry_date}
                      onChange={(e) => setEditBatchForm({ ...editBatchForm, expiry_date: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Supplier Name</label>
                  <input
                    type="text"
                    list="supplier-options-edit"
                    value={editBatchForm.supplier_name}
                    onChange={(e) => setEditBatchForm({ ...editBatchForm, supplier_name: e.target.value })}
                  />
                  <datalist id="supplier-options-edit">
                    {(pharmacyOptions?.suppliers || [
                      "AeroHealth Pharma Distributors",
                      "Medico Supplies Ltd",
                      "Apex Pharma Solutions",
                      "Sun Medical Distributors",
                    ]).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>

                <div className="form-group">
                  <label>Available Stock (Units) *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editBatchForm.quantity_available}
                    onChange={(e) => setEditBatchForm({ ...editBatchForm, quantity_available: parseInt(e.target.value) || 0 })}
                    className="font-mono"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Modifying available stock creates an automatic ADJUSTMENT inventory log entry.
                  </span>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Purchase Cost (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={editBatchForm.purchase_cost}
                      onChange={(e) => setEditBatchForm({ ...editBatchForm, purchase_cost: parseInt(e.target.value) || 0 })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Selling Price (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={editBatchForm.selling_price}
                      onChange={(e) => setEditBatchForm({ ...editBatchForm, selling_price: parseInt(e.target.value) || 0 })}
                      className="font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsEditBatchOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>Update Batch</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal: Collect Pharmacy Payment                           */}
      {/* ======================================================== */}
      {isCollectModalOpen && collectTargetRx && collectTargetRx.invoice && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Collect Pharmacy Payment</h2>
                <div className="modal-kicker">Dispensary counter collection &amp; instant receipt</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsCollectModalOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmCollectPayment} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body space-y-3.5">
                {/* Summary Info */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Invoice:</span>
                    <span className="font-mono font-bold text-slate-900">{collectTargetRx.invoice.invoice_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Patient:</span>
                    <span className="font-bold text-slate-900">{collectTargetRx.patient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Billed:</span>
                    <span className="font-bold text-slate-900 font-mono">₹{collectTargetRx.invoice.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-700 font-semibold">Balance Due:</span>
                    <span className="font-bold text-emerald-700 font-mono text-sm">
                      ₹{(collectTargetRx.invoice.balance_due || collectTargetRx.invoice.total).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Payment Methods */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Payment Method *
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {["Cash", "UPI", "Card", "Net Banking"].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCollectForm({ ...collectForm, payment_method: mode })}
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition cursor-pointer text-center ${
                          collectForm.payment_method === mode
                            ? "bg-[#254d90] text-white border-[#254d90] shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {mode === "UPI" ? "UPI / QR" : mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount to Collect */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Amount to Collect (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={collectForm.amount}
                    onChange={(e) => setCollectForm({ ...collectForm, amount: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-bold font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                  />
                </div>

                {/* If Cash: Tendered & Change Matching Sections */}
                {collectForm.payment_method === "Cash" ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                        Cash Tendered (₹)
                      </label>
                      <div className="flex items-center w-full rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:border-[#254d90] focus-within:ring-1 focus-within:ring-[#254d90] transition" style={{ height: "40px" }}>
                        <span className="px-3 bg-slate-50 border-r border-slate-200 text-slate-600 font-mono font-bold text-sm h-full flex items-center justify-center select-none shrink-0">
                          ₹
                        </span>
                        <input
                          type="number"
                          min="0"
                          placeholder="e.g. 500"
                          value={collectForm.cash_tendered || ""}
                          onChange={(e) => setCollectForm({ ...collectForm, cash_tendered: e.target.value })}
                          className="!border-none !outline-none !shadow-none !h-full !px-3 text-sm font-bold font-mono text-slate-900 bg-transparent w-full"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                        Change to Return (₹)
                      </label>
                      {(() => {
                        const changeAmount = Math.max(
                          0,
                          (parseFloat(collectForm.cash_tendered) || 0) - (parseFloat(collectForm.amount) || 0)
                        );
                        return (
                          <div
                            className={`w-full px-3 rounded-lg border text-sm font-bold font-mono flex items-center justify-between transition ${
                              changeAmount > 0
                                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                : "bg-slate-50 border-slate-200 text-slate-500"
                            }`}
                            style={{ height: "40px" }}
                          >
                            <span className="text-xs font-medium font-sans">
                              {changeAmount > 0 ? "Return:" : "Change:"}
                            </span>
                            <span className={`text-sm font-bold font-mono ${changeAmount > 0 ? "text-emerald-700" : "text-slate-700"}`}>
                              ₹{changeAmount.toLocaleString()}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Transaction / UTR Reference (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. GPay / PhonePe UTR / Auth Code"
                      value={collectForm.transaction_ref || ""}
                      onChange={(e) => setCollectForm({ ...collectForm, transaction_ref: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsCollectModalOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={collecting}
                  className="btn-submit"
                  style={{ background: "#254d90" }}
                >
                  <FiCheckCircle size={14} />
                  <span>{collecting ? "Processing..." : `Confirm Payment (₹${collectForm.amount})`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal: Pharmacy Dispensary Receipt                       */}
      {/* ======================================================== */}
      {selectedReceipt && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "600px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Dispensary Receipt &amp; Invoice</h2>
                <div className="modal-kicker">{selectedReceipt.invoice_number}</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedReceipt(null)}
              >
                <FiX size={18} />
              </button>
            </div>

            <div id="printable-receipt" className="modal-body printable-receipt space-y-4">
              {/* Receipt Header Banner */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <div className="font-extrabold text-sm text-slate-900">{clinicSettings?.clinic_name || "Aerostate Speciality Clinic"}</div>
                  <div className="text-[11px] text-slate-500">{clinicSettings?.clinic_tagline || "Pharmacy & Dispensary Counter"}</div>
                  {clinicSettings?.clinic_address && (
                    <div className="text-[10px] text-slate-400 mt-0.5">{clinicSettings.clinic_address} • Phone: {clinicSettings.clinic_phone || ""}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-slate-800">{selectedReceipt.invoice_number}</div>
                  <div className={`font-bold text-[11px] ${selectedReceipt.payment_status === "PAID" ? "text-emerald-700" : "text-amber-700"}`}>
                    {selectedReceipt.payment_status} ({selectedReceipt.payment_method})
                  </div>
                </div>
              </div>

              {/* Patient info */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-white border border-slate-200 rounded-lg text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Patient Details</span>
                  <strong className="text-slate-900 text-sm block">{selectedReceipt.patient_name || "Valued Patient"}</strong>
                  <span className="text-slate-500 font-mono">{selectedReceipt.patient_phone || "—"}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Date &amp; Time</span>
                  <div className="font-medium text-slate-700">{selectedReceipt.created_date_display || new Date().toLocaleDateString("en-IN")}</div>
                </div>
              </div>

              {/* Medicines Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="p-2.5">MEDICINE ITEM</th>
                      <th className="p-2.5 text-center">QTY</th>
                      <th className="p-2.5 text-right">PRICE</th>
                      <th className="p-2.5 text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.isArray(selectedReceipt.items) ? (
                      selectedReceipt.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-medium text-slate-800">
                            {it.name || it.medicine_name || `Medicine Item #${idx + 1}`}
                          </td>
                          <td className="p-2.5 text-center font-mono">{it.quantity || 1}</td>
                          <td className="p-2.5 text-right font-mono">₹{(it.unit_price || it.price || 0).toLocaleString()}</td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                            ₹{(it.total || (it.quantity || 1) * (it.unit_price || it.price || 0)).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="p-2.5 text-center text-slate-400">Prescription Medicines</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono">₹{(selectedReceipt.subtotal || selectedReceipt.total || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Total Amount:</span>
                  <span className="font-mono text-base text-[#254d90]">₹{(selectedReceipt.total || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-700 font-medium pt-1">
                  <span>Amount Paid:</span>
                  <span className="font-mono font-bold text-emerald-700">₹{(selectedReceipt.amount_paid || 0).toLocaleString()}</span>
                </div>
                {selectedReceipt.balance_due > 0 && (
                  <div className="flex justify-between text-amber-800 font-bold">
                    <span>Balance Due:</span>
                    <span className="font-mono">₹{(selectedReceipt.balance_due || 0).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer flex items-center justify-end gap-2 bg-slate-50 p-3 rounded-b-xl border-t border-slate-200 no-print">
              <button
                type="button"
                onClick={() => handleSendReceiptWhatsApp(selectedReceipt.id)}
                disabled={sendingReceiptWhatsApp}
                className="h-9 px-3.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Send receipt to patient via WhatsApp"
              >
                <FiSend size={13} />
                <span>{sendingReceiptWhatsApp ? "Sending..." : "WhatsApp"}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintPdf(selectedReceipt)}
                disabled={printingPdf}
                className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Print Receipt"
              >
                <FiPrinter size={13} />
                <span>{printingPdf ? "Printing..." : "Print"}</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadPdf(selectedReceipt)}
                disabled={downloadingPdf}
                className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Download Receipt PDF"
              >
                <FiDownload size={13} />
                <span>{downloadingPdf ? "Downloading..." : "Download"}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="h-9 px-4 rounded-lg text-xs font-semibold bg-slate-200/80 hover:bg-slate-300 text-slate-700 transition cursor-pointer border border-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal: Cancel Prescription Dispatch (Mandatory Reason)    */}
      {/* ======================================================== */}
      {isCancelModalOpen && selectedRxToCancel && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "520px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header border-b border-rose-100 bg-rose-50/50 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <FiAlertTriangle size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Cancel Prescription Dispatch</h2>
                  <div className="modal-kicker text-rose-600 font-mono text-xs">
                    {selectedRxToCancel.prescription_uid || `#RX-${selectedRxToCancel.id}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !cancellingRx && setIsCancelModalOpen(false)}
                className="modal-close"
                disabled={cancellingRx}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmCancel}>
              <div className="p-5 space-y-4">
                {/* Prescription Info Box */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Patient:</span>
                    <span className="font-bold text-slate-800">{selectedRxToCancel.patient_name || "Patient"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Doctor:</span>
                    <span className="font-semibold text-slate-700">{selectedRxToCancel.doctor_name || "Doctor"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Diagnosis:</span>
                    <span className="text-slate-700 font-medium">{selectedRxToCancel.diagnosis || "—"}</span>
                  </div>
                  {selectedRxToCancel.medicines && selectedRxToCancel.medicines.length > 0 && (
                    <div className="flex justify-between pt-1 border-t border-slate-200/80">
                      <span className="text-slate-500 font-medium">Medications:</span>
                      <span className="font-mono text-slate-700 text-right max-w-[280px] truncate">
                        {selectedRxToCancel.medicines.map((m) => m.name).join(", ")}
                      </span>
                    </div>
                  )}
                </div>

                {/* Notice */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800 flex items-start gap-2">
                  <FiAlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Cancelling this prescription removes it from the active dispensary queue. Any unpaid invoice forwarded to Front Desk will be cancelled automatically.
                  </span>
                </div>

                {/* Mandatory Cancellation Reason */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1.5">
                    Reason for Cancellation <span className="text-rose-600">* (Required)</span>
                  </label>

                  {/* Quick Select Chips */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {QUICK_CANCEL_REASONS.map((reason, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setCancellationReason(reason)}
                        className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition cursor-pointer ${
                          cancellationReason === reason
                            ? "bg-rose-50 text-rose-700 border-rose-300 ring-1 ring-rose-200"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={3}
                    required
                    value={cancellationReason}
                    onChange={(e) => setCancellationReason(e.target.value)}
                    placeholder="Provide the exact clinical or operational reason for cancelling this prescription dispatch..."
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  />
                  {!cancellationReason.trim() && (
                    <p className="text-[10.5px] text-rose-500 mt-1 font-medium">
                      * Cancellation reason is necessary to proceed.
                    </p>
                  )}
                </div>
              </div>

              <div className="modal-footer flex items-center justify-end gap-2 bg-slate-50 p-3 rounded-b-xl border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCancelModalOpen(false)}
                  disabled={cancellingRx}
                  className="btn-cancel text-xs px-3 py-1.5"
                >
                  Keep Prescription
                </button>
                <button
                  type="submit"
                  disabled={cancellingRx || !cancellationReason.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <FiXCircle size={14} />
                  <span>{cancellingRx ? "Cancelling..." : "Confirm Cancellation"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
