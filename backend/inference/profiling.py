"""Column type inference and data-quality scanning."""

import re

import numpy as np
import pandas as pd
from scipy import stats

from . import charts

NUMERIC_RE = re.compile(r"^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][+-]?\d+)?$")

# Column-name tokens that mark an identifier (ported from the old frontend heuristic).
_ID_TOKENS = {"id", "uuid", "guid", "identifier"}
_ID_PHRASES = (
    "student id", "user id", "order id", "record id", "customer id",
    "account number", "account no", "row id", "index",
)

HIGH_CARDINALITY_LEVELS = 50
NEAR_CONSTANT_FRAC = 0.99
ID_UNIQUE_RATIO = 0.95

_SEVERITY_WEIGHT = {"high": 15.0, "medium": 6.0, "low": 1.5}


def looks_like_id_name(name: str) -> bool:
    raw = str(name)
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw)
    normalized = re.sub(r"[^a-zA-Z0-9]+", " ", spaced).lower().strip()
    tokens = [t for t in normalized.split(" ") if t]
    if any(t in _ID_TOKENS for t in tokens):
        return True
    if tokens and tokens[-1] == "id":
        return True
    return any(phrase in normalized for phrase in _ID_PHRASES)


def _text_numeric_fraction(raw_series: pd.Series) -> float:
    values = [str(v).strip() for v in raw_series.tolist() if str(v).strip() != ""]
    if not values:
        return 0.0
    hits = sum(1 for v in values if NUMERIC_RE.match(v))
    return hits / len(values)


def _datetime_fraction(raw_series: pd.Series) -> float:
    values = pd.Series([v for v in raw_series.tolist() if str(v).strip() != ""])
    if values.empty:
        return 0.0
    parsed = pd.to_datetime(values, errors="coerce", format="mixed")
    return float(parsed.notna().mean())


def _numeric_stats(series: pd.Series) -> dict:
    # Reset to a 0-based positional index so outlier positions below are true row
    # numbers (scan_quality resolves them positionally); the caller's frame may
    # carry a non-range index, e.g. when pandas infers a row-label column.
    s = series.reset_index(drop=True).dropna()
    if s.empty:
        return {}
    q1 = float(s.quantile(0.25))
    q3 = float(s.quantile(0.75))
    iqr = q3 - q1
    out3 = out5 = 0
    pos3: list[list] = []
    pos5: list[list] = []
    if iqr > 0:
        m3 = (s < q1 - 3 * iqr) | (s > q3 + 3 * iqr)
        m5 = (s < q1 - 5 * iqr) | (s > q3 + 5 * iqr)
        out3, out5 = int(m3.sum()), int(m5.sum())
        # (0-based row position, value) for the flagged rows — s now has a
        # positional index, so i is the row offset. scan_quality turns these into
        # human row numbers (and id-column values when one exists).
        pos3 = [[int(i), float(v)] for i, v in s[m3].items()][:25]
        pos5 = [[int(i), float(v)] for i, v in s[m5].items()][:25]
    return {
        "min": float(s.min()),
        "max": float(s.max()),
        "mean": float(s.mean()),
        "std": float(s.std(ddof=1)) if len(s) > 1 else 0.0,
        "median": float(s.median()),
        "q1": q1,
        "q3": q3,
        "skew": float(s.skew()) if len(s) > 2 else 0.0,
        "kurtosis": float(s.kurt()) if len(s) > 3 else 0.0,
        "n_outliers_3iqr": out3,
        "n_outliers_5iqr": out5,
        "outlier_pos_3iqr": pos3,
        "outlier_pos_5iqr": pos5,
        "histogram": charts.histogram(s),
        "box": charts.box_stats(s.to_numpy(float)),
    }


def profile_columns(df: pd.DataFrame, raw_df: pd.DataFrame) -> list[dict]:
    """Classify every column and attach descriptive stats.

    ``type`` is one of ``numeric`` | ``categorical`` | ``datetime`` | ``excluded``.
    Excluded columns carry an ``exclude_reason``.
    """
    n_rows = len(df)
    profiles: list[dict] = []

    for col in df.columns:
        parsed = df[col]
        raw = raw_df[col] if col in raw_df.columns else parsed.astype(str)
        non_null = parsed.dropna()
        n_missing = int(parsed.isna().sum())
        pct_missing = (n_missing / n_rows) if n_rows else 0.0

        is_pandas_numeric = pd.api.types.is_numeric_dtype(parsed)
        text_numeric = _text_numeric_fraction(raw)
        coerced = False
        numeric_series = None
        if is_pandas_numeric:
            numeric_series = pd.to_numeric(parsed, errors="coerce")
        elif text_numeric >= 0.9:
            cleaned = raw.map(lambda v: str(v).replace(",", "").strip()).replace("", np.nan)
            numeric_series = pd.to_numeric(cleaned, errors="coerce")
            coerced = True

        if numeric_series is not None:
            work = numeric_series
            n_unique = int(work.dropna().nunique())
        else:
            work = parsed
            n_unique = int(non_null.nunique())

        unique_ratio = (n_unique / n_rows) if n_rows else 0.0
        profile = {
            "name": str(col),
            "type": None,
            "exclude_reason": None,
            "n_missing": n_missing,
            "pct_missing": round(pct_missing, 4),
            "n_unique": n_unique,
            "unique_ratio": round(unique_ratio, 4),
            "coerced_from_text": coerced,
            "stats": None,
        }

        # dominant-level fraction (for near-constant detection)
        if not non_null.empty:
            top_frac = float(non_null.value_counts(normalize=True).iloc[0])
        else:
            top_frac = 0.0

        if non_null.empty:
            profile["type"] = "excluded"
            profile["exclude_reason"] = "empty"
        elif pct_missing > 0.5:
            profile["type"] = "excluded"
            profile["exclude_reason"] = "mostly missing"
        elif n_unique <= 1:
            profile["type"] = "excluded"
            profile["exclude_reason"] = "constant"
        elif top_frac >= NEAR_CONSTANT_FRAC:
            profile["type"] = "excluded"
            profile["exclude_reason"] = "near-constant"
        elif numeric_series is not None:
            # An integer-like id column: drop it, but keep genuine continuous data
            # even when every value is unique.
            if looks_like_id_name(col) and unique_ratio >= ID_UNIQUE_RATIO:
                profile["type"] = "excluded"
                profile["exclude_reason"] = "id-like"
            else:
                profile["type"] = "numeric"
                profile["stats"] = _numeric_stats(numeric_series)
        elif _datetime_fraction(raw) >= 0.9:
            profile["type"] = "datetime"
            profile["exclude_reason"] = "datetime (not analysed in this version)"
        elif looks_like_id_name(col) or unique_ratio >= ID_UNIQUE_RATIO:
            profile["type"] = "excluded"
            profile["exclude_reason"] = "id-like / free text"
        elif n_unique > HIGH_CARDINALITY_LEVELS or unique_ratio >= 0.5:
            profile["type"] = "excluded"
            profile["exclude_reason"] = "high-cardinality text"
        else:
            profile["type"] = "categorical"

        profiles.append(profile)

    return profiles


def _add(issues: list[dict], severity: str, kind: str, message: str, column=None, detail=None):
    issues.append({
        "severity": severity,
        "kind": kind,
        "column": column,
        "message": message,
        "detail": detail,
    })


def _missingness_associate(df: pd.DataFrame, target: str, profiles: list[dict]):
    """Return (other_col, p) with the strongest association to target's missingness."""
    indicator = df[target].isna().astype(int)
    best = None
    for prof in profiles:
        other = prof["name"]
        if other == target or prof["type"] not in ("numeric", "categorical"):
            continue
        sub = pd.DataFrame({"miss": indicator, "other": df[other]}).dropna(subset=["other"])
        if sub["miss"].nunique() < 2 or len(sub) < 20:
            continue
        try:
            if prof["type"] == "numeric":
                a = sub.loc[sub["miss"] == 1, "other"].astype(float)
                b = sub.loc[sub["miss"] == 0, "other"].astype(float)
                if len(a) < 3 or len(b) < 3:
                    continue
                _, p = stats.ttest_ind(a, b, equal_var=False)
            else:
                table = pd.crosstab(sub["miss"], sub["other"].astype(str))
                if table.shape[1] < 2:
                    continue
                _, p, _, _ = stats.chi2_contingency(table)
        except Exception:
            continue
        if p is not None and np.isfinite(p) and (best is None or p < best[1]):
            best = (other, float(p))
    return best


_LOCATION_CAP = 15


def detect_id_column(profiles: list[dict]) -> str | None:
    """Name of the column that identifies a row (excluded as id-like), if any."""
    return next((p["name"] for p in profiles
                 if (p["exclude_reason"] or "").startswith("id-like")), None)


def _row_label_fn(df: pd.DataFrame, profiles: list[dict]):
    """Return a function pos -> {"row": 1-based, "id": <id-column value>|None}.

    ``row`` is the 1-based position in the data (row 1 = first data row). When the
    file has an identifier column, its value at that row is included so a user can
    find the record without counting lines.
    """
    id_col = detect_id_column(profiles)
    id_vals = df[id_col].tolist() if id_col and id_col in df.columns else None

    def label(pos: int) -> dict:
        out = {"row": int(pos) + 1}
        if id_vals is not None and 0 <= pos < len(id_vals):
            v = id_vals[pos]
            out["id"] = None if pd.isna(v) else str(v)
        return out

    return id_col, label


def _locations(positions, label_fn) -> dict:
    shown = [label_fn(p) for p in positions[:_LOCATION_CAP]]
    return {"locations": shown, "location_count": len(positions),
            "location_more": max(0, len(positions) - len(shown))}


def scan_quality(df: pd.DataFrame, profiles: list[dict]) -> tuple[float, list[dict]]:
    issues: list[dict] = []
    n_rows = len(df)
    by_name = {p["name"]: p for p in profiles}
    id_col, row_label = _row_label_fn(df, profiles)

    if n_rows < 10:
        _add(issues, "high", "sample_size", f"Only {n_rows} rows — almost every test is unreliable.")
    elif n_rows < 30:
        _add(issues, "high", "sample_size", f"Only {n_rows} rows — most tests are underpowered.")

    missing_row_pos = [i for i, flag in enumerate(df.isna().any(axis=1).tolist()) if flag]
    if missing_row_pos:
        frac = len(missing_row_pos) / n_rows
        sev = "medium" if frac > 0.2 else "low"
        _add(issues, sev, "missing_rows",
             f"{len(missing_row_pos)} of {n_rows} rows ({frac:.0%}) have at least one missing value.",
             detail=_locations(missing_row_pos, row_label))

    n_numeric_modeling = sum(1 for p in profiles if p["type"] == "numeric")

    for p in profiles:
        col = p["name"]
        pm = p["pct_missing"]
        if pm > 0:
            miss_pos = [i for i, flag in enumerate(df[col].isna().tolist()) if flag]
            where = _locations(miss_pos, row_label) if col != id_col else None
            sev = "high" if pm > 0.5 else "medium" if pm > 0.2 else "low"
            _add(issues, sev, "missing_column", f"'{col}' is {pm:.0%} missing.",
                 column=col, detail=where)

        if 0 < pm < 1 and p["type"] in ("numeric", "categorical"):
            assoc = _missingness_associate(df, col, profiles)
            if assoc and assoc[1] < 0.01:
                _add(issues, "medium", "missing_not_random",
                     f"Missing values in '{col}' are associated with '{assoc[0]}' "
                     f"(p = {assoc[1]:.3g}) — missingness is not completely at random.",
                     column=col, detail={"associated_with": assoc[0], "p": assoc[1]})

        if p["exclude_reason"] == "constant":
            _add(issues, "low", "constant_column", f"'{col}' has a single value — dropped from analysis.", column=col)
        elif p["exclude_reason"] == "near-constant":
            _add(issues, "low", "near_constant_column",
                 f"'{col}' is >99% one value — dropped from analysis.", column=col)
        elif p["exclude_reason"] == "id-like / free text":
            _add(issues, "low", "excluded_column", f"'{col}' looks like an identifier / free text — excluded.", column=col)
        elif p["exclude_reason"] == "high-cardinality text":
            _add(issues, "low", "excluded_column",
                 f"'{col}' has {p['n_unique']} distinct text values — excluded from analysis.", column=col)
        elif p["type"] == "datetime":
            _add(issues, "low", "excluded_column", f"'{col}' is a date/time column — not analysed in this version.", column=col)

        if p["coerced_from_text"]:
            _add(issues, "low", "coerced_type", f"'{col}' was stored as text and parsed as numbers.", column=col)

        s = p["stats"] or {}
        pos5 = s.pop("outlier_pos_5iqr", []) or []
        pos3 = s.pop("outlier_pos_3iqr", []) or []

        def _outlier_detail(pos_pairs):
            det = _locations([pos for pos, _ in pos_pairs], row_label)
            values = {pos: val for pos, val in pos_pairs}
            for loc in det["locations"]:
                loc["value"] = values.get(loc["row"] - 1)
            return det

        if s.get("n_outliers_5iqr", 0) > 0:
            _add(issues, "medium", "extreme_values",
                 f"'{col}' has {s['n_outliers_5iqr']} extreme value(s) beyond 5×IQR — likely to distort results.",
                 column=col, detail=_outlier_detail(pos5))
        elif s.get("n_outliers_3iqr", 0) > 0:
            _add(issues, "low", "outliers",
                 f"'{col}' has {s['n_outliers_3iqr']} outlier(s) beyond 3×IQR.",
                 column=col, detail=_outlier_detail(pos3))
        if abs(s.get("skew", 0)) > 2:
            _add(issues, "medium", "skew", f"'{col}' is severely skewed (skew = {s['skew']:.2f}).", column=col)
        elif abs(s.get("skew", 0)) > 1:
            _add(issues, "low", "skew", f"'{col}' is strongly skewed (skew = {s['skew']:.2f}).", column=col)
        if s.get("kurtosis", 0) > 3:
            _add(issues, "low", "heavy_tails", f"'{col}' has heavy tails (excess kurtosis = {s['kurtosis']:.2f}).", column=col)

        if p["type"] == "categorical":
            counts = df[col].dropna().astype(str).value_counts()
            if len(counts):
                dom = counts.iloc[0] / counts.sum()
                if dom > 0.9:
                    _add(issues, "medium", "class_imbalance",
                         f"'{col}' is {dom:.0%} one category — group comparisons will be unstable.", column=col)
                if counts.iloc[-1] < 5:
                    _add(issues, "medium", "rare_category",
                         f"'{col}' has a category with only {int(counts.iloc[-1])} row(s).", column=col)

    exact_dupes = int(df.duplicated(keep=False).sum())
    if exact_dupes > 1:
        _add(issues, "medium", "duplicate_rows", f"{exact_dupes} rows are exact duplicates of another row.")

    if n_numeric_modeling >= n_rows > 0:
        _add(issues, "high", "wide_data",
             f"{n_numeric_modeling} numeric variables for {n_rows} rows — regression models will overfit.")

    order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda i: (order[i["severity"]], i["kind"]))

    penalty = sum(_SEVERITY_WEIGHT[i["severity"]] for i in issues)
    score = max(0.0, min(100.0, round(100.0 - penalty, 1)))
    return score, issues


def quality_summary(issues: list[dict]) -> str:
    counts = {"high": 0, "medium": 0, "low": 0}
    for i in issues:
        counts[i["severity"]] += 1
    total = sum(counts.values())
    noun = "issue" if total == 1 else "issues"
    return (f"{counts['high']} high · {counts['medium']} medium · {counts['low']} low "
            f"— {total} data-quality {noun}")
