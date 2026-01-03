import { useEffect, useMemo, useState } from "react";
import { utilBtn } from "./uiStyles";
import { useAnalysisIntent } from "./analysisIntentStore.jsx";
import {
  buildPhase4LogEntry,
  deriveValidity,
  shouldUnlockAdjustments,
  validateJustification,
  validateTransformChoice,
} from "./phase4Utils";

export default function ModelDiagnosticsPanel({ api, file, columnsInfo = [], prepDecisions, prepLog, onBackToIntent, onContinueToResults }) {
  const { analysisIntent, setAnalysisIntent } = useAnalysisIntent();
  const [phase4State, setPhase4State] = useState({
    diagnostics: null,
    flags: {},
    validity: "yellow",
    validityReasons: [],
    adjustments: {
      transformOutcome: "none",
      outlierMode: "flag",
      outlierRule: "3xIQR",
      excludedOutlierCount: 0,
      justification: { transform: "", outliers: "" },
      confirmOutlierExclusion: false,
    },
    ui: {
      diagnosticsRun: false,
      adjustmentsUnlocked: false,
      errors: {},
      warnings: [],
      improvements: [],
    },
    phase4Log: [],
  });
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const datasetId = file?.name || "dataset";
  const columnsByName = useMemo(
    () => Object.fromEntries(columnsInfo.map((col) => [col.name, col])),
    [columnsInfo]
  );

  const intentSnapshot = useMemo(() => ({
    type: analysisIntent.type,
    outcome: analysisIntent.outcome,
    predictors: analysisIntent.predictors,
    group: analysisIntent.group,
    varA: analysisIntent.varA,
    varB: analysisIntent.varB,
  }), [analysisIntent]);

  const hasValidPlan = useMemo(() => {
    if (analysisIntent.type === "predict") {
      return Boolean(analysisIntent.outcome) && (analysisIntent.predictors || []).length >= 1;
    }
    if (analysisIntent.type === "compare_means") {
      return Boolean(analysisIntent.outcome) && Boolean(analysisIntent.group);
    }
    if (analysisIntent.type === "association") {
      return Boolean(analysisIntent.varA) && Boolean(analysisIntent.varB);
    }
    return false;
  }, [analysisIntent]);

  const canRunDiagnostics = hasValidPlan;

  async function runDiagnostics({ transform = "none", outlierMode = "flag" } = {}) {
    if (!canRunDiagnostics) return;
    if (!file) {
      setError("No dataset loaded.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("intent_type", analysisIntent.type || "");
      form.append("outcome", analysisIntent.outcome || "");
      (analysisIntent.predictors || []).forEach((pred) => form.append("predictors", pred));
      form.append("group", analysisIntent.group || "");
      form.append("var_a", analysisIntent.varA || "");
      form.append("var_b", analysisIntent.varB || "");
      form.append("transform", transform);
      form.append("outlier_mode", outlierMode);
      form.append("outlier_rule", "3xIQR");

      const res = await fetch(`${api}/phase4_diagnostics`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`Diagnostics failed (HTTP ${res.status})`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      const flags = json.flags || {};
      const validity = deriveValidity(flags);
      const adjustmentsGate = shouldUnlockAdjustments(flags);

      setPhase4State((prev) => ({
        ...prev,
        diagnostics: json,
        flags,
        validity: validity.validity,
        validityReasons: validity.reasons,
        adjustments: {
          ...prev.adjustments,
          transformOutcome: transform,
          outlierMode,
          excludedOutlierCount: json.adjustments?.excluded_count || 0,
        },
        ui: {
          ...prev.ui,
          diagnosticsRun: true,
          adjustmentsUnlocked: adjustmentsGate.any,
          warnings: json.warnings || [],
          errors: {},
          improvements: prev.ui.improvements,
        },
      }));

      setPhase4State((prev) => ({
        ...prev,
        phase4Log: [
          ...prev.phase4Log,
          buildPhase4LogEntry({
            datasetId,
            intentSnapshot,
            actionType: "run_diagnostics",
            parameters: {
              transform,
              outlierRule: "3xIQR",
              outlierMode,
              excludedOutlierCount: json.adjustments?.excluded_count || 0,
              thresholds: json.thresholds || null,
            },
            diagnosticsSummaryAfter: {
              flags,
              keyMetrics: json.key_metrics || {},
            },
          }),
        ],
      }));
      return json;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }


  function handleTransformApply() {
    const outcomeMin = phase4State.diagnostics?.outcome_min ?? null;
    const transform = phase4State.adjustments.transformOutcome;
    const transformError = validateTransformChoice(outcomeMin, transform);
    const justError = validateJustification(phase4State.adjustments.justification.transform);

    if (transform === "none") {
      setPhase4State((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          errors: { ...prev.ui.errors, transform: "Select a transform before applying." },
        },
      }));
      return;
    }

    if (transformError || justError) {
      setPhase4State((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          errors: {
            ...prev.ui.errors,
            transform: transformError || justError,
          },
        },
      }));
      return;
    }

    const before = phase4State.diagnostics;
    runDiagnostics({ transform, outlierMode: phase4State.adjustments.outlierMode }).then((after) => {
      const improvements = [];
      if (before?.flags && after?.flags) {
        if (before.flags.normalityPoor && !after.flags.normalityPoor) improvements.push("Normality improved.");
        if (before.flags.heteroskedastic && !after.flags.heteroskedastic) improvements.push("Variance stability improved.");
        if (before.flags.rightSkewed && !after.flags.rightSkewed) improvements.push("Skew improved.");
      }
      setPhase4State((prev) => ({
        ...prev,
        ui: { ...prev.ui, improvements },
        phase4Log: [
          ...prev.phase4Log,
          buildPhase4LogEntry({
            datasetId,
            intentSnapshot,
            actionType: "apply_outcome_transform",
            parameters: {
              transform,
              outlierRule: "3xIQR",
              excludedOutlierCount: prev.adjustments.excludedOutlierCount,
              thresholds: prev.diagnostics?.thresholds || null,
            },
            justification: prev.adjustments.justification.transform,
            diagnosticsSummaryBefore: before ? { flags: before.flags, keyMetrics: before.key_metrics || {} } : null,
            diagnosticsSummaryAfter: after ? { flags: after.flags, keyMetrics: after.key_metrics || {} } : null,
          }),
        ],
      }));
    });
  }

  function handleOutlierApply() {
    const justification = phase4State.adjustments.justification.outliers;
    const justError = validateJustification(justification);

    if (!phase4State.adjustments.confirmOutlierExclusion) {
      setPhase4State((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          errors: { ...prev.ui.errors, outliers: "Please confirm you understand this changes the analysis." },
        },
      }));
      return;
    }

    if (justError) {
      setPhase4State((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          errors: { ...prev.ui.errors, outliers: justError },
        },
      }));
      return;
    }

    const before = phase4State.diagnostics;
    runDiagnostics({ transform: phase4State.adjustments.transformOutcome, outlierMode: "exclude" }).then((after) => {
      const improvements = [];
      if (before?.flags && after?.flags) {
        if (before.flags.influentialPoints && !after.flags.influentialPoints) improvements.push("Influence risk reduced.");
        if (before.flags.outlierFlagged && !after.flags.outlierFlagged) improvements.push("Outlier impact reduced.");
      }
      setPhase4State((prev) => ({
        ...prev,
        ui: { ...prev.ui, improvements },
        phase4Log: [
          ...prev.phase4Log,
          buildPhase4LogEntry({
            datasetId,
            intentSnapshot,
            actionType: "exclude_outliers",
            parameters: {
              transform: prev.adjustments.transformOutcome,
              outlierRule: "3xIQR",
              outlierMode: "exclude",
              excludedOutlierCount: prev.adjustments.excludedOutlierCount,
              thresholds: prev.diagnostics?.thresholds || null,
            },
            justification,
            diagnosticsSummaryBefore: before ? { flags: before.flags, keyMetrics: before.key_metrics || {} } : null,
            diagnosticsSummaryAfter: after ? { flags: after.flags, keyMetrics: after.key_metrics || {} } : null,
          }),
        ],
      }));
    });
  }

  function handleResetAdjustments() {
    setPhase4State((prev) => ({
      ...prev,
      adjustments: {
        ...prev.adjustments,
        transformOutcome: "none",
        outlierMode: "flag",
        outlierRule: "3xIQR",
        excludedOutlierCount: 0,
        justification: { transform: "", outliers: "" },
        confirmOutlierExclusion: false,
      },
      ui: { ...prev.ui, errors: {} },
      phase4Log: [
        ...prev.phase4Log,
        buildPhase4LogEntry({
          datasetId,
          intentSnapshot,
          actionType: "reset_adjustments",
          parameters: { transform: "none", outlierRule: "3xIQR" },
        }),
      ],
    }));
    runDiagnostics({ transform: "none", outlierMode: "flag" });
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === "\"") {
        if (inQuotes && next === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (!inQuotes && (ch === "," || ch === "\n" || ch === "\r")) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(field);
        field = "";
        if (ch !== ",") {
          if (row.length > 1 || row[0] !== "") rows.push(row);
          row = [];
        }
        continue;
      }
      field += ch;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    if (!rows.length) return [];
    const header = rows[0];
    return rows.slice(1).map((r) => {
      const rowObj = {};
      header.forEach((h, idx) => {
        rowObj[h] = r[idx] ?? "";
      });
      return rowObj;
    });
  }

  async function handleContinue() {
    if (!file) return;
    const text = await file.text();
    const rawData = parseCsv(text);
    const bundle = {
      preparedDatasetState: {
        columns: columnsInfo,
        rawData,
        prepDecisions: prepDecisions || {},
        prepLog: prepLog || [],
      },
      intent: {
        type: analysisIntent.type,
        predict: analysisIntent.type === "predict"
          ? { outcome: analysisIntent.outcome, predictors: analysisIntent.predictors || [] }
          : null,
        compare_means: analysisIntent.type === "compare_means"
          ? { outcome: analysisIntent.outcome, group: analysisIntent.group }
          : null,
        association: analysisIntent.type === "association"
          ? { varA: analysisIntent.varA, varB: analysisIntent.varB }
          : null,
        intentLog: analysisIntent.intentLog || [],
      },
      phase4: {
        diagnosticsRun: phase4State.ui.diagnosticsRun,
        diagnostics: phase4State.diagnostics,
        validityStatus: phase4State.validity,
        validityReasons: phase4State.validityReasons,
        adjustments: phase4State.adjustments,
        phase4Log: phase4State.phase4Log,
      },
    };
    onContinueToResults?.(bundle);
  }

  function renderPlanSummary() {
    if (!analysisIntent.type) return null;
    if (analysisIntent.type === "predict") {
      return (
        <div style={{ fontSize: 11 }}>
          <div><strong>Goal:</strong> Predict a numeric outcome.</div>
          <div><strong>Outcome:</strong> {analysisIntent.outcome || "—"}</div>
          <div><strong>Predictors:</strong> {(analysisIntent.predictors || []).join(", ") || "—"}</div>
        </div>
      );
    }
    if (analysisIntent.type === "compare_means") {
      return (
        <div style={{ fontSize: 11 }}>
          <div><strong>Goal:</strong> Compare group means.</div>
          <div><strong>Outcome:</strong> {analysisIntent.outcome || "—"}</div>
          <div><strong>Group:</strong> {analysisIntent.group || "—"}</div>
        </div>
      );
    }
    return (
      <div style={{ fontSize: 11 }}>
        <div><strong>Goal:</strong> Test association between variables.</div>
        <div><strong>Variable A:</strong> {analysisIntent.varA || "—"}</div>
        <div><strong>Variable B:</strong> {analysisIntent.varB || "—"}</div>
      </div>
    );
  }

  const validityLabel = phase4State.validity === "green"
    ? "✅ OK"
    : phase4State.validity === "yellow"
      ? "⚠ Caution"
      : "⛔ Not reliable";

  const adjustmentsGate = shouldUnlockAdjustments(phase4State.flags);
  const adjustmentsUnlocked = phase4State.ui.diagnosticsRun && adjustmentsGate.any;
  const canTransform = adjustmentsGate.transformTrigger && analysisIntent.type !== "association";
  const canExcludeOutliers = adjustmentsGate.outlierTrigger;
  const diag = phase4State.diagnostics?.diagnostics || phase4State.diagnostics;
  const hasDiag = !!diag;

  return (
    <div>
      <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 16, marginBottom: 12, textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Model Diagnostics & Transform Reasoning</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Diagnostics come first. Adjustments are optional and logged.
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>SECTION 4.1 — ANALYSIS PLAN</div>
          <button type="button" onClick={onBackToIntent} style={{ ...utilBtn, fontSize: 10 }}>
            Change research question
          </button>
        </div>
        <div style={{ marginBottom: 8 }}>{renderPlanSummary()}</div>
        <button
          type="button"
          onClick={() => runDiagnostics()}
          disabled={!hasValidPlan || loading}
          style={{
            ...utilBtn,
            fontSize: 12,
            padding: "10px 18px",
            borderWidth: 2,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {loading ? "RUNNING..." : "Run diagnostics"}
        </button>
        {!hasValidPlan && (
          <div style={{ marginTop: 6, fontSize: 10, color: "var(--danger-text)" }}>
            Outcome and predictors required.
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, padding: 8, border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-text)", fontSize: 10 }}>
            {error}
          </div>
        )}
      </div>

      {phase4State.ui.diagnosticsRun && (
        <>
          <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>SECTION 4.2 — VALIDITY STATUS</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{validityLabel}</div>
            <div style={{ fontSize: 11 }}>
              {phase4State.validityReasons.map((reason) => (
                <div key={reason}>• {reason}</div>
              ))}
            </div>
            {phase4State.ui.improvements.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
                {phase4State.ui.improvements.map((item) => (
                  <div key={item}>• {item}</div>
                ))}
              </div>
            )}
          </div>

          <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>SECTION 4.3 — DIAGNOSTICS</div>
            {!hasDiag && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Diagnostics data unavailable.</div>
            )}
            {hasDiag && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {analysisIntent.type === "predict" && (
                  <>
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Model Fit Summary</div>
                      <div style={{ fontSize: 10 }}>Rows used: {diag.n ?? "—"}</div>
                      <div style={{ fontSize: 10 }}>Predictors: {diag.p ?? "—"}</div>
                      <div style={{ fontSize: 10 }}>VIF max: {diag.vif_max ?? "—"}</div>
                    </div>
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Residual checks</div>
                      <div style={{ fontSize: 10 }}>Normality p-value (Shapiro–Wilk): {diag.shapiro_p ?? "n/a"}</div>
                      <div style={{ fontSize: 10 }}>Heteroskedasticity p-value (Breusch–Pagan): {diag.bp_p ?? "n/a"}</div>
                    </div>
                  </>
                )}
                {analysisIntent.type === "compare_means" && (
                  <>
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Group sizes</div>
                      {(diag.group_sizes || []).map((g) => (
                        <div key={g.name} style={{ fontSize: 10 }}>{g.name}: {g.n}</div>
                      ))}
                    </div>
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Checks</div>
                      <div style={{ fontSize: 10 }}>Equal variance p-value (Levene): {diag.levene_p ?? "n/a"}</div>
                    </div>
                  </>
                )}
                {analysisIntent.type === "association" && (
                  <>
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Association summary</div>
                      <div style={{ fontSize: 10 }}>Type: {diag.association_type}</div>
                      {diag.association_type === "numeric-numeric" && (
                        <div style={{ fontSize: 10 }}>Pearson correlation (r): {diag.correlation ?? "n/a"}</div>
                      )}
                      {diag.association_type === "categorical-categorical" && (
                        <div style={{ fontSize: 10 }}>Chi-square p-value: {diag.chi2_p ?? "n/a"}</div>
                      )}
                      {diag.association_type === "numeric-categorical" && (
                        <div style={{ fontSize: 10 }}>Groups detected: {diag.group_sizes?.length ?? "n/a"}</div>
                      )}
                      {diag.association_type === "categorical-numeric" && (
                        <div style={{ fontSize: 10 }}>Groups detected: {diag.group_sizes?.length ?? "n/a"}</div>
                      )}
                    </div>
                    <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Checks</div>
                      {diag.association_type === "categorical-categorical" && (
                        <div style={{ fontSize: 10 }}>Low expected counts: {diag.low_expected ? "Yes" : "No"}</div>
                      )}
                      {diag.association_type === "numeric-numeric" && (
                        <div style={{ fontSize: 10 }}>Outliers flagged: {diag.outlier_count ?? 0}</div>
                      )}
                      {(diag.association_type === "numeric-categorical"
                        || diag.association_type === "categorical-numeric") && (
                        <div style={{ fontSize: 10 }}>Outliers flagged: {diag.outlier_count ?? 0}</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>SECTION 4.4 — ADJUSTMENTS (ADVANCED)</div>
              <button
                type="button"
                onClick={() => setAdjustmentsOpen((prev) => !prev)}
                disabled={!adjustmentsUnlocked}
                style={{ ...utilBtn, fontSize: 10, opacity: adjustmentsUnlocked ? 1 : 0.5 }}
              >
                {adjustmentsOpen ? "Hide" : "Show"}
              </button>
            </div>
            {!adjustmentsUnlocked && (
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No major issues detected; adjustments not recommended.</div>
            )}
            {adjustmentsOpen && adjustmentsUnlocked && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Outlier handling (Inference impact)</div>
                  <div style={{ fontSize: 10, marginBottom: 6 }}>Default: Flag outliers (recommended).</div>
              <div style={{ fontSize: 10, marginBottom: 6 }}>
                Rows flagged: {phase4State.diagnostics?.outlier_count ?? diag?.outlier_count ?? 0}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={phase4State.adjustments.outlierMode === "exclude"}
                  disabled={!canExcludeOutliers}
                  onChange={(e) => {
                    setPhase4State((prev) => ({
                      ...prev,
                      adjustments: {
                        ...prev.adjustments,
                        outlierMode: e.target.checked ? "exclude" : "flag",
                      },
                    }));
                  }}
                />
                Exclude extreme values (advanced)
              </label>
              {phase4State.adjustments.outlierMode === "exclude" && (
                <>
                  <div style={{ fontSize: 10, marginBottom: 6 }}>
                    Rows to remove: {phase4State.diagnostics?.outlier_count ?? diag?.outlier_count ?? 0}
                  </div>
                  <textarea
                    value={phase4State.adjustments.justification.outliers}
                    onChange={(e) =>
                      setPhase4State((prev) => ({
                        ...prev,
                        adjustments: {
                          ...prev.adjustments,
                          justification: { ...prev.adjustments.justification, outliers: e.target.value },
                        },
                      }))
                    }
                    placeholder="Why are you excluding these values?"
                    style={{ width: "100%", minHeight: 60, fontSize: 10, padding: 6, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, margin: "6px 0" }}>
                    <input
                      type="checkbox"
                      checked={phase4State.adjustments.confirmOutlierExclusion}
                      onChange={(e) =>
                        setPhase4State((prev) => ({
                          ...prev,
                          adjustments: {
                            ...prev.adjustments,
                            confirmOutlierExclusion: e.target.checked,
                          },
                        }))
                      }
                    />
                    I understand this changes the analysis
                  </label>
                  {phase4State.ui.errors.outliers && (
                    <div style={{ fontSize: 10, color: "var(--danger-text)", marginBottom: 6 }}>
                      {phase4State.ui.errors.outliers}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleOutlierApply}
                    disabled={!phase4State.adjustments.confirmOutlierExclusion}
                    style={{ ...utilBtn, fontSize: 10 }}
                  >
                    Apply outlier exclusion
                  </button>
                </>
              )}
            </div>

            <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Optional outcome transform (Advanced)</div>
              <div style={{ fontSize: 10, marginBottom: 6 }}>
                Transformations change interpretation. Use only when diagnostics justify it.
              </div>
              <select
                value={phase4State.adjustments.transformOutcome}
                disabled={!canTransform}
                onChange={(e) =>
                  setPhase4State((prev) => ({
                    ...prev,
                    adjustments: { ...prev.adjustments, transformOutcome: e.target.value },
                  }))
                }
                style={{ width: "100%", padding: "6px 8px", fontSize: 10, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
              >
                <option value="none">None</option>
                <option value="log">Log</option>
                <option value="sqrt">Square root</option>
              </select>
              {phase4State.adjustments.transformOutcome !== "none" && (
                <>
                  <textarea
                    value={phase4State.adjustments.justification.transform}
                    onChange={(e) =>
                      setPhase4State((prev) => ({
                        ...prev,
                        adjustments: {
                          ...prev.adjustments,
                          justification: { ...prev.adjustments.justification, transform: e.target.value },
                        },
                      }))
                    }
                    placeholder="Why is this transform needed?"
                    style={{ width: "100%", minHeight: 60, fontSize: 10, padding: 6, border: "1px solid var(--border-strong)", background: "var(--panel)", marginTop: 8 }}
                  />
                  {phase4State.ui.errors.transform && (
                    <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 6 }}>
                      {phase4State.ui.errors.transform}
                    </div>
                  )}
                  <button type="button" onClick={handleTransformApply} style={{ ...utilBtn, fontSize: 10, marginTop: 8 }}>
                    Apply transform
                  </button>
                </>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={handleResetAdjustments} style={{ ...utilBtn, fontSize: 10 }}>
                Reset adjustments
              </button>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {phase4State.ui.diagnosticsRun && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            type="button"
            onClick={handleContinue}
            style={{ ...utilBtn, fontSize: 10 }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
