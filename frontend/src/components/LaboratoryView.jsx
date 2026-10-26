import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FiFileText,
  FiSearch,
  FiPlus,
  FiCheckCircle,
  FiPrinter,
  FiX,
  FiAlertCircle,
  FiFilter,
  FiActivity,
  FiLayers,
  FiRotateCw,
  FiCheck,
  FiDollarSign,
  FiShield,
  FiClock,
  FiEdit2,
  FiEdit3,
  FiTrash2,
  FiSend,
  FiDownload,
  FiDroplet,
  FiSettings,
  FiLock,
  FiUser,
  FiCalendar,
  FiChevronLeft,
  FiChevronRight,
  FiExternalLink,
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchLabOrders,
  fetchLabOrder,
  createLabOrder,
  fetchLabTests,
  fetchLabStats,
  fetchLabOptions,
  addLabTest,
  updateLabTest,
  deleteLabTest,
  fetchLabCategories,
  createLabCategory,
  deleteLabCategory,
  fetchLabSampleTypes,
  createLabSampleType,
  deleteLabSampleType,
  updateSampleStatus,
  recordLabResults,
  verifyLabOrder,
  fetchPatients,
  fetchDoctors,
  collectLabOrderPayment,
  resetLabOrderPayment,
  fetchInvoice,
  sendInvoiceWhatsApp,
  downloadReceiptPdf,
  printReceiptPdf,
  fetchSettings
} from "../api";

export default function LaboratoryView() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [tests, setTests] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [stats, setStats] = useState(null);
  const [labOptions, setLabOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("pending"); // "pending", "complete", or "catalogue"

  // Filter orders into Pending and Complete lists
  const pendingOrders = useMemo(() => {
    let list = orders.filter((o) => o.status !== "COMPLETED");
    if (statusFilter) {
      list = list.filter((o) => o.status === statusFilter);
    }
    return list;
  }, [orders, statusFilter]);

  const completedOrders = useMemo(() => {
    return orders.filter((o) => o.status === "COMPLETED");
  }, [orders]);

  const currentTabOrders = useMemo(() => {
    if (activeTab === "pending") return pendingOrders;
    if (activeTab === "complete") return completedOrders;
    return orders;
  }, [activeTab, pendingOrders, completedOrders, orders]);

  // Pagination for Queue (20 entries per page default from LRS)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Table Horizontal Scroll Controls
  const tableContainerRef = useRef(null);

  const handleScrollLeft = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: -400, behavior: "smooth" });
    }
  };

  const handleScrollRight = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollBy({ left: 400, behavior: "smooth" });
    }
  };

  const paginatedOrders = useMemo(() => {
    if (pageSize === "all") return currentTabOrders;
    const start = (currentPage - 1) * pageSize;
    return currentTabOrders.slice(start, start + pageSize);
  }, [currentTabOrders, currentPage, pageSize]);

  // Test Catalogue Filters & Pagination (matching Send Notification layout)
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [cataloguePage, setCataloguePage] = useState(1);
  const [cataloguePageSize, setCataloguePageSize] = useState(20);

  // Backend Diagnostic Categories Management
  const [backendCategories, setBackendCategories] = useState([]);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [newCatInput, setNewCatInput] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  // Delete Category Security Password Modal
  const [isDeletePasswordModalOpen, setIsDeletePasswordModalOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteReassignTo, setDeleteReassignTo] = useState("General Diagnostics");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [deletingCategory, setDeletingCategory] = useState(false);

  // Backend Diagnostic Sample Types Management
  const [backendSampleTypes, setBackendSampleTypes] = useState([]);
  const [isSampleTypeManagerOpen, setIsSampleTypeManagerOpen] = useState(false);
  const [newSampleTypeInput, setNewSampleTypeInput] = useState("");
  const [addingSampleType, setAddingSampleType] = useState(false);

  // Delete Sample Type Security Password Modal
  const [isDeleteSampleTypePasswordModalOpen, setIsDeleteSampleTypePasswordModalOpen] = useState(false);
  const [sampleTypeToDelete, setSampleTypeToDelete] = useState(null);
  const [deleteSampleTypePassword, setDeleteSampleTypePassword] = useState("");
  const [deleteSampleTypeReassignTo, setDeleteSampleTypeReassignTo] = useState("EDTA Whole Blood");
  const [deleteSampleTypePasswordError, setDeleteSampleTypePasswordError] = useState("");
  const [deletingSampleType, setDeletingSampleType] = useState(false);

  const categories = useMemo(() => {
    const list = backendCategories.map((c) => c.name).filter(Boolean);
    const testCats = tests.map((t) => t.category).filter(Boolean);
    const combined = Array.from(new Set([...list, ...testCats].map((s) => s.trim()))).filter(Boolean);
    return ["All", ...combined];
  }, [backendCategories, tests]);

  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      const matchCat = selectedCategory === "All" || t.category === selectedCategory;
      const q = catalogueSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        t.name?.toLowerCase().includes(q) ||
        t.test_code?.toLowerCase().includes(q) ||
        t.sample_type?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [tests, selectedCategory, catalogueSearch]);

  const paginatedTests = useMemo(() => {
    if (cataloguePageSize === "all") return filteredTests;
    const start = (cataloguePage - 1) * cataloguePageSize;
    return filteredTests.slice(start, start + cataloguePageSize);
  }, [filteredTests, cataloguePage, cataloguePageSize]);

  // Order Detail & Result Entry Modal
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [resultEdits, setResultEdits] = useState([]);
  const [techName, setTechName] = useState("Sunita Rawat (MLT)");
  const [savingResults, setSavingResults] = useState(false);

  // Add Test to Catalogue Modal
  const [isAddTestOpen, setIsAddTestOpen] = useState(false);
  const [addCustomCatMode, setAddCustomCatMode] = useState(false);
  const [addCustomSampleMode, setAddCustomSampleMode] = useState(false);
  const [testForm, setTestForm] = useState({
    test_code: "",
    name: "",
    category: "Hematology",
    sample_type: "EDTA Whole Blood",
    tat_hours: 24,
    price: 500,
    reference_range: "",
    units: "",
    description: "",
  });

  // Edit Test in Catalogue Modal
  const [isEditTestOpen, setIsEditTestOpen] = useState(false);
  const [editingTestId, setEditingTestId] = useState(null);
  const [editCustomCatMode, setEditCustomCatMode] = useState(false);
  const [editCustomSampleMode, setEditCustomSampleMode] = useState(false);
  const [editTestForm, setEditTestForm] = useState({
    test_code: "",
    name: "",
    category: "Hematology",
    sample_type: "EDTA Whole Blood",
    tat_hours: 24,
    price: 500,
    reference_range: "",
    units: "",
    description: "",
  });

  // Dynamic available categories and sample types (combining backend categories, options, and test additions)
  const availableCategories = useMemo(() => {
    const backendList = backendCategories.map((c) => c.name).filter(Boolean);
    const optionsList = labOptions?.categories || [
      "Hematology",
      "Biochemistry",
      "Microbiology",
      "Clinical Pathology",
      "Serology & Immunology",
      "Radiology & Imaging",
      "Urinalysis",
      "Molecular Biology",
      "Histopathology",
      "Cytology",
      "Endocrinology",
      "Cardiology Diagnostics",
      "General Diagnostics",
    ];
    const testCats = tests.map((t) => t.category).filter(Boolean);
    return Array.from(new Set([...backendList, ...optionsList, ...testCats].map((s) => s.trim()))).filter(Boolean);
  }, [backendCategories, labOptions, tests]);

  const availableSampleTypes = useMemo(() => {
    const backendList = backendSampleTypes.map((s) => s.name).filter(Boolean);
    const list = labOptions?.sample_types || [
      "EDTA Whole Blood",
      "Serum",
      "Plasma",
      "Midstream Urine",
      "Urine (Random)",
      "Urine (24h)",
      "Stool",
      "Nasopharyngeal Swab",
      "Throat Swab",
      "Sputum",
      "Tissue / Biopsy",
      "Cerebrospinal Fluid (CSF)",
      "Synovial Fluid",
      "Pleural Fluid",
      "Imaging / Radiograph",
    ];
    const testSamples = tests.map((t) => t.sample_type).filter(Boolean);
    return Array.from(new Set([...backendList, ...list, ...testSamples].map((s) => s.trim()))).filter(Boolean);
  }, [backendSampleTypes, labOptions, tests]);

  // Create Lab Order Modal & Patient Selection State
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [createOrderForm, setCreateOrderForm] = useState({
    patient_id: "",
    doctor_id: "",
    encounter_id: null,
    priority: "ROUTINE",
    clinical_indication: "",
    test_ids: [],
  });

  // Smart Patient Selector & Date Controls
  const todayDateStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [patientFilterMode, setPatientFilterMode] = useState("today"); // "today", "date", "all"
  const [patientSelectedDate, setPatientSelectedDate] = useState(todayDateStr);
  const [patientSearchTerm, setPatientSearchTerm] = useState("");

  // Diagnostic Test Filter within Order Modal
  const [orderModalTestSearch, setOrderModalTestSearch] = useState("");
  const [orderModalTestCategory, setOrderModalTestCategory] = useState("All");

  // Payment collection options for Create Order Modal (100% backend calculated)
  const [orderCollectPaymentNow, setOrderCollectPaymentNow] = useState(true);
  const [orderPaymentMode, setOrderPaymentMode] = useState("Cash"); // "Cash", "UPI", "Card", "Net Banking"
  const [orderCashTendered, setOrderCashTendered] = useState("");
  const [orderTransactionRef, setOrderTransactionRef] = useState("");

  // Dedicated Collect Lab Payment Modal State (for pending work queue orders)
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [collectTargetOrder, setCollectTargetOrder] = useState(null);
  const [collectForm, setCollectForm] = useState({
    amount: "",
    payment_method: "Cash",
    cash_tendered: "",
    transaction_ref: "",
    notes: "",
  });
  const [collecting, setCollecting] = useState(false);

  // Reset Payment to Unpaid with Mandatory Reason
  const [isResetReasonModalOpen, setIsResetReasonModalOpen] = useState(false);
  const [resetReason, setResetReason] = useState("");
  const [resettingPayment, setResettingPayment] = useState(false);

  // Diagnostic Receipt / Invoice Modal State
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [clinicSettings, setClinicSettings] = useState(null);
  const [sendingReceiptWhatsApp, setSendingReceiptWhatsApp] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);

  const selectedPatient = useMemo(() => {
    if (!createOrderForm.patient_id) return null;
    return patients.find((p) => p.id === Number(createOrderForm.patient_id)) || null;
  }, [patients, createOrderForm.patient_id]);

  const filteredModalPatients = useMemo(() => {
    let list = [...patients];

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

    // Sort today's arrivals & queue tokens on top!
    list.sort((a, b) => {
      const aToday = a.is_today || a.created_date === todayDateStr || a.today_token != null ? 1 : 0;
      const bToday = b.is_today || b.created_date === todayDateStr || b.today_token != null ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      if (a.today_token && b.today_token) return a.today_token - b.today_token;
      return (b.id || 0) - (a.id || 0);
    });

    return list;
  }, [patients, patientFilterMode, patientSelectedDate, patientSearchTerm, todayDateStr]);

  const filteredModalTests = useMemo(() => {
    return tests.filter((t) => {
      const matchCat =
        orderModalTestCategory === "All" || t.category === orderModalTestCategory;
      const q = orderModalTestSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        t.name?.toLowerCase().includes(q) ||
        t.test_code?.toLowerCase().includes(q) ||
        t.sample_type?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [tests, orderModalTestCategory, orderModalTestSearch]);

  const totalSelectedPrice = useMemo(() => {
    return createOrderForm.test_ids.reduce((sum, id) => {
      const found = tests.find((t) => t.id === Number(id));
      return sum + (found?.price || 0);
    }, 0);
  }, [tests, createOrderForm.test_ids]);

  const [searchParams] = useSearchParams();

  useEffect(() => {
    const ptId = searchParams.get("patient_id");
    const docId = searchParams.get("doctor_id");
    const encId = searchParams.get("encounter_id");
    const diag = searchParams.get("diagnosis") || searchParams.get("clinical_indication") || "";
    const labTestsStr = searchParams.get("lab_tests") || "";

    if (ptId || encId) {
      let matchedTestIds = [];
      if (labTestsStr && tests.length > 0) {
        const requestedNames = labTestsStr
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        matchedTestIds = tests
          .filter((t) =>
            requestedNames.some(
              (rn) =>
                t.name.toLowerCase().includes(rn) ||
                rn.includes(t.name.toLowerCase()) ||
                (t.test_code && rn.includes(t.test_code.toLowerCase()))
            )
          )
          .map((t) => t.id);
      }

      setCreateOrderForm((prev) => ({
        ...prev,
        patient_id: ptId ? Number(ptId) : prev.patient_id,
        doctor_id: docId ? Number(docId) : prev.doctor_id,
        encounter_id: encId ? Number(encId) : null,
        clinical_indication: diag || prev.clinical_indication,
        test_ids: matchedTestIds.length > 0 ? matchedTestIds : prev.test_ids,
      }));
      setIsCreateOrderOpen(true);
    }
  }, [searchParams, tests]);

  // Load backend configuration options once on mount
  useEffect(() => {
    fetchLabOptions()
      .then((data) => setLabOptions(data))
      .catch((err) => console.warn("Failed to load lab options:", err));
    fetchLabCategories()
      .then((cats) => setBackendCategories(cats || []))
      .catch((err) => console.warn("Failed to load categories:", err));
    fetchLabSampleTypes()
      .then((sts) => setBackendSampleTypes(sts || []))
      .catch((err) => console.warn("Failed to load sample types:", err));
    fetchPatients()
      .then((p) => setPatients(p.patients || []))
      .catch((err) => console.warn("Failed to load patients:", err));
    fetchDoctors(true)
      .then((d) => setDoctors(d || []))
      .catch((err) => console.warn("Failed to load doctors:", err));
  }, []);

  const loadData = async (query = search, status = statusFilter, isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const [ordData, tstData, catData, stData] = await Promise.all([
        fetchLabOrders({ search: query, status: status }),
        fetchLabTests(),
        fetchLabCategories().catch(() => []),
        fetchLabSampleTypes().catch(() => []),
      ]);
      setOrders(ordData.orders || []);
      if (ordData.stats) {
        setStats(ordData.stats);
      }
      setTests(tstData || []);
      if (catData && catData.length) {
        setBackendCategories(catData);
      }
      if (stData && stData.length) {
        setBackendSampleTypes(stData);
      }
      fetchSettings().then((st) => setClinicSettings(st)).catch(() => {});
    } catch (err) {
      if (!isBackground) {
        console.error("Failed to load lab data:", err);
        showToast(err.message || "Failed to load laboratory data", "error");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const handleCreateNewCategory = async (e) => {
    if (e) e.preventDefault();
    const clean = newCatInput.trim();
    if (!clean) return;
    setAddingCategory(true);
    try {
      const res = await createLabCategory(clean);
      showToast(res.message || `Category '${clean}' created successfully`, "success");
      setNewCatInput("");
      loadData(search, statusFilter);
    } catch (err) {
      showToast(err.message || "Failed to create category", "error");
    } finally {
      setAddingCategory(false);
    }
  };

  const handlePromptDeleteCategory = (cat) => {
    setCategoryToDelete(cat);
    setDeletePassword("");
    setDeletePasswordError("");
    setDeleteReassignTo("General Diagnostics");
    setIsDeletePasswordModalOpen(true);
  };

  const handleConfirmDeleteCategory = async (e) => {
    e.preventDefault();
    if (!categoryToDelete || !deletePassword) {
      setDeletePasswordError("Please enter your administrative security password.");
      return;
    }
    setDeletingCategory(true);
    setDeletePasswordError("");
    try {
      const res = await deleteLabCategory({
        category_name: categoryToDelete.name,
        password: deletePassword,
        reassign_to: deleteReassignTo,
      });
      showToast(res.message, "success");
      setIsDeletePasswordModalOpen(false);
      setCategoryToDelete(null);
      setDeletePassword("");
      if (selectedCategory === categoryToDelete.name) {
        setSelectedCategory("All");
      }
      loadData(search, statusFilter);
    } catch (err) {
      setDeletePasswordError(err.message || "Incorrect administrative security password.");
    } finally {
      setDeletingCategory(false);
    }
  };

  const handleCreateNewSampleType = async (e) => {
    if (e) e.preventDefault();
    const clean = newSampleTypeInput.trim();
    if (!clean) return;
    setAddingSampleType(true);
    try {
      const res = await createLabSampleType(clean);
      showToast(res.message || `Sample type '${clean}' created successfully`, "success");
      setNewSampleTypeInput("");
      loadData(search, statusFilter);
    } catch (err) {
      showToast(err.message || "Failed to create sample type", "error");
    } finally {
      setAddingSampleType(false);
    }
  };

  const handlePromptDeleteSampleType = (st) => {
    setSampleTypeToDelete(st);
    setDeleteSampleTypePassword("");
    setDeleteSampleTypePasswordError("");
    setDeleteSampleTypeReassignTo("EDTA Whole Blood");
    setIsDeleteSampleTypePasswordModalOpen(true);
  };

  const handleConfirmDeleteSampleType = async (e) => {
    e.preventDefault();
    if (!sampleTypeToDelete || !deleteSampleTypePassword) {
      setDeleteSampleTypePasswordError("Please enter your administrative security password.");
      return;
    }
    setDeletingSampleType(true);
    setDeleteSampleTypePasswordError("");
    try {
      const res = await deleteLabSampleType({
        sample_type_name: sampleTypeToDelete.name,
        password: deleteSampleTypePassword,
        reassign_to: deleteSampleTypeReassignTo,
      });
      showToast(res.message, "success");
      setIsDeleteSampleTypePasswordModalOpen(false);
      setSampleTypeToDelete(null);
      setDeleteSampleTypePassword("");
      loadData(search, statusFilter);
    } catch (err) {
      setDeleteSampleTypePasswordError(err.message || "Incorrect administrative security password.");
    } finally {
      setDeletingSampleType(false);
    }
  };

  useEffect(() => {
    loadData(search, statusFilter);

    // Auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      if (!isCreateOrderOpen && !isDetailOpen && !isAddTestOpen && !isEditTestOpen && !isCategoryManagerOpen && !isSampleTypeManagerOpen) {
        loadData(search, statusFilter, true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [statusFilter, search, isCreateOrderOpen, isDetailOpen, isAddTestOpen, isEditTestOpen, isCategoryManagerOpen, isSampleTypeManagerOpen]);

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    loadData(search, statusFilter);
  };

  const handleClearFilters = () => {
    setSearch("");
    setStatusFilter("");
    loadData("", "");
  };

  const hasActiveFilters = Boolean(search || statusFilter);

  const handleOpenOrder = async (orderId) => {
    try {
      const data = await fetchLabOrder(orderId);
      setSelectedOrder(data);
      setResultEdits(
        data.results.map((r) => ({
          test_id: r.test_id,
          result_value: r.result_value === "Pending Analysis" ? "" : r.result_value,
          reference_range: r.reference_range || "",
          units: r.units || "",
          flag: r.flag || "NORMAL",
          technician_notes: r.technician_notes || "",
        }))
      );
      setIsDetailOpen(true);
    } catch (err) {
      showToast("Failed to load order: " + err.message, "error");
    }
  };

  const handleSampleCollect = async (orderId) => {
    try {
      await updateSampleStatus(orderId, "SAMPLE_COLLECTED", "Specimen collected in EDTA vial", techName);
      showToast("Sample marked as collected in EDTA vial!", "success");
      loadData(search, statusFilter);
      if (selectedOrder) {
        handleOpenOrder(orderId);
      }
    } catch (err) {
      showToast(err.message || "Could not update sample status", "error");
    }
  };

  const handleSaveResults = async () => {
    setSavingResults(true);
    try {
      await recordLabResults(selectedOrder.id, techName, resultEdits);
      showToast("Diagnostic test measurements saved successfully!", "success");
      handleOpenOrder(selectedOrder.id);
      loadData(search, statusFilter);
    } catch (err) {
      showToast(err.message || "Failed to record results", "error");
    } finally {
      setSavingResults(false);
    }
  };

  const handleVerifyReport = async () => {
    if (!window.confirm("Verify and sign off this laboratory report? The report will be published to the patient's record.")) {
      return;
    }
    try {
      await verifyLabOrder(selectedOrder.id, "Dr. Pathologist / Lab Director", "Results verified within acceptable CV");
      showToast("Laboratory report approved and published!", "success");
      handleOpenOrder(selectedOrder.id);
      loadData(search, statusFilter);
    } catch (err) {
      showToast(err.message || "Failed to verify report", "error");
    }
  };

  const handleCreateTest = async (e) => {
    e.preventDefault();
    try {
      await addLabTest(testForm);
      setIsAddTestOpen(false);
      setAddCustomCatMode(false);
      setAddCustomSampleMode(false);
      setTestForm({
        test_code: "",
        name: "",
        category: "Hematology",
        sample_type: "EDTA Whole Blood",
        tat_hours: 24,
        price: 500,
        reference_range: "",
        units: "",
        description: "",
      });
      loadData(search, statusFilter);
      showToast("Diagnostic test added to catalogue successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to add test", "error");
    }
  };

  const handleOpenEditTest = (test) => {
    setEditingTestId(test.id);
    setEditTestForm({
      test_code: test.test_code || "",
      name: test.name || "",
      category: test.category || "Hematology",
      sample_type: test.sample_type || "EDTA Whole Blood",
      tat_hours: test.tat_hours ?? 24,
      price: test.price ?? 500,
      reference_range: test.reference_range || "",
      units: test.units || "",
      description: test.description || "",
    });
    setEditCustomCatMode(false);
    setEditCustomSampleMode(false);
    setIsEditTestOpen(true);
  };

  const handleUpdateTest = async (e) => {
    e.preventDefault();
    if (!editingTestId) return;
    try {
      await updateLabTest(editingTestId, editTestForm);
      setIsEditTestOpen(false);
      setEditingTestId(null);
      loadData(search, statusFilter);
      showToast("Diagnostic test updated successfully!", "success");
    } catch (err) {
      showToast(err.message || "Failed to update test", "error");
    }
  };

  const handleDeleteTest = async (test) => {
    if (
      !window.confirm(
        `Are you sure you want to remove "${test.name}" (${test.test_code}) from the diagnostic catalogue? Historical lab records will be preserved.`
      )
    ) {
      return;
    }
    try {
      await deleteLabTest(test.id);
      loadData(search, statusFilter);
      showToast(`Diagnostic test "${test.name}" deleted from catalogue`, "success");
    } catch (err) {
      showToast(err.message || "Failed to delete test", "error");
    }
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
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
        collect_payment: orderCollectPaymentNow,
        payment_method: orderPaymentMode,
        cash_tendered: orderPaymentMode === "Cash" && orderCashTendered !== "" ? parseFloat(orderCashTendered) : null,
        transaction_ref: orderTransactionRef.trim() || null,
      });
      setIsCreateOrderOpen(false);
      if (res.change_return && res.change_return > 0) {
        showToast(`${res.message || "Diagnostic order generated!"} • Change to Return: ₹${res.change_return}`, "success");
      } else {
        showToast(res.message || "Diagnostic order generated successfully!", "success");
      }
      loadData(search, statusFilter, true);
      if (res.invoice_id) {
        fetchInvoice(res.invoice_id)
          .then((inv) => setSelectedReceipt(inv))
          .catch(() => {});
      }
    } catch (err) {
      showToast(err.message || "Failed to place diagnostic order", "error");
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleOpenCollectModal = (order) => {
    setCollectTargetOrder(order);
    const due = order.invoice?.balance_due != null ? order.invoice.balance_due : (order.total_price || 0);
    const initialAmount = due > 0 ? due : (order.invoice?.total || order.total_price || 0);
    setCollectForm({
      amount: String(initialAmount),
      payment_method: order.invoice?.payment_method || "Cash",
      cash_tendered: "",
      transaction_ref: "",
      notes: "",
    });
    setIsCollectModalOpen(true);
  };

  const handleConfirmCollectPayment = async (e) => {
    e.preventDefault();
    if (!collectTargetOrder) return;
    const amountNum = parseFloat(collectForm.amount);
    if (!amountNum || amountNum <= 0) {
      showToast("Please enter a valid payment amount (> 0)", "error");
      return;
    }
    setCollecting(true);
    try {
      const res = await collectLabOrderPayment(collectTargetOrder.id, {
        amount: amountNum,
        payment_method: collectForm.payment_method,
        cash_tendered: collectForm.cash_tendered ? parseFloat(collectForm.cash_tendered) : null,
        transaction_ref: collectForm.transaction_ref || null,
        notes: collectForm.notes || null,
      });
      showToast(
        res.change_return && res.change_return > 0
          ? `${res.message || "Payment recorded!"} • Change to Return: ₹${res.change_return}`
          : (res.message || "Payment recorded successfully!"),
        "success"
      );
      setIsCollectModalOpen(false);
      loadData(search, statusFilter, true);
      if (res.invoice_id) {
        fetchInvoice(res.invoice_id)
          .then((inv) => setSelectedReceipt(inv))
          .catch(() => {});
      }
    } catch (err) {
      showToast(err.message || "Failed to record payment", "error");
    } finally {
      setCollecting(false);
    }
  };

  const handleOpenResetReasonModal = () => {
    setResetReason("");
    setIsResetReasonModalOpen(true);
  };

  const handleConfirmResetPayment = async (e) => {
    if (e) e.preventDefault();
    if (!collectTargetOrder) return;
    if (!resetReason.trim()) {
      showToast("Audit requirement: Please select or enter a reason for resetting payment to unpaid.", "error");
      return;
    }
    setResettingPayment(true);
    try {
      const res = await resetLabOrderPayment(collectTargetOrder.id, resetReason.trim());
      showToast(res.message || "Payment reset! Status changed to Unpaid (PENDING).", "success");
      setIsResetReasonModalOpen(false);
      setIsCollectModalOpen(false);
      setResetReason("");
      loadData(search, statusFilter, true);
    } catch (err) {
      showToast(err.message || "Failed to reset payment", "error");
    } finally {
      setResettingPayment(false);
    }
  };

  const handleViewReceipt = async (invoiceId, order = null) => {
    if (!invoiceId) return;
    try {
      const inv = await fetchInvoice(invoiceId);
      if (order) {
        inv.order_id = order.id;
        inv.order_uid = order.order_uid;
      }
      setSelectedReceipt(inv);
    } catch (err) {
      showToast(err.message || "Failed to load diagnostic receipt", "error");
    }
  };

  const handleDownloadPdf = async (receipt) => {
    if (!receipt) return;
    setDownloadingPdf(true);
    try {
      const cleanPatient = (receipt.patient_name || "Patient").trim().replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
      const docNum = receipt.invoice_number || receipt.order_uid || "Receipt";
      const filename = `${cleanPatient}_Lab_Bill_${docNum}.pdf`;
      const orderId = receipt.order_id || collectTargetOrder?.id;
      if (orderId) {
        await downloadReceiptPdf(orderId, true, filename);
      } else {
        await downloadReceiptPdf(receipt.id, false, filename);
      }
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
      const orderId = receipt.order_id || collectTargetOrder?.id;
      if (orderId) {
        await printReceiptPdf(orderId, true);
      } else {
        await printReceiptPdf(receipt.id, false);
      }
    } catch (err) {
      console.warn("Direct PDF print failed, falling back to window.print:", err);
      window.print();
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleSendReceiptWhatsApp = async (invoiceId) => {
    setSendingReceiptWhatsApp(true);
    try {
      const res = await sendInvoiceWhatsApp(invoiceId);
      showToast(res.message || "Receipt dispatched via WhatsApp!", "success");
    } catch (err) {
      showToast(err.message || "Failed to send receipt via WhatsApp", "error");
    } finally {
      setSendingReceiptWhatsApp(false);
    }
  };

  const handleDownloadReceipt = (receipt) => {
    if (!receipt) return;
    const invNum = receipt.invoice_number || "Receipt";
    const patientName = receipt.patient_name || "Valued Patient";
    const patientPhone = receipt.patient_phone || "—";
    const dateStr = receipt.created_date_display || new Date().toLocaleDateString("en-IN");
    const items = Array.isArray(receipt.items) ? receipt.items : [];

    const itemsRows = items.length > 0
      ? items.map((it, idx) => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b;">${it.name || it.test_name || `Diagnostic Investigation #${idx + 1}`}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: center; color: #475569;">${it.quantity || 1}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: right; color: #475569;">₹${(it.unit_price || it.price || 0).toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: right; font-weight: 700; color: #0f172a;">₹${(it.total || (it.quantity || 1) * (it.unit_price || it.price || 0)).toLocaleString()}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" style="padding: 12px; text-align: center; color: #94a3b8;">Diagnostic Investigations</td></tr>`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${invNum}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; background: #fff; }
    .receipt-box { max-width: 680px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #254d90; padding-bottom: 16px; margin-bottom: 16px; }
    .clinic-title { font-size: 20px; font-weight: 800; color: #254d90; margin: 0 0 4px 0; }
    .clinic-sub { font-size: 12px; color: #64748b; margin: 0; }
    .inv-meta { text-align: right; }
    .inv-num { font-family: monospace; font-size: 16px; font-weight: 700; color: #0f172a; }
    .inv-badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-top: 4px; ${receipt.payment_status === "PAID" ? "background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0;" : "background: #fffbeb; color: #92400e; border: 1px solid #fde68a;"} }
    .details-grid { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e1; }
    .totals { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; font-size: 13px; }
    .tot-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .tot-total { font-size: 16px; font-weight: 800; color: #254d90; border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 6px; }
    .footer { text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 20px; }
    @media print {
      body { padding: 0; }
      .receipt-box { border: none; padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 680px; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; gap: 10px;">
    <button onclick="window.print()" style="cursor: pointer; background: #254d90; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px;">Print / Save as PDF</button>
  </div>
  <div class="receipt-box">
    <div class="header">
      <div>
        <h1 class="clinic-title">AeroState Health &amp; Wellness Clinic</h1>
        <p class="clinic-sub">Laboratory &amp; Diagnostics Department</p>
      </div>
      <div class="inv-meta">
        <div class="inv-num">${invNum}</div>
        <div class="inv-badge">${receipt.payment_status || "PAID"} (${receipt.payment_method || "Cash"})</div>
      </div>
    </div>

    <div class="details-grid">
      <div>
        <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 3px;">Patient Information</div>
        <strong style="color: #0f172a; font-size: 14px;">${patientName}</strong>
        <div style="color: #64748b; font-size: 12px; margin-top: 2px;">Phone: ${patientPhone}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 3px;">Date &amp; Time</div>
        <div style="color: #0f172a; font-weight: 600;">${dateStr}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Investigation / Test</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Rate</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="tot-row">
        <span>Subtotal:</span>
        <span style="font-family: monospace;">₹${(receipt.subtotal || receipt.total || 0).toLocaleString()}</span>
      </div>
      <div class="tot-row tot-total">
        <span>Total Charges:</span>
        <span style="font-family: monospace;">₹${(receipt.total || 0).toLocaleString()}</span>
      </div>
      <div class="tot-row" style="color: #065f46; font-weight: 600; margin-top: 6px;">
        <span>Amount Paid:</span>
        <span style="font-family: monospace;">₹${(receipt.amount_paid || 0).toLocaleString()}</span>
      </div>
      ${(receipt.balance_due && receipt.balance_due > 0) ? `
      <div class="tot-row" style="color: #92400e; font-weight: 700;">
        <span>Balance Due:</span>
        <span style="font-family: monospace;">₹${receipt.balance_due.toLocaleString()}</span>
      </div>` : ""}
    </div>

    <div class="footer">
      <p style="margin: 0 0 4px 0; font-weight: 600; color: #64748b;">Thank you for trusting AeroState Health &amp; Diagnostics</p>
      <p style="margin: 0;">This is a computer-generated diagnostic billing receipt.</p>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AeroState_Receipt_${invNum}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Receipt ${invNum} downloaded successfully!`, "success");
  };

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Diagnostics"
        title="Laboratory & Diagnostic Management"
        icon={FiActivity}
        rightAction={
          <div className="lead-header-actions flex items-center gap-2.5">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Lab Data"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={() => setIsCreateOrderOpen(true)}
              className="portal-action-btn flex items-center gap-1.5"
            >
              <FiPlus size={15} />
              <span>Place Lab Order</span>
            </button>
            <button
              onClick={() => setIsAddTestOpen(true)}
              className="portal-action-btn portal-action-btn-blue flex items-center gap-1.5"
            >
              <FiPlus size={15} />
              <span>Add Test to Catalogue</span>
            </button>
          </div>
        }
      />

      {/* 4-Card Executive KPI Grid (aerostate-lrs Reusable Grid - Driven by Server) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Lab Orders"
          value={stats?.total_orders ?? orders.length}
          Icon={FiActivity}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Pending Processing"
          value={stats?.pending_processing ?? 0}
          Icon={FiAlertCircle}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Completed & Verified"
          value={stats?.completed_verified ?? 0}
          Icon={FiCheckCircle}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Catalogue Tests"
          value={stats?.catalogue_tests ?? tests.length}
          Icon={FiLayers}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Signature Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            activeTab === "pending"
              ? "Pending Diagnostic Orders"
              : activeTab === "complete"
              ? "Completed Diagnostic Orders"
              : "Clinical Diagnostic Test Catalogue"
          }
          description={
            activeTab === "pending"
              ? "Track incoming specimen collection, lab bench processing, and pending diagnostic orders."
              : activeTab === "complete"
              ? "Review verified laboratory test reports, finalized patient results, and diagnostic archives."
              : "Standardized diagnostic test profiles, specimen requirements, reference ranges, and patient billing tariffs."
          }
          badgeCount={
            activeTab === "pending"
              ? pendingOrders.length
              : activeTab === "complete"
              ? completedOrders.length
              : filteredTests.length
          }
          badgeLabel={activeTab === "catalogue" ? "tests listed" : "orders"}
          subBadge={
            activeTab === "pending"
              ? `${pendingOrders.length} Pending Actions`
              : activeTab === "complete"
              ? `${completedOrders.length} Verified Reports`
              : "NABL & ISO Standard Specs"
          }
        />

        {/* TABS NAVIGATION */}
        <div className="wa-tabs-container">
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "pending" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("pending");
              setCurrentPage(1);
              setStatusFilter("");
            }}
          >
            <span>Pending ({pendingOrders.length})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "complete" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("complete");
              setCurrentPage(1);
              setStatusFilter("");
            }}
          >
            <span>Complete ({completedOrders.length})</span>
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${activeTab === "catalogue" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("catalogue");
            }}
          >
            <span>Test Catalogue ({tests.length})</span>
          </button>
        </div>

        {activeTab !== "catalogue" ? (
          <>
            {/* Diagnostic Queue Search & Filter Toolbar */}
            <div className="dir-controls">
              <SearchBar
                placeholder="Search by Order UID, Patient Name, or Phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onSearch={handleSearchSubmit}
                onClear={() => {
                  setSearch("");
                  loadData("", statusFilter);
                }}
              />

              <div className="dir-toolbar-right">
                {activeTab === "pending" && (
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="dir-filter-select"
                  >
                    <option value="">All Pending Statuses</option>
                    <option value="ORDERED">Ordered (Pending Collection)</option>
                    <option value="SAMPLE_COLLECTED">Sample Collected</option>
                    <option value="PROCESSING">Processing / Results Entered</option>
                  </select>
                )}

                <button
                  type="button"
                  onClick={handleSearchSubmit}
                  className="btn-submit"
                  style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
                >
                  Search
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="btn-cancel"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Orders Table */}
            {loading ? (
              <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90] mx-auto"></div>
              </div>
            ) : currentTabOrders.length === 0 ? (
              <div className="py-20 text-center bg-white rounded-xl border border-slate-200">
                <h4 className="font-bold text-slate-800 text-sm">
                  {activeTab === "pending" ? "No pending diagnostic orders" : "No completed diagnostic orders"}
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  {activeTab === "pending"
                    ? "All diagnostic tests have been processed and completed."
                    : "Completed test results and verified reports will appear here."}
                </p>
              </div>
            ) : (
              <div className="dir-table-wrapper">
                <div className="dir-scroll-bar-header" style={{ justifyContent: "space-between", padding: "8px 14px" }}>
                  <span className="text-xs font-semibold text-slate-500">
                    Showing {paginatedOrders.length} of {currentTabOrders.length} orders
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
                  <table className="data-grid-table" style={{ minWidth: "2190px", width: "2190px", tableLayout: "fixed" }}>
                    <thead>
                      <tr>
                        <th style={{ width: "160px", minWidth: "160px", fontSize: "12px", whiteSpace: "nowrap" }}>ORDER UID</th>
                        <th style={{ width: "180px", minWidth: "180px", fontSize: "12px", whiteSpace: "nowrap" }}>DATE &amp; TIME</th>
                        <th style={{ width: "170px", minWidth: "170px", fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT NAME</th>
                        <th style={{ width: "150px", minWidth: "150px", fontSize: "12px", whiteSpace: "nowrap" }}>PHONE NUMBER</th>
                        <th style={{ width: "170px", minWidth: "170px", fontSize: "12px", whiteSpace: "nowrap" }}>ORDERING DOCTOR</th>
                        <th style={{ width: "220px", minWidth: "220px", fontSize: "12px", whiteSpace: "nowrap" }}>CLINICAL DIAGNOSIS</th>
                        <th style={{ width: "260px", minWidth: "260px", fontSize: "12px", whiteSpace: "nowrap" }}>TESTS REQUESTED</th>
                        <th style={{ width: "110px", minWidth: "110px", fontSize: "12px", whiteSpace: "nowrap" }}>AMOUNT</th>
                        <th style={{ width: "110px", minWidth: "110px", fontSize: "12px", whiteSpace: "nowrap" }}>PRIORITY</th>
                        <th style={{ width: "140px", minWidth: "140px", fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                        <th style={{ width: "180px", minWidth: "180px", fontSize: "12px", whiteSpace: "nowrap" }}>BILLING / PAYMENT</th>
                        <th style={{ width: "320px", minWidth: "320px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "14px" }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedOrders.map((o) => {
                        const doctorDisplay = o.doctor_name
                          ? o.doctor_name.startsWith("Dr.")
                            ? o.doctor_name
                            : `Dr. ${o.doctor_name}`
                          : "Attending Doctor";

                        return (
                          <tr key={o.id}>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="inline-block font-mono font-bold text-xs text-[#254d90] bg-blue-50 border border-blue-200/80 px-2.5 py-1 rounded">
                                {o.order_uid}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="text-slate-700 font-medium">{o.created_at || "-"}</span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-bold text-slate-900 truncate block" title={o.patient_name}>
                                {o.patient_name || "-"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-mono text-slate-600 truncate block">
                                {o.patient_phone_display || o.patient_phone || "-"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-semibold text-slate-900 truncate block" title={doctorDisplay}>
                                {doctorDisplay}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span
                                className="text-slate-800 font-medium truncate block"
                                title={o.clinical_indication || "Provisional Clinical Evaluation"}
                              >
                                {o.clinical_indication || "Provisional Clinical Evaluation"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-medium text-slate-800 truncate block" title={o.tests_summary}>
                                {o.tests_summary || `${o.tests_count} test(s)`}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span className="font-mono font-bold text-[#126868]">
                                {o.formatted_price || `₹${o.total_price || 0}`}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              <span
                                className={`font-bold px-2 py-0.5 rounded border ${
                                  o.priority === "STAT"
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : o.priority === "URGENT"
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-slate-50 text-slate-700 border-slate-200"
                                }`}
                                style={{ fontSize: "11px" }}
                              >
                                {o.priority || "ROUTINE"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              {o.is_finalised === false ? (
                                <span
                                  className="px-2.5 py-0.5 rounded font-bold border bg-purple-50 text-purple-700 border-purple-200 inline-block"
                                  style={{ fontSize: "11px" }}
                                  title="Draft diagnostic order attached to ongoing consultation"
                                >
                                  In Consultation
                                </span>
                              ) : o.status === "COMPLETED" ? (
                                <span
                                  className="px-2.5 py-0.5 rounded font-bold border bg-emerald-50 text-emerald-700 border-emerald-200 inline-block"
                                  style={{ fontSize: "11px" }}
                                >
                                  Completed
                                </span>
                              ) : o.status === "SAMPLE_COLLECTED" ? (
                                <span
                                  className="px-2.5 py-0.5 rounded font-bold border bg-blue-50 text-blue-700 border-blue-200 inline-block"
                                  style={{ fontSize: "11px" }}
                                >
                                  Sample Collected
                                </span>
                              ) : o.status === "PROCESSING" ? (
                                <span
                                  className="px-2.5 py-0.5 rounded font-bold border bg-indigo-50 text-indigo-700 border-indigo-200 inline-block"
                                  style={{ fontSize: "11px" }}
                                >
                                  Processing
                                </span>
                              ) : (
                                <span
                                  className="px-2.5 py-0.5 rounded font-bold border bg-amber-50 text-amber-700 border-amber-200 inline-block"
                                  style={{ fontSize: "11px" }}
                                >
                                  Ordered
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                              {o.invoice ? (
                                <div
                                  className="flex flex-col cursor-pointer group"
                                  onClick={() => handleOpenCollectModal(o)}
                                  title="Click to Collect or Manage Payment"
                                >
                                  {o.invoice.payment_status === "PAID" ? (
                                    <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 group-hover:bg-emerald-100 px-2 py-0.5 rounded text-[11px] inline-flex items-center gap-1 w-max transition">
                                      <FiCheck size={11} /> PAID ({o.invoice.payment_method || "Cash"})
                                    </span>
                                  ) : o.invoice.payment_status === "PARTIAL" ? (
                                    <span className="font-bold text-amber-700 bg-amber-50 border border-amber-200 group-hover:bg-amber-100 px-2 py-0.5 rounded text-[11px] w-max transition">
                                      PARTIAL (Due: ₹{o.invoice.balance_due})
                                    </span>
                                  ) : (
                                    <span className="font-bold text-rose-700 bg-rose-50 border border-rose-200 group-hover:bg-rose-100 px-2 py-0.5 rounded text-[11px] w-max transition">
                                      PENDING (Due: ₹{o.invoice.balance_due})
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-500 font-mono mt-0.5 group-hover:underline">
                                    {o.invoice.invoice_number}
                                  </span>
                                </div>
                              ) : (
                                <div
                                  className="flex flex-col cursor-pointer group"
                                  onClick={() => handleOpenCollectModal(o)}
                                  title="Click to Collect Payment"
                                >
                                  <span className="font-bold text-rose-700 bg-rose-50 border border-rose-200 group-hover:bg-rose-100 px-2 py-0.5 rounded text-[11px] w-max transition">
                                    PENDING (₹{o.total_price || 0})
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono mt-0.5 group-hover:underline">Unbilled • Collect Now</span>
                                </div>
                              )}
                            </td>
                            <td style={{ fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "12px" }}>
                              <div className="flex items-center gap-1.5 flex-nowrap">
                                {/* Column 1: Diagnostic Workflow / Fulfilment (w-[96px]) */}
                                {o.is_finalised === false ? (
                                  <div className="flex flex-col gap-1 w-[96px]">
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/consultations?encounter_id=${o.encounter_id}&auto_open=true`)}
                                      className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-bold rounded bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 shadow-xs transition cursor-pointer"
                                      title="Active consultation draft: click to open Clinical Encounter Workspace and finalize"
                                    >
                                      <FiEdit2 size={13} className="text-purple-600" />
                                      <span>Draft Order</span>
                                    </button>
                                  </div>
                                ) : o.status === "ORDERED" ? (
                                  <div className="flex flex-col gap-1 w-[96px]">
                                    {/* Top: Collect Specimen */}
                                    <button
                                      type="button"
                                      onClick={() => handleSampleCollect(o.id)}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-amber-600 text-white hover:bg-amber-700 shadow-xs transition cursor-pointer"
                                      title="Mark Specimen Collected"
                                    >
                                      <FiDroplet size={11} />
                                      <span>Collect</span>
                                    </button>
                                    {/* Bottom: Workstation */}
                                    <button
                                      type="button"
                                      onClick={() => handleOpenOrder(o.id)}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                      title="Open Lab Workstation to Enter Results"
                                    >
                                      <FiActivity size={11} className="text-[#254d90]" />
                                      <span>Workstation</span>
                                    </button>
                                  </div>
                                ) : o.status === "COMPLETED" ? (
                                  <div className="flex flex-col gap-1 w-[96px]">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenOrder(o.id)}
                                      className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                                      title="View & Print Diagnostic Report"
                                    >
                                      <FiFileText size={14} />
                                      <span>Report</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-1 w-[96px]">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenOrder(o.id)}
                                      className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                                      title="Open Diagnostic Workstation to enter and verify results"
                                    >
                                      <FiActivity size={14} />
                                      <span>Workstation</span>
                                    </button>
                                  </div>
                                )}

                                {/* Column 2: Financial & Payment (w-[96px]) */}
                                <div className="flex flex-col gap-1 w-[96px]">
                                  {/* Top: Collect or Paid */}
                                  {(!o.invoice || o.invoice.payment_status !== "PAID") ? (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenCollectModal(o)}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition cursor-pointer"
                                      title="Collect Diagnostic Payment from Patient"
                                    >
                                      <FiDollarSign size={11} />
                                      <span>Collect {o.invoice?.balance_due != null ? `₹${o.invoice.balance_due}` : `₹${o.total_price || 0}`}</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenCollectModal(o)}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-xs transition cursor-pointer"
                                      title="Payment recorded as PAID. Click to view details or reset to unpaid."
                                    >
                                      <FiCheck size={11} className="text-emerald-600" />
                                      <span>Paid</span>
                                    </button>
                                  )}
                                  {/* Bottom: Receipt */}
                                  {(o.invoice_id || o.invoice?.id) ? (
                                    <button
                                      type="button"
                                      onClick={() => handleViewReceipt(o.invoice_id || o.invoice.id, o)}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                      title="View, Print & Download Diagnostic Receipt"
                                    >
                                      <FiPrinter size={11} className="text-slate-500" />
                                      <span>Receipt</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenCollectModal(o)}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-400 border border-slate-200 shadow-xs transition cursor-pointer"
                                      title="Unbilled - click to collect payment and generate receipt"
                                    >
                                      <FiPrinter size={11} className="text-slate-400" />
                                      <span>Receipt</span>
                                    </button>
                                  )}
                                </div>

                                {/* Column 3: Clinical & Secondary Actions (w-[84px]) */}
                                <div className="flex flex-col gap-1 w-[84px]">
                                  {/* Top: Consult */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (o.encounter_id) {
                                        navigate(`/consultations?encounter_id=${o.encounter_id}&auto_open=true`);
                                      } else {
                                        const params = new URLSearchParams();
                                        if (o.patient_id) params.set("patient_id", o.patient_id);
                                        if (o.patient_name) params.set("patient_name", o.patient_name);
                                        if (o.patient_phone) params.set("patient_phone", o.patient_phone);
                                        navigate(`/consultations?${params.toString()}`);
                                      }
                                    }}
                                    className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                    title="Open Doctor Consultation Workspace"
                                  >
                                    <FiExternalLink size={11} className="text-[#254d90]" />
                                    <span>Consult</span>
                                  </button>

                                  {/* Bottom: Details or Results */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenOrder(o.id)}
                                    className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                    title="Open Lab Order Details"
                                  >
                                    <FiFileText size={11} className="text-slate-500" />
                                    <span>{o.status === "COMPLETED" ? "Results" : "Details"}</span>
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  currentPage={currentPage}
                  totalItems={currentTabOrders.length}
                  pageSize={pageSize}
                  onPageChange={(p) => setCurrentPage(p)}
                  onPageSizeChange={(sz) => {
                    setPageSize(sz);
                    setCurrentPage(1);
                  }}
                  pageSizeOptions={[10, 20, 50, 100]}
                  itemLabel={activeTab === "pending" ? "pending orders" : "complete orders"}
                />

                <div className="dir-scroll-bar-footer">
                  <span className="text-xs text-slate-500 font-medium">
                    Real-time diagnostic specimen tracking, digital result entry, and pathologist verification.
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
        /* ======================================================== */
        /* TAB 2: TEST CATALOGUE (Styled like LRS Send Notification) */
        /* ======================================================== */
        <>
          {/* Diagnostic Accreditation & Quality Banner (Styled after LRS Status Strip) */}
          <div className="wa-wallet-status-strip">
            <div className="wa-wallet-top-bar">
              <div className="wa-wallet-kicker">
                <FiShield size={14} className="wa-kicker-icon" />
                <span>Diagnostic Quality &amp; Laboratory Protocols</span>
              </div>
              <div className="wa-wallet-badges-group">
                <span className="wa-wallet-badge">✓ NABL Accredited</span>
                <span className="wa-wallet-badge mode">ISO 15189 Certified</span>
              </div>
            </div>

            <div className="wa-wallet-main-row">
              <div className="wa-wallet-balance-wrap">
                <span className="wa-wallet-amount">Diagnostic Catalogue &amp; Pricing</span>
              </div>
              <div className="wa-wallet-meta-right">
                <span className="wa-rate-tag">
                  Active Catalogue: <strong>{tests.length} Profiles</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setIsCategoryManagerOpen(true)}
                  className="wa-manage-btn"
                  title="Manage & Delete Categories"
                >
                  <FiSettings size={13} />
                  <span>Manage Categories</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsSampleTypeManagerOpen(true)}
                  className="wa-manage-btn"
                  title="Manage & Delete Sample Types"
                >
                  <FiDroplet size={13} />
                  <span>Manage Sample Types</span>
                </button>
              </div>
            </div>
          </div>

          {/* Category Filter Pills (with Internal Horizontal Scrollbar) */}
          <div className="mb-4">
            <div className="wa-type-row">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`wa-type-select-btn ${selectedCategory === cat ? "active" : ""}`}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setCataloguePage(1);
                  }}
                >
                  {cat === "All" ? <FiLayers /> : <FiActivity />}
                  <span>{cat === "All" ? "All Profiles" : cat}</span>
                  <span className="text-[11px] opacity-75 font-normal ml-0.5">
                    ({cat === "All" ? tests.length : tests.filter((t) => t.category === cat).length})
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Search Box */}
          <div className="dir-controls mb-4 flex items-center justify-between gap-3">
            <SearchBar
              placeholder="Search tests by name, test code, or specimen type..."
              value={catalogueSearch}
              onChange={(e) => {
                setCatalogueSearch(e.target.value);
                setCataloguePage(1);
              }}
              onClear={() => {
                setCatalogueSearch("");
                setCataloguePage(1);
              }}
            />
            {catalogueSearch && (
              <button
                type="button"
                onClick={() => {
                  setCatalogueSearch("");
                  setCataloguePage(1);
                }}
                className="btn-cancel"
              >
                Clear
              </button>
            )}
          </div>

          {/* Test Cards Grid */}
          {paginatedTests.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-xl border border-slate-200">
              <FiLayers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">No diagnostic tests found</h4>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your search or category filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              {paginatedTests.map((t) => (
                <div
                  key={t.id}
                  className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-[#254d90]/40 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-[#254d90] border border-blue-200">
                          {t.test_code}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {t.category || "General"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditTest(t)}
                          title="Edit Diagnostic Test"
                          className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                        >
                          <FiEdit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTest(t)}
                          title="Delete Diagnostic Test"
                          className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <h4 className="font-bold text-slate-800 text-sm mb-1 line-clamp-1">{t.name}</h4>
                    {t.description && (
                      <p className="text-xs text-slate-500 mb-3 line-clamp-2">
                        {t.description}
                      </p>
                    )}

                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 space-y-1.5 text-xs mb-3">
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400">Specimen / Vial:</span>
                        <span className="font-medium text-slate-800 truncate ml-2">{t.sample_type}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400">Turnaround Time:</span>
                        <span className="font-medium text-slate-800">{t.tat_hours} hrs</span>
                      </div>
                      {t.reference_range && (
                        <div className="flex items-center justify-between text-slate-600">
                          <span className="text-slate-400">Ref Range:</span>
                          <span className="font-mono text-[11px] text-slate-800 truncate ml-2">{t.reference_range}</span>
                        </div>
                      )}
                      {t.units && (
                        <div className="flex items-center justify-between text-slate-600">
                          <span className="text-slate-400">Units:</span>
                          <span className="font-mono font-medium text-slate-800">{t.units}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Diagnostic Fee</span>
                      <span className="text-base font-bold text-slate-900">
                        ₹{Number(t.price).toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEditTest(t)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer flex items-center gap-1"
                        title="Edit test parameters"
                      >
                        <FiEdit2 size={12} />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateOrderForm((prev) => ({
                            ...prev,
                            test_ids: [t.id],
                          }));
                          setIsCreateOrderOpen(true);
                        }}
                        className="portal-action-btn flex items-center gap-1.5 text-xs py-1.5 px-3"
                        title="Place diagnostic order with this test"
                      >
                        <FiPlus size={14} />
                        <span>Place Order</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Test Catalogue Pagination */}
          <Pagination
            currentPage={cataloguePage}
            totalItems={filteredTests.length}
            pageSize={cataloguePageSize}
            onPageChange={(p) => setCataloguePage(p)}
            onPageSizeChange={(sz) => {
              setCataloguePageSize(sz);
              setCataloguePage(1);
            }}
            pageSizeOptions={[12, 24, 48, "all"]}
            itemLabel="diagnostic tests"
          />
        </>
      )}
    </section>

      {/* ======================================================== */}
      {/* 1. Process Order & Enter Results Modal                   */}
      {/* ======================================================== */}
      {isDetailOpen && selectedOrder && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "960px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="flex items-center gap-2">
                  <h2 style={{ fontSize: "16px" }}>Diagnostic Order Workstation</h2>
                  <span className="font-mono text-xs font-bold text-[#254d90] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {selectedOrder.order_uid}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                    {selectedOrder.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Patient: <strong className="text-slate-800">{selectedOrder.patient.name}</strong> ({selectedOrder.patient.phone}) • Doctor: {selectedOrder.doctor_name}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn-cancel"
                  style={{ padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <FiPrinter size={15} />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDetailOpen(false)}
                  className="modal-close"
                >
                  <FiX size={18} />
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ gap: "16px" }}>
              {selectedOrder.is_finalised === false && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                  <FiAlertCircle className="text-amber-600 shrink-0" size={16} />
                  <span>
                    <strong>Consultation in Draft:</strong> This diagnostic order is attached to an ongoing consultation encounter ({selectedOrder.encounter_uid || `ENC-${selectedOrder.encounter_id}`}). Specimen collection and test result entry are locked until the doctor reviews and clicks <strong>"Finalize &amp; Sign"</strong>.
                  </span>
                </div>
              )}

              {/* Specimen Actions Bar */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">
                  Current Specimen State: <strong className="text-slate-900">{selectedOrder.status}</strong>
                </span>
                {selectedOrder.status === "ORDERED" && selectedOrder.is_finalised !== false && (
                  <button
                    onClick={() => handleSampleCollect(selectedOrder.id)}
                    className="btn-submit cursor-pointer"
                    style={{ background: "#d97706" }}
                  >
                    Mark Sample Collected
                  </button>
                )}
              </div>

              {/* Results Input Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] m-0">
                  Test Measurements & Observations
                </h4>
                <div className="data-grid-container" style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                  <table className="data-grid-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>TEST NAME</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>MEASURED RESULT</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>UNITS</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>REFERENCE RANGE</th>
                        <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>CLINICAL FLAG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.results.map((r, idx) => (
                        <tr key={r.id}>
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }} className="font-bold text-slate-800">
                            {r.test_name} ({r.test_code})
                          </td>
                          <td style={{ fontSize: "12px" }}>
                            <input
                              type="text"
                              disabled={selectedOrder.status === "COMPLETED" || selectedOrder.is_finalised === false}
                              placeholder="Enter result..."
                              value={resultEdits[idx]?.result_value || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setResultEdits((prev) => {
                                  const u = [...prev];
                                  u[idx].result_value = val;
                                  return u;
                                });
                              }}
                              className="w-full px-2 py-1 border border-slate-200 rounded font-bold text-slate-900 bg-white"
                              style={{ height: "30px", fontSize: "12px" }}
                            />
                          </td>
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }} className="font-mono text-slate-700">{r.units || "—"}</td>
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }} className="text-slate-700">{r.reference_range || "—"}</td>
                          <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                            <select
                              disabled={selectedOrder.status === "COMPLETED" || selectedOrder.is_finalised === false}
                              value={resultEdits[idx]?.flag || "NORMAL"}
                              onChange={(e) => {
                                const val = e.target.value;
                                setResultEdits((prev) => {
                                  const u = [...prev];
                                  u[idx].flag = val;
                                  return u;
                                });
                              }}
                              className={`px-2 py-1 border rounded font-bold text-xs ${
                                resultEdits[idx]?.flag === "HIGH" || resultEdits[idx]?.flag === "CRITICAL"
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}
                              style={{ height: "32px" }}
                            >
                              <option value="NORMAL">NORMAL</option>
                              <option value="HIGH">HIGH ↑</option>
                              <option value="LOW">LOW ↓</option>
                              <option value="CRITICAL">CRITICAL ⚠️</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="modal-footer" style={{ justifyContent: "space-between" }}>
              <span className="text-slate-500 text-xs">
                {selectedOrder.is_finalised === false
                  ? "🔒 Consultation draft in progress — awaiting doctor sign-off"
                  : selectedOrder.status === "COMPLETED"
                  ? "✅ Report verified and published"
                  : "Technician can enter results and pathologist approves"}
              </span>
              <div className="flex gap-2">
                {selectedOrder.is_finalised === false ? (
                  <button
                    onClick={() => {
                      setIsDetailOpen(false);
                      navigate(`/consultations?encounter_id=${selectedOrder.encounter_id}&auto_open=true`);
                    }}
                    className="btn-submit cursor-pointer"
                    style={{ background: "#7c3aed" }}
                  >
                    <FiEdit3 size={14} className="mr-1 inline" />
                    Open Consultation Workspace
                  </button>
                ) : selectedOrder.status !== "COMPLETED" ? (
                  <>
                    <button
                      onClick={handleSaveResults}
                      disabled={savingResults}
                      className="btn-cancel"
                    >
                      {savingResults ? "Saving..." : "Save Measurements"}
                    </button>
                    <button
                      onClick={handleVerifyReport}
                      className="btn-submit"
                      style={{ background: "#059669" }}
                    >
                      <FiCheckCircle size={14} />
                      <span>Verify &amp; Publish Report</span>
                    </button>
                  </>
                ) : null}
                {selectedOrder.status === "COMPLETED" && (
                  <button onClick={() => setIsDetailOpen(false)} className="btn-cancel">
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. Add Test Modal                                        */}
      {/* ======================================================== */}
      {isAddTestOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Add Laboratory Test</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsAddTestOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateTest} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>Test Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. HBA1C"
                      value={testForm.test_code}
                      onChange={(e) => setTestForm({ ...testForm, test_code: e.target.value.toUpperCase() })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Standard Price (₹) *</label>
                    <input
                      type="number"
                      required
                      value={testForm.price}
                      onChange={(e) => setTestForm({ ...testForm, price: parseInt(e.target.value) || 0 })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Test Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Glycated Hemoglobin (HbA1c)"
                    value={testForm.name}
                    onChange={(e) => setTestForm({ ...testForm, name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <div className="flex items-center justify-between">
                      <label>Category *</label>
                      <button
                        type="button"
                        onClick={() => {
                          setAddCustomCatMode(!addCustomCatMode);
                          if (!addCustomCatMode) setTestForm({ ...testForm, category: "" });
                        }}
                        className="text-xs text-[#254d90] font-semibold hover:underline cursor-pointer"
                      >
                        {addCustomCatMode ? "← Select List" : "+ Add New Category"}
                      </button>
                    </div>
                    {addCustomCatMode ? (
                      <input
                        type="text"
                        required
                        placeholder="Type custom category (e.g. Molecular Biology)"
                        value={testForm.category}
                        onChange={(e) => setTestForm({ ...testForm, category: e.target.value })}
                        autoFocus
                      />
                    ) : (
                      <select
                        value={testForm.category}
                        onChange={(e) => {
                          if (e.target.value === "__add_new_category__") {
                            setAddCustomCatMode(true);
                            setTestForm({ ...testForm, category: "" });
                          } else {
                            setTestForm({ ...testForm, category: e.target.value });
                          }
                        }}
                      >
                        {availableCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                        <option value="__add_new_category__" className="font-bold text-[#254d90]">
                          + Add New Category...
                        </option>
                      </select>
                    )}
                  </div>
                  <div className="form-group">
                    <div className="flex items-center justify-between">
                      <label>Sample Type *</label>
                      <button
                        type="button"
                        onClick={() => {
                          setAddCustomSampleMode(!addCustomSampleMode);
                          if (!addCustomSampleMode) setTestForm({ ...testForm, sample_type: "" });
                        }}
                        className="text-xs text-[#254d90] font-semibold hover:underline cursor-pointer"
                      >
                        {addCustomSampleMode ? "← Select List" : "+ Add New Sample"}
                      </button>
                    </div>
                    {addCustomSampleMode ? (
                      <input
                        type="text"
                        required
                        placeholder="Type custom sample (e.g. Synovial Fluid, CSF)"
                        value={testForm.sample_type}
                        onChange={(e) => setTestForm({ ...testForm, sample_type: e.target.value })}
                        autoFocus
                      />
                    ) : (
                      <select
                        value={testForm.sample_type}
                        onChange={(e) => {
                          if (e.target.value === "__add_new_sample__") {
                            setAddCustomSampleMode(true);
                            setTestForm({ ...testForm, sample_type: "" });
                          } else {
                            setTestForm({ ...testForm, sample_type: e.target.value });
                          }
                        }}
                      >
                        {availableSampleTypes.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                        <option value="__add_new_sample__" className="font-bold text-[#254d90]">
                          + Add New Sample Type...
                        </option>
                      </select>
                    )}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Turnaround Time (Hours)</label>
                    <input
                      type="number"
                      placeholder="e.g. 4, 24"
                      value={testForm.tat_hours}
                      onChange={(e) => setTestForm({ ...testForm, tat_hours: parseInt(e.target.value) || 0 })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Units</label>
                    <input
                      type="text"
                      placeholder="e.g. %, mg/dL, g/dL"
                      value={testForm.units}
                      onChange={(e) => setTestForm({ ...testForm, units: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Reference Range</label>
                  <input
                    type="text"
                    placeholder="e.g. 4.0 - 5.6 % (Normal)"
                    value={testForm.reference_range}
                    onChange={(e) => setTestForm({ ...testForm, reference_range: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAddTestOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>Save Test</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2B. Edit Test Modal                                      */}
      {/* ======================================================== */}
      {isEditTestOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Edit Diagnostic Test</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsEditTestOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateTest} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>Test Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. HBA1C"
                      value={editTestForm.test_code}
                      onChange={(e) => setEditTestForm({ ...editTestForm, test_code: e.target.value.toUpperCase() })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Standard Price (₹) *</label>
                    <input
                      type="number"
                      required
                      value={editTestForm.price}
                      onChange={(e) => setEditTestForm({ ...editTestForm, price: parseInt(e.target.value) || 0 })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Test Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Glycated Hemoglobin (HbA1c)"
                    value={editTestForm.name}
                    onChange={(e) => setEditTestForm({ ...editTestForm, name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <div className="flex items-center justify-between">
                      <label>Category *</label>
                      <button
                        type="button"
                        onClick={() => {
                          setEditCustomCatMode(!editCustomCatMode);
                          if (!editCustomCatMode) setEditTestForm({ ...editTestForm, category: "" });
                        }}
                        className="text-xs text-[#254d90] font-semibold hover:underline cursor-pointer"
                      >
                        {editCustomCatMode ? "← Select List" : "+ Add New Category"}
                      </button>
                    </div>
                    {editCustomCatMode ? (
                      <input
                        type="text"
                        required
                        placeholder="Type custom category (e.g. Molecular Biology)"
                        value={editTestForm.category}
                        onChange={(e) => setEditTestForm({ ...editTestForm, category: e.target.value })}
                        autoFocus
                      />
                    ) : (
                      <select
                        value={editTestForm.category}
                        onChange={(e) => {
                          if (e.target.value === "__add_new_category__") {
                            setEditCustomCatMode(true);
                            setEditTestForm({ ...editTestForm, category: "" });
                          } else {
                            setEditTestForm({ ...editTestForm, category: e.target.value });
                          }
                        }}
                      >
                        {availableCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                        <option value="__add_new_category__" className="font-bold text-[#254d90]">
                          + Add New Category...
                        </option>
                      </select>
                    )}
                  </div>
                  <div className="form-group">
                    <div className="flex items-center justify-between">
                      <label>Sample Type *</label>
                      <button
                        type="button"
                        onClick={() => {
                          setEditCustomSampleMode(!editCustomSampleMode);
                          if (!editCustomSampleMode) setEditTestForm({ ...editTestForm, sample_type: "" });
                        }}
                        className="text-xs text-[#254d90] font-semibold hover:underline cursor-pointer"
                      >
                        {editCustomSampleMode ? "← Select List" : "+ Add New Sample"}
                      </button>
                    </div>
                    {editCustomSampleMode ? (
                      <input
                        type="text"
                        required
                        placeholder="Type custom sample (e.g. Synovial Fluid, CSF)"
                        value={editTestForm.sample_type}
                        onChange={(e) => setEditTestForm({ ...editTestForm, sample_type: e.target.value })}
                        autoFocus
                      />
                    ) : (
                      <select
                        value={editTestForm.sample_type}
                        onChange={(e) => {
                          if (e.target.value === "__add_new_sample__") {
                            setEditCustomSampleMode(true);
                            setEditTestForm({ ...editTestForm, sample_type: "" });
                          } else {
                            setEditTestForm({ ...editTestForm, sample_type: e.target.value });
                          }
                        }}
                      >
                        {availableSampleTypes.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                        <option value="__add_new_sample__" className="font-bold text-[#254d90]">
                          + Add New Sample Type...
                        </option>
                      </select>
                    )}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Turnaround Time (Hours)</label>
                    <input
                      type="number"
                      placeholder="e.g. 4, 24"
                      value={editTestForm.tat_hours}
                      onChange={(e) => setEditTestForm({ ...editTestForm, tat_hours: parseInt(e.target.value) || 0 })}
                      className="font-mono"
                    />
                  </div>
                  <div className="form-group">
                    <label>Units</label>
                    <input
                      type="text"
                      placeholder="e.g. %, mg/dL, g/dL"
                      value={editTestForm.units}
                      onChange={(e) => setEditTestForm({ ...editTestForm, units: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Reference Range</label>
                  <input
                    type="text"
                    placeholder="e.g. 4.0 - 5.6 % (Normal)"
                    value={editTestForm.reference_range}
                    onChange={(e) => setEditTestForm({ ...editTestForm, reference_range: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsEditTestOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>Update Test</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. Place Diagnostic Order Modal                          */}
      {/* ======================================================== */}
      {isCreateOrderOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "680px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Place Diagnostic Order</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsCreateOrderOpen(false)}
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
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Select Patient *
                  </label>

                  {selectedPatient ? (
                    /* Selected Patient Display Card */
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="staff-avatar shrink-0"
                          style={{
                            background: "#334155",
                            color: "#ffffff",
                            width: "38px",
                            height: "38px",
                            fontSize: "14px",
                            fontWeight: "700",
                          }}
                        >
                          {selectedPatient.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 text-sm truncate">
                              {selectedPatient.name}
                            </span>
                            <span className="font-mono text-xs px-2 py-0.5 rounded bg-white text-slate-700 font-medium border border-slate-200 shrink-0">
                              {selectedPatient.patient_uid || `PAT-${String(selectedPatient.id).padStart(4, "0")}`}
                            </span>
                            {selectedPatient.today_token_display ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                                {selectedPatient.today_token_display}
                              </span>
                            ) : selectedPatient.is_today ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                                Today's Visit
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{selectedPatient.phone_display || selectedPatient.phone}</span>
                            <span>•</span>
                            <span>{selectedPatient.gender_age_display || `${selectedPatient.gender}, ${selectedPatient.age || ""}`}</span>
                            <span>•</span>
                            <span>{selectedPatient.registration_source || "Direct"}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCreateOrderForm({ ...createOrderForm, patient_id: "" })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 transition shrink-0 cursor-pointer ml-2"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    /* Patient Search & Selection Widget with Date Filters */
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                      {/* Date Filter & Mode Selection Row */}
                      <div className="p-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPatientFilterMode("today")}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              patientFilterMode === "today"
                                ? "bg-slate-900 text-white"
                                : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            Today's Patients
                          </button>
                          <button
                            type="button"
                            onClick={() => setPatientFilterMode("date")}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              patientFilterMode === "date"
                                ? "bg-slate-900 text-white"
                                : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            Select Date
                          </button>
                          <button
                            type="button"
                            onClick={() => setPatientFilterMode("all")}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              patientFilterMode === "all"
                                ? "bg-slate-900 text-white"
                                : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            All Patients ({patients.length})
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
                                      width: "32px",
                                      height: "32px",
                                      fontSize: "12px",
                                      background: "#475569",
                                      color: "#ffffff",
                                    }}
                                  >
                                    {p.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-semibold text-slate-800 text-sm">{p.name}</span>
                                      <span className="font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
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
                                  className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shrink-0"
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
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                      Prescribing Doctor *
                    </label>
                    <select
                      value={createOrderForm.doctor_id}
                      onChange={(e) => setCreateOrderForm({ ...createOrderForm, doctor_id: e.target.value })}
                      required
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
                    >
                      <option value="">-- Select Prescribing Doctor --</option>
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name.startsWith("Dr.") ? d.name : `Dr. ${d.name}`} ({d.specialization})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5">Order Priority</label>
                    <select
                      value={createOrderForm.priority}
                      onChange={(e) => setCreateOrderForm({ ...createOrderForm, priority: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
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
                    <label className="text-sm font-semibold text-slate-800">
                      Select Diagnostic Tests *
                    </label>
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
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
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap cursor-pointer ${
                              orderModalTestCategory === cat
                                ? "bg-slate-900 text-white"
                                : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
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
                                  ? "bg-white border-slate-500 shadow-xs"
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
                                  className="w-4 h-4 rounded text-slate-900 cursor-pointer shrink-0 accent-slate-900"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-slate-900 text-sm">{t.name}</span>
                                    <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                                      {t.test_code}
                                    </span>
                                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">
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
                              <span className="font-bold text-slate-900 text-sm shrink-0 ml-2">
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
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Doctor's Provisional Diagnosis / Clinical Indication *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Suspected Typhoid / Fever for 4 days, Type-2 Diabetes review"
                    value={createOrderForm.clinical_indication}
                    onChange={(e) => setCreateOrderForm({ ...createOrderForm, clinical_indication: e.target.value })}
                    required
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
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
                        checked={orderCollectPaymentNow}
                        onChange={(e) => setOrderCollectPaymentNow(e.target.checked)}
                        className="w-4 h-4 rounded text-[#254d90] cursor-pointer accent-[#254d90]"
                      />
                      Collect Payment Now
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                    <span className="text-slate-600 font-medium">Total Diagnostic Charges ({createOrderForm.test_ids.length} tests):</span>
                    <span className="text-base font-bold font-mono text-[#254d90]">₹{totalSelectedPrice.toLocaleString()}</span>
                  </div>

                  {orderCollectPaymentNow && totalSelectedPrice > 0 && (
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
                              onClick={() => setOrderPaymentMode(mode)}
                              className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition cursor-pointer text-center ${
                                orderPaymentMode === mode
                                  ? "bg-[#254d90] text-white border-[#254d90] shadow-xs"
                                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                              }`}
                            >
                              {mode === "UPI" ? "UPI / QR" : mode}
                            </button>
                          ))}
                        </div>
                      </div>

                      {orderPaymentMode === "Cash" ? (
                        <div>
                          <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                            Cash Tendered &amp; Change Return
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              placeholder="Amount received from patient..."
                              value={orderCashTendered}
                              onChange={(e) => setOrderCashTendered(e.target.value)}
                              className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                            />
                            <div className="w-1/2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 flex items-center justify-between">
                              <span className="text-[10px] text-slate-400 font-sans">Change:</span>
                              <span className="text-emerald-700 font-bold">
                                ₹{Math.max(0, (parseFloat(orderCashTendered) || 0) - totalSelectedPrice)}
                              </span>
                            </div>
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
                            value={orderTransactionRef}
                            onChange={(e) => setOrderTransactionRef(e.target.value)}
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
                  onClick={() => setIsCreateOrderOpen(false)}
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
      )}
      {/* ======================================================== */}
      {/* 4. Category Manager Modal (With Internal Scrollbar)      */}
      {/* ======================================================== */}
      {isCategoryManagerOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "540px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <FiSettings size={18} className="text-[#254d90]" />
                <h2 style={{ fontSize: "16px" }}>Diagnostic Categories</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsCategoryManagerOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ gap: "16px" }}>
              {/* Quick Add Category Input */}
              <form onSubmit={handleCreateNewCategory} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter new category name (e.g. Molecular Biology)..."
                  value={newCatInput}
                  onChange={(e) => setNewCatInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="submit"
                  disabled={addingCategory || !newCatInput.trim()}
                  className="btn-submit"
                  style={{ width: "auto", padding: "0 16px" }}
                >
                  <FiPlus size={15} />
                  <span>{addingCategory ? "Adding..." : "Add"}</span>
                </button>
              </form>

              {/* Category List with Internal Vertical Scrollbar */}
              <div className="category-manager-list">
                {backendCategories.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No diagnostic categories found.
                  </div>
                ) : (
                  backendCategories.map((c) => (
                    <div
                      key={c.id || c.name}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 text-xs">
                          {c.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">
                          {c.test_count} {c.test_count === 1 ? "test" : "tests"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePromptDeleteCategory(c)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer flex items-center gap-1 text-xs font-semibold"
                        title="Delete category (requires security password)"
                      >
                        <FiTrash2 size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setIsCategoryManagerOpen(false)}
                className="btn-cancel"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. Security Password Verification Modal for Deletion      */}
      {/* ======================================================== */}
      {isDeletePasswordModalOpen && categoryToDelete && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div
            className="modal-content"
            style={{ maxWidth: "460px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-2 text-rose-700">
                <FiLock size={18} />
                <h2 style={{ fontSize: "16px", color: "#b91c1c" }}>Security Verification</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsDeletePasswordModalOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteCategory}>
              <div className="modal-body" style={{ gap: "14px" }}>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1">
                  <div>
                    Are you sure you want to delete category <strong>"{categoryToDelete.name}"</strong>?
                  </div>
                  {categoryToDelete.test_count > 0 && (
                    <div className="text-[11px] text-rose-600">
                      • {categoryToDelete.test_count} active test(s) will be automatically reassigned to <strong>General Diagnostics</strong> in the backend.
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Administrative Security Password *</label>
                  <input
                    type="password"
                    required
                    placeholder="Enter administrative password..."
                    value={deletePassword}
                    onChange={(e) => {
                      setDeletePassword(e.target.value);
                      setDeletePasswordError("");
                    }}
                    autoFocus
                  />
                  {deletePasswordError && (
                    <span className="text-rose-600 text-xs font-semibold mt-1">
                      {deletePasswordError}
                    </span>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsDeletePasswordModalOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletingCategory || !deletePassword}
                  className="btn-submit"
                  style={{ background: "#dc2626" }}
                >
                  <FiTrash2 size={14} />
                  <span>{deletingCategory ? "Verifying..." : "Verify & Delete Category"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 6. Sample Types Manager Modal                            */}
      {/* ======================================================== */}
      {isSampleTypeManagerOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "540px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <FiDroplet size={18} className="text-[#254d90]" />
                <h2 style={{ fontSize: "16px" }}>Diagnostic Sample Types</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsSampleTypeManagerOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ gap: "16px" }}>
              {/* Quick Add Sample Type Input */}
              <form onSubmit={handleCreateNewSampleType} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter new sample type (e.g. Synovial Fluid, Nasopharyngeal Swab)..."
                  value={newSampleTypeInput}
                  onChange={(e) => setNewSampleTypeInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="submit"
                  disabled={addingSampleType || !newSampleTypeInput.trim()}
                  className="btn-submit"
                  style={{ width: "auto", padding: "0 16px" }}
                >
                  <FiPlus size={15} />
                  <span>{addingSampleType ? "Adding..." : "Add"}</span>
                </button>
              </form>

              {/* Sample Type List with Internal Vertical Scrollbar */}
              <div className="category-manager-list">
                {backendSampleTypes.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No diagnostic sample types found.
                  </div>
                ) : (
                  backendSampleTypes.map((st) => (
                    <div
                      key={st.id || st.name}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 text-xs">
                          {st.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">
                          {st.test_count} {st.test_count === 1 ? "test" : "tests"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePromptDeleteSampleType(st)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer flex items-center gap-1 text-xs font-semibold"
                        title="Delete sample type (requires security password)"
                      >
                        <FiTrash2 size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setIsSampleTypeManagerOpen(false)}
                className="btn-cancel"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 7. Security Password Verification for Sample Type Delete */}
      {/* ======================================================== */}
      {isDeleteSampleTypePasswordModalOpen && sampleTypeToDelete && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div
            className="modal-content"
            style={{ maxWidth: "460px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-2 text-rose-700">
                <FiLock size={18} />
                <h2 style={{ fontSize: "16px", color: "#b91c1c" }}>Security Verification</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsDeleteSampleTypePasswordModalOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteSampleType}>
              <div className="modal-body" style={{ gap: "14px" }}>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1">
                  <div>
                    Are you sure you want to delete sample type <strong>"{sampleTypeToDelete.name}"</strong>?
                  </div>
                  {sampleTypeToDelete.test_count > 0 && (
                    <div className="text-[11px] text-rose-600">
                      • {sampleTypeToDelete.test_count} active test(s) will be automatically reassigned to <strong>EDTA Whole Blood</strong> in the backend.
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Administrative Security Password *</label>
                  <input
                    type="password"
                    required
                    placeholder="Enter administrative password..."
                    value={deleteSampleTypePassword}
                    onChange={(e) => {
                      setDeleteSampleTypePassword(e.target.value);
                      setDeleteSampleTypePasswordError("");
                    }}
                    autoFocus
                  />
                  {deleteSampleTypePasswordError && (
                    <span className="text-rose-600 text-xs font-semibold mt-1">
                      {deleteSampleTypePasswordError}
                    </span>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsDeleteSampleTypePasswordModalOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletingSampleType || !deleteSampleTypePassword}
                  className="btn-submit"
                  style={{ background: "#dc2626" }}
                >
                  <FiTrash2 size={14} />
                  <span>{deletingSampleType ? "Verifying..." : "Verify & Delete Sample Type"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal: Collect Laboratory Payment                         */}
      {/* ======================================================== */}
      {isCollectModalOpen && collectTargetOrder && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Collect Laboratory Payment</h2>
                <div className="modal-kicker">Diagnostic billing counter &amp; instant receipt</div>
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
                    <span className="text-slate-500">Order UID:</span>
                    <span className="font-mono font-bold text-slate-900">{collectTargetOrder.order_uid}</span>
                  </div>
                  {collectTargetOrder.invoice && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Invoice:</span>
                      <span className="font-mono font-bold text-slate-900">{collectTargetOrder.invoice.invoice_number}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Patient:</span>
                    <span className="font-bold text-slate-900">{collectTargetOrder.patient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Diagnostic Charges:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      ₹{(collectTargetOrder.invoice?.total != null ? collectTargetOrder.invoice.total : collectTargetOrder.total_price || 0).toLocaleString()}
                    </span>
                  </div>
                  {collectTargetOrder.invoice?.amount_paid > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Amount Paid So Far:</span>
                      <span className="font-bold text-emerald-700 font-mono">
                        ₹{(collectTargetOrder.invoice.amount_paid || 0).toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-700 font-semibold">Balance Due:</span>
                    <span className="font-bold text-emerald-700 font-mono text-sm">
                      ₹{(collectTargetOrder.invoice?.balance_due != null ? collectTargetOrder.invoice.balance_due : collectTargetOrder.total_price || 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* If already marked as PAID, offer explicit option to reset if money was not collected */}
                {collectTargetOrder.invoice?.payment_status === "PAID" && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold block">Status: Currently Recorded as PAID</span>
                      <span className="text-[11px] text-amber-800 block">
                        If money was NOT received, click here to mark as Unpaid:
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenResetReasonModal}
                      disabled={collecting}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs whitespace-nowrap cursor-pointer transition shrink-0"
                    >
                      Reset to Unpaid
                    </button>
                  </div>
                )}

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

                {/* If Cash: Tendered & Change */}
                {collectForm.payment_method === "Cash" ? (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Cash Tendered &amp; Change Calculator
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        placeholder="Cash received from patient..."
                        value={collectForm.cash_tendered || ""}
                        onChange={(e) => setCollectForm({ ...collectForm, cash_tendered: e.target.value })}
                        className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white text-slate-900 focus:border-[#254d90] outline-none"
                      />
                      <div className="w-1/2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-sans">Change:</span>
                        <span className="text-emerald-700 font-bold">
                          ₹{Math.max(0, (parseFloat(collectForm.cash_tendered) || 0) - (parseFloat(collectForm.amount) || 0))}
                        </span>
                      </div>
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

              <div className="modal-footer flex items-center justify-between">
                {(collectTargetOrder.invoice?.amount_paid > 0 || collectTargetOrder.invoice?.payment_status === "PAID") ? (
                  <button
                    type="button"
                    onClick={handleOpenResetReasonModal}
                    disabled={collecting}
                    className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer transition"
                    title="Reset recorded payment and mark order as Unpaid"
                  >
                    Mark as Unpaid
                  </button>
                ) : <div />}

                <div className="flex items-center gap-2">
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
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal: Mandatory Justification for Reversing Payment      */}
      {/* ======================================================== */}
      {isResetReasonModalOpen && collectTargetOrder && (
        <div className="modal-overlay" style={{ zIndex: 1300 }}>
          <div
            className="modal-content"
            style={{ maxWidth: "500px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-2 text-rose-700">
                <FiAlertCircle size={20} />
                <div>
                  <h2 style={{ fontSize: "16px", color: "#b91c1c" }}>Reset Payment to Unpaid</h2>
                  <div className="modal-kicker">Mandatory audit justification required</div>
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsResetReasonModalOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmResetPayment}>
              <div className="modal-body space-y-3.5">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900 space-y-1">
                  <div className="font-semibold text-rose-800">
                    Reversing payment for Order <span className="font-mono">{collectTargetOrder.order_uid}</span> ({collectTargetOrder.patient_name}).
                  </div>
                  <div className="text-[11px] text-rose-700">
                    Amount to reverse: <strong className="font-mono">₹{collectTargetOrder.invoice?.amount_paid || collectTargetOrder.total_price || 0}</strong> • Status will return to <strong>PENDING (Unpaid)</strong>.
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                    Select Quick Reason or Type Below *
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {[
                      "Patient Transaction / UPI Failed",
                      "Cash Entry Made by Mistake",
                      "Diagnostic Test Cancelled",
                      "Patient Left Without Paying",
                      "Incorrect Amount Collected"
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setResetReason(preset)}
                        className={`px-2.5 py-1 rounded text-xs transition cursor-pointer border ${
                          resetReason === preset
                            ? "bg-rose-700 text-white border-rose-700 font-semibold"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Audit Explanation / Reason *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Provide mandatory reason for audit logs (e.g. UPI was declined after cashier confirmed)..."
                    value={resetReason}
                    onChange={(e) => setResetReason(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white focus:border-rose-500 outline-none"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsResetReasonModalOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPayment || !resetReason.trim()}
                  className="btn-submit"
                  style={{ background: "#dc2626" }}
                >
                  <FiRotateCw size={14} className={resettingPayment ? "animate-spin" : ""} />
                  <span>{resettingPayment ? "Reversing..." : "Confirm & Reset to Unpaid"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Modal: Diagnostic Laboratory Receipt & Invoice           */}
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
                <h2>Diagnostic Receipt &amp; Invoice</h2>
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
                  <div className="text-[11px] text-slate-500">{clinicSettings?.clinic_tagline || "Laboratory & Diagnostics Department"}</div>
                  {clinicSettings?.clinic_address && (
                    <div className="text-[10px] text-slate-400 mt-0.5">{clinicSettings.clinic_address} • Phone: {clinicSettings.clinic_phone || ""}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-slate-800">{selectedReceipt.invoice_number}</div>
                  <div className={`font-bold text-[11px] ${selectedReceipt.payment_status === "PAID" ? "text-emerald-700" : "text-amber-700"}`}>
                    {selectedReceipt.payment_status} ({selectedReceipt.payment_method || "Cash"})
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

              {/* Diagnostics Tests Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="p-2.5">INVESTIGATION / TEST</th>
                      <th className="p-2.5 text-center">QTY</th>
                      <th className="p-2.5 text-right">RATE</th>
                      <th className="p-2.5 text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.isArray(selectedReceipt.items) && selectedReceipt.items.length > 0 ? (
                      selectedReceipt.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-medium text-slate-800">
                            {it.name || it.test_name || `Diagnostic Test #${idx + 1}`}
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
                        <td colSpan={4} className="p-2.5 text-center text-slate-400">Diagnostic Investigations</td>
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
                  <span>Total Charges:</span>
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
                <span>{printingPdf ? "Loading..." : "Print"}</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadPdf(selectedReceipt)}
                disabled={downloadingPdf}
                className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Download PDF Document"
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
    </div>
  );
}
