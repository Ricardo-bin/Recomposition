// ============================================================================
// Independent exercise logging (final phase).
//   PLAN = intent | SESSION = today (each exercise has logStatus) | LOG = done
// Pure rules + the real logWorkout.js in jsdom. Run: node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";
import * as alternativeToday from "../alternativeToday.js";
import * as pendingWorkouts from "../pendingWorkouts.js";
import * as exerciseLogging from "../exerciseLogging.js";
import { summarizeLog, describeExercise } from "../historyView.js";

const {
  exerciseState, validateExercise, summarizeSession, summarizeLoggedExercise,
  planFinish, needsFinishConfirmation, buildPerformedSession, finishQuestion, isCompletedSet
} = exerciseLogging;

const set = (weight = "", reps = "", rir = "") => ({ weight, reps, rir });
const ex = (name, sets, extra = {}) => ({ exerciseId: name, name, sets, ...extra });

// ---------------------------------------------------------------- pure rules

test("states: not-started, in-progress, logged, skipped (and old sessions without logStatus)", () => {
  assert.equal(exerciseState(ex("A", [set(), set()])), "not-started");
  assert.equal(exerciseState(ex("A", [set("40"), set()])), "in-progress");
  assert.equal(exerciseState(ex("A", [set("40", "10")], { logStatus: "logged" })), "logged");
  assert.equal(exerciseState(ex("A", [set()], { logStatus: "skipped" })), "skipped");
  assert.equal(exerciseState(null), "not-started");
});

test("one exercise can be validated on its own", () => {
  assert.equal(validateExercise(ex("Bench", [set("40", "10", "2"), set()])).valid, true);
  assert.equal(validateExercise(ex("Bench", [set(), set()])).valid, false);
  assert.match(validateExercise(ex("Bench", [set("40", "")])).message, /reps for Set 1/);
  assert.match(validateExercise(ex("Bench", [set(), set()])).message, /Enter weight and reps/);
  assert.match(validateExercise(ex("Bench", [set("40", "10"), set("", "8")])).message, /weight for Set 2/);
  assert.match(validateExercise(ex("Bench", [set("40", "0")])).message, /Reps for Set 1/);
  assert.match(validateExercise(ex("Bench", [set("40", "10", "9")])).message, /RIR for Set 1/);
});

test("summary text for a logged card", () => {
  assert.equal(summarizeLoggedExercise(ex("A", [set("40", "10"), set("40", "10"), set("40", "10"), set()])), "3 sets · 40kg × 10");
  assert.equal(summarizeLoggedExercise(ex("A", [set("40", "10"), set("45", "8")])), "2 sets · 45kg × 8");
  assert.equal(summarizeLoggedExercise(ex("A", [set("40", "10")])), "1 set · 40kg × 10");
});

test("1. log one exercise only; 2. leave the others unstarted -> can finish", () => {
  const session = { exercises: [
    ex("Bench", [set("40", "10", "2"), set("40", "10", "2")], { logStatus: "logged" }),
    ex("Row", [set(), set()]),
    ex("Curl", [set(), set()])
  ] };

  assert.deepEqual(summarizeSession(session), { total: 3, logged: 1, skipped: 0, inProgress: 0, notStarted: 2 });

  const plan = planFinish(session);
  assert.equal(plan.ok, true);
  assert.equal(needsFinishConfirmation(plan), true);
  assert.equal(finishQuestion(plan), "You logged 1 of 3 exercises. Finish this workout anyway?");
});

test("3. skipped exercises are left out and 4. several exercises log independently", () => {
  const session = { exercises: [
    ex("Bench", [set("40", "10")], { logStatus: "logged" }),
    ex("Lat", [set()], { logStatus: "skipped" }),
    ex("Row", [set("50", "12")], { logStatus: "logged" }),
    ex("Curl", [set(), set()])
  ] };

  const performed = buildPerformedSession(session);

  assert.deepEqual(performed.exercises.map(e => e.name), ["Bench", "Row"]);
});

test("6. no sets are invented: empty sets are dropped, nothing is added for unlogged exercises", () => {
  const session = { exercises: [
    ex("Bench", [set("40", "10", "2"), set("", "", ""), set("42.5", "8", "1")], { logStatus: "logged" }),
    ex("Row", [set(), set(), set()])
  ] };

  const performed = buildPerformedSession(session);

  assert.equal(performed.exercises.length, 1);
  assert.equal(performed.exercises[0].sets.length, 2);
  assert.ok(performed.exercises[0].sets.every(isCompletedSet));
  assert.ok(!("logStatus" in performed.exercises[0]), "the marker is not written into the log");
  assert.equal(session.exercises[0].sets.length, 3, "the session itself is not changed");
  assert.equal(session.exercises[0].logStatus, "logged");
});

test("typed-but-unsaved sets are saved on finish; half-typed ones are left out and never block", () => {
  const typed = { exercises: [ex("Bench", [set("40", "10")]), ex("Row", [set()])] };

  assert.deepEqual(buildPerformedSession(typed).exercises.map(e => e.name), ["Bench"]);

  const half = { exercises: [ex("Bench", [set("40", "10")], { logStatus: "logged" }), ex("Row", [set("50", "")])] };
  const plan = planFinish(half);

  assert.equal(plan.ok, true, "an unfinished exercise does not block finishing");
  assert.deepEqual(plan.unsaved, ["Row"]);
  assert.match(finishQuestion(plan), /You logged 1 of 2 exercises\. Unsaved sets for Row will not be included\. Finish this workout anyway\?/);
  assert.deepEqual(buildPerformedSession(half).exercises.map(e => e.name), ["Bench"]);
});

test("a SAVED exercise edited into an invalid state is the only thing that blocks (and says why)", () => {
  const plan = planFinish({ exercises: [ex("Bench", [set("40", "")], { logStatus: "logged" })] });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /Bench/);
});

test("nothing logged -> finish is refused with a clear message (no empty workout)", () => {
  const plan = planFinish({ exercises: [ex("A", [set()], { logStatus: "skipped" }), ex("B", [set()])] });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /at least one exercise/i);
});

test("everything logged -> finish without a question", () => {
  const plan = planFinish({ exercises: [ex("A", [set("1", "1")], { logStatus: "logged" })] });

  assert.equal(needsFinishConfirmation(plan), false);
});

test("12. a session stored before this phase (no logStatus anywhere) still finishes", () => {
  const old = { exercises: [ex("Bench", [set("40", "10", "2")]), ex("Row", [set("50", "8", "2")])] };
  const plan = planFinish(old);

  assert.equal(plan.ok, true);
  assert.equal(plan.included.length, 2);
  assert.equal(needsFinishConfirmation(plan), false);
});

test("10. History shows a partial workout from the unchanged log structure", () => {
  const log = buildPerformedSession({
    workoutName: "Upper A",
    exercises: [
      ex("Bench", [set("40", "10", "2"), set("40", "10", "2")], { logStatus: "logged", targetSets: 3, repMin: 8, repMax: 12, targetRIR: 2 }),
      ex("Row", [set()]),
      ex("Curl", [set()], { logStatus: "skipped" })
    ]
  });

  const summary = summarizeLog(log);

  assert.equal(summary.exerciseCount, 1);
  assert.equal(summary.setCount, 2);
  assert.equal(summary.volume, 800);

  const detail = describeExercise(log.exercises[0]);

  assert.equal(detail.sets.length, 2);
  assert.equal(detail.best.weight, 40);
});

// ---------------------------------------------------------- real page (jsdom)

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;
const here = dirname(fileURLToPath(import.meta.url));

const SOURCE = readFileSync(resolve(here, "..", "logWorkout.js"), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
  .replace("export async function openWorkoutSession", "async function openWorkoutSession")
  + "\n;return { openWorkoutSession, get session() { return currentWorkoutSession; }, closeWorkoutSession };";

const PLAN = () => ({
  id: "p1", name: "Upper A", exercises: [
    { id: "e1", name: "Bench Press", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120 },
    { id: "e2", name: "Lat Pulldown", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120 },
    { id: "e3", name: "Cable Row", sets: 2, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120 },
    { id: "e4", name: "Biceps Curl", sets: 2, repMin: 10, repMax: 15, targetRIR: 1, restSeconds: 60 }
  ]
});

const KEY = uid => `recomposition.activeWorkoutSession.v1.${uid}`;

const makeWorld = () => ({ storage: {}, logs: [], creates: 0, plan: PLAN(), alerts: [] });

function boot(world, uid = "userA") {
  const dom = new JSDOM(
    `<section id="section-workout"><div id="workout-content">
       <div class="workout-action-bar"></div><div class="weekly-schedule"></div>
     </div></section>`,
    { url: "http://localhost/" }
  );

  const { window } = dom;

  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: k => (k in world.storage ? world.storage[k] : null),
      setItem: (k, v) => { world.storage[k] = String(v); },
      removeItem: k => { delete world.storage[k]; }
    }
  });

  window.confirm = () => true;
  window.alert = message => { world.alerts.push(message); };
  window.HTMLElement.prototype.scrollIntoView = function () {};

  let authCallback;
  const auth = { currentUser: uid ? { uid } : null };

  const stubs = {
    ...alternativeToday,
    ...pendingWorkouts,
    ...exerciseLogging,
    getWorkoutPlan: async () => structuredClone(world.plan),
    getPreviousWorkoutLog: async () => null,
    getWorkoutLogs: async () => world.logs.slice(),
    saveWorkoutLogOnce: async (_uid, id, log) => {
      const doc = { ...log, id, date: { toMillis: () => log.date.getTime() } };
      world.creates += 1;
      world.logs.push(doc);
      return id;
    },
    getAuthenticatedUserId: () => auth.currentUser.uid,
    auth,
    onAuthStateChanged: (_auth, callback) => { authCallback = callback; }
  };

  const api = new Function(
    "document", "window", "localStorage", "CustomEvent",
    ...Object.keys(stubs), SOURCE
  )(window.document, window, window.localStorage, window.CustomEvent, ...Object.values(stubs));

  const $ = selector => window.document.querySelector(selector);
  const input = (e, s, f) => $(`[data-exercise-index="${e}"][data-set-index="${s}"][data-set-field="${f}"]`);

  return {
    window, api, $,
    signIn: async u => { auth.currentUser = { uid: u }; await authCallback({ uid: u }); await settle(); },
    type(e, s, f, v) {
      const el = input(e, s, f);
      el.value = v;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    fill(e, weight = "40", reps = "10", rir = "2") {
      const count = world.plan.exercises[e].sets;
      for (let s = 0; s < count; s += 1) {
        this.type(e, s, "weight", weight);
        this.type(e, s, "reps", reps);
        this.type(e, s, "rir", rir);
      }
    },
    value: (e, s, f) => input(e, s, f)?.value,
    state: e => $(`[data-session-exercise="${e}"]`)?.dataset.exerciseState,
    badge: e => $(`[data-session-exercise="${e}"] .exercise-state`)?.textContent.trim(),
    body: e => $(`[data-session-exercise="${e}"] .workout-session-body`),
    click: selector => $(selector).click(),
    finish: async () => { $("#complete-workout-button").click(); await settle(5); },
    stored: () => JSON.parse(world.storage[KEY("userA")] ?? "null")
  };
}

test("every exercise shows LOG EXERCISE; the finish button is FINISH WORKOUT", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  assert.equal(page.window.document.querySelectorAll("[data-log-exercise]").length, 4);
  assert.equal(page.window.document.querySelectorAll("[data-skip-exercise]").length, 4);
  assert.match(page.$("#complete-workout-button").textContent, /Finish Workout/);
  assert.match(page.$("#workout-session-status").textContent, /0 of 4 logged/);
  assert.equal(page.body(0).hidden, true, "not-started cards stay compact");
});

test("LOG EXERCISE opens the card, typing makes it IN PROGRESS, SAVE EXERCISE makes it LOGGED", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  assert.equal(page.body(0).hidden, false);
  assert.ok(page.$('[data-save-exercise="0"]'));

  page.fill(0);
  assert.equal(page.stored().exercises[0].logStatus, undefined, "typing alone is not 'saved'");

  page.click('[data-save-exercise="0"]');

  assert.equal(page.state(0), "logged");
  assert.match(page.badge(0), /LOGGED/);
  assert.equal(page.body(0).hidden, true, "a logged card collapses");
  assert.match(page.$('[data-session-exercise="0"] .exercise-summary').textContent, /3 sets · 40kg × 10/);
  assert.match(page.$("#workout-session-status").textContent, /1 of 4 logged/);
  assert.equal(page.stored().exercises[0].logStatus, "logged", "saved into the existing active session");
  assert.equal(world.creates, 0, "saving an exercise does not create the workout log");
});

test("saving an exercise with missing data is refused and explained", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  page.type(0, 0, "weight", "40");
  page.click('[data-save-exercise="0"]');

  assert.match(world.alerts.at(-1), /reps for Set 1 of Bench Press/i);
  assert.equal(page.state(0), "in-progress");
});

test("7/8. reload: the active session and the LOGGED exercise survive", { skip }, async () => {
  const world = makeWorld();
  let page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  page.fill(0, "42.5", "8", "1");
  page.click('[data-save-exercise="0"]');
  page.click('[data-skip-exercise="2"]');

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session?.workoutName, "Upper A");
  assert.equal(page.state(0), "logged");
  assert.equal(page.value(0, 0, "weight"), "42.5");
  assert.equal(page.state(2), "skipped");
  assert.equal(page.state(1), "not-started");
  assert.equal(world.creates, 0);
});

test("a skipped exercise says SKIPPED TODAY, can be undone, and never touches the plan", { skip }, async () => {
  const world = makeWorld();
  const planBefore = JSON.stringify(world.plan);
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-skip-exercise="1"]');

  assert.equal(page.state(1), "skipped");
  assert.match(page.badge(1), /SKIPPED TODAY/);
  assert.match(page.$("#workout-session-status").textContent, /1 skipped/);

  page.click('[data-unskip-exercise="1"]');
  assert.equal(page.state(1), "not-started");

  page.click('[data-skip-exercise="1"]');
  assert.equal(JSON.stringify(world.plan), planBefore, "PLAN unchanged");
  assert.equal(page.api.session.exercises.length, 4, "still planned for next time");
});

test("5. FINISH with unfinished exercises asks first; CANCEL keeps the session", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  page.fill(0);
  page.click('[data-save-exercise="0"]');
  page.click('[data-log-exercise="1"]');
  page.fill(1);
  page.click('[data-save-exercise="1"]');
  page.click('[data-skip-exercise="2"]');

  await page.finish();

  const panel = page.$("#finish-confirm");
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /You logged 2 of 4 exercises\. Finish this workout anyway\?/);
  assert.equal(world.creates, 0);

  page.click("#finish-cancel");
  await settle(3);

  assert.equal(page.$("#finish-confirm").hidden, true);
  assert.ok(page.api.session, "session is still active");
  assert.equal(world.creates, 0);
});

test("5/6. FINISH saves ONLY what was performed: no sets for skipped or unstarted exercises", { skip }, async () => {
  const world = makeWorld();
  const planBefore = JSON.stringify(world.plan);
  let page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  page.fill(0);
  page.click('[data-save-exercise="0"]');
  page.click('[data-log-exercise="1"]');
  page.fill(1, "55", "12", "1");
  page.click('[data-save-exercise="1"]');
  page.click('[data-skip-exercise="2"]');
  // Biceps Curl: never started.

  await page.finish();
  page.click("#finish-confirm-yes");
  await settle(5);

  assert.equal(world.creates, 1);

  const log = world.logs[0];

  assert.deepEqual(log.exercises.map(e => e.name), ["Bench Press", "Lat Pulldown"]);
  assert.ok(log.exercises.every(e => e.sets.length > 0 && e.sets.every(s => s.weight !== "" && s.reps !== "")));
  assert.ok(log.exercises.every(e => !("logStatus" in e)));
  assert.equal(log.workoutName, "Upper A");
  assert.equal(page.api.session, null, "session is closed");
  assert.equal(world.storage[KEY("userA")], undefined, "temporary session removed");
  assert.equal(JSON.stringify(world.plan), planBefore, "PLAN unchanged");

  page = boot(world);
  await page.signIn("userA");
  assert.equal(page.api.session, null, "nothing to resume afterwards");
  assert.equal(world.creates, 1);
});

test("FINISH with every exercise logged needs no question", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  world.plan.exercises.forEach((_, e) => {
    page.click(`[data-log-exercise="${e}"]`);
    page.fill(e);
    page.click(`[data-save-exercise="${e}"]`);
  });

  await page.finish();

  assert.equal(world.creates, 1);
  assert.equal(world.logs[0].exercises.length, 4);
});

test("FINISH with nothing logged is refused (no empty workout is saved)", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-skip-exercise="0"]');
  await page.finish();

  assert.match(world.alerts.at(-1), /at least one exercise/i);
  assert.equal(world.creates, 0);
  assert.ok(page.api.session);
});

test("double tapping the confirmation creates exactly one log", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  page.fill(0);
  page.click('[data-save-exercise="0"]');

  await page.finish();

  const yes = page.$("#finish-confirm-yes");
  yes.click();
  yes.click();
  await settle(6);

  assert.equal(world.creates, 1);
});

test("a logged exercise can be edited again and the edit is what gets saved", { skip }, async () => {
  const world = makeWorld();
  const page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.click('[data-log-exercise="0"]');
  page.fill(0, "40", "10", "2");
  page.click('[data-save-exercise="0"]');

  page.click('[data-edit-exercise="0"]');
  assert.equal(page.body(0).hidden, false);

  page.type(0, 0, "weight", "45");
  page.click('[data-save-exercise="0"]');
  page.click('[data-skip-exercise="1"]');
  page.click('[data-skip-exercise="2"]');
  page.click('[data-skip-exercise="3"]');

  await page.finish();
  page.click("#finish-confirm-yes");
  await settle(5);

  assert.equal(world.logs[0].exercises[0].sets[0].weight, "45");
});
