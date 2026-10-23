// ============================================================================
// PHASE 3 — HISTORY DEPTH: critical logic tests
//
//   search · filters · date range · Alternative Today identity ·
//   previous-session comparison · exercise identity (F3) · edit / delete safety ·
//   pending workouts · user isolation
//
// Pure Node. History's logic lives in historyView.js (no DOM); the data layer is
// the REAL code against a fake Firestore (tests/helpers/dataLayer.mjs).
// How it looks on a phone is checked by hand in a browser, not here.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  filterLogs,
  hasActiveFilters,
  planOptions,
  exerciseOptions,
  exerciseKey,
  rangeStartKey,
  dateKey,
  summarizeLog,
  isEditedLog,
  plannedInfo,
  describeExercise,
  formatTarget,
  alignSets,
  applySetEdits,
  pendingDisplayLogs
} from "../historyView.js";

import { applyLibrarySelection } from "../exercisePicker.js";
import { getBestSet, estimateOneRepMax } from "../progressMetrics.js";
import { enqueuePending, readPending } from "../pendingWorkouts.js";
import { previousExerciseIn } from "../previousSession.js";
import { loadDataLayer } from "./helpers/dataLayer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = file => readFileSync(resolve(root, file), "utf8");

// ---- fixtures ------------------------------------------------------------------

const NOW = new Date(2026, 9, 7, 12, 0, 0);                     // 7 Oct 2026, local noon
const at = (daysAgo, hour = 18) => new Date(2026, 9, 7 - daysAgo, hour, 5, 0);

const sets = (...rows) => rows.map(([weight, reps, rir = "2"]) => ({ weight: String(weight), reps: String(reps), rir: String(rir) }));

const exercise = (exerciseId, name, setRows, extra = {}) => ({
  exerciseId, name, targetSets: 3, repMin: 8, repMax: 12, targetRIR: "2", sets: sets(...setRows), ...extra
});

const log = (id, daysAgo, planName, exercises, extra = {}) => ({
  id, planId: planName === "Upper A" ? "plan-upper" : "plan-lower", planName, status: "completed",
  date: at(daysAgo), createdAt: at(daysAgo, 19), updatedAt: at(daysAgo, 19), exercises, ...extra
});

const bench = (rows, id = "slot-bench") => exercise(id, "Barbell Bench Press", rows, { libraryExerciseId: "barbell-bench-press" });
const squat = rows => exercise("slot-squat", "Back Squat", rows, { libraryExerciseId: "back-squat" });
const dbBench = rows => exercise("alt:slot-bench:dumbbell-bench-press", "Dumbbell Bench Press", rows, {
  libraryExerciseId: "dumbbell-bench-press",
  plannedExerciseId: "slot-bench",
  plannedName: "Barbell Bench Press",
  alternativeToday: { original: { exerciseId: "slot-bench", name: "Barbell Bench Press" } }
});

const LOGS = [
  log("L1", 0, "Upper A", [bench([[60, 10], [60, 9], [57.5, 10]])]),
  log("L2", 3, "Lower A", [squat([[80, 8]])]),
  log("L3", 5, "Upper A", [dbBench([[24, 10], [24, 9]])]),
  log("L4", 7, "Upper A", [bench([[57.5, 10], [57.5, 9], [55, 10]])]),
  log("L5", 40, "Upper B", [exercise("slot-ohp", "Overhead Press", [[40, 8]])]),
  log("L6", 95, "Lower A", [squat([[70, 8]])])
];

const ids = list => list.map(item => item.id);

// ============================================================================
// 1-2  SEARCH
// ============================================================================

test("search by workout name: 'Upper' finds Upper A and Upper B, not Lower A", () => {
  assert.deepEqual(ids(filterLogs(LOGS, { search: "Upper" }, NOW)), ["L1", "L3", "L4", "L5"]);
});

test("search by exercise name: 'Bench' finds workouts containing bench press", () => {
  assert.deepEqual(ids(filterLogs(LOGS, { search: "bench" }, NOW)), ["L1", "L3", "L4"]);
});

test("search is case-insensitive, trims, and every word must match", () => {
  assert.deepEqual(ids(filterLogs(LOGS, { search: "  BACK   squat " }, NOW)), ["L2", "L6"]);
  assert.deepEqual(ids(filterLogs(LOGS, { search: "bench squat" }, NOW)), [], "both words in one workout only");
});

test("search also finds an Alternative Today day by its PLANNED exercise", () => {
  // L3's performed exercise is Dumbbell Bench Press; the plan said Barbell.
  assert.ok(ids(filterLogs(LOGS, { search: "barbell" }, NOW)).includes("L3"));
});

test("search with no match returns an empty list", () => {
  assert.deepEqual(filterLogs(LOGS, { search: "zzzz" }, NOW), []);
});

test("filterLogs never changes its input", () => {
  const before = JSON.stringify(LOGS);

  filterLogs(LOGS, { search: "bench", sort: "oldest", range: "30" }, NOW);

  assert.equal(JSON.stringify(LOGS), before);
});

test("sorting: newest first by default, oldest first on request, undated logs last either way", () => {
  const undated = { id: "U", planName: "Upper A", exercises: [] };
  const all = [undated, ...LOGS];

  assert.deepEqual(ids(filterLogs(all, {}, NOW)), ["L1", "L2", "L3", "L4", "L5", "L6", "U"]);
  assert.deepEqual(ids(filterLogs(all, { sort: "oldest" }, NOW)), ["L6", "L5", "L4", "L3", "L2", "L1", "U"]);
});

// ============================================================================
// 3  DATE FILTERING
// ============================================================================

test("date range 'last 7 days' = today and the 6 days before it", () => {
  assert.equal(rangeStartKey("7", NOW), "2026-10-01");
  assert.deepEqual(ids(filterLogs(LOGS, { range: "7" }, NOW)), ["L1", "L2", "L3"], "7 days ago is outside");
});

test("date range 30 and 90 days", () => {
  assert.deepEqual(ids(filterLogs(LOGS, { range: "30" }, NOW)), ["L1", "L2", "L3", "L4"]);
  assert.deepEqual(ids(filterLogs(LOGS, { range: "90" }, NOW)), ["L1", "L2", "L3", "L4", "L5"]);
  assert.equal(filterLogs(LOGS, { range: "all" }, NOW).length, 6);
});

test("date range uses the LOCAL calendar day, so a late-evening workout stays on its day", () => {
  const late = log("LATE", 0, "Upper A", [], { date: new Date(2026, 9, 7, 23, 59, 0) });
  const early = log("EARLY", 6, "Upper A", [], { date: new Date(2026, 9, 1, 0, 1, 0) });

  assert.deepEqual(ids(filterLogs([late, early], { range: "7" }, NOW)), ["LATE", "EARLY"]);
  assert.equal(dateKey(new Date(2026, 9, 7, 23, 59)), "2026-10-07");
});

test("custom range is inclusive on both ends, accepts one open end, and swaps a reversed range", () => {
  const key = d => dateKey(at(d));

  assert.deepEqual(ids(filterLogs(LOGS, { range: "custom", from: key(7), to: key(3) }, NOW)), ["L2", "L3", "L4"]);
  assert.deepEqual(ids(filterLogs(LOGS, { range: "custom", from: key(5) }, NOW)), ["L1", "L2", "L3"]);
  assert.deepEqual(ids(filterLogs(LOGS, { range: "custom", to: key(40) }, NOW)), ["L5", "L6"]);
  assert.deepEqual(ids(filterLogs(LOGS, { range: "custom", from: key(3), to: key(7) }, NOW)), ["L2", "L3", "L4"], "reversed -> swapped");
});

test("a log without a valid date is excluded from a date range but kept in 'all time'", () => {
  const broken = [{ id: "X", planName: "Upper A", date: "not a date", exercises: [] }];

  assert.equal(filterLogs(broken, { range: "30" }, NOW).length, 0);
  assert.equal(filterLogs(broken, {}, NOW).length, 1);
});

test("Firestore Timestamps, ISO strings and Dates all work as the log date", () => {
  const stamp = { toDate: () => at(1) };
  const mixed = [
    { id: "T", planName: "A", date: stamp, exercises: [] },
    { id: "S", planName: "A", date: at(2).toISOString(), exercises: [] },
    { id: "D", planName: "A", date: at(3), exercises: [] }
  ];

  assert.deepEqual(ids(filterLogs(mixed, { range: "7" }, NOW)), ["T", "S", "D"]);
});

// ============================================================================
// 4-5  WORKOUT + EXERCISE FILTERS
// ============================================================================

test("workout filter: only that plan name", () => {
  assert.deepEqual(ids(filterLogs(LOGS, { plan: "Lower A" }, NOW)), ["L2", "L6"]);
  assert.deepEqual(planOptions(LOGS), ["Lower A", "Upper A", "Upper B"]);
});

test("a log with no plan name gets one fallback name, used by both the option and the filter", () => {
  const nameless = [{ id: "N", date: at(1), exercises: [] }];

  assert.deepEqual(planOptions(nameless), ["Workout Session"]);
  assert.equal(filterLogs(nameless, { plan: "Workout Session" }, NOW).length, 1);
});

test("exercise filter: workouts where that exercise was PERFORMED", () => {
  assert.deepEqual(ids(filterLogs(LOGS, { exercise: "lib:barbell-bench-press" }, NOW)), ["L1", "L4"]);
  assert.deepEqual(ids(filterLogs(LOGS, { exercise: "lib:dumbbell-bench-press" }, NOW)), ["L3"],
    "an Alternative Today day counts for the exercise actually done");
});

test("exercise options: one entry per distinct exercise, sorted by name", () => {
  assert.deepEqual(
    exerciseOptions(LOGS).map(option => option.label),
    ["Back Squat", "Barbell Bench Press", "Dumbbell Bench Press", "Overhead Press"]
  );
});

test("filters combine (plan + exercise + range + search)", () => {
  const result = filterLogs(LOGS, { plan: "Upper A", exercise: "lib:barbell-bench-press", range: "30", search: "bench" }, NOW);

  assert.deepEqual(ids(result), ["L1", "L4"]);
  assert.equal(hasActiveFilters({ plan: "Upper A" }), true);
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ search: "x" }), false, "search is not a filter chip");
});

// ============================================================================
// 6  ALTERNATIVE TODAY HISTORY IDENTITY
// ============================================================================

test("Alternative Today: planned and performed are both kept and clearly different", () => {
  const info = describeExercise(dbBench([[24, 10]]));

  assert.equal(info.isAlternative, true);
  assert.equal(info.name, "Dumbbell Bench Press");
  assert.equal(info.plannedName, "Barbell Bench Press");
  assert.equal(describeExercise(bench([[60, 10]])).isAlternative, false);
  assert.equal(summarizeLog(LOGS[2]).hasAlternative, true);
  assert.equal(summarizeLog(LOGS[0]).hasAlternative, false);
});

test("Alternative Today also recognised from the older alternativeToday.original only", () => {
  const legacyAlt = { exerciseId: "alt:x:y", name: "Cable Fly", alternativeToday: { original: { name: "Pec Deck" } }, sets: [] };

  assert.deepEqual(plannedInfo(legacyAlt), { isAlternative: true, plannedName: "Pec Deck" });
});

test("Alternative Today never changes the exercise key used for filtering the saved plan's exercise", () => {
  assert.notEqual(exerciseKey(dbBench([])), exerciseKey(bench([])));
});

// ============================================================================
// 7  PREVIOUS-SESSION COMPARISON  (reuses the data layer's findPreviousLogs)
// ============================================================================

test("previous session: the newest earlier log of the same exercise", () => {
  const layer = loadDataLayer({ currentUid: "uA" });
  const sorted = filterLogs(LOGS, {}, NOW);                  // newest first, like History

  const previous = layer.findPreviousLogs(
    sorted.filter(item => item.id !== "L1"), bench([]), LOGS[0].date
  )[0];

  assert.equal(previous.id, "L4");

  const rows = alignSets(
    describeExercise(LOGS[0].exercises[0]).sets,
    describeExercise(previousExerciseIn(previous, bench([]))).sets
  );

  assert.deepEqual(
    rows.map(row => [row.number, row.current.weight, row.previous.weight]),
    [[1, "60", "57.5"], [2, "60", "57.5"], [3, "57.5", "55"]]
  );
});

test("previous session: an Alternative Today exercise only compares with the SAME alternative", () => {
  const layer = loadDataLayer({ currentUid: "uA" });

  const none = layer.findPreviousLogs(LOGS, dbBench([]), LOGS[2].date);

  assert.equal(none.length, 0, "the barbell days are not 'previous' for a dumbbell day");
});

test("previous session: a log is never its own previous, unfinished logs are ignored", () => {
  const layer = loadDataLayer({ currentUid: "uA" });
  const draft = log("D", 2, "Upper A", [bench([[1, 1]])], { status: "in-progress" });

  const found = layer.findPreviousLogs([draft, ...LOGS], bench([]), LOGS[0].date);

  assert.deepEqual(ids(found), ["L4"]);
});

test("comparison rows pad the shorter side instead of dropping sets", () => {
  const rows = alignSets(sets([60, 10], [60, 9]), sets([57.5, 10]));

  assert.equal(rows.length, 2);
  assert.equal(rows[1].previous, null);
  assert.deepEqual(alignSets(null, undefined), []);
});

// ============================================================================
// BEST PERFORMANCE uses Progress's definitions (no second formula)
// ============================================================================

test("best set / estimated 1RM come straight from progressMetrics", () => {
  const info = describeExercise(bench([[60, 10], [60, 9], [57.5, 10]]));
  const direct = getBestSet(sets([60, 10], [60, 9], [57.5, 10]));

  assert.deepEqual(info.best, direct);
  assert.equal(info.best.estimatedOneRepMax, estimateOneRepMax(60, 10));
  assert.doesNotMatch(source("historyView.js"), /\b0\.0333|Epley|Brzycki/i, "no formula of its own");
});

test("target text only describes what the log stored", () => {
  assert.equal(formatTarget({ targetSets: 3, repMin: 8, repMax: 12 }), "3 × 8–12");
  assert.equal(formatTarget({ targetSets: 3, repMin: 10, repMax: 10 }), "3 × 10");
  assert.equal(formatTarget({ targetSets: 4 }), "4 sets");
  assert.equal(formatTarget({}), "", "older logs with no target show none");
  assert.equal(describeExercise({ name: "X", sets: [] }).targetRir, "");
});

// ============================================================================
// 8  EXERCISE IDENTITY AFTER F3
// ============================================================================

test("after an exercise identity change, old and new exercises stay separate in History", () => {
  // Same plan slot used to be Leg Press, then the user switched it to Hack Squat (new slot id).
  const legPress = exercise("slot-1", "Leg Press", [[100, 10]], { libraryExerciseId: "leg-press" });
  const picked = applyLibrarySelection({ ...legPress, sets: undefined }, { id: "hack-squat", name: "Machine Hack Squat" }, { createId: () => "slot-NEW" });
  const hack = exercise(picked.id, picked.name, [[60, 10]], { libraryExerciseId: picked.libraryExerciseId });

  const logs = [log("OLD", 14, "Lower A", [legPress]), log("NEW", 1, "Lower A", [hack])];

  assert.equal(picked.id, "slot-NEW");
  assert.deepEqual(ids(filterLogs(logs, { exercise: "lib:leg-press" }, NOW)), ["OLD"]);
  assert.deepEqual(ids(filterLogs(logs, { exercise: "lib:hack-squat" }, NOW)), ["NEW"]);

  const layer = loadDataLayer({ currentUid: "uA" });

  assert.equal(layer.findPreviousLogs(logs, hack, at(0)).length, 1, "only the new exercise's own log");
  assert.equal(layer.findPreviousLogs([logs[0]], hack, at(0)).length, 0, "no Leg Press numbers as its previous");
});

test("filtering by exercise survives a slot-id change for the SAME library exercise", () => {
  const before = log("A", 10, "Upper A", [bench([[55, 10]], "slot-old")]);
  const after = log("B", 1, "Upper A", [bench([[60, 10]], "slot-new")]);

  assert.deepEqual(ids(filterLogs([before, after], { exercise: "lib:barbell-bench-press" }, NOW)), ["B", "A"]);
});

test("legacy logs without a library link are keyed by their (normalised) name", () => {
  assert.equal(exerciseKey({ name: "  Bench Press " }), "name:bench press");
  assert.equal(exerciseKey({ name: "Bench Press", libraryExerciseId: "" }), "name:bench press");
});

// ============================================================================
// 9  EDITING A LOG
// ============================================================================

test("editing sets keeps exercise identity (id, name, library link, Alternative Today, targets)", () => {
  const original = [dbBench([[24, 10], [24, 9]])];
  const snapshot = JSON.stringify(original);

  const [edited] = applySetEdits(original, [[{ weight: "26", reps: "10", rir: "1" }]]);

  assert.equal(JSON.stringify(original), snapshot, "the input is not mutated");
  assert.equal(edited.sets[0].weight, "26");
  assert.deepEqual(edited.sets[1], original[0].sets[1], "sets that were not edited are untouched");

  for (const field of ["exerciseId", "name", "libraryExerciseId", "plannedExerciseId", "plannedName", "alternativeToday", "targetSets", "repMin", "repMax", "targetRIR"]) {
    assert.deepEqual(edited[field], original[0][field], field);
  }
});

test("editing never adds or removes exercises or sets", () => {
  const original = [bench([[60, 10], [60, 9]]), squat([[80, 8]])];
  const edited = applySetEdits(original, [[{ weight: "1", reps: "1", rir: "1" }], []]);

  assert.equal(edited.length, 2);
  assert.deepEqual(edited.map(item => item.sets.length), [2, 1]);
});

test("History edit writes ONLY the log's exercises; it cannot touch a workout plan", async () => {
  const layer = loadDataLayer({ currentUid: "uA" });

  await layer.updateWorkoutLog("L1", { exercises: applySetEdits(LOGS[0].exercises, []) });

  assert.equal(layer.calls.update.length, 1);
  assert.equal(layer.calls.update[0].path, "users/uA/workoutLogs/L1");
  assert.deepEqual(Object.keys(layer.calls.update[0].data).sort(), ["exercises", "updatedAt"]);

  const history = source("history.js");

  assert.doesNotMatch(history, /WorkoutPlan|workoutPlans/, "history.js does not even know about plans");
  assert.match(history, /updateWorkoutLog\(\s*log\.id,\s*\{\s*exercises: updatedExercises\s*\}/);
});

test("an edited log is recognised by updatedAt moving after createdAt", () => {
  assert.equal(isEditedLog(LOGS[0]), false);
  assert.equal(isEditedLog({ ...LOGS[0], updatedAt: at(0, 22) }), true);
  assert.equal(isEditedLog({ date: at(1) }), false, "legacy logs with no timestamps are not 'edited'");
  assert.equal(isEditedLog({ createdAt: at(1), updatedAt: new Date(at(1).getTime() + 500) }), false, "sync rounding is not an edit");
});

// ============================================================================
// 10  DELETING A LOG
// ============================================================================

test("deleting removes exactly one document, inside the signed-in user's own logs", async () => {
  const layer = loadDataLayer({ currentUid: "uA" });

  await layer.deleteWorkoutLog("L2");

  assert.deepEqual(layer.calls.delete, [{ path: "users/uA/workoutLogs/L2" }]);
  assert.equal(layer.calls.update.length + layer.calls.set.length, 0, "no other document is written");
});

test("History asks for confirmation before deleting", () => {
  const history = source("history.js");
  const body = history.slice(history.indexOf("async function deleteWorkout"));

  assert.ok(body.indexOf("confirm(") !== -1 && body.indexOf("confirm(") < body.indexOf("deleteWorkoutLog("));
});

// ============================================================================
// 11  PENDING WORKOUTS ARE NOT CLOUD HISTORY
// ============================================================================

test("a pending workout is shown flagged as pending and is never part of the cloud list", () => {
  const items = [{ id: "P1", log: log("ignored", 0, "Upper A", [bench([[62.5, 8]])]), attempts: 2 }];
  const shown = pendingDisplayLogs(items, LOGS);

  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "P1");
  assert.equal(shown[0].isPending, true);
  assert.equal(shown[0].pendingAttempts, 2);
  assert.ok(!LOGS.some(item => item.isPending), "the cloud list is untouched");
  assert.equal(filterLogs(LOGS, {}, NOW).some(item => item.id === "P1"), false);
});

test("a pending workout that has already synced is not shown twice", () => {
  const items = [{ id: "L1", log: LOGS[0], attempts: 0 }, { id: "P2", log: LOGS[0], attempts: 0 }];

  assert.deepEqual(ids(pendingDisplayLogs(items, LOGS)), ["P2"]);
});

test("malformed queue entries are ignored, never thrown on", () => {
  assert.deepEqual(pendingDisplayLogs(null, LOGS), []);
  assert.deepEqual(pendingDisplayLogs([null, {}, { id: 5, log: {} }, { id: "ok" }], LOGS), []);
});

test("History reads pending workouts only for the signed-in user and never copies them anywhere", () => {
  const history = source("history.js");

  assert.match(history, /readPending\(uid\)/);
  assert.match(history, /auth\.currentUser\?\.uid/);
  assert.doesNotMatch(history, /enqueuePending|removePending|writePending|setItem|localStorage/, "History is read-only for the queue");
});

// ============================================================================
// 12  USER ISOLATION
// ============================================================================

test("cloud logs are always read from the signed-in user's own path", async () => {
  const layerA = loadDataLayer({ currentUid: "uA" });
  const layerB = loadDataLayer({ currentUid: "uB" });

  await layerA.getWorkoutLogsPage();
  await layerB.getWorkoutLogsPage();

  assert.equal(layerA.calls.reads[0], "users/uA/workoutLogs");
  assert.equal(layerB.calls.reads[0], "users/uB/workoutLogs");
});

test("with nobody signed in, the data layer refuses to read history", async () => {
  const layer = loadDataLayer({ currentUid: null });

  await assert.rejects(layer.getWorkoutLogsPage());
  assert.equal(layer.calls.reads.length, 0);
});

test("pending queues are per user: A's pending workout is invisible to B", () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };

  enqueuePending("uA", "P1", LOGS[0], storage);

  assert.deepEqual(pendingDisplayLogs(readPending("uB", storage), []), []);
  assert.deepEqual(ids(pendingDisplayLogs(readPending("uA", storage), [])), ["P1"]);
});

test("History keeps no user data in storage and clears search, filters and logs on sign-out", () => {
  const history = source("history.js");
  const handler = history.slice(history.indexOf('"recomposition-signed-out"'));

  assert.doesNotMatch(history, /localStorage|sessionStorage/, "no History data in browser storage");

  for (const reset of ["historyLogs = []", "historyCriteria = {", "historyRequestId += 1", "detailToken += 1"]) {
    assert.ok(handler.includes(reset), reset);
  }
});

test("a History load that finishes after sign-out is discarded", () => {
  const history = source("history.js");

  assert.match(history, /requestId !== historyRequestId/);
  assert.ok((history.match(/requestId !== historyRequestId/g) || []).length >= 3, "initial load, error path and older pages");
});

// ============================================================================
// STATES + SMALL SAFETY CHECKS
// ============================================================================

test("History shows the exact short messages from the spec", () => {
  const history = source("history.js");

  for (const text of [
    "No workouts yet.",
    "No workouts match your search.",
    "No workouts match these filters.",
    "Loading history...",
    "History couldn't be loaded."
  ]) {
    assert.ok(history.includes(text), text);
  }
});

test("every piece of log text reaches the page through escapeHtml", () => {
  const history = source("history.js");

  assert.match(history, /escapeHtml\(info\.name\)/);
  assert.match(history, /escapeHtml\(info\.plannedName/);
  assert.match(history, /escapeHtml\(summary\.name\)/);
  assert.match(history, /escapeHtml\(info\.notes\)/);
  assert.doesNotMatch(history, /\$\{info\.(name|plannedName|notes)\}/);
  assert.doesNotMatch(history, /\$\{summary\.name\}/);
});

test("the shared completed-log rule is still what History loads", () => {
  assert.match(source("history.js"), /isCompletedLog/);
  assert.doesNotMatch(source("history.js"), /status\s*[!=]==\s*"completed"/);
});
