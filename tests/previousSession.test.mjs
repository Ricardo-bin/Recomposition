// ============================================================================
// Cross-workout exercise history: ONE underlying exercise = ONE timeline, while
// every workout stays its own separate record.
//
// Regression for: "Weighted Pull-Up" done in an Upper workout and later in a
// Pull workout; opening it again showed the older Upper-day performance.
// Root cause: the previous-session lookup was filtered to the SAME plan
// (log.planId === planId) and matched the plan SLOT id (different in every
// plan) instead of the exercise identity History/Progress already use.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sameExercise } from "../historyView.js";
import {
  findPreviousSessions,
  selectPreviousSession,
  previousExerciseIn,
  isEligiblePerformance,
  hasCompletedSet
} from "../previousSession.js";
import { buildExerciseProgress } from "../progressInsights.js";
import { buildPerformedSession } from "../exerciseLogging.js";
import { loadDataLayer } from "./helpers/dataLayer.mjs";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";
import * as alternativeToday from "../alternativeToday.js";
import * as pendingWorkouts from "../pendingWorkouts.js";
import * as exerciseLogging from "../exerciseLogging.js";
import * as previousSession from "../previousSession.js";

// ---- fixtures ---------------------------------------------------------------

const LIB = "weighted-pull-up";
const day = (month, date, hour = 18) => new Date(2026, month - 1, date, hour, 0, 0);

const rows = list =>
  list.map(([weight, reps, rir = "2"]) => ({ weight: String(weight), reps: String(reps), rir: String(rir) }));

// The SAME exercise in two different plans has two different slot ids.
const pullUp = (slot, list, extra = {}) => ({
  exerciseId: slot,
  name: "Weighted Pull-Up",
  libraryExerciseId: LIB,
  targetSets: 3, repMin: 6, repMax: 10, targetRIR: "2",
  sets: rows(list),
  ...extra
});

const workout = (id, date, planId, workoutName, exercises, extra = {}) => ({
  id, planId, workoutName, status: "completed", date, createdAt: date, updatedAt: date, exercises, ...extra
});

// The example from the bug report.
const OCT10_UPPER = workout("oct10", day(10, 10), "plan-upper", "Upper", [pullUp("u-slot", [[0, 9], [0, 8], [0, 7]])]);
const OCT13_PULL = workout("oct13", day(10, 13), "plan-pull", "Pull", [pullUp("p-slot", [[5, 8], [5, 7], [5, 6]])]);
const OCT17_UPPER = workout("oct17", day(10, 17), "plan-upper", "Upper", [pullUp("u-slot", [[5, 9], [5, 8], [5, 7]])]);
const OCT20_PULL = workout("oct20", day(10, 20), "plan-pull", "Pull", [pullUp("p-slot", [[7.5, 8], [7.5, 7], [7.5, 6]])]);

const ALL = [OCT10_UPPER, OCT13_PULL, OCT17_UPPER, OCT20_PULL];

// What the app passes in: the exercise as it exists in TODAY's (Upper) workout.
const todaysUpperPullUp = { exerciseId: "u-slot", name: "Weighted Pull-Up", libraryExerciseId: LIB };
const todaysPullPullUp = { exerciseId: "p-slot", name: "Weighted Pull-Up", libraryExerciseId: LIB };

const previousId = (logs, exercise, before) =>
  selectPreviousSession(logs, exercise, before)?.log.id ?? null;

const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

const permutations = list =>
  list.length <= 1
    ? [list]
    : list.flatMap((item, index) =>
        permutations([...list.slice(0, index), ...list.slice(index + 1)]).map(rest => [item, ...rest])
      );

// ============================================================================
// THE REPORTED BUG
// ============================================================================

test("reported bug: opened on Oct 23 in an UPPER workout, Previous Session is the Oct 20 PULL performance", () => {
  const found = selectPreviousSession(ALL, todaysUpperPullUp, day(10, 23));

  assert.equal(found.log.id, "oct20");
  assert.equal(found.log.workoutName, "Pull");
  assert.deepEqual(
    found.exercise.sets.map(set => [set.weight, set.reps]),
    [["7.5", "8"], ["7.5", "7"], ["7.5", "6"]]
  );
});

test("the same answer when opened from the Pull workout", () => {
  assert.equal(previousId(ALL, todaysPullPullUp, day(10, 23)), "oct20");
});

// ============================================================================
// 1 / 2 / 3  DIRECTIONS AND SEVERAL WORKOUT TYPES
// ============================================================================

test("1. Upper -> Pull: the later PULL performance becomes the previous session", () => {
  assert.equal(previousId([OCT10_UPPER], todaysUpperPullUp, day(10, 12)), "oct10");
  assert.equal(previousId([OCT10_UPPER, OCT13_PULL], todaysUpperPullUp, day(10, 15)), "oct13");
});

test("2. Pull -> Upper: the later UPPER performance becomes the previous session", () => {
  assert.equal(previousId([OCT13_PULL], todaysPullPullUp, day(10, 15)), "oct13");
  assert.equal(previousId([OCT13_PULL, OCT17_UPPER], todaysPullPullUp, day(10, 19)), "oct17");
});

test("3. three or more workout types share one timeline", () => {
  const fullBody = workout("oct21", day(10, 21), "plan-full", "Full Body", [pullUp("f-slot", [[10, 5]])]);
  const back = workout("oct22", day(10, 22), "plan-back", "Back & Biceps", [pullUp("b-slot", [[10, 6]])]);
  const logs = [...ALL, fullBody, back];

  assert.equal(previousId(logs, todaysUpperPullUp, day(10, 23)), "oct22");
  assert.equal(previousId(logs, todaysUpperPullUp, day(10, 22)), "oct21");
  assert.equal(previousId(logs, todaysUpperPullUp, day(10, 21)), "oct20");

  const timeline = findPreviousSessions(logs, todaysUpperPullUp, day(10, 23)).map(m => m.log.id);

  assert.deepEqual(timeline, ["oct22", "oct21", "oct20", "oct17", "oct13", "oct10"]);
  assert.deepEqual(
    [...new Set(findPreviousSessions(logs, todaysUpperPullUp).map(m => m.log.workoutName))].sort(),
    ["Back & Biceps", "Full Body", "Pull", "Upper"]
  );
});

// ============================================================================
// 4  ORDER OF ARRIVAL NEVER MATTERS
// ============================================================================

test("4. records returned in ANY order give the same previous session (every permutation)", () => {
  for (const order of permutations(ALL)) {
    assert.equal(previousId(order, todaysUpperPullUp, day(10, 23)), "oct20", order.map(l => l.id).join(","));
    assert.equal(previousId(order, todaysUpperPullUp, day(10, 20)), "oct17", order.map(l => l.id).join(","));
  }
});

test("4. oldest-first (ascending) and Firestore-style Timestamps are handled", () => {
  const asTimestamp = log => ({ ...log, date: { toDate: () => log.date }, createdAt: { toDate: () => log.createdAt } });
  const ascending = [...ALL].sort((a, b) => a.date - b.date).map(asTimestamp);

  assert.equal(previousId(ascending, todaysUpperPullUp, { toDate: () => day(10, 23) }), "oct20");
});

test("4. two workouts on the same day: the later one wins, deterministically", () => {
  const morning = workout("am", day(10, 21, 7), "plan-upper", "Upper", [pullUp("u-slot", [[5, 5]])]);
  const evening = workout("pm", day(10, 21, 19), "plan-pull", "Pull", [pullUp("p-slot", [[6, 5]])]);

  assert.equal(previousId([morning, evening], todaysUpperPullUp, day(10, 22)), "pm");
  assert.equal(previousId([evening, morning], todaysUpperPullUp, day(10, 22)), "pm");
});

test("a session is never its own previous, and nothing newer than it counts", () => {
  assert.equal(previousId(ALL, todaysUpperPullUp, day(10, 20)), "oct17");
  assert.equal(
    selectPreviousSession(ALL, todaysUpperPullUp, day(10, 24), { excludeLogId: "oct20" }).log.id,
    "oct17"
  );
});

// ============================================================================
// 5  DISTINCT EXERCISES STAY DISTINCT
// ============================================================================

test("5. a different library exercise is never treated as the same exercise", () => {
  const plain = workout("plain", day(10, 21), "plan-pull", "Pull", [
    { exerciseId: "p-slot-2", name: "Pull-Up", libraryExerciseId: "pull-up", sets: rows([[0, 12]]) }
  ]);
  const chin = workout("chin", day(10, 22), "plan-pull", "Pull", [
    { exerciseId: "p-slot-3", name: "Chin-Up", libraryExerciseId: "chin-up", sets: rows([[0, 10]]) }
  ]);

  assert.equal(previousId([...ALL, plain, chin], todaysUpperPullUp, day(10, 23)), "oct20");
  assert.equal(
    previousId([...ALL, plain, chin], { name: "Pull-Up", libraryExerciseId: "pull-up" }, day(10, 23)),
    "plain"
  );
});

test("5. identity rules: library id wins; one-sided link falls back to the name; no name never matches", () => {
  assert.equal(sameExercise({ libraryExerciseId: "a", name: "X" }, { libraryExerciseId: "a", name: "Y" }), true);
  assert.equal(sameExercise({ libraryExerciseId: "a", name: "Same" }, { libraryExerciseId: "b", name: "Same" }), false);
  assert.equal(sameExercise({ libraryExerciseId: "a", name: "Weighted Pull-Up" }, { name: " weighted pull-up " }), true);
  assert.equal(sameExercise({ name: "Row" }, { name: "Cable Row" }), false);
  assert.equal(sameExercise({}, {}), false);
  assert.equal(sameExercise({ name: "" }, { name: "" }), false);
  assert.equal(sameExercise(null, undefined), false);
});

test("5. the plan slot id is NOT identity: the same slot id on another exercise does not match", () => {
  const sameSlotOtherExercise = workout("slot", day(10, 21), "plan-upper", "Upper", [
    { exerciseId: "u-slot", name: "Barbell Row", libraryExerciseId: "barbell-row", sets: rows([[60, 8]]) }
  ]);

  assert.equal(previousId([sameSlotOtherExercise], todaysUpperPullUp, day(10, 23)), null);
});

test("5. an older log saved before library links still joins the timeline (by name)", () => {
  const legacy = workout("legacy", day(10, 5), "plan-upper", "Upper", [
    { exerciseId: "old-slot", name: "Weighted Pull-Up", sets: rows([[0, 8]]) }
  ]);

  assert.equal(previousId([legacy], todaysUpperPullUp, day(10, 23)), "legacy");
  assert.equal(previousId([legacy, OCT10_UPPER], todaysUpperPullUp, day(10, 23)), "oct10");
});

// ============================================================================
// 6  INCOMPLETE / SKIPPED / UNSAVED NEVER REPLACE COMPLETED HISTORY
// ============================================================================

test("6. a newer log whose exercise has no performed sets does not replace the earlier completed one", () => {
  const blank = workout("blank", day(10, 22), "plan-pull", "Pull", [pullUp("p-slot", [["", ""], ["", ""]])]);
  const weightOnly = workout("wonly", day(10, 22, 20), "plan-pull", "Pull", [pullUp("p-slot", [[5, ""]])]);
  const repsOnly = workout("ronly", day(10, 22, 21), "plan-pull", "Pull", [pullUp("p-slot", [["", 8]])]);

  assert.equal(previousId([...ALL, blank, weightOnly, repsOnly], todaysUpperPullUp, day(10, 23)), "oct20");
  assert.equal(isEligiblePerformance(blank.exercises[0]), false);
  assert.equal(isEligiblePerformance(weightOnly.exercises[0]), false);
});

test("6. an in-progress (unfinished) workout is never a previous session", () => {
  const draft = workout("draft", day(10, 22), "plan-pull", "Pull", [pullUp("p-slot", [[9, 9]])], { status: "in-progress" });

  assert.equal(previousId([...ALL, draft], todaysUpperPullUp, day(10, 23)), "oct20");
});

test("6. a workout where the exercise was skipped (not in the saved log) changes nothing", () => {
  const session = {
    workoutName: "Pull",
    exercises: [
      pullUp("p-slot", [["", ""], ["", ""]], { logStatus: "skipped" }),
      { exerciseId: "p-row", name: "Barbell Row", libraryExerciseId: "barbell-row", logStatus: "logged", sets: rows([[60, 8]]) }
    ]
  };
  const saved = workout("skip", day(10, 22), "plan-pull", "Pull", buildPerformedSession(session).exercises);

  assert.deepEqual(saved.exercises.map(e => e.name), ["Barbell Row"]);
  assert.equal(previousId([...ALL, saved], todaysUpperPullUp, day(10, 23)), "oct20");
});

test("6. typing in today's session (unsaved) cannot affect what Previous Session shows", () => {
  const typing = { ...todaysUpperPullUp, sets: rows([[99, 99]]), logStatus: undefined };
  const before = previousId(ALL, typing, day(10, 23));

  assert.equal(before, "oct20");
  assert.equal(previousId(ALL, todaysUpperPullUp, day(10, 23)), before);
});

test("6. bodyweight work counts: weight 0 is a performance, not an empty set", () => {
  assert.equal(hasCompletedSet({ weight: "0", reps: "9" }), true);
  assert.equal(hasCompletedSet({ weight: 0, reps: 9 }), true);
  assert.equal(hasCompletedSet({ weight: "", reps: "9" }), false);
  assert.equal(previousId([OCT10_UPPER], todaysUpperPullUp, day(10, 12)), "oct10");
});

test("6. when the newest log is empty for this exercise, the next eligible one in the SAME workout type is used", () => {
  const blank = workout("blank", day(10, 22), "plan-pull", "Pull", [pullUp("p-slot", [["", ""]])]);

  assert.equal(previousId([...ALL, blank], todaysPullPullUp, day(10, 23)), "oct20");
});

// ============================================================================
// 7  SEPARATE WORKOUT RECORDS STAY UNCHANGED
// ============================================================================

test("7. selecting never changes, merges or rewrites any record", () => {
  const logs = ALL.map(log => structuredClone(log));
  const snapshot = JSON.stringify(logs);

  deepFreeze(logs); // any write would throw in strict mode

  const result = findPreviousSessions(logs, todaysUpperPullUp, day(10, 23));

  assert.equal(JSON.stringify(logs), snapshot);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(m => m.log.planId), ["plan-pull", "plan-upper", "plan-pull", "plan-upper"]);
  assert.ok(result.every(match => logs.includes(match.log)), "the SAME records are returned, not copies or merges");
  assert.deepEqual(
    result.map(m => [m.log.workoutName, m.exercise.sets[0].weight]),
    [["Pull", "7.5"], ["Upper", "5"], ["Pull", "5"], ["Upper", "0"]],
    "each workout keeps its own name and its own numbers"
  );
});

// ============================================================================
// 8  SAVE, THEN RELOAD  (real data layer against a fake Firestore)
// ============================================================================

const toDoc = ({ id, ...data }) => ({ id, data });

test("8. after saving a Pull workout and reloading, the Upper workout sees it as its previous", async () => {
  // Existing history, deliberately returned in a scrambled order.
  const stored = [OCT17_UPPER, OCT10_UPPER, OCT13_PULL].map(toDoc);

  let layer = loadDataLayer({ currentUid: "uA", docs: stored });

  assert.equal((await layer.getPreviousWorkoutLog(todaysUpperPullUp, day(10, 23)))?.id, "oct17");

  // Save the Oct 20 Pull workout through the real write path.
  await layer.saveWorkoutLogOnce("uA", "oct20", {
    planId: "plan-pull", workoutName: "Pull", date: day(10, 20), status: "completed",
    exercises: OCT20_PULL.exercises
  });

  const written = layer.calls.set.at(-1);

  assert.equal(written.path, "users/uA/workoutLogs/oct20");
  assert.equal(written.data.exercises[0].sets[0].weight, "7.5");

  // Reload: the app starts again and reads what is now stored.
  layer = loadDataLayer({ currentUid: "uA", docs: [...stored, { id: "oct20", data: written.data }] });

  const previous = await layer.getPreviousWorkoutLog(todaysUpperPullUp, day(10, 23));

  assert.equal(previous.id, "oct20");
  assert.equal(previous.workoutName, "Pull");
  assert.equal(previous.planId, "plan-pull");

  // The Upper records are exactly as they were.
  assert.deepEqual(
    stored.map(item => item.data.exercises[0].sets.map(s => s.weight)),
    [["5", "5", "5"], ["0", "0", "0"], ["5", "5", "5"]]
  );
});

test("8. the data layer answers the reported case from Firestore-ordered (newest-first) AND scrambled results", async () => {
  for (const order of [[...ALL].reverse(), ALL, [OCT17_UPPER, OCT20_PULL, OCT10_UPPER, OCT13_PULL]]) {
    const layer = loadDataLayer({ currentUid: "uA", docs: order.map(toDoc) });

    assert.equal((await layer.getPreviousWorkoutLog(todaysUpperPullUp, day(10, 23)))?.id, "oct20");
    assert.equal((await layer.getPreviousWorkoutLog({ name: "Never Done" }, day(10, 23))), null);
  }
});

test("8. History's comparison uses the same rule (a Pull log compares with the earlier Upper one)", () => {
  const layer = loadDataLayer({ currentUid: "uA" });
  const fromHistory = layer.findPreviousLogs(
    ALL.filter(item => item.id !== "oct20"), OCT20_PULL.exercises[0], OCT20_PULL.date
  );

  assert.deepEqual(fromHistory.map(item => item.id), ["oct17", "oct13", "oct10"]);
  assert.equal(previousExerciseIn(fromHistory[0], OCT20_PULL.exercises[0]).sets[0].weight, "5");
});

// ============================================================================
// 9  PERSONAL RECORDS ARE UNCHANGED (they already used the same identity)
// ============================================================================

test("9. Progress / PRs: one timeline across workouts, unaffected by the previous-session lookup", () => {
  const before = JSON.stringify(buildExerciseProgress(ALL, day(10, 23)));

  findPreviousSessions(ALL, todaysUpperPullUp, day(10, 23));
  selectPreviousSession(ALL, todaysPullPullUp, day(10, 21));

  const progress = buildExerciseProgress(ALL, day(10, 23));

  assert.equal(JSON.stringify(progress), before);

  const entry = (progress.exercises ?? progress).find(item => item.key === `lib:${LIB}`);

  // Oct 10 is bodyweight only (no positive weight) so it has no 1RM; the rest are one timeline.
  assert.equal(entry.sessionCount, 3);
  assert.equal(entry.prCount, 2);
  assert.equal(entry.latest.logId, "oct20");
  assert.equal(entry.previous.logId, "oct17");
});

// ============================================================================
// 10  ALTERNATIVE TODAY KEEPS ITS OWN IDENTITY
// ============================================================================

const ringRow = (slot, list, extra = {}) => ({
  exerciseId: slot, name: "Ring Row", libraryExerciseId: "ring-row", sets: rows(list), ...extra
});

// How buildLogSession stores an alternative: the PERFORMED exercise's name and
// library id, plus the planned one as metadata.
const altLog = workout("alt", day(10, 21), "plan-pull", "Pull", [
  ringRow("alt:p-slot:ring-row", [[0, 15], [0, 14]], {
    plannedName: "Weighted Pull-Up",
    plannedExerciseId: "p-slot",
    alternativeToday: { libraryExerciseId: "ring-row", original: { name: "Weighted Pull-Up", libraryExerciseId: LIB } }
  })
]);

test("10. an alternative performed instead does NOT become the planned exercise's previous session", () => {
  assert.equal(previousId([...ALL, altLog], todaysUpperPullUp, day(10, 23)), "oct20");
});

test("10. the alternative has its own timeline - from any workout, planned or alternative", () => {
  const ring = { name: "Ring Row", libraryExerciseId: "ring-row" };
  const plannedRingRow = workout("ring", day(10, 18), "plan-upper", "Upper", [ringRow("u-ring", [[0, 12]])]);

  assert.equal(previousId([...ALL, altLog], ring, day(10, 23)), "alt");
  assert.equal(previousId([...ALL, altLog, plannedRingRow], ring, day(10, 21)), "ring");
  assert.equal(previousId(ALL, ring, day(10, 23)), null, "never borrows Weighted Pull-Up numbers");
});

test("10. Progress keeps attributing the alternative to what was actually performed", () => {
  const progress = buildExerciseProgress([...ALL, altLog], day(10, 23));
  const list = progress.exercises ?? progress;

  assert.ok(list.find(item => item.key === `lib:${LIB}`));
  assert.equal(list.find(item => item.key === `lib:${LIB}`).sessionCount, 3);
});

// ============================================================================
// THE REAL WORKOUT SCREEN
// ============================================================================

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;
const here = dirname(fileURLToPath(import.meta.url));

const SOURCE = readFileSync(resolve(here, "..", "logWorkout.js"), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
  .replace("export async function openWorkoutSession", "async function openWorkoutSession")
  + "\n;return { openWorkoutSession, get session() { return currentWorkoutSession; } };";

test("the workout screen shows the Pull-day numbers as Previous Session inside an UPPER workout", { skip }, async () => {
  const upperPlan = {
    id: "plan-upper", name: "Upper",
    exercises: [{ id: "u-slot", name: "Weighted Pull-Up", libraryExerciseId: LIB, sets: 3, repMin: 6, repMax: 10, targetRIR: 2, restSeconds: 120 }]
  };

  const dom = new JSDOM(
    `<section id="section-workout"><div id="workout-content"><div class="workout-action-bar"></div><div class="weekly-schedule"></div></div></section>`,
    { url: "http://localhost/" }
  );
  const { window } = dom;

  Object.defineProperty(window, "localStorage", {
    value: { getItem: () => null, setItem() {}, removeItem() {} }
  });
  window.confirm = () => true;
  window.alert = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};

  const auth = { currentUser: { uid: "userA" } };
  const lookups = [];

  const stubs = {
    ...alternativeToday,
    ...pendingWorkouts,
    ...exerciseLogging,
    ...previousSession,
    getWorkoutPlan: async () => structuredClone(upperPlan),
    // The REAL selection rule over the stored history (newest/oldest, any order).
    getPreviousWorkoutLog: async (exercise, before) => {
      lookups.push(exercise.name);

      return selectPreviousSession([OCT13_PULL, OCT20_PULL, OCT10_UPPER, OCT17_UPPER], exercise, before)?.log ?? null;
    },
    getWorkoutLogs: async () => [],
    saveWorkoutLogOnce: async () => {},
    getAuthenticatedUserId: () => "userA",
    auth,
    onAuthStateChanged: () => {}
  };

  const api = new Function(
    "document", "window", "localStorage", "CustomEvent",
    ...Object.keys(stubs), SOURCE
  )(window.document, window, window.localStorage, window.CustomEvent, ...Object.values(stubs));

  await api.openWorkoutSession("plan-upper");
  await settle(5);

  const text = window.document.querySelector(".workout-previous-performance")?.textContent.replace(/\s+/g, " ") ?? "";

  assert.deepEqual(lookups, ["Weighted Pull-Up"]);
  assert.match(text, /PREVIOUS SESSION/);
  assert.match(text, /1\. 7\.5 kg × 8/);
  assert.match(text, /3\. 7\.5 kg × 6/);
  assert.doesNotMatch(text, /5 kg × 9/, "not the older Upper-day performance");

  // The per-set "previous" column uses the same record.
  const firstPrevious = window.document.querySelector(".workout-set-previous")?.textContent.replace(/\s+/g, " ").trim();

  assert.match(firstPrevious ?? "", /7\.5/);
});
