import React from "react";
import { FiSearch, FiX } from "react-icons/fi";

/**
 * Reusable Standard SearchBar Component for all clinic modules & portals.
 * Standardized with integrated mobile/desktop search button and clear action.
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

  const handleSearchClick = () => {
    if (onSearch) {
      onSearch(value);
    }
  };

  return (
    <div
      className={`dir-search-container flex items-center gap-2 ${className}`}
      style={{
        ...style,
      }}
    >
      <div className="dir-search-box flex-1">
        <button
          type="button"
          onClick={handleSearchClick}
          className="search-icon-trigger text-slate-400 hover:text-[#254d90] transition cursor-pointer flex items-center justify-center p-0 border-0 bg-transparent shrink-0"
          title="Search"
        >
          <FiSearch size={15} className="search-icon" style={{ flexShrink: 0 }} />
        </button>

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
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition cursor-pointer shrink-0"
            title="Clear search text"
          >
            <FiX size={13} />
          </button>
        )}
      </div>

      {onSearch && (
        <button
          type="button"
          onClick={handleSearchClick}
          className="btn-submit"
          style={{
            height: "34px",
            padding: "0 14px",
            fontSize: "12.5px",
            flexShrink: 0,
            width: "auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            borderRadius: "8px",
          }}
          title="Execute search"
        >
          Search
        </button>
      )}
    </div>
  );
}
