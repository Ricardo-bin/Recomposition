// ============================================================================
// Exercise Library completion: the curated catalog (120) is the source of truth.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createExerciseLibrary, normalizeExerciseText } from "../data/exerciseLibrary.js";
import { PICKER_CATEGORIES, filterByCategory } from "../exercisePicker.js";

const here = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = resolve(here, "..", "data", "exercise-library.v1.json");
const raw = JSON.parse(readFileSync(LIBRARY_PATH, "utf8"));

const library = createExerciseLibrary({ loadJson: async () => JSON.parse(readFileSync(LIBRARY_PATH, "utf8")) });

// The supplied catalog (upper-case as supplied), in catalog order.
const CATALOG = [
  "BARBELL FLAT BENCH PRESS",
  "INCLINE BARBELL BENCH PRESS",
  "DUMBBELL FLAT BENCH PRESS",
  "INCLINE DUMBBELL BENCH PRESS",
  "SEATED MACHINE CHEST PRESS",
  "INCLINE MACHINE CHEST PRESS",
  "INCLINE SMITH MACHINE PRESS",
  "FLAT SMITH MACHINE BENCH PRESS",
  "HIGH-TO-LOW CABLE FLYE",
  "LOW-TO-HIGH CABLE FLYE",
  "SEATED CABLE FLYE",
  "PEC DECK FLYE",
  "WEIGHTED CHEST DIPS",
  "DEFICIT PUSH-UP",
  "NEUTRAL-GRIP LAT PULLDOWN",
  "WIDE-GRIP LAT PULLDOWN",
  "SINGLE-ARM CABLE LAT PULLDOWN",
  "WEIGHTED PULL-UP",
  "WEIGHTED CHIN-UP",
  "CHEST-SUPPORTED T-BAR ROW",
  "CHEST-SUPPORTED DUMBBELL ROW",
  "SEATED CABLE ROW",
  "BARBELL BENT-OVER ROW",
  "PENDLAY ROW",
  "MEADOWS ROW",
  "SINGLE-ARM DUMBBELL ROW",
  "SINGLE-ARM CABLE LAT ROW",
  "STRAIGHT-ARM CABLE PULLOVER",
  "DUMBBELL PULLOVER",
  "BARBELL SHRUG",
  "DUMBBELL SHRUG",
  "CHEST-SUPPORTED KELSO SHRUG",
  "SEATED DUMBBELL SHOULDER PRESS",
  "STANDING OVERHEAD BARBELL PRESS",
  "SEATED SMITH MACHINE SHOULDER PRESS",
  "SEATED MACHINE SHOULDER PRESS",
  "STANDING CABLE LATERAL RAISE",
  "BEHIND-THE-BACK CABLE LATERAL RAISE",
  "DUMBBELL LATERAL RAISE",
  "CHEST-SUPPORTED INCLINE LATERAL RAISE",
  "MACHINE LATERAL RAISE",
  "REVERSE PEC DECK",
  "INCLINE DUMBBELL REAR DELT FLYE",
  "CABLE REAR DELT FLYE",
  "STANDING CABLE FACE PULL",
  "BANDED FACE PULL",
  "INCLINE DUMBBELL CURL",
  "BAYESIAN CABLE CURL",
  "EZ-BAR PREACHER CURL",
  "DUMBBELL PREACHER CURL",
  "STANDING BARBELL CURL",
  "STANDING EZ-BAR CURL",
  "SEATED DUMBBELL CURL",
  "STANDING DUMBBELL HAMMER CURL",
  "CABLE ROPE HAMMER CURL",
  "CHEST-SUPPORTED SPIDER CURL",
  "SEATED CONCENTRATION CURL",
  "REVERSE-GRIP EZ-BAR CURL",
  "BEHIND-THE-BACK BARBELL WRIST CURL",
  "SEATED DUMBBELL WRIST EXTENSION",
  "OVERHEAD CABLE TRICEPS EXTENSION",
  "INCLINE DUMBBELL OVERHEAD EXTENSION",
  "EZ-BAR SKULLCRUSHER",
  "DUMBBELL SKULLCRUSHER",
  "STRAIGHT-BAR CABLE TRICEPS PUSHDOWN",
  "ROPE CABLE TRICEPS PUSHDOWN",
  "CROSS-BODY CABLE TRICEPS EXTENSION",
  "CLOSE-GRIP BARBELL BENCH PRESS",
  "SMITH MACHINE JM PRESS",
  "BARBELL JM PRESS",
  "WEIGHTED TRICEPS DIPS",
  "DIAMOND PUSH-UP",
  "BARBELL HIGH-BAR BACK SQUAT",
  "BARBELL FRONT SQUAT",
  "MACHINE HACK SQUAT",
  "PENDULUM SQUAT",
  "SMITH MACHINE SQUAT",
  "45-DEGREE LEG PRESS",
  "SINGLE-LEG PRESS",
  "BULGARIAN SPLIT SQUAT",
  "DUMBBELL WALKING LUNGE",
  "DUMBBELL REVERSE LUNGE",
  "DUMBBELL STEP-UP",
  "BODYWEIGHT SISSY SQUAT",
  "SEATED LEG EXTENSION",
  "DUMBBELL GOBLET SQUAT",
  "BARBELL ROMANIAN DEADLIFT",
  "DUMBBELL ROMANIAN DEADLIFT",
  "CONVENTIONAL BARBELL DEADLIFT",
  "TRAP BAR DEADLIFT",
  "SUMO DEADLIFT",
  "SEATED LEG CURL",
  "LYING LEG CURL",
  "NORDIC HAMSTRING CURL",
  "SWISS BALL LEG CURL",
  "45-DEGREE HYPEREXTENSION",
  "BARBELL HIP THRUST",
  "SINGLE-LEG DUMBBELL HIP THRUST",
  "CABLE PULL-THROUGH",
  "CABLE GLUTE KICKBACK",
  "SEATED MACHINE HIP ABDUCTION",
  "SEATED CABLE HIP ABDUCTION",
  "STANDING MACHINE CALF RAISE",
  "SMITH MACHINE STANDING CALF RAISE",
  "LEG PRESS CALF PRESS",
  "SINGLE-LEG DUMBBELL CALF RAISE",
  "SEATED MACHINE CALF RAISE",
  "TIBIALIS ANTERIOR RAISE",
  "HANGING LEG RAISE",
  "HANGING KNEE RAISE",
  "KNEELING CABLE CRUNCH",
  "DECLINE BENCH WEIGHTED CRUNCH",
  "AB WHEEL ROLLOUT",
  "SEATED MACHINE AB CRUNCH",
  "STANDING CABLE WOODCHOPPER",
  "WEIGHTED RUSSIAN TWIST",
  "STANDING PALLOF PRESS",
  "RKC PLANK",
  "BODYWEIGHT SIDE PLANK",
  "BODYWEIGHT DEAD BUG"
];

// Every id that existed before this expansion. They are permanent.
const ORIGINAL_IDS = [
  "barbell-back-squat",
  "leg-press",
  "hack-squat",
  "dumbbell-bulgarian-split-squat",
  "conventional-deadlift",
  "barbell-romanian-deadlift",
  "barbell-hip-thrust",
  "barbell-bench-press",
  "incline-dumbbell-press",
  "cable-chest-fly",
  "parallel-bar-dip",
  "barbell-overhead-press",
  "dumbbell-shoulder-press",
  "dumbbell-lateral-raise",
  "cable-triceps-pushdown",
  "pull-up",
  "lat-pulldown",
  "barbell-bent-over-row",
  "seated-cable-row",
  "face-pull",
  "dumbbell-biceps-curl",
  "leg-extension",
  "seated-leg-curl",
  "standing-calf-raise",
  "cable-crunch"
];

test("the final library contains exactly the supplied catalog, in catalog order", () => {
  assert.equal(CATALOG.length, 120);
  assert.deepEqual(raw.exercises.map(e => e.name.toUpperCase()), CATALOG);
});

test("existing exercise ids are unchanged, active and still resolve", async () => {
  assert.equal(ORIGINAL_IDS.length, 25);

  for (const id of ORIGINAL_IDS) {
    const exercise = await library.getExercise(id);

    assert.ok(exercise, id + " still exists");
    assert.equal(exercise.id, id);
    assert.equal(exercise.status, "active");
  }

  assert.equal(raw.exercises.length - ORIGINAL_IDS.length, 95, "95 genuinely new exercises");
});

test("legacy names still find their (renamed) exercise through aliases", async () => {
  const legacy = {
    "Barbell Bench Press": "barbell-bench-press",
    "Incline Dumbbell Press": "incline-dumbbell-press",
    "Hack Squat": "hack-squat",
    "Leg Press": "leg-press",
    "Lat Pulldown": "lat-pulldown",
    "Pull-Up": "pull-up",
    "Cable Chest Fly": "cable-chest-fly",
    "Parallel Bar Dip": "parallel-bar-dip",
    "Dumbbell Biceps Curl": "dumbbell-biceps-curl",
    "Cable Triceps Pushdown": "cable-triceps-pushdown",
    "Barbell Back Squat": "barbell-back-squat",
    "Conventional Deadlift": "conventional-deadlift",
    "Cable Face Pull": "face-pull",
    "Standing Calf Raise": "standing-calf-raise",
    "Cable Crunch": "cable-crunch",
    "Leg Extension": "leg-extension",
    "Dumbbell Shoulder Press": "dumbbell-shoulder-press",
    "Barbell Overhead Press": "barbell-overhead-press"
  };

  for (const [name, id] of Object.entries(legacy)) {
    assert.equal((await library.findExerciseByName(name))?.id, id, name);
  }
});

test("no duplicate ids, names or aliases (also after normalisation)", () => {
  const ids = raw.exercises.map(e => e.id);

  assert.equal(new Set(ids).size, ids.length);

  const claims = raw.exercises.flatMap(e => [e.name, ...e.aliases].map(t => normalizeExerciseText(t)));

  assert.equal(new Set(claims).size, claims.length, "every name/alias is unique");
});

test("metadata validates against the existing schema (project validator, no errors/warnings)", () => {
  const output = execFileSync(
    process.execPath,
    [resolve(here, "..", "scripts", "validate-exercise-library.mjs")],
    { encoding: "utf8" }
  );

  assert.match(output, /RESULT: PASSED — no errors, no warnings/);
});

test("every alternativeId resolves, is not the exercise itself and shares a primary muscle", () => {
  const byId = new Map(raw.exercises.map(e => [e.id, e]));

  for (const exercise of raw.exercises) {
    for (const id of exercise.alternativeIds) {
      assert.ok(byId.has(id), exercise.id + " -> " + id);
      assert.notEqual(id, exercise.id);
      assert.ok(
        exercise.primaryMuscles.some(m => byId.get(id).primaryMuscles.includes(m)),
        exercise.id + " -> " + id + " shares a primary muscle"
      );
    }
  }
});

test("required categories are represented and match the catalog sections", async () => {
  const all = await library.getAllExercises();

  for (const category of PICKER_CATEGORIES.slice(1)) {
    assert.ok(filterByCategory(all, category).length >= 6, category);
  }

  const sections = {"Chest":14,"Back & Lats":18,"Shoulders & Rear Delts":14,"Biceps & Forearms":14,"Triceps":12,"Quadriceps":14,"Hamstrings & Glutes":16,"Calves":6,"Core & Abs":12};
  const expected = { CHEST: sections.Chest, BACK: sections["Back & Lats"], SHOULDERS: sections["Shoulders & Rear Delts"], ARMS: sections["Biceps & Forearms"] + sections.Triceps, LEGS: sections.Quadriceps + sections["Hamstrings & Glutes"] + sections.Calves, CORE: sections["Core & Abs"] };

  for (const [category, count] of Object.entries(expected)) {
    assert.equal(filterByCategory(all, category).length, count, category);
  }
});

test("catalog muscles are not treated as exclusive: compounds have secondary muscles", async () => {
  const bench = await library.getExercise("barbell-bench-press");

  assert.deepEqual(bench.primaryMuscles, ["chest"]);
  assert.ok(bench.secondaryMuscles.includes("triceps"));

  const closeGrip = await library.getExercise("close-grip-barbell-bench-press");

  assert.deepEqual(closeGrip.primaryMuscles, ["triceps"]);
  assert.ok(closeGrip.secondaryMuscles.includes("chest"));
});
