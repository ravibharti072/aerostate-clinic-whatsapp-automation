import React from "react";
import { FiAlertTriangle, FiRefreshCw } from "react-icons/fi";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-8 bg-white rounded-2xl border border-rose-200 shadow-sm m-4">
          <div className="max-w-md text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <FiAlertTriangle size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Module Display Issue</h3>
              <p className="text-xs text-slate-500 mt-1">
                {this.state.error?.message || "An unexpected rendering error occurred in this view."}
              </p>
            </div>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#254d90] text-white hover:bg-[#1a386b] transition cursor-pointer"
            >
              <FiRefreshCw size={14} />
              <span>Reload Module</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
