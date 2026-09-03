import pytest

from inference.report import run_inference


def _headlines(report):
    return " || ".join(f["headline"] for f in report["findings"])


def test_recovers_linear_relationship(linear_df, raw_view):
    rep = run_inference(linear_df, raw_view(linear_df), "linear.csv")
    corr = [r for r in rep["all_results"]["correlations"] if set(r["vars"]) == {"x1", "y"}][0]
    assert corr["effect_value"] > 0.7
    assert corr["q_value"] < 0.01
    # x2 is noise — no strong x2~y correlation
    x2y = [r for r in rep["all_results"]["correlations"] if set(r["vars"]) == {"x2", "y"}][0]
    assert x2y["effect_magnitude"] in ("none", "small")
    assert any("x1" in f["vars"] and "y" in f["vars"] for f in rep["findings"])


def test_regression_finding_carries_residual_and_influence_plots(linear_df, raw_view):
    rep = run_inference(linear_df, raw_view(linear_df), "linear.csv")
    entries = rep["findings"] + rep["needs_review"]
    model = next(e for e in entries if e["family"] == "regression_model" and e["vars"] == ["y"])
    by_type = {c["type"]: c for c in model["charts"]}

    resid = by_type["residual"]
    assert resid["outcome"] == "y"
    assert len(resid["points"]) == resid["n"] == 200
    assert all(len(p) == 2 for p in resid["points"])

    inf = by_type["influence"]
    assert inf["n"] == 200 and inf["threshold"] == pytest.approx(4 / 200)
    assert all(0 <= p[0] < 200 and p[1] >= 0 for p in inf["points"])

    # neither large payload is duplicated back into the results table
    rm = [r for r in rep["all_results"]["regression_models"] if r["vars"] == ["y"]][0]
    assert "resid_plot" not in rm["extra"] and "influence_plot" not in rm["extra"]


def test_coefficient_finding_carries_an_added_variable_plot(linear_df, raw_view):
    rep = run_inference(linear_df, raw_view(linear_df), "linear.csv")
    entries = rep["findings"] + rep["needs_review"]
    coef = next(e for e in entries
                if e["family"] == "regression_coefficient" and e["vars"] == ["y", "x1"])
    avp = next(c for c in coef["charts"] if c["type"] == "added_variable")
    assert avp["term"] == "x1" and avp["outcome"] == "y"
    assert avp["slope"] == pytest.approx(2.0, abs=0.3)  # y = 2*x1 + noise
    rc = [r for r in rep["all_results"]["regression_coefficients"] if r["vars"] == ["y", "x1"]][0]
    assert "avp_plot" not in rc["extra"]


def test_recovers_group_difference(group_df, raw_view):
    rep = run_inference(group_df, raw_view(group_df), "group.csv")
    gd = [r for r in rep["all_results"]["group_differences"] if r["vars"] == ["score", "group"]][0]
    assert gd["q_value"] < 0.01
    assert abs(gd["effect_value"]) >= 0.5
    # the noise grouping should not be a finding
    assert not any(f["vars"] == ["score", "noise_group"] for f in rep["findings"])


def test_recovers_categorical_association(assoc_df, raw_view):
    rep = run_inference(assoc_df, raw_view(assoc_df), "assoc.csv")
    ct = [r for r in rep["all_results"]["contingency"] if set(r["vars"]) == {"color", "shape"}][0]
    assert ct["q_value"] < 0.01
    assert ct["effect_value"] >= 0.3
    assert any(set(f["vars"]) == {"color", "shape"} for f in rep["findings"])


def test_noise_frame_has_no_findings(noise_df, raw_view):
    rep = run_inference(noise_df, raw_view(noise_df), "noise.csv")
    assert rep["findings"] == []
    assert rep["needs_review"] == []


def test_report_is_json_safe(messy_df, raw_view):
    import json
    rep = run_inference(messy_df, raw_view(messy_df), "messy.csv")
    json.dumps(rep)  # raises if NaN / numpy types leaked through
    assert "report_markdown" in rep and rep["report_markdown"]
