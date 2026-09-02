/* Dependency-free inline-SVG charts. Every series is computed by the backend;
   these components only map numbers to coordinates. Colours come from CSS vars
   so both themes work. */

const AXIS = "var(--border-strong)";
const INK = "var(--text)";
const MUTED = "var(--text-muted)";
const ACCENT = "var(--accent)";

/* Small categorical ramp, chosen to stay legible on the light-green ground.
   Beyond its length the colours repeat at reduced opacity. */
const CAT_COLORS = ["#2f7d4b", "#b07d2b", "#4f6d8c", "#9c5b4e", "#6a8f5f", "#7a5c8c", "#4a4a4a"];
const catColor = (i) => CAT_COLORS[i % CAT_COLORS.length];
const catOpacity = (i) => (i < CAT_COLORS.length ? 1 : i < CAT_COLORS.length * 2 ? 0.6 : 0.35);

function niceNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(a < 1 ? 3 : a < 100 ? 2 : 1);
}

/* --------------------------------------------------------------------- */
/* Histogram                                                             */
/* --------------------------------------------------------------------- */
export function Histogram({ hist, label, width = 200, height = 74 }) {
  if (!hist?.counts?.length) return null;
  const { bin_edges: edges, counts } = hist;
  const w = width;
  const h = height;
  const padL = 4;
  const padB = 12;
  const padT = 4;
  const maxC = Math.max(...counts);
  const innerW = w - padL * 2;
  const innerH = h - padB - padT;
  const bw = innerW / counts.length;

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
           aria-label={`Distribution of ${label}`} style={{ display: "block" }}>
        {counts.map((c, i) => {
          const bh = maxC ? (c / maxC) * innerH : 0;
          return (
            <rect key={i} x={padL + i * bw + 0.5} y={padT + innerH - bh}
                  width={Math.max(bw - 1, 0.5)} height={bh}
                  fill={ACCENT} opacity={0.75} />
          );
        })}
        <line x1={padL} y1={padT + innerH} x2={w - padL} y2={padT + innerH}
              stroke={AXIS} strokeWidth="1" />
        <text x={padL} y={h - 2} fontSize="8" fill={MUTED}>{niceNum(edges[0])}</text>
        <text x={w - padL} y={h - 2} fontSize="8" fill={MUTED} textAnchor="end">
          {niceNum(edges[edges.length - 1])}
        </text>
      </svg>
      {label && (
        <figcaption style={{ fontSize: 9, color: MUTED, textAlign: "center", marginTop: 1 }}>
          {label}
          {hist.n_below || hist.n_above
            ? ` · ${(hist.n_below || 0) + (hist.n_above || 0)} beyond range`
            : ""}
        </figcaption>
      )}
    </figure>
  );
}

/* --------------------------------------------------------------------- */
/* Scatter with least-squares trend line                                */
/* --------------------------------------------------------------------- */
export function Scatter({ chart, width = 300, height = 200 }) {
  if (!chart?.points?.length) return null;
  const { points, trend, x: xLabel, y: yLabel, n, sampled, clipped } = chart;
  const w = width;
  const h = height;
  const clipId = `clip-${xLabel}-${yLabel}`.replace(/[^a-zA-Z0-9-]/g, "_");
  const m = { l: 36, r: 8, t: 8, b: 26 };
  const iw = w - m.l - m.r;
  const ih = h - m.t - m.b;

  const span = (arr) => {
    let [lo, hi] = arr;
    if (lo === hi) { lo -= 1; hi += 1; }
    return [lo, hi];
  };
  const fallback = (vals) => [Math.min(...vals), Math.max(...vals)];
  const [xlo, xhi] = span(chart.x_lim ?? fallback(points.map((p) => p[0])));
  const [ylo, yhi] = span(chart.y_lim ?? fallback(points.map((p) => p[1])));
  const sx = (v) => m.l + ((v - xlo) / (xhi - xlo)) * iw;
  const sy = (v) => m.t + ih - ((v - ylo) / (yhi - ylo)) * ih;

  return (
    <figure style={{ margin: "6px 0 0" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
           aria-label={`Scatter plot of ${yLabel} against ${xLabel}`} style={{ display: "block" }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={m.l} y={m.t} width={iw} height={ih} />
          </clipPath>
        </defs>
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} stroke={AXIS} strokeWidth="1" />
        <line x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} stroke={AXIS} strokeWidth="1" />
        <g clipPath={`url(#${clipId})`}>
          {points.map((p, i) => (
            <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={2.2} fill={INK} opacity={0.5} />
          ))}
          {trend && (
            <line x1={sx(trend.x0)} y1={sy(trend.y0)} x2={sx(trend.x1)} y2={sy(trend.y1)}
                  stroke={ACCENT} strokeWidth="1.5" />
          )}
        </g>
        <text x={m.l} y={m.t + ih + 10} fontSize="8" fill={MUTED}>{niceNum(xlo)}</text>
        <text x={m.l + iw} y={m.t + ih + 10} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(xhi)}</text>
        <text x={m.l - 3} y={m.t + ih} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(ylo)}</text>
        <text x={m.l - 3} y={m.t + 6} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(yhi)}</text>
        <text x={m.l + iw / 2} y={h - 3} fontSize="9" fill={INK} textAnchor="middle">{xLabel}</text>
        <text x={9} y={m.t + ih / 2} fontSize="9" fill={INK} textAnchor="middle"
              transform={`rotate(-90 9 ${m.t + ih / 2})`}>{yLabel}</text>
      </svg>
      <figcaption style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>
        {sampled ? `${points.length} of ${n} rows shown` : `${n} rows`}
        {trend ? " · line = least-squares fit" : ""}
        {clipped ? ` · ${clipped} point${clipped > 1 ? "s" : ""} outside the axis range` : ""}
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------- */
/* Residuals vs fitted values                                           */
/* --------------------------------------------------------------------- */
export function ResidualPlot({ chart, width = 300, height = 190 }) {
  if (!chart?.points?.length) return null;
  const { points, n, sampled, bp_p: bpP } = chart;
  const w = width;
  const h = height;
  const clipId = `rclip-${chart.outcome}`.replace(/[^a-zA-Z0-9-]/g, "_");
  const m = { l: 40, r: 8, t: 8, b: 26 };
  const iw = w - m.l - m.r;
  const ih = h - m.t - m.b;

  const span = (arr, sym = false) => {
    let [lo, hi] = arr;
    if (sym) { const a = Math.max(Math.abs(lo), Math.abs(hi)); lo = -a; hi = a; }
    if (lo === hi) { lo -= 1; hi += 1; }
    return [lo, hi];
  };
  const [xlo, xhi] = span(chart.fitted_lim ?? [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))]);
  const [ylo, yhi] = span(chart.resid_lim ?? [Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))], true);
  const sx = (v) => m.l + ((v - xlo) / (xhi - xlo)) * iw;
  const sy = (v) => m.t + ih - ((v - ylo) / (yhi - ylo)) * ih;
  const clipped = points.filter((p) => p[0] < xlo || p[0] > xhi || p[1] < ylo || p[1] > yhi).length;

  return (
    <figure style={{ margin: "6px 0 0" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
           aria-label={`Residuals against fitted values for the model of ${chart.outcome}`} style={{ display: "block" }}>
        <defs>
          <clipPath id={clipId}><rect x={m.l} y={m.t} width={iw} height={ih} /></clipPath>
        </defs>
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} stroke={AXIS} strokeWidth="1" />
        <line x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} stroke={AXIS} strokeWidth="1" />
        <line x1={m.l} y1={sy(0)} x2={m.l + iw} y2={sy(0)} stroke={ACCENT} strokeWidth="1" strokeDasharray="3 2" />
        <g clipPath={`url(#${clipId})`}>
          {points.map((p, i) => (
            <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={2.2} fill={INK} opacity={0.5} />
          ))}
        </g>
        <text x={m.l} y={m.t + ih + 10} fontSize="8" fill={MUTED}>{niceNum(xlo)}</text>
        <text x={m.l + iw} y={m.t + ih + 10} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(xhi)}</text>
        <text x={m.l - 3} y={m.t + ih} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(ylo)}</text>
        <text x={m.l - 3} y={m.t + 6} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(yhi)}</text>
        <text x={m.l + iw / 2} y={h - 3} fontSize="9" fill={INK} textAnchor="middle">fitted value</text>
        <text x={9} y={m.t + ih / 2} fontSize="9" fill={INK} textAnchor="middle"
              transform={`rotate(-90 9 ${m.t + ih / 2})`}>residual</text>
      </svg>
      <figcaption style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>
        {sampled ? `${points.length} of ${n} rows shown` : `${n} rows`}
        {" · dashed line = zero"}
        {typeof bpP === "number" ? ` · Breusch–Pagan p = ${bpP < 1e-3 ? bpP.toExponential(1) : bpP.toFixed(3)}` : ""}
        {clipped ? ` · ${clipped} outside range` : ""}
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------- */
/* Horizontal box plot, one row per group                               */
/* --------------------------------------------------------------------- */
export function BoxPlot({ chart, width = 300, rowH = 26 }) {
  const groups = chart?.groups ?? [];
  if (!groups.length) return null;
  const w = width;
  const m = { l: 4, r: 8, t: 6, b: 18 };
  const labelW = Math.min(
    90,
    Math.max(28, ...groups.map((g) => String(g.level).length * 6 + 8)),
  );
  const iw = w - m.l - m.r - labelW;
  const h = m.t + m.b + groups.length * rowH;

  const lo = Math.min(...groups.map((g) => Math.min(g.min, g.whisker_lo)));
  const hi = Math.max(...groups.map((g) => Math.max(g.max, g.whisker_hi)));
  const span = hi === lo ? 1 : hi - lo;
  const sx = (v) => m.l + labelW + ((v - lo) / span) * iw;

  return (
    <figure style={{ margin: "6px 0 0" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
           aria-label={`Distribution of ${chart.num} by ${chart.cat}`} style={{ display: "block" }}>
        {groups.map((g, i) => {
          const cy = m.t + i * rowH + rowH / 2;
          const hot = chart.higher_group != null && String(g.level) === String(chart.higher_group);
          return (
            <g key={g.level}>
              <text x={m.l} y={cy + 3} fontSize="9" fill={hot ? ACCENT : INK}
                    fontWeight={hot ? 700 : 400}>
                {String(g.level).length > 14 ? String(g.level).slice(0, 13) + "…" : g.level}
              </text>
              {/* whiskers */}
              <line x1={sx(g.whisker_lo)} y1={cy} x2={sx(g.q1)} y2={cy} stroke={AXIS} />
              <line x1={sx(g.q3)} y1={cy} x2={sx(g.whisker_hi)} y2={cy} stroke={AXIS} />
              <line x1={sx(g.whisker_lo)} y1={cy - 4} x2={sx(g.whisker_lo)} y2={cy + 4} stroke={AXIS} />
              <line x1={sx(g.whisker_hi)} y1={cy - 4} x2={sx(g.whisker_hi)} y2={cy + 4} stroke={AXIS} />
              {/* box */}
              <rect x={sx(g.q1)} y={cy - 7} width={Math.max(sx(g.q3) - sx(g.q1), 1)} height={14}
                    fill={ACCENT} opacity={hot ? 0.35 : 0.18} stroke={ACCENT} strokeWidth="1" />
              <line x1={sx(g.median)} y1={cy - 7} x2={sx(g.median)} y2={cy + 7}
                    stroke={ACCENT} strokeWidth="2" />
              {/* outliers */}
              {(g.outliers ?? []).map((o, k) => (
                <circle key={k} cx={sx(o)} cy={cy} r={1.8} fill={MUTED} />
              ))}
            </g>
          );
        })}
        <line x1={m.l + labelW} y1={h - m.b + 2} x2={w - m.r} y2={h - m.b + 2}
              stroke={AXIS} strokeWidth="1" />
        <text x={m.l + labelW} y={h - 4} fontSize="8" fill={MUTED}>{niceNum(lo)}</text>
        <text x={w - m.r} y={h - 4} fontSize="8" fill={MUTED} textAnchor="end">{niceNum(hi)}</text>
      </svg>
      <figcaption style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>
        {chart.num} by {chart.cat} · box = IQR, line = median
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------- */
/* Contingency: one 100%-stacked bar per row level                       */
/* --------------------------------------------------------------------- */
export function ContingencyBars({ chart, width = 300, rowH = 22 }) {
  const { rows, cols, counts, row_shares: shares, row_totals: totals } = chart ?? {};
  if (!rows?.length || !cols?.length) return null;
  const w = width;
  const labelW = Math.min(96, Math.max(30, ...rows.map((r) => r.length * 6 + 6)));
  const totW = 30;
  const gap = 6;
  const barW = w - labelW - totW - gap * 2;
  const h = rows.length * rowH + 4;

  return (
    <figure style={{ margin: "6px 0 0" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
           aria-label={`${chart.col_var} composition by ${chart.row_var}`} style={{ display: "block" }}>
        {rows.map((r, ri) => {
          const y = ri * rowH + 2;
          let x = labelW + gap;
          return (
            <g key={r}>
              <text x={0} y={y + rowH / 2 + 3} fontSize="9" fill={INK}>
                {r.length > 15 ? r.slice(0, 14) + "…" : r}
              </text>
              {shares[ri].map((s, ci) => {
                const segW = s * barW;
                const seg = (
                  <rect key={ci} x={x} y={y + 3} width={Math.max(segW, 0)} height={rowH - 8}
                        fill={catColor(ci)} opacity={catOpacity(ci)}
                        stroke="var(--panel)" strokeWidth="0.5">
                    <title>{`${r} · ${cols[ci]}: ${counts[ri][ci]} (${(s * 100).toFixed(0)}%)`}</title>
                  </rect>
                );
                x += segW;
                return seg;
              })}
              <text x={w} y={y + rowH / 2 + 3} fontSize="8" fill={MUTED} textAnchor="end">
                {totals[ri]}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 4 }}>
        {cols.map((c, ci) => (
          <span key={c} style={{ fontSize: 9, color: MUTED, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, background: catColor(ci), opacity: catOpacity(ci), display: "inline-block" }} />
            {c}
          </span>
        ))}
      </div>
      <figcaption style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>
        {chart.col_var} within each {chart.row_var} · bar = 100%, number = row count
        {chart.truncated ? " · rarer levels not shown" : ""}
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------- */
/* Correlation heatmap                                                   */
/* --------------------------------------------------------------------- */
const POS_HUE = [47, 125, 75]; // accent green
const NEG_HUE = [79, 109, 140]; // slate blue

function heatFill(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "var(--panel-strong)";
  const mag = Math.min(Math.abs(v), 1);
  const [r, g, b] = v >= 0 ? POS_HUE : NEG_HUE;
  const a = 0.08 + 0.82 * mag;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function shortLabel(s, n = 12) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function CorrelationHeatmap({ matrix, maxWidth = 460 }) {
  const cols = matrix?.columns ?? [];
  const N = cols.length;
  if (N < 2) return null;

  const lookup = new Map(); // "i,j" -> cell (upper triangle + diagonal)
  for (const c of matrix.cells) lookup.set(`${c.i},${c.j}`, c);
  const at = (i, j) => lookup.get(i <= j ? `${i},${j}` : `${j},${i}`);

  const labelW = 78;
  const topH = 54;
  const cell = Math.max(13, Math.min(30, Math.floor((maxWidth - labelW) / N)));
  const grid = N * cell;
  const w = labelW + grid + 4;
  const h = topH + grid + 4;
  const showText = cell >= 22;

  return (
    <figure style={{ margin: "0 0 12px", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img"
           aria-label="Correlation matrix of the numeric columns" style={{ display: "block" }}>
        {cols.map((c, j) => (
          <text key={`ct-${c}`} x={labelW + j * cell + cell / 2} y={topH - 4}
                fontSize="8" fill={INK} textAnchor="start"
                transform={`rotate(-45 ${labelW + j * cell + cell / 2} ${topH - 4})`}>
            {shortLabel(c, 14)}
          </text>
        ))}
        {cols.map((rowName, i) => (
          <g key={`row-${rowName}`}>
            <text x={labelW - 4} y={topH + i * cell + cell / 2 + 3} fontSize="8"
                  fill={INK} textAnchor="end">{shortLabel(rowName)}</text>
            {cols.map((colName, j) => {
              const c = at(i, j);
              const v = c ? c.value : null;
              const x = labelW + j * cell;
              const y = topH + i * cell;
              return (
                <g key={`${i}-${j}`}>
                  <rect x={x} y={y} width={cell - 1} height={cell - 1}
                        fill={heatFill(v)} stroke="var(--panel)" strokeWidth="0.5">
                    <title>
                      {c && c.kind !== "identity"
                        ? `${rowName} × ${colName}: ${c.kind === "spearman" ? "ρ" : "r"} = ${v.toFixed(2)} · q = ${c.q == null ? "—" : c.q.toExponential(1)} · n = ${c.n}`
                        : i === j
                        ? rowName
                        : `${rowName} × ${colName}: not tested`}
                    </title>
                  </rect>
                  {showText && v !== null && i !== j && (
                    <text x={x + (cell - 1) / 2} y={y + (cell - 1) / 2 + 3} fontSize="8"
                          fill={INK} textAnchor="middle">
                      {v.toFixed(2).replace(/^(-?)0\./, "$1.")}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <figcaption style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>
        Pearson / Spearman r · green = positive, blue = negative, blank = not tested
        {matrix.truncated ? ` · first ${N} numeric columns` : ""}
      </figcaption>
    </figure>
  );
}

export function FindingChart({ chart }) {
  if (!chart) return null;
  if (chart.type === "scatter") return <Scatter chart={chart} />;
  if (chart.type === "box") return <BoxPlot chart={chart} />;
  if (chart.type === "contingency") return <ContingencyBars chart={chart} />;
  if (chart.type === "residual") return <ResidualPlot chart={chart} />;
  return null;
}
