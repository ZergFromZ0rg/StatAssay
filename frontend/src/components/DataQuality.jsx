import { card, sectionTitle, severityStyle } from "./uiStyles";

const SEVERITY_ORDER = ["high", "medium", "low"];

export default function DataQuality({ quality }) {
  const issues = quality?.issues ?? [];
  const grouped = SEVERITY_ORDER.map((sev) => ({
    sev,
    items: issues.filter((i) => i.severity === sev),
  })).filter((g) => g.items.length);

  return (
    <div style={card}>
      <div style={sectionTitle}>Data quality</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{quality?.score ?? "—"}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          / 100 &nbsp;·&nbsp; {quality?.summary ?? ""}
        </div>
      </div>

      {grouped.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No data-quality issues detected.</div>
      )}

      {grouped.map((group) => {
        const c = severityStyle(group.sev);
        return (
          <div key={group.sev} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: c.text, marginBottom: 4 }}>
              {group.sev} ({group.items.length})
            </div>
            {group.items.map((issue, idx) => (
              <div
                key={`${issue.kind}-${issue.column ?? ""}-${idx}`}
                style={{
                  fontSize: 11,
                  padding: "5px 8px",
                  marginBottom: 3,
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                }}
              >
                {issue.column ? <strong>{issue.column}: </strong> : null}
                {issue.message}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
