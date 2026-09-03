# StatGuard

Upload a CSV, get an automatic statistical inference report — findings, charts, and a
data-quality audit, with nothing to configure.

StatGuard profiles every column, flags data-quality problems, then runs an unsupervised
sweep across three test families — correlation (numeric × numeric), group differences
(numeric × categorical, t-test / ANOVA), and contingency (categorical × categorical,
chi-square / Fisher) — plus an OLS regression for every numeric column. p-values are
Benjamini–Hochberg FDR-adjusted within each family; a result is reported as a **finding**
only when `q < 0.05` and the effect size is at least medium. Missing values are handled by
pairwise deletion, and the whole sweep is repeated on a median/mode-imputed copy so
findings that depend on that choice are flagged.

Results are **exploratory and associational** — hypotheses to confirm on fresh data, not
evidence of causation.

## What the report contains

- **Data quality** — a 0–100 score and a list of issues by severity. Extreme-value,
  outlier and missing-data issues name the specific rows (by the file's identifier
  column when it has one, otherwise by row number) and, for outliers, the value.
- **Key findings** — plain-language headlines with effect size, FDR-adjusted `q`, and
  imputation robustness, each with a chart: a scatter for correlations, a box plot for
  group differences, a stacked bar for contingency, residual + Cook's-distance plots for
  regression models, and a partial-regression plot for regression coefficients.
- **Column profile** — types, missingness, and a histogram per numeric column.
- **All results** — every test in a sortable table, plus a correlation heatmap.

All charts are computed on the backend as plain number series and drawn by the frontend as
dependency-free inline SVG.

## Exports

From the report toolbar:

- **report.md** — the full report as Markdown (charts become sparklines / tables).
- **report.json** — the raw `/infer` response.
- **Export PDF** — pick which charts to include, then the browser's print dialog produces
  a vector PDF (an `@media print` view; no extra dependencies).

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
