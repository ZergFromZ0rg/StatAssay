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
