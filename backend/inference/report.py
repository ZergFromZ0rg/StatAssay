"""Assemble the full inference report (JSON dict + a Markdown rendering)."""

import datetime as _dt
import math

import numpy as np
import pandas as pd

from . import charts as _charts
from . import findings as _f
from .preprocess import build_frames, select_modeling_columns, split_types
from .profiling import profile_columns, quality_summary, scan_quality
from .sweep import run_sweep

TOOL_VERSION = "2.0.0"

METHODOLOGY = (
    "Every applicable pair of variables was tested automatically across three families: "
    "correlation (numeric–numeric), group differences (numeric–categorical, t-test / ANOVA), "
    "and contingency (categorical–categorical, chi-square / Fisher). Each numeric column was "
    "also modelled by OLS regression on the others (HC3 robust standard errors). Missing values "
    "were handled by pairwise deletion; the sweep was repeated on a median/mode-imputed copy and "
    "findings that change between the two are flagged. p-values are Benjamini–Hochberg FDR-adjusted "
    "within each test family (reported as q). A result is a \"finding\" only if q < 0.05 and the "
    "effect size is at least medium. Results are exploratory and associational — they are hypotheses "
    "to confirm on fresh data, not evidence of causation."
)


def _sanitize(obj):
    """Recursively convert numpy scalars to Python and NaN/inf to None (valid JSON)."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return _sanitize(obj.tolist())
    return obj


def _all_results(sweep: dict) -> dict:
    def dump(rows):
        return sorted(
            (
                {
                    "family": r["family"], "kind": r["kind"], "vars": r["vars"], "n": r["n"],
                    "statistic": r["statistic"], "p_raw": r["p_raw"], "q_value": r.get("q_value"),
                    "effect_name": r["effect_name"], "effect_value": r["effect_value"],
                    "effect_magnitude": r["effect_magnitude"], "direction": r["direction"],
                    "assumptions": r["assumptions"], "nonparametric_agrees": r["nonparametric_agrees"],
                    # resid_plot is a chart payload for the headline findings only —
                    # keep the full results table lean.
                    "extra": {k: v for k, v in r["extra"].items() if k != "resid_plot"},
                }
                for r in rows
            ),
            key=lambda r: (r["q_value"] is None, r["q_value"] if r["q_value"] is not None else 1.0),
        )

    return {
        "correlations": dump(sweep.get("correlation", [])),
        "group_differences": dump(sweep.get("group_difference", [])),
        "contingency": dump(sweep.get("contingency", [])),
        "regression_models": dump(sweep.get("regression_model", [])),
        "regression_coefficients": dump(sweep.get("regression_coefficient", [])),
    }


def _num(v, digits: int = 2) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "—"
    if math.isnan(f) or math.isinf(f):
        return "—"
    return f"{f:.{digits}f}"


def _md_table(header: list[str], rows: list[list]) -> list[str]:
    out = ["| " + " | ".join(str(h) for h in header) + " |",
           "| " + " | ".join("---" for _ in header) + " |"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return out


def _finding_chart_md(chart: dict) -> list[str]:
    """A compact table rendering of a finding's chart, for the Markdown export."""
    if not chart:
        return []
    if chart["type"] == "contingency":
        rows = chart["rows"]
        cols = chart["cols"]
        body = [[rows[i]] + [str(chart["counts"][i][j]) for j in range(len(cols))] + [str(chart["row_totals"][i])]
                for i in range(len(rows))]
        table = _md_table([f"{chart['row_var']} \\ {chart['col_var']}"] + list(cols) + ["total"], body)
        return ["", *table, ""]
    if chart["type"] == "box":
        body = [[g["level"], g["n"], _num(g["median"]), f"{_num(g['q1'])} – {_num(g['q3'])}"]
                for g in chart["groups"]]
        return ["", *_md_table([chart["cat"], "n", f"median {chart['num']}", "IQR"], body), ""]
    return []


def _distributions_md(report: dict) -> list[str]:
    cols = [c for c in report["profile"]["columns"]
            if c["type"] == "numeric" and (c.get("stats") or {}).get("histogram")]
    if not cols:
        return []
    width = max(len(c["name"]) for c in cols)
    lines = ["## Column distributions", "",
             "Each bar is an equal-width histogram over the column's Tukey-fenced range.", "", "```"]
    for c in cols:
        h = c["stats"]["histogram"]
        rng = f"[{_num(h['bin_edges'][0])} … {_num(h['bin_edges'][-1])}]"
        beyond = (h.get("n_below", 0) or 0) + (h.get("n_above", 0) or 0)
        tail = f"  (+{beyond} beyond range)" if beyond else ""
        lines.append(f"{c['name']:<{width}}  {_charts.sparkline(h['counts'])}  {rng}{tail}")
    lines += ["```", ""]
    return lines


def _corr_matrix_md(report: dict) -> list[str]:
    matrix = report["all_results"].get("correlation_matrix")
    if not matrix or len(matrix["columns"]) < 2:
        return []
    cols = matrix["columns"]
    grid = {(c["i"], c["j"]): c["value"] for c in matrix["cells"]}

    def cell(i, j):
        v = grid.get((i, j), grid.get((j, i)))
        return "" if v is None else _num(v)

    body = [[cols[i]] + [cell(i, j) for j in range(len(cols))] for i in range(len(cols))]
    lines = ["## Correlation matrix", "",
             "Pearson / Spearman r between the numeric columns; blank where the pair was not tested.", ""]
    lines += _md_table(["r"] + list(cols), body)
    if matrix.get("truncated"):
        lines.append("")
        lines.append(f"_Showing the first {len(cols)} numeric columns._")
    lines.append("")
    return lines


def _markdown(report: dict) -> str:
    m = report["meta"]
    dq = report["data_quality"]
    lines = [
        f"# StatGuard report — {m['filename']}",
        "",
        f"- Rows: {m['n_rows']}  ·  Columns: {m['n_cols']}",
        f"- Generated: {m['generated_at']}  ·  Tool version: {m['tool_version']}",
        f"- Data-quality score: **{dq['score']}/100** ({dq['summary']})",
        "",
        "## Data quality",
        "",
    ]
    if not dq["issues"]:
        lines.append("No data-quality issues detected.")
    for i in dq["issues"]:
        loc = f" [{i['column']}]" if i.get("column") else ""
        lines.append(f"- **{i['severity'].upper()}**{loc} {i['message']}")
    lines += ["", "## Key findings", ""]
    if not report["findings"]:
        lines.append("No findings cleared the significance + effect-size bar.")
    for f in report["findings"]:
        lines.append(f"### {f['rank']}. {f['headline']}")
        lines.append(f"- q = {f['q_value']:.3g}  ·  effect: {f['effect_name']} = {f['effect_value']:.3f} "
                     f"({f['effect_magnitude']})  ·  robustness: {f['robustness']}")
        for c in f["caveats"]:
            lines.append(f"  - {c}")
        lines += _finding_chart_md(f.get("chart"))
        lines.append("")
    if report["needs_review"]:
        lines += ["## Needs manual review", "",
                  "Significant with a meaningful effect, but a core assumption failed:", ""]
        for f in report["needs_review"]:
            lines.append(f"- {f['headline']} — " + "; ".join(f["caveats"][:2]))
        lines.append("")
    sens = report["imputation_sensitivity"]
    if sens["applicable"]:
        lines += ["## Imputation sensitivity", "",
                  f"{sens['changed_count']} finding(s) change when missing values are imputed rather than dropped.", ""]
    lines += _distributions_md(report)
    lines += _corr_matrix_md(report)
    st = report["sweep"]
    lines += ["## Tests run", "",
              f"- correlations: {st['n_tests']['correlations']}",
              f"- group differences: {st['n_tests']['group_differences']}",
              f"- contingency: {st['n_tests']['contingency']}",
              f"- regression models: {st['n_tests']['regression_models']} "
              f"({st['n_tests']['regression_coefficients']} coefficients)",
              ""]
    if st["excluded_columns"]:
        lines.append(f"- columns excluded by the {st['column_cap']}-column cap: {', '.join(st['excluded_columns'])}")
        lines.append("")
    lines += ["## Methodology", "", METHODOLOGY, ""]
    return "\n".join(lines)


def _attach_charts(entries: list[dict], cc_df: pd.DataFrame) -> None:
    """Give each headline finding a plot-ready series drawn from the complete-case frame."""
    for e in entries:
        chart = None
        if e["family"] == "correlation":
            a, b = e["vars"]
            if a in cc_df.columns and b in cc_df.columns:
                series = _charts.scatter_series(cc_df[a], cc_df[b])
                if series:
                    # A least-squares line only matches a Pearson finding; for a
                    # rank-based (Spearman) one it would misrepresent the statistic.
                    if e.get("kind") != "pearson":
                        series["trend"] = None
                    chart = {"type": "scatter", "x": a, "y": b, "kind": e.get("kind"), **series}
        elif e["family"] == "group_difference":
            num, cat = e["vars"]
            levels = [g["level"] for g in e.get("stats", {}).get("groups", [])]
            boxes = _charts.group_box_series(cc_df, num, cat, levels)
            if boxes:
                chart = {"type": "box", "num": num, "cat": cat, "groups": boxes,
                         "higher_group": e.get("stats", {}).get("higher_group")}
        elif e["family"] == "contingency":
            a, b = e["vars"]
            series = _charts.contingency_series(e.get("stats", {}).get("table", {}), a, b)
            if series:
                chart = {"type": "contingency", **series}
        elif e["family"] == "regression_model":
            rp = e.get("stats", {}).pop("resid_plot", None)
            if rp:
                chart = {"type": "residual", "outcome": e["vars"][0],
                         "bp_p": e.get("stats", {}).get("bp_p"), **rp}
        if chart:
            e["chart"] = chart


def run_inference(df: pd.DataFrame, raw_df: pd.DataFrame, filename: str) -> dict:
    n_rows, n_cols = int(df.shape[0]), int(df.shape[1])

    profiles = profile_columns(df, raw_df)
    profiles_by_name = {p["name"]: p for p in profiles}
    score, issues = scan_quality(df, profiles)

    modeling_cols, capped = select_modeling_columns(profiles, df)
    cc_df, imp_df, has_missing = build_frames(df, profiles, modeling_cols)
    numeric_cols, categorical_cols = split_types(profiles, modeling_cols)

    primary = run_sweep(cc_df, numeric_cols, categorical_cols, profiles_by_name, n_rows)
    imputed = run_sweep(imp_df, numeric_cols, categorical_cols, profiles_by_name, n_rows) if imp_df is not None else None

    _f.apply_fdr(primary)
    if imputed is not None:
        _f.apply_fdr(imputed)

    finding_list, needs_review = _f.build_findings(primary, imputed, n_rows)
    _attach_charts(finding_list, cc_df)
    _attach_charts(needs_review, cc_df)
    sensitivity = _f.imputation_sensitivity(primary, imputed)

    type_counts = {"numeric": 0, "categorical": 0, "datetime": 0, "excluded": 0}
    for p in profiles:
        type_counts[p["type"]] += 1

    report = {
        "meta": {
            "filename": filename,
            "n_rows": n_rows,
            "n_cols": n_cols,
            "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "tool_version": TOOL_VERSION,
        },
        "profile": {
            "columns": [
                {k: p[k] for k in ("name", "type", "exclude_reason", "n_missing", "pct_missing",
                                   "n_unique", "coerced_from_text", "stats")}
                for p in profiles
            ],
            "type_counts": type_counts,
        },
        "data_quality": {"score": score, "summary": quality_summary(issues), "issues": issues},
        "sweep": {
            "n_tests": _f.count_tests(primary),
            "column_cap": 40,
            "column_cap_applied": bool(capped),
            "excluded_columns": capped,
            "missing_data_handling": "pairwise deletion + imputed comparison" if has_missing else "no missing data",
        },
        "findings": finding_list,
        "needs_review": needs_review,
        "imputation_sensitivity": sensitivity,
        "all_results": _all_results(primary),
        "methodology": METHODOLOGY,
    }
    report["all_results"]["correlation_matrix"] = _charts.correlation_matrix(
        numeric_cols, primary.get("correlation", [])
    )
    report["report_markdown"] = _markdown(report)
    return _sanitize(report)
