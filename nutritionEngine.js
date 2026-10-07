// ============================================================================
// RECOMPOSITION — NUTRITION ENGINE v1
// ----------------------------------------------------------------------------
// A PURE calculation module: no DOM, no Firebase, no storage, no side effects.
// Data goes in, a RECOMMENDATION comes out. Nothing here ever changes a goal.
//
//   profile + current weight + activity + goal type
//        -> BMR (Mifflin-St Jeor)
//        -> TDEE (BMR x activity multiplier)
//        -> goal adjustment (% of TDEE)
//        -> calories, protein, fat, carbs (carbs = remaining calories)
//        -> rounded, validated recommendation
//
// The user reviews the recommendation and may APPLY it; applying is done by the
// Goals screen (buildAppliedNutritionFields() only prepares the fields to save).
//
// Weight is canonical KILOGRAMS. Pounds are a display concern (units.js).
//
// v1 rules (formula version "nutrition-v1"):
//   BMR     male   = 10w + 6.25h - 5a + 5
//           female = 10w + 6.25h - 5a - 161
//           other / prefer not to say -> NO automatic calculation
//   TDEE    = BMR x { sedentary 1.2, lightly-active 1.375, moderately-active 1.55,
//                     very-active 1.725, extremely-active 1.9 }
//   goals   maintenance +0%, recomposition +0%, lean-bulk +5%, bulk +10%,
//           cut -15%, fat-loss -20%, custom = manual (never calculated)
//   protein 1.8 g/kg (cut, fat-loss: 2.0 g/kg)      fat 0.8 g/kg
//   carbs   = (calories - 4 x protein - 9 x fat) / 4
//   rounding calories -> 10 kcal, protein / fat / carbs -> 5 g
// ============================================================================

export const NUTRITION_FORMULA_VERSION = "nutrition-v1";

// --------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------

export const ACTIVITY_MULTIPLIERS = Object.freeze({
  "sedentary": 1.2,
  "lightly-active": 1.375,
  "moderately-active": 1.55,
  "very-active": 1.725,
  "extremely-active": 1.9
});

// adjustment = fraction of TDEE. `custom` has no entry: it is never calculated.
export const GOAL_RULES = Object.freeze({
  "maintenance":   Object.freeze({ adjustment:  0.00, proteinPerKg: 1.8 }),
  "recomposition": Object.freeze({ adjustment:  0.00, proteinPerKg: 1.8 }),
  "lean-bulk":     Object.freeze({ adjustment:  0.05, proteinPerKg: 1.8 }),
  "bulk":          Object.freeze({ adjustment:  0.10, proteinPerKg: 1.8 }),
  "cut":           Object.freeze({ adjustment: -0.15, proteinPerKg: 2.0 }),
  "fat-loss":      Object.freeze({ adjustment: -0.20, proteinPerKg: 2.0 })
});

export const FAT_PER_KG = 0.8;

export const GOAL_KEYS = Object.freeze([...Object.keys(GOAL_RULES), "custom"]);

// Input limits. Outside these the calculator refuses to produce numbers.
//   - Age 18+: Mifflin-St Jeor is an adult equation, and automatic deficits are
//     not prescribed for minors. (Minors can use a Custom goal.)
export const LIMITS = Object.freeze({
  age:      Object.freeze({ min: 18,  max: 100 }),
  heightCm: Object.freeze({ min: 100, max: 250 }),
  weightKg: Object.freeze({ min: 30,  max: 300 })
});

const KCAL_PER_G = Object.freeze({ protein: 4, carbs: 4, fat: 9 });


// --------------------------------------------------------------------------
// Normalisation (profile / goal labels -> engine keys)
// --------------------------------------------------------------------------

const keyOf = value =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// "Lean Bulk" -> "lean-bulk", "lean-bulk" -> "lean-bulk", "" -> ""
export const toGoalKey = label => keyOf(label);

// "Lightly active" -> "lightly-active"
export const toActivityKey = label => keyOf(label);

// "Male" -> "male", "Prefer not to say" -> "prefer-not-to-say"
export const toSexKey = label => keyOf(label);

export const isCustomGoal = goalType => keyOf(goalType) === "custom";

// True for the goal types the engine can calculate (everything except custom).
export const isCalculableGoal = goalType => keyOf(goalType) in GOAL_RULES;


// --------------------------------------------------------------------------
// Rounding
// --------------------------------------------------------------------------

export const roundTo = (value, step) => Math.round(value / step) * step;


// --------------------------------------------------------------------------
// BMR
// --------------------------------------------------------------------------

// Mifflin-St Jeor. `sex` must be "male" or "female"; anything else throws
// because the engine never guesses a biological-sex coefficient.
export function calculateBmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;

  if (sex === "male") return base + 5;
  if (sex === "female") return base - 161;

  throw new RangeError(
    `calculateBmr: no coefficient for sex "${sex}" (male or female only)`
  );
}


// --------------------------------------------------------------------------
// Current weight (pure helper; the caller supplies the data)
// --------------------------------------------------------------------------

const positiveNumber = value => {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
};

// Milliseconds for a Firestore Timestamp, Date, ISO string or number (else NaN).
const timeOf = value => {
  if (value === null || value === undefined) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  return new Date(value).getTime();
};

// The athlete's CURRENT weight in kg. WEIGHT HISTORY IS THE SOURCE OF TRUTH:
//   1. the most recent valid Weight History entry: the greatest date; entries on
//      the same date are ordered by when they were added (`createdAt`, newest
//      wins); if that is unavailable the first one listed wins, else
//   2. the weight stored on the profile before Weight History existed (a legacy
//      fallback only; the app no longer writes it), else null.
// Weight History is never modified. Every screen that needs the current weight
// (Profile, Dashboard, Goals / Nutrition) uses this one function via
// currentWeight.js, so they cannot disagree.
export function pickCurrentWeightKg(weightHistory, profileWeightKg) {
  let best = null;

  for (const entry of Array.isArray(weightHistory) ? weightHistory : []) {
    const weightKg = positiveNumber(entry?.weight);

    if (weightKg === null) continue;

    const date = typeof entry.date === "string" ? entry.date : "";
    const added = timeOf(entry.createdAt);

    const newer =
      best === null ||
      date > best.date ||
      (date === best.date && added > best.added);   // NaN comparisons are false

    if (newer) {
      best = { weightKg, date, added };
    }
  }

  if (best) {
    return { weightKg: best.weightKg, source: "weight-history", date: best.date || null };
  }

  const fallback = positiveNumber(profileWeightKg);

  return fallback === null
    ? { weightKg: null, source: null, date: null }
    : { weightKg: fallback, source: "profile", date: null };
}

// Builds the engine input from a stored profile (label strings) + a weight.
export function buildNutritionInput({ profile, weightKg, goalType }) {
  return {
    age: profile?.age,
    sex: profile?.sex,
    heightCm: profile?.height,
    weightKg,
    activityLevel: profile?.activityLevel,
    goalType
  };
}


// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

const error = (field, code, message) => ({ field, code, message });

// Numeric strings from forms/old documents are accepted; blanks are not.
const asNumber = value => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  if (typeof value !== "number" && typeof value !== "string") return NaN;

  return Number(value);
};

function validateNumber(errors, field, raw, { min, max }, label, unit) {
  const value = asNumber(raw);

  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    errors.push(error(field, "missing", `${label} is required.`));
    return null;
  }

  if (!Number.isFinite(value)) {
    errors.push(error(field, "invalid", `${label} must be a number.`));
    return null;
  }

  if (value < min || value > max) {
    // Under-age gets an explanation, not just a range message.
    if (field === "age" && value < min) {
      errors.push(
        error(
          "age",
          "under-minimum",
          `Automatic recommendations are for adults (${min}+). ` +
            "Use a Custom goal to enter your own numbers."
        )
      );
    } else {
      errors.push(
        error(field, "out-of-range", `${label} must be between ${min} and ${max}${unit}.`)
      );
    }
    return null;
  }

  return value;
}


// --------------------------------------------------------------------------
// The calculator
// --------------------------------------------------------------------------

// Returns one of:
//
//   { ok: true,  status: "recommended", goalType, bmr, tdee,
//     calories, protein, fat, carbs, calculationMetadata }
//
//   { ok: false, status: "manual",  errors: [...] }   custom goal: never calculated
//   { ok: false, status: "invalid", errors: [...] }   missing / impossible input
//
// All problems are reported together (not just the first) so the UI can list
// everything that needs completing. The input object is never modified.
export function calculateNutritionRecommendation(input = {}) {
  const goalKey = toGoalKey(input.goalType);

  // ---- Custom goal: fully manual ----------------------------------------
  if (goalKey === "custom") {
    return {
      ok: false,
      status: "manual",
      errors: [
        error(
          "goalType",
          "custom-goal",
          "Custom goals use the numbers you enter. No automatic recommendation is calculated."
        )
      ]
    };
  }

  const errors = [];

  // ---- goal type ----------------------------------------------------------
  if (!goalKey) {
    errors.push(error("goalType", "missing", "Choose a goal type."));
  } else if (!(goalKey in GOAL_RULES)) {
    errors.push(error("goalType", "unknown", `Unknown goal type "${input.goalType}".`));
  }

  // ---- sex (never guessed) --------------------------------------------------
  const sexKey = toSexKey(input.sex);

  if (!sexKey) {
    errors.push(
      error("sex", "missing", "Sex is required: the BMR formula uses a biological-sex coefficient.")
    );
  } else if (sexKey !== "male" && sexKey !== "female") {
    errors.push(
      error(
        "sex",
        "unsupported",
        "Automatic recommendations need Male or Female in your profile, because the BMR formula " +
          "uses a biological-sex coefficient. Use a Custom goal to enter your own numbers."
      )
    );
  }

  // ---- activity level -------------------------------------------------------
  const activityKey = toActivityKey(input.activityLevel);

  if (!activityKey) {
    errors.push(error("activityLevel", "missing", "Activity level is required."));
  } else if (!(activityKey in ACTIVITY_MULTIPLIERS)) {
    errors.push(
      error("activityLevel", "unknown", `Unknown activity level "${input.activityLevel}".`)
    );
  }

  // ---- body data --------------------------------------------------------------
  const age = validateNumber(errors, "age", input.age, LIMITS.age, "Age", " years");
  const heightCm = validateNumber(errors, "heightCm", input.heightCm, LIMITS.heightCm, "Height", " cm");
  const weightKg = validateNumber(errors, "weightKg", input.weightKg, LIMITS.weightKg, "Current weight", " kg");

  if (errors.length > 0) {
    return { ok: false, status: "invalid", errors };
  }

  // ---- calculate ----------------------------------------------------------------
  const rule = GOAL_RULES[goalKey];
  const multiplier = ACTIVITY_MULTIPLIERS[activityKey];

  const bmr = calculateBmr({ sex: sexKey, weightKg, heightCm, age });
  const tdee = bmr * multiplier;

  const caloriesRaw = tdee * (1 + rule.adjustment);
  const proteinRaw = rule.proteinPerKg * weightKg;
  const fatRaw = FAT_PER_KG * weightKg;

  const calories = roundTo(caloriesRaw, 10);
  const protein = roundTo(proteinRaw, 5);
  const fat = roundTo(fatRaw, 5);

  // Carbs are what is left of the (rounded) calorie target after the (rounded)
  // protein and fat, so the three macros always add up to the calories shown.
  const carbCalories = calories - KCAL_PER_G.protein * protein - KCAL_PER_G.fat * fat;

  if (carbCalories < 0) {
    return {
      ok: false,
      status: "invalid",
      errors: [
        error(
          "calories",
          "carbs-negative",
          "The calorie target is too low to cover the protein and fat targets for this weight, " +
            "so no valid carbohydrate amount exists. No recommendation was produced."
        )
      ]
    };
  }

  const carbs = roundTo(carbCalories / KCAL_PER_G.carbs, 5);

  const macroCalories =
    KCAL_PER_G.protein * protein + KCAL_PER_G.fat * fat + KCAL_PER_G.carbs * carbs;

  return {
    ok: true,
    status: "recommended",
    goalType: goalKey,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories,
    protein,
    fat,
    carbs,
    calculationMetadata: {
      formulaVersion: NUTRITION_FORMULA_VERSION,
      bmrEquation: "mifflin-st-jeor",
      sex: sexKey,
      activityLevel: activityKey,
      activityMultiplier: multiplier,
      goalType: goalKey,
      adjustmentPercent: Math.round(rule.adjustment * 100),
      proteinPerKg: rule.proteinPerKg,
      fatPerKg: FAT_PER_KG,
      inputs: { age, heightCm, weightKg },
      unrounded: {
        bmr,
        tdee,
        calories: caloriesRaw,
        protein: proteinRaw,
        fat: fatRaw
      },
      // Calories implied by the rounded macros, and how far that is from the
      // calorie target. Carb rounding (5 g = 20 kcal steps) bounds this at 10 kcal.
      macroCalories,
      calorieDifference: macroCalories - calories
    }
  };
}


// --------------------------------------------------------------------------
// Applying (prepares data only; the caller decides whether and when to save)
// --------------------------------------------------------------------------

// True when a stored goal's four nutrition numbers equal the recommendation.
export function recommendationMatchesGoal(goal, recommendation) {
  if (!goal || !recommendation?.ok) return false;

  return ["calories", "protein", "carbs", "fat"].every(
    field => Number(goal[field]) === recommendation[field] && goal[field] !== null && goal[field] !== ""
  );
}

const NUTRITION_FIELDS = ["calories", "protein", "carbs", "fat"];

const sameNumber = (a, b) => {
  const empty = v => v === null || v === undefined || v === "";

  if (empty(a) && empty(b)) return true;
  if (empty(a) || empty(b)) return false;

  return Number(a) === Number(b);
};

// When a goal is saved through the normal form (manual numbers), decide which
// metadata fields to merge. Returns {} when nothing should change, so existing
// goals saved unchanged are left exactly as they were.
//
//   new goal                                  -> source "manual"
//   existing "recommended" goal, nothing changed -> {} (keeps its metadata)
//   existing "recommended" goal, numbers or type changed -> back to "manual"
//   legacy / manual goal, numbers changed     -> source "manual"
//   legacy / manual goal, numbers unchanged   -> {}
export function resolveNutritionSource(existingGoal, savedGoal) {
  const manual = {
    nutritionSource: "manual",
    nutritionAppliedAt: null,
    calculatedFromWeightKg: null,
    calculatedFromGoal: null,
    nutritionFormulaVersion: null
  };

  if (!existingGoal) {
    return { nutritionSource: "manual" };
  }

  const numbersChanged = NUTRITION_FIELDS.some(
    field => !sameNumber(existingGoal[field], savedGoal?.[field])
  );

  const typeChanged = toGoalKey(existingGoal.goalType) !== toGoalKey(savedGoal?.goalType);

  if (existingGoal.nutritionSource === "recommended") {
    return numbersChanged || typeChanged ? manual : {};
  }

  return numbersChanged ? { nutritionSource: "manual" } : {};
}

// The fields to write onto a goal when the user applies a recommendation.
// Only the existing nutrition fields plus light metadata; returns a new object.
export function buildAppliedNutritionFields(recommendation, now = new Date()) {
  if (!recommendation?.ok) {
    throw new TypeError("buildAppliedNutritionFields: needs a successful recommendation");
  }

  return {
    calories: recommendation.calories,
    protein: recommendation.protein,
    carbs: recommendation.carbs,
    fat: recommendation.fat,
    nutritionSource: "recommended",
    nutritionAppliedAt: new Date(now).toISOString(),
    calculatedFromWeightKg: recommendation.calculationMetadata.inputs.weightKg,
    calculatedFromGoal: recommendation.goalType,
    nutritionFormulaVersion: recommendation.calculationMetadata.formulaVersion
  };
}


// --------------------------------------------------------------------------
// Describing a SAVED target (read-only; no calculation, nothing is changed)
// --------------------------------------------------------------------------

const savedNumber = value => {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : null;
};

// Calories implied by a goal's protein, carbs and fat (4 / 4 / 9 kcal per g);
// null unless all three are saved numbers.
export function macroCaloriesOf(goal) {
  const protein = savedNumber(goal?.protein);
  const carbs = savedNumber(goal?.carbs);
  const fat = savedNumber(goal?.fat);

  if (protein === null || carbs === null || fat === null) return null;

  return KCAL_PER_G.protein * protein + KCAL_PER_G.carbs * carbs + KCAL_PER_G.fat * fat;
}

// How the current goal's saved target should be presented.
//   kind  "recommended"  the numbers came from APPLYING a recommendation
//         "custom"       anything the user typed (Custom goal, edited numbers,
//                        or a goal saved before nutrition metadata existed)
// `currentWeightKg` (from currentWeight.js) is only compared with the weight the
// target was calculated from, to say the target may be out of date. The saved
// target is never recalculated or rewritten here.
// macroNote is set only for custom targets whose macros are not reasonably close
// to their calories (more than 10% apart).
export function describeNutritionTarget(goal, currentWeightKg = null) {
  if (!goal) return null;

  const values = {
    calories: savedNumber(goal.calories),
    protein: savedNumber(goal.protein),
    carbs: savedNumber(goal.carbs),
    fat: savedNumber(goal.fat)
  };

  const hasTargets = Object.values(values).some(value => value !== null);
  const kind = goal.nutritionSource === "recommended" ? "recommended" : "custom";

  const result = {
    goalType: goal.goalType || "Custom",
    values,
    hasTargets,
    kind,
    basis: null,
    weightChangedFromKg: null,
    macroGap: null
  };

  if (kind === "recommended") {
    const rule = GOAL_RULES[toGoalKey(goal.calculatedFromGoal)];
    const basedOn = positiveNumber(goal.calculatedFromWeightKg);
    const now = positiveNumber(currentWeightKg);

    result.basis = {
      adjustmentPercent: rule ? Math.round(rule.adjustment * 100) : null,
      proteinPerKg: rule ? rule.proteinPerKg : null,
      basedOnWeightKg: basedOn,
      appliedDate: goal.nutritionAppliedAt ? String(goal.nutritionAppliedAt).slice(0, 10) : null
    };

    // 1 kg or more since the numbers were calculated: worth a second look.
    if (basedOn !== null && now !== null && Math.abs(now - basedOn) >= 1) {
      result.weightChangedFromKg = basedOn;
    }
  } else {
    const macros = macroCaloriesOf(goal);

    if (macros !== null && values.calories !== null && values.calories > 0) {
      const gap = Math.abs(macros - values.calories);

      if (gap > values.calories * 0.1) {
        result.macroGap = { macroCalories: Math.round(macros), calories: values.calories };
      }
    }
  }

  return result;
}
