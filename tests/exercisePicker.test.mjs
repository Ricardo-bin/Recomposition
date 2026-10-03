// ============================================================================
// Tests for exercisePicker.js (pure helpers)
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createExerciseLibrary } from "../data/exerciseLibrary.js";

import {
  PICKER_MAX_RESULTS,
  isLinked,
  libraryLinkField,
  applyLibrarySelection,
  clearLibraryLink,
  applyNameEdit,
  getLinkStatus,
  formatSlug,
  formatExerciseSubtitle,
  findMatchedAlias,
  buildPickerOptions
} from "../exercisePicker.js";

const here = dirname(fileURLToPath(import.meta.url));

const library = createExerciseLibrary({
  loadJson: async () =>
    JSON.parse(
      readFileSync(
        resolve(here, "..", "data", "exercise-library.v1.json"),
        "utf8"
      )
    )
});

// A realistic plan exercise, exactly as workout.js creates it today.
const legacy = () => ({
  id: "slot-uuid-1111",
  name: "Squat",
  sets: 3,
  repMin: 8,
  repMax: 12,
  targetRIR: 2,
  restSeconds: 120,
  notes: "pause at the bottom"
});

const linked = () => ({
  ...legacy(),
  name: "Barbell Back Squat",
  libraryExerciseId: "barbell-back-squat"
});

const snapshot = value => JSON.parse(JSON.stringify(value));


// ----------------------------------------------------------------------------
// isLinked / libraryLinkField
// ----------------------------------------------------------------------------

test("isLinked: true only for a non-empty libraryExerciseId string", () => {
  assert.equal(isLinked(linked()), true);
  assert.equal(isLinked(legacy()), false);
  assert.equal(isLinked({ libraryExerciseId: "" }), false);
  assert.equal(isLinked({ libraryExerciseId: "   " }), false);
  assert.equal(isLinked({ libraryExerciseId: null }), false);
  assert.equal(isLinked({ libraryExerciseId: 42 }), false);
  assert.equal(isLinked(null), false);
  assert.equal(isLinked(undefined), false);
});

test("libraryLinkField: linked -> the field; unlinked -> {} (key omitted)", () => {
  assert.deepEqual(libraryLinkField(linked()), {
    libraryExerciseId: "barbell-back-squat"
  });

  for (const value of [legacy(), { libraryExerciseId: "" }, { libraryExerciseId: undefined }, null, undefined]) {
    const field = libraryLinkField(value);

    assert.deepEqual(field, {});
    assert.equal("libraryExerciseId" in field, false);
  }
});

test("a saved exercise never serialises an undefined/absent link", () => {
  const savedLegacy = { id: "x", name: "y", ...libraryLinkField(legacy()) };

  assert.equal("libraryExerciseId" in savedLegacy, false);
  assert.ok(!JSON.stringify(savedLegacy).includes("libraryExerciseId"));
  assert.ok(!JSON.stringify(savedLegacy).includes("undefined"));

  const savedLinked = { id: "x", name: "y", ...libraryLinkField(linked()) };

  assert.equal(savedLinked.libraryExerciseId, "barbell-back-squat");
});


// ----------------------------------------------------------------------------
// applyLibrarySelection  (explicit pick)
// ----------------------------------------------------------------------------

test("selecting a library exercise sets canonical name + libraryExerciseId", async () => {
  const squat = await library.getExercise("barbell-back-squat");

  const result = applyLibrarySelection(legacy(), squat);

  assert.equal(result.name, "Barbell Back Squat");
  assert.equal(result.libraryExerciseId, "barbell-back-squat");
});

test("selection preserves the plan SLOT id and the whole prescription", async () => {
  const squat = await library.getExercise("barbell-back-squat");

  const result = applyLibrarySelection(legacy(), squat);

  assert.equal(result.id, "slot-uuid-1111");
  assert.notEqual(result.id, result.libraryExerciseId);
  assert.equal(result.sets, 3);
  assert.equal(result.repMin, 8);
  assert.equal(result.repMax, 12);
  assert.equal(result.targetRIR, 2);
  assert.equal(result.restSeconds, 120);
  assert.equal(result.notes, "pause at the bottom");
});

test("selection does not mutate the plan exercise or the (frozen) library exercise", async () => {
  const squat = await library.getExercise("barbell-back-squat");
  const before = legacy();
  const beforeCopy = snapshot(before);

  const result = applyLibrarySelection(before, squat);

  assert.deepEqual(before, beforeCopy, "input must be untouched");
  assert.notEqual(result, before, "a new object is returned");
  assert.ok(Object.isFrozen(squat), "library exercise stays frozen");
});

test("a legacy free-text exercise is linked ONLY by an explicit selection", async () => {
  const stillLegacy = applyNameEdit(legacy(), "Squat 2");

  assert.equal("libraryExerciseId" in stillLegacy, false);

  const hack = await library.getExercise("hack-squat");

  assert.equal(applyLibrarySelection(legacy(), hack).libraryExerciseId, "hack-squat");
});

test("re-selecting a different library exercise keeps the same slot id", async () => {
  const legPress = await library.getExercise("leg-press");
  const hackSquat = await library.getExercise("hack-squat");

  const first = applyLibrarySelection(legacy(), legPress);
  const second = applyLibrarySelection(first, hackSquat);

  assert.equal(first.libraryExerciseId, "leg-press");
  assert.equal(second.libraryExerciseId, "hack-squat");
  assert.equal(second.name, "Hack Squat");
  assert.equal(first.id, "slot-uuid-1111");
  assert.equal(second.id, "slot-uuid-1111");
  assert.equal(second.notes, "pause at the bottom");
});

test("selection rejects invalid arguments with a clear error", async () => {
  const squat = await library.getExercise("barbell-back-squat");

  assert.throws(() => applyLibrarySelection(null, squat), TypeError);
  assert.throws(() => applyLibrarySelection(legacy(), null), TypeError);
  assert.throws(() => applyLibrarySelection(legacy(), {}), TypeError);
  assert.throws(() => applyLibrarySelection(legacy(), { id: "x" }), TypeError);
  assert.throws(() => applyLibrarySelection(legacy(), { name: "x" }), TypeError);
  assert.throws(() => applyLibrarySelection(legacy(), { id: "", name: "x" }), TypeError);
});

test("selection keeps unknown extra fields on the plan exercise", async () => {
  const squat = await library.getExercise("barbell-back-squat");

  const result = applyLibrarySelection({ ...legacy(), futureField: { a: 1 } }, squat);

  assert.deepEqual(result.futureField, { a: 1 });
});


// ----------------------------------------------------------------------------
// clearLibraryLink
// ----------------------------------------------------------------------------

test("clearLibraryLink removes the key but keeps id, name and prescription", () => {
  const result = clearLibraryLink(linked());

  assert.equal("libraryExerciseId" in result, false);
  assert.equal(result.id, "slot-uuid-1111");
  assert.equal(result.name, "Barbell Back Squat");
  assert.equal(result.sets, 3);
});

test("clearLibraryLink is safe on unlinked / missing input and does not mutate", () => {
  assert.deepEqual(clearLibraryLink(legacy()), legacy());
  assert.deepEqual(clearLibraryLink(null), {});
  assert.deepEqual(clearLibraryLink(undefined), {});

  const before = linked();
  clearLibraryLink(before);

  assert.equal(before.libraryExerciseId, "barbell-back-squat");
});


// ----------------------------------------------------------------------------
// applyNameEdit  (manual typing)
// ----------------------------------------------------------------------------

test("editing a linked exercise's name UNLINKS it, keeping the slot id", () => {
  const result = applyNameEdit(linked(), "Barbell Back Squat (heavy)");

  assert.equal(result.name, "Barbell Back Squat (heavy)");
  assert.equal("libraryExerciseId" in result, false);
  assert.equal(result.id, "slot-uuid-1111");
  assert.equal(result.notes, "pause at the bottom");
});

test("any change unlinks: case, whitespace, deletion", () => {
  for (const edited of ["barbell back squat", "Barbell Back Squat ", "Barbell Back Squa", ""]) {
    const result = applyNameEdit(linked(), edited);

    assert.equal("libraryExerciseId" in result, false, `edited to "${edited}"`);
    assert.equal(result.name, edited);
  }
});

test("an input event that leaves the text identical does NOT unlink", () => {
  const result = applyNameEdit(linked(), "Barbell Back Squat");

  assert.equal(result.libraryExerciseId, "barbell-back-squat");
});

test("retyping the canonical name does NOT relink (only an explicit pick links)", () => {
  const typed = applyNameEdit(linked(), "Barbell Back Squa");
  const retyped = applyNameEdit(typed, "Barbell Back Squat");

  assert.equal("libraryExerciseId" in retyped, false);
});

test("editing an unlinked (legacy/custom) name never adds a link key", () => {
  const result = applyNameEdit(legacy(), "Squat v2");

  assert.equal(result.name, "Squat v2");
  assert.equal("libraryExerciseId" in result, false);
  assert.equal(result.id, "slot-uuid-1111");
});

test("applyNameEdit coerces a non-string name to an empty string and does not mutate", () => {
  assert.equal(applyNameEdit(legacy(), undefined).name, "");
  assert.equal(applyNameEdit(legacy(), null).name, "");

  const before = linked();
  applyNameEdit(before, "something else");

  assert.equal(before.libraryExerciseId, "barbell-back-squat");
  assert.equal(before.name, "Barbell Back Squat");
});


// ----------------------------------------------------------------------------
// Full editing story (the slot id is constant throughout)
// ----------------------------------------------------------------------------

test("slot id never changes through select -> edit -> reselect -> unlink", async () => {
  const legPress = await library.getExercise("leg-press");
  const hackSquat = await library.getExercise("hack-squat");

  let exercise = legacy();
  const slot = exercise.id;

  exercise = applyLibrarySelection(exercise, legPress);
  assert.equal(exercise.id, slot);

  exercise = applyNameEdit(exercise, "Leg Press (feet high)");
  assert.equal(exercise.id, slot);
  assert.equal(isLinked(exercise), false);

  exercise = applyLibrarySelection(exercise, hackSquat);
  assert.equal(exercise.id, slot);
  assert.equal(exercise.libraryExerciseId, "hack-squat");

  exercise = clearLibraryLink(exercise);
  assert.equal(exercise.id, slot);
  assert.equal(isLinked(exercise), false);
});


// ----------------------------------------------------------------------------
// getLinkStatus
// ----------------------------------------------------------------------------

test("link status: library / library-missing / custom", async () => {
  const squat = await library.getExercise("barbell-back-squat");

  assert.deepEqual(getLinkStatus(linked(), squat), {
    kind: "library",
    text: "Library: Barbell Back Squat"
  });

  assert.deepEqual(getLinkStatus(legacy(), null), {
    kind: "custom",
    text: "Custom exercise"
  });

  // Linked, but the library does not know the id (or is offline): link is kept.
  assert.deepEqual(getLinkStatus(linked(), null), {
    kind: "library-missing",
    text: "Library exercise unavailable"
  });
  assert.deepEqual(getLinkStatus(linked(), undefined).kind, "library-missing");
});


// ----------------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------------

test("formatSlug and subtitle", async () => {
  assert.equal(formatSlug("front-delts"), "front delts");
  assert.equal(formatSlug("squat-rack"), "squat rack");
  assert.equal(formatSlug(undefined), "");

  const squat = await library.getExercise("barbell-back-squat");

  assert.equal(formatExerciseSubtitle(squat), "quadriceps, glutes · barbell, squat rack");

  const pullUp = await library.getExercise("pull-up");

  assert.equal(formatExerciseSubtitle(pullUp), "lats · pull up bar");

  assert.equal(
    formatExerciseSubtitle({ primaryMuscles: ["chest"], equipment: [] }),
    "chest · no equipment"
  );
});

test("findMatchedAlias: alias when the alias (not the name) matched", async () => {
  const rdl = await library.getExercise("barbell-romanian-deadlift");
  const dip = await library.getExercise("parallel-bar-dip");
  const squat = await library.getExercise("barbell-back-squat");

  assert.equal(findMatchedAlias(rdl, "rdl"), "RDL");
  assert.equal(findMatchedAlias(dip, "Dips"), "Dips");

  // Name matches -> no alias hint
  assert.equal(findMatchedAlias(rdl, "romanian"), null);
  assert.equal(findMatchedAlias(squat, "barbell back"), null);

  assert.equal(findMatchedAlias(rdl, ""), null);
  assert.equal(findMatchedAlias(null, "rdl"), null);
});


// ----------------------------------------------------------------------------
// buildPickerOptions
// ----------------------------------------------------------------------------

test("empty / whitespace / non-string query -> no rows", async () => {
  const results = await library.searchExercises("squat");

  assert.deepEqual(buildPickerOptions("", results), []);
  assert.deepEqual(buildPickerOptions("   ", results), []);
  assert.deepEqual(buildPickerOptions(null, results), []);
  assert.deepEqual(buildPickerOptions(undefined, results), []);
});

test("at most 6 library rows, followed by the custom row", async () => {
  const results = await library.searchExercises("a", { limit: 20 });

  assert.ok(results.length > PICKER_MAX_RESULTS, "test needs more than 6 hits");

  const options = buildPickerOptions("a", results);

  assert.equal(PICKER_MAX_RESULTS, 6);
  assert.equal(options.filter(o => o.type === "library").length, 6);
  assert.equal(options.length, 7);
  assert.equal(options[6].type, "custom");
  assert.equal(options[6].name, "a");
});

test("library rows carry id, name, subtitle and matchedAlias", async () => {
  const results = await library.searchExercises("rdl");
  const options = buildPickerOptions("rdl", results);

  assert.deepEqual(options[0], {
    type: "library",
    id: "barbell-romanian-deadlift",
    name: "Barbell Romanian Deadlift",
    subtitle: "hamstrings, glutes · barbell",
    matchedAlias: "RDL"
  });
});

test("custom row is offered when text is not an exact library NAME", async () => {
  const results = await library.searchExercises("Squat");
  const options = buildPickerOptions("Squat", results);

  // "Squat" is an alias of Barbell Back Squat (ranked first), not a name.
  assert.equal(options[0].id, "barbell-back-squat");
  assert.equal(options.at(-1).type, "custom");
  assert.equal(options.at(-1).name, "Squat");
});

test("no custom row when the text exactly matches a library name", async () => {
  const results = await library.searchExercises("hack squat");
  const options = buildPickerOptions("hack squat", results);

  assert.equal(options[0].id, "hack-squat");
  assert.ok(options.every(o => o.type === "library"));

  const upper = buildPickerOptions("HACK-SQUAT", await library.searchExercises("HACK-SQUAT"));

  assert.ok(upper.every(o => o.type === "library"), "case/punctuation-insensitive");
});

test("no matches -> only the custom row, keeping the user's trimmed text", async () => {
  const results = await library.searchExercises("zzzzqqq");
  const options = buildPickerOptions("  Zottman Curl  ", results);

  assert.deepEqual(results, []);
  assert.deepEqual(options, [{ type: "custom", name: "Zottman Curl" }]);
});

test("custom row is always last and library rows keep search order", async () => {
  const results = await library.searchExercises("press");
  const options = buildPickerOptions("press", results);

  const libraryIds = options.filter(o => o.type === "library").map(o => o.id);

  assert.deepEqual(libraryIds, results.slice(0, 6).map(r => r.id));
  assert.equal(options.at(-1).type, "custom");
});

test("buildPickerOptions tolerates bad searchResults and custom max", async () => {
  assert.deepEqual(buildPickerOptions("x", null), [{ type: "custom", name: "x" }]);
  assert.deepEqual(buildPickerOptions("x", "nope"), [{ type: "custom", name: "x" }]);

  const results = await library.searchExercises("a", { limit: 20 });

  assert.equal(buildPickerOptions("a", results, { max: 2 }).filter(o => o.type === "library").length, 2);
  assert.equal(buildPickerOptions("a", results, { max: 0 }).filter(o => o.type === "library").length, 6);
});

test("buildPickerOptions does not mutate the (frozen) search results", async () => {
  const results = await library.searchExercises("squat");

  assert.ok(Object.isFrozen(results));

  const before = results.map(r => r.id);
  buildPickerOptions("squat", results);

  assert.deepEqual(results.map(r => r.id), before);
});
