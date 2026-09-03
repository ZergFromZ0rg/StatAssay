# StatAssay

Point StatAssay at a CSV and it runs the exploratory-statistics pass for you: it profiles
every column, audits data quality, then sweeps every applicable pair of variables for
association — correcting for multiple comparisons and keeping only what is both
statistically and practically notable. Nothing to configure.

Results are **exploratory and associational** — a shortlist of hypotheses to confirm on
fresh data, not evidence of causation.

## What it's for

- **Triage an unfamiliar dataset.** See the shape of a new CSV — what associates with
  what, which columns are trouble — before committing to a modeling approach.
- **QA a dataset someone handed you.** Surface the outliers, non-random missingness,
  near-constant columns, and tiny subgroups that quietly distort downstream analysis.
- **Generate hypotheses.** Get a ranked list of candidate effects to confirm properly
  on held-out data.
- **Produce a shareable report.** One consistent artifact (Markdown, JSON, or PDF)
  instead of ad-hoc notebook cells.

## What it solves

- **The blank-CSV problem.** Manual exploratory analysis is slow and easy to do
  unevenly. StatAssay runs the same full battery every time — correlation (numeric × numeric),
  group differences (numeric × categorical), contingency (categorical × categorical),
  and an OLS regression for every numeric column.
- **Multiple comparisons.** Running many tests by hand and reading off `p < 0.05`
  inflates false positives. StatAssay applies a Benjamini–Hochberg FDR correction within
  each test family and reports a **finding** only when `q < 0.05` *and* the effect size
  is at least medium.
- **Silent data-quality failures.** Every issue is scored and listed by severity;
  extreme-value, outlier and missing-data issues point at the specific rows (by the
  file's identifier column when it has one, otherwise by row number).
- **Missing-data guesswork.** The whole sweep is re-run on a median/mode-imputed copy,
  and any finding whose verdict depends on that choice is flagged as
  imputation-sensitive.

## What the report contains

- **Data quality** — a 0–100 score and a list of issues by severity, each pointing at
  the rows (and, for outliers, the value) responsible.
- **Key findings** — plain-language headlines with effect size, FDR-adjusted `q`, and
  imputation robustness, each with a chart: a scatter for correlations, a box plot for
  group differences, a stacked bar for contingency, residual + Cook's-distance plots for
  regression models, and a partial-regression plot for regression coefficients.
- **Column profile** — types, missingness, and a histogram per numeric column.
- **All results** — every test in a sortable table, plus a correlation heatmap.

All charts are computed on the backend as plain number series and drawn by the frontend
as dependency-free inline SVG.

## Exports

From the report toolbar:

- **report.md** — the full report as Markdown (charts become sparklines / tables).
- **report.json** — the raw `/infer` response.
- **Export PDF** — pick which charts to include, then the browser's print dialog produces
  a vector PDF (an `@media print` view; no extra dependencies).

## Limitations

- One flat CSV, one table — no joins, no panel or time-series modeling.
- The pairwise sweep runs on up to 40 analysable columns; any beyond that are listed but
  skipped.
- Date/time columns are profiled but not analysed.
- Everything is associational: StatAssay does not fit predictive models or estimate causal
  effects.

## Backend

The virtualenv lives at the repo root (`.venv`), not under `backend/`.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn main:app --app-dir backend --reload --port 8000
```

The frontend calls `http://127.0.0.1:8000` by default, so `--port 8000` matters (override
with the `VITE_API_URL` env var for the frontend if you change it).

Run the tests:

```bash
.venv/bin/python -m pytest backend
```

`POST /infer` with a CSV file field returns the full report as JSON (including a
`report_markdown` rendering); the frontend is a thin renderer over that response.

## Frontend

```bash
cd frontend
npm install
npm run dev
```
