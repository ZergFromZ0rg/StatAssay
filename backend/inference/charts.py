"""Plot-ready data series for the report.

Nothing here renders anything — each helper returns plain numbers that the frontend
draws as inline SVG. Keeping the maths on this side means the frontend stays a dumb
renderer and the Markdown/JSON export carries the same series.
"""

import numpy as np
import pandas as pd

# Deterministic subsampling so a given upload always produces the same picture.
_SEED = 20260902

SCATTER_CAP = 160
HIST_MAX_BINS = 24


def histogram(series: pd.Series, max_bins: int = HIST_MAX_BINS) -> dict | None:
    """Equal-width bin counts for a numeric column. ``None`` when there is nothing to bin."""
    s = pd.to_numeric(series, errors="coerce").dropna().to_numpy(float)
    s = s[np.isfinite(s)]
    if s.size < 5:
        return None
    full_lo, full_hi = float(s.min()), float(s.max())
    if full_lo == full_hi:
        return {"bin_edges": [full_lo, full_hi], "counts": [int(s.size)], "n": int(s.size),
                "n_below": 0, "n_above": 0}
    # Bin over the range of the Tukey-fenced values so a lone outlier does not
    # empty out every bin (nor leave a tail of empty bins out to the fence).
    q1, q3 = np.percentile(s, [25, 75])
    iqr = q3 - q1
    if iqr > 0:
        inside = s[(s >= q1 - 3 * iqr) & (s <= q3 + 3 * iqr)]
        lo, hi = (float(inside.min()), float(inside.max())) if inside.size else (full_lo, full_hi)
    else:
        lo, hi = full_lo, full_hi
    # Freedman–Diaconis, clamped — falls back to Sturges when the IQR is zero.
    width = 2 * iqr / np.cbrt(s.size)
    bins = int(np.ceil((hi - lo) / width)) if width > 0 else int(np.ceil(np.log2(s.size) + 1))
    bins = max(5, min(max_bins, bins))
    counts, edges = np.histogram(s, bins=bins, range=(lo, hi))
    return {
        "bin_edges": [float(e) for e in edges],
        "counts": [int(c) for c in counts],
        "n": int(s.size),
        "n_below": int((s < edges[0]).sum()),
        "n_above": int((s > edges[-1]).sum()),
    }


def _trend(x: np.ndarray, y: np.ndarray) -> dict | None:
    """Least-squares line endpoints across the observed x-range."""
    if x.size < 3 or np.ptp(x) == 0:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    x0, x1 = float(x.min()), float(x.max())
    return {
        "x0": x0, "y0": float(slope * x0 + intercept),
        "x1": x1, "y1": float(slope * x1 + intercept),
    }


def _robust_limits(v: np.ndarray) -> list[float]:
    """Tukey-fenced range (q ± 3·IQR) with a 5% pad — keeps a lone outlier from
    flattening the view, and is stable at small n where percentiles are not."""
    q1, q3 = np.percentile(v, [25, 75])
    iqr = q3 - q1
    if iqr > 0:
        lo = max(float(v.min()), q1 - 3 * iqr)
        hi = min(float(v.max()), q3 + 3 * iqr)
    else:
        lo, hi = float(v.min()), float(v.max())
    if lo == hi:
        return [float(lo) - 1, float(hi) + 1]
    pad = (hi - lo) * 0.05
    return [float(lo - pad), float(hi + pad)]


def scatter_series(x: pd.Series, y: pd.Series, cap: int = SCATTER_CAP) -> dict | None:
    """Paired (x, y) points for a correlation, subsampled to ``cap``.

    Also returns a least-squares fit line and robust axis limits; the frontend
    clips to those limits so one extreme point cannot dominate the picture.
    """
    sub = pd.DataFrame({"x": pd.to_numeric(x, errors="coerce"),
                        "y": pd.to_numeric(y, errors="coerce")}).dropna()
    sub = sub[np.isfinite(sub["x"]) & np.isfinite(sub["y"])]
    n = len(sub)
    if n < 3:
        return None
    xa, ya = sub["x"].to_numpy(float), sub["y"].to_numpy(float)
    trend = _trend(xa, ya)
    x_lim, y_lim = _robust_limits(xa), _robust_limits(ya)
    clipped = int(((xa < x_lim[0]) | (xa > x_lim[1]) | (ya < y_lim[0]) | (ya > y_lim[1])).sum())
    sampled = n > cap
    if sampled:
        idx = np.random.default_rng(_SEED).choice(n, size=cap, replace=False)
        idx.sort()
        xa, ya = xa[idx], ya[idx]
    return {
        "points": [[float(a), float(b)] for a, b in zip(xa, ya)],
        "n": int(n),
        "sampled": bool(sampled),
        "trend": trend,
        "x_lim": x_lim,
        "y_lim": y_lim,
        "clipped": clipped,
    }


def box_stats(values: np.ndarray) -> dict | None:
    """Tukey five-number summary plus fenced outliers for one group."""
    v = np.asarray(values, float)
    v = v[np.isfinite(v)]
    if v.size < 1:
        return None
    q1, med, q3 = (float(x) for x in np.percentile(v, [25, 50, 75]))
    iqr = q3 - q1
    fence_lo, fence_hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    inside = v[(v >= fence_lo) & (v <= fence_hi)]
    outliers = sorted(float(o) for o in v[(v < fence_lo) | (v > fence_hi)])
    return {
        "min": float(v.min()),
        "q1": q1,
        "median": med,
        "q3": q3,
        "max": float(v.max()),
        "whisker_lo": float(inside.min()) if inside.size else q1,
        "whisker_hi": float(inside.max()) if inside.size else q3,
        "outliers": outliers[:12],
        "n": int(v.size),
    }


def group_box_series(df: pd.DataFrame, num: str, cat: str, levels: list[str]) -> list[dict]:
    """One box per level, in the order ``levels`` is given."""
    if num not in df.columns or cat not in df.columns:
        return []
    sub = df[[num, cat]].dropna()
    sub = sub.assign(**{cat: sub[cat].astype(str)})
    out = []
    for lv in levels:
        stats = box_stats(sub.loc[sub[cat] == lv, num].to_numpy(float))
        if stats:
            out.append({"level": lv, **stats})
    return out


CONTINGENCY_MAX_LEVELS = 12


def contingency_series(table: dict, row_var: str, col_var: str) -> dict | None:
    """Reshape a crosstab into an ordered counts matrix plus row-normalised shares.

    ``table`` is ``{row_level: {col_level: count}}`` (as the sweep already stores it).
    Rows and columns are ordered by descending total so the largest segments come
    first; both are capped so the picture stays readable.
    """
    if not table:
        return None
    col_totals: dict[str, int] = {}
    for row in table.values():
        for c, v in row.items():
            col_totals[c] = col_totals.get(c, 0) + int(v)
    row_totals = {r: sum(int(v) for v in row.values()) for r, row in table.items()}
    if not col_totals or not row_totals:
        return None

    rows = sorted(row_totals, key=lambda r: (-row_totals[r], str(r)))[:CONTINGENCY_MAX_LEVELS]
    cols = sorted(col_totals, key=lambda c: (-col_totals[c], str(c)))[:CONTINGENCY_MAX_LEVELS]

    counts = [[int(table.get(r, {}).get(c, 0)) for c in cols] for r in rows]
    shares = [
        [(v / t if t else 0.0) for v in row]
        for row, t in zip(counts, (sum(row) for row in counts))
    ]
    return {
        "row_var": row_var,
        "col_var": col_var,
        "rows": [str(r) for r in rows],
        "cols": [str(c) for c in cols],
        "counts": counts,
        "row_shares": shares,
        "row_totals": [sum(row) for row in counts],
        "n": sum(sum(row) for row in counts),
        "truncated": len(row_totals) > len(rows) or len(col_totals) > len(cols),
    }


CORRELATION_MATRIX_MAX = 24


def correlation_matrix(numeric_cols: list[str], correlation_rows: list[dict]) -> dict | None:
    """A symmetric r-matrix for the numeric columns, built from the sweep results.

    Only the upper triangle (plus the unit diagonal) is emitted as ``cells``; the
    frontend mirrors it. Cells for pairs that were never tested (too few complete
    rows, no variance) are simply absent.
    """
    cols = numeric_cols[:CORRELATION_MATRIX_MAX]
    if len(cols) < 2:
        return None
    idx = {c: i for i, c in enumerate(cols)}

    cells = [{"i": i, "j": i, "value": 1.0, "q": None, "kind": "identity", "n": None}
             for i in range(len(cols))]
    for r in correlation_rows:
        a, b = r["vars"]
        if a not in idx or b not in idx:
            continue
        i, j = sorted((idx[a], idx[b]))
        cells.append({
            "i": i, "j": j,
            "value": r["effect_value"],
            "q": r.get("q_value"),
            "kind": r["kind"],
            "n": r["n"],
        })
    return {
        "columns": cols,
        "cells": cells,
        "truncated": len(numeric_cols) > len(cols),
    }
