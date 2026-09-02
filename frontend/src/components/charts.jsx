/* Dependency-free inline-SVG charts. Every series is computed by the backend;
   these components only map numbers to coordinates. Colours come from CSS vars
   so both themes work. */

const AXIS = "var(--border-strong)";
const INK = "var(--text)";
const MUTED = "var(--text-muted)";
const ACCENT = "var(--accent)";

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

export function FindingChart({ chart }) {
  if (!chart) return null;
  if (chart.type === "scatter") return <Scatter chart={chart} />;
  if (chart.type === "box") return <BoxPlot chart={chart} />;
  return null;
}
