// ============================================================================
// Tests for nutritionEngine.js (pure calculation module). No DOM, no Firebase.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NUTRITION_FORMULA_VERSION, ACTIVITY_MULTIPLIERS, GOAL_RULES, FAT_PER_KG, GOAL_KEYS, LIMITS,
  toGoalKey, toActivityKey, toSexKey, isCustomGoal, isCalculableGoal, roundTo,
  calculateBmr, pickCurrentWeightKg, buildNutritionInput,
  calculateNutritionRecommendation as calc,
  recommendationMatchesGoal, buildAppliedNutritionFields, resolveNutritionSource
} from "../nutritionEngine.js";

import { displayToKg, kgToDisplay } from "../units.js";

const here = dirname(fileURLToPath(import.meta.url));

const base = (over = {}) => ({
  age: 30, sex: "male", heightCm: 175, weightKg: 80,
  activityLevel: "moderately-active", goalType: "maintenance", ...over
});

const pick = r => [r.bmr, r.tdee, r.calories, r.protein, r.fat, r.carbs];
const codes = r => r.errors.map(e => `${e.field}:${e.code}`).sort();

// Independent oracle: plain arithmetic, written separately from the engine.
const ORACLE_MULT = { "sedentary": 1.2, "lightly-active": 1.375, "moderately-active": 1.55, "very-active": 1.725, "extremely-active": 1.9 };
const ORACLE_ADJ = { "maintenance": 0, "recomposition": 0, "lean-bulk": 0.05, "bulk": 0.10, "cut": -0.15, "fat-loss": -0.20 };
const nearest = (v, s) => Math.floor(v / s + 0.5) * s;
function oracle({ sex, age, heightCm: h, weightKg: w, activityLevel, goalType }) {
  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === "male" ? 5 : -161);
  const tdee = bmr * ORACLE_MULT[activityLevel];
  const cal = nearest(tdee * (1 + ORACLE_ADJ[goalType]), 10);
  const pr = nearest((goalType === "cut" || goalType === "fat-loss" ? 2.0 : 1.8) * w, 5);
  const fa = nearest(0.8 * w, 5);
  return { calories: cal, protein: pr, fat: fa, carbs: nearest((cal - 4 * pr - 9 * fa) / 4, 5) };
}


// ----------------------------------------------------------------------------
// BMR (Mifflin-St Jeor)
// ----------------------------------------------------------------------------

test("male BMR = 10w + 6.25h - 5a + 5", () => {
  assert.equal(calculateBmr({ sex: "male", weightKg: 80, heightCm: 175, age: 30 }), 1748.75);
  assert.equal(calculateBmr({ sex: "male", weightKg: 70, heightCm: 180, age: 25 }), 700 + 1125 - 125 + 5);
});

test("female BMR = 10w + 6.25h - 5a - 161", () => {
  assert.equal(calculateBmr({ sex: "female", weightKg: 60, heightCm: 165, age: 28 }), 1330.25);   // 600 + 1031.25 - 140 - 161
  assert.equal(calculateBmr({ sex: "female", weightKg: 80, heightCm: 175, age: 30 }), 1748.75 - 166);
});

test("male and female BMR differ by exactly 166 for identical inputs", () => {
  const m = calculateBmr({ sex: "male", weightKg: 75, heightCm: 170, age: 40 });
  const f = calculateBmr({ sex: "female", weightKg: 75, heightCm: 170, age: 40 });

  assert.equal(m - f, 166);
});

test("calculateBmr never guesses a coefficient for any other sex value", () => {
  for (const sex of ["other", "prefer-not-to-say", "", undefined, null, "MALE"]) {
    assert.throws(() => calculateBmr({ sex, weightKg: 70, heightCm: 170, age: 30 }), RangeError, String(sex));
  }
});

test("BMR reported in the result matches the hand calculation", () => {
  assert.equal(calc(base()).bmr, 1749);                                  // 1748.75
  assert.equal(calc(base({ sex: "female", weightKg: 60, heightCm: 165, age: 28, activityLevel: "lightly-active", goalType: "cut" })).bmr, 1330); // 1330.25
});


// ----------------------------------------------------------------------------
// OTHER / PREFER NOT TO SAY
// ----------------------------------------------------------------------------

test("Other / Prefer not to say: no BMR, no numbers, clear error", () => {
  for (const sex of ["Other", "other", "Prefer not to say", "prefer-not-to-say"]) {
    const r = calc(base({ sex }));

    assert.equal(r.ok, false, sex);
    assert.equal(r.status, "invalid");
    assert.deepEqual(codes(r), ["sex:unsupported"]);
    assert.match(r.errors[0].message, /Male or Female/);
    assert.match(r.errors[0].message, /Custom goal/);
    for (const key of ["bmr", "tdee", "calories", "protein", "fat", "carbs"]) {
      assert.equal(key in r, false, `${key} must not exist`);
    }
  }
});

test("missing sex is its own error", () => {
  for (const sex of ["", undefined, null, "  "]) {
    assert.deepEqual(codes(calc(base({ sex }))), ["sex:missing"]);
  }
});

test("profile label strings are accepted (Male / Female)", () => {
  assert.equal(calc(base({ sex: "Male" })).ok, true);
  assert.equal(calc(base({ sex: "Female" })).ok, true);
});


// ----------------------------------------------------------------------------
// ACTIVITY LEVELS
// ----------------------------------------------------------------------------

test("the five activity multipliers are exactly the v1 values", () => {
  assert.deepEqual({ ...ACTIVITY_MULTIPLIERS }, {
    "sedentary": 1.2, "lightly-active": 1.375, "moderately-active": 1.55,
    "very-active": 1.725, "extremely-active": 1.9
  });
});

test("TDEE = BMR x multiplier for every activity level", () => {
  const bmr = 1748.75;

  for (const [level, multiplier] of Object.entries(ACTIVITY_MULTIPLIERS)) {
    const r = calc(base({ activityLevel: level }));

    assert.equal(r.tdee, Math.round(bmr * multiplier), level);
    assert.equal(r.calculationMetadata.activityMultiplier, multiplier);
    assert.equal(r.calculationMetadata.unrounded.tdee, bmr * multiplier);
  }
});

test("profile activity labels map to the right level", () => {
  const labels = { "Sedentary": 1.2, "Lightly active": 1.375, "Moderately active": 1.55, "Very active": 1.725, "Extremely active": 1.9 };

  for (const [label, multiplier] of Object.entries(labels)) {
    assert.equal(toActivityKey(label) in ACTIVITY_MULTIPLIERS, true, label);
    assert.equal(calc(base({ activityLevel: label })).calculationMetadata.activityMultiplier, multiplier);
  }
});

test("a workout never adds calories on top of activity level (v1 rule)", () => {
  const withExtra = calc({ ...base(), workoutsPerWeek: 6, trainedToday: true, caloriesBurned: 500 });

  assert.deepEqual(pick(withExtra), pick(calc(base())));
});


// ----------------------------------------------------------------------------
// GOAL MODES
// ----------------------------------------------------------------------------

test("goal rules are exactly the v1 percentages and protein multipliers", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(GOAL_RULES).map(([k, v]) => [k, [v.adjustment, v.proteinPerKg]])),
    {
      "maintenance": [0, 1.8], "recomposition": [0, 1.8], "lean-bulk": [0.05, 1.8],
      "bulk": [0.10, 1.8], "cut": [-0.15, 2.0], "fat-loss": [-0.20, 2.0]
    }
  );
  assert.equal(FAT_PER_KG, 0.8);
  assert.deepEqual([...GOAL_KEYS].sort(), ["bulk", "custom", "cut", "fat-loss", "lean-bulk", "maintenance", "recomposition"]);
});

test("each calculated goal mode against hand-computed values", () => {
  // male 30y 175cm 80kg moderately active: BMR 1748.75, TDEE 2710.5625
  // carbs = (calories - 4*protein - 9*fat) / 4, rounded to 5 g
  const expect = {
    "maintenance":   [2710, 145, 65, 385],   // x1.00 = 2710.56 -> 2710; (2710-580-585)/4 = 386.25
    "recomposition": [2710, 145, 65, 385],
    "lean-bulk":     [2850, 145, 65, 420],   // x1.05 = 2846.09 -> 2850; (2850-580-585)/4 = 421.25
    "bulk":          [2980, 145, 65, 455],   // x1.10 = 2981.62 -> 2980; (2980-580-585)/4 = 453.75
    "cut":           [2300, 160, 65, 270],   // x0.85 = 2303.98 -> 2300; protein 2.0*80; (2300-640-585)/4 = 268.75
    "fat-loss":      [2170, 160, 65, 235]    // x0.80 = 2168.45 -> 2170; (2170-640-585)/4 = 236.25
  };

  for (const [goalType, [calories, protein, fat, carbs]] of Object.entries(expect)) {
    const r = calc(base({ goalType }));

    assert.deepEqual([r.calories, r.protein, r.fat, r.carbs], [calories, protein, fat, carbs], goalType);
    assert.equal(r.goalType, goalType);
  }
});

test("Maintenance and Recomposition give identical numbers; others differ from maintenance in the right direction", () => {
  const m = calc(base({ goalType: "maintenance" }));

  assert.deepEqual(pick(calc(base({ goalType: "recomposition" }))), pick(m));
  assert.ok(calc(base({ goalType: "lean-bulk" })).calories > m.calories);
  assert.ok(calc(base({ goalType: "bulk" })).calories > calc(base({ goalType: "lean-bulk" })).calories);
  assert.ok(calc(base({ goalType: "cut" })).calories < m.calories);
  assert.ok(calc(base({ goalType: "fat-loss" })).calories < calc(base({ goalType: "cut" })).calories);
});

test("goal labels from the Goals screen are accepted ('Lean Bulk', 'Fat Loss', ...)", () => {
  for (const label of ["Maintenance", "Recomposition", "Lean Bulk", "Bulk", "Cut", "Fat Loss"]) {
    assert.equal(calc(base({ goalType: label })).ok, true, label);
    assert.equal(isCalculableGoal(label), true);
  }
  assert.equal(toGoalKey("Lean Bulk"), "lean-bulk");
  assert.equal(toGoalKey("Fat Loss"), "fat-loss");
});

test("metadata records exactly how the numbers were produced", () => {
  const { calculationMetadata: m } = calc(base({ goalType: "lean-bulk" }));

  assert.equal(m.formulaVersion, "nutrition-v1");
  assert.equal(NUTRITION_FORMULA_VERSION, "nutrition-v1");
  assert.equal(m.bmrEquation, "mifflin-st-jeor");
  assert.equal(m.adjustmentPercent, 5);
  assert.equal(m.proteinPerKg, 1.8);
  assert.equal(m.fatPerKg, 0.8);
  assert.deepEqual(m.inputs, { age: 30, heightCm: 175, weightKg: 80 });
});


// ----------------------------------------------------------------------------
// CUSTOM
// ----------------------------------------------------------------------------

test("Custom is never calculated, even with complete valid data", () => {
  for (const goalType of ["Custom", "custom", " CUSTOM "]) {
    const r = calc(base({ goalType }));

    assert.equal(r.ok, false);
    assert.equal(r.status, "manual");
    assert.deepEqual(codes(r), ["goalType:custom-goal"]);
    assert.equal("calories" in r, false);
    assert.equal(isCustomGoal(goalType), true);
    assert.equal(isCalculableGoal(goalType), false);
  }
});

test("Custom ignores invalid body data (nothing to validate for a manual goal)", () => {
  const r = calc({ goalType: "Custom" });

  assert.equal(r.status, "manual");
  assert.equal(r.errors.length, 1);
});


// ----------------------------------------------------------------------------
// MACROS
// ----------------------------------------------------------------------------

test("protein: 1.8 g/kg for maintenance, recomposition, lean bulk, bulk", () => {
  for (const goalType of ["maintenance", "recomposition", "lean-bulk", "bulk"]) {
    const r = calc(base({ goalType, weightKg: 80 }));

    assert.equal(r.calculationMetadata.unrounded.protein, 144, goalType);
    assert.equal(r.protein, 145);
  }
});

test("protein: 2.0 g/kg for cut and fat loss", () => {
  for (const goalType of ["cut", "fat-loss"]) {
    const r = calc(base({ goalType, weightKg: 80 }));

    assert.equal(r.calculationMetadata.unrounded.protein, 160, goalType);
    assert.equal(r.protein, 160);
  }
});

test("fat: 0.8 g/kg for every calculated goal", () => {
  for (const goalType of Object.keys(GOAL_RULES)) {
    const r = calc(base({ goalType, weightKg: 75 }));

    assert.equal(r.calculationMetadata.unrounded.fat, 60, goalType);
    assert.equal(r.fat, 60);
  }
});

test("carbs are the remaining calories: (calories - 4*protein - 9*fat) / 4", () => {
  const r = calc(base());     // 2710 - 4*145 - 9*65 = 1545 -> 386.25 -> 385

  assert.equal(r.carbs, 385);

  const exact = calc(base({ weightKg: 70, goalType: "maintenance" }));
  const remainder = exact.calories - 4 * exact.protein - 9 * exact.fat;

  assert.ok(Math.abs(exact.carbs - remainder / 4) <= 2.5, "within carb rounding");
});

test("macros are internally consistent with the calorie target (within 10 kcal)", () => {
  for (const goalType of Object.keys(GOAL_RULES)) {
    for (const weightKg of [55, 62.5, 70, 71, 72, 80, 95, 120]) {
      const r = calc(base({ goalType, weightKg }));

      assert.equal(r.ok, true);

      const kcal = 4 * r.protein + 9 * r.fat + 4 * r.carbs;

      assert.ok(Math.abs(kcal - r.calories) <= 10, `${goalType} ${weightKg}: ${kcal} vs ${r.calories}`);
      assert.equal(r.calculationMetadata.macroCalories, kcal);
      assert.equal(r.calculationMetadata.calorieDifference, kcal - r.calories);
    }
  }
});


// ----------------------------------------------------------------------------
// ROUNDING
// ----------------------------------------------------------------------------

test("rounding: calories to 10 kcal, protein / fat / carbs to 5 g", () => {
  assert.equal(roundTo(2704, 10), 2700);
  assert.equal(roundTo(2705, 10), 2710);
  assert.equal(roundTo(2714.9, 10), 2710);
  assert.equal(roundTo(142.4, 5), 140);
  assert.equal(roundTo(142.5, 5), 145);
  assert.equal(roundTo(0, 5), 0);

  for (const goalType of Object.keys(GOAL_RULES)) {
    const r = calc(base({ goalType, weightKg: 73.3, age: 37, heightCm: 181 }));

    assert.equal(r.calories % 10, 0, "calories");
    assert.equal(r.protein % 5, 0, "protein");
    assert.equal(r.fat % 5, 0, "fat");
    assert.equal(r.carbs % 5, 0, "carbs");
    assert.ok(Number.isInteger(r.bmr) && Number.isInteger(r.tdee), "no excess precision");
  }
});

test("rounding is deterministic (same input -> identical output)", () => {
  const a = calc(base({ weightKg: 73.3 }));
  const b = calc(base({ weightKg: 73.3 }));

  assert.deepEqual(a, b);
});


// ----------------------------------------------------------------------------
// VALIDATION
// ----------------------------------------------------------------------------

test("missing inputs: every missing field is reported together, no numbers produced", () => {
  const r = calc({ goalType: "Cut" });

  assert.equal(r.ok, false);
  assert.equal(r.status, "invalid");
  assert.deepEqual(codes(r), [
    "activityLevel:missing", "age:missing", "heightCm:missing", "sex:missing", "weightKg:missing"
  ]);
  assert.ok(r.errors.every(e => e.message.length > 5));
});

test("calc with no argument at all is a clean validation error, not a crash", () => {
  const r = calc();

  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("goalType:missing"));
});

test("blank strings and null count as missing", () => {
  for (const blank of ["", "  ", null, undefined]) {
    const r = calc(base({ age: blank, heightCm: blank, weightKg: blank }));

    assert.deepEqual(codes(r), ["age:missing", "heightCm:missing", "weightKg:missing"]);
  }
});

test("non-numeric values are rejected", () => {
  for (const bad of ["abc", NaN, Infinity, -Infinity, {}, [], true]) {
    const r = calc(base({ weightKg: bad }));

    assert.equal(r.ok, false, String(bad));
    assert.ok(codes(r).some(c => c.startsWith("weightKg:")), String(bad));
  }
});

test("impossible values are rejected (age / height / weight limits)", () => {
  const cases = [
    [{ age: 17 }, "age:under-minimum"], [{ age: 0 }, "age:under-minimum"], [{ age: -5 }, "age:under-minimum"],
    [{ age: 101 }, "age:out-of-range"],
    [{ heightCm: 99 }, "heightCm:out-of-range"], [{ heightCm: 251 }, "heightCm:out-of-range"], [{ heightCm: 0 }, "heightCm:out-of-range"],
    [{ weightKg: 29.9 }, "weightKg:out-of-range"], [{ weightKg: 301 }, "weightKg:out-of-range"], [{ weightKg: 0 }, "weightKg:out-of-range"], [{ weightKg: -70 }, "weightKg:out-of-range"]
  ];

  for (const [over, code] of cases) {
    const r = calc(base(over));

    assert.equal(r.ok, false, JSON.stringify(over));
    assert.deepEqual(codes(r), [code], JSON.stringify(over));
  }
});

test("limits are inclusive at the boundaries", () => {
  for (const over of [
    { age: LIMITS.age.min }, { age: LIMITS.age.max },
    { heightCm: LIMITS.heightCm.min }, { heightCm: LIMITS.heightCm.max },
    { weightKg: LIMITS.weightKg.min }, { weightKg: LIMITS.weightKg.max }
  ]) {
    const r = calc(base({ ...over, goalType: "maintenance" }));

    assert.ok(r.ok || codes(r).every(c => c === "calories:carbs-negative"), JSON.stringify(over));
  }
});

test("under-18 gets an explanation that points to Custom goals", () => {
  const r = calc(base({ age: 16 }));

  assert.match(r.errors[0].message, /adults \(18\+\)/);
  assert.match(r.errors[0].message, /Custom goal/);
});

test("unknown activity level / goal type are rejected, not guessed", () => {
  assert.deepEqual(codes(calc(base({ activityLevel: "athlete" }))), ["activityLevel:unknown"]);
  assert.deepEqual(codes(calc(base({ activityLevel: "" }))), ["activityLevel:missing"]);
  assert.deepEqual(codes(calc(base({ goalType: "Shred" }))), ["goalType:unknown"]);
  assert.deepEqual(codes(calc(base({ goalType: "" }))), ["goalType:missing"]);
});

test("numeric strings from forms / old documents are accepted", () => {
  const fromStrings = calc(base({ age: "30", heightCm: "175", weightKg: "80" }));

  assert.deepEqual(pick(fromStrings), pick(calc(base())));
});

test("invalid results contain no partial numbers", () => {
  const r = calc(base({ weightKg: 5 }));

  for (const key of ["bmr", "tdee", "calories", "protein", "fat", "carbs", "calculationMetadata"]) {
    assert.equal(key in r, false, key);
  }
});


// ----------------------------------------------------------------------------
// NO NEGATIVE CARBS
// ----------------------------------------------------------------------------

test("an edge case that would give negative carbs returns a clear error", () => {
  // Small, old, sedentary woman on a fat-loss goal at the highest allowed weight
  // ratio is rarely negative; find the real edge by search, then assert the contract.
  let found = null;

  outer:
  for (const weightKg of [300, 250, 200, 150]) {
    for (const age of [100, 90, 80]) {
      for (const heightCm of [100, 110]) {
        const r = calc({ age, sex: "female", heightCm, weightKg, activityLevel: "sedentary", goalType: "fat-loss" });

        if (!r.ok && r.errors.some(e => e.code === "carbs-negative")) { found = r; break outer; }
      }
    }
  }

  assert.ok(found, "this input family must hit the negative-carb guard");
  assert.equal(found.status, "invalid");
  assert.match(found.errors[0].message, /too low/);
  assert.equal("carbs" in found, false);
});

test("across a large input grid: carbs are never negative and every result is valid or a clean error", () => {
  let ok = 0, guarded = 0;

  for (const sex of ["male", "female"]) {
    for (const age of [18, 25, 40, 60, 100]) {
      for (const heightCm of [100, 150, 175, 200, 250]) {
        for (const weightKg of [30, 45, 60, 80, 110, 160, 300]) {
          for (const activityLevel of Object.keys(ACTIVITY_MULTIPLIERS)) {
            for (const goalType of Object.keys(GOAL_RULES)) {
              const r = calc({ sex, age, heightCm, weightKg, activityLevel, goalType });

              if (r.ok) {
                ok += 1;
                assert.ok(r.carbs >= 0 && r.protein > 0 && r.fat > 0 && r.calories > 0);
                assert.ok(Math.abs(4 * r.protein + 9 * r.fat + 4 * r.carbs - r.calories) <= 10);
              } else {
                guarded += 1;
                assert.equal(r.status, "invalid");
                assert.deepEqual(r.errors.map(e => e.code), ["carbs-negative"]);
              }
            }
          }
        }
      }
    }
  }

  assert.ok(ok > 5000 && guarded > 0, `ok=${ok} guarded=${guarded}`);
});

test("engine agrees with an independently written oracle on thousands of inputs", () => {
  let checked = 0;

  for (const sex of ["male", "female"]) {
    for (const age of [19, 33, 52]) {
      for (const heightCm of [152, 168, 183]) {
        for (let weightKg = 50; weightKg <= 130; weightKg += 2.5) {
          for (const activityLevel of Object.keys(ACTIVITY_MULTIPLIERS)) {
            for (const goalType of Object.keys(GOAL_RULES)) {
              const input = { sex, age, heightCm, weightKg, activityLevel, goalType };
              const r = calc(input);
              const o = oracle(input);

              if (o.calories - 4 * o.protein - 9 * o.fat < 0) {
                // The oracle also sees no valid carbs: the engine must refuse.
                assert.equal(r.ok, false, JSON.stringify(input));
                assert.deepEqual(r.errors.map(e => e.code), ["carbs-negative"]);
              } else {
                assert.equal(r.ok, true, JSON.stringify(input));
                assert.deepEqual(
                  { calories: r.calories, protein: r.protein, fat: r.fat, carbs: r.carbs },
                  o,
                  JSON.stringify(input)
                );
              }

              checked += 1;
            }
          }
        }
      }
    }
  }

  assert.ok(checked > 5000, `checked ${checked}`);
});


// ----------------------------------------------------------------------------
// WEIGHT CHANGES
// ----------------------------------------------------------------------------

test("70 -> 71 -> 72 kg each produce a new recommendation from the current weight", () => {
  const at = weightKg => calc(base({ weightKg, goalType: "lean-bulk" }));

  assert.deepEqual(pick(at(70)), [1649, 2556, 2680, 125, 55, 420]);
  assert.deepEqual(pick(at(71)), [1659, 2571, 2700, 130, 55, 420]);
  assert.deepEqual(pick(at(72)), [1669, 2587, 2720, 130, 60, 415]);

  assert.ok(at(71).calories > at(70).calories);
  assert.ok(at(72).calories > at(71).calories);
});

test("a lower weight gives a lower recommendation", () => {
  assert.ok(calc(base({ weightKg: 78 })).calories < calc(base({ weightKg: 80 })).calories);
});

test("pickCurrentWeightKg: latest valid history entry wins; profile is the fallback", () => {
  const history = [
    { weight: 72, date: "2026-09-30" },
    { weight: 71, date: "2026-09-23" },
    { weight: 70, date: "2026-09-16" }
  ];

  assert.deepEqual(pickCurrentWeightKg(history, 65), { weightKg: 72, source: "weight-history", date: "2026-09-30" });
  assert.deepEqual(pickCurrentWeightKg([...history].reverse(), 65).weightKg, 72, "order of the list does not matter");
  assert.deepEqual(pickCurrentWeightKg([], 65), { weightKg: 65, source: "profile", date: null });
  assert.deepEqual(pickCurrentWeightKg(undefined, "65.5"), { weightKg: 65.5, source: "profile", date: null });
  assert.deepEqual(pickCurrentWeightKg([], null), { weightKg: null, source: null, date: null });
  assert.deepEqual(pickCurrentWeightKg(null, undefined), { weightKg: null, source: null, date: null });
});

test("pickCurrentWeightKg skips invalid entries and never mutates the history", () => {
  const history = Object.freeze([
    Object.freeze({ weight: "abc", date: "2026-10-02" }),
    Object.freeze({ weight: 0, date: "2026-10-01" }),
    Object.freeze({ weight: -5, date: "2026-09-30" }),
    Object.freeze({ weight: null, date: "2026-09-29" }),
    Object.freeze({ weight: "71.5", date: "2026-09-28" })
  ]);

  assert.equal(pickCurrentWeightKg(history, 65).weightKg, 71.5);
});

test("a single new weigh-in changes only the recommendation, never anything stored", () => {
  const goal = Object.freeze({ id: "g1", goalType: "Lean Bulk", calories: 2700, protein: 130, carbs: 420, fat: 55 });
  const before = JSON.stringify(goal);

  const r72 = calc(base({ weightKg: 72, goalType: goal.goalType }));

  assert.equal(r72.ok, true);
  assert.equal(JSON.stringify(goal), before, "the active goal is untouched");
  assert.equal(recommendationMatchesGoal(goal, r72), false, "recommendation differs from active");
});

test("buildNutritionInput maps a stored profile to engine input", () => {
  const profile = { age: 30, sex: "Male", height: 175, activityLevel: "Moderately active", currentWeight: 99 };

  assert.deepEqual(buildNutritionInput({ profile, weightKg: 80, goalType: "Cut" }), {
    age: 30, sex: "Male", heightCm: 175, weightKg: 80, activityLevel: "Moderately active", goalType: "Cut"
  });
  assert.equal(calc(buildNutritionInput({ profile, weightKg: 80, goalType: "Maintenance" })).calories, 2710);
});


// ----------------------------------------------------------------------------
// kg / lb COMPATIBILITY
// ----------------------------------------------------------------------------

test("a weight typed in pounds is converted to kg, so lb and kg give the same recommendation", () => {
  const kgFromLb = displayToKg(176.37, "lb");        // ~80 kg

  assert.equal(kgFromLb, 80);

  assert.deepEqual(
    pick(calc(base({ weightKg: kgFromLb }))),
    pick(calc(base({ weightKg: 80 })))
  );
});

test("the engine consumes kilograms only: pounds fed in directly are NOT silently converted", () => {
  const asKg = calc(base({ weightKg: 80 }));
  const poundsAsIfKg = calc(base({ weightKg: 176.37 }));

  assert.notDeepEqual(pick(poundsAsIfKg), pick(asKg), "caller must convert with units.js");
});

test("stored kg shown in lb and converted back reproduces the same calculation", () => {
  for (const kg of [60, 72.5, 80, 95.25]) {
    const asLb = kgToDisplay(kg, "lb");
    const back = displayToKg(asLb, "lb");

    assert.deepEqual(pick(calc(base({ weightKg: back }))), pick(calc(base({ weightKg: kg }))), `${kg} kg`);
  }
});


// ----------------------------------------------------------------------------
// PURITY: recommendation never modifies anything
// ----------------------------------------------------------------------------

test("the engine never mutates its input (deeply frozen input works)", () => {
  const input = Object.freeze(base());

  assert.doesNotThrow(() => calc(input));
  assert.deepEqual(input, base());
});

test("the engine module has no DOM, Firebase, storage or network access", () => {
  const source = readFileSync(resolve(here, "..", "nutritionEngine.js"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(!/^\s*import\s/m.test(code), "no imports at all");
  for (const forbidden of ["document", "window", "localStorage", "sessionStorage", "fetch(", "firebase", "firestore", "saveGoal", "setDoc", "updateDoc", "XMLHttpRequest"]) {
    assert.ok(!code.includes(forbidden), `must not reference ${forbidden}`);
  }
});

test("a recommendation is just data: calling the engine never produces a goal write", () => {
  const writes = [];
  const result = calc(base({ goalType: "cut" }));

  assert.equal(writes.length, 0);
  assert.equal(result.status, "recommended");
  assert.equal("id" in result, false, "not shaped like a goal document");
  assert.equal("nutritionSource" in result, false);
});


// ----------------------------------------------------------------------------
// APPLY HELPERS
// ----------------------------------------------------------------------------

test("buildAppliedNutritionFields prepares exactly the nutrition fields + light metadata", () => {
  const r = calc(base({ goalType: "lean-bulk", weightKg: 72 }));

  const fields = buildAppliedNutritionFields(r, new Date("2026-10-02T09:30:00Z"));

  assert.deepEqual(fields, {
    calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
    nutritionSource: "recommended",
    nutritionAppliedAt: "2026-10-02T09:30:00.000Z",
    calculatedFromWeightKg: 72,
    calculatedFromGoal: "lean-bulk",
    nutritionFormulaVersion: "nutrition-v1"
  });
  assert.ok(Object.values(fields).every(v => v !== undefined), "no undefined values for Firestore");
});

test("buildAppliedNutritionFields refuses a failed / manual result", () => {
  assert.throws(() => buildAppliedNutritionFields(calc(base({ goalType: "Custom" }))), TypeError);
  assert.throws(() => buildAppliedNutritionFields(calc(base({ sex: "Other" }))), TypeError);
  assert.throws(() => buildAppliedNutritionFields(null), TypeError);
});

test("recommendationMatchesGoal", () => {
  const r = calc(base());
  const same = { calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat };

  assert.equal(recommendationMatchesGoal(same, r), true);
  assert.equal(recommendationMatchesGoal({ ...same, fat: same.fat + 5 }, r), false);
  assert.equal(recommendationMatchesGoal({ ...same, carbs: null }, r), false);
  assert.equal(recommendationMatchesGoal({}, r), false);
  assert.equal(recommendationMatchesGoal(same, calc(base({ sex: "Other" }))), false);
});

test("resolveNutritionSource: legacy goals saved unchanged stay untouched", () => {
  const legacy = { goalType: "Cut", calories: 2200, protein: 160, carbs: 250, fat: 60 };

  assert.deepEqual(resolveNutritionSource(legacy, { ...legacy }), {});
  assert.deepEqual(resolveNutritionSource(legacy, { ...legacy, startDate: "2026-10-01" }), {});
  assert.deepEqual(resolveNutritionSource(legacy, { ...legacy, calories: 2300 }), { nutritionSource: "manual" });
  assert.deepEqual(resolveNutritionSource(legacy, { ...legacy, calories: null }), { nutritionSource: "manual" });
  assert.deepEqual(resolveNutritionSource(null, { goalType: "Cut" }), { nutritionSource: "manual" });
});

test("resolveNutritionSource: a recommended goal keeps its metadata only while unchanged", () => {
  const applied = { goalType: "Lean Bulk", calories: 2700, protein: 130, carbs: 420, fat: 55, nutritionSource: "recommended" };

  assert.deepEqual(resolveNutritionSource(applied, { ...applied }), {});
  assert.equal(resolveNutritionSource(applied, { ...applied, protein: 135 }).nutritionSource, "manual");
  assert.equal(resolveNutritionSource(applied, { ...applied, goalType: "Bulk" }).nutritionSource, "manual");
  assert.equal(resolveNutritionSource(applied, { ...applied, protein: 135 }).calculatedFromWeightKg, null);
  assert.equal(resolveNutritionSource({ ...applied, calories: "2700" }, { ...applied, calories: 2700 }).nutritionSource, undefined, "numeric strings compare as numbers");
});

test("normalisers", () => {
  assert.equal(toSexKey("Prefer not to say"), "prefer-not-to-say");
  assert.equal(toSexKey(undefined), "");
  assert.equal(toGoalKey(undefined), "");
  assert.equal(isCalculableGoal(""), false);
});
