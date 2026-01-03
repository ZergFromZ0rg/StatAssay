import { useMemo } from "react";
import { utilBtn } from "./uiStyles";
import { useAnalysisIntent } from "./analysisIntentStore.jsx";
import {
  buildIntentLogEntry,
  getEligibleColumns,
  getNumericColumns,
  getCategoricalColumns,
  mockColumns,
  validateAssociation,
  validateCompareMeans,
  validatePredict,
} from "./analysisIntentUtils";

export default function ResearchQuestionPanel({ columnsInfo = [], nRows, nCols, onProceed, onBack }) {
  const { analysisIntent, setAnalysisIntent } = useAnalysisIntent();
  const columns = columnsInfo.length ? columnsInfo : mockColumns;

  const eligibleColumns = useMemo(() => getEligibleColumns(columns), [columns]);
  const numericColumns = useMemo(() => getNumericColumns(eligibleColumns), [eligibleColumns]);
  const categoricalColumns = useMemo(() => getCategoricalColumns(eligibleColumns), [eligibleColumns]);
  const columnsByName = useMemo(() => Object.fromEntries(columns.map((col) => [col.name, col])), [columns]);

  const current = analysisIntent;

  function resetIntent(nextType = null) {
    setAnalysisIntent((prev) => ({
      ...prev,
      type: nextType,
      outcome: "",
      predictors: [],
      group: "",
      varA: "",
      varB: "",
      warnings: [],
      errors: {},
      note: "",
    }));
  }

  function applyValidation(nextState) {
    if (!nextState.type) {
      return setAnalysisIntent(nextState);
    }

    let validation = { errors: {}, warnings: [], isValid: false, note: "" };
    if (nextState.type === "predict") {
      validation = validatePredict({
        outcome: nextState.outcome,
        predictors: nextState.predictors,
        columnsByName,
      });
    } else if (nextState.type === "compare_means") {
      validation = validateCompareMeans({
        outcome: nextState.outcome,
        group: nextState.group,
        columnsByName,
      });
    } else if (nextState.type === "association") {
      validation = validateAssociation({
        varA: nextState.varA,
        varB: nextState.varB,
        columnsByName,
      });
    }

    setAnalysisIntent({
      ...nextState,
      errors: validation.errors,
      warnings: validation.warnings,
      note: validation.note || "",
    });
  }

  function handleIntentSelect(type) {
    applyValidation({
      ...current,
      type,
      outcome: "",
      predictors: [],
      group: "",
      varA: "",
      varB: "",
      warnings: [],
      errors: {},
      note: "",
    });
  }

  function handlePredictorToggle(name) {
    const nextPredictors = current.predictors?.includes(name)
      ? current.predictors.filter((item) => item !== name)
      : [...(current.predictors || []), name];

    applyValidation({
      ...current,
      predictors: nextPredictors,
    });
  }

  function handleContinue() {
    const entry = buildIntentLogEntry(current);
    setAnalysisIntent((prev) => ({
      ...prev,
      intentLog: [...(prev.intentLog || []), entry],
    }));
    onProceed?.(current);
  }

  const isValid = Object.keys(current.errors || {}).length === 0 && current.type;

  return (
    <div style={{ background: "var(--panel)", padding: 8, position: "fixed", inset: 0, boxSizing: "border-box", overflow: "hidden" }}>
      <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 16, height: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      {!current.type ? (
        <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button type="button" onClick={onBack} style={{ ...utilBtn, fontSize: 10 }}>
              Back to Prepare Data
            </button>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>What are you trying to do?</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Choose the question that best matches your goal.
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", width: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, width: "100%" }}>
              {[
                {
                  type: "predict",
                  title: "Predict a numeric outcome",
                  desc: "Identify which variables explain or predict a numeric response.",
                  example: "What affects final exam scores?",
                  details: [
                    "App uses: linear regression (LR/MLR) with coefficient t-tests and overall F-test.",
                    "Diagnostics: linearity, residual normality, variance, leverage, VIF.",
                  ],
                },
                {
                  type: "compare_means",
                  title: "Compare group means",
                  desc: "Compare the average of a numeric outcome across two or more groups.",
                  example: "Do different teaching methods change scores?",
                  details: [
                    "App uses: t-test (2 groups) or one-way ANOVA (3+ groups).",
                    "Diagnostics: normality within groups, equal variance, group sizes.",
                  ],
                },
                {
                  type: "association",
                  title: "Test association",
                  desc: "Check whether two variables are related.",
                  example: "Is category A associated with category B?",
                  details: [
                    "App decides: chi-square (cat x cat), correlation (num x num), or compare-means (num x cat).",
                    "Diagnostics: expected counts, outliers, linearity (when numeric).",
                  ],
                },
              ].map((card) => (
                <button
                  key={card.type}
                  type="button"
                  onClick={() => handleIntentSelect(card.type)}
                  style={{
                    textAlign: "center",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    padding: "18px 14px",
                    cursor: "pointer",
                    minHeight: 150,
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{card.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>{card.desc}</div>
                  <div style={{ fontSize: 11 }}>Example: {card.example}</div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-muted)" }}>
                    {card.details.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 16 }}>
            <button type="button" onClick={() => resetIntent(null)} style={{ ...utilBtn, fontSize: 10 }}>
              Change research question
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Research Question</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                This will determine the appropriate statistical method.
              </div>
            </div>
          </div>

          {current.type === "predict" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Outcome variable
                </label>
                <select
                  value={current.outcome}
                  onChange={(e) => applyValidation({ ...current, outcome: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", fontSize: 11, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                >
                  <option value="">Select a numeric column</option>
                  {numericColumns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name} (Numeric)
                    </option>
                  ))}
                </select>
                {current.errors?.outcome && (
                  <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>{current.errors.outcome}</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Predictors</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {eligibleColumns.map((col) => (
                    <label key={col.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={current.predictors?.includes(col.name)}
                        disabled={col.name === current.outcome}
                        onChange={() => handlePredictorToggle(col.name)}
                      />
                      <span>{col.name}</span>
                      <span style={{ fontSize: 9, padding: "1px 6px", border: "1px solid var(--border-strong)", background: "var(--panel-strong)" }}>
                        {col.detectedType === "numeric" ? "Numeric" : col.detectedType === "text" ? "Text" : "Categorical"}
                      </span>
                    </label>
                  ))}
                </div>
                {current.errors?.predictors && (
                  <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>{current.errors.predictors}</div>
                )}
              </div>
            </div>
          )}

          {current.type === "compare_means" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Outcome variable
                </label>
                <select
                  value={current.outcome}
                  onChange={(e) => applyValidation({ ...current, outcome: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", fontSize: 11, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                >
                  <option value="">Select a numeric column</option>
                  {numericColumns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name} (Numeric)
                    </option>
                  ))}
                </select>
                {current.errors?.outcome && (
                  <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>{current.errors.outcome}</div>
                )}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Grouping variable
                </label>
                <select
                  value={current.group}
                  onChange={(e) => applyValidation({ ...current, group: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", fontSize: 11, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                >
                  <option value="">Select a categorical column</option>
                  {categoricalColumns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name} (Categorical)
                    </option>
                  ))}
                </select>
                {current.errors?.group && (
                  <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>{current.errors.group}</div>
                )}
              </div>
            </div>
          )}

          {current.type === "association" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Variable A
                </label>
                <select
                  value={current.varA}
                  onChange={(e) => applyValidation({ ...current, varA: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", fontSize: 11, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                >
                  <option value="">Select a column</option>
                  {eligibleColumns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name} ({col.detectedType === "numeric" ? "Numeric" : col.detectedType === "text" ? "Text" : "Categorical"})
                    </option>
                  ))}
                </select>
                {current.errors?.varA && (
                  <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>{current.errors.varA}</div>
                )}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Variable B
                </label>
                <select
                  value={current.varB}
                  onChange={(e) => applyValidation({ ...current, varB: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", fontSize: 11, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                >
                  <option value="">Select a column</option>
                  {eligibleColumns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name} ({col.detectedType === "numeric" ? "Numeric" : col.detectedType === "text" ? "Text" : "Categorical"})
                    </option>
                  ))}
                </select>
                {current.errors?.varB && (
                  <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>{current.errors.varB}</div>
                )}
              </div>
            </div>
          )}

          {current.note && (
            <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-muted)" }}>
              {current.note}
            </div>
          )}

          {current.warnings?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-muted)" }}>
              {current.warnings.map((warning) => (
                <div key={warning}>• {warning}</div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={handleContinue} disabled={!isValid} style={{ ...utilBtn, fontSize: 10 }}>
              Continue
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
