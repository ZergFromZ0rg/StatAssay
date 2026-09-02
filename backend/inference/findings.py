"""FDR correction, the noteworthiness gate, ranking, and plain-language headlines."""

import numpy as np
from statsmodels.stats.multitest import multipletests

Q_THRESHOLD = 0.05
FDR_FAMILIES = ["correlation", "group_difference", "contingency", "regression_model", "regression_coefficient"]

_LARGE_CUT = {
    "r": 0.5, "spearman_rho": 0.5, "std_beta": 0.5, "cohen_d": 0.8,
    "eta_sq": 0.14, "cramers_v": 0.5, "adj_r2": 0.5,
}


def apply_fdr(sweep: dict) -> None:
    """Attach a Benjamini–Hochberg ``q_value`` to every result, within each family."""
    for family in FDR_FAMILIES:
        rows = sweep.get(family, [])
        idx = [i for i, r in enumerate(rows) if r["p_raw"] is not None and np.isfinite(r["p_raw"])]
        if not idx:
            for r in rows:
                r["q_value"] = None
            continue
        pvals = [rows[i]["p_raw"] for i in idx]
        q = multipletests(pvals, method="fdr_bh")[1]
        for i, qv in zip(idx, q):
            rows[i]["q_value"] = float(qv)
        for i, r in enumerate(rows):
            if i not in idx:
                r["q_value"] = None


def _is_candidate(r: dict) -> bool:
    q = r.get("q_value")
    return q is not None and q < Q_THRESHOLD and r["effect_magnitude"] in ("medium", "large")


def _rank_key(r: dict) -> float:
    cut = _LARGE_CUT[r["effect_name"]]
    if not cut or r["effect_value"] is None or not np.isfinite(r["effect_value"]):
        return 0.0
    return min(abs(r["effect_value"]) / cut, 1.5)


def _match(target: dict, pool: list[dict]):
    tv = tuple(target["vars"])
    for r in pool:
        if r["kind"] == target["kind"] and tuple(r["vars"]) == tv:
            return r
    return None


def _headline(r: dict) -> str:
    e = r["extra"]
    fam = r["family"]
    if fam == "correlation":
        a, b = r["vars"]
        strength = {"medium": "moderate", "large": "strong"}[r["effect_magnitude"]]
        return (f"{a} and {b} move {r['direction']}ly together "
                f"({r['effect_name'].replace('spearman_rho', 'ρ').replace('r', 'r')} = {r['effect_value']:.2f}, "
                f"{strength}, n = {r['n']}).")
    if fam == "group_difference":
        num, cat = r["vars"]
        eff = f"Cohen's d = {r['effect_value']:.2f}" if r["effect_name"] == "cohen_d" else f"η² = {r['effect_value']:.2f}"
        return (f"{num} differs across {cat} ({e.get('test', 'test')}, {eff}, n = {r['n']}); "
                f"highest in \"{e.get('higher_group', '?')}\".")
    if fam == "contingency":
        a, b = r["vars"]
        return f"{a} and {b} are associated (Cramér's V = {r['effect_value']:.2f}, n = {r['n']})."
    if fam == "regression_model":
        return (f"A model of {r['vars'][0]} from the other variables explains "
                f"{e.get('adj_r2', 0) * 100:.0f}% of its variance (adjusted R², n = {r['n']}).")
    if fam == "regression_coefficient":
        outcome, term = r["vars"]
        return (f"{term} independently predicts {outcome} "
                f"(standardised β = {r['effect_value']:.2f}, {r['direction']}, n = {r['n']}).")
    return f"{' / '.join(r['vars'])}"


def _caveats(r: dict, n_total: int, robustness: str) -> list[str]:
    out = []
    for a in r.get("assumptions", []):
        if not a["ok"]:
            out.append(f"Assumption not met — {a['name']} ({a['detail']}).")
    if r.get("nonparametric_agrees") is False:
        out.append("A rank-based (non-parametric) test disagrees on significance.")
    if n_total and r["n"] < 0.8 * n_total:
        out.append(f"Only {r['n']} of {n_total} rows had complete data for this test.")
    if robustness == "imputation-sensitive":
        out.append("This finding changes when missing values are imputed instead of dropped.")
    note = r.get("extra", {}).get("note")
    if note:
        out.append(note)
    out.append("Exploratory and associational — not evidence of causation.")
    return out


def build_findings(primary: dict, imputed: dict | None, n_total: int) -> tuple[list[dict], list[dict]]:
    findings, needs_review = [], []
    rank_counter = 0

    candidates = []
    for family in FDR_FAMILIES:
        for r in primary.get(family, []):
            if _is_candidate(r):
                candidates.append(r)
    candidates.sort(key=_rank_key, reverse=True)

    for r in candidates:
        robustness = "not-assessed"
        if imputed is not None:
            twin = _match(r, imputed.get(r["family"], []))
            if twin is None:
                robustness = "imputation-sensitive"
            elif _is_candidate(twin) and twin["direction"] == r["direction"]:
                robustness = "stable"
            else:
                robustness = "imputation-sensitive"
        else:
            robustness = "stable"

        critical_fail = any(not a["ok"] and a.get("critical") for a in r.get("assumptions", []))
        entry = {
            "family": r["family"],
            "kind": r["kind"],
            "vars": r["vars"],
            "headline": _headline(r),
            "effect_name": r["effect_name"],
            "effect_value": r["effect_value"],
            "effect_magnitude": r["effect_magnitude"],
            "direction": r["direction"],
            "q_value": r["q_value"],
            "p_raw": r["p_raw"],
            "n": r["n"],
            "robustness": robustness,
            "caveats": _caveats(r, n_total, robustness),
            "stats": r["extra"],
        }
        if critical_fail:
            needs_review.append(entry)
        else:
            rank_counter += 1
            entry["rank"] = rank_counter
            findings.append(entry)

    return findings, needs_review


def imputation_sensitivity(primary: dict, imputed: dict | None) -> dict:
    if imputed is None:
        return {"applicable": False, "changed_count": 0, "details": []}
    details = []
    for family in FDR_FAMILIES:
        for r in primary.get(family, []):
            if not _is_candidate(r):
                continue
            twin = _match(r, imputed.get(family, []))
            stable = twin is not None and _is_candidate(twin) and twin["direction"] == r["direction"]
            if not stable:
                details.append({
                    "vars": r["vars"],
                    "family": family,
                    "complete_case": {"q": r["q_value"], "effect": r["effect_value"]},
                    "imputed": None if twin is None else {"q": twin.get("q_value"), "effect": twin["effect_value"]},
                })
    return {"applicable": True, "changed_count": len(details), "details": details}


def count_tests(sweep: dict) -> dict:
    return {
        "correlations": len(sweep.get("correlation", [])),
        "group_differences": len(sweep.get("group_difference", [])),
        "contingency": len(sweep.get("contingency", [])),
        "regression_models": len(sweep.get("regression_model", [])),
        "regression_coefficients": len(sweep.get("regression_coefficient", [])),
    }
