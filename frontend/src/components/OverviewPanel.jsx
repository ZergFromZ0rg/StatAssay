import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { utilBtn, thUtil, tdUtil } from "./uiStyles";

export default function OverviewPanel({
  shape,
  columns,
  missing,
  numericColumns,
  describe,
  nunique,
  duplicateRows,
  extremeValueFlags,
  distributionFlags,
  columnRoles,
  onRolesChange,
  onPrepLog,
  api,
  onContinue,
  file,
}) {
  const [cleanOptions, setCleanOptions] = useState({
    drop_na: false,
    fill_mean: false,
    fill_median: false,
    drop_duplicates: false,
    drop_high_missing: false,
    missing_threshold: 50,
  });
  const [cleanResult, setCleanResult] = useState(null);
  const [missingStrategyConfirmed, setMissingStrategyConfirmed] = useState(false);
  const prevCleanOptions = useRef(cleanOptions);
  const prevMissingStrategy = useRef(missingStrategyConfirmed);
  const isInitialLog = useRef(true);
  const autoCleanInit = useRef(true);
  const autoCleanTimer = useRef(null);

  const [tableData, setTableData] = useState(null);
  const outlierThresholds = useMemo(() => {
    const thresholds = {};
    if (!describe) return thresholds;
    Object.entries(describe).forEach(([col, stats]) => {
      const q1 = Number(stats?.["25%"]);
      const q3 = Number(stats?.["75%"]);
      if ([q1, q3].some((v) => Number.isNaN(v))) return;
      const iqr = q3 - q1;
      if (iqr <= 0) return;
      thresholds[col] = { lower: q1 - 3 * iqr, upper: q3 + 3 * iqr };
    });
    return thresholds;
  }, [describe]);

  const loadTableData = useCallback(async (fileOverride = null) => {
    try {
      const sourceFile = fileOverride ?? file;
      if (!sourceFile) return;

      const form = new FormData();
      form.append("file", sourceFile);
      form.append("page", "0");
      form.append("page_size", "-1");

      const res = await fetch(`${api}/get_data`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error("Failed to load data");

      const json = await res.json();
      setTableData(json);
    } catch (e) {
      alert("Error loading data: " + e);
    }
  }, [api, file]);

  useEffect(() => {
    if (!tableData) {
      loadTableData();
    }
  }, [loadTableData, tableData]);

  const runAutoClean = useEffectEvent(handleClean);

  useEffect(() => {
    if (autoCleanInit.current) {
      autoCleanInit.current = false;
      return;
    }
    if (autoCleanTimer.current) {
      clearTimeout(autoCleanTimer.current);
    }
    autoCleanTimer.current = setTimeout(() => {
      runAutoClean();
    }, 400);
    return () => {
      if (autoCleanTimer.current) {
        clearTimeout(autoCleanTimer.current);
      }
    };
  }, [cleanOptions]);

  useEffect(() => {
    if (isInitialLog.current) {
      isInitialLog.current = false;
      prevCleanOptions.current = cleanOptions;
      prevMissingStrategy.current = missingStrategyConfirmed;
      return;
    }

    const prev = prevCleanOptions.current;
    const changes = [
      { key: "drop_na", action: "missing_drop_rows" },
      { key: "fill_mean", action: "missing_impute_mean" },
      { key: "fill_median", action: "missing_impute_median" },
      { key: "drop_high_missing", action: "missing_drop_columns" },
      { key: "drop_duplicates", action: "duplicate_removal" },
    ];

    changes.forEach(({ key, action }) => {
      if (prev[key] !== cleanOptions[key]) {
        onPrepLog?.({
          action,
          enabled: cleanOptions[key],
          timestamp: new Date().toISOString(),
        });
      }
    });

    if (prev.missing_threshold !== cleanOptions.missing_threshold) {
      onPrepLog?.({
        action: "missing_threshold",
        value: cleanOptions.missing_threshold,
        timestamp: new Date().toISOString(),
      });
    }

    if (prevMissingStrategy.current !== missingStrategyConfirmed) {
      onPrepLog?.({
        action: "missing_strategy_skip",
        enabled: missingStrategyConfirmed,
        timestamp: new Date().toISOString(),
      });
    }

    prevCleanOptions.current = cleanOptions;
    prevMissingStrategy.current = missingStrategyConfirmed;
  }, [cleanOptions, missingStrategyConfirmed, onPrepLog]);

  async function handleClean() {
    setCleanResult(null);

    try {
      if (!file) {
        alert("No file selected");
        return;
      }

      const form = new FormData();
      form.append("file", file);

      // Append all cleaning options
      Object.entries(cleanOptions).forEach(([key, value]) => {
        form.append(key, value.toString());
      });

      const res = await fetch(`${api}/clean`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error(`Clean failed (HTTP ${res.status})`);

      // Get metadata from headers
      const originalShape = res.headers.get("X-Original-Shape");
      const newShape = res.headers.get("X-New-Shape");
      const blob = await res.blob();
      const previewFile = new File([blob], `cleaned_${file.name || "data.csv"}`, { type: "text/csv" });
      loadTableData(previewFile);
      setCleanResult({ originalShape, newShape });
    } catch (e) {
      alert("Error: " + String(e));
    }
  }

  return (
    <div>
      <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12, marginBottom: 12, textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Prepare Your Data</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
          We’ll ensure your dataset is structurally suitable for statistical analysis.
        </div>
      </div>

      <DataSuitability
        shape={shape}
        columns={columns}
        missing={missing}
        describe={describe}
        nunique={nunique}
        cleanOptions={cleanOptions}
        missingStrategyConfirmed={missingStrategyConfirmed}
        columnRoles={columnRoles}
        onContinue={onContinue}
        onPrepLog={onPrepLog}
        canContinue={isReadyToContinue({ columns, nunique, rows: shape?.rows, columnRoles, cleanOptions, missingStrategyConfirmed, missing })}
        prepPayload={{
          action: "continue_to_analysis",
          cleanOptions,
          columnRoles,
          columns,
          nunique,
          rows: shape?.rows,
          missingStrategyConfirmed,
        }}
      />

      <div style={{ marginBottom: 16, border: "1px solid var(--border)", background: "var(--panel-strong)", padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <StatUtil label="ROWS" value={shape?.rows ?? "?"} />
            <StatUtil label="COLUMNS" value={shape?.cols ?? "?"} />
            <StatUtil label="NUMERIC" value={numericColumns.length} />
            <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>CLEANING SUMMARY</div>
              <div style={{ fontSize: 10 }}>
                <div>Original: {cleanResult?.originalShape || `${shape?.rows ?? "?"}x${shape?.cols ?? "?"}`}</div>
                <div>After cleaning: {cleanResult?.newShape || `${shape?.rows ?? "?"}x${shape?.cols ?? "?"}`}</div>
              </div>
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 12 }}>
            <h4 style={{ margin: "0 0 6px 0", fontSize: 13, fontWeight: 700 }}>COLUMN ROLES</h4>
            <div style={{ border: "1px solid var(--border)", maxHeight: 260, overflowY: "auto", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "20%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "var(--panel-strong)", position: "sticky", top: 0, zIndex: 2 }}>
                    <th style={{ ...thUtil, textAlign: "left" }}>Column</th>
                    <th style={{ ...thUtil, textAlign: "center" }}>Detected Type</th>
                    <th style={{ ...thUtil, textAlign: "center" }}>Unique %</th>
                    <th style={{ ...thUtil, textAlign: "center" }}>ID-like</th>
                    <th style={{ ...thUtil, textAlign: "center" }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((col, i) => {
                    const detectedType = getDetectedType({ col, numericColumns, nunique, rows: shape?.rows });
                    const uniqueRatio = getUniqueRatio({ col, nunique, rows: shape?.rows });
                    const idLike = isIdLikeColumn(col, nunique, shape?.rows);
                    const defaultRole = isIdLikeColumn(col, nunique, shape?.rows) ? "identifier" : "predictor";
                    const role = columnRoles?.[col] || defaultRole;
                    const badges = [];
                    if (idLike) badges.push("ID");
                    const typeBadge = detectedType === "numeric" ? "Numeric" : detectedType === "text" ? "Text" : "Categorical";
                    badges.push(typeBadge);
                    if (role === "outcome") badges.push("Outcome candidate");
                    return (
                      <tr key={col} style={{ background: i % 2 === 0 ? "var(--panel-alt)" : "var(--panel)" }}>
                        <td style={{ ...tdUtil, textAlign: "left" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                            <div>{col}</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-start" }}>
                              {badges.map((badge) => (
                                <span
                                  key={badge}
                                  style={{
                                    fontSize: 9,
                                    padding: "2px 6px",
                                    border: "1px solid var(--border-strong)",
                                    background: "var(--panel-strong)",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.5,
                                  }}
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>{detectedType}</td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>
                          {uniqueRatio === null ? "n/a" : `${(uniqueRatio * 100).toFixed(1)}%`}
                        </td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>{idLike ? "Yes" : "No"}</td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>
                          <select
                            value={role}
                            onChange={(e) => {
                              const nextRole = e.target.value;
                              onRolesChange?.((prev) => {
                                const updated = { ...(prev || {}) };
                                const currentRole = updated[col] || defaultRole;
                                if (idLike && nextRole === "predictor") return updated;
                                if (nextRole === "outcome") {
                                  Object.keys(updated).forEach((key) => {
                                    if (updated[key] === "outcome") updated[key] = "predictor";
                                  });
                                  columns.forEach((key) => {
                                    if (!updated[key]) {
                                      const inferred = isIdLikeColumn(key, nunique, shape?.rows) ? "identifier" : "predictor";
                                      if (inferred === "outcome") updated[key] = "predictor";
                                    }
                                  });
                                }
                                updated[col] = nextRole;
                                if (currentRole !== nextRole) {
                                  onPrepLog?.({
                                    action: "role_change",
                                    timestamp: new Date().toISOString(),
                                    column: col,
                                    from: currentRole,
                                    to: nextRole,
                                  });
                                  if (currentRole === "identifier" || nextRole === "identifier") {
                                    onPrepLog?.({
                                      action: "column_exclusion",
                                      timestamp: new Date().toISOString(),
                                      column: col,
                                      excluded: nextRole === "identifier",
                                    });
                                  }
                                }
                                return updated;
                              });
                            }}
                            style={{ padding: "3px 6px", fontSize: 10, border: "1px solid var(--border-strong)", background: "var(--panel)" }}
                          >
                            <option value="identifier">Identifier</option>
                            <option value="predictor">Predictor</option>
                            <option value="outcome">Outcome</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 6 }}>
              ⓘ Confirm column roles. Identifier columns are excluded. One outcome and at least one predictor are required.
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16, border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>SECTION 2 — MISSING DATA DETECTION</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
          <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>MISSING VALUES (BY COLUMN)</div>
            <div style={{ border: "1px solid var(--border)", maxHeight: 200, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "70%" }} />
                  <col style={{ width: "30%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "var(--panel-strong)", position: "sticky", top: 0, zIndex: 1 }}>
                    <th style={{ ...thUtil, background: "var(--panel-strong)" }}>Column</th>
                    <th style={{ ...thUtil, textAlign: "center", background: "var(--panel-strong)" }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(missing).map(([k, v], i) => (
                    <tr key={k} style={{ background: i % 2 === 0 ? "var(--panel-alt)" : "var(--panel)" }}>
                      <td style={tdUtil}>{k}</td>
                      <td style={{ ...tdUtil, textAlign: "center" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>DATA CLEANING</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>MISSING VALUES</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={cleanOptions.drop_na}
                    onChange={(e) => setCleanOptions({ ...cleanOptions, drop_na: e.target.checked })}
                  />
                  Drop rows with any missing
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={cleanOptions.fill_mean}
                    onChange={(e) => setCleanOptions({ ...cleanOptions, fill_mean: e.target.checked })}
                  />
                  Impute missing values (mean) — may bias variance estimates
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={cleanOptions.fill_median}
                    onChange={(e) => setCleanOptions({ ...cleanOptions, fill_median: e.target.checked })}
                  />
                  Impute missing values (median) — may bias variance estimates
                </label>
                {(cleanOptions.fill_mean || cleanOptions.fill_median) && (
                  <div style={{ fontSize: 9, color: "var(--text-muted)", margin: "4px 0 8px 22px" }}>
                    ⚠️ Imputation may affect hypothesis tests and confidence intervals.
                  </div>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={cleanOptions.drop_high_missing}
                    onChange={(e) => setCleanOptions({ ...cleanOptions, drop_high_missing: e.target.checked })}
                  />
                  Drop columns &gt;
                  <input
                    type="number"
                    value={cleanOptions.missing_threshold}
                    onChange={(e) => setCleanOptions({ ...cleanOptions, missing_threshold: parseFloat(e.target.value) })}
                    style={{ width: 50, padding: "2px 4px", fontSize: 11, border: "1px solid var(--border-strong)" }}
                  />
                  % missing
                </label>
                {!cleanOptions.drop_na && !cleanOptions.fill_mean && !cleanOptions.fill_median && !cleanOptions.drop_high_missing && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={missingStrategyConfirmed}
                      onChange={(e) => setMissingStrategyConfirmed(e.target.checked)}
                    />
                    I will handle missing values later.
                  </label>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>DUPLICATE ROW DETECTION</div>
                <div style={{ fontSize: 10, marginBottom: 6 }}>
                  {duplicateRows?.count > 0
                    ? `${duplicateRows.count} duplicated rows detected.`
                    : "No duplicated rows detected."}
                </div>
                {duplicateRows?.count > 0 && (
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6 }}>
                    Rows: {duplicateRows.indices.join(", ")}{duplicateRows.count > duplicateRows.indices.length ? "…" : ""}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <input
                      type="checkbox"
                      checked={cleanOptions.drop_duplicates}
                      onChange={(e) => setCleanOptions({ ...cleanOptions, drop_duplicates: e.target.checked })}
                    />
                    Remove duplicate rows
                  </label>
                </div>
                <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    Changes apply automatically.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div style={{ marginBottom: 16, border: "1px solid var(--border)", background: "var(--panel-strong)", padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>SECTION 3 — EXTREME & DISTRIBUTION FLAGS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
          <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>EXTREME VALUE FLAGGING</div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 8 }}>
              Awareness only. Flags columns when min/max exceeds 3×IQR.
            </div>
            <div style={{ border: "1px solid var(--border)", maxHeight: 220, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "70%" }} />
                  <col style={{ width: "30%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "var(--panel-strong)", position: "sticky", top: 0, zIndex: 1 }}>
                    <th style={{ ...thUtil, background: "var(--panel-strong)" }}>Column</th>
                    <th style={{ ...thUtil, textAlign: "center", background: "var(--panel-strong)" }}>Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {numericColumns.map((col, i) => (
                    <tr key={col} style={{ background: i % 2 === 0 ? "var(--panel-alt)" : "var(--panel)" }}>
                      <td style={tdUtil}>{col}</td>
                      <td style={{ ...tdUtil, textAlign: "center" }}>{extremeValueFlags?.[col]?.count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>DISTRIBUTION FLAGS</div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 8 }}>
              Simple cues only. No plots or decisions required here.
            </div>
            <div style={{ border: "1px solid var(--border)", maxHeight: 220, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ background: "var(--panel-strong)", position: "sticky", top: 0, zIndex: 1 }}>
                    <th style={{ ...thUtil, background: "var(--panel-strong)" }}>Column</th>
                    <th style={{ ...thUtil, textAlign: "center", background: "var(--panel-strong)" }}>Right-skew</th>
                    <th style={{ ...thUtil, textAlign: "center", background: "var(--panel-strong)" }}>Left-skew</th>
                    <th style={{ ...thUtil, textAlign: "center", background: "var(--panel-strong)" }}>Heavy tails</th>
                  </tr>
                </thead>
                <tbody>
                  {numericColumns.map((col, i) => {
                    const flags = distributionFlags?.[col] ?? {};
                    return (
                      <tr key={col} style={{ background: i % 2 === 0 ? "var(--panel-alt)" : "var(--panel)" }}>
                        <td style={tdUtil}>{col}</td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>{flags.right_skewed ? "Yes" : "No"}</td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>{flags.left_skewed ? "Yes" : "No"}</td>
                        <td style={{ ...tdUtil, textAlign: "center" }}>{flags.heavy_tails ? "Yes" : "No"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16, border: "1px solid var(--border)", background: "var(--panel-alt)", padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>SECTION 4 — DATA PREVIEW</div>
        {/* Data Preview */}
        <div style={{ border: "1px solid var(--border)", background: "var(--panel)" }}>
          <div
            style={{
              padding: "6px 8px",
              borderBottom: "1px solid var(--border)",
              background: "var(--panel-strong)",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>DATA PREVIEW</span>
          </div>

          {tableData && (
            <div style={{ padding: 12 }}>
              <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 360, marginBottom: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, border: "1px solid var(--border)" }}>
                  <thead>
                  <tr style={{ background: "var(--panel-strong)" }}>
                    <th style={{ ...thUtil, width: 40, position: "sticky", top: 0, zIndex: 2, background: "var(--panel-strong)" }}>Row</th>
                    {tableData.columns.map((col) => (
                      <th key={col} style={{ ...thUtil, position: "sticky", top: 0, zIndex: 2, background: "var(--panel-strong)" }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                  </thead>
                  <tbody>
                    {tableData.data.map((row, rowIdx) => (
                      <tr key={rowIdx} style={{ background: rowIdx % 2 === 0 ? "var(--panel-alt)" : "var(--panel)" }}>
                        <td style={{ ...tdUtil, fontWeight: 700, background: "var(--panel-strong)" }}>{rowIdx + 1}</td>
                        {row.map((value, colIdx) => {
                          const colName = tableData.columns[colIdx];
                          const isMissing = value === "" || value === null || value === undefined;
                          const threshold = outlierThresholds[colName];
                          const asNumber = threshold ? Number(value) : NaN;
                          const isOutlier = threshold && Number.isFinite(asNumber)
                            && (asNumber < threshold.lower || asNumber > threshold.upper);
                          const highlightStyle = isMissing
                            ? { background: "rgba(255, 150, 150, 0.25)" }
                            : isOutlier
                              ? { background: "rgba(255, 210, 120, 0.25)" }
                              : {};
                          return (
                            <td key={colIdx} style={{ ...tdUtil, ...highlightStyle }}>
                              {value ?? ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DataSuitability({ shape, columns, missing, describe, nunique, cleanOptions, missingStrategyConfirmed, columnRoles, onContinue, onPrepLog, canContinue, prepPayload }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const reasons = useMemo(() => {
    const blocking = [];
    const reviewOnly = [];
    const missingDetected = Object.values(missing || {}).some((v) => Number(v) > 0);
    const missingAddressed = cleanOptions?.drop_na
      || cleanOptions?.fill_mean
      || cleanOptions?.fill_median
      || cleanOptions?.drop_high_missing
      || missingStrategyConfirmed;
    if (missingDetected && !missingAddressed) blocking.push("Missing values detected");

    const outliersDetected = hasPotentialOutliers(describe);
    if (outliersDetected) reviewOnly.push("Extreme values flagged (review later)");

    const idDetected = hasIdLikeColumn(columns, nunique, shape?.rows);
    const idUnresolved = idDetected && columns.some((col) => isIdLikeColumn(col, nunique, shape?.rows)
      && (columnRoles?.[col] || "predictor") === "predictor");
    if (idUnresolved) blocking.push("Confirm or exclude all ID-like columns");

    return { blocking, reviewOnly };
  }, [missing, describe, columns, nunique, shape, cleanOptions, missingStrategyConfirmed, columnRoles]);

  const isAttention = reasons.blocking.length > 0;
  const readiness = isAttention ? "Needs Attention" : "Ready";
  const readinessColor = isAttention ? "var(--danger-text)" : "var(--accent-strong)";

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        padding: 12,
        marginBottom: 12,
        boxShadow: "0 6px 12px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.2s ease, transform 0.2s ease",
        display: "grid",
        gridTemplateColumns: "220px 1fr 220px",
        gap: 16,
        alignItems: "center",
      }}
    >
      <div style={{ borderRight: "1px solid var(--border)", paddingRight: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
          Aggregate Status
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: readinessColor, marginTop: 6 }}>
          {readiness}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text)" }}>
        {reasons.blocking.length === 0 && reasons.reviewOnly.length === 0 ? (
          <div>No issues detected.</div>
        ) : (
          <>
            {reasons.blocking.map((reason) => (
              <div key={reason}>• {reason}</div>
            ))}
            {reasons.reviewOnly.map((reason) => (
              <div key={reason}>• {reason}</div>
            ))}
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{ position: "relative", display: "inline-block" }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <button
            type="button"
            onClick={() => {
              onPrepLog?.(buildPreparationEntry(prepPayload));
              onContinue?.();
            }}
            disabled={!canContinue}
            style={{
              ...utilBtn,
              fontSize: 12,
              padding: "8px 18px",
              opacity: canContinue ? 1 : 0.6,
            }}
          >
            CONTINUE TO ANALYSIS
          </button>
          {!canContinue && showTooltip && reasons.blocking.length > 0 && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                minWidth: 260,
                padding: "10px 12px",
                background: "var(--panel-strong)",
                color: "var(--text)",
                border: "1px solid var(--border-strong)",
                boxShadow: "0 8px 16px rgba(0,0,0,0.12)",
                fontSize: 11,
                zIndex: 5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Resolve to continue</div>
              {reasons.blocking.map((reason) => (
                <div key={reason}>• {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function hasPotentialOutliers(describe) {
  if (!describe) return false;
  return Object.values(describe).some((stats) => {
    if (!stats) return false;
    const q1 = Number(stats["25%"]);
    const q3 = Number(stats["75%"]);
    const minVal = Number(stats.min);
    const maxVal = Number(stats.max);
    if ([q1, q3, minVal, maxVal].some((v) => Number.isNaN(v))) return false;
    const iqr = q3 - q1;
    if (iqr <= 0) return false;
    const lower = q1 - 3 * iqr;
    const upper = q3 + 3 * iqr;
    return minVal < lower || maxVal > upper;
  });
}

function getUniqueRatio({ col, nunique = {}, rows }) {
  const rowCount = Number(rows);
  if (!rowCount) return null;
  const unique = Number(nunique?.[col]);
  if (!Number.isFinite(unique)) return null;
  return unique / rowCount;
}

function getDetectedType({ col, numericColumns = [], nunique = {}, rows }) {
  if (numericColumns.includes(col)) return "numeric";
  const ratio = getUniqueRatio({ col, nunique, rows });
  if (ratio !== null && ratio >= 0.5) return "text";
  return "categorical";
}

function isIdLikeColumn(col, nunique = {}, rows) {
  const rowCount = Number(rows);
  const rawName = String(col);
  const spaced = rawName.replace(/([a-z])([A-Z])/g, "$1 $2");
  const normalized = spaced.replace(/[^a-zA-Z0-9]+/g, " ").toLowerCase();
  const tokens = normalized.split(" ").filter(Boolean);
  const nameMatches = tokens.some((token) => token === "id" || token === "uuid" || token === "guid")
    || normalized.includes("student id")
    || normalized.includes("user id")
    || normalized.includes("order id")
    || normalized.includes("record id")
    || normalized.includes("account number")
    || normalized.includes("accountnumber")
    || normalized.includes("recordid")
    || normalized.includes("student_id")
    || normalized.includes("user_id")
    || normalized.includes("order_id");
  if (nameMatches) return true;
  if (!rowCount) return false;
  const unique = Number(nunique?.[col]);
  if (!Number.isFinite(unique)) return false;
  return unique / rowCount >= 0.95;
}

function hasIdLikeColumn(columns = [], nunique = {}, rows) {
  return (columns || []).some((col) => isIdLikeColumn(col, nunique, rows));
}

function buildPreparationEntry({ action, cleanOptions, columnRoles, columns, nunique, rows, missingStrategyConfirmed }) {
  const timestamp = new Date().toISOString();
  const identifiers = (columns || []).filter((col) => (columnRoles?.[col] || (isIdLikeColumn(col, nunique, rows) ? "identifier" : "predictor")) === "identifier");
  const imputation = cleanOptions.fill_mean && cleanOptions.fill_median
    ? "mean+median"
    : cleanOptions.fill_mean
      ? "mean"
      : cleanOptions.fill_median
        ? "median"
        : "none";
  return {
    action,
    timestamp,
    dropped_rows: cleanOptions.drop_na,
    imputation,
    dropped_columns_by_missing: cleanOptions.drop_high_missing ? cleanOptions.missing_threshold : null,
    drop_duplicates: cleanOptions.drop_duplicates,
    excluded_variables: identifiers,
    flagged_outliers: true,
    missing_strategy_skipped: !cleanOptions.drop_na
      && !cleanOptions.fill_mean
      && !cleanOptions.fill_median
      && !cleanOptions.drop_high_missing
      && missingStrategyConfirmed,
  };
}

function isReadyToContinue({ columns, nunique, rows, columnRoles, cleanOptions, missingStrategyConfirmed, missing }) {
  const idResolved = !(columns || []).some((col) => {
    const inferred = columnRoles?.[col] || (isIdLikeColumn(col, nunique, rows) ? "identifier" : "predictor");
    return isIdLikeColumn(col, nunique, rows) && inferred === "predictor";
  });
  const missingDetected = Object.values(missing || {}).some((v) => Number(v) > 0);
  const missingResolved = !missingDetected || cleanOptions?.drop_na
    || cleanOptions?.fill_mean
    || cleanOptions?.fill_median
    || cleanOptions?.drop_high_missing
    || missingStrategyConfirmed;
  const predictors = (columns || []).filter((col) => {
    const inferred = columnRoles?.[col] || (isIdLikeColumn(col, nunique, rows) ? "identifier" : "predictor");
    return inferred === "predictor";
  });
  return idResolved && missingResolved && predictors.length > 0;
}

function StatUtil({ label, value }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        border: "1px solid var(--border)",
        background: "var(--panel-alt)",
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
