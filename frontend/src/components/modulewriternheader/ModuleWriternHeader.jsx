import React from "react";
import "./moduleWriternHeader.css";

export default function ModuleWriternHeader({ 
  title, 
  description, 
  badgeCount, 
  badgeLabel = "records",
  subBadge
}) {
  return (
    <div className="module-writern-header">
      <div className="module-writern-info">
        <div className="module-writern-title-line">
          <h3>{title}</h3>
          {badgeCount !== undefined && (
            <span className="module-writern-badge mobile-inline-badge">
              {badgeCount} {badgeLabel}
            </span>
          )}
        </div>
        {description && <p>{description}</p>}
      </div>
      {(badgeCount !== undefined || subBadge) && (
        <div className="module-writern-right">
          {subBadge && (
            <div className="module-writern-subbadge">
              {subBadge}
            </div>
          )}
          {badgeCount !== undefined && (
            <div className="module-writern-badge desktop-badge">
              {badgeCount} {badgeLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
