import numpy as np

from inference import findings as f
from inference.sweep import magnitude


def test_magnitude_buckets():
    assert magnitude("r", 0.05) == "none"
    assert magnitude("r", 0.2) == "small"
    assert magnitude("r", 0.4) == "medium"
    assert magnitude("r", 0.8) == "large"
    assert magnitude("cohen_d", 0.6) == "medium"
    assert magnitude("r", float("nan")) == "none"


def test_fdr_is_monotone_and_ge_p():
    sweep = {
        "correlation": [
            {"p_raw": p, "effect_magnitude": "large", "effect_name": "r", "effect_value": 0.6}
            for p in [0.001, 0.01, 0.02, 0.2, 0.5]
        ],
        "group_difference": [], "contingency": [],
        "regression_model": [], "regression_coefficient": [],
    }
    f.apply_fdr(sweep)
    qs = [r["q_value"] for r in sweep["correlation"]]
    assert all(q >= p for q, p in zip(qs, [0.001, 0.01, 0.02, 0.2, 0.5]))
    assert qs == sorted(qs)


def test_candidate_gate_requires_both_q_and_effect():
    assert f._is_candidate({"q_value": 0.01, "effect_magnitude": "large"})
    assert not f._is_candidate({"q_value": 0.2, "effect_magnitude": "large"})
    assert not f._is_candidate({"q_value": 0.01, "effect_magnitude": "small"})
    assert not f._is_candidate({"q_value": None, "effect_magnitude": "large"})


def test_critical_assumption_routes_to_needs_review():
    base = {
        "family": "contingency", "kind": "chi_square", "vars": ["a", "b"], "n": 40,
        "statistic": 9.0, "p_raw": 0.001, "q_value": 0.001,
        "effect_name": "cramers_v", "effect_value": 0.5, "effect_magnitude": "large",
        "direction": "none", "nonparametric_agrees": None, "extra": {},
        "assumptions": [{"name": "expected cell counts >= 5", "ok": False, "detail": "", "critical": True}],
    }
    primary = {"contingency": [base], "correlation": [], "group_difference": [],
               "regression_model": [], "regression_coefficient": []}
    findings, needs_review = f.build_findings(primary, None, n_total=40)
    assert findings == []
    assert len(needs_review) == 1


def test_ranking_orders_by_effect_size():
    def mk(vals, eff):
        return {
            "family": "correlation", "kind": "pearson", "vars": vals, "n": 100,
            "statistic": eff, "p_raw": 0.001, "q_value": 0.001,
            "effect_name": "r", "effect_value": eff, "effect_magnitude": "large" if eff >= 0.5 else "medium",
            "direction": "positive", "nonparametric_agrees": True, "extra": {}, "assumptions": [],
        }
    primary = {
        "correlation": [mk(["a", "b"], 0.35), mk(["c", "d"], 0.9), mk(["e", "g"], 0.55)],
        "group_difference": [], "contingency": [], "regression_model": [], "regression_coefficient": [],
    }
    findings, _ = f.build_findings(primary, None, n_total=100)
    assert [fd["vars"] for fd in findings] == [["c", "d"], ["e", "g"], ["a", "b"]]
    assert [fd["rank"] for fd in findings] == [1, 2, 3]
