from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import pandas as pd
import numpy as np
import io
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.outliers_influence import variance_inflation_factor
import re
from decimal import Decimal, InvalidOperation

def _apply_transform(series, transform):
    if transform == "log":
        if series.min() <= 0:
            return None, f"Log transform requires all values > 0. Found minimum = {series.min()}."
        return np.log(series), None
    if transform == "sqrt":
        if series.min() < 0:
            return None, f"Square-root transform requires all values >= 0. Found minimum = {series.min()}."
        return np.sqrt(series), None
    return series, None

def _outlier_mask(series):
    q1 = series.quantile(0.25)
    q3 = series.quantile(0.75)
    iqr = q3 - q1
    if iqr <= 0:
        return pd.Series([False] * len(series), index=series.index)
    lower = q1 - 3 * iqr
    upper = q3 + 3 * iqr
    return (series < lower) | (series > upper)

def _derive_type(series):
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    return "categorical"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Changed to allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Original-Shape", "X-New-Shape"],
)

@app.get("/")
def root():
    return {"status": "ok"}

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    content = await file.read()
    df = pd.read_csv(io.BytesIO(content))

    nunique = df.nunique(dropna=True)

    result = {
        "shape": {"rows": int(df.shape[0]), "cols": int(df.shape[1])},
        "columns": df.columns.tolist(),
        "missing_by_column": df.isna().sum().astype(int).to_dict(),
        "nunique": nunique.astype(int).to_dict(),
    }

    duplicate_mask = df.duplicated(keep=False)
    duplicate_indices = df.index[duplicate_mask].tolist()
    result["duplicate_rows"] = {
        "count": int(len(duplicate_indices)),
        "indices": [int(i) + 1 for i in duplicate_indices[:100]]
    }
    
    numeric = df.select_dtypes(include="number")
    if not numeric.empty:
        result["describe"] = numeric.describe().to_dict()
        extreme_flags = {}
        dist_flags = {}
        for col in numeric.columns:
            series = numeric[col].dropna()
            if series.empty:
                extreme_flags[col] = {"count": 0}
                dist_flags[col] = {"right_skewed": False, "left_skewed": False, "heavy_tails": False}
                continue
            q1 = series.quantile(0.25)
            q3 = series.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - 3 * iqr
            upper = q3 + 3 * iqr
            outlier_count = int(((series < lower) | (series > upper)).sum())
            skew = float(series.skew())
            kurt = float(series.kurt())
            dist_flags[col] = {
                "right_skewed": skew > 0.5,
                "left_skewed": skew < -0.5,
                "heavy_tails": kurt > 3,
            }
            extreme_flags[col] = {"count": outlier_count}
        result["extreme_value_flags"] = extreme_flags
        result["distribution_flags"] = dist_flags
    
    return result

@app.post("/phase4_diagnostics")
async def phase4_diagnostics(
    file: UploadFile = File(...),
    intent_type: str = Form(...),
    outcome: str = Form(""),
    predictors: list[str] = Form([]),
    group: str = Form(""),
    var_a: str = Form(""),
    var_b: str = Form(""),
    transform: str = Form("none"),
    outlier_mode: str = Form("flag"),
    outlier_rule: str = Form("3xIQR")
):
    content = await file.read()
    df = pd.read_csv(io.BytesIO(content))

    if intent_type not in ["predict", "compare_means", "association"]:
        return {"error": "Unknown intent type"}

    diagnostics = {}
    flags = {}
    thresholds = {"outlier_rule": outlier_rule}
    excluded_count = 0

    if intent_type == "predict":
        if not outcome or not predictors:
            return {"error": "Outcome and predictors required"}
        if outcome not in df.columns:
            return {"error": "Outcome column not found"}
        for col in predictors:
            if col not in df.columns:
                return {"error": f"Predictor {col} not found"}

        sub = df[predictors + [outcome]].dropna()
        if sub.empty:
            return {"error": "No valid rows after removing missing values"}

        y_raw = pd.to_numeric(sub[outcome], errors="coerce").dropna()
        sub = sub.loc[y_raw.index]
        y_raw = y_raw.astype(float)
        if y_raw.empty:
            return {"error": "Outcome is not numeric"}

        y, err = _apply_transform(y_raw, transform)
        if err:
            return {"error": err}

        outlier_mask = _outlier_mask(y_raw)
        outlier_count = int(outlier_mask.sum())
        flags["outlierFlagged"] = outlier_count > 0
        if outlier_mode == "exclude" and outlier_count > 0:
            sub = sub.loc[~outlier_mask]
            y_raw = y_raw.loc[~outlier_mask]
            y, _ = _apply_transform(y_raw, transform)
            excluded_count = outlier_count

        X = sub[predictors]
        X = sm.add_constant(X)
        y = y.astype(float)
        model = sm.OLS(y, X).fit()
        influence = model.get_influence()

        residuals = model.resid
        fitted = model.fittedvalues
        shapiro_result = None
        if 3 <= len(residuals) <= 2000:
            shapiro_stat, shapiro_p = stats.shapiro(residuals)
            shapiro_result = {"stat": float(shapiro_stat), "p_value": float(shapiro_p)}
            flags["normalityPoor"] = float(shapiro_p) < 0.05
        else:
            flags["normalityPoor"] = False

        bp_stat, bp_p, _, _ = het_breuschpagan(residuals, X)
        flags["heteroskedastic"] = float(bp_p) < 0.05

        cooks = influence.cooks_distance[0]
        flags["influentialPoints"] = bool(np.any(cooks > 4 / max(len(sub), 1)))

        vif_values = []
        X_no_const = sub[predictors].values
        if len(predictors) >= 2 and X_no_const.size > 0:
            for i in range(len(predictors)):
                try:
                    vif_values.append(float(variance_inflation_factor(X_no_const, i)))
                except Exception:
                    vif_values.append(np.nan)
        vif_max = max([v for v in vif_values if np.isfinite(v)], default=None)
        flags["multicollinearity"] = bool(vif_max and vif_max > 10)

        skewness = float(stats.skew(y)) if len(y) > 2 else 0.0
        flags["rightSkewed"] = skewness > 1
        flags["npWarning"] = len(sub) < 5 * max(len(predictors), 1)

        diagnostics = {
            "n": int(len(sub)),
            "p": int(len(predictors)),
            "outcome_min": float(y_raw.min()),
            "outlier_count": outlier_count,
            "shapiro_p": float(shapiro_result["p_value"]) if shapiro_result else None,
            "bp_p": float(bp_p),
            "vif_max": float(vif_max) if vif_max is not None else None,
            "residuals": residuals.tolist(),
            "fitted": fitted.tolist(),
        }

    if intent_type == "compare_means":
        if not outcome or not group:
            return {"error": "Outcome and group required"}
        if outcome not in df.columns or group not in df.columns:
            return {"error": "Selected columns not found"}

        sub = df[[outcome, group]].dropna()
        if sub.empty:
            return {"error": "No valid rows after removing missing values"}

        y_raw = pd.to_numeric(sub[outcome], errors="coerce").dropna()
        sub = sub.loc[y_raw.index]
        y_raw = y_raw.astype(float)
        if y_raw.empty:
            return {"error": "Outcome is not numeric"}

        y, err = _apply_transform(y_raw, transform)
        if err:
            return {"error": err}

        outlier_mask = _outlier_mask(y_raw)
        outlier_count = int(outlier_mask.sum())
        flags["outlierFlagged"] = outlier_count > 0
        if outlier_mode == "exclude" and outlier_count > 0:
            sub = sub.loc[~outlier_mask]
            y_raw = y_raw.loc[~outlier_mask]
            y, _ = _apply_transform(y_raw, transform)
            excluded_count = outlier_count

        groups = sub[group].astype(str).unique().tolist()
        samples = [y[sub[group].astype(str) == g] for g in groups]
        group_sizes = [{"name": g, "n": int(len(s))} for g, s in zip(groups, samples)]
        flags["groupImbalance"] = bool(groups and (len(groups) > 20 or min([len(s) for s in samples if len(s) > 0] or [0]) < 5))

        levene_p = None
        if len(samples) >= 2:
            stat, levene_p = stats.levene(*samples)
            flags["heteroskedastic"] = float(levene_p) < 0.05
        else:
            flags["heteroskedastic"] = False

        normality_flags = []
        for s in samples:
            if 3 <= len(s) <= 2000:
                _, pval = stats.shapiro(s)
                normality_flags.append(pval < 0.05)
        flags["normalityPoor"] = any(normality_flags) if normality_flags else False

        diagnostics = {
            "n": int(len(sub)),
            "outcome_min": float(y_raw.min()),
            "outlier_count": outlier_count,
            "group_sizes": group_sizes,
            "levene_p": float(levene_p) if levene_p is not None else None,
        }

    if intent_type == "association":
        if not var_a or not var_b:
            return {"error": "Two variables required"}
        if var_a not in df.columns or var_b not in df.columns:
            return {"error": "Selected columns not found"}

        sub = df[[var_a, var_b]].dropna()
        if sub.empty:
            return {"error": "No valid rows after removing missing values"}

        type_a = _derive_type(sub[var_a])
        type_b = _derive_type(sub[var_b])
        assoc_type = f"{type_a}-{type_b}"
        diagnostics = {"association_type": assoc_type}

        if type_a == "categorical" and type_b == "categorical":
            table = pd.crosstab(sub[var_a].astype(str), sub[var_b].astype(str))
            chi2, pval, dof, expected = stats.chi2_contingency(table)
            flags["lowExpectedCounts"] = bool((expected < 5).any())
            diagnostics.update({
                "low_expected": flags["lowExpectedCounts"],
                "chi2_p": float(pval),
                "table": table.to_dict()
            })
        elif type_a == "numeric" and type_b == "numeric":
            a_vals = pd.to_numeric(sub[var_a], errors="coerce").dropna().astype(float)
            b_vals = pd.to_numeric(sub[var_b], errors="coerce").dropna().astype(float)
            n = min(len(a_vals), len(b_vals))
            a_vals = a_vals.iloc[:n]
            b_vals = b_vals.iloc[:n]
            if n == 0:
                return {"error": "No numeric data in selected columns"}
            corr = float(np.corrcoef(a_vals, b_vals)[0, 1])
            z_a = np.abs((a_vals - a_vals.mean()) / (a_vals.std() or 1))
            z_b = np.abs((b_vals - b_vals.mean()) / (b_vals.std() or 1))
            outlier_count = int(((z_a > 3) | (z_b > 3)).sum())
            flags["outlierFlagged"] = outlier_count > 0
            diagnostics.update({
                "correlation": corr,
                "outlier_count": outlier_count,
            })
        else:
            numeric_col = var_a if type_a == "numeric" else var_b
            group_col = var_b if numeric_col == var_a else var_a
            sub = sub[[numeric_col, group_col]].dropna()
            y_raw = pd.to_numeric(sub[numeric_col], errors="coerce").dropna().astype(float)
            sub = sub.loc[y_raw.index]
            groups = sub[group_col].astype(str).unique().tolist()
            samples = [y_raw[sub[group_col].astype(str) == g] for g in groups]
            group_sizes = [{"name": g, "n": int(len(s))} for g, s in zip(groups, samples)]
            flags["groupImbalance"] = bool(groups and (len(groups) > 20 or min([len(s) for s in samples if len(s) > 0] or [0]) < 5))
            diagnostics.update({
                "group_sizes": group_sizes,
            })

    return {
        "intent_type": intent_type,
        "diagnostics": diagnostics,
        "flags": flags,
        "thresholds": thresholds,
        "adjustments": {
            "outlier_rule": outlier_rule,
            "excluded_count": excluded_count,
            "transform": transform,
        },
        "key_metrics": diagnostics,
        "outcome_min": diagnostics.get("outcome_min") if isinstance(diagnostics, dict) else None,
        "outlier_count": diagnostics.get("outlier_count") if isinstance(diagnostics, dict) else 0,
    }

@app.post("/clean")
async def clean_data(
    file: UploadFile = File(...),
    drop_na: str = Form("false"),
    fill_mean: str = Form("false"),
    fill_median: str = Form("false"),
    drop_duplicates: str = Form("false"),
    drop_high_missing: str = Form("false"),
    missing_threshold: str = Form("50.0")
):
    content = await file.read()
    df = pd.read_csv(io.BytesIO(content))
    original_text = content.decode(errors="ignore")
    original_df_str = pd.read_csv(
        io.StringIO(original_text),
        dtype=str,
        keep_default_na=False,
        na_filter=False
    )
    
    # Convert string form values to bool
    drop_na = drop_na.lower() == "true"
    fill_mean = fill_mean.lower() == "true"
    fill_median = fill_median.lower() == "true"
    drop_duplicates = drop_duplicates.lower() == "true"
    drop_high_missing = drop_high_missing.lower() == "true"
    missing_threshold = float(missing_threshold)
    
    original_shape = df.shape
    decimals_by_col = {}
    numeric_pattern = re.compile(r"^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$")
    for col in original_df_str.columns:
        max_decimals = None
        for raw in original_df_str[col].tolist():
            if raw is None:
                continue
            value = str(raw).strip()
            if value == "":
                continue
            cleaned = value.replace(",", "")
            if not numeric_pattern.fullmatch(cleaned):
                continue
            if "e" in cleaned.lower():
                try:
                    dec = Decimal(cleaned)
                except InvalidOperation:
                    continue
                decimals = max(0, -dec.as_tuple().exponent)
            elif "." in cleaned:
                decimals = len(cleaned.split(".", 1)[1])
            else:
                decimals = 0
            if max_decimals is None or decimals > max_decimals:
                max_decimals = decimals
        if max_decimals is not None:
            decimals_by_col[col] = max_decimals

    # Drop columns with high percentage of missing values
    if drop_high_missing:
        threshold = missing_threshold / 100.0
        missing_pct = df.isna().mean()
        cols_to_drop = missing_pct[missing_pct > threshold].index.tolist()
        if cols_to_drop:
            df = df.drop(columns=cols_to_drop)
    
    # Fill missing values with mean (do this BEFORE drop_na)
    if fill_mean:
        numeric_cols = df.select_dtypes(include=["number"]).columns
        for col in numeric_cols:
            missing_count = int(df[col].isna().sum())
            if missing_count > 0:
                mean_val = df[col].mean()
                df[col] = df[col].fillna(mean_val)
    
    # Fill missing values with median (do this BEFORE drop_na)
    if fill_median:
        numeric_cols = df.select_dtypes(include=["number"]).columns
        for col in numeric_cols:
            missing_count = int(df[col].isna().sum())
            if missing_count > 0:
                median_val = df[col].median()
                df[col] = df[col].fillna(median_val)
    
    # Drop rows with any missing values (do this AFTER filling)
    if drop_na:
        df = df.dropna()
    
    # Drop duplicate rows
    if drop_duplicates:
        df = df.drop_duplicates()
    
    output_df = df.copy()
    numeric_cols = output_df.select_dtypes(include=["number"]).columns
    for col in numeric_cols:
        decimals = decimals_by_col.get(col, 0)
        output_df[col] = output_df[col].apply(
            lambda v: "" if pd.isna(v) else f"{v:.{decimals}f}"
        )

    # Convert cleaned dataframe to CSV
    output = io.StringIO()
    output_df.to_csv(output, index=False)
    output.seek(0)
    
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=cleaned_data.csv",
            "X-Original-Shape": f"{original_shape[0]}x{original_shape[1]}",
            "X-New-Shape": f"{df.shape[0]}x{df.shape[1]}"
        }
    )

@app.post("/get_data")
async def get_data(
    file: UploadFile = File(...),
    page: str = Form("0"),
    page_size: str = Form("20")
):
    """Get paginated data for editing"""
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
        df_display = pd.read_csv(
            io.BytesIO(content),
            dtype=str,
            keep_default_na=False,
            na_filter=False
        )
        
        page = int(page)
        page_size = int(page_size)
        
        total_rows = len(df)
        if page_size == -1:
            start = 0
            end = total_rows
        else:
            start = page * page_size
            end = start + page_size
        
        page_data = df_display.iloc[start:end]
        
        # Convert to list, replacing NaN with None
        data_list = []
        for _, row in page_data.iterrows():
            row_list = []
            for val in row:
                row_list.append(val)
            data_list.append(row_list)
        
        return {
            "columns": df_display.columns.tolist(),
            "data": data_list,
            "total_rows": total_rows,
            "page": page,
            "page_size": page_size,
            "total_pages": 1 if page_size == -1 else (total_rows + page_size - 1) // page_size
        }
    except Exception as e:
        return {"error": str(e)}
