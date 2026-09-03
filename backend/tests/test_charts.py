import numpy as np
import pandas as pd
import pytest

from inference import charts


def test_histogram_counts_sum_to_n():
    s = pd.Series(np.arange(100.0))
    h = charts.histogram(s)
    assert h["n"] == 100
    assert sum(h["counts"]) + h["n_below"] + h["n_above"] == 100
    assert h["bin_edges"] == sorted(h["bin_edges"])
    assert len(h["bin_edges"]) == len(h["counts"]) + 1


def test_histogram_bins_over_robust_range_when_outlier_present():
    s = pd.Series(list(np.arange(50.0)) + [10_000.0])
    h = charts.histogram(s)
    assert h["n_above"] == 1
    assert h["bin_edges"][-1] < 1000  # the outlier did not stretch the axis


def test_sparkline_maps_counts_to_blocks():
    s = charts.sparkline([0, 5, 10])
    assert s[0] == "▁" and s[-1] == "█" and len(s) == 3
    assert charts.sparkline([]) == ""
    assert charts.sparkline([0, 0, 0]) == "▁▁▁"
    assert len(charts.sparkline([1, 2, 3, 4, 5])) == 5


def test_histogram_too_small_returns_none():
    assert charts.histogram(pd.Series([1.0, 2.0, 3.0])) is None


def test_histogram_constant_column():
    h = charts.histogram(pd.Series([7.0] * 20))
    assert h["counts"] == [20]


def test_scatter_respects_cap_and_fits_a_line(rng):
    x = rng.normal(0, 1, 500)
    y = 3 * x + rng.normal(0, 0.1, 500)
    s = charts.scatter_series(pd.Series(x), pd.Series(y), cap=120)
    assert s["n"] == 500
    assert s["sampled"] is True
    assert len(s["points"]) == 120
    # slope recovered from the two endpoints
    slope = (s["trend"]["y1"] - s["trend"]["y0"]) / (s["trend"]["x1"] - s["trend"]["x0"])
    assert abs(slope - 3) < 0.2


def test_scatter_small_series_not_sampled():
    s = charts.scatter_series(pd.Series([1.0, 2, 3, 4]), pd.Series([2.0, 4, 6, 8]))
    assert s["sampled"] is False
    assert len(s["points"]) == 4


def test_scatter_deterministic(rng):
    x = pd.Series(rng.normal(0, 1, 400))
    y = pd.Series(rng.normal(0, 1, 400))
    a = charts.scatter_series(x, y)
    b = charts.scatter_series(x, y)
    assert a["points"] == b["points"]


def test_residual_series_shape_and_subsampling(rng):
    fitted = rng.normal(0, 1, 500)
    resid = rng.normal(0, 1, 500)
    s = charts.residual_series(fitted, resid, cap=150)
    assert s["n"] == 500
    assert s["sampled"] is True
    assert len(s["points"]) == 150
    assert len(s["fitted_lim"]) == 2 and s["resid_lim"][0] < s["resid_lim"][1]


def test_residual_series_drops_non_finite():
    s = charts.residual_series([1.0, 2.0, np.nan, 4.0, 5.0], [0.1, np.inf, 0.3, -0.2, 0.05])
    assert s["n"] == 3


def test_residual_series_too_small():
    assert charts.residual_series([1.0, 2.0], [0.1, 0.2]) is None


def test_added_variable_series_slope_matches_coefficient(rng):
    n = 300
    x1 = rng.normal(0, 1, n)
    x2 = rng.normal(0, 1, n)
    y = 2.0 * x1 - 1.0 * x2 + rng.normal(0, 0.4, n)
    X = pd.DataFrame({"x1": x1, "x2": x2})
    s = charts.added_variable_series(y, X, "x1")
    assert s["n"] == n
    assert s["slope"] == pytest.approx(2.0, abs=0.15)
    # residualised x is centred at zero
    assert abs(np.mean([p[0] for p in s["points"]])) < 0.2


def test_added_variable_series_unknown_term():
    assert charts.added_variable_series([1.0, 2, 3], pd.DataFrame({"a": [1.0, 2, 3]}), "z") is None


def test_box_stats_quartile_order():
    b = charts.box_stats(np.array([1.0, 2, 3, 4, 5, 6, 7, 8, 9, 100]))
    assert b["min"] <= b["q1"] <= b["median"] <= b["q3"] <= b["max"]
    assert 100.0 in b["outliers"]
    assert b["whisker_hi"] <= b["q3"] + 1.5 * (b["q3"] - b["q1"]) + 1e-9


def test_influence_series_keeps_the_spike(rng):
    cooks = np.abs(rng.normal(0, 0.001, 800))
    cooks[400] = 5.0  # a dominant point
    s = charts.influence_series(cooks, cap=200)
    assert s["n"] == 800 and s["sampled"] is True
    assert s["threshold"] == 4 / 800
    assert any(p[0] == 400 and p[1] == 5.0 for p in s["points"])  # spike survives subsampling
    assert s["n_above"] >= 1 and s["max"] == 5.0


def test_influence_series_small_input():
    assert charts.influence_series([0.1, 0.2]) is None
    s = charts.influence_series([0.1, 0.2, 0.3, 0.4, 0.5])
    assert s["sampled"] is False and len(s["points"]) == 5


def test_group_box_series_orders_by_levels():
    df = pd.DataFrame({
        "v": [1.0, 2, 3, 10, 11, 12],
        "g": ["a", "a", "a", "b", "b", "b"],
    })
    out = charts.group_box_series(df, "v", "g", ["b", "a"])
    assert [row["level"] for row in out] == ["b", "a"]
    assert out[0]["median"] == 11.0


def test_contingency_series_shape_and_ordering():
    table = {
        "red": {"circle": 40, "square": 10},
        "blue": {"circle": 5, "square": 45},
        "green": {"circle": 1, "square": 1},
    }
    s = charts.contingency_series(table, "color", "shape")
    # rows by descending total then name: blue(50), red(50), green(2)
    assert s["rows"] == ["blue", "red", "green"]
    # cols by descending total: square(56), circle(46)
    assert s["cols"] == ["square", "circle"]
    assert s["n"] == 102
    for row_share in s["row_shares"]:
        assert abs(sum(row_share) - 1.0) < 1e-9
    ri, ci = s["rows"].index("red"), s["cols"].index("circle")
    assert s["counts"][ri][ci] == 40


def test_contingency_series_caps_levels():
    table = {f"r{i}": {f"c{j}": 1 for j in range(20)} for i in range(20)}
    s = charts.contingency_series(table, "a", "b")
    assert len(s["rows"]) == charts.CONTINGENCY_MAX_LEVELS
    assert len(s["cols"]) == charts.CONTINGENCY_MAX_LEVELS
    assert s["truncated"] is True


def test_contingency_series_empty():
    assert charts.contingency_series({}, "a", "b") is None


def _corr_row(a, b, value, kind="pearson", q=0.01, n=100):
    return {"vars": [a, b], "effect_value": value, "kind": kind, "q_value": q, "n": n}


def test_correlation_matrix_diagonal_and_mirroring():
    cols = ["x", "y", "z"]
    rows = [_corr_row("x", "y", 0.8), _corr_row("y", "z", -0.4)]
    m = charts.correlation_matrix(cols, rows)
    assert m["columns"] == cols
    diag = [c for c in m["cells"] if c["i"] == c["j"]]
    assert len(diag) == 3 and all(c["value"] == 1.0 for c in diag)
    # only the upper triangle is stored
    xy = next(c for c in m["cells"] if (c["i"], c["j"]) == (0, 1))
    assert xy["value"] == 0.8 and xy["kind"] == "pearson"
    assert not any((c["i"], c["j"]) == (1, 0) for c in m["cells"])


def test_correlation_matrix_ignores_unknown_columns():
    m = charts.correlation_matrix(["x", "y"], [_corr_row("x", "gone", 0.9)])
    assert [c for c in m["cells"] if c["i"] != c["j"]] == []


def test_correlation_matrix_needs_two_columns():
    assert charts.correlation_matrix(["only"], []) is None


def test_correlation_matrix_skips_non_finite_values():
    rows = [_corr_row("x", "y", float("nan")), _corr_row("y", "z", None), _corr_row("x", "z", 0.6)]
    m = charts.correlation_matrix(["x", "y", "z"], rows)
    pairs = {(c["i"], c["j"]) for c in m["cells"] if c["i"] != c["j"]}
    assert pairs == {(0, 2)}  # only the finite x–z pair survives; no null cells emitted
    assert all(c["value"] is not None for c in m["cells"])


def test_correlation_matrix_caps_and_flags_truncation():
    cols = [f"c{i}" for i in range(40)]
    m = charts.correlation_matrix(cols, [])
    assert len(m["columns"]) == charts.CORRELATION_MATRIX_MAX
    assert m["truncated"] is True
