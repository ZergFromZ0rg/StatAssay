import numpy as np
import pandas as pd
import pytest


def _raw(df: pd.DataFrame) -> pd.DataFrame:
    """String view of a frame, matching how main.py reads the upload twice."""
    return df.astype(object).where(df.notna(), "").astype(str)


@pytest.fixture
def rng():
    return np.random.default_rng(20260902)


@pytest.fixture
def linear_df(rng):
    """y is a strong linear function of x1; x2 is noise."""
    n = 200
    x1 = rng.normal(0, 1, n)
    x2 = rng.normal(0, 1, n)
    y = 2.0 * x1 + rng.normal(0, 1.0, n)
    return pd.DataFrame({"x1": x1, "x2": x2, "y": y})


@pytest.fixture
def group_df(rng):
    """score is ~1 SD higher in group B than group A."""
    n = 150
    grp = rng.choice(["A", "B"], n)
    score = np.where(grp == "B", 1.0, 0.0) + rng.normal(0, 1.0, n)
    noise_grp = rng.choice(["x", "y", "z"], n)
    return pd.DataFrame({"group": grp, "score": score, "noise_group": noise_grp})


@pytest.fixture
def assoc_df(rng):
    """color and shape are strongly associated; size is independent."""
    n = 300
    color = rng.choice(["red", "blue"], n, p=[0.5, 0.5])
    shape = np.where(
        color == "red",
        rng.choice(["circle", "square"], n, p=[0.85, 0.15]),
        rng.choice(["circle", "square"], n, p=[0.15, 0.85]),
    )
    size = rng.choice(["S", "M", "L"], n)
    return pd.DataFrame({"color": color, "shape": shape, "size": size})


@pytest.fixture
def noise_df(rng):
    """Ten independent standard-normal columns — nothing should be noteworthy."""
    n = 120
    return pd.DataFrame({f"v{i}": rng.normal(0, 1, n) for i in range(10)})


@pytest.fixture
def messy_df():
    """Missing values, a duplicate row, a constant column, an ID column,
    a string-numeric column, and an extreme outlier."""
    base = pd.DataFrame({
        "user_id": range(1, 41),
        "region": (["north", "south"] * 20),
        "constant": ["same"] * 40,
        "amount": [f"{v:.2f}" for v in np.linspace(10, 50, 40)],
        "value": list(np.linspace(1, 40, 40)),
    })
    base.loc[5, "value"] = np.nan
    base.loc[7, "value"] = np.nan
    base.loc[10, "region"] = np.nan
    base.loc[39, "value"] = 100000.0  # extreme outlier
    base = pd.concat([base, base.iloc[[0]]], ignore_index=True)  # duplicate row
    return base


@pytest.fixture
def raw_view():
    return _raw
