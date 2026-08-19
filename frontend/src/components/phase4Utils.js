export function deriveValidity(flags = {}) {
  const severe = [];
  const warnings = [];

  if (flags.normalityPoor) warnings.push("Residuals look non‑normal.");
  if (flags.heteroskedastic) warnings.push("Variance looks uneven across predictions.");
  if (flags.influentialPoints) warnings.push("Some points have unusually large influence.");
  if (flags.multicollinearity) warnings.push("Predictors may overlap heavily.");
  if (flags.rightSkewed) warnings.push("Outcome is strongly right‑skewed.");
  if (flags.groupImbalance) warnings.push("Groups are uneven or very small.");
  if (flags.lowExpectedCounts) warnings.push("Some category combinations are very rare.");
  if (flags.npWarning) warnings.push("There may be too few rows for the number of predictors.");

  if (flags.normalityPoor && flags.heteroskedastic) severe.push("Multiple assumption checks are failing.");
  if (flags.lowExpectedCounts) severe.push("Very sparse category combinations reduce reliability.");
  if (flags.groupImbalance && flags.normalityPoor) severe.push("Small groups make results unreliable.");

  if (severe.length) {
    return { validity: "red", reasons: severe.concat(warnings) };
  }
  if (warnings.length) {
    return { validity: "yellow", reasons: warnings };
  }
  return { validity: "green", reasons: ["No major issues detected."] };
}

export function shouldUnlockAdjustments(flags = {}) {
  const transformTrigger = flags.rightSkewed || flags.normalityPoor || flags.heteroskedastic;
  const outlierTrigger = flags.influentialPoints || flags.outlierFlagged;
  return { transformTrigger, outlierTrigger, any: transformTrigger || outlierTrigger };
}

export function validateTransformChoice(outcomeMin, transform) {
  if (transform === "log" && outcomeMin <= 0) {
    return `Log transform requires all values > 0. Found minimum = ${outcomeMin}.`;
  }
  if (transform === "sqrt" && outcomeMin < 0) {
    return `Square‑root transform requires all values ≥ 0. Found minimum = ${outcomeMin}.`;
  }
  return null;
}

export function validateJustification(text) {
  if (!text || !text.trim()) {
    return "Please provide a short justification to apply this adjustment.";
  }
  return null;
}

export function buildPhase4LogEntry({
  datasetId,
  intentSnapshot,
  actionType,
  parameters,
  justification,
  diagnosticsSummaryBefore,
  diagnosticsSummaryAfter,
}) {
  return {
    timestamp: new Date().toISOString(),
    phase: "phase4",
    datasetId,
    intentSnapshot,
    actionType,
    parameters,
    justification: justification || null,
    diagnosticsSummaryBefore: diagnosticsSummaryBefore || null,
    diagnosticsSummaryAfter: diagnosticsSummaryAfter || null,
  };
}
