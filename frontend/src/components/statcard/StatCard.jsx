import React from "react";
import "./statCard.css";

export default function StatCard({ title, value, Icon, colorTheme = "blue", trend }) {
  const bgClass = `bg-light-${colorTheme}`;
  const colorClass = `color-${colorTheme}`;

  // 1. Determine trend badge color
  let trendClass = "trend-neutral";
  if (trend) {
    const strTrend = String(trend);
    if (strTrend.startsWith("+")) trendClass = "trend-positive";
    else if (strTrend.startsWith("-")) trendClass = "trend-negative";
  }

  return (
    <div className="stat-card">
      <div className={`stat-icon-wrapper ${bgClass}`}>
        {Icon && <Icon size={24} className={colorClass} />}
      </div>
      
      <div className="stat-info">
        <p>{title}</p>
        <h2>{value}</h2>
      </div>

      {trend && (
        <div className={`stat-trend ${trendClass}`}>
          {trend}
        </div>
      )}
    </div>
  );
}
