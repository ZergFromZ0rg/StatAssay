import { useEffect, useMemo, useState } from "react";
import "./App.css";
import OverviewPanel from "./components/OverviewPanel";
import ResearchQuestionPanel from "./components/ResearchQuestionPanel";
import ModelDiagnosticsPanel from "./components/ModelDiagnosticsPanel";
import ResultsPanel from "./components/ResultsPanel";

const API = "http://127.0.0.1:5000";
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};
const INITIAL_ANALYSIS_INTENT = {
  type: null,
  outcome: "",
  predictors: [],
  group: "",
  varA: "",
  varB: "",
  warnings: [],
  errors: {},
  note: "",
  intentLog: [],
};

export default function App() {
  const [file, setFile] = useState(null);
  const [active, setActive] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [columnRoles, setColumnRoles] = useState({});
  const [prepLog, setPrepLog] = useState([]);
  const [resultsBundle, setResultsBundle] = useState(null);
  const [analysisIntent, setAnalysisIntent] = useState(INITIAL_ANALYSIS_INTENT);

  async function analyzeFile(selectedFile) {
    setErr("");
    setLoading(true);
    // Don't clear data - keep old data visible while loading

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      if (!selectedFile) throw new Error("Pick a CSV first.");
      const form = new FormData();
      form.append("file", selectedFile);

      const res = await fetch(`${API}/analyze`, { method: "POST", body: form, signal: controller.signal });
      if (!res.ok) throw new Error(`Analyze failed (HTTP ${res.status})`);

      const json = await res.json();
      setData(json);
      setColumnRoles({});
      setPrepLog([]);
      setAnalysisIntent(INITIAL_ANALYSIS_INTENT);
      setActive("overview");
    } catch (e) {
      if (e?.name === "AbortError") {
        setErr("Analyze timed out. Is the backend running?");
      } else {
        setErr(String(e));
      }
      setData(null); // Only clear on error
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  const columns = data?.columns ?? EMPTY_ARRAY;
  const missing = data?.missing_by_column ?? EMPTY_OBJECT;
  const describe = data?.describe ?? null;
  const shape = data?.shape ?? null;
  const nunique = data?.nunique ?? EMPTY_OBJECT;
  const duplicateRows = data?.duplicate_rows ?? { count: 0, indices: [] };
  const extremeValueFlags = data?.extreme_value_flags ?? {};
  const distributionFlags = data?.distribution_flags ?? {};

  const numericColumns = useMemo(() => {
    if (!describe) return [];
    return Object.keys(describe);
  }, [describe]);

  const columnsInfo = useMemo(() => {
    const rows = Number(shape?.rows) || 0;
    return columns.map((name) => {
      const uniqueCount = Number(nunique?.[name]);
      const uniqueRatio = rows ? uniqueCount / rows : 0;
      const missingCount = Number(missing?.[name] ?? 0);
      const missingPct = rows ? missingCount / rows : 0;
      const detectedType = numericColumns.includes(name)
        ? "numeric"
        : uniqueRatio >= 0.5
          ? "text"
          : "categorical";
      const role = columnRoles?.[name] || (isIdLikeColumn(name, nunique, shape?.rows) ? "identifier" : "predictor");
      return {
        name,
        detectedType,
        role,
        uniqueRatio,
        missingPct,
        levelsCount: detectedType === "categorical" && Number.isFinite(uniqueCount) ? uniqueCount : null,
      };
    });
  }, [columns, numericColumns, nunique, missing, shape, columnRoles]);

  const prepDecisions = useMemo(() => {
    const latest = (action) => {
      const entries = prepLog.filter((entry) => entry.action === action);
      return entries.length ? entries[entries.length - 1] : null;
    };
    const missingDrop = latest("missing_drop_rows")?.enabled;
    const missingMean = latest("missing_impute_mean")?.enabled;
    const missingMedian = latest("missing_impute_median")?.enabled;
    const dropHigh = latest("missing_drop_columns")?.enabled;
    const thresholdEntry = latest("missing_threshold");
    let missingStrategy = "none";
    if (missingDrop) missingStrategy = "drop_rows";
    else if (missingMean) missingStrategy = "impute_mean";
    else if (missingMedian) missingStrategy = "impute_median";

    return {
      missingStrategy,
      dropColumnsAbovePct: dropHigh ? thresholdEntry?.value / 100 : null,
      duplicatesRemoved: latest("duplicate_removal")?.enabled || false,
      excludedColumns: Object.keys(columnRoles).filter((col) => columnRoles[col] === "excluded"),
      identifierColumns: Object.keys(columnRoles).filter((col) => columnRoles[col] === "identifier"),
    };
  }, [prepLog, columnRoles]);

  useEffect(() => {
    if (!columns.length) return;
    const defaults = {};
    columns.forEach((col) => {
      defaults[col] = isIdLikeColumn(col, nunique, shape?.rows) ? "identifier" : "predictor";
    });
    setColumnRoles((prev) => (Object.keys(prev).length ? prev : defaults));
  }, [columns, nunique, shape]);

  return (
    <div
        style={{
          width: "100%",
          minHeight: "100vh",
          padding: "12px",
          background: data ? "var(--bg)" : "var(--panel-strong)",
          color: "var(--text)",
          fontFamily: "monospace",
          display: "flex",
          alignItems: data ? "stretch" : "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: "100%", width: "100%", margin: "0 auto", background: data ? "var(--panel)" : "transparent", border: data ? "1px solid var(--border)" : "none" }}>
          {!data && (
            <div style={{ minHeight: "100vh", padding: "40px 12px 24px", background: "var(--panel-strong)" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ textAlign: "center", marginTop: 6 }}>
                  <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: 0.5 }}>CSV MATRIX</h1>
                  <p style={{ margin: "4px 0 0 0", fontSize: 17, color: "var(--text)" }}>Statistical Analysis Tool</p>
                </div>
                <div style={{ height: 26 }} />
                <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center", marginTop: 6 }}>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    style={{
                      fontSize: 15,
                      width: "280px",
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      color: "var(--text)",
                    }}
                  />
                  <button
                    onClick={() => analyzeFile(file)}
                    disabled={loading || !file}
                    style={{
                      padding: "10px 18px",
                      border: "1px solid var(--accent)",
                      background: "var(--panel)",
                      cursor: loading || !file ? "not-allowed" : "pointer",
                      fontSize: 15,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      width: "140px",
                      color: "var(--accent-strong)",
                      opacity: loading || !file ? 0.5 : 1,
                    }}
                  >
                    <span style={{ visibility: loading ? "visible" : "hidden", position: loading ? "static" : "absolute" }}>ANALYZING</span>
                    <span style={{ visibility: loading ? "hidden" : "visible", position: loading ? "absolute" : "static" }}>ANALYZE</span>
                  </button>
                </div>
              </div>
            </div>
          )}

        {err && (
          <div style={{ padding: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", fontSize: 11, color: "var(--danger-text)" }}>
            {err}
          </div>
        )}

        <div style={{ padding: 12, minHeight: 200 }}>
          <div style={{ display: data ? "block" : "none", position: "relative" }}>
            {loading && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "rgba(246, 251, 246, 0.92)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 10,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ANALYZING...
              </div>
            )}

            {data && (
              <>
                <div style={{ display: active === "overview" ? "block" : "none" }}>
                  <OverviewPanel
                    shape={shape}
                    columns={columns}
                    missing={missing}
                    numericColumns={numericColumns}
                    describe={describe}
                    nunique={nunique}
                    duplicateRows={duplicateRows}
                    extremeValueFlags={extremeValueFlags}
                    distributionFlags={distributionFlags}
                    columnRoles={columnRoles}
                    onRolesChange={setColumnRoles}
                    onPrepLog={(entry) => setPrepLog((prev) => [...prev, entry])}
                    api={API}
                    onContinue={() => setActive("research-question")}
                    file={file}
                  />
                </div>
                <div style={{ display: active === "research-question" ? "block" : "none" }}>
                  <ResearchQuestionPanel
                    columnsInfo={columnsInfo}
                    analysisIntent={analysisIntent}
                    setAnalysisIntent={setAnalysisIntent}
                    onProceed={() => setActive("model-diagnostics")}
                    onBack={() => setActive("overview")}
                  />
                </div>
                <div style={{ display: active === "model-diagnostics" ? "block" : "none" }}>
                  <ModelDiagnosticsPanel
                    api={API}
                    file={file}
                    columnsInfo={columnsInfo}
                    analysisIntent={analysisIntent}
                    prepDecisions={prepDecisions}
                    prepLog={prepLog}
                    onBackToIntent={() => setActive("research-question")}
                    onContinueToResults={(bundle) => {
                      setResultsBundle(bundle);
                      setActive("results");
                    }}
                  />
                </div>
                <div style={{ display: active === "results" ? "block" : "none" }}>
                  <ResultsPanel
                    bundle={resultsBundle}
                    onBackToPhase2={() => setActive("overview")}
                    onBackToPhase3={() => setActive("research-question")}
                    onBackToPhase4={() => setActive("model-diagnostics")}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function isIdLikeColumn(col, nunique, rows) {
  const rowCount = Number(rows);
  const rawName = String(col);
  const spaced = rawName.replace(/([a-z])([A-Z])/g, "$1 $2");
  const normalized = spaced.replace(/[^a-zA-Z0-9]+/g, " ").toLowerCase();
  const tokens = normalized.split(" ").filter(Boolean);
  const nameMatches = tokens.some((token) => {
    if (token === "id" || token === "uuid" || token === "guid") return true;
    if (token.endsWith("id")) return true;
    if (token === "accountnumber") return true;
    if (token === "recordid") return true;
    return false;
  });
  if (nameMatches) return true;
  if (!rowCount) return false;
  const unique = Number(nunique?.[col]);
  if (!Number.isFinite(unique)) return false;
  return unique / rowCount >= 0.95;
}
