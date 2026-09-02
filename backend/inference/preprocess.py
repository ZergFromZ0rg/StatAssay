"""Turn a raw DataFrame + column profiles into analysis-ready frames."""

import numpy as np
import pandas as pd

MAX_MODELING_COLS = 40


def _coerce_frame(df: pd.DataFrame, profiles: list[dict], columns: list[str]) -> pd.DataFrame:
    """Return df[columns] with numerics as float and categoricals as trimmed strings."""
    by_name = {p["name"]: p for p in profiles}
    out = {}
    for col in columns:
        prof = by_name[col]
        if prof["type"] == "numeric":
            cleaned = df[col]
            if prof["coerced_from_text"]:
                cleaned = df[col].map(lambda v: str(v).replace(",", "").strip()).replace("", np.nan)
            out[col] = pd.to_numeric(cleaned, errors="coerce")
        else:
            s = df[col].astype("object")
            out[col] = s.where(s.isna(), s.astype(str))
    return pd.DataFrame(out, index=df.index)


def select_modeling_columns(profiles: list[dict], df: pd.DataFrame) -> tuple[list[str], list[str]]:
    """Pick the columns to sweep. Applies a hard cap, keeping the most informative."""
    candidates = [p for p in profiles if p["type"] in ("numeric", "categorical")]
    if len(candidates) <= MAX_MODELING_COLS:
        return [p["name"] for p in candidates], []

    def score(p: dict) -> tuple[float, float]:
        completeness = 1.0 - p["pct_missing"]
        if p["type"] == "numeric":
            spread = abs((p["stats"] or {}).get("std", 0.0))
            rng = abs((p["stats"] or {}).get("max", 0.0) - (p["stats"] or {}).get("min", 0.0)) or 1.0
            info = spread / rng
        else:
            # entropy-ish: more balanced categories carry more signal
            counts = df[p["name"]].dropna().astype(str).value_counts(normalize=True)
            info = float(-(counts * np.log(counts + 1e-12)).sum())
        return (completeness, info)

    ranked = sorted(candidates, key=score, reverse=True)
    keep = [p["name"] for p in ranked[:MAX_MODELING_COLS]]
    dropped = [p["name"] for p in ranked[MAX_MODELING_COLS:]]
    return keep, dropped


def build_frames(df: pd.DataFrame, profiles: list[dict], modeling_cols: list[str]):
    """Return (complete_case_df, imputed_df_or_None, has_missing).

    ``complete_case_df`` keeps NaNs — each test drops rows pairwise.
    ``imputed_df`` fills numerics with the median and categoricals with the mode;
    it is ``None`` when there is nothing to impute.
    """
    base = _coerce_frame(df, profiles, modeling_cols)
    has_missing = bool(base.isna().any().any())

    imputed = None
    if has_missing:
        imputed = base.copy()
        for col in imputed.columns:
            series = imputed[col]
            if pd.api.types.is_numeric_dtype(series):
                fill = series.median()
                if pd.isna(fill):
                    continue
                imputed[col] = series.fillna(fill)
            else:
                mode = series.dropna()
                if mode.empty:
                    continue
                imputed[col] = series.fillna(mode.mode().iloc[0])

    return base, imputed, has_missing


def split_types(profiles: list[dict], modeling_cols: list[str]) -> tuple[list[str], list[str]]:
    keep = set(modeling_cols)
    numeric = [p["name"] for p in profiles if p["type"] == "numeric" and p["name"] in keep]
    categorical = [p["name"] for p in profiles if p["type"] == "categorical" and p["name"] in keep]
    return numeric, categorical
