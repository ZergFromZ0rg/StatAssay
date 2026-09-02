"""The unsupervised test sweep: correlations, group differences, contingency, regression."""

import itertools
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.outliers_influence import variance_inflation_factor

MIN_N = 10
MIN_GROUP_N = 3
MAX_GROUP_LEVELS = 20

# (small, medium, large) absolute-value cut points per effect measure.
_BUCKETS = {
    "r": (0.1, 0.3, 0.5),
    "spearman_rho": (0.1, 0.3, 0.5),
    "std_beta": (0.1, 0.2, 0.5),
    "cohen_d": (0.2, 0.5, 0.8),
    "eta_sq": (0.01, 0.06, 0.14),
    "cramers_v": (0.1, 0.3, 0.5),
    "adj_r2": (0.1, 0.3, 0.5),
}


def magnitude(effect_name: str, value: float) -> str:
    if value is None or not np.isfinite(value):
        return "none"
    lo, mid, hi = _BUCKETS[effect_name]
    a = abs(value)
    if a < lo:
        return "none"
    if a < mid:
        return "small"
    if a < hi:
        return "medium"
    return "large"


def _result(**kw) -> dict:
    kw.setdefault("assumptions", [])
    kw.setdefault("nonparametric_agrees", None)
    kw.setdefault("extra", {})
    kw["effect_magnitude"] = magnitude(kw["effect_name"], kw["effect_value"])
    return kw


def _assumption(name: str, ok: bool, detail: str = "", critical: bool = False) -> dict:
    return {"name": name, "ok": bool(ok), "detail": detail, "critical": critical}


# --------------------------------------------------------------------------- #
# correlations (numeric x numeric)
# --------------------------------------------------------------------------- #
def correlations(df: pd.DataFrame, numeric_cols: list[str], profiles_by_name: dict) -> list[dict]:
    out = []
    for a, b in itertools.combinations(numeric_cols, 2):
        sub = df[[a, b]].dropna()
        n = len(sub)
        if n < MIN_N or sub[a].nunique() < 2 or sub[b].nunique() < 2:
            continue
        x, y = sub[a].to_numpy(float), sub[b].to_numpy(float)
        pear_r, pear_p = stats.pearsonr(x, y)
        spear_rho, spear_p = stats.spearmanr(x, y)

        def skewed(col):
            st = (profiles_by_name.get(col, {}) or {}).get("stats") or {}
            return abs(st.get("skew", 0)) > 1 or st.get("n_outliers_5iqr", 0) > 0

        use_spearman = skewed(a) or skewed(b)
        if use_spearman:
            eff_name, eff_val, stat, p = "spearman_rho", float(spear_rho), float(spear_rho), float(spear_p)
        else:
            eff_name, eff_val, stat, p = "r", float(pear_r), float(pear_r), float(pear_p)

        agrees = (np.sign(pear_r) == np.sign(spear_rho)) and ((pear_p < 0.05) == (spear_p < 0.05))
        out.append(_result(
            family="correlation",
            kind="spearman" if use_spearman else "pearson",
            vars=[a, b],
            n=n,
            statistic=stat,
            p_raw=p,
            effect_name=eff_name,
            effect_value=eff_val,
            direction="positive" if eff_val > 0 else "negative" if eff_val < 0 else "none",
            assumptions=[_assumption(
                "linear / no extreme skew", not use_spearman,
                "reported Spearman (rank) correlation because a variable is skewed or has extremes",
            )],
            nonparametric_agrees=bool(agrees),
            extra={
                "pearson_r": float(pear_r), "pearson_p": float(pear_p),
                "spearman_rho": float(spear_rho), "spearman_p": float(spear_p),
            },
        ))
    return out


# --------------------------------------------------------------------------- #
# group differences (numeric x categorical)
# --------------------------------------------------------------------------- #
def _cohen_d(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return 0.0
    sp = np.sqrt(((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2))
    if sp == 0:
        return 0.0
    return float((a.mean() - b.mean()) / sp)


def group_differences(df: pd.DataFrame, numeric_cols: list[str], categorical_cols: list[str]) -> list[dict]:
    out = []
    for num in numeric_cols:
        for cat in categorical_cols:
            sub = df[[num, cat]].dropna()
            if sub.empty:
                continue
            sub = sub.copy()
            sub[cat] = sub[cat].astype(str)
            level_counts = sub[cat].value_counts()
            keep_levels = level_counts[level_counts >= MIN_GROUP_N].index.tolist()
            if len(keep_levels) < 2 or len(keep_levels) > MAX_GROUP_LEVELS:
                continue
            sub = sub[sub[cat].isin(keep_levels)]
            samples = [sub.loc[sub[cat] == lv, num].to_numpy(float) for lv in keep_levels]
            n = int(sum(len(s) for s in samples))
            grand = np.concatenate(samples)
            if np.unique(grand).size < 2:
                continue

            summary = [
                {"level": lv, "n": int(len(s)), "mean": float(s.mean()), "std": float(s.std(ddof=1)) if len(s) > 1 else 0.0}
                for lv, s in zip(keep_levels, samples)
            ]
            try:
                lev_p = float(stats.levene(*samples).pvalue)
            except Exception:
                lev_p = float("nan")
            norm_ps = [float(stats.shapiro(s).pvalue) for s in samples if 3 <= len(s) <= 5000]
            norm_min = min(norm_ps) if norm_ps else float("nan")
            small_n = n < 30

            if len(keep_levels) == 2:
                a, b = samples
                t_stat, p = stats.ttest_ind(a, b, equal_var=False)
                d = _cohen_d(a, b)
                try:
                    _, np_p = stats.mannwhitneyu(a, b, alternative="two-sided")
                except ValueError:
                    np_p = float("nan")
                hi = summary[0]["level"] if a.mean() >= b.mean() else summary[1]["level"]
                res = _result(
                    family="group_difference", kind="welch_t", vars=[num, cat], n=n,
                    statistic=float(t_stat), p_raw=float(p),
                    effect_name="cohen_d", effect_value=float(d), direction="none",
                    assumptions=[
                        _assumption("equal variances (Levene)", not (np.isfinite(lev_p) and lev_p < 0.05),
                                    f"Levene p = {lev_p:.3g}" if np.isfinite(lev_p) else "not computed"),
                        _assumption("group normality (Shapiro)", not (np.isfinite(norm_min) and norm_min < 0.05),
                                    f"min Shapiro p = {norm_min:.3g}" if np.isfinite(norm_min) else "n too small",
                                    critical=small_n),
                    ],
                    nonparametric_agrees=bool(np.isfinite(np_p) and (p < 0.05) == (np_p < 0.05)),
                    extra={"groups": summary, "levene_p": lev_p, "shapiro_min_p": norm_min,
                           "mannwhitney_p": float(np_p), "higher_group": hi, "test": "Welch t-test"},
                )
            else:
                f_stat, p = stats.f_oneway(*samples)
                ss_between = sum(len(s) * (s.mean() - grand.mean()) ** 2 for s in samples)
                ss_total = float(((grand - grand.mean()) ** 2).sum())
                eta = float(ss_between / ss_total) if ss_total > 0 else 0.0
                try:
                    _, np_p = stats.kruskal(*samples)
                except ValueError:
                    np_p = float("nan")
                hi = max(summary, key=lambda g: g["mean"])["level"]
                res = _result(
                    family="group_difference", kind="anova", vars=[num, cat], n=n,
                    statistic=float(f_stat), p_raw=float(p),
                    effect_name="eta_sq", effect_value=eta, direction="none",
                    assumptions=[
                        _assumption("equal variances (Levene)", not (np.isfinite(lev_p) and lev_p < 0.05),
                                    f"Levene p = {lev_p:.3g}" if np.isfinite(lev_p) else "not computed"),
                        _assumption("group normality (Shapiro)", not (np.isfinite(norm_min) and norm_min < 0.05),
                                    f"min Shapiro p = {norm_min:.3g}" if np.isfinite(norm_min) else "n too small",
                                    critical=small_n),
                    ],
                    nonparametric_agrees=bool(np.isfinite(np_p) and (p < 0.05) == (np_p < 0.05)),
                    extra={"groups": summary, "levene_p": lev_p, "shapiro_min_p": norm_min,
                           "kruskal_p": float(np_p), "higher_group": hi, "test": "one-way ANOVA"},
                )
            out.append(res)
    return out


# --------------------------------------------------------------------------- #
# contingency (categorical x categorical)
# --------------------------------------------------------------------------- #
def _cramers_v(chi2: float, table: np.ndarray) -> float:
    n = table.sum()
    if n == 0:
        return 0.0
    r, k = table.shape
    phi2 = chi2 / n
    phi2corr = max(0.0, phi2 - (k - 1) * (r - 1) / (n - 1))
    rcorr = r - (r - 1) ** 2 / (n - 1)
    kcorr = k - (k - 1) ** 2 / (n - 1)
    denom = min(kcorr - 1, rcorr - 1)
    if denom <= 0:
        return 0.0
    return float(np.sqrt(phi2corr / denom))


def contingency(df: pd.DataFrame, categorical_cols: list[str]) -> list[dict]:
    out = []
    for a, b in itertools.combinations(categorical_cols, 2):
        sub = df[[a, b]].dropna()
        if sub.empty:
            continue
        table = pd.crosstab(sub[a].astype(str), sub[b].astype(str))
        if table.shape[0] < 2 or table.shape[1] < 2:
            continue
        n = int(table.to_numpy().sum())
        if n < MIN_N:
            continue
        chi2, p, dof, expected = stats.chi2_contingency(table)
        low_expected = bool((expected < 5).any())
        kind = "chi_square"
        if table.shape == (2, 2) and low_expected:
            try:
                _, p = stats.fisher_exact(table.to_numpy())
                kind = "fisher_exact"
            except ValueError:
                pass
        v = _cramers_v(chi2, table.to_numpy())
        out.append(_result(
            family="contingency", kind=kind, vars=[a, b], n=n,
            statistic=float(chi2), p_raw=float(p),
            effect_name="cramers_v", effect_value=v, direction="none",
            assumptions=[_assumption(
                "expected cell counts >= 5", not low_expected,
                f"{int((expected < 5).sum())} cell(s) below 5", critical=low_expected,
            )],
            extra={"chi2": float(chi2), "dof": int(dof), "min_expected": float(expected.min()),
                   "low_expected_cells": int((expected < 5).sum()),
                   "table": {str(k2): {str(k3): int(v3) for k3, v3 in row.items()}
                             for k2, row in table.to_dict("index").items()}},
        ))
    return out


# --------------------------------------------------------------------------- #
# regression (every numeric column as an outcome)
# --------------------------------------------------------------------------- #
def _design(df: pd.DataFrame, outcome: str, predictors: list[str], profiles_by_name: dict):
    y = pd.to_numeric(df[outcome], errors="coerce")
    parts = []
    for col in predictors:
        if profiles_by_name[col]["type"] == "numeric":
            parts.append(pd.to_numeric(df[col], errors="coerce").rename(col))
        else:
            dummies = pd.get_dummies(df[col].astype(str), prefix=col, prefix_sep="=", drop_first=True, dtype=float)
            parts.append(dummies)
    X = pd.concat(parts, axis=1) if parts else pd.DataFrame(index=df.index)
    frame = pd.concat([y.rename("__y__"), X], axis=1).dropna()
    return frame["__y__"], frame.drop(columns="__y__")


def regressions(df: pd.DataFrame, numeric_cols: list[str], categorical_cols: list[str],
                profiles_by_name: dict, n_total: int):
    models, coefs = [], []
    for outcome in numeric_cols:
        predictors = [c for c in numeric_cols if c != outcome] + categorical_cols
        if not predictors:
            continue
        y, X = _design(df, outcome, predictors, profiles_by_name)
        n, p_eff = len(y), X.shape[1]
        note = None

        # Reduce predictors when data is too thin for a stable fit.
        if p_eff > 0 and n < 5 * p_eff:
            num_preds = [c for c in numeric_cols if c != outcome]
            if num_preds:
                corr = {c: abs(df[[outcome, c]].dropna().corr().iloc[0, 1]) for c in num_preds}
                corr = {c: v for c, v in corr.items() if np.isfinite(v)}
                k = max(1, min(len(corr), n // 5 - 1))
                keep = sorted(corr, key=corr.get, reverse=True)[:k]
                y, X = _design(df, outcome, keep, profiles_by_name)
                n, p_eff = len(y), X.shape[1]
                note = f"predictors reduced to the {len(keep)} most correlated for a stable fit"

        if n < MIN_N or p_eff == 0 or n <= p_eff + 1:
            models.append(_result(
                family="regression_model", kind="insufficient", vars=[outcome], n=n,
                statistic=float("nan"), p_raw=float("nan"),
                effect_name="adj_r2", effect_value=float("nan"), direction="none",
                extra={"note": note or "not enough complete rows to model this outcome"},
            ))
            continue

        Xc = sm.add_constant(X, has_constant="add")
        try:
            fit = sm.OLS(y.astype(float), Xc.astype(float)).fit(cov_type="HC3")
        except Exception as e:  # pragma: no cover - defensive
            models.append(_result(
                family="regression_model", kind="failed", vars=[outcome], n=n,
                statistic=float("nan"), p_raw=float("nan"),
                effect_name="adj_r2", effect_value=float("nan"), direction="none",
                extra={"note": f"model fit failed: {e}"},
            ))
            continue

        resid = fit.resid
        try:
            bp_p = float(het_breuschpagan(resid, Xc)[1])
        except Exception:
            bp_p = float("nan")
        shap_p = float(stats.shapiro(resid).pvalue) if 3 <= len(resid) <= 5000 else float("nan")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                cooks_max = float(np.nanmax(fit.get_influence().cooks_distance[0]))
        except Exception:
            cooks_max = float("nan")
        vif_max = float("nan")
        if X.shape[1] >= 2:
            vals = []
            arr = X.to_numpy(float)
            for i in range(X.shape[1]):
                try:
                    vals.append(variance_inflation_factor(arr, i))
                except Exception:
                    pass
            vif_max = float(np.nanmax(vals)) if vals else float("nan")

        n_drop_frac = 1 - n / n_total if n_total else 0.0
        adj_r2 = float(fit.rsquared_adj)
        collinear = bool(np.isfinite(vif_max) and vif_max > 10)
        heterosked = bool(np.isfinite(bp_p) and bp_p < 0.05)
        models.append(_result(
            family="regression_model", kind="ols", vars=[outcome], n=n,
            statistic=float(fit.fvalue), p_raw=float(fit.f_pvalue),
            effect_name="adj_r2", effect_value=adj_r2, direction="none",
            assumptions=[
                _assumption("homoskedastic residuals (Breusch–Pagan)", not heterosked,
                            f"BP p = {bp_p:.3g}" if np.isfinite(bp_p) else "not computed", critical=True),
                _assumption("normal residuals (Shapiro)", not (np.isfinite(shap_p) and shap_p < 0.05),
                            f"Shapiro p = {shap_p:.3g}" if np.isfinite(shap_p) else "n out of range"),
                _assumption("no severe multicollinearity", not collinear,
                            f"max VIF = {vif_max:.1f}" if np.isfinite(vif_max) else "n/a",
                            critical=bool(np.isfinite(vif_max) and vif_max > 100)),
                _assumption("no dominant influential point", not (np.isfinite(cooks_max) and cooks_max > 4 / n),
                            f"max Cook's D = {cooks_max:.3g}" if np.isfinite(cooks_max) else "n/a",
                            critical=bool(np.isfinite(cooks_max) and cooks_max > 1.0)),
                _assumption("not a near-perfect fit", adj_r2 < 0.999,
                            f"adjusted R² = {adj_r2:.4f} — check for redundant or derived columns",
                            critical=adj_r2 >= 0.9999),
            ],
            extra={"r2": float(fit.rsquared), "adj_r2": adj_r2,
                   "f": float(fit.fvalue), "f_p": float(fit.f_pvalue),
                   "bp_p": bp_p, "shapiro_resid_p": shap_p, "cooks_max": cooks_max,
                   "vif_max": vif_max, "n_predictors": int(p_eff),
                   "n_drop_frac": float(n_drop_frac), "note": note},
        ))

        y_std = y.std(ddof=1)
        for term in fit.params.index:
            if term == "const":
                continue
            est = float(fit.params[term])
            x_std = X[term].std(ddof=1) if term in X.columns else np.nan
            std_beta = float(est * x_std / y_std) if y_std and np.isfinite(x_std) else float("nan")
            ci = fit.conf_int().loc[term]
            unstable = bool(np.isfinite(std_beta) and abs(std_beta) > 1.5)
            coefs.append(_result(
                family="regression_coefficient", kind="coef", vars=[outcome, term], n=n,
                statistic=float(fit.tvalues[term]), p_raw=float(fit.pvalues[term]),
                effect_name="std_beta", effect_value=std_beta,
                direction="positive" if est > 0 else "negative" if est < 0 else "none",
                assumptions=[
                    _assumption("model coefficients are identifiable (no severe multicollinearity)",
                                not collinear, f"model max VIF = {vif_max:.1f}" if np.isfinite(vif_max) else "n/a",
                                critical=collinear),
                    _assumption("homoskedastic residuals", not heterosked,
                                f"model BP p = {bp_p:.3g}" if np.isfinite(bp_p) else "not computed"),
                    _assumption("coefficient in a plausible range", not unstable,
                                f"standardised β = {std_beta:.2f}" if np.isfinite(std_beta) else "n/a",
                                critical=unstable),
                ],
                extra={"estimate": est, "std_error": float(fit.bse[term]),
                       "ci_low": float(ci[0]), "ci_high": float(ci[1]), "outcome": outcome,
                       "model_adj_r2": adj_r2, "model_vif_max": vif_max},
            ))
    return models, coefs


def run_sweep(df: pd.DataFrame, numeric_cols: list[str], categorical_cols: list[str],
              profiles_by_name: dict, n_total: int) -> dict:
    models, coefs = regressions(df, numeric_cols, categorical_cols, profiles_by_name, n_total)
    return {
        "correlation": correlations(df, numeric_cols, profiles_by_name),
        "group_difference": group_differences(df, numeric_cols, categorical_cols),
        "contingency": contingency(df, categorical_cols),
        "regression_model": models,
        "regression_coefficient": coefs,
    }
