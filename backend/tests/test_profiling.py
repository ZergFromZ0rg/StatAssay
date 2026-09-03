from inference.profiling import looks_like_id_name, profile_columns, scan_quality


def _by_name(profiles):
    return {p["name"]: p for p in profiles}


def test_id_name_detection():
    assert looks_like_id_name("user_id")
    assert looks_like_id_name("UserID")
    assert looks_like_id_name("account number")
    assert not looks_like_id_name("valid")
    assert not looks_like_id_name("score")


def test_types_on_messy_frame(messy_df, raw_view):
    profiles = profile_columns(messy_df, raw_view(messy_df))
    p = _by_name(profiles)

    assert p["user_id"]["type"] == "excluded"
    assert p["user_id"]["exclude_reason"] == "id-like"
    assert p["constant"]["type"] == "excluded"
    assert p["constant"]["exclude_reason"] == "constant"
    assert p["region"]["type"] == "categorical"
    assert p["value"]["type"] == "numeric"
    assert p["amount"]["type"] == "numeric"
    assert p["amount"]["coerced_from_text"] is True


def test_quality_issues_on_messy_frame(messy_df, raw_view):
    profiles = profile_columns(messy_df, raw_view(messy_df))
    score, issues = scan_quality(messy_df, profiles)
    kinds = {i["kind"] for i in issues}

    assert "missing_column" in kinds
    assert "duplicate_rows" in kinds
    assert "constant_column" in kinds
    assert "coerced_type" in kinds
    assert "extreme_values" in kinds
    assert 0 <= score <= 100
    assert score < 100


def test_quality_issues_carry_row_locations(messy_df, raw_view):
    profiles = profile_columns(messy_df, raw_view(messy_df))
    _, issues = scan_quality(messy_df, profiles)
    by_kind = {i["kind"]: i for i in issues}

    # messy_df: value has an outlier of 100000 at position 39 (row 40)
    extreme = by_kind["extreme_values"]
    loc = extreme["detail"]["locations"][0]
    assert loc["row"] == 40
    assert loc["value"] == 100000.0
    assert loc["id"] == str(messy_df["user_id"].iloc[39])  # id-column value, not the row number

    # value is missing at positions 5 and 7 (rows 6 and 8)
    miss = next(i for i in issues if i["kind"] == "missing_column" and i["column"] == "value")
    assert {loc["row"] for loc in miss["detail"]["locations"]} == {6, 8}

    # the stats payload does not leak the raw outlier positions
    vstats = _by_name(profiles)["value"]["stats"]
    assert "outlier_pos_5iqr" not in vstats


def test_continuous_all_unique_column_is_kept(linear_df, raw_view):
    profiles = profile_columns(linear_df, raw_view(linear_df))
    # every y value is unique but it is genuine continuous data, not an id
    assert _by_name(profiles)["y"]["type"] == "numeric"
