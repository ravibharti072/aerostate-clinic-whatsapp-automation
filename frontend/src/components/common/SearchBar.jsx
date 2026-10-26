import React from "react";
import { FiSearch, FiX } from "react-icons/fi";

/**
 * Reusable Standard SearchBar Component for all clinic modules & portals.
 * Standardized to exact 34px height, 300px width, 12.5px font size matching Reception.
 */
export default function SearchBar({
  value = "",
  onChange,
  onSearch,
  onClear,
  placeholder = "Search...",
  className = "",
  style = {},
  disabled = false,
  autoFocus = false,
  ...props
}) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (onSearch) {
        onSearch(value);
      }
    }
  };

  const handleChange = (e) => {
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div
      className={`dir-search-box ${className}`}
      style={{
        width: "300px",
        maxWidth: "300px",
        height: "34px",
        padding: "0 10px",
        ...style,
      }}
    >
      <FiSearch size={15} className="search-icon" style={{ flexShrink: 0, color: "#94a3b8" }} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        style={{ fontSize: "12.5px" }}
        {...props}
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition cursor-pointer"
          title="Clear search text"
        >
          <FiX size={13} />
        </button>
      )}
    </div>
  );
}
