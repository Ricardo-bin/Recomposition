// ============================================================================
// Tests for data/exerciseLibrary.js
// Run:  node --test tests/*.test.mjs
// Uses only Node's built-in test runner (no dependencies).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createExerciseLibrary,
  normalizeExerciseText
} from "../data/exerciseLibrary.js";

const here = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = resolve(here, "..", "data", "exercise-library.v1.json");

const readRaw = () => JSON.parse(readFileSync(LIBRARY_PATH, "utf8"));

// A fresh library instance whose loader counts how often it is called.
function makeLibrary(transform = lib => lib) {
  const state = { loads: 0 };

  const library = createExerciseLibrary({
    loadJson: async () => {
      state.loads += 1;
      return transform(readRaw());
    }
  });

  return { library, state };
}

const ids = list => list.map(exercise => exercise.id);

// Expected ids computed from the raw JSON (library order).
const rawIdsWhere = predicate => readRaw().exercises.filter(predicate).map(e => e.id);


// ----------------------------------------------------------------------------
// LOADING
// ----------------------------------------------------------------------------

test("library loads successfully", async () => {
  const { library } = makeLibrary();

  const info = await library.loadExerciseLibrary();

  assert.equal(info.schemaVersion, 1);
  assert.equal(info.libraryVersion, "1.1.0");
  assert.equal(info.exerciseCount, 120);

  const all = await library.getAllExercises();

  assert.equal(all.length, 120);
});

test("repeated loads use the cache (loader runs once)", async () => {
  const { library, state } = makeLibrary();

  await library.loadExerciseLibrary();
  await library.loadExerciseLibrary();
  await library.getExercise("pull-up");
  await library.searchExercises("squat");
  await library.getExercisesByMuscle("lats");

  assert.equal(state.loads, 1);
});

test("concurrent first calls share a single load", async () => {
  const { library, state } = makeLibrary();

  await Promise.all([
    library.getExercise("pull-up"),
    library.getExercise("leg-press"),
    library.searchExercises("row"),
    library.loadExerciseLibrary()
  ]);

  assert.equal(state.loads, 1);
});

test("a failed load is not cached: the next call retries", async () => {
  let calls = 0;

  const library = createExerciseLibrary({
    loadJson: async () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("network down");
      }

      return readRaw();
    }
  });

  await assert.rejects(() => library.getExercise("pull-up"), /network down/);

  const exercise = await library.getExercise("pull-up");

  assert.equal(exercise.id, "pull-up");
  assert.equal(calls, 2);
});

test("rejects an unsupported schemaVersion and malformed data", async () => {
  const future = makeLibrary(lib => ({ ...lib, schemaVersion: 99 }));

  await assert.rejects(
    () => future.library.getExercise("pull-up"),
    /Unsupported exercise library schemaVersion 99/
  );

  const broken = createExerciseLibrary({ loadJson: async () => ({}) });

  await assert.rejects(
    () => broken.getExercise("pull-up"),
    /malformed/
  );
});

test("default instance loads through fetch() (browser path)", async () => {
  const realFetch = globalThis.fetch;

  const requested = [];

  globalThis.fetch = async url => {
    requested.push(String(url));

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => readRaw()
    };
  };

  try {
    // Import a fresh copy so the default instance is created under the stub.
    const fresh = await import("../data/exerciseLibrary.js?fetch-test");

    const exercise = await fresh.getExercise("hack-squat");

    assert.equal(exercise.name, "Machine Hack Squat");
    assert.equal(requested.length, 1);
    assert.ok(requested[0].endsWith("/data/exercise-library.v1.json"));

    await fresh.getExercise("leg-press");

    assert.equal(requested.length, 1, "second call must not fetch again");
  } finally {
    globalThis.fetch = realFetch;
  }
});


// ----------------------------------------------------------------------------
// LOOKUP BY ID
// ----------------------------------------------------------------------------

test("get exercise by id", async () => {
  const { library } = makeLibrary();

  const squat = await library.getExercise("barbell-back-squat");

  assert.equal(squat.id, "barbell-back-squat");
  assert.equal(squat.name, "Barbell High-Bar Back Squat");
  assert.equal(squat.movementPattern, "squat");
  assert.deepEqual(squat.primaryMuscles, ["quadriceps", "glutes"]);
  assert.equal(squat.laterality, "bilateral");
});

test("invalid / nonexistent exercise ids return null (never throw)", async () => {
  const { library } = makeLibrary();

  assert.equal(await library.getExercise("does-not-exist"), null);
  assert.equal(await library.getExercise(""), null);
  assert.equal(await library.getExercise(undefined), null);
  assert.equal(await library.getExercise(null), null);
  assert.equal(await library.getExercise(42), null);
  // ids are exact: no normalisation
  assert.equal(await library.getExercise("Pull-Up"), null);
});

test("getExercises skips unknown ids and keeps request order", async () => {
  const { library } = makeLibrary();

  const list = await library.getExercises(["pull-up", "nope", "leg-press"]);

  assert.deepEqual(ids(list), ["pull-up", "leg-press"]);
  assert.deepEqual(await library.getExercises("not-an-array"), []);
});

test("every exercise resolves by id, by name and by every alias", async () => {
  const { library } = makeLibrary();

  for (const exercise of await library.getAllExercises()) {
    assert.equal((await library.getExercise(exercise.id)).id, exercise.id);
    assert.equal((await library.findExerciseByName(exercise.name)).id, exercise.id);

    for (const alias of exercise.aliases) {
      assert.equal(
        (await library.findExerciseByName(alias)).id,
        exercise.id,
        `alias "${alias}" should resolve to ${exercise.id}`
      );
    }
  }
});


// ----------------------------------------------------------------------------
// SEARCH
// ----------------------------------------------------------------------------

test("search by exact name", async () => {
  const { library } = makeLibrary();

  const results = await library.searchExercises("Barbell Back Squat");

  assert.equal(results[0].id, "barbell-back-squat");
});

test("search by alias", async () => {
  const { library } = makeLibrary();

  assert.equal((await library.searchExercises("RDL"))[0].id, "barbell-romanian-deadlift");
  assert.equal((await library.searchExercises("Dips"))[0].id, "parallel-bar-dip");
  assert.equal((await library.searchExercises("RFESS"))[0].id, "dumbbell-bulgarian-split-squat");
});

test("search is case-insensitive (and ignores punctuation/spacing)", async () => {
  const { library } = makeLibrary();

  for (const query of ["PULL-UP", "pull-up", "Pull Up", "  pull   up  ", "pull_up"]) {
    const results = await library.searchExercises(query);

    assert.equal(results[0].id, "pull-up", `query "${query}"`);
  }

  assert.equal((await library.searchExercises("rdl"))[0].id, "barbell-romanian-deadlift");
  assert.equal((await library.searchExercises("RDL"))[0].id, "barbell-romanian-deadlift");
});

test("search supports partial and multi-word queries", async () => {
  const { library } = makeLibrary();

  const squats = ids(await library.searchExercises("squat"));

  assert.ok(squats.includes("barbell-back-squat"));
  assert.ok(squats.includes("hack-squat"));
  assert.ok(squats.includes("dumbbell-bulgarian-split-squat"));

  const multi = await library.searchExercises("dumbbell press");

  assert.ok(ids(multi).includes("incline-dumbbell-press"));
  assert.ok(ids(multi).includes("dumbbell-shoulder-press"));
});

test("search ranks exact name above alias above partial matches", async () => {
  const { library } = makeLibrary();

  // "Squat" is an alias of Barbell Back Squat; others only contain the word.
  const results = await library.searchExercises("Squat");

  assert.equal(results[0].id, "barbell-back-squat");
});

test("search: empty / whitespace / no-match queries return []", async () => {
  const { library } = makeLibrary();

  assert.deepEqual(await library.searchExercises(""), []);
  assert.deepEqual(await library.searchExercises("   "), []);
  assert.deepEqual(await library.searchExercises(null), []);
  assert.deepEqual(await library.searchExercises("zzzzqqq"), []);
});

test("search respects limit and returns a stable order", async () => {
  const { library } = makeLibrary();

  const limited = await library.searchExercises("a", { limit: 3 });

  assert.equal(limited.length, 3);

  const again = await library.searchExercises("a", { limit: 3 });

  assert.deepEqual(ids(limited), ids(again));
});

test("findExerciseByName is exact, not partial", async () => {
  const { library } = makeLibrary();

  assert.equal((await library.findExerciseByName("Cable crunches")).id, "cable-crunch");
  assert.equal((await library.findExerciseByName("squat")).id, "barbell-back-squat");
  assert.equal(await library.findExerciseByName("squa"), null);
  assert.equal(await library.findExerciseByName(""), null);
  assert.equal(await library.findExerciseByName(undefined), null);
});


// ----------------------------------------------------------------------------
// INDEXES: MUSCLE / PATTERN / EQUIPMENT
// ----------------------------------------------------------------------------

test("muscle lookup (primary, secondary, any)", async () => {
  const { library } = makeLibrary();

  const lats = ids(await library.getExercisesByMuscle("lats"));

  assert.deepEqual(
    lats.sort(),
    rawIdsWhere(e => e.primaryMuscles.includes("lats")).sort()
  );

  // The original lat exercises are still there.
  for (const id of ["barbell-bent-over-row", "lat-pulldown", "pull-up", "seated-cable-row"]) {
    assert.ok(lats.includes(id), id);
  }

  const secondaryLats = ids(
    await library.getExercisesByMuscle("lats", { role: "secondary" })
  );

  assert.deepEqual(secondaryLats, rawIdsWhere(e => e.secondaryMuscles.includes("lats")));
  assert.ok(secondaryLats.includes("conventional-deadlift"));

  const anyLats = ids(
    await library.getExercisesByMuscle("lats", { role: "any" })
  );

  assert.equal(anyLats.length, lats.length + secondaryLats.length);
  assert.equal(new Set(anyLats).size, anyLats.length, "no duplicates");

  assert.deepEqual(
    ids(await library.getExercisesByMuscle("calves")),
    rawIdsWhere(e => e.primaryMuscles.includes("calves"))
  );
});

test("muscle lookup: unknown muscle returns []", async () => {
  const { library } = makeLibrary();

  assert.deepEqual(await library.getExercisesByMuscle("wings"), []);
  assert.deepEqual(await library.getExercisesByMuscle(undefined), []);
});

test("movement-pattern lookup", async () => {
  const { library } = makeLibrary();

  assert.deepEqual(
    ids(await library.getExercisesByMovementPattern("squat")).sort(),
    rawIdsWhere(e => e.movementPattern === "squat").sort()
  );

  assert.deepEqual(
    ids(await library.getExercisesByMovementPattern("vertical-pull")).sort(),
    rawIdsWhere(e => e.movementPattern === "vertical-pull").sort()
  );

  assert.deepEqual(
    ids(await library.getExercisesByMovementPattern("knee-extension")),
    ["leg-extension", "bodyweight-sissy-squat"].sort((a, b) => rawIdsWhere(e => true).indexOf(a) - rawIdsWhere(e => true).indexOf(b))
  );

  assert.deepEqual(await library.getExercisesByMovementPattern("carry"), []);
});

test("equipment lookup (exercises that require a piece of equipment)", async () => {
  const { library } = makeLibrary();

  assert.deepEqual(
    ids(await library.getExercisesByEquipment("dip-bars")),
    ["parallel-bar-dip", "weighted-triceps-dips"]
  );

  const squatRack = ids(await library.getExercisesByEquipment("squat-rack"));

  assert.deepEqual(squatRack.sort(), rawIdsWhere(e => e.equipment.includes("squat-rack")).sort());
  assert.ok(squatRack.includes("barbell-back-squat") && squatRack.includes("barbell-bench-press"));

  const cable = ids(await library.getExercisesByEquipment("cable-machine"));

  // Lat Pulldown has resistanceType "cable" but needs its own station
  // (lat-pulldown-machine), so it is deliberately NOT in this list.
  assert.deepEqual(cable.sort(), rawIdsWhere(e => e.equipment.includes("cable-machine")).sort());

  for (const id of ["cable-chest-fly", "cable-crunch", "cable-triceps-pushdown", "face-pull", "seated-cable-row"]) {
    assert.ok(cable.includes(id), id);
  }
  assert.ok(!cable.includes("lat-pulldown"));

  assert.deepEqual(
    ids(await library.getExercisesByEquipment("lat-pulldown-machine")),
    ["neutral-grip-lat-pulldown", "lat-pulldown"].sort((a, b) => rawIdsWhere(e => true).indexOf(a) - rawIdsWhere(e => true).indexOf(b))
  );

  assert.deepEqual(await library.getExercisesByEquipment("jetpack"), []);
});

test("equipment availability honours equipmentSatisfiedBy (adjustable bench ⊇ bench)", async () => {
  const { library } = makeLibrary();

  const full = await library.getVocabularies();
  const everything = await library.getExercisesAvailableWith(full.equipment);

  assert.equal(everything.length, 120);

  const dumbbellsAndAdjustableBench = ids(
    await library.getExercisesAvailableWith(["dumbbell", "adjustable-bench"])
  );

  // Bulgarian split squat needs "bench": satisfied by the adjustable bench.
  assert.ok(dumbbellsAndAdjustableBench.includes("dumbbell-bulgarian-split-squat"));
  assert.ok(dumbbellsAndAdjustableBench.includes("incline-dumbbell-press"));

  // A flat bench does NOT satisfy an adjustable-bench requirement.
  const dumbbellsAndFlatBench = ids(
    await library.getExercisesAvailableWith(["dumbbell", "bench"])
  );

  assert.ok(dumbbellsAndFlatBench.includes("dumbbell-bulgarian-split-squat"));
  assert.ok(!dumbbellsAndFlatBench.includes("incline-dumbbell-press"));

  // No equipment: only the bodyweight exercises that need none.
  const none = await library.getExercisesAvailableWith([]);

  assert.deepEqual(ids(none), rawIdsWhere(e => e.equipment.length === 0));
  assert.ok(ids(none).includes("bodyweight-sissy-squat"));
  assert.deepEqual(ids(await library.getExercisesAvailableWith(undefined)), ids(none));
});

test("indexes match a brute-force scan of the raw JSON", async () => {
  const { library } = makeLibrary();

  const raw = readRaw();

  for (const muscle of raw.vocabularies.muscles) {
    const expected = raw.exercises
      .filter(e => e.primaryMuscles.includes(muscle))
      .map(e => e.id);

    assert.deepEqual(ids(await library.getExercisesByMuscle(muscle)), expected);
  }

  for (const pattern of raw.vocabularies.movementPatterns) {
    const expected = raw.exercises
      .filter(e => e.movementPattern === pattern)
      .map(e => e.id);

    assert.deepEqual(ids(await library.getExercisesByMovementPattern(pattern)), expected);
  }

  for (const item of raw.vocabularies.equipment) {
    const expected = raw.exercises
      .filter(e => e.equipment.includes(item))
      .map(e => e.id);

    assert.deepEqual(ids(await library.getExercisesByEquipment(item)), expected);
  }
});


// ----------------------------------------------------------------------------
// DEPRECATED EXERCISES
// ----------------------------------------------------------------------------

test("deprecated exercises: resolvable by id, hidden from lists unless requested", async () => {
  const { library } = makeLibrary(lib => {
    lib.exercises.find(e => e.id === "leg-press").status = "deprecated";
    return lib;
  });

  // Old logs must still resolve.
  assert.equal((await library.getExercise("leg-press")).id, "leg-press");
  assert.equal((await library.findExerciseByName("Leg Press")).id, "leg-press");

  // Hidden by default.
  assert.ok(!ids(await library.getAllExercises()).includes("leg-press"));
  assert.ok(!ids(await library.searchExercises("leg press")).includes("leg-press"));
  assert.ok(!ids(await library.getExercisesByMovementPattern("squat")).includes("leg-press"));
  assert.ok(!ids(await library.getExercisesByEquipment("leg-press-machine")).includes("leg-press"));

  // Visible on request.
  assert.ok(ids(await library.getAllExercises({ includeDeprecated: true })).includes("leg-press"));
  assert.ok(
    ids(await library.searchExercises("leg press", { includeDeprecated: true })).includes("leg-press")
  );
});


// ----------------------------------------------------------------------------
// READ-ONLY GUARANTEES
// ----------------------------------------------------------------------------

test("library data is deeply frozen (read-only)", async () => {
  const { library } = makeLibrary();

  const squat = await library.getExercise("barbell-back-squat");

  assert.throws(() => { squat.name = "Hacked"; }, TypeError);
  assert.throws(() => { squat.primaryMuscles.push("chest"); }, TypeError);
  assert.throws(() => { squat.primaryMuscles[0] = "chest"; }, TypeError);
  assert.throws(() => { squat.newField = 1; }, TypeError);

  const all = await library.getAllExercises();

  assert.throws(() => { all.push({}); }, TypeError);

  const results = await library.searchExercises("squat");

  assert.throws(() => { results.pop(); }, TypeError);

  const lats = await library.getExercisesByMuscle("lats");

  assert.throws(() => { lats.length = 0; }, TypeError);

  const vocab = await library.getVocabularies();

  assert.throws(() => { vocab.muscles.push("wings"); }, TypeError);

  // And nothing changed.
  assert.equal((await library.getExercise("barbell-back-squat")).name, "Barbell High-Bar Back Squat");
  assert.equal((await library.getExercisesByMuscle("lats")).length, rawIdsWhere(e => e.primaryMuscles.includes("lats")).length);
});

test("mutating a returned list cannot corrupt later queries", async () => {
  const { library } = makeLibrary();

  const first = await library.getExercisesByMovementPattern("squat");

  assert.throws(() => first.push({ id: "fake" }), TypeError);

  const second = await library.getExercisesByMovementPattern("squat");

  assert.equal(second.length, rawIdsWhere(e => e.movementPattern === "squat").length);
});


// ----------------------------------------------------------------------------
// VOCABULARIES + NORMALISATION
// ----------------------------------------------------------------------------

test("vocabularies are exposed", async () => {
  const { library } = makeLibrary();

  const vocab = await library.getVocabularies();

  assert.equal(vocab.muscles.length, 20);
  assert.equal(vocab.equipment.length, 39);
  assert.equal(vocab.movementPatterns.length, 24);
  assert.deepEqual(vocab.lateralities, ["bilateral", "unilateral"]);
});

test("normalizeExerciseText", () => {
  assert.equal(normalizeExerciseText("  Pull-Up! "), "pull up");
  assert.equal(normalizeExerciseText("45-Degree  Leg Press"), "45 degree leg press");
  assert.equal(normalizeExerciseText(null), "");
  assert.equal(normalizeExerciseText(undefined), "");
});
