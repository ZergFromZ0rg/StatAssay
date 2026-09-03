import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { utilBtn } from "./uiStyles";
import {
  FindingChart,
  CorrelationHeatmap,
  Histogram,
  DistributionBox,
} from "./charts";

const SHAPE_KINDS = new Set(["extreme_values", "outliers", "skew", "heavy_tails"]);

const CHART_LABEL = {
  scatter: "scatter plot",
  box: "box plot",
  contingency: "category breakdown",
  residual: "residuals vs fitted",
  influence: "Cook's distance",
  added_variable: "partial-regression plot",
};

/* Flatten every chart in the report into a pickable list. Each item carries a
   React node so the print view can re-render it without touching the live DOM. */
function collectCharts(data) {
  const out = [];

  const lists = [
    ...(data.findings || []).map((f) => ["Finding", f]),
    ...(data.needs_review || []).map((f) => ["Review", f]),
  ];
  lists.forEach(([tag, f], fi) => {
    (f.charts || []).forEach((c, ci) => {
      out.push({
        id: `${tag}-${fi}-${ci}`,
        group: "Findings",
        label: `${tag}${f.rank ? " " + f.rank : ""} — ${CHART_LABEL[c.type] || c.type}`,
        sub: f.headline,
        node: <FindingChart chart={c} />,
      });
    });
  });

  const cm = data.all_results?.correlation_matrix;
  if (cm && (cm.columns?.length ?? 0) >= 2) {
    out.push({
      id: "corr-heatmap",
      group: "Overview",
      label: "Correlation matrix",
      node: <CorrelationHeatmap matrix={cm} maxWidth={640} />,
    });
  }

  const flagged = new Set(
    (data.data_quality?.issues || [])
      .filter((i) => SHAPE_KINDS.has(i.kind) && i.column)
      .map((i) => i.column),
  );
  (data.profile?.columns || []).forEach((col) => {
    const h = col.stats?.histogram;
    if (h?.counts?.length) {
      out.push({
        id: `hist-${col.name}`,
        group: "Distributions",
        label: `Histogram — ${col.name}`,
        node: <Histogram hist={h} label={col.name} width={300} height={120} />,
      });
    }
    if (flagged.has(col.name) && col.stats?.box) {
      out.push({
        id: `box-${col.name}`,
        group: "Distributions",
        label: `Box plot — ${col.name}`,
        node: <DistributionBox box={col.stats.box} label={col.name} skew={col.stats.skew} width={320} />,
      });
    }
  });

  return out;
}

const GROUP_ORDER = ["Findings", "Overview", "Distributions"];

export default function ExportPanel({ data }) {
  const meta = data.meta;
  const items = useMemo(() => collectCharts(data), [data]);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(() => new Set(items.map((i) => i.id)));
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return undefined;
    const stop = () => setPrinting(false);
    window.addEventListener("afterprint", stop);
    const t = setTimeout(() => {
      window.print();
      setPrinting(false); // print() blocks in Chrome/Firefox; afterprint is the fallback
    }, 60);
    return () => {
      window.removeEventListener("afterprint", stop);
      clearTimeout(t);
    };
  }, [printing]);

  if (!items.length) return null;

  const groups = GROUP_ORDER.map((g) => ({ g, rows: items.filter((i) => i.group === g) })).filter(
    (x) => x.rows.length,
  );
  const selected = items.filter((i) => checked.has(i.id));

  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (on) => setChecked(on ? new Set(items.map((i) => i.id)) : new Set());

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button type="button" style={utilBtn} onClick={() => setOpen((o) => !o)}>
        Export PDF
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 20,
            width: 320,
            maxHeight: "70vh",
            overflowY: "auto",
            background: "var(--panel)",
            border: "1px solid var(--border-strong)",
            padding: 12,
            fontFamily: "monospace",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
              Charts to export
            </span>
            <span style={{ fontSize: 10 }}>
              <button type="button" onClick={() => setAll(true)} style={linkBtn}>all</button>
              {" · "}
              <button type="button" onClick={() => setAll(false)} style={linkBtn}>none</button>
            </span>
          </div>

          {groups.map(({ g, rows }) => (
            <div key={g} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
                {g}
              </div>
              {rows.map((i) => (
                <label key={i.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 10, padding: "2px 0", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked.has(i.id)}
                    onChange={() => toggle(i.id)}
                    style={{ marginTop: 1 }}
                  />
                  <span>
                    {i.label}
                    {i.sub ? <span style={{ color: "var(--text-muted)" }}> · {i.sub}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setPrinting(true);
            }}
            disabled={!selected.length}
            style={{
              ...utilBtn,
              width: "100%",
              marginTop: 4,
              opacity: selected.length ? 1 : 0.5,
              cursor: selected.length ? "pointer" : "not-allowed",
            }}
          >
            Save as PDF ({selected.length})
          </button>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
            Opens the browser print dialog — choose “Save as PDF”.
          </div>
        </div>
      )}

      {printing &&
        createPortal(
          <div id="print-root">
            <h1>{meta.filename}</h1>
            <div style={{ fontSize: 10, color: "#5b6a5b", marginBottom: 10 }}>
              {meta.n_rows} rows · {meta.n_cols} columns · generated {meta.generated_at}
            </div>
            {selected.map((i) => (
              <figure key={i.id} className="print-item" style={{ margin: 0 }}>
                <figcaption>
                  {i.label}
                  {i.sub ? ` · ${i.sub}` : ""}
                </figcaption>
                {i.node}
              </figure>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

const linkBtn = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  fontSize: 10,
  color: "var(--accent-strong)",
  cursor: "pointer",
  textDecoration: "underline",
};
