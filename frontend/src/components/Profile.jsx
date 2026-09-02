import { card, sectionTitle, thUtil, tdUtil } from "./uiStyles";
import { fmt, pct } from "./reportHelpers";
import { Histogram } from "./charts";

const TYPE_LABEL = {
  numeric: "Numeric",
  categorical: "Categorical",
  datetime: "Date/time",
  excluded: "Excluded",
};

export default function Profile({ profile }) {
  const columns = profile?.columns ?? [];
  const counts = profile?.type_counts ?? {};
  const distributions = columns.filter((c) => c.stats?.histogram?.counts?.length);

  return (
    <div style={card}>
      <div style={sectionTitle}>Columns</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        {counts.numeric || 0} numeric · {counts.categorical || 0} categorical ·{" "}
        {counts.datetime || 0} date/time · {counts.excluded || 0} excluded
      </div>
      <div style={{ border: "1px solid var(--border)", maxHeight: 320, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ background: "var(--panel-strong)", position: "sticky", top: 0 }}>
              <th style={thUtil}>Column</th>
              <th style={thUtil}>Type</th>
              <th style={{ ...thUtil, textAlign: "right" }}>Missing</th>
              <th style={{ ...thUtil, textAlign: "right" }}>Unique</th>
              <th style={{ ...thUtil, textAlign: "right" }}>Mean</th>
              <th style={{ ...thUtil, textAlign: "right" }}>Std</th>
              <th style={{ ...thUtil, textAlign: "right" }}>Min</th>
              <th style={{ ...thUtil, textAlign: "right" }}>Max</th>
              <th style={thUtil}>Note</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => {
              const s = col.stats || {};
              return (
                <tr key={col.name} style={{ background: i % 2 ? "var(--panel)" : "var(--panel-alt)" }}>
                  <td style={tdUtil}>{col.name}{col.coerced_from_text ? " *" : ""}</td>
                  <td style={tdUtil}>{TYPE_LABEL[col.type] || col.type}</td>
                  <td style={{ ...tdUtil, textAlign: "right" }}>{pct(col.pct_missing, 1)}</td>
                  <td style={{ ...tdUtil, textAlign: "right" }}>{col.n_unique}</td>
                  <td style={{ ...tdUtil, textAlign: "right" }}>{s.mean === undefined ? "" : fmt(s.mean)}</td>
                  <td style={{ ...tdUtil, textAlign: "right" }}>{s.std === undefined ? "" : fmt(s.std)}</td>
                  <td style={{ ...tdUtil, textAlign: "right" }}>{s.min === undefined ? "" : fmt(s.min)}</td>
                  <td style={{ ...tdUtil, textAlign: "right" }}>{s.max === undefined ? "" : fmt(s.max)}</td>
                  <td style={{ ...tdUtil, color: "var(--text-muted)" }}>{col.exclude_reason || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>* parsed from text</div>

      {distributions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 6 }}>
            Distributions
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {distributions.map((col) => (
              <Histogram key={col.name} hist={col.stats.histogram} label={col.name} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
