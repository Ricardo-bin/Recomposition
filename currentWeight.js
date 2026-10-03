// ============================================================================
// RECOMPOSITION — CURRENT WEIGHT (single source of truth)
// ----------------------------------------------------------------------------
// WEIGHT HISTORY is the canonical record of body weight.
//
//   latest valid Weight History entry  ->  CURRENT WEIGHT  ->  Profile display,
//                                                              Dashboard,
//                                                              Nutrition (Goals)
//
// Every consumer calls resolveCurrentWeight() so they can never disagree. There
// is no second, editable "current weight". The weight stored on the profile
// document by older versions is kept only as a read-only fallback for users who
// have no Weight History yet; the app never writes it any more.
//
// Pure: no DOM, no Firebase, no writes. Stored values are kilograms; use
// units.js to display them in the user's preferred unit.
// ============================================================================

import { pickCurrentWeightKg } from "./nutritionEngine.js";

// -> { weightKg, source: "weight-history" | "profile" | null, date: "YYYY-MM-DD" | null }
export function resolveCurrentWeight(weightHistory, legacyProfileWeightKg) {
  return pickCurrentWeightKg(weightHistory, legacyProfileWeightKg);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// "2026-10-03" -> "03 Oct 2026" (read straight from the text: no time zones).
export function formatWeighInDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));

  if (!match) {
    return "";
  }

  const month = MONTHS[Number(match[2]) - 1];

  return month ? `${match[3]} ${month} ${match[1]}` : "";
}

// Wording for the read-only "Current weight" readout (Profile).
//   kind "weight-history"  a weigh-in exists
//   kind "profile"         legacy profile weight only (no weigh-ins yet)
//   kind "none"            nothing recorded
export function describeCurrentWeight(current) {
  if (current?.source === "weight-history") {
    const when = formatWeighInDate(current.date);

    return {
      kind: "weight-history",
      note: when ? `Latest weigh-in: ${when}` : "Latest weigh-in"
    };
  }

  if (current?.source === "profile") {
    return {
      kind: "profile",
      note: "From your earlier profile entry. Add a weigh-in in Weight History to keep it up to date."
    };
  }

  return {
    kind: "none",
    note: "No weight recorded yet. Add your first weigh-in in Weight History."
  };
}
