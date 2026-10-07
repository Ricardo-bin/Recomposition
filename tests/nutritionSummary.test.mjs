// ============================================================================
// Phase 5: saved-target description + engine consistency (pure functions).
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateNutritionRecommendation, describeNutritionTarget, macroCaloriesOf, GOAL_KEYS
} from "../nutritionEngine.js";

const base = { age: 30, sex: "male", heightCm: 175, activityLevel: "moderately-active" };

test("every calculable goal: macros add up to the calorie target within 10 kcal, at any weight", () => {
  for (const goalType of GOAL_KEYS.filter(key => key !== "custom")) {
    for (const weightKg of [45, 62.5, 80, 101, 140]) {
      const r = calculateNutritionRecommendation({ ...base, weightKg, goalType });

      if (!r.ok) continue;                                  // refused (e.g. too-low calories) is allowed

      const total = 4 * r.protein + 4 * r.carbs + 9 * r.fat;

      assert.ok(Math.abs(total - r.calories) <= 10, `${goalType} ${weightKg} kg: ${total} vs ${r.calories}`);
      assert.ok([r.calories, r.protein, r.carbs, r.fat].every(Number.isFinite));
    }
  }
});

test("under 18, custom goals and missing data never produce a recommendation", () => {
  assert.equal(calculateNutritionRecommendation({ ...base, age: 17, weightKg: 70, goalType: "Cut" }).ok, false);
  assert.equal(calculateNutritionRecommendation({ ...base, weightKg: 70, goalType: "Custom" }).status, "manual");
  assert.equal(calculateNutritionRecommendation({ ...base, weightKg: null, goalType: "Cut" }).ok, false);
  assert.equal(calculateNutritionRecommendation({ ...base, weightKg: -5, goalType: "Cut" }).ok, false);
});

test("describeNutritionTarget: recommended target carries its basis; weight drift is only flagged", () => {
  const goal = {
    goalType: "Lean Bulk", nutritionSource: "recommended", calculatedFromGoal: "lean-bulk",
    calculatedFromWeightKg: 80, nutritionAppliedAt: "2026-09-01T10:00:00.000Z",
    calories: 2850, protein: 145, carbs: 420, fat: 65
  };
  const before = JSON.stringify(goal);

  const same = describeNutritionTarget(goal, 80.4);
  assert.equal(same.kind, "recommended");
  assert.equal(same.basis.adjustmentPercent, 5);
  assert.equal(same.basis.proteinPerKg, 1.8);
  assert.equal(same.basis.appliedDate, "2026-09-01");
  assert.equal(same.weightChangedFromKg, null);

  assert.equal(describeNutritionTarget(goal, 78.5).weightChangedFromKg, 80);
  assert.equal(describeNutritionTarget(goal, null).weightChangedFromKg, null);
  assert.equal(JSON.stringify(goal), before, "the saved goal is never modified");
});

test("describeNutritionTarget: custom / legacy targets, blanks and bad values never become NaN", () => {
  const custom = describeNutritionTarget({ goalType: "Custom", calories: "2400", protein: "", carbs: null, fat: "abc" });

  assert.equal(custom.kind, "custom");
  assert.deepEqual(custom.values, { calories: 2400, protein: null, carbs: null, fat: null });
  assert.equal(custom.macroGap, null);

  const empty = describeNutritionTarget({ goalType: "", calories: -5 });
  assert.equal(empty.hasTargets, false);
  assert.equal(empty.goalType, "Custom");
  assert.equal(describeNutritionTarget(null), null);
});

test("describeNutritionTarget: custom macros far from the calories are flagged, close ones are not", () => {
  assert.equal(macroCaloriesOf({ protein: 150, carbs: 250, fat: 70 }), 2230);
  assert.equal(macroCaloriesOf({ protein: 150, carbs: 250 }), null);

  assert.ok(describeNutritionTarget({ goalType: "Cut", calories: 2000, protein: 150, carbs: 100, fat: 50 }).macroGap);
  assert.equal(describeNutritionTarget({ goalType: "Cut", calories: 2230, protein: 150, carbs: 250, fat: 70 }).macroGap, null);
});
