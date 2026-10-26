import React, { useState } from "react";
import { FiX, FiCheck, FiDollarSign, FiUser, FiPhone, FiCalendar, FiClock } from "react-icons/fi";
import { FaMoneyBillWave, FaQrcode, FaCreditCard, FaUniversity } from "react-icons/fa";
import { collectAppointmentPayment } from "../../api";

export default function CollectPaymentModal({ appointment, onClose, onSuccess }) {
  if (!appointment) return null;

  const defaultFee = appointment.consultation_fee || 500;
  const [paidAmount, setPaidAmount] = useState(defaultFee);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const paymentModes = [
    { id: "Cash", label: "Cash", icon: FaMoneyBillWave, desc: "Cash counter deposit" },
    { id: "UPI", label: "UPI / QR", icon: FaQrcode, desc: "GPay / PhonePe / Paytm" },
    { id: "Card", label: "Debit / Credit Card", icon: FaCreditCard, desc: "POS Terminal swipe" },
    { id: "NetBanking", label: "NetBanking / Other", icon: FaUniversity, desc: "Direct bank transfer" },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amountNum = Number(paidAmount);
    if (isNaN(amountNum) || amountNum < 0) {
      setError("Please enter a valid payment amount.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await collectAppointmentPayment(appointment.id, {
        payment_method: paymentMethod,
        paid_amount: amountNum,
      });
      if (onSuccess) {
        onSuccess({
          ...appointment,
          payment_status: "PAID",
          payment_method: paymentMethod,
          paid_amount: amountNum,
        });
      }
      onClose();
    } catch (err) {
      setError(err.message || "Failed to collect payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#126868] to-[#1a7f7f] text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold">
              <FiDollarSign size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Collect Consultation Payment</h3>
              <p className="text-[11px] text-teal-100">
                Booking #{appointment.id} • {appointment.patient_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-md hover:bg-white/10 transition cursor-pointer"
            title="Close"
          >
            <FiX size={18} />
          </button>
        </div>

        {/* BODY */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-rose-50 text-rose-700 border border-rose-200 rounded-lg">
              {error}
            </div>
          )}

          {/* PATIENT & DOCTOR SUMMARY */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs text-slate-700">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <FiUser size={12} className="text-[#126868]" />
                {appointment.patient_name}
              </span>
              <span className="font-mono text-[11px] text-slate-500 font-medium">
                {appointment.patient_uid}
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px] text-slate-600">
              <span>🩺 {appointment.doctor_name || "Specialist"}</span>
              <span className="font-mono">
                📅 {appointment.appointment_date} at {appointment.start_time}
              </span>
            </div>
          </div>

          {/* AMOUNT INPUT */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              Consultation Fee Amount (₹) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 font-bold text-sm">
                ₹
              </span>
              <input
                type="number"
                min="0"
                step="10"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-base font-bold text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#126868] focus:border-transparent"
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Standard specialist rate: ₹{defaultFee}
            </p>
          </div>

          {/* PAYMENT METHOD SELECTOR */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              Select Payment Mode <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {paymentModes.map((mode) => {
                const Icon = mode.icon;
                const isSelected = paymentMethod === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setPaymentMethod(mode.id)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition cursor-pointer ${
                      isSelected
                        ? "bg-teal-50 border-[#126868] text-[#126868] ring-1 ring-[#126868]"
                        : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Icon size={16} className={`mt-0.5 ${isSelected ? "text-[#126868]" : "text-slate-400"}`} />
                    <div>
                      <div className="text-xs font-bold">{mode.label}</div>
                      <div className="text-[10px] text-slate-500">{mode.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FOOTER ACTIONS */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg border border-slate-200 hover:bg-slate-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-bold text-white bg-[#126868] hover:bg-[#0e5252] rounded-lg shadow-sm transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <FiCheck size={14} />
                  <span>Confirm & Collect ₹{paidAmount || 0}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
