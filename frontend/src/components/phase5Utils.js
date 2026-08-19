/**
 * @typedef {Object} ColumnInfo
 * @property {string} name
 * @property {"numeric"|"categorical"|"text"} detectedType
 * @property {"identifier"|"predictor"|"excluded"} role
 * @property {number} uniqueRatio
 * @property {number} missingPct
 * @property {number=} levelsCount
 */

/**
 * @typedef {Object} PreparedDatasetState
 * @property {ColumnInfo[]} columns
 * @property {Object[]} rawData
 * @property {Object} prepDecisions
 * @property {Object[]} prepLog
 */

/**
 * @typedef {Object} AnalysisIntent
 * @property {"predict"|"compare_means"|"association"} type
 * @property {Object=} predict
 * @property {Object=} compare_means
 * @property {Object=} association
 * @property {Object[]} intentLog
 */

/**
 * @typedef {Object} AnalysisBundle
 * @property {PreparedDatasetState} preparedDatasetState
 * @property {AnalysisIntent} intent
 * @property {Object} phase4
 */

function sum(values) {
  return values.reduce((acc, v) => acc + v, 0);
}

export function mean(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function variance(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return sum(values.map((v) => (v - m) ** 2)) / (values.length - 1);
}

export function std(values) {
  return Math.sqrt(variance(values));
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function transpose(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]));
}

function multiply(A, B) {
  const result = Array(A.length)
    .fill(0)
    .map(() => Array(B[0].length).fill(0));
  for (let i = 0; i < A.length; i += 1) {
    for (let k = 0; k < B.length; k += 1) {
      for (let j = 0; j < B[0].length; j += 1) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  return result;
}

function multiplyVec(A, v) {
  return A.map((row) => row.reduce((acc, val, i) => acc + val * v[i], 0));
}

function identity(n) {
  return Array(n).fill(0).map((_, i) => Array(n).fill(0).map((__, j) => (i === j ? 1 : 0)));
}

function invertMatrix(A) {
  const n = A.length;
  const I = identity(n);
  const M = A.map((row, i) => row.concat(I[i]));

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    if (Math.abs(M[maxRow][i]) < 1e-12) return null;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    const pivot = M[i][i];
    for (let j = 0; j < 2 * n; j += 1) M[i][j] /= pivot;
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const factor = M[k][i];
      for (let j = 0; j < 2 * n; j += 1) {
        M[k][j] -= factor * M[i][j];
      }
    }
  }
  return M.map((row) => row.slice(n));
}

function regularizedInverse(A) {
  const regularized = A.map((row, i) => row.map((v, j) => v + (i === j ? 1e-8 : 0)));
  return invertMatrix(regularized);
}

function logGamma(z) {
  const cof = [76.1800917294715, -86.5053203294168, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < cof.length; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log(2.506628274631 * ser / x);
}

function betacf(a, b, x) {
  const MAXIT = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    let m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betai(a, b, x) {
  if (x < 0 || x > 1) return 0;
  if (x === 0 || x === 1) return x;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return bt * betacf(a, b, x) / a;
  }
  return 1 - bt * betacf(b, a, 1 - x) / b;
}

function studentTCdf(t, df) {
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const ib = betai(a, b, x);
  if (t >= 0) return 1 - 0.5 * ib;
  return 0.5 * ib;
}

function studentTInv(p, df) {
  let low = -10;
  let high = 10;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const cdf = studentTCdf(mid, df);
    if (cdf < p) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

function chiSquarePValue(chi2, df) {
  const x = df / (df + chi2);
  return betai(df / 2, 0.5, x);
}

function fDistPValue(f, df1, df2) {
  const x = (df1 * f) / (df1 * f + df2);
  return 1 - betai(df1 / 2, df2 / 2, x);
}

function normalInv(p) {
  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;
  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;
  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;
  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q;
  let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  if (phigh < p) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
}

function qqPlotPoints(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return sorted.map((val, i) => {
    const p = (i + 0.5) / n;
    return { theoretical: normalInv(p), sample: val };
  });
}

function encodePredictors(data, predictors, columnsInfo) {
  const columnsByName = Object.fromEntries(columnsInfo.map((c) => [c.name, c]));
  const design = [];
  const terms = ["Intercept"];
  const levelsByColumn = {};

  predictors.forEach((name) => {
    const col = columnsByName[name];
    if (col?.detectedType === "categorical") {
      const levels = Array.from(new Set(data.map((row) => String(row[name])))).sort();
      levelsByColumn[name] = levels;
      levels.slice(1).forEach((level) => terms.push(`${name}[${level}]`));
    } else {
      terms.push(name);
    }
  });

  data.forEach((row) => {
    const rowVec = [1];
    predictors.forEach((name) => {
      const col = columnsByName[name];
      const value = row[name];
      if (col?.detectedType === "categorical") {
        const levels = levelsByColumn[name];
        levels.slice(1).forEach((level) => {
          rowVec.push(String(value) === level ? 1 : 0);
        });
      } else {
        rowVec.push(Number(value));
      }
    });
    design.push(rowVec);
  });

  return { design, terms };
}

export function olsRegression(data, outcome, predictors, columnsInfo) {
  const y = data.map((row) => Number(row[outcome])).filter((v) => Number.isFinite(v));
  const cleanData = data.filter((row) => Number.isFinite(Number(row[outcome])));
  const { design: X, terms } = encodePredictors(cleanData, predictors, columnsInfo);

  const Xt = transpose(X);
  const XtX = multiply(Xt, X);
  let XtXInv = invertMatrix(XtX);
  const warnings = [];
  if (!XtXInv) {
    XtXInv = regularizedInverse(XtX);
    warnings.push("Matrix was singular; used a regularized inverse.");
  }
  if (!XtXInv) {
    return { error: "Model matrix is singular. Remove collinear predictors.", warnings };
  }
  const XtY = multiplyVec(Xt, y);
  const beta = multiplyVec(XtXInv, XtY);
  const fitted = X.map((row) => row.reduce((acc, v, i) => acc + v * beta[i], 0));
  const residuals = y.map((val, i) => val - fitted[i]);

  const n = y.length;
  const p = X[0].length - 1;
  const sse = sum(residuals.map((r) => r * r));
  const sst = sum(y.map((val) => (val - mean(y)) ** 2));
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  const adjR2 = 1 - (1 - r2) * (n - 1) / Math.max(n - p - 1, 1);
  const rmse = Math.sqrt(sse / Math.max(n, 1));
  const rse = Math.sqrt(sse / Math.max(n - p - 1, 1));

  const varBeta = XtXInv.map((row) => row.map((v) => v * (sse / Math.max(n - p - 1, 1))));
  const stdErr = varBeta.map((row, i) => Math.sqrt(Math.abs(row[i])));
  const tVals = beta.map((b, i) => b / (stdErr[i] || 1));
  const df = Math.max(n - p - 1, 1);
  const pVals = tVals.map((t) => 2 * (1 - studentTCdf(Math.abs(t), df)));
  const tCrit = studentTInv(0.975, df);
  const ci = beta.map((b, i) => [b - tCrit * stdErr[i], b + tCrit * stdErr[i]]);

  const ssr = sst - sse;
  const msr = ssr / Math.max(p, 1);
  const mse = sse / Math.max(n - p - 1, 1);
  const fStat = mse === 0 ? 0 : msr / mse;
  const fP = fDistPValue(fStat, p, Math.max(n - p - 1, 1));

  const coefTable = terms.map((term, i) => ({
    term,
    estimate: beta[i],
    std_error: stdErr[i],
    t_value: tVals[i],
    p_value: pVals[i],
    ci_low: ci[i][0],
    ci_high: ci[i][1],
  }));

  const qq = qqPlotPoints(residuals);

  return {
    coefTable,
    modelStats: { n, p, r2, adjR2, rmse, rse, fStat, fP, df1: p, df2: Math.max(n - p - 1, 1) },
    residuals,
    fitted,
    qq,
    warnings,
  };
}

export function tTest2Sample(a, b) {
  const n1 = a.length;
  const n2 = b.length;
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = variance(a);
  const v2 = variance(b);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = (m1 - m2) / (se || 1);
  const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 * v1) / (n1 * n1 * (n1 - 1)) + (v2 * v2) / (n2 * n2 * (n2 - 1)));
  const p = 2 * (1 - studentTCdf(Math.abs(t), df));
  return { t, df, p, meanDiff: m1 - m2 };
}

export function oneWayANOVA(groups) {
  const all = groups.flat();
  const grandMean = mean(all);
  const ssBetween = sum(groups.map((g) => g.length * (mean(g) - grandMean) ** 2));
  const ssWithin = sum(groups.map((g) => sum(g.map((v) => (v - mean(g)) ** 2))));
  const dfBetween = groups.length - 1;
  const dfWithin = all.length - groups.length;
  const msBetween = ssBetween / Math.max(dfBetween, 1);
  const msWithin = ssWithin / Math.max(dfWithin, 1);
  const f = msWithin === 0 ? 0 : msBetween / msWithin;
  const p = fDistPValue(f, dfBetween, dfWithin);
  const etaSq = ssBetween / Math.max(ssBetween + ssWithin, 1);
  return { f, p, dfBetween, dfWithin, etaSq };
}

export function chiSquareTest(table) {
  const rows = table.length;
  const cols = table[0].length;
  const rowTotals = table.map((row) => sum(row));
  const colTotals = Array(cols).fill(0).map((_, j) => sum(table.map((row) => row[j])));
  const total = sum(rowTotals);
  let chi2 = 0;
  let lowExpected = false;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const expected = (rowTotals[i] * colTotals[j]) / total;
      if (expected < 5) lowExpected = true;
      chi2 += ((table[i][j] - expected) ** 2) / expected;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const p = 1 - chiSquarePValue(chi2, df);
  const minDim = Math.min(rows - 1, cols - 1);
  const cramersV = Math.sqrt(chi2 / (total * minDim));
  return { chi2, df, p, cramersV, lowExpected };
}

export function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  const xs = x.slice(0, n);
  const ys = y.slice(0, n);
  const mx = mean(xs);
  const my = mean(ys);
  const cov = sum(xs.map((v, i) => (v - mx) * (ys[i] - my)));
  const denom = Math.sqrt(sum(xs.map((v) => (v - mx) ** 2)) * sum(ys.map((v) => (v - my) ** 2)));
  const r = denom === 0 ? 0 : cov / denom;
  const t = r * Math.sqrt((n - 2) / Math.max(1 - r * r, 1e-8));
  const p = 2 * (1 - studentTCdf(Math.abs(t), Math.max(n - 2, 1)));
  return { r, p, n };
}

export function buildFinalDataset(bundle) {
  const { preparedDatasetState, intent, phase4 } = bundle;
  const raw = preparedDatasetState.rawData || [];
  const prep = preparedDatasetState.prepDecisions || {};
  const columnsInfo = preparedDatasetState.columns || [];

  let data = raw.map((row) => ({ ...row }));
  const nOriginal = data.length;

  const excluded = new Set([...(prep.excludedColumns || []), ...(prep.identifierColumns || [])]);
  data = data.map((row) => {
    const next = { ...row };
    excluded.forEach((col) => delete next[col]);
    return next;
  });

  let removedMissingRowsCount = 0;
  if (prep.missingStrategy === "drop_rows") {
    const before = data.length;
    data = data.filter((row) => Object.values(row).every((v) => v !== null && v !== undefined && v !== ""));
    removedMissingRowsCount = before - data.length;
  }

  if (prep.missingStrategy === "impute_mean" || prep.missingStrategy === "impute_median") {
    const numericCols = columnsInfo.filter((c) => c.detectedType === "numeric" && !excluded.has(c.name));
    numericCols.forEach((col) => {
      const values = data.map((row) => Number(row[col.name])).filter((v) => Number.isFinite(v));
      if (!values.length) return;
      const fill = prep.missingStrategy === "impute_mean" ? mean(values) : quantile([...values].sort((a, b) => a - b), 0.5);
      data = data.map((row) => ({
        ...row,
        [col.name]: row[col.name] === null || row[col.name] === undefined || row[col.name] === "" ? fill : row[col.name],
      }));
    });
  }

  if (prep.dropColumnsAbovePct) {
    const threshold = prep.dropColumnsAbovePct;
    const toDrop = columnsInfo.filter((col) => col.missingPct >= threshold && !excluded.has(col.name)).map((c) => c.name);
    toDrop.forEach((name) => excluded.add(name));
    data = data.map((row) => {
      const next = { ...row };
      toDrop.forEach((col) => delete next[col]);
      return next;
    });
  }

  let removedDuplicatesCount = 0;
  if (prep.duplicatesRemoved) {
    const seen = new Set();
    const filtered = [];
    data.forEach((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) {
        removedDuplicatesCount += 1;
      } else {
        seen.add(key);
        filtered.push(row);
      }
    });
    data = filtered;
  }

  let removedOutliersCount = 0;
  const outcomeName = intent?.predict?.outcome || intent?.compare_means?.outcome;
  if (phase4.adjustments?.outlierMode === "exclude" && outcomeName) {
    const values = data.map((row) => Number(row[outcomeName])).filter((v) => Number.isFinite(v));
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - 3 * iqr;
    const upper = q3 + 3 * iqr;
    const before = data.length;
    data = data.filter((row) => {
      const v = Number(row[outcomeName]);
      if (!Number.isFinite(v)) return false;
      return v >= lower && v <= upper;
    });
    removedOutliersCount = before - data.length;
  }

  let transformApplied = "none";
  const transform = phase4.adjustments?.transformOutcome || "none";
  if (transform !== "none" && outcomeName) {
    transformApplied = transform;
    const minVal = Math.min(...data.map((row) => Number(row[outcomeName])).filter((v) => Number.isFinite(v)));
    if (transform === "log" && minVal <= 0) {
      return { error: `Log transform requires all values > 0. Found minimum = ${minVal}.` };
    }
    if (transform === "sqrt" && minVal < 0) {
      return { error: `Square-root transform requires all values >= 0. Found minimum = ${minVal}.` };
    }
    data = data.map((row) => {
      const v = Number(row[outcomeName]);
      if (!Number.isFinite(v)) return row;
      const next = { ...row, [`${outcomeName}_original`]: v };
      next[outcomeName] = transform === "log" ? Math.log(v) : Math.sqrt(v);
      return next;
    });
  }

  const columnsUsed = Object.keys(data[0] || {}).filter((col) => !excluded.has(col));

  return {
    data,
    meta: {
      nOriginal,
      nFinal: data.length,
      removedMissingRowsCount,
      removedDuplicatesCount,
      removedOutliersCount,
      transformApplied,
      transformJustification: phase4.adjustments?.justification?.transform || "",
      outlierJustification: phase4.adjustments?.justification?.outliers || "",
      columnsUsed,
    },
  };
}

export function buildReportMarkdown(bundle, results, meta) {
  const intent = bundle.intent;
  const phase4 = bundle.phase4;
  const lines = [];
  lines.push("# Statistical Analysis Report");
  lines.push("");
  lines.push("## Dataset Summary");
  lines.push(`- nOriginal: ${meta.nOriginal}`);
  lines.push(`- nFinal: ${meta.nFinal}`);
  lines.push(`- Columns used: ${meta.columnsUsed.join(", ")}`);
  lines.push("");
  lines.push("## Intent");
  lines.push(`- Type: ${intent.type}`);
  lines.push(`- Variables: ${JSON.stringify(intent)}`);
  lines.push("");
  lines.push("## Validity Status");
  lines.push(`- Status: ${phase4.validityStatus}`);
  (phase4.validityReasons || []).forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");
  lines.push("## Results");
  lines.push(results.summaryText || "Summary not available.");
  lines.push("");
  lines.push("## Adjustments");
  lines.push(`- Transform: ${meta.transformApplied}`);
  lines.push(`- Transform justification: ${meta.transformJustification || ""}`);
  lines.push(`- Outliers excluded: ${meta.removedOutliersCount}`);
  lines.push(`- Outlier justification: ${meta.outlierJustification || ""}`);
  lines.push("");
  lines.push("## Limitations");
  (phase4.validityReasons || []).forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");
  lines.push("## Appendix: Audit Logs");
  lines.push("### Prep Log");
  lines.push("```json");
  lines.push(JSON.stringify(bundle.preparedDatasetState.prepLog || [], null, 2));
  lines.push("```");
  lines.push("### Intent Log");
  lines.push("```json");
  lines.push(JSON.stringify(intent.intentLog || [], null, 2));
  lines.push("```");
  lines.push("### Phase 4 Log");
  lines.push("```json");
  lines.push(JSON.stringify(phase4.phase4Log || [], null, 2));
  lines.push("```");
  return lines.join("\n");
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  });
  return lines.join("\n");
}

export const mockBundles = {
  predict: {
    preparedDatasetState: {
      columns: [
        { name: "final_score", detectedType: "numeric", role: "predictor", missingPct: 0, uniqueRatio: 0.3 },
        { name: "attendance_pct", detectedType: "numeric", role: "predictor", missingPct: 0, uniqueRatio: 0.4 },
        { name: "teaching_method", detectedType: "categorical", role: "predictor", missingPct: 0, uniqueRatio: 0.1, levelsCount: 3 },
      ],
      rawData: [
        { final_score: 80, attendance_pct: 0.9, teaching_method: "A" },
        { final_score: 75, attendance_pct: 0.8, teaching_method: "B" },
      ],
      prepDecisions: { missingStrategy: "none", duplicatesRemoved: false, excludedColumns: [], identifierColumns: [] },
      prepLog: [],
    },
    intent: { type: "predict", predict: { outcome: "final_score", predictors: ["attendance_pct", "teaching_method"] }, intentLog: [] },
    phase4: { diagnosticsRun: true, diagnostics: {}, validityStatus: "green", validityReasons: [], adjustments: { transformOutcome: "none", outlierMode: "flag", outlierRule: "3xIQR", excludedOutlierCount: 0, justification: {} }, phase4Log: [] },
  },
  compare_means: {
    preparedDatasetState: {
      columns: [
        { name: "score", detectedType: "numeric", role: "predictor", missingPct: 0, uniqueRatio: 0.4 },
        { name: "group", detectedType: "categorical", role: "predictor", missingPct: 0, uniqueRatio: 0.1, levelsCount: 3 },
      ],
      rawData: [
        { score: 78, group: "A" },
        { score: 82, group: "B" },
        { score: 75, group: "C" },
      ],
      prepDecisions: { missingStrategy: "none", duplicatesRemoved: false, excludedColumns: [], identifierColumns: [] },
      prepLog: [],
    },
    intent: { type: "compare_means", compare_means: { outcome: "score", group: "group" }, intentLog: [] },
    phase4: { diagnosticsRun: true, diagnostics: {}, validityStatus: "yellow", validityReasons: ["Group sizes are uneven."], adjustments: { transformOutcome: "none", outlierMode: "flag", outlierRule: "3xIQR", excludedOutlierCount: 0, justification: {} }, phase4Log: [] },
  },
  association: {
    preparedDatasetState: {
      columns: [
        { name: "category", detectedType: "categorical", role: "predictor", missingPct: 0, uniqueRatio: 0.2, levelsCount: 3 },
        { name: "segment", detectedType: "categorical", role: "predictor", missingPct: 0, uniqueRatio: 0.2, levelsCount: 2 },
      ],
      rawData: [
        { category: "A", segment: "X" },
        { category: "B", segment: "Y" },
        { category: "A", segment: "Y" },
      ],
      prepDecisions: { missingStrategy: "none", duplicatesRemoved: false, excludedColumns: [], identifierColumns: [] },
      prepLog: [],
    },
    intent: { type: "association", association: { varA: "category", varB: "segment" }, intentLog: [] },
    phase4: { diagnosticsRun: true, diagnostics: {}, validityStatus: "green", validityReasons: [], adjustments: { transformOutcome: "none", outlierMode: "flag", outlierRule: "3xIQR", excludedOutlierCount: 0, justification: {} }, phase4Log: [] },
  },
};
