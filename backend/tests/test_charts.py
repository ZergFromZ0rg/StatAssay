import numpy as np
import pandas as pd

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


def test_box_stats_quartile_order():
    b = charts.box_stats(np.array([1.0, 2, 3, 4, 5, 6, 7, 8, 9, 100]))
    assert b["min"] <= b["q1"] <= b["median"] <= b["q3"] <= b["max"]
    assert 100.0 in b["outliers"]


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
