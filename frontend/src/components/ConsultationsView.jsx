import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FiActivity,
  FiSearch,
  FiPlus,
  FiCheckCircle,
  FiPrinter,
  FiX,
  FiFileText,
  FiLock,
  FiRotateCw,
  FiUserCheck,
  FiPhone,
  FiEdit3,
  FiEye,
  FiCheck,
  FiTrash2,
  FiCalendar,
  FiAlertTriangle,
  FiDollarSign,
  FiExternalLink,
  FiLayers,
  FiXCircle,
} from "react-icons/fi";
import PortalHeader from "./portalheader/PortalHeader";
import StatCard from "./statcard/StatCard";
import ModuleWriternHeader from "./modulewriternheader/ModuleWriternHeader";
import Pagination from "./common/Pagination";
import SearchBar from "./common/SearchBar";
import PlaceDiagnosticOrderModal from "./common/PlaceDiagnosticOrderModal";
import { useToast } from "../context/ToastContext";
import {
  fetchConsultations,
  fetchConsultation,
  fetchConsultationOptions,
  addConsultationLabTest,
  startConsultation,
  updateConsultationDraft,
  finalizeConsultation,
  cancelConsultation,
  calculateConsultationVitals,
  fetchDoctors,
  fetchPatients,
  createPrescription,
  fetchPharmacyMedicines
} from "../api";

export default function ConsultationsView() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const autoOpenedRef = useRef("");
  const [consultations, setConsultations] = useState([]);
  const [stats, setStats] = useState(null);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  // Consultation Sub-Section Tabs: 'active' (In Consultation), 'completed' (Signed), 'cancelled', 'all'
  const [consultationTab, setConsultationTab] = useState("active");

  const tabFilteredConsultations = useMemo(() => {
    if (consultationTab === "active") {
      return consultations.filter((c) => c.status === "IN_CONSULTATION");
    }
    if (consultationTab === "completed") {
      return consultations.filter((c) => c.status === "COMPLETED");
    }
    if (consultationTab === "cancelled") {
      return consultations.filter((c) => c.status === "CANCELLED");
    }
    return consultations;
  }, [consultations, consultationTab]);

  const activeEncountersCount = useMemo(
    () => consultations.filter((c) => c.status === "IN_CONSULTATION").length,
    [consultations]
  );
  const completedEncountersCount = useMemo(
    () => consultations.filter((c) => c.status === "COMPLETED").length,
    [consultations]
  );
  const cancelledEncountersCount = useMemo(
    () => consultations.filter((c) => c.status === "CANCELLED").length,
    [consultations]
  );
  const totalEncountersCount = consultations.length;

  // Pagination (20 entries per page default from LRS)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const paginatedConsultations = useMemo(() => {
    if (pageSize === "all") return tabFilteredConsultations;
    const start = (currentPage - 1) * pageSize;
    return tabFilteredConsultations.slice(start, start + pageSize);
  }, [tabFilteredConsultations, currentPage, pageSize]);
  const [search, setSearch] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");

  // Encounter Details Modal
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Encounter Workspace Modal
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [encounterData, setEncounterData] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'finalize' | 'cancel', encounterId, patientName }

  // In-Place Diagnostic Order Modal
  const [isLabOrderModalOpen, setIsLabOrderModalOpen] = useState(false);
  const [labOrderModalData, setLabOrderModalData] = useState(null);

  // New Consultation Start Modal
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [startForm, setStartForm] = useState({
    patient_id: "",
    doctor_id: "",
    visit_type: "General Consultation",
    chief_complaint: "",
    diagnosis: "Pending Clinical Evaluation",
  });

  // Default Standard Vitals (Equal grid space, flexible)
  const DEFAULT_VITAL_FIELDS = [
    { id: "bp", label: "BP (mmHg)", placeholder: "e.g. 120/80", type: "text" },
    { id: "pulse", label: "Pulse (bpm)", placeholder: "e.g. 76", type: "number" },
    { id: "temp", label: "Temp (°F)", placeholder: "e.g. 98.4", type: "number", step: "0.1" },
    { id: "spo2", label: "SpO2 (%)", placeholder: "e.g. 99", type: "number" },
    { id: "resp_rate", label: "Resp (/min)", placeholder: "e.g. 18", type: "number" },
    { id: "height", label: "Height (cm)", placeholder: "e.g. 172", type: "number" },
    { id: "weight", label: "Weight (kg)", placeholder: "e.g. 70", type: "number" },
  ];

  const PRESET_VITALS = [
    { id: "blood_sugar", label: "Blood Sugar (GRBS)", placeholder: "110", type: "number" },
    { id: "pain_score", label: "Pain Score (1-10)", placeholder: "0", type: "number" },
    { id: "waist_circ", label: "Waist Circ (cm)", placeholder: "85", type: "number" },
    { id: "head_circ", label: "Head Circ (cm)", placeholder: "54", type: "number" },
    { id: "fasting_sugar", label: "Fasting Sugar (mg/dL)", placeholder: "95", type: "number" },
    { id: "pp_sugar", label: "PP Sugar (mg/dL)", placeholder: "135", type: "number" },
    { id: "hemoglobin", label: "Hemoglobin (g/dL)", placeholder: "14.2", type: "number", step: "0.1" },
  ];

  const [activeVitalFields, setActiveVitalFields] = useState(DEFAULT_VITAL_FIELDS);
  const [isAddVitalOpen, setIsAddVitalOpen] = useState(false);
  const [customVitalInput, setCustomVitalInput] = useState({ name: "", unit: "" });

  // Security pass state for deleting vital signs
  const [deleteVitalTarget, setDeleteVitalTarget] = useState(null);
  const [deletePassInput, setDeletePassInput] = useState("");
  const [deletePassError, setDeletePassError] = useState("");

  const [isAddTestOpen, setIsAddTestOpen] = useState(false);
  const [newTestName, setNewTestName] = useState("");
  const [savingNewTest, setSavingNewTest] = useState(false);

  // Clinical Draft Form in Workspace (Empty vitals by default - 100% Optional / On-Demand)
  const [clinicalForm, setClinicalForm] = useState({
    chief_complaint: "",
    hpi: "",
    vitals: {},
    clinical_examination: "",
    diagnosis: "",
    differential_diagnosis: "",
    treatment_plan: "",
    lab_tests: "",
    advice: "",
    follow_up_date: "",
    follow_up_instructions: "",
  });

  const handleAddLabTest = (testName) => {
    setClinicalForm((prev) => {
      const current = prev.lab_tests ? prev.lab_tests.trim() : "";
      if (current.toLowerCase().includes(testName.toLowerCase())) return prev;
      const updated = current ? `${current}, ${testName}` : testName;
      return { ...prev, lab_tests: updated };
    });
  };

  const handleRemoveLabTest = (testNameToRemove) => {
    setClinicalForm((prev) => {
      const current = prev.lab_tests
        ? prev.lab_tests.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const updated = current.filter((t) => t.toLowerCase() !== testNameToRemove.toLowerCase()).join(", ");
      return { ...prev, lab_tests: updated };
    });
  };

  const parsedLabTests = useMemo(() => {
    if (!clinicalForm.lab_tests || !clinicalForm.lab_tests.trim()) return [];
    return clinicalForm.lab_tests
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [clinicalForm.lab_tests]);

  const handleAddVitalField = (field) => {
    if (activeVitalFields.some((v) => v.id === field.id)) {
      showToast(`'${field.label}' is already in this consultation`, "info");
      return;
    }
    setActiveVitalFields((prev) => [...prev, field]);
    setClinicalForm((prev) => ({
      ...prev,
      vitals: {
        ...prev.vitals,
        [field.id]: prev.vitals?.[field.id] || "",
      },
    }));
    setIsAddVitalOpen(false);
  };

  const handleCreateCustomVital = (e) => {
    e.preventDefault();
    if (!customVitalInput.name.trim()) {
      showToast("Please enter a vital sign name", "error");
      return;
    }
    const cleanName = customVitalInput.name.trim();
    const cleanUnit = customVitalInput.unit.trim();
    const label = cleanUnit ? `${cleanName} (${cleanUnit})` : cleanName;
    const id = cleanName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    handleAddVitalField({
      id,
      label,
      placeholder: cleanUnit ? `in ${cleanUnit}` : "—",
      type: "text",
    });
    setCustomVitalInput({ name: "", unit: "" });
  };

  const handleDeleteVitalField = (vitalId) => {
    setActiveVitalFields((prev) => prev.filter((v) => v.id !== vitalId));
    setClinicalForm((prev) => {
      const copy = { ...prev.vitals };
      delete copy[vitalId];
      return { ...prev, vitals: copy };
    });
  };

  const handleConfirmDeleteVital = (e) => {
    e.preventDefault();
    if (!deleteVitalTarget) return;
    handleDeleteVitalField(deleteVitalTarget.id);
    showToast(`Vital '${deleteVitalTarget.label}' removed from consultation form`, "success");
    setDeleteVitalTarget(null);
    setDeletePassInput("");
    setDeletePassError("");
  };

  // 1-Click Normal Baseline Vitals Shortcut
  const handleSetQuickNormal = () => {
    setClinicalForm((prev) => ({
      ...prev,
      vitals: {
        ...prev.vitals,
        bp: "120/80",
        pulse: 72,
        temp: 98.4,
        spo2: 99,
        resp_rate: 18,
      },
    }));
    showToast("Applied standard normal baseline vitals (BP: 120/80, Pulse: 72, Temp: 98.4, SpO2: 99)", "info");
  };

  // 1-Click Clear / Skip Vitals for Routine / Follow-up Visits
  const handleClearVitals = () => {
    setClinicalForm((prev) => ({
      ...prev,
      vitals: {},
    }));
    showToast("Vitals cleared — skipped for this routine / follow-up visit", "info");
  };

  const handleCreateNewTest = async (e) => {
    e.preventDefault();
    if (!newTestName.trim()) {
      showToast("Please enter diagnostic test name", "error");
      return;
    }
    setSavingNewTest(true);
    try {
      const res = await addConsultationLabTest(newTestName.trim());
      showToast(res.message || "Test added to catalogue!", "success");
      if (res.all_tests) {
        setOptions((prev) => ({ ...prev, lab_tests: res.all_tests }));
      }
      handleAddLabTest(newTestName.trim());
      setNewTestName("");
      setIsAddTestOpen(false);
    } catch (err) {
      showToast(err.message || "Failed to add test", "error");
    } finally {
      setSavingNewTest(false);
    }
  };

  // In-Workspace Prescription (Rx) Writer State
  const [isRxWriterOpen, setIsRxWriterOpen] = useState(false);
  const [rxMeds, setRxMeds] = useState([]);
  const [savingRx, setSavingRx] = useState(false);
  const [medCatalogue, setMedCatalogue] = useState([]);
  const [activeMedRowIdx, setActiveMedRowIdx] = useState(null);

  useEffect(() => {
    fetchPharmacyMedicines({})
      .then((data) => setMedCatalogue(Array.isArray(data) ? data : data?.medicines || []))
      .catch(() => {});
  }, []);

  const handleOpenRxWriter = (targetEncounter = null) => {
    const enc = targetEncounter || encounterData;
    if (targetEncounter) {
      setEncounterData(targetEncounter);
    }
    if (enc?.linked_prescription?.medicines && enc.linked_prescription.medicines.length > 0) {
      setRxMeds(
        enc.linked_prescription.medicines.map((m) => ({
          name: m.name || "",
          dosage: m.dosage || "1-0-1",
          duration: m.duration || "5 days",
          notes: m.notes || "After food",
          fulfillment: (m.fulfillment || "CLINIC").toUpperCase(),
        }))
      );
    } else {
      setRxMeds([
        { name: "", dosage: "1-0-1", duration: "5 days", notes: "After food", fulfillment: "CLINIC" },
      ]);
    }
    setIsRxWriterOpen(true);
  };

  const handleAddMedRow = () => {
    setRxMeds((prev) => [
      ...prev,
      { name: "", dosage: "1-0-1", duration: "5 days", notes: "After food", fulfillment: "CLINIC" },
    ]);
  };

  const handleRemoveMedRow = (index) => {
    setRxMeds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateMedRow = (index, field, value) => {
    setRxMeds((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleQuickAddMed = (presetName, defaultDosage = "1-0-1", defaultNotes = "After food") => {
    setRxMeds((prev) => {
      if (prev.length === 1 && !prev[0].name.trim()) {
        return [{ name: presetName, dosage: defaultDosage, duration: "5 days", notes: defaultNotes, fulfillment: "CLINIC" }];
      }
      return [
        ...prev,
        { name: presetName, dosage: defaultDosage, duration: "5 days", notes: defaultNotes, fulfillment: "CLINIC" },
      ];
    });
  };

  const handleSaveRx = async () => {
    const validMeds = rxMeds.filter((m) => m.name && m.name.trim());
    if (validMeds.length === 0) {
      showToast("Please enter at least one medication name.", "warning");
      return;
    }
    if (!encounterData?.patient?.id || !encounterData?.doctor?.id) {
      showToast("Patient or Doctor details missing from encounter.", "error");
      return;
    }

    setSavingRx(true);
    try {
      const payload = {
        id: encounterData.linked_prescription?.id || undefined,
        patient_id: encounterData.patient.id,
        patient_name: encounterData.patient.name,
        patient_phone: encounterData.patient.phone,
        doctor_id: encounterData.doctor.id,
        encounter_id: encounterData.id,
        appointment_id: encounterData.appointment_id || undefined,
        diagnosis: clinicalForm.diagnosis || encounterData.diagnosis || "Provisional Clinical Evaluation",
        symptoms: clinicalForm.chief_complaint || encounterData.chief_complaint || "",
        medicines: validMeds,
        lab_tests: clinicalForm.lab_tests || encounterData.lab_tests || "",
        advice: clinicalForm.advice || encounterData.advice || "",
        vitals: clinicalForm.vitals || encounterData.vitals || {},
      };
      const res = await createPrescription(payload);

      const updatedPrescription = {
        id: res.id,
        prescription_uid: res.prescription_uid,
        medicines: validMeds,
        advice: clinicalForm.advice || encounterData.advice,
      };

      setEncounterData((prev) => prev ? ({
        ...prev,
        linked_prescription: updatedPrescription,
      }) : null);

      setSelectedDetails((prev) => prev ? ({
        ...prev,
        linked_prescription: updatedPrescription,
      }) : null);

      // Also append summary to treatment plan if empty
      if (!clinicalForm.treatment_plan || !clinicalForm.treatment_plan.trim()) {
        const medSummary = validMeds.map((m) => `${m.name} (${m.dosage}, ${m.duration})`).join("; ");
        setClinicalForm((prev) => ({
          ...prev,
          treatment_plan: `Rx: ${medSummary}`,
        }));
      }

      setIsRxWriterOpen(false);
      const isCompleted = encounterData.is_finalised || encounterData.status === "COMPLETED";
      showToast(
        isCompleted
          ? "Prescription updated successfully!"
          : "Prescription attached to clinical draft! Click 'Finalize & Sign' when ready to issue to pharmacy.",
        "success"
      );
      loadData(search, statusFilter, doctorFilter, true);
    } catch (err) {
      showToast(err.message || "Failed to save prescription", "error");
    } finally {
      setSavingRx(false);
    }
  };

  const handleQuickFollowUp = (days) => {
    if (days === "sos") {
      setClinicalForm((prev) => ({
        ...prev,
        follow_up_instructions: prev.follow_up_instructions
          ? `${prev.follow_up_instructions}. SOS if symptoms worsen`
          : "SOS / As Needed if symptoms persist",
      }));
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + days);
    const dateStr = d.toISOString().split("T")[0];
    setClinicalForm((prev) => ({
      ...prev,
      follow_up_date: dateStr,
    }));
  };

  // Load backend options once on mount
  useEffect(() => {
    fetchConsultationOptions()
      .then((data) => setOptions(data))
      .catch((err) => console.warn("Failed to load consultation options:", err));
  }, []);

  const handleOpenDetails = async (encounterId) => {
    if (!encounterId) return;
    setIsDetailModalOpen(true);
    setLoadingDetails(true);
    try {
      const data = await fetchConsultation(encounterId);
      setSelectedDetails(data);
    } catch (err) {
      console.error("Failed to load consultation encounter details:", err);
      showToast("Failed to load encounter details: " + err.message, "error");
      setIsDetailModalOpen(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const loadData = async (query = search, status = statusFilter, doctorId = doctorFilter, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [cData, dData, pData] = await Promise.all([
        fetchConsultations({
          search: query,
          status: status,
          doctor_id: doctorId,
        }),
        fetchDoctors(true),
        fetchPatients(),
      ]);
      const list = cData.consultations || [];
      setConsultations(list);
      if (cData.stats) {
        setStats(cData.stats);
      }
      setDoctors(dData || []);
      setPatients(pData.patients || []);
    } catch (err) {
      console.error("Consultations load error:", err);
      showToast("Failed to load consultation records: " + err.message, "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(search, statusFilter, doctorFilter);

    // Auto-refresh every 5 seconds across portal
    const interval = setInterval(() => {
      if (!isWorkspaceOpen && !isStartOpen && !isDetailModalOpen) {
        loadData(search, statusFilter, doctorFilter, true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [statusFilter, doctorFilter, isWorkspaceOpen, isStartOpen, isDetailModalOpen]);

  // Pre-fill or Auto-Open from query params if coming from Waiting Room Queue, Appointments, or Prescriptions
  useEffect(() => {
    const encId = searchParams.get("encounter_id");
    const openRx = searchParams.get("open_rx") === "true";
    const autoOpen = searchParams.get("auto_open") === "true";

    if (encId) {
      const requestKey = `enc-${encId}-${openRx}-${autoOpen}`;
      if (autoOpenedRef.current === requestKey) return;
      autoOpenedRef.current = requestKey;

      navigate("/consultations", { replace: true });
      (async () => {
        try {
          const enc = await fetchConsultation(encId);
          if (enc) {
            setEncounterData(enc);
            setSelectedDetails(enc);
            if (openRx) {
              handleOpenRxWriter(enc);
            } else {
              await openWorkspace(enc.id);
            }
          }
        } catch (err) {
          console.error("Auto-open consultation encounter error:", err);
        }
      })();
      return;
    }

    const ptId = searchParams.get("patient_id");
    const docId = searchParams.get("doctor_id");
    const apptId = searchParams.get("appointment_id");

    if (!ptId) return;

    // Guard against repeated executions for the same param request
    const requestKey = `${ptId}-${apptId || ""}-${docId || ""}-${autoOpen}`;
    if (autoOpenedRef.current === requestKey) return;
    autoOpenedRef.current = requestKey;

    const effectiveDocId = docId || (doctors[0]?.id ? String(doctors[0].id) : "1");
    const effectiveApptId = apptId ? parseInt(apptId) : null;

    if (autoOpen || effectiveApptId) {
      // Clear query params to prevent re-triggering loop and keep clean URL
      navigate("/consultations", { replace: true });

      // Automatically start or resume clinical session and open workspace modal
      (async () => {
        try {
          const res = await startConsultation({
            patient_id: parseInt(ptId),
            doctor_id: parseInt(effectiveDocId || "1"),
            appointment_id: effectiveApptId,
            visit_type: "General Consultation",
            diagnosis: "Clinical Evaluation in Progress",
          });
          if (res.encounter_id) {
            await openWorkspace(res.encounter_id);
            // Silent refresh of consultation list in the background without blinking
            loadData(search, statusFilter, doctorFilter, true);
          }
        } catch (err) {
          console.error("Auto-open consultation workspace error:", err);
          setStartForm({
            patient_id: ptId,
            doctor_id: effectiveDocId,
            appointment_id: effectiveApptId,
            visit_type: "General Consultation",
            chief_complaint: "",
            diagnosis: "Pending Clinical Evaluation",
          });
          setIsStartOpen(true);
        }
      })();
    } else {
      setStartForm((prev) => ({
        ...prev,
        patient_id: ptId,
        doctor_id: effectiveDocId,
        appointment_id: effectiveApptId,
      }));
      setIsStartOpen(true);
    }
  }, [searchParams]);

  const handleStartConsultation = async (e) => {
    e.preventDefault();
    if (!startForm.patient_id || !startForm.doctor_id) {
      showToast("Please select both a patient and attending doctor.", "error");
      return;
    }

    try {
      const res = await startConsultation({
        patient_id: parseInt(startForm.patient_id),
        doctor_id: parseInt(startForm.doctor_id),
        appointment_id: startForm.appointment_id,
        visit_type: startForm.visit_type,
        chief_complaint: startForm.chief_complaint,
        diagnosis: startForm.diagnosis || "Initial Clinical Evaluation",
      });
      setIsStartOpen(false);
      showToast(res.message || "Consultation started successfully!", "success");
      loadData(search, statusFilter, doctorFilter, true);
      // Directly open clinical encounter workspace
      openWorkspace(res.encounter_id);
    } catch (err) {
      showToast("Failed to start consultation: " + err.message, "error");
    }
  };

  const openWorkspace = async (encounterId) => {
    setIsWorkspaceOpen(true);
    try {
      const data = await fetchConsultation(encounterId);
      setEncounterData(data);
      setSelectedDetails(data);

      const existingVitals = data.vitals || {};
      const baseVitals = options?.default_vitals || DEFAULT_VITAL_FIELDS;
      const initialFields = [...baseVitals];

      // Dynamically restore any extra vitals recorded previously
      Object.keys(existingVitals).forEach((k) => {
        if (k === "bmi" || k === "bmi_category") return;
        if (!initialFields.some((f) => f.id === k)) {
          const preset = PRESET_VITALS.find((p) => p.id === k);
          initialFields.push(
            preset || {
              id: k,
              label: k.replace(/_/g, " ").toUpperCase(),
              placeholder: "—",
              type: "text",
            }
          );
        }
      });
      setActiveVitalFields(initialFields);

      setClinicalForm({
        chief_complaint: data.chief_complaint || "",
        hpi: data.hpi || "",
        vitals: existingVitals,
        clinical_examination: data.clinical_examination || "",
        diagnosis: data.diagnosis || "",
        differential_diagnosis: data.differential_diagnosis || "",
        treatment_plan: data.treatment_plan || "",
        lab_tests: data.lab_tests || "",
        advice: data.advice || "",
        follow_up_date: data.follow_up_date || "",
        follow_up_instructions: data.follow_up_instructions || "",
      });
    } catch (err) {
      showToast("Failed to load encounter workspace: " + err.message, "error");
      setIsWorkspaceOpen(false);
    }
  };

  // Flexible Vitals Update
  const handleVitalsChange = (field, val) => {
    setClinicalForm((prev) => ({
      ...prev,
      vitals: {
        ...prev.vitals,
        [field]: val,
      },
    }));
  };

  const handleSaveDraft = async () => {
    if (!encounterData?.id) return;
    setSavingDraft(true);
    try {
      const res = await updateConsultationDraft(encounterData.id, clinicalForm);
      showToast(res.message || "Clinical notes draft saved successfully!", "success");
      const refreshed = await fetchConsultation(encounterData.id);
      setEncounterData(refreshed);
      setSelectedDetails(refreshed);
      loadData(search, statusFilter, doctorFilter, true);
    } catch (err) {
      showToast(err.message || "Failed to save draft", "error");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleFinalize = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!encounterData?.id) return;
    setConfirmAction({ type: "finalize" });
  };

  const executeFinalize = async () => {
    if (!encounterData?.id) return;
    setFinalizing(true);
    setConfirmAction(null);
    try {
      // First save current edits
      await updateConsultationDraft(encounterData.id, clinicalForm);
      // Finalize and lock on server
      const res = await finalizeConsultation(encounterData.id, encounterData?.doctor?.name || "Attending Doctor");
      showToast(res.message || "Encounter signed and completed! Appointment status updated.", "success");
      setIsWorkspaceOpen(false);
      loadData(search, statusFilter, doctorFilter);
    } catch (err) {
      showToast(err.message || "Could not finalize consultation", "error");
    } finally {
      setFinalizing(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCloseWorkspace = () => {
    setIsWorkspaceOpen(false);
    setConsultationTab("active");
    loadData(search, statusFilter, doctorFilter, true);
  };

  const handleCancelConsultation = (encounterId, patientName) => {
    if (!encounterId) return;
    setConfirmAction({
      type: "cancel",
      encounterId,
      patientName: patientName || encounterData?.patient?.name || "this patient",
    });
  };

  const executeCancelConsultation = async () => {
    if (!confirmAction?.encounterId) return;
    const { encounterId } = confirmAction;
    setConfirmAction(null);
    try {
      const res = await cancelConsultation(encounterId);
      showToast(res.message || "Consultation cancelled. Patient returned to waiting queue.", "info");
      if (isWorkspaceOpen && encounterData?.id === encounterId) {
        setIsWorkspaceOpen(false);
      }
      loadData(search, statusFilter, doctorFilter, true);
    } catch (err) {
      console.error("Cancel consultation error:", err);
      showToast(err.message || "Failed to cancel consultation", "error");
    }
  };

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    loadData(search, statusFilter, doctorFilter);
  };

  const handleClearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setDoctorFilter("");
    loadData("", "", "");
  };

  const hasActiveFilters = Boolean(search || statusFilter || doctorFilter);

  // Active encounter and clinical data to render on the official printable prescription
  const activePrintEncounter = isDetailModalOpen && selectedDetails ? selectedDetails : encounterData;
  const activePrintForm = isDetailModalOpen && selectedDetails ? {
    vitals: selectedDetails.vitals || {},
    chief_complaint: selectedDetails.chief_complaint,
    clinical_examination: selectedDetails.clinical_examination,
    diagnosis: selectedDetails.diagnosis,
    differential_diagnosis: selectedDetails.differential_diagnosis,
    lab_tests: selectedDetails.lab_tests,
    treatment_plan: selectedDetails.treatment_plan,
    advice: selectedDetails.advice,
    follow_up_date: selectedDetails.follow_up_date,
    follow_up_instructions: selectedDetails.follow_up_instructions,
  } : clinicalForm;

  return (
    <div className="space-y-6">
      {/* Portal Header */}
      <PortalHeader
        kicker="Clinical Workspace"
        title="Doctor Consultation & Clinical Notes"
        icon={FiActivity}
        rightAction={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => loadData(search, statusFilter, doctorFilter)}
              disabled={loading}
              className="portal-refresh-btn"
              title="Refresh Consultations Data"
            >
              <FiRotateCw className={`refresh-icon ${loading ? "spinning" : ""}`} size={15} />
            </button>
            <button
              onClick={() => setIsStartOpen(true)}
              className="portal-action-btn flex items-center gap-1.5"
            >
              <FiPlus size={16} />
              <span>Start Consultation</span>
            </button>
          </div>
        }
      />

      {/* KPI Cards (aerostate-lrs Reusable Grid - Driven by Server) */}
      <div className="dir-stats-grid">
        <StatCard
          title="In Consultation"
          value={stats?.in_consultation ?? 0}
          Icon={FiActivity}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Completed Today"
          value={stats?.completed_today ?? 0}
          Icon={FiCheckCircle}
          colorTheme="brand-teal"
        />
        <StatCard
          title="Total Consultations"
          value={stats?.total_consultations ?? consultations.length}
          Icon={FiFileText}
          colorTheme="brand-blue"
        />
        <StatCard
          title="Specialists on Duty"
          value={stats?.active_specialists ?? doctors.length}
          Icon={FiUserCheck}
          colorTheme="brand-teal"
        />
      </div>

      {/* Standard LRS Module Roster Section */}
      <section className="dir-modules-section">
        <ModuleWriternHeader
          title={
            consultationTab === "completed"
              ? "Completed Doctor Consultations"
              : consultationTab === "cancelled"
              ? "Cancelled Consultations"
              : consultationTab === "active"
              ? "Active Consultation OPD Room"
              : "Master Consultation History"
          }
          description={
            consultationTab === "completed"
              ? "Verified record of signed clinical consultations ready for pharmacy dispensing, lab testing, and cashier settlement."
              : consultationTab === "cancelled"
              ? "Record of cancelled consultations. Patients were returned to the waiting queue or unassigned."
              : consultationTab === "active"
              ? "Live in-progress patient clinical consultations. Click 'Take' to resume examination, order tests, or formulate clinical advice."
              : "Comprehensive audit log of all OPD clinical encounters, active symptoms, and specialist medical diagnoses."
          }
          badgeCount={tabFilteredConsultations.length}
          badgeLabel={
            consultationTab === "completed"
              ? "completed checkups"
              : consultationTab === "cancelled"
              ? "cancelled"
              : consultationTab === "active"
              ? "in consultation"
              : "total encounters"
          }
        />

        {/* Consultation Sub-Section Tabs (Positioned below Section Header & Description) */}
        <div className="wa-tabs-container">
          <button
            type="button"
            onClick={() => {
              setConsultationTab("active");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${consultationTab === "active" ? "active" : ""}`}
          >
            <FiActivity size={15} />
            <span>Active Encounters ({activeEncountersCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConsultationTab("completed");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${consultationTab === "completed" ? "active" : ""}`}
          >
            <FiCheckCircle size={15} />
            <span>Completed Checkups ({completedEncountersCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConsultationTab("cancelled");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${consultationTab === "cancelled" ? "active" : ""}`}
          >
            <FiX size={15} />
            <span>Cancelled ({cancelledEncountersCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConsultationTab("all");
              setCurrentPage(1);
            }}
            className={`wa-tab-btn ${consultationTab === "all" ? "active" : ""}`}
          >
            <FiFileText size={15} />
            <span>All Consultations ({totalEncountersCount})</span>
          </button>
        </div>

        {/* CONTROLS & TOOLBAR */}
        <div className="dir-controls">
          <SearchBar
            placeholder="Search by Patient Name, Phone, UID, Doctor, or Diagnosis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={handleSearchSubmit}
            onClear={() => {
              setSearch("");
              loadData("", statusFilter, doctorFilter);
            }}
          />

          <div className="dir-toolbar-right">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="dir-filter-select"
            >
              <option value="">All Statuses</option>
              <option value="IN_CONSULTATION">In Consultation</option>
              <option value="COMPLETED">Completed</option>
            </select>

            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="dir-filter-select"
            >
              <option value="">All Specialists</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
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

            {hasActiveFilters && (
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

        {/* Consultations Data Grid Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]" />
          </div>
        ) : consultations.length === 0 ? (
          <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
            <FiActivity className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-800">No consultation encounters found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Start by recording or opening a new doctor clinical consultation session.
            </p>
            <button
              onClick={() => setIsStartOpen(true)}
              className="mt-4 portal-action-btn portal-action-btn-blue inline-flex items-center gap-1.5"
            >
              <FiPlus size={15} />
              <span>Start First Consultation</span>
            </button>
          </div>
        ) : (
          <div className="dir-table-wrapper">
            <div className="dir-scroll-bar-header">
              <span className="dir-scroll-hint">⇄ Master Consultation Encounters (Scroll horizontally to view all columns)</span>
              <span className="text-xs font-semibold text-slate-500">
                Showing {consultations.length} encounter record{consultations.length === 1 ? "" : "s"}
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
              <table className="data-grid-table" style={{ minWidth: "1650px", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ENCOUNTER #</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT ID</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>PATIENT NAME</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>SPECIALIST</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>VISIT TYPE</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DIAGNOSIS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>ORDERED TESTS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>STATUS</th>
                    <th style={{ fontSize: "12px", whiteSpace: "nowrap" }}>DATE</th>
                    <th style={{ width: "350px", minWidth: "350px", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "14px" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedConsultations.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => handleOpenDetails(c.id)}
                      className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                    >
                      {/* Encounter # */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                          {c.encounter_uid}
                        </span>
                      </td>

                      {/* Patient ID */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-mono text-xs font-semibold text-[#254d90] bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200/60 inline-block">
                          {c.patient_uid || (c.patient_id ? `PAT-${String(c.patient_id).padStart(4, "0")}` : "—")}
                        </span>
                      </td>

                      {/* Patient Name */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="font-bold text-slate-900">{c.patient_name}</div>
                      </td>

                      {/* Specialist */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="font-semibold text-slate-900">{c.doctor_name}</span>
                        {c.specialization && (
                          <span className="text-slate-500 ml-1.5 font-normal">
                            ({c.specialization})
                          </span>
                        )}
                      </td>

                      {/* Visit Type */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-700 font-medium">{c.visit_type}</span>
                      </td>

                      {/* Diagnosis */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <div className="font-semibold text-slate-800 line-clamp-1 max-w-[200px]" title={c.diagnosis}>
                          {c.diagnosis || "Pending Evaluation"}
                        </div>
                      </td>

                      {/* Ordered Tests */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        {c.lab_tests ? (
                          <span className="text-slate-800 font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded border border-slate-200 max-w-[200px] truncate inline-block" title={c.lab_tests}>
                            {c.lab_tests}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs italic">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border ${
                            c.status === "COMPLETED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : c.status === "CANCELLED"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-teal-50 text-teal-800 border-teal-200"
                          }`}
                          style={{ fontSize: "11px" }}
                        >
                          <span>
                            {c.status === "COMPLETED"
                              ? "Completed"
                              : c.status === "CANCELLED"
                              ? "Cancelled"
                              : "In Consultation"}
                          </span>
                        </span>
                      </td>

                      {/* Date */}
                      <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
                        <span className="text-slate-700 font-mono">
                          {c.consultation_date}
                        </span>
                      </td>

                      {/* Actions: 3 Columns x 2 Rows + 7th Action Button (Matching Appointments & Prescriptions Section) */}
                      <td style={{ fontSize: "12px", textAlign: "left", whiteSpace: "nowrap", borderRight: "1px solid #e2e8f0", paddingRight: "12px" }}>
                        <div
                          className="flex items-center gap-1.5 flex-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Column 1: Primary Clinical Action (w-[88px]) */}
                          <div className="flex flex-col gap-1 w-[88px]">
                            {/* Top: Take Workspace OR Notes */}
                            {c.status === "IN_CONSULTATION" && !c.is_finalised ? (
                              <button
                                type="button"
                                title="Take Consultation (Open Clinical Workspace)"
                                onClick={() => openWorkspace(c.id)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                              >
                                <FiEdit3 size={11} />
                                <span>Take</span>
                              </button>
                            ) : c.is_finalised ? (
                              <button
                                type="button"
                                title="View & Edit Clinical Notes"
                                onClick={() => openWorkspace(c.id)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded bg-[#254d90] text-white hover:bg-[#1b396b] shadow-xs transition cursor-pointer"
                              >
                                <FiFileText size={11} />
                                <span>Notes</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Open Consultation Workspace"
                                onClick={() => openWorkspace(c.id)}
                                className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                              >
                                <FiEdit3 size={11} className="text-[#254d90]" />
                                <span>Workspace</span>
                              </button>
                            )}

                            {/* Bottom: Quick View */}
                            <button
                              type="button"
                              title="View Consultation Summary & Details"
                              onClick={() => handleOpenDetails(c.id)}
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                            >
                              <FiEye size={11} className="text-[#254d90]" />
                              <span>View</span>
                            </button>
                          </div>

                          {/* Column 2: Clinical ERP - Rx & Lab (w-[80px]) */}
                          <div className="flex flex-col gap-1 w-[80px]">
                            {/* Top: Digital Prescription */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/prescriptions?encounter_id=${c.id}&patient_phone=${encodeURIComponent(
                                    c.patient_phone || ""
                                  )}&patient_name=${encodeURIComponent(c.patient_name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 shadow-xs transition cursor-pointer"
                              title="Write or View Digital Prescription"
                            >
                              <FiFileText size={11} className="text-emerald-600" />
                              <span>Rx</span>
                            </button>

                            {/* Bottom: Diagnostics / Lab */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/laboratory?search=${encodeURIComponent(c.patient_phone || c.patient_name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 shadow-xs transition cursor-pointer"
                              title="Order or Track Diagnostic Tests"
                            >
                              <FiLayers size={11} className="text-[#254d90]" />
                              <span>Lab</span>
                            </button>
                          </div>

                          {/* Column 3: Patient Chart & Billing (w-[80px]) */}
                          <div className="flex flex-col gap-1 w-[80px]">
                            {/* Top: 360° Medical Chart */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/patients?search=${encodeURIComponent(c.patient_phone || c.patient_name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                              title="Open 360° Patient Medical History"
                            >
                              <FiActivity size={11} className="text-[#254d90]" />
                              <span>Chart</span>
                            </button>

                            {/* Bottom: Billing */}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/billing?patient_phone=${encodeURIComponent(
                                    c.patient_phone || ""
                                  )}&patient_name=${encodeURIComponent(c.patient_name || "")}`
                                )
                              }
                              className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-semibold rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-xs transition cursor-pointer"
                              title="View & Generate Consultation Invoice"
                            >
                              <FiDollarSign size={11} className="text-slate-600" />
                              <span>Bill</span>
                            </button>
                          </div>

                          {/* Column 4: 7th Single Full-Height Status / Cancel Action (w-[74px]) */}
                          <div className="flex flex-col justify-center w-[74px]">
                            {c.status === "IN_CONSULTATION" && !c.is_finalised ? (
                              <button
                                type="button"
                                title="Cancel Consultation (Return Patient to Waiting Queue)"
                                onClick={() => handleCancelConsultation(c.id, c.patient_name)}
                                className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[11px] font-semibold rounded bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 shadow-xs transition cursor-pointer"
                              >
                                <FiXCircle size={14} className="text-rose-500" />
                                <span>Cancel</span>
                              </button>
                            ) : c.status === "COMPLETED" || c.is_finalised ? (
                              <div className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-[10.5px] font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <FiCheckCircle size={13} className="text-emerald-600" />
                                <span>Done</span>
                              </div>
                            ) : (
                              <div className="w-full h-[52px] flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-[10.5px] font-semibold rounded bg-slate-50 text-slate-400 border border-slate-200">
                                <span>Cancelled</span>
                              </div>
                            )}
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
              totalItems={consultations.length}
              pageSize={pageSize}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="encounters"
            />

            <div className="dir-scroll-bar-footer">
              <span className="text-xs text-slate-500 font-medium">
                Audit log of clinical encounters, active symptoms, and specialist medical diagnoses.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ======================================================== */}
      {/* 1. Consultation Details Modal (Opened on Click)         */}
      {/* ======================================================== */}
      {isDetailModalOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "780px", maxHeight: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadingDetails ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#254d90]" />
              </div>
            ) : selectedDetails ? (
              <>
                {/* Modal Header */}
                <div className="modal-header">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 style={{ fontSize: "17px" }}>Consultation Encounter</h2>
                      <span className="font-mono text-xs font-bold text-[#254d90] bg-[#254d90]/10 px-2 py-0.5 rounded">
                        {selectedDetails.encounter_uid}
                      </span>
                      <span
                        className={`badge-${selectedDetails.status === "COMPLETED" ? "active" : "blue"}`}
                      >
                        {selectedDetails.status === "COMPLETED" ? "Completed" : "In Progress"}
                      </span>
                    </div>
                    <div className="modal-kicker">
                      Date: {selectedDetails.consultation_date} • Visit Type: {selectedDetails.visit_type}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePrint}
                      className="btn-cancel"
                      style={{ padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                      title="Print Clinical Summary"
                    >
                      <FiPrinter size={15} />
                      <span>Print</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsDetailModalOpen(false)}
                      className="modal-close"
                    >
                      <FiX size={18} />
                    </button>
                  </div>
                </div>

                {/* Modal Body */}
                <div className="modal-body" style={{ gap: "16px" }}>
                  {/* Patient Profile Cardlet */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-base font-bold text-slate-900">
                          {selectedDetails.patient?.name}
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-600 mt-0.5">
                          <FiPhone size={12} className="text-[#126868]" />
                          <span>{selectedDetails.patient?.phone_display || selectedDetails.patient?.phone}</span>
                          <span>•</span>
                          <span className="text-[#254d90] font-bold">{selectedDetails.patient?.uid}</span>
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <span className="font-semibold text-slate-700">
                          {selectedDetails.patient?.age || "-"} yrs / {selectedDetails.patient?.gender || "-"}
                        </span>
                        <div className="text-[11px] text-slate-500 font-medium">
                          Blood Group: <span className="font-bold text-rose-600">{selectedDetails.patient?.blood_group || "-"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-slate-500">Attending Specialist: </span>
                        <strong className="text-slate-800">{selectedDetails.doctor?.name}</strong>
                        <span className="text-[#126868] font-medium ml-1">({selectedDetails.doctor?.specialization})</span>
                      </div>
                    </div>
                  </div>

                  {/* Vitals Signs Strip */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Vital Signs &amp; Anthropometry
                      </div>
                      {(!selectedDetails.vitals || !Object.entries(selectedDetails.vitals).some(([k, v]) => k !== "bmi" && k !== "bmi_category" && v !== "" && v !== null && v !== undefined)) && (
                        <span className="text-[11px] text-slate-400 font-medium italic">
                          Not examined / Skipped for this visit
                        </span>
                      )}
                    </div>
                    {selectedDetails.vitals && Object.entries(selectedDetails.vitals).some(([k, v]) => k !== "bmi" && k !== "bmi_category" && v !== "" && v !== null && v !== undefined) ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {selectedDetails.vitals?.bp && (
                          <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">BP (mmHg)</div>
                            <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                              {selectedDetails.vitals.bp}
                            </div>
                          </div>
                        )}
                        {selectedDetails.vitals?.pulse && (
                          <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Pulse (bpm)</div>
                            <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                              {selectedDetails.vitals.pulse}
                            </div>
                          </div>
                        )}
                        {selectedDetails.vitals?.temp && (
                          <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Temp (°F)</div>
                            <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                              {selectedDetails.vitals.temp}
                            </div>
                          </div>
                        )}
                        {selectedDetails.vitals?.spo2 && (
                          <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">SpO2 (%)</div>
                            <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                              {selectedDetails.vitals.spo2}
                            </div>
                          </div>
                        )}
                        {selectedDetails.vitals?.resp_rate && (
                          <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Resp Rate</div>
                            <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                              {selectedDetails.vitals.resp_rate}
                            </div>
                          </div>
                        )}
                        {selectedDetails.vitals?.bmi && (
                          <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-center">
                            <div className="text-[10px] uppercase font-bold text-[#254d90]">BMI (Server)</div>
                            <div className="text-xs font-mono font-bold text-[#254d90] mt-0.5">
                              {selectedDetails.vitals.bmi} {selectedDetails.vitals?.bmi_category ? `(${selectedDetails.vitals.bmi_category})` : ""}
                            </div>
                          </div>
                        )}
                        {/* Any other custom vitals */}
                        {Object.entries(selectedDetails.vitals).map(([k, v]) => {
                          if (["bp", "pulse", "temp", "spo2", "resp_rate", "bmi", "bmi_category", "height", "weight"].includes(k) || !v) return null;
                          const label = k.replace(/_/g, " ").toUpperCase();
                          return (
                            <div key={k} className="p-2.5 bg-white border border-slate-200 rounded-lg text-center">
                              <div className="text-[10px] uppercase font-bold text-slate-400 truncate">{label}</div>
                              <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">{v}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center text-xs text-slate-500 italic">
                        Routine / Follow-up examination — Vital signs not recorded for this encounter.
                      </div>
                    )}
                  </div>

                  {/* Clinical Notes Section */}
                  <div className="space-y-3 pt-1 text-xs">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                        Chief Complaint / Presentation
                      </label>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed">
                        {selectedDetails.chief_complaint || "No chief complaint recorded."}
                      </div>
                    </div>

                    {selectedDetails.hpi && (
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                          History of Present Illness (HPI)
                        </label>
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed">
                          {selectedDetails.hpi}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                        Clinical Examination & Findings
                      </label>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed min-h-[44px]">
                        {selectedDetails.clinical_examination || "No examination findings recorded yet."}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                          Primary Diagnosis
                        </label>
                        <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 font-semibold">
                          {selectedDetails.diagnosis || "Pending Evaluation"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                          Differential Diagnosis
                        </label>
                        <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-700">
                          {selectedDetails.differential_diagnosis || "None recorded"}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                        Treatment Plan & Advice
                      </label>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed min-h-[44px]">
                        {selectedDetails.treatment_plan || "No treatment instructions documented."}
                      </div>
                    </div>

                    {selectedDetails.lab_tests && (
                      <div>
                        <label className="block text-[11px] font-bold text-purple-700 uppercase tracking-wide mb-1">
                          Diagnostic Lab Tests &amp; Investigations (Ordered Tests)
                        </label>
                        <div className="p-2.5 bg-purple-50/70 border border-purple-200 rounded-lg text-purple-950 font-mono text-xs leading-relaxed">
                          {selectedDetails.lab_tests}
                        </div>
                      </div>
                    )}

                    {selectedDetails.advice && (
                      <div>
                        <label className="block text-[11px] font-bold text-teal-700 uppercase tracking-wide mb-1">
                          Doctor Advice &amp; Lifestyle Instructions
                        </label>
                        <div className="p-2.5 bg-teal-50/60 border border-teal-200 rounded-lg text-slate-800 leading-relaxed text-xs">
                          {selectedDetails.advice}
                        </div>
                      </div>
                    )}

                    {selectedDetails.follow_up_date && (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-emerald-900">
                        <span className="font-semibold text-xs">Next Follow-Up Date:</span>
                        <span className="font-bold text-xs font-mono">{selectedDetails.follow_up_date}</span>
                      </div>
                    )}

                    {selectedDetails.is_finalised && (
                      <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-emerald-900">
                        <FiLock className="text-emerald-700 shrink-0" size={16} />
                        <div className="text-xs">
                          <span className="font-bold">Digitally Signed & Locked</span>
                          <div className="text-[11px] text-emerald-700">
                            Signed by {selectedDetails.signed_by || selectedDetails.doctor?.name} on {selectedDetails.signed_at || selectedDetails.consultation_date}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Linked Clinical Orders & Billing Section */}
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                          Connected Care & Revenue
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              handleOpenRxWriter(selectedDetails);
                            }}
                            className="px-2 py-1 text-[11px] font-semibold rounded bg-[#126868]/10 text-[#126868] hover:bg-[#126868]/20 transition flex items-center gap-1 cursor-pointer"
                          >
                            <FiPlus size={11} />
                            <span>{selectedDetails.linked_prescription ? "Edit Prescription" : "Prescription"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLabOrderModalData({
                                patient_id: selectedDetails.patient?.id,
                                doctor_id: selectedDetails.doctor?.id,
                                encounter_id: selectedDetails.id,
                                clinical_indication: selectedDetails.diagnosis,
                                lab_tests: selectedDetails.lab_tests,
                                patient: selectedDetails.patient,
                              });
                              setIsLabOrderModalOpen(true);
                            }}
                            className="px-2 py-1 text-[11px] font-semibold rounded bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex items-center gap-1 cursor-pointer"
                          >
                            <FiPlus size={11} />
                            <span>Lab Test</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsDetailModalOpen(false);
                              navigate(`/billing?patient_id=${selectedDetails.patient?.id}&encounter_id=${selectedDetails.id}`);
                            }}
                            className="px-2 py-1 text-[11px] font-semibold rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex items-center gap-1 cursor-pointer"
                          >
                            <FiPlus size={11} />
                            <span>Bill / Invoice</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        {/* Linked Prescription */}
                        <div
                          className="p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-[#126868] transition"
                          onClick={() => handleOpenRxWriter(selectedDetails)}
                          title="Click to open Prescription (Rx) Writer"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Prescription (Rx)</div>
                            <span className="text-[10px] text-[#126868] font-bold hover:underline">
                              {selectedDetails.linked_prescription ? "Edit" : "+ Add"}
                            </span>
                          </div>
                          {selectedDetails.linked_prescription ? (
                            <div className="mt-1">
                              <span className="font-mono text-xs font-bold text-[#254d90] bg-[#254d90]/10 px-1.5 py-0.5 rounded">
                                {selectedDetails.linked_prescription.prescription_uid}
                              </span>
                              <div className="text-[11px] text-slate-600 mt-1 line-clamp-1">
                                {selectedDetails.linked_prescription.medicines?.length || 0} medications prescribed
                              </div>
                            </div>
                          ) : (
                            <div className="text-slate-400 italic text-[11px] mt-1">None attached</div>
                          )}
                        </div>

                        {/* Linked Lab Orders */}
                        <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
                          <div className="text-[10px] uppercase font-bold text-slate-400">Diagnostic Tests</div>
                          {selectedDetails.linked_lab_orders && selectedDetails.linked_lab_orders.length > 0 ? (
                            <div className="mt-1">
                              <span className="font-mono text-xs font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                                {selectedDetails.linked_lab_orders[0].order_uid}
                              </span>
                              <div className="text-[11px] text-slate-600 mt-1">
                                {selectedDetails.linked_lab_orders[0].status}
                              </div>
                            </div>
                          ) : (
                            <div className="text-slate-400 italic text-[11px] mt-1">No lab orders placed</div>
                          )}
                        </div>

                        {/* Linked Invoice */}
                        <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
                          <div className="text-[10px] uppercase font-bold text-slate-400">Encounter Invoice</div>
                          {selectedDetails.linked_invoice ? (
                            <div className="mt-1 flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                                {selectedDetails.linked_invoice.invoice_number}
                              </span>
                              <span className="font-bold text-slate-800">
                                ₹{selectedDetails.linked_invoice.total}
                              </span>
                            </div>
                          ) : (
                            <div className="text-slate-400 italic text-[11px] mt-1">Unbilled</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="modal-footer" style={{ justifyContent: "space-between" }}>
                  <span className="text-slate-500 font-mono text-[11px]">
                    {selectedDetails.is_finalised ? "🔒 Finalized Encounter" : "Draft Session (Editable)"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        openWorkspace(selectedDetails.id);
                      }}
                      className="portal-action-btn !py-2 !px-3 !text-xs flex items-center gap-1.5"
                    >
                      <FiEdit3 size={14} />
                      <span>{selectedDetails.is_finalised ? "Review Workspace" : "Open Workspace"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsDetailModalOpen(false)}
                      className="btn-cancel"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. Start Consultation Modal                              */}
      {/* ======================================================== */}
      {isStartOpen && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>Start Consultation Encounter</h2>
                <div className="modal-kicker">Initialize active clinical session for patient</div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsStartOpen(false)}
              >
                <FiX size={18} />
              </button>
            </div>
            <form onSubmit={handleStartConsultation} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Select Patient *</label>
                  <select
                    required
                    value={startForm.patient_id}
                    onChange={(e) => setStartForm({ ...startForm, patient_id: e.target.value })}
                  >
                    <option value="">-- Choose Registered Patient --</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.phone}) - {p.patient_uid || `PAT-${String(p.id).padStart(4, '0')}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Attending Specialist *</label>
                    <select
                      required
                      value={startForm.doctor_id}
                      onChange={(e) => setStartForm({ ...startForm, doctor_id: e.target.value })}
                    >
                      <option value="">-- Choose Doctor --</option>
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.specialization})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Visit Type *</label>
                    <select
                      value={startForm.visit_type}
                      onChange={(e) => setStartForm({ ...startForm, visit_type: e.target.value })}
                    >
                      {(options?.visit_types || [
                        "General Consultation",
                        "Follow-up Visit",
                        "Emergency Triage",
                        "Post-Operative Review",
                        "Routine Health Checkup",
                      ]).map((vt) => (
                        <option key={vt} value={vt}>{vt}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Primary Complaint / Symptoms</label>
                  <textarea
                    rows={3}
                    placeholder="Patient presented with fever, cough for 3 days..."
                    value={startForm.chief_complaint}
                    onChange={(e) => setStartForm({ ...startForm, chief_complaint: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setIsStartOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                >
                  <FiCheck size={14} />
                  <span>Open Encounter</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. Full Clinical Notes Workspace Modal                   */}
      {/* ======================================================== */}
      {isWorkspaceOpen && encounterData && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ maxWidth: "980px", maxHeight: "94vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="modal-header" style={{ padding: "14px 20px" }}>
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-extrabold text-slate-900 tracking-tight">Clinical Encounter Workspace</h2>
                    <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 border border-slate-300 px-2.5 py-0.5 rounded-md">
                      {encounterData.encounter_uid}
                    </span>
                    {encounterData.is_finalised && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                        <span>Signed by {encounterData.signed_by}</span>
                      </span>
                    )}
                  </div>

                  {/* Patient Info Row */}
                  <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                    <span className="text-base font-bold text-slate-900">
                      {encounterData.patient.name}
                    </span>
                    {encounterData.patient.patient_uid && (
                      <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {encounterData.patient.patient_uid}
                      </span>
                    )}
                    <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      {encounterData.patient.phone}
                    </span>
                    <span className="text-xs text-slate-600 font-medium">
                      • Attending: <strong className="text-slate-900">{encounterData.doctor.name}</strong>
                      {encounterData.doctor.specialization && (
                        <span className="text-slate-500 ml-1">({encounterData.doctor.specialization})</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="btn-cancel"
                  style={{ padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  title="Print Clinical Summary"
                >
                  <FiPrinter size={15} />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={handleCloseWorkspace}
                  className="modal-close"
                  title="Close Workspace"
                >
                  <FiX size={18} />
                </button>
              </div>
            </div>

            {/* Clinical Content Area */}
            <div className="modal-body" style={{ gap: "16px" }}>
              {/* Vital Signs Section */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-slate-800 m-0">
                      Vital Signs &amp; Anthropometry
                    </label>
                    {Object.values(clinicalForm.vitals || {}).some((v) => v !== "" && v !== null && v !== undefined) ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Examined &amp; Recorded
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                        Optional / Not Examined
                      </span>
                    )}
                  </div>

                  {!encounterData.is_finalised && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* 1-Click Quick Normal Preset */}
                      <button
                        type="button"
                        onClick={handleSetQuickNormal}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-xs transition cursor-pointer"
                        title="1-click fill standard normal baseline vitals (BP 120/80, Pulse 72, Temp 98.4, SpO2 99)"
                      >
                        <FiCheck size={12} className="text-emerald-600" />
                        <span>Quick Normal (120/80)</span>
                      </button>

                      {/* Clear / Skip Vitals */}
                      {Object.values(clinicalForm.vitals || {}).some((v) => v !== "" && v !== null && v !== undefined) && (
                        <button
                          type="button"
                          onClick={handleClearVitals}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 shadow-xs transition cursor-pointer"
                          title="Clear and skip vitals for this routine / follow-up visit"
                        >
                          <FiX size={12} />
                          <span>Clear / Skip</span>
                        </button>
                      )}

                      {/* Add Custom Vital Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setIsAddVitalOpen(!isAddVitalOpen)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition cursor-pointer"
                          title="Add additional vital signs (Sugar, Pain Score, Waist, etc.)"
                        >
                          + Add Vital
                        </button>

                      {/* Dropdown / Popover to Add Vital */}
                      {isAddVitalOpen && (
                        <div
                          className="absolute right-0 top-9 z-50 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-3.5 animate-in fade-in zoom-in-95 duration-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                            <span className="text-sm font-bold text-slate-800">Add Vital Sign</span>
                            <button
                              type="button"
                              onClick={() => setIsAddVitalOpen(false)}
                              className="text-slate-400 hover:text-slate-600 p-0.5"
                            >
                              <FiX size={15} />
                            </button>
                          </div>

                          <form onSubmit={handleCreateCustomVital} className="space-y-3">
                            <div>
                              <label className="text-sm font-semibold text-slate-700 block mb-1">Vital Sign Name *</label>
                              <input
                                type="text"
                                autoFocus
                                required
                                placeholder="e.g. Blood Sugar, Pain Score..."
                                value={customVitalInput.name}
                                onChange={(e) => setCustomVitalInput({ ...customVitalInput, name: e.target.value })}
                                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:border-slate-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-sm font-semibold text-slate-700 block mb-1">Measurement Unit (Optional)</label>
                              <input
                                type="text"
                                placeholder="e.g. mg/dL, 1-10, cm..."
                                value={customVitalInput.unit}
                                onChange={(e) => setCustomVitalInput({ ...customVitalInput, unit: e.target.value })}
                                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:border-slate-500 outline-none"
                              />
                            </div>
                            <button
                              type="submit"
                              className="w-full py-2 text-sm font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition shadow-xs cursor-pointer"
                            >
                              + Add Vital Sign
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

                {/* Vital Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
                  {activeVitalFields.map((vital) => (
                    <div
                      key={vital.id}
                      className="bg-white border border-slate-200 hover:border-slate-300 rounded-lg p-2.5 flex flex-col justify-between transition"
                      style={{ minHeight: "82px" }}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <label className="text-xs font-semibold text-slate-700 truncate" title={vital.label}>
                          {vital.label}
                        </label>
                        {!encounterData.is_finalised && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteVitalTarget(vital);
                              setDeletePassInput("");
                              setDeletePassError("");
                            }}
                            className="text-slate-400 hover:text-rose-600 transition p-0.5 rounded cursor-pointer"
                            title={`Delete ${vital.label}`}
                          >
                            <FiX size={14} />
                          </button>
                        )}
                      </div>
                      <input
                        type={vital.type || "text"}
                        step={vital.step || undefined}
                        disabled={encounterData.is_finalised}
                        placeholder={vital.placeholder || "—"}
                        value={clinicalForm.vitals[vital.id] ?? ""}
                        onChange={(e) => handleVitalsChange(vital.id, e.target.value)}
                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-center text-base font-bold text-slate-900 focus:bg-white focus:border-slate-500 outline-none transition"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Chief Complaint & History of Present Illness (HPI) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Chief Complaint
                  </label>
                  <textarea
                    rows={3}
                    disabled={encounterData.is_finalised}
                    placeholder="Enter symptoms and chief complaints..."
                    value={clinicalForm.chief_complaint}
                    onChange={(e) => setClinicalForm({ ...clinicalForm, chief_complaint: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    History of Present Illness (HPI)
                  </label>
                  <textarea
                    rows={3}
                    disabled={encounterData.is_finalised}
                    placeholder="Enter illness history and progression..."
                    value={clinicalForm.hpi}
                    onChange={(e) => setClinicalForm({ ...clinicalForm, hpi: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                  />
                </div>
              </div>

              {/* Clinical Examination */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Clinical Examination
                </label>
                <textarea
                  rows={2}
                  disabled={encounterData.is_finalised}
                  placeholder="Enter general and systemic examination findings..."
                  value={clinicalForm.clinical_examination}
                  onChange={(e) => setClinicalForm({ ...clinicalForm, clinical_examination: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                />
              </div>

              {/* Primary & Differential Diagnosis */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Primary Diagnosis *
                  </label>
                  <input
                    type="text"
                    disabled={encounterData.is_finalised}
                    placeholder="e.g. Acute Pharyngotonsillitis"
                    value={clinicalForm.diagnosis}
                    onChange={(e) => setClinicalForm({ ...clinicalForm, diagnosis: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg font-bold text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Differential Diagnosis
                  </label>
                  <input
                    type="text"
                    disabled={encounterData.is_finalised}
                    placeholder="e.g. Viral URI, Mononucleosis"
                    value={clinicalForm.differential_diagnosis}
                    onChange={(e) => setClinicalForm({ ...clinicalForm, differential_diagnosis: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                  />
                </div>
              </div>

              {/* Diagnostic Lab Tests */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-slate-800 m-0">
                      Diagnostic Tests
                    </label>
                    {parsedLabTests.length > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        {parsedLabTests.length} tests
                      </span>
                    )}
                  </div>
                  {!encounterData.is_finalised && (
                    <button
                      type="button"
                      onClick={() => {
                        setLabOrderModalData({
                          patient_id: encounterData.patient?.id,
                          doctor_id: encounterData.doctor?.id,
                          encounter_id: encounterData.id,
                          clinical_indication: clinicalForm.diagnosis || encounterData.diagnosis,
                          lab_tests: clinicalForm.lab_tests || encounterData.lab_tests,
                          patient: encounterData.patient,
                        });
                        setIsLabOrderModalOpen(true);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition cursor-pointer"
                    >
                      {parsedLabTests.length > 0 ? "Edit Tests" : "+ Add Diagnostic Test"}
                    </button>
                  )}
                </div>

                {parsedLabTests.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                    {parsedLabTests.map((testName, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="font-bold text-slate-900 text-sm block truncate">{testName}</span>
                          <span className="text-slate-500 text-xs block mt-0.5">
                            Clinical Laboratory Investigation
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                            Clinic Lab
                          </span>
                          {!encounterData.is_finalised && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLabTest(testName)}
                              className="text-slate-400 hover:text-rose-600 transition p-0.5 rounded cursor-pointer"
                              title={`Remove ${testName}`}
                            >
                              <FiX size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3.5 bg-white border border-dashed border-slate-300 rounded-lg text-center text-sm text-slate-500">
                    No diagnostic tests ordered yet. Click{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setLabOrderModalData({
                          patient_id: encounterData.patient?.id,
                          doctor_id: encounterData.doctor?.id,
                          encounter_id: encounterData.id,
                          clinical_indication: clinicalForm.diagnosis || encounterData.diagnosis,
                          lab_tests: clinicalForm.lab_tests || encounterData.lab_tests,
                          patient: encounterData.patient,
                        });
                        setIsLabOrderModalOpen(true);
                      }}
                      className="text-slate-900 font-bold underline cursor-pointer hover:text-blue-600"
                    >
                      + Add Diagnostic Test
                    </button>
                  </div>
                )}
              </div>

              {/* Prescriptions & Medications */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-slate-800 m-0">
                      Prescriptions / Medications
                    </label>
                    {encounterData.linked_prescription?.medicines && encounterData.linked_prescription.medicines.length > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        {encounterData.linked_prescription.medicines.length} meds
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenRxWriter(encounterData)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition cursor-pointer"
                  >
                    {encounterData.linked_prescription?.medicines && encounterData.linked_prescription.medicines.length > 0
                      ? (encounterData.is_finalised ? "View / Edit Medications" : "Edit Medications")
                      : "+ Add Medication"}
                  </button>
                </div>

                {encounterData.linked_prescription?.medicines && encounterData.linked_prescription.medicines.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                    {encounterData.linked_prescription.medicines.map((m, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <span className="font-bold text-slate-900 text-sm block truncate">{m.name}</span>
                          <span className="text-slate-600 text-xs font-medium block mt-0.5">
                            {m.dosage} • {m.duration}
                            {m.notes && <span className="ml-1 text-slate-400">({m.notes})</span>}
                          </span>
                        </div>
                        <span className="text-xs font-medium px-2 py-0.5 rounded border shrink-0 bg-slate-100 text-slate-700 border-slate-200">
                          {(m.fulfillment || "CLINIC").toUpperCase() === "CLINIC" ? "Clinic Pharmacy" : "Outside"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3.5 bg-white border border-dashed border-slate-300 rounded-lg text-center text-sm text-slate-500">
                    No medications prescribed yet. Click{" "}
                    <button
                      type="button"
                      onClick={handleOpenRxWriter}
                      className="text-slate-900 font-bold underline cursor-pointer hover:text-blue-600"
                    >
                      + Add Medication
                    </button>
                  </div>
                )}
              </div>

              {/* Treatment Plan */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Treatment Plan
                </label>
                <textarea
                  rows={3}
                  disabled={encounterData.is_finalised}
                  placeholder="Prescribed plan, hydration, precautions, and care instructions..."
                  value={clinicalForm.treatment_plan}
                  onChange={(e) => setClinicalForm({ ...clinicalForm, treatment_plan: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                />
              </div>

              {/* Follow-up & Review */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-semibold text-slate-800 m-0">
                    Follow-up &amp; Review
                  </label>

                  {!encounterData.is_finalised && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-500 mr-1">Quick Select:</span>
                      {[
                        { label: "+ 3 Days", days: 3 },
                        { label: "+ 1 Week", days: 7 },
                        { label: "+ 2 Weeks", days: 14 },
                        { label: "+ 1 Month", days: 30 },
                        { label: "SOS / As Needed", days: "sos" },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => handleQuickFollowUp(item.days)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition cursor-pointer"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Follow-up Date</label>
                    <input
                      type="date"
                      disabled={encounterData.is_finalised}
                      value={clinicalForm.follow_up_date}
                      onChange={(e) => setClinicalForm({ ...clinicalForm, follow_up_date: e.target.value })}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-900 focus:border-slate-500 outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Instructions / Trigger</label>
                    <input
                      type="text"
                      disabled={encounterData.is_finalised}
                      placeholder="e.g. Review with lab report or SOS if symptoms persist"
                      value={clinicalForm.follow_up_instructions}
                      onChange={(e) => setClinicalForm({ ...clinicalForm, follow_up_instructions: e.target.value })}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Doctor Advice & Precautions */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                <label className="block text-sm font-semibold text-slate-800 m-0">
                  Doctor Advice &amp; Precautions
                </label>

                <textarea
                  rows={3}
                  disabled={encounterData.is_finalised}
                  placeholder="Dietary precautions, activity restrictions, and lifestyle advice..."
                  value={clinicalForm.advice}
                  onChange={(e) => setClinicalForm({ ...clinicalForm, advice: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 outline-none"
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="modal-footer" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "12px", padding: "14px 20px" }}>
              <div className="flex items-center gap-2">
                {!encounterData.is_finalised ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCancelConsultation(encounterData.id, encounterData?.patient?.name)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs md:text-sm font-bold rounded-lg text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 transition cursor-pointer"
                      title="Cancel this consultation encounter and safely return patient to waiting queue"
                    >
                      <FiTrash2 size={15} />
                      <span>Cancel Consultation</span>
                    </button>
                    <span className="text-slate-500 text-xs hidden sm:inline ml-1 font-medium">
                      (Returns patient to waiting queue)
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500 font-mono text-[11px]">
                    🔒 Note Locked
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/billing?patient_id=${encounterData.patient.id}&encounter_id=${encounterData.id}`);
                  }}
                  className="px-3.5 py-2 text-xs md:text-sm font-bold rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  title="Generate or view billing invoice for this patient"
                >
                  <FiDollarSign size={14} />
                  <span>{encounterData.linked_invoice ? `Invoice (${encounterData.linked_invoice.invoice_number})` : "Bill / Invoice"}</span>
                </button>
                {!encounterData.is_finalised && (
                  <>
                    <button
                      type="button"
                      onClick={handleCloseWorkspace}
                      className="btn-cancel text-xs md:text-sm px-3.5 py-2 font-medium"
                      title="Close workspace and keep draft active in portal with Take button"
                    >
                      Close (Keep Draft)
                    </button>
                    <button
                      type="button"
                      disabled={savingDraft}
                      onClick={handleSaveDraft}
                      className="btn-cancel text-xs md:text-sm px-3.5 py-2 font-semibold text-slate-700"
                    >
                      {savingDraft ? "Saving..." : "Save Draft"}
                    </button>
                    <button
                      type="button"
                      disabled={finalizing}
                      onClick={handleFinalize}
                      className="btn-submit text-xs md:text-sm px-4 py-2 font-bold flex items-center gap-1.5"
                      style={{ background: "#059669" }}
                    >
                      <FiCheckCircle size={15} />
                      <span>{finalizing ? "Signing..." : "Finalize & Sign"}</span>
                    </button>
                  </>
                )}
                {encounterData.is_finalised && (
                  <button
                    onClick={handleCloseWorkspace}
                    className="btn-cancel text-xs md:text-sm px-4 py-2"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. Security Pass Modal for Deleting Vital Signs          */}
      {/* ======================================================== */}
      {deleteVitalTarget && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div
            className="modal-content"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ padding: "16px 22px" }}>
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-lg bg-rose-50 text-rose-600 border border-rose-200">
                  <FiLock size={18} />
                </span>
                <h3 className="text-base font-bold text-slate-900 m-0" style={{ fontSize: "17px" }}>
                  Authorization Required
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeleteVitalTarget(null)}
                className="modal-close"
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteVital}>
              <div className="modal-body space-y-4" style={{ padding: "20px 22px" }}>
                <p className="text-sm text-slate-700 m-0 leading-relaxed">
                  Are you sure you want to remove the vital sign field <strong className="text-slate-900 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-sm">{deleteVitalTarget.label}</strong> from this consultation encounter?
                </p>
                <p className="text-xs text-slate-500 m-0">
                  You can re-add it at any time from the 'Add Vital Sign' dropdown.
                </p>
              </div>

              <div className="modal-footer flex items-center justify-end gap-2.5" style={{ padding: "14px 22px" }}>
                <button
                  type="button"
                  onClick={() => setDeleteVitalTarget(null)}
                  className="btn-cancel text-sm font-semibold px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit text-sm font-bold px-4 py-2 text-white transition"
                  style={{ background: "#e11d48" }}
                >
                  Confirm Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. Custom In-App Action Confirmation Modal (No Browser Alerts) */}
      {/* ======================================================== */}
      {confirmAction && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div
            className="modal-content animate-in fade-in zoom-in-95 duration-150"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="modal-header" style={{ padding: "16px 22px" }}>
              <div className="flex items-center gap-3">
                {confirmAction.type === "finalize" ? (
                  <span className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200">
                    <FiCheckCircle size={22} />
                  </span>
                ) : (
                  <span className="p-2.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-200">
                    <FiAlertTriangle size={22} />
                  </span>
                )}
                <div>
                  <h3 className="text-base font-bold text-slate-900 m-0" style={{ fontSize: "17px" }}>
                    {confirmAction.type === "finalize"
                      ? "Finalize & Sign Consultation"
                      : "Cancel Consultation Encounter?"}
                  </h3>
                  <div className="text-xs text-slate-500 font-medium mt-0.5">
                    {confirmAction.type === "finalize"
                      ? "Official Medical Record Lock"
                      : "Patient Queue Reversal Action"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="modal-close"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="modal-body space-y-3.5" style={{ padding: "20px 22px" }}>
              {confirmAction.type === "finalize" ? (
                <>
                  <p className="text-sm text-slate-700 leading-relaxed m-0">
                    Are you sure you want to finalize and sign this consultation encounter for{" "}
                    <strong className="text-slate-900 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      {encounterData?.patient?.name || "this patient"}
                    </strong>?
                  </p>
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-950 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                      <FiLock size={13} />
                      <span>Permanent Clinical Record Lock</span>
                    </div>
                    <p className="m-0 text-emerald-700 leading-normal">
                      Once signed, the vitals, examination findings, diagnosis, and treatment plan will be locked. Prescriptions and ordered lab tests are officially filed to the patient's medical history.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-700 leading-relaxed m-0">
                    Are you sure you want to cancel the consultation encounter for{" "}
                    <strong className="text-slate-900 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      {confirmAction.patientName || encounterData?.patient?.name || "this patient"}
                    </strong>?
                  </p>
                  <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-lg text-xs text-rose-950 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-rose-800">
                      <FiAlertTriangle size={13} />
                      <span>Safe Queue Return</span>
                    </div>
                    <p className="m-0 text-rose-700 leading-normal">
                      This consultation session will be cancelled and the patient will be safely returned to the <strong>Waiting Room Queue</strong>. Any unsaved changes in this session will be discarded.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="modal-footer flex items-center justify-end gap-2.5" style={{ padding: "14px 22px" }}>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="btn-cancel text-sm font-semibold px-4 py-2"
              >
                {confirmAction.type === "finalize" ? "Continue Editing" : "Keep Consultation"}
              </button>
              <button
                type="button"
                onClick={confirmAction.type === "finalize" ? executeFinalize : executeCancelConsultation}
                className="btn-submit text-sm font-bold px-4 py-2 text-white transition cursor-pointer flex items-center gap-1.5"
                style={{
                  background: confirmAction.type === "finalize" ? "#059669" : "#e11d48",
                }}
              >
                {confirmAction.type === "finalize" ? (
                  <>
                    <FiCheckCircle size={15} />
                    <span>Confirm &amp; Sign</span>
                  </>
                ) : (
                  <>
                    <FiX size={15} />
                    <span>Yes, Cancel Consultation</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* In-Place Place Diagnostic Order Modal                    */}
      {/* ======================================================== */}
      <PlaceDiagnosticOrderModal
        isOpen={isLabOrderModalOpen}
        onClose={() => setIsLabOrderModalOpen(false)}
        initialData={labOrderModalData}
        patients={patients}
        doctors={doctors}
        onOrderCreated={(orderRes, selectedTests) => {
          if (isWorkspaceOpen && encounterData) {
            const newLabOrder = {
              id: orderRes.order_id,
              order_uid: orderRes.order_uid,
              tests: (selectedTests || []).map((t) => ({
                id: t.id,
                name: t.name,
                price: t.price,
                sample_type: t.sample_type,
              })),
              status: "DRAFT_CONSULTATION",
              total_price: orderRes.total_price,
            };
            setEncounterData((prev) => ({
              ...prev,
              linked_lab_orders: [
                ...(prev.linked_lab_orders || []).filter((o) => o.id !== orderRes.order_id),
                newLabOrder,
              ],
            }));
            if (selectedTests && selectedTests.length > 0) {
              setClinicalForm((prev) => {
                const existing = prev.lab_tests
                  ? prev.lab_tests.split(",").map((s) => s.trim()).filter(Boolean)
                  : [];
                const merged = Array.from(new Set([...existing, ...selectedTests.map((t) => t.name)])).join(", ");
                return { ...prev, lab_tests: merged };
              });
            }
          }
          loadData(search, statusFilter, doctorFilter, true);
        }}
      />

      {/* ======================================================== */}
      {/* In-Workspace Prescription (Rx) Writer Modal              */}
      {/* ======================================================== */}
      {isRxWriterOpen && encounterData && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          style={{ zIndex: 1150 }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  Clinical Prescription (Rx) Writer
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                      encounterData.is_finalised || encounterData.status === "COMPLETED"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {encounterData.is_finalised || encounterData.status === "COMPLETED"
                      ? "Completed Prescription"
                      : "Draft (In Consultation)"}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Patient: <strong className="text-slate-700">{encounterData.patient?.name}</strong> • Encounter: <strong className="text-slate-700">{encounterData.encounter_uid || encounterData.id}</strong>
                  {encounterData.linked_prescription?.prescription_uid && (
                    <span className="ml-2 font-mono text-[11px] font-bold text-[#254d90] bg-[#254d90]/10 px-1.5 py-0.5 rounded">
                      {encounterData.linked_prescription.prescription_uid}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRxWriterOpen(false)}
                className="modal-close"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Quick Add Suggestions if catalogue available */}
              {medCatalogue.length > 0 && (
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                  <div className="text-sm font-semibold text-slate-800 mb-2">
                    Quick Add from Pharmacy Inventory
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                    {medCatalogue.slice(0, 12).map((m, i) => {
                      const medName = m.name || m.medicine_name || m;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleQuickAddMed(medName)}
                          className="text-xs px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md transition font-medium cursor-pointer"
                        >
                          + {medName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Medicine Table */}
              <div className="border border-slate-200 rounded-lg">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-800 font-semibold border-b border-slate-200 text-sm">
                    <tr>
                      <th className="p-3 w-10 text-center">#</th>
                      <th className="p-3 min-w-[220px]">Medicine Name</th>
                      <th className="p-3 w-32">Dosage</th>
                      <th className="p-3 w-32">Duration</th>
                      <th className="p-3 min-w-[150px]">Instructions / Notes</th>
                      <th className="p-3 w-36">Fulfillment</th>
                      <th className="p-3 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rxMeds.map((med, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition">
                        <td className="p-3 text-center text-slate-500 font-medium">{idx + 1}</td>
                        <td className="p-2 relative">
                          <input
                            type="text"
                            value={med.name}
                            onFocus={() => setActiveMedRowIdx(idx)}
                            onBlur={() => {
                              setTimeout(() => setActiveMedRowIdx(null), 250);
                            }}
                            onChange={(e) => {
                              handleUpdateMedRow(idx, "name", e.target.value);
                              setActiveMedRowIdx(idx);
                            }}
                            placeholder="e.g. Paracetamol 650mg"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 focus:ring-1 focus:ring-slate-400 outline-none transition"
                            autoComplete="off"
                          />

                          {/* Custom Autocomplete Dropdown */}
                          {activeMedRowIdx === idx && (
                            <div
                              className="absolute left-2 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto divide-y divide-slate-100"
                              style={{ width: "max(100% - 16px, 320px)" }}
                            >
                              {(() => {
                                const q = (med.name || "").trim().toLowerCase();
                                const filtered = q
                                  ? medCatalogue.filter((m) => {
                                      const n = (m.name || m.medicine_name || (typeof m === "string" ? m : "")).toLowerCase();
                                      const g = (m.generic_name || "").toLowerCase();
                                      const b = (m.brand || "").toLowerCase();
                                      return n.includes(q) || g.includes(q) || b.includes(q);
                                    })
                                  : medCatalogue;
                                const displayList = filtered.slice(0, 10);

                                if (displayList.length === 0) {
                                  return (
                                    <div className="p-3 text-xs text-slate-400 text-center italic">
                                      No catalogue matches found. Keep typing custom name.
                                    </div>
                                  );
                                }

                                return displayList.map((m, mIdx) => {
                                  const medName = m.name || m.medicine_name || m;
                                  const genText = m.generic_name
                                    ? `${m.generic_name}${m.strength ? ` • ${m.strength}` : ""}`
                                    : m.strength || "";
                                  return (
                                    <div
                                      key={mIdx}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleUpdateMedRow(idx, "name", medName);
                                        setActiveMedRowIdx(null);
                                      }}
                                      className="p-2.5 hover:bg-slate-50 transition cursor-pointer flex flex-col text-left group"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-slate-900 text-xs group-hover:text-blue-600 transition">
                                          {medName}
                                        </span>
                                        {m.strength && (
                                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                            {m.strength}
                                          </span>
                                        )}
                                      </div>
                                      {genText && (
                                        <span className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                          {genText}
                                        </span>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={med.dosage}
                            onChange={(e) => handleUpdateMedRow(idx, "dosage", e.target.value)}
                            placeholder="1-0-1"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={med.duration}
                            onChange={(e) => handleUpdateMedRow(idx, "duration", e.target.value)}
                            placeholder="5 days"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={med.notes}
                            onChange={(e) => handleUpdateMedRow(idx, "notes", e.target.value)}
                            placeholder="After food"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={med.fulfillment || "CLINIC"}
                            onChange={(e) => handleUpdateMedRow(idx, "fulfillment", e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:border-slate-500 outline-none"
                          >
                            <option value="CLINIC">Clinic Dispense</option>
                            <option value="OUTSIDE">Outside Chemist</option>
                          </select>
                        </td>
                        <td className="p-2 text-center">
                          {rxMeds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMedRow(idx)}
                              className="text-slate-400 hover:text-red-600 p-1.5 rounded transition cursor-pointer"
                              title="Remove item"
                            >
                              <FiTrash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add row button */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleAddMedRow}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 text-sm font-medium transition cursor-pointer"
                >
                  + Add Another Medication
                </button>
                <div className="text-sm text-slate-500 font-medium">
                  {rxMeds.filter((m) => m.name.trim()).length} medication(s) added
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsRxWriterOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 bg-white transition cursor-pointer"
                disabled={savingRx}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRx}
                disabled={savingRx}
                className="px-5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm transition cursor-pointer disabled:opacity-50"
              >
                <span>
                  {savingRx
                    ? "Saving Prescription..."
                    : encounterData.is_finalised || encounterData.status === "COMPLETED" || encounterData.linked_prescription?.id
                    ? "Update Prescription"
                    : "Attach Rx to Consultation"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 6. Official Medical Prescription & Encounter Printable   */}
      {/* ======================================================== */}
      {activePrintEncounter && (
        <div id="clinical-encounter-printable" className="p-6 bg-white text-slate-900">
          {/* Clinic Header / Letterhead */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black tracking-tight text-[#1a56db]">AEROSTATE</span>
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  OPD &amp; Specialty Clinic
                </span>
              </div>
              <h1 className="text-lg font-extrabold text-slate-900 mt-1 tracking-tight">
                AeroState Multi-Specialty Clinic &amp; Diagnostic Centre
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Plot 42, Healthcare City, OPD Block A • Tel: +91 (11) 4567-8900 / +91 98112 23344
              </p>
              <p className="text-[11px] text-slate-500">
                Email: care@aerostateclinic.com • NABH Accredited • Reg No: DL-MED-2026-8891
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-extrabold text-slate-900">{activePrintEncounter.doctor?.name || "Consultant Doctor"}</div>
              <div className="text-xs font-bold text-[#1a56db]">{activePrintEncounter.doctor?.specialization || "General OPD"}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Reg No: MCI-DEL-2018-9241</div>
              <div className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded mt-1.5 inline-block border border-slate-200">
                {activePrintEncounter.encounter_uid}
              </div>
            </div>
          </div>

          {/* Patient Demographics Strip */}
          <div className="bg-slate-50 border border-slate-300 rounded-lg p-3 mb-4 text-xs">
            <div className="grid grid-cols-4 gap-2">
              <div>
                <span className="text-slate-500 font-semibold uppercase text-[10px] block">Patient Name</span>
                <strong className="text-slate-900 text-sm">{activePrintEncounter.patient?.name}</strong>
              </div>
              <div>
                <span className="text-slate-500 font-semibold uppercase text-[10px] block">Patient ID / UID</span>
                <strong className="text-[#1a56db] font-mono">
                  {activePrintEncounter.patient?.patient_uid || (activePrintEncounter.patient?.id ? `PAT-${String(activePrintEncounter.patient.id).padStart(4, "0")}` : "—")}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 font-semibold uppercase text-[10px] block">Age / Gender</span>
                <span className="font-bold text-slate-800">
                  {activePrintEncounter.patient?.age || "—"} Yrs / {activePrintEncounter.patient?.gender || "Unspecified"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 font-semibold uppercase text-[10px] block">Date &amp; Visit Type</span>
                <span className="font-bold text-slate-800">
                  {activePrintEncounter.consultation_date || new Date().toISOString().split("T")[0]} ({activePrintEncounter.visit_type})
                </span>
              </div>
            </div>
          </div>

          {/* Recorded Vitals Summary */}
          {activePrintForm.vitals && Object.entries(activePrintForm.vitals).some(([k, v]) => k !== "bmi" && k !== "bmi_category" && v !== "" && v !== null && v !== undefined) && (
            <div className="mb-4 pb-3 border-b border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Patient Vital Signs &amp; Anthropometry
              </span>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(activePrintForm.vitals).map(([k, v]) => {
                  if (k === "bmi" || k === "bmi_category" || !v) return null;
                  const label = k.replace(/_/g, " ").toUpperCase();
                  return (
                    <span key={k} className="px-2.5 py-1 bg-slate-100 rounded border border-slate-200 font-semibold text-slate-800">
                      <span className="text-slate-500 text-[10px] uppercase mr-1">{label}:</span>
                      {v}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clinical Symptoms & Examination */}
          {(activePrintForm.chief_complaint || activePrintForm.clinical_examination) && (
            <div className="grid grid-cols-2 gap-4 mb-4 pb-3 border-b border-slate-200 text-xs">
              {activePrintForm.chief_complaint && (
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Chief Complaint &amp; Symptoms
                  </span>
                  <p className="text-slate-800 leading-relaxed m-0 font-medium whitespace-pre-line">{activePrintForm.chief_complaint}</p>
                </div>
              )}
              {activePrintForm.clinical_examination && (
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Clinical Examination Findings
                  </span>
                  <p className="text-slate-800 leading-relaxed m-0 font-medium whitespace-pre-line">{activePrintForm.clinical_examination}</p>
                </div>
              )}
            </div>
          )}

          {/* Diagnosis Block */}
          {activePrintForm.diagnosis && (
            <div className="mb-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Clinical Diagnosis:
                </span>
                <span className="text-sm font-extrabold text-slate-900 bg-blue-50 px-2.5 py-0.5 rounded border border-blue-200">
                  {activePrintForm.diagnosis}
                </span>
                {activePrintForm.differential_diagnosis && (
                  <span className="text-xs text-slate-600 font-medium ml-2">
                    (Diff: {activePrintForm.differential_diagnosis})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Diagnostic Lab Tests Recommended */}
          {activePrintForm.lab_tests && (
            <div className="mb-4 pb-3 border-b border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Diagnostic Lab Tests &amp; Investigations Recommended
              </span>
              <p className="text-xs font-semibold text-slate-900 bg-slate-50 p-2.5 rounded border border-slate-200 m-0">
                {activePrintForm.lab_tests}
              </p>
            </div>
          )}

          {/* Treatment Plan & Rx */}
          <div className="mb-5 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl font-black text-[#1a56db] font-serif leading-none">℞</span>
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Treatment Plan &amp; Prescription Instructions
              </span>
            </div>
            <div className="p-3 bg-white border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-900 font-medium whitespace-pre-line">
              {activePrintForm.treatment_plan || "Continue symptomatic management and follow instructions below."}
            </div>
          </div>

          {/* Doctor Advice & Dietary Guidelines */}
          {activePrintForm.advice && (
            <div className="mb-4 pb-3 border-b border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Doctor's Advice &amp; Lifestyle / Dietary Precautions
              </span>
              <p className="text-xs text-slate-800 leading-relaxed m-0 font-medium whitespace-pre-line">{activePrintForm.advice}</p>
            </div>
          )}

          {/* Follow-up Date */}
          {activePrintForm.follow_up_date && (
            <div className="mb-6 p-2.5 bg-blue-50/60 rounded border border-blue-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-500 font-semibold">Recommended Follow-up Visit:</span>{" "}
                <strong className="text-[#1a56db] font-bold text-sm ml-1">{activePrintForm.follow_up_date}</strong>
              </div>
              {activePrintForm.follow_up_instructions && (
                <div className="text-slate-600 font-medium italic">
                  Trigger: {activePrintForm.follow_up_instructions}
                </div>
              )}
            </div>
          )}

          {/* Doctor Signature Block & Footer */}
          <div className="mt-8 pt-4 flex justify-between items-end text-xs">
            <div className="text-slate-400 text-[10px]">
              <div>Verified Digital Clinical Encounter Document</div>
              <div>AeroState EHR System • Generated on {new Date().toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="w-48 border-b border-slate-800 mb-1 ml-auto"></div>
              <div className="font-bold text-slate-900">{activePrintEncounter.doctor?.name || "Consultant Doctor"}</div>
              <div className="text-slate-500 text-[11px]">{activePrintEncounter.doctor?.specialization || "Registered Medical Practitioner"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
