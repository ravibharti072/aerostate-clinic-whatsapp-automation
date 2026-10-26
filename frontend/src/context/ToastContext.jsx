import React, { createContext, useContext, useState, useCallback } from "react";
import { FiCheckCircle, FiAlertCircle, FiInfo, FiX, FiBell } from "react-icons/fi";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [timerId, setTimerId] = useState(null);

  const showToast = useCallback((message, type = "success", duration = 3500) => {
    if (timerId) clearTimeout(timerId);
    setToast({ message, type });
    const id = setTimeout(() => {
      setToast(null);
    }, duration);
    setTimerId(id);
  }, [timerId]);

  const hideToast = useCallback(() => {
    if (timerId) clearTimeout(timerId);
    setToast(null);
  }, [timerId]);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast && (
        <div
          className={`toast-notification ${toast.type}`}
          role="status"
          aria-live="polite"
        >
          {toast.type === "success" && <FiCheckCircle className="toast-icon" size={17} />}
          {toast.type === "whatsapp" && <FiBell className="toast-icon" size={17} />}
          {toast.type === "error" && <FiAlertCircle className="toast-icon" size={17} />}
          {toast.type === "info" && <FiInfo className="toast-icon" size={17} />}
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close-btn"
            onClick={hideToast}
            title="Dismiss"
          >
            <FiX size={14} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: (msg) => console.log(msg),
      hideToast: () => {},
    };
  }
  return context;
}
