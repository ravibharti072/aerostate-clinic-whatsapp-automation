import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FiFileText,
  FiSearch,
  FiPlus,
  FiSend,
  FiPrinter,
  FiUser,
  FiCalendar,
  FiCheckCircle,
  FiX,
  FiActivity,
  FiTrash2,
  FiEye,
  FiEdit2,
  FiClock,
  FiRotateCw,
  FiCheck,
  FiPackage,
  FiChevronDown,
  FiChevronUp,
  FiDatabase,
  FiChevronLeft,
  FiChevronRight,
  FiExternalLink,
  FiPhone
} from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import { useToast } from "../context/ToastContext";
import {
  fetchPrescriptions,
  fetchPrescription,
  fetchPrescriptionStats,
  fetchPrescriptionTemplates,
  createPrescription,
  sendPrescriptionWhatsApp,
  updatePrescriptionFulfillment,
  fetchDoctors,
  fetchPatients,
  fetchConsultation,
  fetchPharmacyMedicines,
  fetchSettings,
} from "../api";

export default function PrescriptionsView() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [prescriptions, setPrescriptions] = useState([]);
  const [stats, setStats] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingRxId, setUpdatingRxId] = useState(null);

  // Sub-Section Tabs (Pending Dispense / Dispensed / Outside Chemist / All)
  const initialTab = searchParams.get("tab") || "pending";
  const [activeTab, setActiveTab] = useState(initialTab); // "pending", "dispensed", "outside", "all"

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && ["pending", "dispensed", "outside", "all"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Helpers to classify prescriptions by fulfillment status
  const isRxOutside = (rx) => {
    if (rx.fulfillment_type === "OUTSIDE") return true;
    const meds = rx.medicines || [];
    return meds.length > 0 && meds.every((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE");
  };

  const hasClinicMedsPending = (rx) => {
    if (rx.is_dispensed) return false;
    if (rx.is_finalised === false || rx.is_dispensable === false) return false;
    if (rx.clinic_meds_count !== undefined) {
      return rx.clinic_meds_count > 0;
    }
    const meds = rx.medicines || [];
    return meds.some((m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC");
  };

  // 100% backend-calculated metrics from SQL
  const pendingCount = stats?.pending_count ?? prescriptions.filter(hasClinicMedsPending).length;
  const dispensedCount = stats?.dispensed_count ?? prescriptions.filter((rx) => rx.is_dispensed).length;
  const outsideCount = stats?.outside_count ?? prescriptions.filter(isRxOutside).length;
  const totalCount = stats?.total_prescriptions ?? prescriptions.length;

  const tabFilteredPrescriptions = useMemo(() => {
    if (activeTab === "pending") {
      return prescriptions.filter(hasClinicMedsPending);
    }
    if (activeTab === "dispensed") {
      return prescriptions.filter((rx) => rx.is_dispensed);
    }
    if (activeTab === "outside") {
      return prescriptions.filter(isRxOutside);
    }
    return prescriptions;
  }, [prescriptions, activeTab]);

  // Pagination (20 entries per page default from LRS)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const paginatedPrescriptions = useMemo(() => {
    if (pageSize === "all") return tabFilteredPrescriptions;
    const start = (currentPage - 1) * pageSize;
    return tabFilteredPrescriptions.slice(start, start + pageSize);
  }, [tabFilteredPrescriptions, currentPage, pageSize]);

  // Horizontal Scroll Controls
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

  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [pharmacyMedicines, setPharmacyMedicines] = useState([]);
  const [linkedEncounter, setLinkedEncounter] = useState(null);
  const [showAllFields, setShowAllFields] = useState(false);
  const [patientSearchFocus, setPatientSearchFocus] = useState(false);

  // Popular Clinic Medications Preset
  const POPULAR_MEDICINES = [
    { name: "Augmentin 625 Duo", strength: "625mg", form: "Tablet", dosage: "1-0-1", duration: "5 days", notes: "After food" },
    { name: "Dolo 650", strength: "650mg", form: "Tablet", dosage: "1-0-1", duration: "3 days", notes: "After food" },
    { name: "Pan 40", strength: "40mg", form: "Tablet", dosage: "1-0-0", duration: "5 days", notes: "Before food" },
    { name: "Azithral 500", strength: "500mg", form: "Tablet", dosage: "1-0-0", duration: "3 days", notes: "After food" },
    { name: "Amoxicillin 500mg", strength: "500mg", form: "Capsule", dosage: "1-0-1", duration: "5 days", notes: "After food" },
    { name: "Cetirizine 10mg", strength: "10mg", form: "Tablet", dosage: "0-0-1", duration: "5 days", notes: "Before food" },
    { name: "Metformin 500mg", strength: "500mg", form: "Tablet", dosage: "1-0-1", duration: "30 days", notes: "After food" },
    { name: "Combiflam", strength: "Ibuprofen + Paracetamol", form: "Tablet", dosage: "1-0-1", duration: "3 days", notes: "After food" },
  ];

  const STANDARD_DOSAGE_PRESETS = [
    { value: "1-0-1", label: "1-0-1 (Twice daily)" },
    { value: "1-0-0", label: "1-0-0 (Morning only)" },
    { value: "0-0-1", label: "0-0-1 (Night only)" },
    { value: "1-1-1", label: "1-1-1 (Thrice daily)" },
    { value: "0-1-0", label: "0-1-0 (Afternoon)" },
    { value: "1-1-1-1", label: "1-1-1-1 (4x daily)" },
    { value: "SOS", label: "SOS (As needed)" },
    { value: "1 tab OD", label: "1 tab OD (Daily)" },
    { value: "1 tab BD", label: "1 tab BD (Twice)" },
    { value: "1 tab TDS", label: "1 tab TDS (Thrice)" },
  ];

  // Create / Edit Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showVitalsInQuick, setShowVitalsInQuick] = useState(false);
  const initialFormData = {
    id: null,
    prescription_uid: "",
    prescription_mode: "IN_PERSON", // "IN_PERSON", "QUICK_REFILL", "TELE_CONSULT"
    patient_id: null,
    patient_phone: "",
    patient_name: "",
    doctor_id: "",
    appointment_id: null,
    encounter_id: null,
    diagnosis: "",
    symptoms: "",
    vitals: { bp: "", pulse: "", temp: "", weight: "" },
    medicines: [
      { name: "", dosage: "1-0-1", duration: "5 days", notes: "After food", fulfillment: "CLINIC" },
    ],
    lab_tests: "",
    advice: "",
    send_whatsapp: true,
  };
  const [formData, setFormData] = useState(initialFormData);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // View / Print Modal
  const [selectedRx, setSelectedRx] = useState(null);
  const [clinicSettings, setClinicSettings] = useState(null);
  const [sendingWhatsappId, setSendingWhatsappId] = useState(null);

  // Load clinical templates from backend once on mount
  useEffect(() => {
    fetchPrescriptionTemplates()
      .then((data) => setTemplates(data))
      .catch((err) => console.warn("Failed to load prescription templates:", err));
  }, []);

  // Auto-fill Encounter Context from Query Parameters & Backend
  useEffect(() => {
    const encId = searchParams.get("encounter_id");
    if (encId) {
      navigate(`/consultations?encounter_id=${encId}&open_rx=true`, { replace: true });
      return;
    }

    const phone = searchParams.get("patient_phone") || searchParams.get("phone");
    const name = searchParams.get("patient_name") || searchParams.get("name");
    const ptId = searchParams.get("patient_id");
    const docId = searchParams.get("doctor_id");
    const apptId = searchParams.get("appointment_id") || searchParams.get("appt_id");
    const rxId = searchParams.get("prescription_id") || searchParams.get("rx_id");
    const diag = searchParams.get("diagnosis");
    const symptoms = searchParams.get("symptoms") || searchParams.get("chief_complaint");
    const labTests = searchParams.get("lab_tests");
    const advice = searchParams.get("advice");
    const bp = searchParams.get("bp");
    const pulse = searchParams.get("pulse");
    const temp = searchParams.get("temp");
    const weight = searchParams.get("weight");

    if (phone || name || docId || apptId || encId || ptId || rxId || diag || symptoms || bp || labTests || advice) {
      setFormData((prev) => ({
        ...prev,
        id: rxId ? Number(rxId) : prev.id,
        patient_id: ptId ? Number(ptId) : prev.patient_id,
        patient_phone: phone || prev.patient_phone,
        patient_name: name || prev.patient_name,
        doctor_id: docId ? Number(docId) : prev.doctor_id,
        appointment_id: apptId ? Number(apptId) : null,
        encounter_id: encId ? Number(encId) : null,
        diagnosis: diag || prev.diagnosis,
        symptoms: symptoms || prev.symptoms,
        lab_tests: labTests || prev.lab_tests,
        advice: advice || prev.advice,
        vitals: {
          bp: bp || prev.vitals.bp,
          pulse: pulse || prev.vitals.pulse,
          temp: temp || prev.vitals.temp,
          weight: weight || prev.vitals.weight,
        },
      }));
      setIsCreateOpen(true);

      // If encId is present, fetch complete consultation encounter from backend
      if (encId) {
        fetchConsultation(encId)
          .then((enc) => {
            if (enc) {
              setLinkedEncounter(enc);
              const existingRx = enc.linked_prescription;
              const existingMeds =
                existingRx?.medicines && existingRx.medicines.length > 0
                  ? existingRx.medicines.map((m) => ({
                      name: m.name || "",
                      dosage: m.dosage || "1-0-1",
                      duration: m.duration || "5 days",
                      notes: m.notes || "After food",
                      fulfillment: (m.fulfillment || "CLINIC").toUpperCase(),
                    }))
                  : null;

              setFormData((prev) => ({
                ...prev,
                id: existingRx?.id || prev.id || (rxId ? Number(rxId) : null),
                prescription_uid: existingRx?.prescription_uid || prev.prescription_uid || "",
                patient_id: enc.patient?.id || prev.patient_id,
                patient_name: enc.patient?.name || prev.patient_name,
                patient_phone: enc.patient?.phone || prev.patient_phone,
                doctor_id: enc.doctor?.id || prev.doctor_id,
                appointment_id: enc.appointment_id || prev.appointment_id,
                encounter_id: enc.id,
                diagnosis: enc.diagnosis || existingRx?.diagnosis || prev.diagnosis,
                symptoms: enc.chief_complaint || prev.symptoms,
                medicines: existingMeds || prev.medicines,
                lab_tests: enc.lab_tests || prev.lab_tests,
                advice: enc.advice || existingRx?.advice || prev.advice,
                vitals: {
                  bp: enc.vitals?.bp || prev.vitals.bp,
                  pulse: enc.vitals?.pulse || prev.vitals.pulse,
                  temp: enc.vitals?.temp || prev.vitals.temp,
                  weight: enc.vitals?.weight || prev.vitals.weight,
                },
              }));
            }
          })
          .catch((err) => console.warn("Failed to load full encounter context:", err));
      }
    }
  }, [searchParams]);

  const loadData = async (query = search, isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const [rxData, docsData, ptsData, medsData] = await Promise.all([
        fetchPrescriptions({ search: query }),
        fetchDoctors(true),
        fetchPatients(),
        fetchPharmacyMedicines({}).catch(() => []),
      ]);
      setPrescriptions(rxData.prescriptions || []);
      if (rxData.stats) {
        setStats(rxData.stats);
      }
      setDoctors(docsData || []);
      const ptsList = Array.isArray(ptsData) ? ptsData : ptsData?.patients || [];
      setPatients(ptsList);

      const medsList = Array.isArray(medsData) ? medsData : medsData?.medicines || [];
      setPharmacyMedicines(medsList);

      if (docsData && docsData.length > 0 && !formData.doctor_id) {
        setFormData((prev) => ({ ...prev, doctor_id: docsData[0].id }));
      }
      fetchSettings().then((st) => setClinicSettings(st)).catch(() => {});
    } catch (err) {
      if (!isBackground) {
        console.error("Failed to load prescriptions:", err);
        showToast(err.message || "Failed to load prescriptions", "error");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Live auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      if (!isCreateOpen && !selectedRx) {
        loadData(search, true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isCreateOpen, selectedRx, search]);

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    loadData(search);
  };

  const handleClearSearch = () => {
    setSearch("");
    loadData("");
  };

  // Medicine builder handlers
  const [activeSearchIdx, setActiveSearchIdx] = useState(null);

  const allAvailableMeds = useMemo(() => {
    const list = [];
    const seen = new Set();

    // 1. Popular clinic medicines first
    POPULAR_MEDICINES.forEach((pm) => {
      seen.add(pm.name.toLowerCase());
      list.push(pm);
    });

    // 2. Pharmacy catalogue medicines
    pharmacyMedicines.forEach((pm) => {
      const displayName = pm.name;
      if (!seen.has(displayName.toLowerCase())) {
        seen.add(displayName.toLowerCase());
        const isPan = pm.name.toLowerCase().includes("pan");
        list.push({
          name: displayName,
          strength: pm.strength || "",
          form: pm.dosage_form || "Tablet",
          dosage: pm.dosage || (isPan ? "1-0-0" : "1-0-1"),
          duration: pm.duration || "5 days",
          notes: pm.notes || (isPan ? "Before food" : "After food"),
          brand: pm.brand || "",
          generic: pm.generic_name || pm.name || "",
        });
      }
    });

    return list;
  }, [pharmacyMedicines]);

  const handleSelectMedForRow = (idx, med) => {
    setFormData((prev) => {
      const updated = [...prev.medicines];
      updated[idx] = {
        ...updated[idx],
        name: med.name,
        dosage: med.dosage || updated[idx].dosage || "1-0-1",
        duration: med.duration || updated[idx].duration || "5 days",
        notes: med.notes || updated[idx].notes || "After food",
        fulfillment: updated[idx].fulfillment || "CLINIC",
        _customDosage: false,
      };
      return { ...prev, medicines: updated };
    });
    setActiveSearchIdx(null);
  };

  const handleAddMedicine = (fulfillment = "CLINIC") => {
    setFormData((prev) => ({
      ...prev,
      medicines: [
        ...prev.medicines,
        { name: "", dosage: "1-0-1", duration: "5 days", notes: "After food", fulfillment },
      ],
    }));
  };

  const handleSetAllFulfillment = (mode) => {
    setFormData((prev) => ({
      ...prev,
      medicines: prev.medicines.map((m) => ({
        ...m,
        fulfillment: mode,
      })),
    }));
  };

  const handleUpdateFulfillment = async (rxId, mode) => {
    setUpdatingRxId(rxId);
    try {
      const res = await updatePrescriptionFulfillment(rxId, { fulfillment: mode });
      showToast(res.message || `Prescription fulfillment updated to ${mode}`, "success");
      loadData(search);
    } catch (err) {
      showToast(err.message || "Failed to update fulfillment", "error");
    } finally {
      setUpdatingRxId(null);
    }
  };

  const handleRemoveMedicine = (index) => {
    setFormData((prev) => ({
      ...prev,
      medicines: prev.medicines.filter((_, i) => i !== index),
    }));
  };

  const handleSelectMedicine = (med) => {
    if (!med) return;
    const medName = med.name || "";

    const isPan = medName.toLowerCase().includes("pan");
    const defaultDosage = med.dosage || (isPan ? "1-0-0" : "1-0-1");
    const defaultTiming = med.notes || (isPan ? "Before food" : "After food");
    const defaultFulfillment = med.fulfillment || "CLINIC";

    setFormData((prev) => {
      const existing = [...prev.medicines];
      // If the first row is completely blank, populate it
      if (existing.length === 1 && !existing[0].name.trim()) {
        return {
          ...prev,
          medicines: [
            {
              name: medName,
              dosage: defaultDosage,
              duration: med.duration || "5 days",
              notes: defaultTiming,
              fulfillment: defaultFulfillment,
            },
          ],
        };
      }
      // Otherwise append as a new row
      return {
        ...prev,
        medicines: [
          ...existing,
          {
            name: medName,
            dosage: defaultDosage,
            duration: med.duration || "5 days",
            notes: defaultTiming,
            fulfillment: defaultFulfillment,
          },
        ],
      };
    });
  };

  const handleMedicineChange = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...prev.medicines];
      updated[index][field] = value;
      return { ...prev, medicines: updated };
    });
  };

  const extractDaysNumber = (durationStr) => {
    if (!durationStr && durationStr !== 0) return "";
    const match = String(durationStr).match(/\d+/);
    return match ? match[0] : "";
  };

  const handleDaysChange = (idx, numVal) => {
    if (numVal === "" || numVal === null) {
      handleMedicineChange(idx, "duration", "");
      return;
    }
    const clean = String(numVal).replace(/[^0-9]/g, "");
    if (!clean) {
      handleMedicineChange(idx, "duration", "");
      return;
    }
    const n = parseInt(clean, 10);
    const formatted = `${n} ${n === 1 ? "day" : "days"}`;
    handleMedicineChange(idx, "duration", formatted);
  };

  const handleCloseCreateModal = () => {
    setIsCreateOpen(false);
    setFormError("");
    setFormData(initialFormData);
    setShowVitalsInQuick(false);
    setLinkedEncounter(null);
    if (window.location.search) {
      navigate("/prescriptions", { replace: true });
    }
  };

  const handleEditPrescription = (rx) => {
    if (rx.encounter_id) {
      navigate(`/consultations?encounter_id=${rx.encounter_id}&open_rx=true`);
      return;
    }
    const rxMeds =
      rx.medicines && rx.medicines.length > 0
        ? rx.medicines.map((m) => ({
            name: m.name || "",
            dosage: m.dosage || "1-0-1",
            duration: m.duration || "5 days",
            notes: m.notes || "After food",
            fulfillment: (m.fulfillment || "CLINIC").toUpperCase(),
          }))
        : [{ name: "", dosage: "1-0-1", duration: "5 days", notes: "After food", fulfillment: "CLINIC" }];

    let vit = { bp: "", pulse: "", temp: "", weight: "" };
    try {
      if (typeof rx.vitals === "string") vit = JSON.parse(rx.vitals || "{}");
      else if (rx.vitals) vit = rx.vitals;
    } catch (_) {}

    setFormData({
      id: rx.id,
      prescription_uid: rx.prescription_uid || `#RX-${rx.id}`,
      prescription_mode: rx.prescription_mode || "IN_PERSON",
      patient_id: rx.patient_id,
      patient_phone: rx.patient_phone || "",
      patient_name: rx.patient_name || "",
      doctor_id: rx.doctor_id || "",
      appointment_id: rx.appointment_id || null,
      encounter_id: rx.encounter_id || null,
      diagnosis: rx.diagnosis || "",
      symptoms: rx.symptoms || "",
      vitals: vit,
      medicines: rxMeds,
      lab_tests: rx.lab_tests || "",
      advice: rx.advice || "",
      send_whatsapp: true,
    });
    setFormError("");
    setIsCreateOpen(true);
  };

  const handleCreatePrescription = async (e) => {
    e.preventDefault();
    const isQuick = formData.prescription_mode === "QUICK_REFILL";
    const isTele = formData.prescription_mode === "TELE_CONSULT";
    const isNameOptional = isQuick || isTele;
    const fallbackName = isQuick ? "Walk-in Refill Patient" : isTele ? "Telephonic Patient" : "";
    const patientNameClean = formData.patient_name.trim() || fallbackName;
    if (!patientNameClean || !formData.diagnosis.trim() || !formData.doctor_id) {
      const msg = isNameOptional
        ? "Doctor and Diagnosis are required."
        : "Patient Name, Doctor, and Diagnosis are required.";
      setFormError(msg);
      showToast(msg, "error");
      return;
    }

    const cleanMeds = formData.medicines
      .filter((m) => m.name.trim().length > 0)
      .map((m) => ({
        name: m.name.trim(),
        dosage: m.dosage || "1-0-1",
        duration: m.duration || "5 days",
        notes: m.notes || "After food",
        fulfillment: (m.fulfillment || "CLINIC").toUpperCase(),
      }));
    if (cleanMeds.length === 0) {
      const msg = "Please add at least one medication with a valid name.";
      setFormError(msg);
      showToast(msg, "error");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const res = await createPrescription({
        ...formData,
        patient_name: patientNameClean,
        id: formData.id || undefined,
        doctor_id: Number(formData.doctor_id),
        medicines: cleanMeds,
      });

      // Check if any medication is marked for clinic in-house dispensing
      const hasClinicMeds = cleanMeds.some(
        (m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC"
      );

      if (formData.id || res.is_updated) {
        showToast("Prescription updated successfully! Pharmacy queue refreshed.", "success");
      } else if (hasClinicMeds) {
        showToast("Prescription saved! Pharmacy queue updated with clinic medicines for dispensing.", "success");
      } else {
        showToast(res.message || "Prescription created successfully!", "success");
      }

      handleCloseCreateModal();
      loadData(search);
    } catch (err) {
      const msg = err.message || "Failed to create prescription";
      setFormError(msg);
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSendWhatsApp = async (rxId) => {
    setSendingWhatsappId(rxId);
    try {
      const res = await sendPrescriptionWhatsApp(rxId);
      showToast(res.message || "Prescription dispatched to patient's WhatsApp successfully!", "whatsapp");
    } catch (err) {
      showToast(err.message || "Could not send WhatsApp prescription", "error");
    } finally {
      setSendingWhatsappId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Clinical Records & EMR"
        title="Prescriptions & Digital EMR"
        icon={FiFileText}
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => loadData(search)}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Prescriptions Data"
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
              <span>Write Prescription</span>
            </button>
          </div>
        }
      />

      {/* Stat Cards (aerostate-lrs Reusable 4-Card Grid - Driven by Server) */}
      <div className="dir-stats-grid">
        <StatCard
          title="Total Prescriptions"
          value={stats?.total_prescriptions ?? prescriptions.length}
          Icon={FiFileText}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Today's Prescriptions"
          value={stats?.today_prescriptions ?? 0}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
        />
        <StatCard
          title="WhatsApp Dispatched"
          value={stats?.whatsapp_delivered ?? 0}
          Icon={FiSend}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Available Specialists"
          value={stats?.available_specialists ?? doctors.length}
          Icon={FiActivity}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Module Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            activeTab === "pending"
              ? "Pending In-House Prescriptions"
              : activeTab === "dispensed"
              ? "Dispensed Prescriptions"
              : activeTab === "outside"
              ? "Outside Chemist Prescriptions"
              : "All Prescriptions"
          }
          description={
            activeTab === "pending"
              ? "Doctor prescriptions awaiting clinic dispensary fulfillment and medication issuance."
              : activeTab === "dispensed"
              ? "Verified record of fulfilled prescriptions issued and dispensed at the clinic pharmacy."
              : activeTab === "outside"
              ? "Prescriptions routed for external purchase from licensed retail chemist pharmacies."
              : "Master digital archive of clinical prescriptions, in-house dispensing, and outside fulfillment."
          }
          badgeCount={
            activeTab === "pending"
              ? pendingCount
              : activeTab === "dispensed"
              ? dispensedCount
              : activeTab === "outside"
              ? outsideCount
              : totalCount
          }
          badgeLabel={
            activeTab === "pending"
              ? "pending dispense"
              : activeTab === "dispensed"
              ? "dispensed"
              : activeTab === "outside"
              ? "outside chemist"
              : "prescriptions"
          }
          subBadge={
            activeTab === "pending"
              ? pendingCount > 0
                ? `${pendingCount} Awaiting In-House Issue`
                : "All Prescriptions Dispensed"
              : activeTab === "dispensed"
              ? `${dispensedCount} Dispensed`
              : activeTab === "outside"
              ? `${outsideCount} External Retail`
              : undefined
          }
        />

        {/* Prescription Sub-Section Tabs (Style identical to Doctor Consultation Active Encounters) */}
        <div className="wa-tabs-container">
          <button
            type="button"
            onClick={() => {
              setActiveTab("pending");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${activeTab === "pending" ? "active" : ""}`}
          >
            <span>Pending Dispense ({pendingCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("dispensed");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${activeTab === "dispensed" ? "active" : ""}`}
          >
            <span>Dispensed ({dispensedCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("outside");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${activeTab === "outside" ? "active" : ""}`}
          >
            <span>Outside Chemist ({outsideCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("all");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${activeTab === "all" ? "active" : ""}`}
          >
            <span>All Prescriptions ({totalCount})</span>
          </button>
        </div>

        {/* CONTROLS & TOOLBAR */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search by Patient Name, Phone, Doctor, or Diagnosis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={handleSearchSubmit}
            onClear={handleClearSearch}
          />

          <div className="dir-toolbar-right">
            <button
              type="button"
              onClick={handleSearchSubmit}
              className="btn-submit"
              style={{ width: "auto", height: "34px", padding: "0 14px", fontSize: "12.5px" }}
            >
              Search
            </button>

            {search && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="btn-cancel"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Prescriptions Data Grid Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]"></div>
          </div>
        ) : tabFilteredPrescriptions.length === 0 ? (
          <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
            <FiFileText className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-800">
              {activeTab === "pending"
                ? "No pending prescriptions"
                : activeTab === "dispensed"
                ? "No dispensed prescriptions yet"
                : activeTab === "outside"
                ? "No outside chemist prescriptions yet"
                : "No prescriptions found"}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {activeTab === "pending"
                ? "All in-house clinical prescriptions have been fulfilled and dispensed at the clinic dispensary desk."
                : activeTab === "dispensed"
                ? "Prescriptions will appear here once fulfilled and dispensed at the clinic pharmacy."
                : activeTab === "outside"
                ? "Prescriptions marked for outside retail chemist purchase will appear here."
                : search
                ? "No prescriptions match the specified search query."
                : "Start by writing your first digital prescription."}
            </p>
            {activeTab !== "dispensed" && (
              <button
                onClick={() => setIsCreateOpen(true)}
                className="mt-4 portal-action-btn portal-action-btn-blue inline-flex items-center gap-1.5"
              >
                <FiPlus size={15} />
                <span>Write First Prescription</span>
              </button>
            )}
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">Master Prescription Records (Scroll horizontally to view all columns)</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">
                  Showing {tabFilteredPrescriptions.length} {activeTab === "pending" ? "pending" : activeTab === "dispensed" ? "dispensed" : activeTab === "outside" ? "outside" : ""} digital prescription{tabFilteredPrescriptions.length === 1 ? "" : "s"}
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

            {/* Table Container - Smooth horizontal scrolling without wobbling */}
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
                scrollBehavior: "smooth",
              }}
            >
              <table className="data-grid-table" style={{ minWidth: "1720px", width: "100%", tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "130px" }}>PRESCRIPTION ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "155px" }}>DATE &amp; TIME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "130px" }}>ENCOUNTER UID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "110px" }}>PATIENT ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "150px" }}>PATIENT NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "135px" }}>PHONE NUMBER</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "150px" }}>ATTENDING DOCTOR</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "150px" }}>SPECIALTY / DEPT</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "170px" }}>CLINICAL DIAGNOSIS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "240px" }}>PRESCRIBED MEDICINES</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "110px" }}>TOTAL MEDS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap", minWidth: "140px" }}>DISPENSARY</th>
                    <th style={{ width: "350px", minWidth: "350px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "14px" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPrescriptions.map((rx) => (
                    <tr key={rx.id}>
                      {/* 1. Prescription ID */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                          {rx.prescription_uid || `#RX-${rx.id}`}
                        </span>
                      </td>

                      {/* 2. Date & Time */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-800 font-mono font-medium">
                          {rx.created_date_display || rx.created_at || "—"}
                        </span>
                      </td>

                      {/* 3. Encounter UID & Workflow Mode */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="flex flex-col items-start gap-1">
                          {rx.encounter_uid ? (
                            <span className="font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded font-semibold border border-purple-200">
                              {rx.encounter_uid}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                          {rx.prescription_mode === "QUICK_REFILL" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              Direct Refill
                            </span>
                          ) : rx.prescription_mode === "TELE_CONSULT" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                              Teleconsult
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              In-Person Visit
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Patient ID */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-semibold text-slate-700">
                          {rx.patient_uid || "—"}
                        </span>
                      </td>

                      {/* 4. Patient Name */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-bold text-slate-900">{rx.patient_name}</span>
                      </td>

                      {/* 5. Phone Number */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-slate-700">
                          {rx.patient_phone_display || rx.patient_phone || "—"}
                        </span>
                      </td>

                      {/* 6. Attending Doctor */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-bold text-slate-900">{rx.doctor_name}</span>
                      </td>

                      {/* 7. Doctor Specialty */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-600 font-medium">{rx.doctor_specialty || "General OPD"}</span>
                      </td>

                      {/* 8. Diagnosis */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-semibold text-slate-800">{rx.diagnosis}</span>
                      </td>

                      {/* 9. Prescribed Medicines */}
                      <td style={{ fontSize: "12px" }}>
                        <div className="flex flex-wrap gap-1 max-w-[320px]">
                          {rx.medicines && rx.medicines.length > 0 ? (
                            rx.medicines.map((m, i) => {
                              const isOutside = (m.fulfillment || "").toUpperCase() === "OUTSIDE";
                              return (
                                <span
                                  key={i}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold border ${
                                    isOutside
                                      ? "bg-amber-50 text-amber-900 border-amber-300"
                                      : "bg-slate-100 text-slate-800 border-slate-200"
                                  }`}
                                  style={{ fontSize: "11px" }}
                                  title={isOutside ? "Buy from outside chemist" : "Clinic in-house pharmacy"}
                                >
                                  <span>{m.name}</span>
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

                      {/* 10. Total Meds */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {(() => {
                          const meds = rx.medicines || [];
                          const clinicCount = rx.clinic_meds_count !== undefined
                            ? rx.clinic_meds_count
                            : meds.filter((m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC").length;
                          const outsideCount = rx.outside_meds_count !== undefined
                            ? rx.outside_meds_count
                            : meds.filter((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE").length;

                          if (clinicCount > 0 && outsideCount > 0) {
                            return (
                              <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                                <span className="text-[#1a56db] font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                  {clinicCount} Clinic
                                </span>
                                <span className="text-amber-800 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                  {outsideCount} Outside
                                </span>
                              </div>
                            );
                          }
                          if (outsideCount > 0 && clinicCount === 0) {
                            return (
                              <span className="font-mono font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[11px]">
                                {outsideCount} Outside
                              </span>
                            );
                          }
                          return (
                            <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                              {clinicCount || meds.length} Clinic
                            </span>
                          );
                        })()}
                      </td>

                      {/* 11. Dispensary Status */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {(() => {
                          const meds = rx.medicines || [];
                          const clinicCount = rx.clinic_meds_count !== undefined
                            ? rx.clinic_meds_count
                            : meds.filter((m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC").length;
                          const outsideCount = rx.outside_meds_count !== undefined
                            ? rx.outside_meds_count
                            : meds.filter((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE").length;

                          const isHybrid = clinicCount > 0 && outsideCount > 0;
                          const isAllOutside = outsideCount > 0 && clinicCount === 0;

                          if (isAllOutside) {
                            return (
                              <span
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full font-bold border bg-purple-50 text-purple-700 border-purple-200"
                                style={{ fontSize: "11px" }}
                              >
                                <span>Outside Chemist</span>
                              </span>
                            );
                          }

                          if (isHybrid) {
                            if (rx.is_dispensed) {
                              return (
                                <div className="flex flex-col gap-1 items-start">
                                  <span
                                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold border bg-emerald-50 text-emerald-700 border-emerald-200"
                                    style={{ fontSize: "11px" }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span>Clinic Dispensed</span>
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border bg-amber-50 text-amber-800 border-amber-200 text-[10px]">
                                    <span>+ {outsideCount} Outside Chemist</span>
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div className="flex flex-col gap-1 items-start">
                                <span
                                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold border bg-amber-50 text-amber-700 border-amber-200"
                                  style={{ fontSize: "11px" }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span>Pending Clinic ({clinicCount})</span>
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border bg-purple-50 text-purple-700 border-purple-200 text-[10px]">
                                  <span>+ {outsideCount} Outside Chemist</span>
                                </span>
                              </div>
                            );
                          }

                          // Unfinalized draft consultation
                          if (rx.is_finalised === false || rx.is_dispensable === false) {
                            return (
                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold border bg-purple-50 text-purple-700 border-purple-200"
                                style={{ fontSize: "11px" }}
                                title="Draft prescription linked to active consultation. Dispense unlocked upon doctor Finalize & Sign."
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                                <span>In Consultation (Draft)</span>
                              </span>
                            );
                          }

                          // Pure clinic
                          return (
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold border ${
                                rx.is_dispensed
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}
                              style={{ fontSize: "11px" }}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${rx.is_dispensed ? "bg-emerald-500" : "bg-amber-500"}`} />
                              <span>{rx.is_dispensed ? "Dispensed" : "Pending Dispense"}</span>
                            </span>
                          );
                        })()}
                      </td>

                      {/* Actions: 3 Columns x 2 Rows (3x2) + 7th Single Button at End */}
                      <td style={{ fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "12px" }}>
                        <div className="flex items-center gap-1.5 flex-nowrap">
                          {/* Column 1: Fulfillment / Primary Action (w-[86px]) */}
                          {rx.is_finalised === false ? (
                            <div className="flex flex-col gap-1 w-[86px]">
                              <button
                                type="button"
                                onClick={() => navigate(`/consultations?encounter_id=${rx.encounter_id}&auto_open=true`)}
                                className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                                title="Active consultation draft: click to open Clinical Encounter Workspace and finalize"
                              >
                                <FiEdit2 size={13} />
                                <span>Consult</span>
                              </button>
                            </div>
                          ) : !rx.is_dispensed && (rx.clinic_meds_count > 0 || (rx.medicines || []).some(m => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC")) ? (
                            <div className="flex flex-col gap-1 w-[86px]">
                              {/* Top: Dispense */}
                              <button
                                type="button"
                                onClick={() => navigate(`/pharmacy?patient_id=${rx.patient_id}&prescription_id=${rx.id}`)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-[#126868] text-white hover:bg-[#0e5252] shadow-xs transition cursor-pointer"
                                title="Fulfill / Dispense at Clinic Pharmacy"
                              >
                                <FiPackage size={11} />
                                <span>Dispense</span>
                              </button>
                              {/* Bottom: Consult */}
                              <button
                                type="button"
                                onClick={() => {
                                  const params = new URLSearchParams();
                                  if (rx.patient_id) params.set("patient_id", rx.patient_id);
                                  if (rx.doctor_id) params.set("doctor_id", rx.doctor_id);
                                  if (rx.appointment_id) params.set("appointment_id", rx.appointment_id);
                                  if (rx.encounter_id) params.set("encounter_id", rx.encounter_id);
                                  if (rx.patient_name) params.set("patient_name", rx.patient_name);
                                  if (rx.patient_phone) params.set("patient_phone", rx.patient_phone);
                                  navigate(`/consultations?${params.toString()}`);
                                }}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                title="Open Doctor Consultation Workspace"
                              >
                                <FiExternalLink size={11} className="text-[#254d90]" />
                                <span>Consult</span>
                              </button>
                            </div>
                          ) : rx.is_dispensed ? (
                            <div className="flex flex-col gap-1 w-[86px]">
                              {/* Full-height Dispensed state */}
                              <div className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <FiCheckCircle size={13} className="text-emerald-600" />
                                <span>Dispensed</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 w-[86px]">
                              {/* Top: To Clinic */}
                              <button
                                type="button"
                                disabled={updatingRxId === rx.id}
                                onClick={() => handleUpdateFulfillment(rx.id, "CLINIC")}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer disabled:opacity-50"
                                title="Convert to Clinic In-House Dispense"
                              >
                                <FiPackage size={11} />
                                <span>{updatingRxId === rx.id ? "..." : "To Clinic"}</span>
                              </button>
                              {/* Bottom: Consult */}
                              <button
                                type="button"
                                onClick={() => {
                                  const params = new URLSearchParams();
                                  if (rx.patient_id) params.set("patient_id", rx.patient_id);
                                  if (rx.doctor_id) params.set("doctor_id", rx.doctor_id);
                                  if (rx.appointment_id) params.set("appointment_id", rx.appointment_id);
                                  if (rx.encounter_id) params.set("encounter_id", rx.encounter_id);
                                  if (rx.patient_name) params.set("patient_name", rx.patient_name);
                                  if (rx.patient_phone) params.set("patient_phone", rx.patient_phone);
                                  navigate(`/consultations?${params.toString()}`);
                                }}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                                title="Open Doctor Consultation Workspace"
                              >
                                <FiExternalLink size={11} className="text-[#254d90]" />
                                <span>Consult</span>
                              </button>
                            </div>
                          )}

                          {/* Column 2: 2 Buttons (Slip top, Notify bottom) (w-[80px]) */}
                          <div className="flex flex-col gap-1 w-[80px]">
                            {/* Top: Slip */}
                            <button
                              type="button"
                              onClick={() => setSelectedRx(rx)}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                              title="Print / View Prescription Slip"
                            >
                              <FiPrinter size={11} className="text-slate-500" />
                              <span>Slip</span>
                            </button>

                            {/* Bottom: Notify */}
                            <button
                              type="button"
                              disabled={sendingWhatsappId === rx.id}
                              onClick={() => handleSendWhatsApp(rx.id)}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer disabled:opacity-50"
                              title="Send WhatsApp Digital Prescription to Patient"
                            >
                              <FaWhatsapp size={11} className="text-emerald-600" />
                              <span>{sendingWhatsappId === rx.id ? "Sending" : "Notify"}</span>
                            </button>
                          </div>

                          {/* Column 3: 2 Buttons (Edit top, Outside bottom) (w-[92px]) */}
                          <div className="flex flex-col gap-1 w-[92px]">
                            {/* Top: Edit */}
                            {!rx.is_dispensed ? (
                              <button
                                type="button"
                                onClick={() => handleEditPrescription(rx)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 shadow-xs transition cursor-pointer"
                                title="Edit Prescription / Modify Medications"
                              >
                                <FiEdit2 size={11} className="text-indigo-600" />
                                <span>Edit Rx</span>
                              </button>
                            ) : (
                              <div className="w-full h-[24px] inline-flex items-center justify-center text-[10.5px] text-slate-400 font-medium">
                                —
                              </div>
                            )}

                            {/* Bottom: Outside / Fulfillment Toggle */}
                            {!rx.is_dispensed && (rx.clinic_meds_count > 0 || (rx.medicines || []).some(m => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC")) ? (
                              <button
                                type="button"
                                disabled={updatingRxId === rx.id}
                                onClick={() => handleUpdateFulfillment(rx.id, "OUTSIDE")}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300 shadow-xs transition cursor-pointer disabled:opacity-50"
                                title="Mark all medications as outside chemist"
                              >
                                <FiExternalLink size={11} className="text-amber-600" />
                                <span>{updatingRxId === rx.id ? "..." : "Outside"}</span>
                              </button>
                            ) : (
                              <div className="w-full h-[24px] inline-flex items-center justify-center text-[10.5px] text-slate-400 font-medium">
                                —
                              </div>
                            )}
                          </div>

                          {/* Column 4: 7th Single Button at End (View / Full Details) (w-[74px]) */}
                          <div className="flex flex-col justify-center w-[74px]">
                            <button
                              type="button"
                              onClick={() => setSelectedRx(rx)}
                              className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 hover:text-[#254d90] border border-slate-200 hover:border-[#254d90]/30 shadow-xs transition cursor-pointer"
                              title="View & Inspect Complete Digital Prescription"
                            >
                              <FiEye size={13} className="text-[#254d90]" />
                              <span>View</span>
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
            totalItems={tabFilteredPrescriptions.length}
            pageSize={pageSize}
            onPageChange={(p) => setCurrentPage(p)}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setCurrentPage(1);
            }}
            pageSizeOptions={[10, 20, 50, "all"]}
            itemLabel={
              activeTab === "pending"
                ? "pending prescriptions"
                : activeTab === "dispensed"
                ? "dispensed prescriptions"
                : activeTab === "outside"
                ? "outside chemist prescriptions"
                : "prescriptions"
            }
          />

          <div className="dir-scroll-bar-footer">
            <span className="text-xs text-slate-500 font-medium">
              Digital prescriptions created by doctors, linked medications, and automated WhatsApp delivery.
            </span>
          </div>
        </div>
      )}
    </section>

      {/* CREATE PRESCRIPTION MODAL */}
      {isCreateOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "880px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>{formData.id ? `Edit Digital Prescription (${formData.prescription_uid || `#RX-${formData.id}`})` : "Write Digital Prescription"}</h2>
                <div className="modal-kicker">
                  {formData.id
                    ? "Add, modify, or delete prescribed medications for this consultation"
                    : "Records clinical diagnosis and prescribed medications"}
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={handleCloseCreateModal}
              >
                <FiX size={18} />
              </button>
            </div>

            {formError && (
              <div className="mx-5 mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreatePrescription} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body space-y-4">
                {/* Active Edit Mode Banner */}
                {formData.id && (
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <FiEdit2 size={14} className="text-[#254d90] shrink-0" />
                      <span>
                        <strong>Editing Active Prescription:</strong> Add more medications, adjust dosages, or delete items. Updates will refresh the Pharmacy dispensing queue.
                      </span>
                    </div>
                    <span className="font-mono font-bold px-2 py-0.5 rounded bg-white text-[#254d90] border border-slate-200 shrink-0">
                      {formData.prescription_uid || `#RX-${formData.id}`}
                    </span>
                  </div>
                )}
                {/* Prescription Workflow Mode Selector (In-Person vs Quick Refill vs Telephonic) */}
                {!formData.encounter_id && (
                  <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Prescription Workflow Mode:
                      </span>
                      {formData.prescription_mode === "QUICK_REFILL" && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200 shadow-2xs">
                          Direct Refill • Bypasses Queue
                        </span>
                      )}
                      {formData.prescription_mode === "TELE_CONSULT" && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200 shadow-2xs">
                          Telephonic / Remote Advice
                        </span>
                      )}
                      {formData.prescription_mode === "IN_PERSON" && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200 shadow-2xs">
                          Cabin Examination Visit
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            prescription_mode: "IN_PERSON",
                            diagnosis: prev.diagnosis === "Routine Medication Refill" ? "" : prev.diagnosis
                          }));
                        }}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex items-center gap-2.5 ${
                          formData.prescription_mode === "IN_PERSON"
                            ? "bg-white border-[#254d90] shadow-xs ring-2 ring-[#254d90]/15"
                            : "bg-white/70 border-slate-200 hover:bg-white text-slate-600"
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${formData.prescription_mode === "IN_PERSON" ? "bg-[#254d90] text-white" : "bg-slate-100 text-slate-500"}`}>
                          <FiUser size={15} />
                        </div>
                        <div>
                          <div className={`text-xs font-bold ${formData.prescription_mode === "IN_PERSON" ? "text-[#254d90]" : "text-slate-800"}`}>
                            In-Person Visit
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            Patient in doctor cabin with exam
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            prescription_mode: "QUICK_REFILL",
                            diagnosis: prev.diagnosis ? prev.diagnosis : "Routine Medication Refill"
                          }));
                        }}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex items-center gap-2.5 ${
                          formData.prescription_mode === "QUICK_REFILL"
                            ? "bg-white border-[#254d90] shadow-xs ring-2 ring-[#254d90]/15"
                            : "bg-white/70 border-slate-200 hover:bg-white text-slate-600"
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${formData.prescription_mode === "QUICK_REFILL" ? "bg-[#254d90] text-white" : "bg-slate-100 text-slate-500"}`}>
                          <FiPackage size={15} />
                        </div>
                        <div>
                          <div className={`text-xs font-bold ${formData.prescription_mode === "QUICK_REFILL" ? "text-[#254d90]" : "text-slate-800"}`}>
                            Quick Refill / Repeat Rx
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            Chronic repeat • Straight to Pharmacy
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            prescription_mode: "TELE_CONSULT",
                            diagnosis: prev.diagnosis ? prev.diagnosis : "Telephonic Advice / SOS"
                          }));
                        }}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex items-center gap-2.5 ${
                          formData.prescription_mode === "TELE_CONSULT"
                            ? "bg-white border-[#254d90] shadow-xs ring-2 ring-[#254d90]/15"
                            : "bg-white/70 border-slate-200 hover:bg-white text-slate-600"
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${formData.prescription_mode === "TELE_CONSULT" ? "bg-[#254d90] text-white" : "bg-slate-100 text-slate-500"}`}>
                          <FiPhone size={15} />
                        </div>
                        <div>
                          <div className={`text-xs font-bold ${formData.prescription_mode === "TELE_CONSULT" ? "text-[#254d90]" : "text-slate-800"}`}>
                            Telephonic / Remote Rx
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            Phone / WhatsApp SOS guidance
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Mode Explanation Banner - Clean Neutral Style */}
                    {formData.prescription_mode === "IN_PERSON" && (
                      <div className="flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 shadow-2xs">
                        <span>
                          <strong className="text-slate-900">Cabin Consultation:</strong> Doctor physically evaluates patient. Full vitals, complaints, and diagnosis are logged.
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0 ml-2">
                          Standard Exam
                        </span>
                      </div>
                    )}
                    {formData.prescription_mode === "QUICK_REFILL" && (
                      <div className="flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 shadow-2xs">
                        <span>
                          <strong className="text-slate-900">Direct Repeat Refill:</strong> Prescribed without cabin visit. Patient Name &amp; Vitals are optional. Prescription bypasses queue straight to Pharmacy.
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0 ml-2">
                          Queue Bypassed
                        </span>
                      </div>
                    )}
                    {formData.prescription_mode === "TELE_CONSULT" && (
                      <div className="flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 shadow-2xs">
                        <span>
                          <strong className="text-slate-900">Telephonic Advice:</strong> Prescribed remotely via Phone / WhatsApp. Patient Name is optional. Digital prescription PDF will be sent to patient's WhatsApp.
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0 ml-2">
                          Remote Slip
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 1. Auto-filled Clinical Encounter Card (When from Consultation) */}
                {formData.encounter_id && (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="p-1 rounded-md bg-[#254d90] text-white">
                          <FiCheck size={13} />
                        </span>
                        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          Auto-filled from Consultation Encounter
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {linkedEncounter?.encounter_uid || `ENC-${formData.encounter_id}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAllFields(!showAllFields)}
                        className="text-xs font-bold text-[#254d90] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {showAllFields ? (
                          <>
                            <span>Hide Clinical Details</span>
                            <FiChevronUp size={14} />
                          </>
                        ) : (
                          <>
                            <span>View / Edit Clinical Details</span>
                            <FiChevronDown size={14} />
                          </>
                        )}
                      </button>
                    </div>

                    {/* Compact Verified Clinical Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-white p-2.5 rounded-lg border border-slate-200">
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Patient Demographics</span>
                        <strong className="text-slate-900 text-sm">{formData.patient_name || "Valued Patient"}</strong>
                        <div className="text-slate-600 font-mono text-[11px]">{formData.patient_phone || "—"}</div>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Doctor &amp; Diagnosis</span>
                        <strong className="text-slate-900 line-clamp-1">
                          {doctors.find((d) => d.id === Number(formData.doctor_id))?.name || "Consultant Doctor"}
                        </strong>
                        <div className="text-[#254d90] font-bold text-[11px]">
                          {formData.diagnosis || "Pending Diagnosis"}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Recorded Vitals &amp; Complaints</span>
                        <div className="text-slate-800 font-medium text-[11px]">
                          {formData.vitals.bp ? `BP: ${formData.vitals.bp}` : ""}
                          {formData.vitals.pulse ? ` • Pulse: ${formData.vitals.pulse}` : ""}
                          {formData.vitals.temp ? ` • Temp: ${formData.vitals.temp}` : ""}
                          {formData.vitals.weight ? ` • Wt: ${formData.vitals.weight}` : ""}
                          {!formData.vitals.bp && !formData.vitals.pulse && "Standard vitals"}
                        </div>
                        {formData.symptoms && (
                          <div className="text-slate-600 italic text-[10px] line-clamp-1 mt-0.5">
                            Symptoms: {formData.symptoms}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Full Clinical Form Rows (Always visible for manual prescriptions, toggleable when auto-filled) */}
                {(!formData.encounter_id || showAllFields) && (
                  <div className="space-y-3.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl animate-in fade-in duration-100">
                    {/* Patient & Doctor Selection */}
                    <div className="form-row-3">
                      {/* Patient Name with Search Dropdown */}
                      <div className="form-group relative">
                        <label className="font-semibold text-slate-700 flex items-center justify-between">
                          <span>
                            Patient Name{" "}
                            {formData.prescription_mode === "QUICK_REFILL" || formData.prescription_mode === "TELE_CONSULT" ? (
                              <span className="text-xs font-semibold text-slate-500">(Optional)</span>
                            ) : (
                              "*"
                            )}
                          </span>
                          {!formData.patient_name && (
                            formData.prescription_mode === "QUICK_REFILL" ? (
                              <span className="text-[11px] font-medium text-slate-400">Defaults to Walk-in</span>
                            ) : formData.prescription_mode === "TELE_CONSULT" ? (
                              <span className="text-[11px] font-medium text-slate-400">Defaults to Telephonic</span>
                            ) : null
                          )}
                        </label>
                        <input
                          type="text"
                          required={formData.prescription_mode === "IN_PERSON"}
                          placeholder={
                            formData.prescription_mode === "QUICK_REFILL"
                              ? "Optional: Leave blank for Walk-in Refill..."
                              : formData.prescription_mode === "TELE_CONSULT"
                              ? "Optional: Leave blank for Telephonic Patient..."
                              : "Type name to search or enter new..."
                          }
                          value={formData.patient_name}
                          onFocus={() => setPatientSearchFocus(true)}
                          onBlur={() => {
                            setTimeout(() => setPatientSearchFocus(false), 250);
                          }}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormData((prev) => ({
                              ...prev,
                              patient_name: val,
                              patient_id: null,
                            }));
                            setPatientSearchFocus(true);
                          }}
                          className="text-sm font-semibold bg-white"
                          autoComplete="off"
                        />

                        {/* Searchable Autocomplete Dropdown */}
                        {patientSearchFocus && formData.patient_name && (
                          <div
                            className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto divide-y divide-slate-100"
                            style={{ minWidth: "260px" }}
                          >
                            {patients
                              .filter((p) =>
                                (p.name || "").toLowerCase().includes(formData.patient_name.toLowerCase()) ||
                                (p.phone && p.phone.includes(formData.patient_name)) ||
                                (p.patient_uid && p.patient_uid.toLowerCase().includes(formData.patient_name.toLowerCase()))
                              )
                              .slice(0, 6)
                              .map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    const activePending = prescriptions.find(
                                      (rx) => rx.patient_id === p.id && !rx.is_dispensed
                                    );
                                    if (activePending && !formData.id) {
                                      handleEditPrescription(activePending);
                                      showToast(`Loaded active prescription #${activePending.prescription_uid || activePending.id} for ${p.name}`, "info");
                                      setPatientSearchFocus(false);
                                      return;
                                    }
                                    setFormData((prev) => ({
                                      ...prev,
                                      patient_id: p.id,
                                      patient_name: p.name,
                                      patient_phone: p.phone && !p.phone.includes("00000") ? p.phone : "",
                                    }));
                                    setPatientSearchFocus(false);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-blue-50 transition cursor-pointer flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <div className="text-xs font-bold text-slate-900">{p.name}</div>
                                    <div className="text-[10.5px] text-slate-500 font-mono">
                                      {p.patient_uid} {p.phone && !p.phone.includes("00000") ? `• ${p.phone_display || p.phone}` : ""}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                    Existing Patient
                                  </span>
                                </button>
                              ))}

                            {!patients.some((p) => (p.name || "").toLowerCase() === formData.patient_name.trim().toLowerCase()) && (
                              <div className="px-3 py-2 text-xs text-slate-600 bg-slate-50 flex items-center justify-between">
                                <span>Register <strong>"{formData.patient_name}"</strong> as new</span>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                  New in DB
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Patient Phone (Optional) */}
                      <div className="form-group">
                        <label className="font-semibold text-slate-700">Patient Phone (Optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. +91 98112 23344 (Optional)"
                          value={formData.patient_phone}
                          onChange={(e) => setFormData({ ...formData, patient_phone: e.target.value })}
                          className="font-mono text-sm bg-white"
                        />
                      </div>

                      {/* Consulting Doctor */}
                      <div className="form-group">
                        <label className="font-semibold text-slate-700">Consulting Doctor *</label>
                        <select
                          value={formData.doctor_id}
                          onChange={(e) => setFormData({ ...formData, doctor_id: e.target.value })}
                          className="text-sm font-semibold bg-white"
                        >
                          {doctors.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.specialization})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Vitals Grid (Auto-collapsible for Quick Refill / Remote Rx) */}
                    {formData.prescription_mode === "IN_PERSON" || showVitalsInQuick ? (
                      <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                            Patient Vitals {formData.prescription_mode !== "IN_PERSON" && "(Optional)"}:
                          </span>
                          {formData.prescription_mode !== "IN_PERSON" && (
                            <button
                              type="button"
                              onClick={() => setShowVitalsInQuick(false)}
                              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                            >
                              Hide Vitals
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input
                            type="text"
                            placeholder="BP (e.g. 120/80)"
                            value={formData.vitals.bp}
                            onChange={(e) => setFormData({ ...formData, vitals: { ...formData.vitals, bp: e.target.value } })}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                            style={{ height: "36px" }}
                          />
                          <input
                            type="text"
                            placeholder="Pulse (e.g. 74 bpm)"
                            value={formData.vitals.pulse}
                            onChange={(e) => setFormData({ ...formData, vitals: { ...formData.vitals, pulse: e.target.value } })}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                            style={{ height: "36px" }}
                          />
                          <input
                            type="text"
                            placeholder="Temp (e.g. 98.6 F)"
                            value={formData.vitals.temp}
                            onChange={(e) => setFormData({ ...formData, vitals: { ...formData.vitals, temp: e.target.value } })}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                            style={{ height: "36px" }}
                          />
                          <input
                            type="text"
                            placeholder="Weight (e.g. 68 kg)"
                            value={formData.vitals.weight}
                            onChange={(e) => setFormData({ ...formData, vitals: { ...formData.vitals, weight: e.target.value } })}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                            style={{ height: "36px" }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-2.5 bg-white border border-dashed border-slate-300 rounded-lg text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                          <FiActivity size={14} className="text-slate-400" />
                          <span>Physical vitals omitted (Standard for {formData.prescription_mode === "QUICK_REFILL" ? "Direct Repeat Refill" : "Remote Teleconsult"})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowVitalsInQuick(true)}
                          className="text-xs font-bold text-[#254d90] hover:underline cursor-pointer"
                        >
                          + Add Vitals
                        </button>
                      </div>
                    )}

                    {/* Symptoms & Diagnosis */}
                    <div className="form-row">
                      <div className="form-group">
                        <label>Chief Complaints / Symptoms</label>
                        <input
                          type="text"
                          placeholder={
                            formData.prescription_mode === "QUICK_REFILL"
                              ? "e.g. Regular monthly refill request"
                              : formData.prescription_mode === "TELE_CONSULT"
                              ? "e.g. Patient called regarding mild fever and bodyache"
                              : "e.g. Toothache, mild fever since 2 days"
                          }
                          value={formData.symptoms}
                          onChange={(e) => setFormData({ ...formData, symptoms: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Clinical Diagnosis *</label>
                        <input
                          type="text"
                          required
                          placeholder={
                            formData.prescription_mode === "QUICK_REFILL"
                              ? "e.g. Chronic Hypertension Maintenance / Diabetes Refill"
                              : formData.prescription_mode === "TELE_CONSULT"
                              ? "e.g. Seasonal Flu / Symptomatic Relief"
                              : "e.g. Acute Molar Pulpitis"
                          }
                          value={formData.diagnosis}
                          onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                        />
                        {formData.prescription_mode === "QUICK_REFILL" ? (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {["Hypertension Maintenance", "Type 2 Diabetes Refill", "Hypothyroidism Refill", "Bronchial Asthma Refill"].map((diag) => (
                              <button
                                key={diag}
                                type="button"
                                onClick={() => setFormData({ ...formData, diagnosis: diag })}
                                className="text-[10.5px] px-2 py-0.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 transition cursor-pointer font-medium shadow-2xs"
                              >
                                + {diag}
                              </button>
                            ))}
                          </div>
                        ) : formData.prescription_mode === "TELE_CONSULT" ? (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {["Seasonal Viral Fever / Cough", "Acute Gastritis / Acidity", "Migraine / Tension Headache", "Allergic Rhinitis"].map((diag) => (
                              <button
                                key={diag}
                                type="button"
                                onClick={() => setFormData({ ...formData, diagnosis: diag })}
                                className="text-[10.5px] px-2 py-0.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 transition cursor-pointer font-medium shadow-2xs"
                              >
                                + {diag}
                              </button>
                            ))}
                          </div>
                        ) : (
                          templates?.common_diagnoses && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {templates.common_diagnoses.slice(0, 4).map((diag) => (
                                <button
                                  key={diag}
                                  type="button"
                                  onClick={() => setFormData({ ...formData, diagnosis: diag })}
                                  className="text-[10.5px] px-2 py-0.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 transition cursor-pointer font-medium shadow-2xs"
                                >
                                  + {diag}
                                </button>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* Advice & Tests */}
                    <div className="form-row">
                      <div className="form-group">
                        <label>Recommended Lab / X-Ray Tests</label>
                        <input
                          type="text"
                          placeholder="e.g. Dental OPG X-ray, CBC"
                          value={formData.lab_tests}
                          onChange={(e) => setFormData({ ...formData, lab_tests: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Doctor Advice / Follow-up</label>
                        <input
                          type="text"
                          placeholder="e.g. Warm saline rinses, follow up in 5 days"
                          value={formData.advice}
                          onChange={(e) => setFormData({ ...formData, advice: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Primary Focused Section: Prescribed Medications (Rx) */}
                <div className="space-y-3.5 border-t border-slate-200 pt-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-extrabold text-slate-900">
                        Prescribed Medications (Rx)
                      </span>
                      {(() => {
                        const validMeds = formData.medicines.filter((m) => m.name.trim());
                        const clinicC = validMeds.filter((m) => (m.fulfillment || "CLINIC") === "CLINIC").length;
                        const outsideC = validMeds.filter((m) => m.fulfillment === "OUTSIDE").length;
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                              {clinicC} Clinic
                            </span>
                            {outsideC > 0 && (
                              <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                                {outsideC} Outside
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                      {/* Quick Set All fulfillment buttons */}
                      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
                        <span className="text-[11px] font-semibold text-slate-500 px-1.5 select-none">Fulfill All:</span>
                        <button
                          type="button"
                          onClick={() => handleSetAllFulfillment("CLINIC")}
                          className="px-2 py-1 text-xs font-semibold rounded-md bg-white hover:bg-slate-50 text-slate-700 shadow-2xs border border-slate-200 transition cursor-pointer"
                          title="Set all medicines to Clinic In-House Pharmacy"
                        >
                          All Clinic
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetAllFulfillment("OUTSIDE")}
                          className="px-2 py-1 text-xs font-semibold rounded-md bg-white hover:bg-slate-50 text-slate-700 shadow-2xs border border-slate-200 transition cursor-pointer"
                          title="Set all medicines to Outside Retail Chemist"
                        >
                          All Outside
                        </button>
                      </div>

                      {/* Pharmacy Catalogue Dropdown Selector */}
                      {pharmacyMedicines.length > 0 && (
                        <select
                          style={{ width: "auto", minWidth: "210px", maxWidth: "290px", height: "36px", padding: "0 10px" }}
                          className="px-3 py-1 text-xs font-semibold rounded-lg bg-white text-slate-700 border border-slate-300 hover:border-slate-400 transition cursor-pointer outline-none truncate shadow-2xs"
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const med = pharmacyMedicines.find((m) => String(m.id) === val);
                            if (med) handleSelectMedicine(med);
                            e.target.value = "";
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>+ Pharmacy Catalogue...</option>
                          {pharmacyMedicines.map((pm) => (
                            <option key={pm.id} value={pm.id}>
                              {pm.name}
                            </option>
                          ))}
                        </select>
                      )}

                      <button
                        type="button"
                        onClick={() => handleAddMedicine("CLINIC")}
                        style={{ height: "36px", backgroundColor: "#254d90" }}
                        className="px-3.5 text-xs font-bold rounded-lg text-white hover:bg-[#1b396b] transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                      >
                        <FiPlus size={14} />
                        <span>Add Medicine</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick-Select Popular Medications Strip */}
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide block">
                      Quick-Add Common Medications:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {POPULAR_MEDICINES.map((pm) => (
                        <button
                          key={pm.name}
                          type="button"
                          onClick={() => handleSelectMedicine(pm)}
                          className="text-xs px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 text-slate-700 hover:text-[#254d90] border border-slate-200 hover:border-slate-300 font-semibold transition cursor-pointer shadow-2xs flex items-center gap-1"
                        >
                          <FiPlus size={12} className="text-[#254d90]" />
                          <span>{pm.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Column Headers for Medicine Grid */}
                  <div className="hidden sm:grid sm:grid-cols-[28px_1fr_125px_85px_115px_120px_36px] items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-[11px] font-bold text-slate-500 uppercase tracking-wider border border-slate-200/80">
                    <div className="text-center text-slate-400">#</div>
                    <div>Medicine Name &amp; Strength *</div>
                    <div>Dosage / Freq</div>
                    <div className="text-center">Duration</div>
                    <div>Meal Timing</div>
                    <div className="text-center">Where to Buy</div>
                    <div className="text-center"></div>
                  </div>

                  {/* Dynamic Medicine Rows */}
                  <div className="space-y-2">
                    {formData.medicines.map((m, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col sm:grid sm:grid-cols-[28px_1fr_125px_85px_115px_120px_36px] items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition"
                      >
                        {/* Row Index Badge */}
                        <div className="hidden sm:flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold shrink-0">
                          {idx + 1}
                        </div>

                        {/* 1. Medicine Name Input with Custom Autocomplete Dropdown */}
                        <div className="w-full relative">
                          <input
                            type="text"
                            required
                            placeholder="Medicine Name (e.g. Augmentin 625 Duo, Dolo 650)"
                            value={m.name}
                            onFocus={() => setActiveSearchIdx(idx)}
                            onBlur={() => {
                              setTimeout(() => {
                                setActiveSearchIdx((curr) => (curr === idx ? null : curr));
                              }, 200);
                            }}
                            onChange={(e) => {
                              handleMedicineChange(idx, "name", e.target.value);
                              setActiveSearchIdx(idx);
                            }}
                            style={{ width: "100%", height: "38px", padding: "0 10px" }}
                            className="rounded-lg border border-slate-300 text-xs md:text-sm bg-white font-semibold text-slate-900 focus:border-[#254d90] outline-none"
                            autoComplete="off"
                          />

                          {/* Custom Autocomplete Dropdown */}
                          {activeSearchIdx === idx && (
                            <div
                              className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto divide-y divide-slate-100"
                              style={{ minWidth: "260px" }}
                            >
                              {allAvailableMeds
                                .filter((med) => {
                                  if (!m.name.trim()) return true;
                                  const q = m.name.toLowerCase();
                                  return (
                                    med.name.toLowerCase().includes(q) ||
                                    (med.brand && med.brand.toLowerCase().includes(q)) ||
                                    (med.generic && med.generic.toLowerCase().includes(q))
                                  );
                                })
                                .slice(0, 8)
                                .map((med, medIdx) => (
                                    <button
                                      key={medIdx}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelectMedForRow(idx, med);
                                      }}
                                      className="w-full px-3 py-2 text-left hover:bg-slate-50 transition cursor-pointer flex items-center"
                                    >
                                      <span className="text-xs font-bold text-slate-900 truncate">
                                        {med.name}
                                      </span>
                                    </button>
                                  ))}
                            </div>
                          )}
                        </div>

                        {/* 2. Dosage Selector with Presets & Custom */}
                        <div className="w-full">
                          {m._customDosage ? (
                            <div className="relative flex items-center w-full">
                              <input
                                type="text"
                                placeholder="e.g. 2 tabs at night"
                                value={m.dosage}
                                autoFocus
                                onChange={(e) => handleMedicineChange(idx, "dosage", e.target.value)}
                                style={{ width: "100%", height: "38px", padding: "0 24px 0 8px" }}
                                className="rounded-lg border border-[#254d90] text-xs font-semibold bg-white text-slate-800 outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  handleMedicineChange(idx, "_customDosage", false);
                                  handleMedicineChange(idx, "dosage", "1-0-1");
                                }}
                                className="absolute right-1.5 text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                                title="Back to presets"
                              >
                                <FiX size={13} />
                              </button>
                            </div>
                          ) : (
                            <select
                              value={
                                STANDARD_DOSAGE_PRESETS.some((p) => p.value === m.dosage)
                                  ? m.dosage
                                  : (m.dosage ? "__custom__" : "1-0-1")
                              }
                              onChange={(e) => {
                                if (e.target.value === "__custom__") {
                                  handleMedicineChange(idx, "_customDosage", true);
                                  handleMedicineChange(idx, "dosage", "");
                                } else {
                                  handleMedicineChange(idx, "dosage", e.target.value);
                                }
                              }}
                              style={{ width: "100%", height: "38px", padding: "0 8px" }}
                              className="rounded-lg border border-slate-300 text-xs font-semibold bg-white text-slate-800 focus:border-[#254d90] outline-none cursor-pointer"
                            >
                              {STANDARD_DOSAGE_PRESETS.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                              <option value="__custom__">Custom...</option>
                            </select>
                          )}
                        </div>

                        {/* 3. Duration: Enter Number and "day" / "days" shows automatically */}
                        <div className="w-full">
                          <div
                            className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:border-[#254d90] focus-within:ring-1 focus-within:ring-[#254d90] transition shadow-2xs w-full"
                            style={{ height: "38px" }}
                          >
                            <input
                              type="number"
                              min="1"
                              max="365"
                              placeholder="5"
                              value={extractDaysNumber(m.duration)}
                              onChange={(e) => handleDaysChange(idx, e.target.value)}
                              style={{
                                width: "45px",
                                minWidth: "45px",
                                height: "100%",
                                border: "none",
                                borderRadius: "0",
                                textAlign: "center",
                                padding: "0 4px",
                                fontWeight: "700",
                                background: "transparent",
                                color: "#0f172a"
                              }}
                              className="text-xs md:text-sm outline-none"
                            />
                            <span
                              style={{ height: "100%" }}
                              className="flex-1 flex items-center justify-center bg-slate-50 text-slate-600 text-xs font-bold border-l border-slate-200 select-none px-1 whitespace-nowrap"
                            >
                              {parseInt(extractDaysNumber(m.duration), 10) === 1 ? "day" : "days"}
                            </span>
                          </div>
                        </div>

                        {/* 4. Meal Timing Dropdown (NO icons, clean text) */}
                        <div className="w-full">
                          <select
                            value={m.notes || "After food"}
                            onChange={(e) => handleMedicineChange(idx, "notes", e.target.value)}
                            style={{ width: "100%", height: "38px", padding: "0 8px" }}
                            className="rounded-lg border border-slate-300 text-xs font-semibold bg-white text-slate-800 focus:border-[#254d90] outline-none cursor-pointer"
                          >
                            <option value="After food">After food</option>
                            <option value="Before food">Before food</option>
                            <option value="Empty stomach">Empty stomach</option>
                            <option value="At bedtime">At bedtime</option>
                            <option value="With food">With food</option>
                            <option value="With warm water">With warm water</option>
                          </select>
                        </div>

                        {/* 5. Fulfillment Toggle Pill (Clinic Pharmacy vs Outside Chemist) */}
                        <div className="w-full">
                          <button
                            type="button"
                            onClick={() =>
                              handleMedicineChange(
                                idx,
                                "fulfillment",
                                (m.fulfillment || "CLINIC") === "OUTSIDE" ? "CLINIC" : "OUTSIDE"
                              )
                            }
                            className={`w-full flex items-center justify-center gap-1.5 px-2 rounded-lg text-xs font-semibold transition cursor-pointer select-none border ${
                              (m.fulfillment || "CLINIC") === "OUTSIDE"
                                ? "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 shadow-2xs"
                                : "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200 shadow-2xs font-bold"
                            }`}
                            style={{ height: "38px" }}
                            title={
                              (m.fulfillment || "CLINIC") === "OUTSIDE"
                                ? "Click to switch to Clinic In-House Pharmacy"
                                : "Click to switch to Outside Retail Chemist"
                            }
                          >
                            {(m.fulfillment || "CLINIC") === "OUTSIDE" ? (
                              <span className="truncate">Outside</span>
                            ) : (
                              <span className="truncate">Clinic</span>
                            )}
                          </button>
                        </div>

                        {/* 6. Delete Action Button (Always shown, disabled if only 1 medicine) */}
                        <div className="w-full sm:w-auto flex justify-end">
                          <button
                            type="button"
                            disabled={formData.medicines.length === 1}
                            onClick={() => {
                              if (formData.medicines.length > 1) {
                                handleRemoveMedicine(idx);
                              }
                            }}
                            style={{ width: "34px", height: "34px" }}
                            className={`flex items-center justify-center rounded-lg transition shrink-0 ${
                              formData.medicines.length === 1
                                ? "text-slate-300 bg-slate-50 cursor-not-allowed opacity-40 border border-slate-200"
                                : "text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer border border-transparent hover:border-rose-200"
                            }`}
                            title={
                              formData.medicines.length === 1
                                ? "At least one medication is required"
                                : "Remove Medicine"
                            }
                          >
                            <FiTrash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deliver to WhatsApp Toggle */}
                <div className="info-box-note flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-2xs">
                  <div className="flex items-center gap-2">
                    <FiSend size={15} className="text-[#254d90] shrink-0" />
                    <span className="text-xs font-semibold text-slate-700">
                      Send digital prescription copy to patient's WhatsApp immediately
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.send_whatsapp}
                    onChange={(e) => setFormData({ ...formData, send_whatsapp: e.target.checked })}
                    className="cursor-pointer accent-[#254d90]"
                    style={{ width: "16px", height: "16px" }}
                  />
                </div>
              </div>

              <div className="modal-footer flex items-center justify-between">
                <div>
                  {formData.encounter_id && (
                    <button
                      type="button"
                      onClick={() => {
                        handleCloseCreateModal();
                        navigate("/consultations");
                      }}
                      className="text-xs font-semibold text-[#254d90] hover:underline"
                    >
                      ← Back to Consultations
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCloseCreateModal}
                    className="btn-cancel text-xs md:text-sm px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{ backgroundColor: "#254d90" }}
                    className="btn-submit text-xs md:text-sm px-4 py-2 font-bold text-white shadow-xs hover:bg-[#1b396b]"
                  >
                    <FiCheck size={15} />
                    <span>
                      {saving
                        ? "Saving..."
                        : formData.id
                        ? "Update Prescription"
                        : formData.prescription_mode === "QUICK_REFILL"
                        ? "Save Refill & Send to Pharmacy"
                        : formData.prescription_mode === "TELE_CONSULT"
                        ? "Save Remote Rx & Deliver"
                        : "Save Prescription & Encounter"}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW & PRINT MODAL */}
      {selectedRx && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "680px", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="modal-header">
              <div>
                <h2>Prescription #{selectedRx.id}</h2>
                <div className="modal-kicker">Clinical prescription summary</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn-cancel"
                  style={{ padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <FiPrinter size={14} />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSendWhatsApp(selectedRx.id)}
                  className="btn-submit"
                  style={{ background: "#126868" }}
                >
                  <FiSend size={13} />
                  <span>Send WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRx(null)}
                  className="modal-close"
                >
                  <FiX size={18} />
                </button>
              </div>
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
                  <div className="text-xs font-bold text-slate-800">{selectedRx.doctor_name}</div>
                  <div className="text-[11px] text-[#254d90]">{selectedRx.doctor_specialty}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 font-semibold">Patient:</span>{" "}
                  <strong className="text-slate-900">{selectedRx.patient_name}</strong> ({selectedRx.patient_phone})
                </div>
                <div className="text-right flex items-center justify-end gap-2">
                  <div>
                    <span className="text-slate-400 font-semibold">Date:</span>{" "}
                    <strong>{selectedRx.created_date_display}</strong>
                  </div>
                  {selectedRx.prescription_mode === "QUICK_REFILL" ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                      Direct Refill
                    </span>
                  ) : selectedRx.prescription_mode === "TELE_CONSULT" ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                      Teleconsult
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                      In-Person
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs">
                <span className="font-bold text-slate-700">Diagnosis:</span>{" "}
                <strong className="text-slate-900">{selectedRx.diagnosis}</strong>
              </div>

              {/* Medicines List Split by Section A (Clinic) and Section B (Outside Chemist) */}
              {(() => {
                const allMeds = selectedRx.medicines || [];
                const clinicMeds = allMeds.filter((m) => (m.fulfillment || "CLINIC").toUpperCase() === "CLINIC");
                const outsideMeds = allMeds.filter((m) => (m.fulfillment || "").toUpperCase() === "OUTSIDE");

                const renderMedTable = (items, badgeText, badgeClass, subText) => (
                  <div className="space-y-1.5 pt-2">
                    <div className="flex items-center justify-between border-b pb-1">
                      <span className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass}`}>{badgeText}</span>
                      </span>
                      {subText && <span className="text-[11px] text-slate-500 italic">{subText}</span>}
                    </div>
                    <div className="data-grid-container" style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                      <table className="data-grid-table" style={{ width: "100%" }}>
                        <thead>
                          <tr>
                            <th style={{ fontSize: "12px" }}>Medicine</th>
                            <th style={{ fontSize: "12px" }}>Dosage</th>
                            <th style={{ fontSize: "12px" }}>Duration</th>
                            <th style={{ fontSize: "12px" }}>Instruction</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((m, i) => (
                            <tr key={i}>
                              <td style={{ fontSize: "12px" }} className="font-bold text-slate-900">{m.name}</td>
                              <td style={{ fontSize: "12px" }} className="font-mono text-slate-700">{m.dosage}</td>
                              <td style={{ fontSize: "12px" }} className="text-slate-700">{m.duration}</td>
                              <td style={{ fontSize: "12px" }} className="text-slate-500 italic">{m.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );

                if (clinicMeds.length > 0 && outsideMeds.length > 0) {
                  return (
                    <div className="space-y-4">
                      {renderMedTable(
                        clinicMeds,
                        "SECTION A: CLINIC IN-HOUSE PHARMACY",
                        "bg-blue-100 text-[#1a56db] border border-blue-200",
                        "Dispense & collect from clinic pharmacy desk"
                      )}
                      {renderMedTable(
                        outsideMeds,
                        "SECTION B: OUTSIDE RETAIL CHEMIST",
                        "bg-amber-100 text-amber-800 border border-amber-300",
                        "Purchase from any licensed retail pharmacy"
                      )}
                    </div>
                  );
                }

                if (outsideMeds.length > 0 && clinicMeds.length === 0) {
                  return renderMedTable(
                    outsideMeds,
                    "OUTSIDE RETAIL CHEMIST PRESCRIPTION",
                    "bg-amber-100 text-amber-800 border border-amber-300",
                    "Purchase from any licensed retail pharmacy"
                  );
                }

                return renderMedTable(
                  clinicMeds.length > 0 ? clinicMeds : allMeds,
                  "CLINIC IN-HOUSE PHARMACY PRESCRIPTION",
                  "bg-blue-100 text-[#1a56db] border border-blue-200",
                  "Dispense & collect from clinic pharmacy desk"
                );
              })()}

              {selectedRx.advice && (
                <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100 text-xs">
                  <strong className="text-[#254d90]">Doctor's Advice:</strong> {selectedRx.advice}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setSelectedRx(null)}
                className="btn-cancel"
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
