import React from "react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
} from "react-icons/fi";
import "./pagination.css";

export default function Pagination({
  currentPage = 1,
  totalItems = 0,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  itemLabel = "records",
}) {
  const isAll = pageSize === "all" || pageSize >= 999999;
  const numericPageSize = isAll ? Math.max(totalItems, 1) : Number(pageSize) || 20;
  const totalPages = Math.max(1, Math.ceil(totalItems / numericPageSize));
  const validCurrentPage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages);

  const startItem = totalItems === 0 ? 0 : (validCurrentPage - 1) * numericPageSize + 1;
  const endItem = Math.min(validCurrentPage * numericPageSize, totalItems);

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [];
    pages.push(1);

    if (validCurrentPage > 3) {
      pages.push("...");
    }

    const startMiddle = Math.max(2, validCurrentPage - 1);
    const endMiddle = Math.min(totalPages - 1, validCurrentPage + 1);

    for (let p = startMiddle; p <= endMiddle; p++) {
      pages.push(p);
    }

    if (validCurrentPage < totalPages - 2) {
      pages.push("...");
    }

    pages.push(totalPages);
    return pages;
  };

  const pages = getPageNumbers();

  // If there are no items or only 1 item and totalItems <= pageSize, we can still show info or full pagination
  if (totalItems === 0) {
    return null;
  }

  return (
    <div className="erp-pagination-container">
      <div className="erp-pagination-left">
        <div className="erp-pagination-info">
          Showing <strong>{startItem}</strong>–<strong>{endItem}</strong> of <strong>{totalItems}</strong> {itemLabel}
        </div>

        {onPageSizeChange && (
          <div className="erp-pagination-size-selector">
            <span>Show:</span>
            <select
              className="erp-pagination-select"
              value={pageSize}
              onChange={(e) => {
                const val = e.target.value === "all" ? "all" : Number(e.target.value);
                onPageSizeChange(val);
              }}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} per page
                </option>
              ))}
              <option value="all">View All</option>
            </select>
          </div>
        )}
      </div>

      <div className="erp-pagination-right">
        <button
          type="button"
          className="erp-pagination-btn"
          onClick={() => onPageChange(1)}
          disabled={validCurrentPage <= 1}
          title="First Page"
        >
          <FiChevronsLeft size={15} />
        </button>
        <button
          type="button"
          className="erp-pagination-btn"
          onClick={() => onPageChange(validCurrentPage - 1)}
          disabled={validCurrentPage <= 1}
          title="Previous Page"
        >
          <FiChevronLeft size={15} />
        </button>

        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} className="erp-pagination-ellipsis">
                &hellip;
              </span>
            );
          }
          return (
            <button
              key={p}
              type="button"
              className={`erp-pagination-btn ${p === validCurrentPage ? "active" : ""}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          className="erp-pagination-btn"
          onClick={() => onPageChange(validCurrentPage + 1)}
          disabled={validCurrentPage >= totalPages}
          title="Next Page"
        >
          <FiChevronRight size={15} />
        </button>
        <button
          type="button"
          className="erp-pagination-btn"
          onClick={() => onPageChange(totalPages)}
          disabled={validCurrentPage >= totalPages}
          title="Last Page"
        >
          <FiChevronsRight size={15} />
        </button>
      </div>
    </div>
  );
}
