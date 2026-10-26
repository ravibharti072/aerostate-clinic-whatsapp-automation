import React from "react";
import "./AerostateLogo.css";

export default function AerostateLogo({
  size = "md",
  className = "",
  animateOnParentHover = true,
}) {
  const sizeClass =
    size === "sm"
      ? "aerostate-logo-sm"
      : size === "lg"
      ? "aerostate-logo-lg"
      : "aerostate-logo-md";

  return (
    <div
      className={`aerostate-logo-mark ${sizeClass} ${
        animateOnParentHover ? "interactive" : ""
      } ${className}`}
      aria-label="AeroState Logo"
    >
      <div className="aerostate-logo-block block-top-left" />
      <div className="aerostate-logo-block block-bottom-right" />
      <div className="aerostate-logo-block block-bottom-left" />
    </div>
  );
}
