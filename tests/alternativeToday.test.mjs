// ============================================================================
// Alternative Today — pure logic (alternativeToday.js). No DOM, no Firebase.
//
// PLAN = intent | SESSION = today | LOG = what was actually done
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyAlternative,
  buildLogSession,
  getPerformedExerciseId,
  hasAlternative,
  hasEnteredData,
  normalizeAlternative,
  restoreOriginal,
  sanitizeSessionExercise,
  validateReplacement
} from "../alternativeToday.js";

const BENCH = { id: "barbell-bench-press", name: "Barbell Bench Press" };
const INCLINE = { id: "incline-dumbbell-press", name: "Incline Dumbbell Press" };
const PULLDOWN = { id: "lat-pulldown", name: "Lat Pulldown" };

const emptySets = n =>
  Array.from({ length: n }, () => ({ weight: "", reps: "", rir: "" }));

function makeSession() {
  return {
    planId: "p1",
    workoutName: "Upper A",
    status: "in-progress",
    exercises: [
      {
        exerciseId: "slot-1",
        name: BENCH.name,
        libraryExerciseId: BENCH.id,
        targetSets: 3,
        sets: emptySets(3),
        previousLog: { stale: true }
      },
      {
        exerciseId: "slot-2",
        name: PULLDOWN.name,
        libraryExerciseId: PULLDOWN.id,
        targetSets: 3,
        sets: emptySets(3),
        previousLog: null
      },
      {
        exerciseId: "slot-3",
        name: "Cable Lateral Raise",
        targetSets: 2,
        sets: emptySets(2),
        previousLog: null
      }
    ]
  };
}

const freeze = value => JSON.parse(JSON.stringify(value));

const NOW = new Date("2026-10-06T10:00:00.000Z");


test("apply returns a NEW exercise and never mutates the session", () => {
  const session = makeSession();
  const before = freeze(session);

  const result = applyAlternative(session, 0, INCLINE, NOW);

  assert.equal(result.ok, true);
  assert.deepEqual(freeze(session), before);
  assert.notEqual(result.exercise, session.exercises[0]);
});

test("the alternative is stored on the session exercise with the original kept", () => {
  const result = applyAlternative(makeSession(), 0, INCLINE, NOW);
  const exercise = result.exercise;

  assert.equal(exercise.name, INCLINE.name);
  assert.equal(exercise.libraryExerciseId, INCLINE.id);
  assert.equal(exercise.exerciseId, "slot-1", "slot id never changes");
  assert.equal(exercise.previousLog, null);

  assert.deepEqual(exercise.alternativeToday, {
    version: 1,
    name: INCLINE.name,
    libraryExerciseId: INCLINE.id,
    original: { name: BENCH.name, libraryExerciseId: BENCH.id },
    selectedAt: NOW.toISOString()
  });

  assert.equal(hasAlternative(exercise), true);
});

test("prescription is kept; set count is kept; typed values do not carry over", () => {
  const session = makeSession();
  session.exercises[0].sets = [
    { weight: "80", reps: "8", rir: "2" },
    { weight: "80", reps: "7", rir: "1" },
    { weight: "", reps: "", rir: "" },
    { weight: "", reps: "", rir: "" }
  ];

  assert.equal(hasEnteredData(session.exercises[0]), true);

  const { exercise } = applyAlternative(session, 0, INCLINE, NOW);

  assert.equal(exercise.sets.length, 4);
  assert.equal(hasEnteredData(exercise), false);
  assert.equal(exercise.targetSets, 3);
});

test("an unlinked (custom) original is remembered without a library link", () => {
  const { exercise } = applyAlternative(makeSession(), 2, INCLINE, NOW);

  assert.deepEqual(exercise.alternativeToday.original, {
    name: "Cable Lateral Raise"
  });
  assert.ok(!("libraryExerciseId" in exercise.alternativeToday.original));
});

test("restoring returns the planned exercise and removes every trace", () => {
  const session = makeSession();
  const { exercise } = applyAlternative(session, 0, INCLINE, NOW);

  const restored = restoreOriginal(exercise);

  assert.equal(restored.name, BENCH.name);
  assert.equal(restored.libraryExerciseId, BENCH.id);
  assert.equal(restored.exerciseId, "slot-1");
  assert.ok(!("alternativeToday" in restored));
  assert.equal(hasAlternative(restored), false);
});

test("restoring a custom original drops the library link instead of leaving undefined", () => {
  const { exercise } = applyAlternative(makeSession(), 2, INCLINE, NOW);

  const restored = restoreOriginal(exercise);

  assert.equal(restored.name, "Cable Lateral Raise");
  assert.ok(!("libraryExerciseId" in restored));
  assert.ok(!Object.values(restored).includes(undefined));
});

test("restore with no alternative returns the exercise unchanged", () => {
  const session = makeSession();

  assert.equal(restoreOriginal(session.exercises[0]), session.exercises[0]);
});

test("changing an alternative keeps the ORIGINAL plan exercise, not the first alternative", () => {
  const session = makeSession();

  session.exercises[0] = applyAlternative(session, 0, INCLINE, NOW).exercise;

  const second = applyAlternative(
    session,
    0,
    { id: "dumbbell-shoulder-press", name: "Dumbbell Shoulder Press" },
    NOW
  );

  assert.equal(second.ok, true);
  assert.equal(second.exercise.alternativeToday.original.name, BENCH.name);
  assert.equal(
    second.exercise.alternativeToday.original.libraryExerciseId,
    BENCH.id
  );
});

test("invalid replacements fail safely and return nothing to assign", () => {
  const session = makeSession();
  const before = freeze(session);

  const cases = [
    [0, null, "invalid-library-exercise"],
    [0, undefined, "invalid-library-exercise"],
    [0, {}, "invalid-library-exercise"],
    [0, { id: "x" }, "invalid-library-exercise"],
    [0, { name: "x" }, "invalid-library-exercise"],
    [0, { id: " ", name: "x" }, "invalid-library-exercise"],
    [0, { id: 5, name: "x" }, "invalid-library-exercise"],
    [0, "incline", "invalid-library-exercise"],
    [0, { ...INCLINE, status: "deprecated" }, "deprecated"],
    [9, INCLINE, "invalid-exercise"],
    [-1, INCLINE, "invalid-exercise"],
    [0, PULLDOWN, "duplicate"],
    [0, BENCH, "same-as-planned"]
  ];

  for (const [index, library, reason] of cases) {
    const result = applyAlternative(session, index, library, NOW);

    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
    assert.ok(result.message);
    assert.ok(!("exercise" in result));
  }

  assert.deepEqual(freeze(session), before);
  assert.equal(applyAlternative(null, 0, INCLINE).ok, false);
  assert.equal(applyAlternative({}, 0, INCLINE).ok, false);
});

test("a replacement cannot duplicate another exercise (by library id or by name)", () => {
  const session = makeSession();

  assert.equal(validateReplacement(session, 0, PULLDOWN).reason, "duplicate");

  // A custom exercise with the same normalised name also counts.
  assert.equal(
    validateReplacement(session, 0, { id: "cable-lat-raise", name: "cable  lateral RAISE" }).reason,
    "duplicate"
  );

  assert.equal(validateReplacement(session, 0, INCLINE).ok, true);
});

test("while an alternative is active, the planned exercise is not offered as an alternative", () => {
  const session = makeSession();

  session.exercises[0] = applyAlternative(session, 0, INCLINE, NOW).exercise;

  assert.equal(validateReplacement(session, 0, BENCH).reason, "same-as-planned");
});

test("normalizeAlternative rejects every malformed shape", () => {
  const good = applyAlternative(makeSession(), 0, INCLINE, NOW)
    .exercise.alternativeToday;

  assert.ok(normalizeAlternative(good));

  for (const bad of [
    null, undefined, 5, "x", [], {},
    { ...good, name: "" },
    { ...good, libraryExerciseId: null },
    { ...good, original: null },
    { ...good, original: {} },
    { ...good, original: { name: 3 } }
  ]) {
    assert.equal(normalizeAlternative(bad), null);
  }
});

test("performed id: slot id without an alternative, distinct id with one", () => {
  const session = makeSession();

  assert.equal(getPerformedExerciseId(session.exercises[0]), "slot-1");

  const { exercise } = applyAlternative(session, 0, INCLINE, NOW);

  assert.equal(
    getPerformedExerciseId(exercise),
    "alt:slot-1:incline-dumbbell-press"
  );
});


// ---- LOG --------------------------------------------------------------------

test("no alternative: the log session is the very same object (behaviour unchanged)", () => {
  const session = makeSession();

  assert.equal(buildLogSession(session), session);
});

test("the log records what was actually performed, and where it came from", () => {
  const session = makeSession();

  session.exercises[0] = applyAlternative(session, 0, INCLINE, NOW).exercise;

  const log = buildLogSession(session);

  const logged = log.exercises[0];

  assert.equal(logged.name, INCLINE.name);
  assert.equal(logged.libraryExerciseId, INCLINE.id);
  assert.equal(logged.exerciseId, "alt:slot-1:incline-dumbbell-press");
  assert.equal(logged.plannedExerciseId, "slot-1");
  assert.equal(logged.plannedName, BENCH.name);
  assert.equal(logged.plannedLibraryExerciseId, BENCH.id);
  assert.equal(logged.alternativeToday.original.name, BENCH.name);

  // Other exercises are logged exactly as before.
  assert.equal(log.exercises[1], session.exercises[1]);
  assert.equal(log.exercises[2], session.exercises[2]);

  // The session itself is not changed by building the log.
  assert.equal(session.exercises[0].exerciseId, "slot-1");
});

test("a log never contains undefined (Firestore rejects it)", () => {
  const session = makeSession();

  session.exercises[2] = applyAlternative(session, 2, INCLINE, NOW).exercise;

  const log = buildLogSession(session);

  const scan = value => {
    if (value === undefined) {
      assert.fail("undefined found in log payload");
    }

    if (value && typeof value === "object") {
      Object.values(value).forEach(scan);
    }
  };

  scan(log);

  assert.ok(!("plannedLibraryExerciseId" in log.exercises[2]));
});

test("a damaged alternative is not written to the log", () => {
  const session = makeSession();

  session.exercises[0] = applyAlternative(session, 0, INCLINE, NOW).exercise;
  session.exercises[1].alternativeToday = { name: "junk" };

  const log = buildLogSession(session);

  assert.ok(!("alternativeToday" in log.exercises[1]));
  assert.equal(log.exercises[1].exerciseId, "slot-2");
});


// ---- STORED SESSION REPAIR ----------------------------------------------------

test("sanitize: exercises without an alternative are returned untouched", () => {
  const exercise = makeSession().exercises[0];

  assert.equal(sanitizeSessionExercise(exercise), exercise);
  assert.equal(sanitizeSessionExercise(null), null);
});

test("sanitize: a valid alternative survives a JSON round trip", () => {
  const { exercise } = applyAlternative(makeSession(), 0, INCLINE, NOW);

  const stored = JSON.parse(JSON.stringify(exercise));

  const back = sanitizeSessionExercise(stored);

  assert.deepEqual(back.alternativeToday, exercise.alternativeToday);
  assert.equal(back.name, INCLINE.name);
  assert.equal(back.libraryExerciseId, INCLINE.id);
});

test("sanitize: a damaged alternative with a recoverable original goes back to the plan", () => {
  const { exercise } = applyAlternative(makeSession(), 0, INCLINE, NOW);

  const damaged = {
    ...JSON.parse(JSON.stringify(exercise)),
    alternativeToday: {
      name: "",
      original: { name: BENCH.name, libraryExerciseId: BENCH.id }
    }
  };

  const repaired = sanitizeSessionExercise(damaged);

  assert.equal(repaired.name, BENCH.name);
  assert.equal(repaired.libraryExerciseId, BENCH.id);
  assert.ok(!("alternativeToday" in repaired));
});

test("sanitize: an unrecoverable alternative is dropped without throwing", () => {
  for (const alternativeToday of ["garbage", 7, [], {}, { original: 3 }]) {
    const repaired = sanitizeSessionExercise({
      exerciseId: "s",
      name: "Whatever",
      sets: [],
      alternativeToday
    });

    assert.ok(!("alternativeToday" in repaired));
    assert.equal(repaired.name, "Whatever");
    assert.equal(repaired.exerciseId, "s");
  }
});


// ---- PICKER: library-only mode ---------------------------------------------------

import { buildPickerOptions } from "../exercisePicker.js";

test("picker: allowCustom false never adds the custom row; default still does", () => {
  const results = [{
    id: "incline-dumbbell-press",
    name: "Incline Dumbbell Press",
    primaryMuscles: ["chest"],
    equipment: ["dumbbell"],
    aliases: []
  }];

  const libraryOnly = buildPickerOptions("incl", results, { allowCustom: false });

  assert.deepEqual(libraryOnly.map(o => o.type), ["library"]);
  assert.deepEqual(buildPickerOptions("zzz", [], { allowCustom: false }), []);

  // Unchanged default behaviour (plan editor).
  assert.deepEqual(
    buildPickerOptions("incl", results).map(o => o.type),
    ["library", "custom"]
  );
});
