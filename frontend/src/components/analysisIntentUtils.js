export function buildIntentLogEntry(state) {
  return {
    action: "analysis_intent",
    timestamp: new Date().toISOString(),
    type: state.type,
    outcome: state.outcome ?? null,
    predictors: state.predictors ?? [],
    group: state.group ?? null,
    varA: state.varA ?? null,
    varB: state.varB ?? null,
    warnings: state.warnings ?? [],
  };
}

export function getEligibleColumns(columns = []) {
  return columns.filter((col) => col.role !== "identifier" && col.role !== "excluded");
}

export function getNumericColumns(columns = []) {
  return columns.filter((col) => col.detectedType === "numeric");
}

export function getCategoricalColumns(columns = []) {
  return columns.filter((col) => col.detectedType === "categorical");
}

export function validatePredict({ outcome, predictors = [], columnsByName }) {
  const errors = {};
  const warnings = [];

  if (!outcome) {
    errors.outcome = "Select a numeric outcome.";
  } else if (columnsByName[outcome]?.detectedType !== "numeric") {
    errors.outcome = "Outcome must be numeric.";
  }

  if (!predictors.length) {
    errors.predictors = "Select at least one predictor.";
  }

  if (outcome && predictors.includes(outcome)) {
    errors.predictors = "Predictors cannot include the outcome.";
  }

  predictors.forEach((name) => {
    const col = columnsByName[name];
    if (!col) return;
    if (col.detectedType === "categorical" && col.levelsCount && col.levelsCount > 50) {
      warnings.push(`"${name}" has many categories; results may be hard to interpret.`);
    }
  });

  return { errors, warnings, isValid: Object.keys(errors).length === 0 };
}

export function validateCompareMeans({ outcome, group, columnsByName }) {
  const errors = {};
  const warnings = [];

  if (!outcome) {
    errors.outcome = "Select a numeric outcome.";
  } else if (columnsByName[outcome]?.detectedType !== "numeric") {
    errors.outcome = "Outcome must be numeric.";
  }

  if (!group) {
    errors.group = "Select a grouping variable.";
  } else if (columnsByName[group]?.detectedType !== "categorical") {
    errors.group = "Grouping variable must be categorical.";
  }

  if (!errors.group) {
    const groupCol = columnsByName[group];
    if (groupCol?.levelsCount && groupCol.levelsCount < 2) {
      errors.group = "Grouping variable needs at least two groups.";
    }
    if (groupCol?.levelsCount && groupCol.levelsCount > 20) {
      warnings.push("Many groups may make results hard to interpret.");
    }
    if (groupCol?.sampleCounts) {
      const counts = Object.values(groupCol.sampleCounts).map((v) => Number(v)).filter((v) => Number.isFinite(v));
      const minCount = counts.length ? Math.min(...counts) : null;
      if (minCount !== null && minCount < 5) {
        warnings.push("Some groups have very few rows.");
      }
    }
  }

  return { errors, warnings, isValid: Object.keys(errors).length === 0 };
}

export function validateAssociation({ varA, varB, columnsByName }) {
  const errors = {};
  const warnings = [];
  let note = "";

  if (!varA) errors.varA = "Select the first variable.";
  if (!varB) errors.varB = "Select the second variable.";
  if (varA && varB && varA === varB) {
    errors.varB = "Choose two different variables.";
  }

  if (!errors.varA && !errors.varB) {
    const typeA = columnsByName[varA]?.detectedType;
    const typeB = columnsByName[varB]?.detectedType;
    if (typeA === "categorical" && typeB === "categorical") {
      note = "We’ll evaluate association between two categorical variables.";
    } else if (typeA === "numeric" && typeB === "numeric") {
      note = "We’ll evaluate association between two numeric variables.";
    } else {
      note = "We’ll evaluate association using a method appropriate for a numeric vs categorical pair.";
    }
  }

  return { errors, warnings, note, isValid: Object.keys(errors).length === 0 };
}
