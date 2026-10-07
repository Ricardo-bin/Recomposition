// ============================================================================
// Smart Alternatives ranking (smartAlternatives.js): pure and deterministic.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createExerciseLibrary } from "../data/exerciseLibrary.js";
import {
  rankAlternatives,
  scoreAlternative,
  DEFAULT_RECOMMENDATION_LIMIT
} from "../smartAlternatives.js";

const here = dirname(fileURLToPath(import.meta.url));

const library = createExerciseLibrary({
  loadJson: async () =>
    JSON.parse(readFileSync(resolve(here, "..", "data", "exercise-library.v1.json"), "utf8"))
});

const all = await library.getAllExercises();
const get = id => all.find(e => e.id === id);
const ids = list => list.map(e => e.id);

const ex = (id, over = {}) => ({
  id,
  name: id,
  primaryMuscles: ["chest"],
  secondaryMuscles: [],
  equipment: ["dumbbell"],
  resistanceType: "free-weight",
  movementPattern: "horizontal-push",
  laterality: "bilateral",
  alternativeIds: [],
  status: "active",
  ...over
});


test("deterministic: the same input always gives the same ordered output", () => {
  for (const exercise of all) {
    const a = ids(rankAlternatives(exercise, all, { limit: 0 }));
    const b = ids(rankAlternatives(exercise, [...all], { limit: 0 }));

    assert.deepEqual(a, b, exercise.id);
  }
});

test("input order of unrelated ties is the library order (not random)", () => {
  const original = ex("o", { alternativeIds: [] });
  const list = [ex("c"), ex("a"), ex("b")];

  assert.deepEqual(ids(rankAlternatives(original, list)), ["c", "a", "b"]);
});

test("the original exercise is never recommended", () => {
  for (const exercise of all) {
    assert.ok(!ids(rankAlternatives(exercise, all, { limit: 0 })).includes(exercise.id), exercise.id);
  }
});

test("explicit alternativeIds come first, in their curated order", () => {
  const bench = get("barbell-bench-press");
  const result = ids(rankAlternatives(bench, all, { limit: 0 }));

  assert.deepEqual(result.slice(0, bench.alternativeIds.length), bench.alternativeIds);
});

test("Bench Press: dumbbell, machine and Smith bench presses lead", () => {
  const top = ids(rankAlternatives(get("barbell-bench-press"), all));

  assert.deepEqual(top.slice(0, 3), [
    "dumbbell-flat-bench-press",
    "seated-machine-chest-press",
    "flat-smith-machine-bench-press"
  ]);
  assert.equal(top.length, DEFAULT_RECOMMENDATION_LIMIT);
});

test("without explicit links: same pattern beats similar pattern beats muscle-only", () => {
  const original = ex("o", { primaryMuscles: ["chest"], movementPattern: "horizontal-push" });

  const samePattern = ex("same", { movementPattern: "horizontal-push" });
  const similar = ex("similar", { movementPattern: "horizontal-adduction" });
  const muscleOnly = ex("muscle", { movementPattern: "vertical-pull" });

  assert.deepEqual(
    ids(rankAlternatives(original, [muscleOnly, similar, samePattern])),
    ["same", "similar", "muscle"]
  );
});

test("then more shared primary muscles, then equipment, then laterality", () => {
  const original = ex("o", {
    primaryMuscles: ["quadriceps", "glutes"],
    equipment: ["barbell"],
    resistanceType: "free-weight",
    movementPattern: "squat"
  });

  const both = ex("both", { primaryMuscles: ["quadriceps", "glutes"], equipment: ["smith-machine"], resistanceType: "machine", movementPattern: "squat" });
  const one = ex("one", { primaryMuscles: ["quadriceps"], equipment: ["barbell"], movementPattern: "squat" });

  assert.deepEqual(ids(rankAlternatives(original, [one, both])), ["both", "one"]);

  const sameEquipment = ex("sameEq", { primaryMuscles: ["quadriceps"], equipment: ["barbell"], movementPattern: "squat" });
  const otherEquipment = ex("otherEq", { primaryMuscles: ["quadriceps"], equipment: ["smith-machine"], resistanceType: "machine", movementPattern: "squat" });

  assert.deepEqual(
    ids(rankAlternatives({ ...original, primaryMuscles: ["quadriceps"] }, [otherEquipment, sameEquipment])),
    ["sameEq", "otherEq"]
  );

  const bilateral = ex("bi", { primaryMuscles: ["quadriceps"], movementPattern: "squat", equipment: ["barbell"] });
  const unilateral = ex("uni", { primaryMuscles: ["quadriceps"], movementPattern: "squat", equipment: ["barbell"], laterality: "unilateral" });

  assert.deepEqual(
    ids(rankAlternatives({ ...original, primaryMuscles: ["quadriceps"] }, [unilateral, bilateral])),
    ["bi", "uni"]
  );

  // Unilateral originals prefer unilateral replacements.
  assert.deepEqual(
    ids(rankAlternatives({ ...original, primaryMuscles: ["quadriceps"], laterality: "unilateral" }, [bilateral, unilateral])),
    ["uni", "bi"]
  );
});

test("an exercise sharing no primary muscle is never recommended (unless curated)", () => {
  const original = ex("o", { primaryMuscles: ["chest"] });
  const squat = ex("sq", { primaryMuscles: ["quadriceps"], movementPattern: "horizontal-push" });

  assert.deepEqual(rankAlternatives(original, [squat]), []);
  assert.deepEqual(ids(rankAlternatives({ ...original, alternativeIds: ["sq"] }, [squat])), ["sq"]);

  // Real data: no leg exercise is offered for the bench press.
  const top = rankAlternatives(get("barbell-bench-press"), all, { limit: 0 });

  assert.ok(top.every(e => e.primaryMuscles.some(m => get("barbell-bench-press").primaryMuscles.includes(m)) ||
    get("barbell-bench-press").alternativeIds.includes(e.id)));
});

test("deprecated exercises and excludeIds are skipped", () => {
  const original = ex("o", { alternativeIds: ["dead", "skip", "ok"] });
  const list = [ex("dead", { status: "deprecated" }), ex("skip"), ex("ok")];

  assert.deepEqual(ids(rankAlternatives(original, list, { excludeIds: ["skip"] })), ["ok"]);
});

test("limit: default 5, custom N, 0 means all", () => {
  const original = get("barbell-bench-press");

  assert.equal(rankAlternatives(original, all).length, 5);
  assert.equal(rankAlternatives(original, all, { limit: 2 }).length, 2);
  assert.ok(rankAlternatives(original, all, { limit: 0 }).length > 5);
});

test("every library exercise except isolated ones gets recommendations", () => {
  const none = all.filter(e => rankAlternatives(e, all).length === 0).map(e => e.id);

  assert.deepEqual(none, ["tibialis-anterior-raise"]);
});

test("a recommendation never recommends the exercise back through excludeIds of the session", () => {
  const original = get("barbell-bench-press");
  const taken = ["dumbbell-flat-bench-press"];

  const result = ids(rankAlternatives(original, all, { excludeIds: taken }));

  assert.ok(!result.includes(taken[0]));
  assert.equal(result[0], "seated-machine-chest-press");
});

test("pure: arguments (even frozen) are not mutated; bad input returns []", () => {
  const original = get("pull-up");
  const before = JSON.stringify(all);

  rankAlternatives(original, all, { limit: 0 });

  assert.equal(JSON.stringify(all), before);
  assert.deepEqual(rankAlternatives(null, all), []);
  assert.deepEqual(rankAlternatives(original, null), []);
  assert.deepEqual(rankAlternatives({}, []), []);
});

test("scoreAlternative exposes the comparable facts", () => {
  const score = scoreAlternative(get("barbell-bench-press"), get("dumbbell-flat-bench-press"));

  assert.equal(score.explicitIndex, 0);
  assert.equal(score.pattern, 2);
  assert.equal(score.primaryOverlap, 1);
  assert.equal(score.laterality, 1);
});

test("bodyweight exercises count as equipment-compatible with each other", () => {
  const a = ex("a", { equipment: [], resistanceType: "bodyweight" });
  const b = ex("b", { equipment: [], resistanceType: "bodyweight" });
  const c = ex("c", { equipment: ["barbell"], resistanceType: "free-weight" });

  assert.deepEqual(ids(rankAlternatives(a, [c, b])), ["b", "c"]);
});
