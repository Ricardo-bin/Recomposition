// ============================================================================
// Active workout session persistence (logWorkout.js), in jsdom.
//
// PLAN = intent (Firestore) | SESSION = in progress (memory + localStorage) |
// LOG = completed (Firestore). Only the SESSION is persisted client-side.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));

const SOURCE = readFileSync(resolve(here, "..", "logWorkout.js"), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
  .replace("export async function openWorkoutSession", "async function openWorkoutSession")
  + "\n;return { openWorkoutSession, get session() { return currentWorkoutSession; }, closeWorkoutSession };";

const PLANS = {
  p1: { id: "p1", name: "Upper B", exercises: [
    { id: "e1", name: "Bench", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120 },
    { id: "e2", name: "Row", sets: 2, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120 }] },
  p2: { id: "p2", name: "Lower A", exercises: [
    { id: "e3", name: "Squat", sets: 2, repMin: 5, repMax: 8, targetRIR: 2, restSeconds: 180 }] }
};

const KEY = uid => `recomposition.activeWorkoutSession.v1.${uid}`;

// "Browser + Firestore" that survive page refreshes within one test.
function makeWorld() {
  return { storage: {}, logs: [], creates: 0 };
}

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
  window.alert = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};

  let authCallback;

  const auth = { currentUser: uid ? { uid } : null };

  const stubs = {
    getWorkoutPlan: async id => PLANS[id] ?? null,
    getPreviousWorkoutLog: async () => null,
    getWorkoutLogs: async () => world.logs.slice(),
    createWorkoutLog: async log => {
      world.creates += 1;
      world.logs.push({ ...log, id: `L${world.creates}`, date: { toMillis: () => log.date.getTime() } });
      return `L${world.creates}`;
    },
    getAuthenticatedUserId: () => {
      if (!auth.currentUser) throw new Error("no user");
      return auth.currentUser.uid;
    },
    auth,
    onAuthStateChanged: (_auth, callback) => { authCallback = callback; }
  };

  const api = new Function(
    "document", "window", "localStorage", "CustomEvent",
    ...Object.keys(stubs), SOURCE
  )(window.document, window, window.localStorage, window.CustomEvent, ...Object.values(stubs));

  const input = (e, s, f) =>
    window.document.querySelector(`[data-exercise-index="${e}"][data-set-index="${s}"][data-set-field="${f}"]`);

  return {
    window, api, auth,
    signIn: async u => { auth.currentUser = { uid: u }; await authCallback({ uid: u }); await settle(); },
    signOut: async () => { auth.currentUser = null; await authCallback(null); await settle(); },
    value: (e, s, f) => input(e, s, f)?.value,
    type(e, s, f, v) {
      const el = input(e, s, f);
      el.value = v;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    fillAllSets(plan = PLANS.p1) {
      plan.exercises.forEach((ex, e) => {
        for (let s = 0; s < ex.sets; s += 1) {
          this.type(e, s, "weight", String(40 + e));
          this.type(e, s, "reps", "10");
          this.type(e, s, "rir", "2");
        }
      });
    },
    click: id => window.document.getElementById(id).click(),
    storedSession: () => world.storage[KEY("userA")]
  };
}


test("start -> log sets -> refresh -> session recovered with every value", { skip }, async () => {
  const world = makeWorld();

  let page = boot(world);
  await page.api.openWorkoutSession("p1");

  page.type(0, 0, "weight", "60");
  page.type(0, 0, "reps", "10");
  page.type(0, 0, "rir", "2");
  page.type(1, 1, "weight", "45");
  page.type(1, 1, "reps", "12");

  assert.ok(page.storedSession(), "session is mirrored to localStorage");
  assert.ok(!page.storedSession().includes("previousLog"), "derived data is not stored");

  // ---- refresh: brand-new page, same browser storage ----
  page = boot(world);
  assert.equal(page.api.session, null, "fresh page starts empty");

  await page.signIn("userA");

  assert.equal(page.api.session?.workoutName, "Upper B");
  assert.deepEqual(
    [page.value(0, 0, "weight"), page.value(0, 0, "reps"), page.value(0, 0, "rir"), page.value(1, 1, "weight"), page.value(1, 1, "reps")],
    ["60", "10", "2", "45", "12"]
  );
  assert.equal(world.creates, 0, "a refresh never creates a log");
  assert.ok(page.window.document.getElementById("section-workout").classList.contains("workout-session-active"));
});

test("recover -> keep logging -> refresh again keeps the newest edit", { skip }, async () => {
  const world = makeWorld();

  let page = boot(world);
  await page.api.openWorkoutSession("p1");
  page.type(0, 0, "weight", "60");

  page = boot(world);
  await page.signIn("userA");
  page.type(0, 1, "weight", "62");

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.value(0, 0, "weight"), "60");
  assert.equal(page.value(0, 1, "weight"), "62");
});

test("navigating away and back (same page) keeps the session; re-starting the same workout resumes it", { skip }, async () => {
  const world = makeWorld();

  const page = boot(world);
  await page.api.openWorkoutSession("p1");
  page.type(0, 0, "weight", "60");

  await page.api.openWorkoutSession("p1");   // e.g. Dashboard "Start" tapped again

  assert.equal(page.value(0, 0, "weight"), "60", "nothing wiped");
  assert.equal(world.creates, 0);
});

test("starting a DIFFERENT workout asks first and does not silently discard", { skip }, async () => {
  const world = makeWorld();

  const page = boot(world);
  await page.api.openWorkoutSession("p1");
  page.type(0, 0, "weight", "70");

  let asked = 0;
  page.window.confirm = () => { asked += 1; return false; };

  await page.api.openWorkoutSession("p2");

  assert.equal(asked, 1);
  assert.equal(page.api.session.planId, "p1");
  assert.equal(page.value(0, 0, "weight"), "70");

  page.window.confirm = () => true;
  await page.api.openWorkoutSession("p2");

  assert.equal(page.api.session.planId, "p2");
});

test("complete -> exactly ONE log, session cleared, nothing restored, new workout is clean", { skip }, async () => {
  const world = makeWorld();

  let page = boot(world);
  await page.api.openWorkoutSession("p1");
  page.fillAllSets();

  page.click("complete-workout-button");
  await settle(5);

  assert.equal(world.creates, 1, `one log (alerts may explain: ${world.creates})`);
  assert.equal(world.logs.length, 1);
  assert.equal(world.logs[0].exercises[0].sets[0].weight, "40");
  assert.equal(page.storedSession(), undefined, "temporary session removed");
  assert.equal(page.api.session, null);

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session, null, "nothing to restore after completion");
  assert.equal(world.creates, 1, "no duplicate log from a refresh");

  await page.api.openWorkoutSession("p1");

  assert.equal(page.value(0, 0, "weight"), "", "old session state is gone");
  assert.equal(page.value(1, 1, "weight"), "");
});

test("Close is an explicit discard: nothing is restored afterwards", { skip }, async () => {
  const world = makeWorld();

  let page = boot(world);
  await page.api.openWorkoutSession("p1");
  page.type(0, 0, "weight", "99");

  page.click("close-workout-session");

  assert.equal(page.storedSession(), undefined);

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session, null);
});

test("user isolation: another account on the same browser never sees the session", { skip }, async () => {
  const world = makeWorld();

  const a = boot(world);
  await a.api.openWorkoutSession("p1");
  a.type(0, 0, "weight", "60");

  const b = boot(world, "userB");
  await b.signIn("userB");

  assert.equal(b.api.session, null, "user B sees nothing");

  await a.signOut();

  assert.equal(a.api.session, null, "sign-out drops the in-memory session");
  assert.ok(world.storage[KEY("userA")], "...but keeps it stored for its owner");

  const again = boot(world);
  await again.signIn("userA");

  assert.equal(again.value(0, 0, "weight"), "60", "the owner gets it back");
});

test("refresh DURING saving: if the log reached Firestore the session is not offered again", { skip }, async () => {
  const world = makeWorld();

  let page = boot(world);
  await page.api.openWorkoutSession("p2");
  page.type(0, 0, "weight", "100");

  const snapshot = JSON.parse(page.storedSession());
  snapshot.completing = true;
  world.storage[KEY("userA")] = JSON.stringify(snapshot);

  world.logs.push({ planId: "p2", date: { toMillis: () => new Date(snapshot.date).getTime() } });

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session, null, "no duplicate offered");
  assert.equal(page.storedSession(), undefined);
  assert.equal(world.creates, 0);

  // ...and if it did NOT reach Firestore, it is restored so the user can retry.
  world.logs.length = 0;
  world.storage[KEY("userA")] = JSON.stringify(snapshot);

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session?.status, "in-progress");
  assert.equal(page.value(0, 0, "weight"), "100");
});

test("corrupt stored data is ignored and cleared", { skip }, async () => {
  const world = makeWorld();
  world.storage[KEY("userA")] = "{not json";

  const page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session, null);
  assert.equal(page.storedSession(), undefined);
});

test("added / removed sets are persisted too", { skip }, async () => {
  const world = makeWorld();

  let page = boot(world);
  await page.api.openWorkoutSession("p2");

  page.window.document.querySelector("[data-add-set]").click();

  assert.equal(JSON.parse(page.storedSession()).exercises[0].sets.length, 3);

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.api.session.exercises[0].sets.length, 3);
});
