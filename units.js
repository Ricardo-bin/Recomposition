// ============================================================================
// RECOMPOSITION — WEIGHT UNITS
// ----------------------------------------------------------------------------
// The profile stores `unitPreference` as "kg" or "lb" (the profile field is
// labelled "WEIGHT UNIT"). Every stored body weight (profile.currentWeight and
// weightHistory[].weight) is CANONICAL KILOGRAMS. Nothing in Firestore changes
// when the preference changes: values are converted only for display and when
// the user types a value.
//
//   stored (kg)  --kgToDisplay-->  shown to the user (kg or lb)
//   typed value  --displayToKg-->  stored (kg, rounded to 0.01)
//
// Out of scope here (see README "Units"): lifting loads, height and body
// measurements are not part of this preference.
// ============================================================================

export const KG_PER_LB = 0.45359237;

export const WEIGHT_UNITS = Object.freeze(["kg", "lb"]);

// Anything other than "lb" (missing, "kg", garbage) is kilograms.
export function normalizeWeightUnit(value) {
  return value === "lb" ? "lb" : "kg";
}

export function weightUnitLabel(unit) {
  return normalizeWeightUnit(unit);
}

const isNumber = value =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value));

// Stored kilograms -> number in the preferred unit (unrounded).
export function kgToDisplay(kg, unit) {
  if (!isNumber(kg)) {
    return null;
  }

  const value = Number(kg);

  return normalizeWeightUnit(unit) === "lb" ? value / KG_PER_LB : value;
}

// Number typed in the preferred unit -> kilograms to store (rounded to 0.01 kg
// so float noise never reaches Firestore). Returns null for blank/invalid.
export function displayToKg(value, unit) {
  if (!isNumber(value)) {
    return null;
  }

  const number = Number(value);

  const kg = normalizeWeightUnit(unit) === "lb" ? number * KG_PER_LB : number;

  return Math.round(kg * 100) / 100;
}

// 1 decimal, no trailing zeros: 72 -> "72", 72.5 -> "72.5", 158.73 -> "158.7".
export function formatNumber(value) {
  if (!isNumber(value)) {
    return "—";
  }

  return String(Number(Number(value).toFixed(1)));
}

// "72.5 kg" / "159.8 lb" / "—"
export function formatWeight(kg, unit, { withUnit = true } = {}) {
  const display = kgToDisplay(kg, unit);

  if (display === null) {
    return "—";
  }

  const text = formatNumber(display);

  return withUnit ? `${text} ${weightUnitLabel(unit)}` : text;
}

// Value for an <input type="number"> in the preferred unit ("" when blank).
export function weightInputValue(kg, unit) {
  const display = kgToDisplay(kg, unit);

  return display === null ? "" : String(Number(display.toFixed(1)));
}

// Converts the text currently in a weight box from one unit to another
// (used when the user flips the unit selector). Blank/invalid stays as typed.
export function convertInputText(text, fromUnit, toUnit) {
  const from = normalizeWeightUnit(fromUnit);
  const to = normalizeWeightUnit(toUnit);

  if (from === to || !isNumber(text)) {
    return text;
  }

  const kg = Number(text) * (from === "lb" ? KG_PER_LB : 1);

  const result = to === "lb" ? kg / KG_PER_LB : kg;

  return String(Number(result.toFixed(1)));
}

// Allowed body-weight range in the preferred unit (profile validation is
// defined in kg: 20-400).
export function weightRange(unit, minKg = 20, maxKg = 400) {
  return {
    min: Math.floor(kgToDisplay(minKg, unit)),
    max: Math.ceil(kgToDisplay(maxKg, unit))
  };
}
