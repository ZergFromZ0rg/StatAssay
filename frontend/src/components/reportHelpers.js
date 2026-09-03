export function downloadFile(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Defer cleanup: some browsers abort the download if the URL is revoked or the
  // anchor is removed before the click is processed.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

export function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (typeof value !== "number") return String(value);
  if (value !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e5)) {
    return value.toExponential(2);
  }
  return value.toFixed(digits);
}

export function pct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export const FAMILY_LABEL = {
  correlation: "Correlation",
  group_difference: "Group difference",
  contingency: "Contingency",
  regression_model: "Regression model",
  regression_coefficient: "Regression coefficient",
};

export const ROBUSTNESS_LABEL = {
  stable: "stable under imputation",
  "imputation-sensitive": "imputation-sensitive",
  "not-assessed": "single run",
};
