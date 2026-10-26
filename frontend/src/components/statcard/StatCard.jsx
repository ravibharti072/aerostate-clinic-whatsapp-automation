import React from "react";
import "./statCard.css";

export default function StatCard({ title, value, Icon, colorTheme = "blue", trend, trendData }) {
  const bgClass = `bg-light-${colorTheme}`;
  const colorClass = `color-${colorTheme}`;

  // 1. Determine trend badge color
  let trendClass = "trend-neutral";
  if (trend) {
    const strTrend = String(trend);
    if (strTrend.startsWith("+")) trendClass = "trend-positive";
    else if (strTrend.startsWith("-")) trendClass = "trend-negative";
  }

  // 2. Map colors for the SVG chart line
  const strokeColors = {
    blue: "#254d90",
    "brand-blue": "#254d90",
    teal: "#126868",
    "brand-teal": "#126868",
    green: "#16a34a",
    whatsapp: "#16a34a",
    orange: "#f97316",
    purple: "#79808d",
  };
  const chartColor = strokeColors[colorTheme] || strokeColors.blue;

  // 3. Generate clean, straight SVG path points
  let polylinePoints = "";
  
  if (trendData && trendData.length > 1) {
    const max = Math.max(...trendData);
    const min = Math.min(...trendData);
    const range = max - min;
    const width = 100;
    const height = 100; // Using a 100x100 grid for perfect proportional scaling

    const pointArray = trendData.map((val, i) => {
      // X stretches from exactly 0 to 100
      const x = (i / (trendData.length - 1)) * width;
      
      // Y scales cleanly. If flat (range 0), it draws a straight line at Y=80
      const y = range === 0 
        ? 80 
        : 90 - ((val - min) / range) * 70; 
        
      return `${x},${y}`;
    });

    polylinePoints = pointArray.join(" ");
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

      {/* Renders the edge-to-edge crisp line graph */}
      {trendData && trendData.length > 1 && (
        <svg className="stat-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline 
            points={polylinePoints} 
            fill="none" 
            stroke={chartColor} 
            strokeWidth="2" 
            vectorEffect="non-scaling-stroke" /* Keeps the line crisp when stretched */
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
        </svg>
      )}
    </div>
  );
}
