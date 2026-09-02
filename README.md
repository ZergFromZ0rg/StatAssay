# StatGuard

Upload a CSV, get an automatic statistical inference report.

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

## Frontend

```bash
cd frontend
npm install
npm run dev
```

`POST /infer` with a CSV file field returns the full report as JSON (including a
`report_markdown` rendering); the frontend is a thin renderer over that response.
