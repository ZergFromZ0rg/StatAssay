import { useState } from "react";
import "./App.css";
import Report from "./components/Report";

const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

export default function App() {
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function analyze(selectedFile) {
    setErr("");
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      if (!selectedFile) throw new Error("Pick a CSV first.");
      const form = new FormData();
      form.append("file", selectedFile);

      const res = await fetch(`${API}/infer`, { method: "POST", body: form, signal: controller.signal });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
          /* keep the status-code message */
        }
        throw new Error(detail);
      }
      setReport(await res.json());
    } catch (e) {
      if (e?.name === "AbortError") {
        setErr("Analysis timed out. Is the backend running, and is the file small enough?");
      } else {
        setErr(String(e.message || e));
      }
      setReport(null);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function reset() {
    setReport(null);
    setFile(null);
    setErr("");
  }

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        padding: "16px 12px 48px",
        background: report ? "var(--bg)" : "var(--panel-strong)",
        color: "var(--text)",
        fontFamily: "monospace",
      }}
    >
      {!report && (
        <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: 0.5 }}>StatAssay</h1>
            <p style={{ margin: "6px 0 0 0", fontSize: 15, color: "var(--text-muted)" }}>
              Upload a CSV. Get an automatic statistical inference report.
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 14, width: 280, border: "none", background: "transparent", color: "var(--text)" }}
            />
            <button
              type="button"
              onClick={() => analyze(file)}
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
                color: "var(--accent-strong)",
                opacity: loading || !file ? 0.5 : 1,
              }}
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          <p style={{ marginTop: 18, fontSize: 10, color: "var(--text-muted)", maxWidth: 440, textAlign: "center", lineHeight: 1.6 }}>
            StatAssay tests every applicable pair of variables, corrects for multiple
            comparisons, and reports only what is statistically and practically notable.
            Results are exploratory — not evidence of causation.
          </p>
          {err && (
            <div style={{ marginTop: 16, padding: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", fontSize: 11, color: "var(--danger-text)", maxWidth: 440 }}>
              {err}
            </div>
          )}
        </div>
      )}

      {report && <Report data={report} onReset={reset} />}
    </div>
  );
}
