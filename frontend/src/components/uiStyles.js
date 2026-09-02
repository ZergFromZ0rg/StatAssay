export const utilBtn = {
  padding: "5px 12px",
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  cursor: "pointer",
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "monospace",
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "var(--accent-strong)",
};

export const thUtil = {
  textAlign: "left",
  borderBottom: "1px solid var(--border)",
  padding: "4px 8px",
  fontWeight: 700,
  fontSize: 10,
};

export const tdUtil = {
  borderBottom: "1px solid var(--border)",
  padding: "4px 8px",
  fontSize: 10,
};

export const card = {
  border: "1px solid var(--border)",
  background: "var(--panel)",
  padding: 14,
  marginBottom: 14,
};

export const sectionTitle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  marginBottom: 10,
  color: "var(--text-muted)",
};

const SEVERITY_COLORS = {
  high: { bg: "var(--danger-bg)", border: "var(--danger-border)", text: "var(--danger-text)" },
  medium: { bg: "var(--warning-bg)", border: "#e6cf8f", text: "var(--warning-text)" },
  low: { bg: "var(--panel-strong)", border: "var(--border-strong)", text: "var(--text-muted)" },
};

export function severityStyle(severity) {
  return SEVERITY_COLORS[severity] || SEVERITY_COLORS.low;
}

export const badge = {
  display: "inline-block",
  fontSize: 9,
  padding: "2px 6px",
  border: "1px solid var(--border-strong)",
  background: "var(--panel-strong)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 700,
};
