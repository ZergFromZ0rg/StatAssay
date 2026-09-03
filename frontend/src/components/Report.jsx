import { card, sectionTitle, utilBtn } from "./uiStyles";
import { downloadFile } from "./reportHelpers";
import DataQuality from "./DataQuality";
import Findings from "./Findings";
import Profile from "./Profile";
import AllResults from "./AllResults";
import ExportPanel from "./ExportPanel";

export default function Report({ data, onReset }) {
  if (!data) return null;
  const { meta, data_quality, findings, needs_review, imputation_sensitivity, profile, sweep, all_results } = data;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{meta.filename}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {meta.n_rows} rows · {meta.n_cols} columns · generated {meta.generated_at}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <button type="button" style={utilBtn} onClick={() => downloadFile("statguard_report.md", data.report_markdown, "text/markdown")}>
            report.md
          </button>
          <button type="button" style={utilBtn} onClick={() => downloadFile("statguard_report.json", JSON.stringify(data, null, 2), "application/json")}>
            report.json
          </button>
          <ExportPanel key={`${meta.filename}:${meta.generated_at}`} data={data} />
          <button type="button" style={utilBtn} onClick={onReset}>New file</button>
        </div>
      </div>

      <DataQuality quality={data_quality} profile={profile} />
      <Findings findings={findings} needsReview={needs_review} sensitivity={imputation_sensitivity} />
      <Profile profile={profile} />
      <AllResults allResults={all_results} sweep={sweep} />

      <div style={card}>
        <div style={sectionTitle}>Methodology</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>{data.methodology}</div>
      </div>
    </div>
  );
}
