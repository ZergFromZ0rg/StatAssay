import { card, sectionTitle, badge } from "./uiStyles";
import { fmt, FAMILY_LABEL, ROBUSTNESS_LABEL } from "./reportHelpers";

function Caveats({ items }) {
  if (!items?.length) return null;
  return (
    <ul style={{ margin: "6px 0 0 0", paddingLeft: 16 }}>
      {items.map((c, i) => (
        <li key={i} style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>{c}</li>
      ))}
    </ul>
  );
}

function FindingCard({ finding, tone }) {
  const robust = finding.robustness === "imputation-sensitive";
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${tone === "review" ? "var(--warning-text)" : "var(--accent)"}`,
        background: "var(--panel-alt)",
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
        {finding.rank ? `${finding.rank}. ` : ""}{finding.headline}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
        <span style={badge}>{FAMILY_LABEL[finding.family] || finding.family}</span>
        <span style={badge}>{finding.effect_name} = {fmt(finding.effect_value)}</span>
        <span style={badge}>{finding.effect_magnitude}</span>
        <span style={badge}>q = {fmt(finding.q_value)}</span>
        <span style={badge}>n = {finding.n}</span>
        {finding.robustness && (
          <span style={{ ...badge, background: robust ? "var(--warning-bg)" : "var(--panel-strong)", color: robust ? "var(--warning-text)" : "inherit" }}>
            {ROBUSTNESS_LABEL[finding.robustness] || finding.robustness}
          </span>
        )}
      </div>
      <Caveats items={finding.caveats} />
    </div>
  );
}

export default function Findings({ findings, needsReview, sensitivity }) {
  return (
    <div style={card}>
      <div style={sectionTitle}>Key findings</div>
      {findings.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          No results cleared the bar (FDR-adjusted q &lt; 0.05 and at least a medium effect size).
        </div>
      ) : (
        findings.map((f) => <FindingCard key={`${f.family}-${f.vars.join("-")}`} finding={f} />)
      )}

      {needsReview?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...sectionTitle, marginBottom: 6 }}>Needs manual review</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
            Statistically significant with a meaningful effect, but a core assumption failed —
            treat with caution and check by hand.
          </div>
          {needsReview.map((f) => (
            <FindingCard key={`r-${f.family}-${f.vars.join("-")}`} finding={f} tone="review" />
          ))}
        </div>
      )}

      {sensitivity?.applicable && (
        <div style={{ marginTop: 14, fontSize: 10, color: "var(--text-muted)" }}>
          Missing values were handled by dropping incomplete rows per test, and the whole sweep
          was repeated on a median/mode-imputed copy.{" "}
          {sensitivity.changed_count === 0
            ? "No findings changed between the two."
            : `${sensitivity.changed_count} finding(s) change between the two — flagged above.`}
        </div>
      )}
    </div>
  );
}
