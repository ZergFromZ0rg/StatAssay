import { card, sectionTitle, thUtil, tdUtil } from "./uiStyles";
import { fmt } from "./reportHelpers";
import { CorrelationHeatmap } from "./charts";

const GROUPS = [
  { key: "correlations", label: "Correlations (numeric × numeric)" },
  { key: "group_differences", label: "Group differences (numeric × categorical)" },
  { key: "contingency", label: "Contingency (categorical × categorical)" },
  { key: "regression_models", label: "Regression models" },
  { key: "regression_coefficients", label: "Regression coefficients" },
];

function assumptionsText(row) {
  const failed = (row.assumptions || []).filter((a) => !a.ok).map((a) => a.name);
  return failed.length ? failed.join("; ") : "ok";
}

function ResultTable({ rows }) {
  if (!rows?.length) {
    return <div style={{ fontSize: 10, color: "var(--text-muted)", padding: "6px 0" }}>No tests in this family.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "var(--panel-strong)" }}>
            <th style={thUtil}>Variables</th>
            <th style={thUtil}>Test</th>
            <th style={{ ...thUtil, textAlign: "right" }}>n</th>
            <th style={{ ...thUtil, textAlign: "right" }}>Effect</th>
            <th style={{ ...thUtil, textAlign: "right" }}>p</th>
            <th style={{ ...thUtil, textAlign: "right" }}>q (FDR)</th>
            <th style={thUtil}>Assumptions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.vars.join("-")}-${i}`} style={{ background: i % 2 ? "var(--panel)" : "var(--panel-alt)" }}>
              <td style={tdUtil}>{r.vars.join(r.family === "regression_coefficient" ? " ← " : " · ")}</td>
              <td style={tdUtil}>{r.kind}</td>
              <td style={{ ...tdUtil, textAlign: "right" }}>{r.n}</td>
              <td style={{ ...tdUtil, textAlign: "right" }}>
                {r.effect_name} {fmt(r.effect_value)} <span style={{ color: "var(--text-muted)" }}>({r.effect_magnitude})</span>
              </td>
              <td style={{ ...tdUtil, textAlign: "right" }}>{fmt(r.p_raw)}</td>
              <td style={{ ...tdUtil, textAlign: "right" }}>{fmt(r.q_value)}</td>
              <td style={{ ...tdUtil, color: "var(--text-muted)" }}>{assumptionsText(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AllResults({ allResults, sweep }) {
  return (
    <div style={card}>
      <div style={sectionTitle}>All results</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
        {sweep?.n_tests?.correlations ?? 0} correlations ·{" "}
        {sweep?.n_tests?.group_differences ?? 0} group differences ·{" "}
        {sweep?.n_tests?.contingency ?? 0} contingency ·{" "}
        {sweep?.n_tests?.regression_models ?? 0} models
        {sweep?.column_cap_applied
          ? ` · ${sweep.excluded_columns.length} column(s) dropped by the ${sweep.column_cap}-column cap`
          : ""}
      </div>
      {allResults?.correlation_matrix && (
        <CorrelationHeatmap matrix={allResults.correlation_matrix} />
      )}
      {GROUPS.map((g) => (
        <details key={g.key} style={{ marginBottom: 6, border: "1px solid var(--border)", background: "var(--panel)" }}>
          <summary style={{ cursor: "pointer", padding: "6px 8px", fontSize: 11, fontWeight: 700, background: "var(--panel-strong)" }}>
            {g.label} ({allResults?.[g.key]?.length ?? 0})
          </summary>
          <div style={{ padding: 8 }}>
            <ResultTable rows={allResults?.[g.key]} />
          </div>
        </details>
      ))}
    </div>
  );
}
