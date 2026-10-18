import type { ReactNode } from "react";

// Shared by Marketing and Growth; keep the established dashboard KPI styling.
export default function DashboardMetricCard({
  label,
  value,
  sub,
  color = "var(--accent)",
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 18px",
        flex: "1 1 160px",
        minWidth: 150,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: color,
        }}
      />
      <div
        style={{
          fontSize: 11,
          color: "var(--dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          fontFamily: "monospace",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 4 }}>
          {sub}
        </div>
      )}
      {children}
    </div>
  );
}
