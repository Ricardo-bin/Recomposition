// ============================================================================
// Alternative Today — real logWorkout.js + real exercise picker, in jsdom.
//
// PLAN = intent (Firestore) | SESSION = today (memory + localStorage) |
// LOG = what was actually done (Firestore). Alternative Today lives ONLY in
// the session; the plan is never written.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";
import * as alternativeToday from "../alternativeToday.js";
import * as pickerUi from "../exercisePickerUI.js";
import { createExerciseLibrary } from "../data/exerciseLibrary.js";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));

const RAW_SOURCE = readFileSync(resolve(here, "..", "logWorkout.js"), "utf8");

const LIBRARY_JSON = readFileSync(
  resolve(here, "..", "data", "exercise-library.v1.json"),
  "utf8"
);

const SOURCE = RAW_SOURCE
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
  .replace("export async function openWorkoutSession", "async function openWorkoutSession")
  // The two lazy imports become injected modules.
  .replace('import("./exercisePickerUI.js")', "__loadPickerUi()")
  .replace('import("./data/exerciseLibrary.js")', "__loadLibrary()")
  + "\n;return { openWorkoutSession, get session() { return currentWorkoutSession; }, closeWorkoutSession };";

const PLAN_P1 = () => ({
  id: "p1",
  name: "Upper A",
  exercises: [
    { id: "e1", name: "Barbell Bench Press", libraryExerciseId: "barbell-bench-press", sets: 3, repMin: 6, repMax: 10, targetRIR: 2, restSeconds: 150 },
    { id: "e2", name: "Lat Pulldown", libraryExerciseId: "lat-pulldown", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120 },
    { id: "e3", name: "Cable Lateral Raise", sets: 2, repMin: 12, repMax: 15, targetRIR: 1, restSeconds: 60 }
  ]
});

const KEY = uid => `recomposition.activeWorkoutSession.v1.${uid}`;

// "Browser + Firestore" shared by every page of one test.
function makeWorld() {
  const plans = { p1: PLAN_P1() };

  return {
    storage: {},
    logs: [],
    creates: 0,
    plans,
    plansAtStart: JSON.stringify(plans),
    previousCalls: [],
    alerts: [],
    library: createExerciseLibrary({ loadJson: async () => JSON.parse(LIBRARY_JSON) })
  };
}

function boot(world, { uid = "userA", library, pickerFails = false } = {}) {
  const dom = new JSDOM(
    `<body><section id="section-workout"><div id="workout-content">
       <div class="workout-action-bar"></div><div class="weekly-schedule"></div>
     </div></section></body>`,
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
    getWorkoutPlan: async id => (world.plans[id] ? structuredClone(world.plans[id]) : null),
    getPreviousWorkoutLog: async (planId, exerciseId) => {
      world.previousCalls.push({ planId, exerciseId });
      return null;
    },
    getWorkoutLogs: async () => world.logs.slice(),
    createWorkoutLog: async log => {
      world.creates += 1;
      world.logs.push({ ...structuredClone(log), id: `L${world.creates}` });
      return `L${world.creates}`;
    },
    getAuthenticatedUserId: () => {
      if (!auth.currentUser) throw new Error("no user");
      return auth.currentUser.uid;
    },
    auth,
    onAuthStateChanged: (_auth, callback) => { authCallback = callback; },
    __loadPickerUi: async () => {
      if (pickerFails) throw new Error("module failed to load");
      return pickerUi;
    },
    __loadLibrary: async () => library ?? world.library
  };

  const api = new Function(
    "document", "window", "localStorage", "CustomEvent",
    ...Object.keys(stubs), SOURCE
  )(window.document, window, window.localStorage, window.CustomEvent, ...Object.values(stubs));

  const $ = selector => window.document.querySelector(selector);

  const page = {
    window, api, world,
    $,
    signIn: async u => { auth.currentUser = { uid: u }; await authCallback({ uid: u }); await settle(); },
    text: selector => $(selector)?.textContent ?? null,
    exerciseName: index =>
      $(`[data-session-exercise="${index}"] h3`)?.textContent.trim(),
    type(e, s, f, v) {
      const el = $(`[data-exercise-index="${e}"][data-set-index="${s}"][data-set-field="${f}"]`);
      el.value = v;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    value: (e, s, f) =>
      $(`[data-exercise-index="${e}"][data-set-index="${s}"][data-set-field="${f}"]`)?.value,
    fillAll(valueFor = e => String(50 + e)) {
      api.session.exercises.forEach((ex, e) => {
        for (let s = 0; s < ex.sets.length; s += 1) {
          this.type(e, s, "weight", valueFor(e));
          this.type(e, s, "reps", "10");
          this.type(e, s, "rir", "2");
        }
      });
    },
    stored: () => JSON.parse(world.storage[KEY("userA")] ?? "null"),

    // ---- the sheet ----
    async openSheet(index) {
      $(`[data-alt-open="${index}"]`).click();
      await settle(6);
    },
    async search(text) {
      const input = $("#alt-today-sheet .exercise-name-input");
      input.value = text;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await settle(6);
    },
    options: () => [...window.document.querySelectorAll("#alt-today-sheet .exercise-picker-option")],
    async pick(name) {
      const option = this.options().find(o =>
        o.querySelector(".exercise-picker-option-name").textContent === name);
      assert.ok(option, `option "${name}" is offered`);
      option.click();
      await settle(4);
    },
    confirm: async () => {
      $("#alt-today-sheet [data-alt-confirm]").click();
      await settle(8);
    },
    sheetOpen: () => Boolean($("#alt-today-sheet")),
    error: () => {
      const el = $("#alt-today-sheet [data-alt-error]");
      return el && !el.hidden ? el.textContent.trim() : "";
    },
    confirmDisabled: () => $("#alt-today-sheet [data-alt-confirm]").disabled,

    async chooseAlternative(index, query, name) {
      await this.openSheet(index);
      await this.search(query);
      await this.pick(name);
      await this.confirm();
    },
    async complete() {
      $("#complete-workout-button").click();
      await settle(8);
    }
  };

  return page;
}

const startUpperA = async (world = makeWorld(), options) => {
  const page = boot(world, options);
  await page.api.openWorkoutSession("p1");
  return page;
};

const INCLINE = "Incline Dumbbell Press";


// ---- the core flow ---------------------------------------------------------------

test("Alternative Today replaces the exercise for today and says it is temporary", { skip }, async () => {
  const page = await startUpperA();

  assert.equal(page.exerciseName(0), "Barbell Bench Press");

  await page.openSheet(0);

  const sheet = page.text("#alt-today-sheet");
  assert.match(sheet, /ALTERNATIVE TODAY/);
  assert.match(sheet, /Barbell Bench Press/);
  assert.match(sheet, /temporary replacement for today's session/i);
  assert.match(sheet, /saved workout plan will NOT change/);
  assert.match(sheet, /TODAY ONLY/);

  await page.search("incline");
  await page.pick(INCLINE);

  assert.equal(page.confirmDisabled(), false);
  const summary = page.text("#alt-today-sheet [data-alt-summary]");
  assert.match(summary, /TODAY'S ALTERNATIVE/);
  assert.match(summary, /Barbell Bench Press\s*↓\s*Incline Dumbbell Press/);
  assert.match(summary, /saved workout plan is unchanged/);
  assert.match(page.text("#alt-today-sheet [data-alt-confirm]"), /USE THIS TODAY/);
  assert.match(page.text("#alt-today-sheet .alt-sheet-cancel"), /CANCEL/);

  await page.confirm();

  assert.equal(page.sheetOpen(), false, "sheet closes after confirming");
  assert.equal(page.exerciseName(0), INCLINE);
  assert.equal(page.exerciseName(1), "Lat Pulldown");

  const banner = page.text("[data-alt-today='0']");
  assert.match(banner, /TODAY ONLY/);
  assert.match(banner, /Alternative for\s*Barbell Bench Press/);
  assert.match(banner, /saved workout plan is unchanged/);
  assert.match(banner, /Restore Barbell Bench Press/);

  // Exercises that were not replaced keep their normal button.
  assert.ok(page.$('[data-alt-open="1"]'));
  assert.ok(!page.$('[data-alt-today="1"]'));
});

test("the saved plan is never modified (data and code)", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);
  page.fillAll();
  await page.complete();

  assert.equal(JSON.stringify(world.plans), world.plansAtStart);
  assert.equal(world.plans.p1.exercises[0].name, "Barbell Bench Press");
  assert.equal(world.plans.p1.exercises[0].libraryExerciseId, "barbell-bench-press");

  // logWorkout.js has no way to write a plan.
  assert.doesNotMatch(
    RAW_SOURCE,
    /\b(updateWorkoutPlan|saveWorkoutPlan|createWorkoutPlan|deleteWorkoutPlan|setDoc|updateDoc)\b/
  );
});

test("the alternative is stored at SESSION level (memory + localStorage)", { skip }, async () => {
  const page = await startUpperA();

  await page.chooseAlternative(0, "incline", INCLINE);

  const live = page.api.session.exercises[0];

  assert.equal(live.exerciseId, "e1", "plan slot id is unchanged");
  assert.equal(live.name, INCLINE);
  assert.equal(live.alternativeToday.original.name, "Barbell Bench Press");
  assert.equal(live.alternativeToday.libraryExerciseId, "incline-dumbbell-press");

  const stored = page.stored();

  assert.equal(stored.exercises[0].alternativeToday.name, INCLINE);
  assert.equal(stored.exercises[0].alternativeToday.original.name, "Barbell Bench Press");
  assert.equal(stored.exercises[1].alternativeToday, undefined);
  assert.ok(!page.world.storage[KEY("userA")].includes("previousLog"));
});


// ---- reload / resume --------------------------------------------------------------

test("reload: the alternative (and typed sets) are still there", { skip }, async () => {
  const world = makeWorld();
  let page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);

  page.type(0, 0, "weight", "30");
  page.type(0, 0, "reps", "10");

  page = boot(world);
  assert.equal(page.api.session, null);

  await page.signIn("userA");

  assert.equal(page.exerciseName(0), INCLINE);
  assert.match(page.text("[data-alt-today='0']"), /Alternative for\s*Barbell Bench Press/);
  assert.equal(page.value(0, 0, "weight"), "30");
  assert.equal(page.value(0, 0, "reps"), "10");
  assert.equal(page.api.session.exercises[0].alternativeToday.original.name, "Barbell Bench Press");
  assert.equal(world.creates, 0, "reloading never creates a log");

  // The restored session can still be restored to the plan.
  page.$('[data-alt-restore="0"]').click();
  await settle(6);
  assert.equal(page.exerciseName(0), "Barbell Bench Press");
});

test("leaving and resuming the same session keeps the alternative", { skip }, async () => {
  const page = await startUpperA();

  await page.chooseAlternative(0, "incline", INCLINE);

  await page.api.openWorkoutSession("p1");   // Dashboard "Start" tapped again

  assert.equal(page.exerciseName(0), INCLINE);
  assert.ok(page.$("[data-alt-today='0']"));
});

test("sign out and back in keeps the alternative for that user only", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);

  await page.signIn("userB");
  assert.equal(page.api.session, null, "another account never sees it");

  await page.signIn("userA");
  assert.equal(page.exerciseName(0), INCLINE);
});

test("a damaged stored alternative is repaired instead of breaking the session", { skip }, async () => {
  const world = makeWorld();
  let page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);

  const stored = page.stored();
  stored.exercises[0].alternativeToday = { name: "", original: { name: "Barbell Bench Press", libraryExerciseId: "barbell-bench-press" } };
  world.storage[KEY("userA")] = JSON.stringify(stored);

  page = boot(world);
  await page.signIn("userA");

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
  assert.ok(!page.$("[data-alt-today='0']"));
  assert.equal(page.api.session.exercises[0].alternativeToday, undefined);
});


// ---- cancel / restore ---------------------------------------------------------------

test("cancelling the sheet changes nothing", { skip }, async () => {
  const page = await startUpperA();
  const before = JSON.stringify(page.api.session.exercises);

  await page.openSheet(0);
  await page.search("incline");
  await page.pick(INCLINE);

  page.$("#alt-today-sheet [data-alt-cancel]").click();
  await settle();

  assert.equal(page.sheetOpen(), false);
  assert.equal(JSON.stringify(page.api.session.exercises), before);
  assert.equal(page.exerciseName(0), "Barbell Bench Press");
  assert.equal(page.stored().exercises[0].alternativeToday, undefined);
});

test("Escape and tapping the backdrop close the sheet without changes", { skip }, async () => {
  const page = await startUpperA();

  await page.openSheet(0);
  page.window.document.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(page.sheetOpen(), false);

  await page.openSheet(0);
  page.$("#alt-today-sheet").click();
  assert.equal(page.sheetOpen(), false);

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
});

test("Restore returns to the planned exercise and the plan was untouched throughout", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);

  page.$('[data-alt-restore="0"]').click();
  await settle(6);

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
  assert.ok(!page.$("[data-alt-today='0']"));
  assert.ok(page.$('[data-alt-open="0"]'));

  const live = page.api.session.exercises[0];
  assert.equal(live.libraryExerciseId, "barbell-bench-press");
  assert.ok(!("alternativeToday" in live));
  assert.equal(page.stored().exercises[0].alternativeToday, undefined);
  assert.equal(JSON.stringify(world.plans), world.plansAtStart);

  // Completing now logs the planned exercise exactly as before.
  page.fillAll();
  await page.complete();

  const logged = world.logs[0].exercises[0];
  assert.equal(logged.exerciseId, "e1");
  assert.equal(logged.name, "Barbell Bench Press");
  assert.ok(!("alternativeToday" in logged));
});

test("restoring asks before throwing away sets typed for the alternative", { skip }, async () => {
  const page = await startUpperA();

  await page.chooseAlternative(0, "incline", INCLINE);
  page.type(0, 0, "weight", "30");

  let asked = null;
  page.window.confirm = message => { asked = message; return false; };

  page.$('[data-alt-restore="0"]').click();
  await settle(4);

  assert.match(asked, /Restore Barbell Bench Press/);
  assert.equal(page.exerciseName(0), INCLINE, "declining keeps the alternative");
  assert.equal(page.value(0, 0, "weight"), "30");

  page.window.confirm = () => true;
  page.$('[data-alt-restore="0"]').click();
  await settle(6);

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
  assert.equal(page.value(0, 0, "weight"), "");
});

test("the alternative can be changed again; Restore still goes back to the PLAN", { skip }, async () => {
  const page = await startUpperA();

  await page.chooseAlternative(0, "incline", INCLINE);
  await page.chooseAlternative(0, "shoulder press", "Dumbbell Shoulder Press");

  assert.equal(page.exerciseName(0), "Dumbbell Shoulder Press");
  assert.match(page.text("[data-alt-today='0']"), /Alternative for\s*Barbell Bench Press/);

  page.$('[data-alt-restore="0"]').click();
  await settle(6);

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
});


// ---- completing ---------------------------------------------------------------------

test("the completed log records the exercise actually performed", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);
  page.fillAll();
  await page.complete();

  assert.equal(world.creates, 1);
  assert.equal(page.api.session, null);
  assert.equal(page.world.storage[KEY("userA")], undefined, "session cleared after completing");

  const [log] = world.logs;
  const [replaced, untouched, custom] = log.exercises;

  assert.equal(replaced.name, INCLINE);
  assert.equal(replaced.libraryExerciseId, "incline-dumbbell-press");
  assert.equal(replaced.exerciseId, "alt:e1:incline-dumbbell-press");
  assert.equal(replaced.plannedExerciseId, "e1");
  assert.equal(replaced.plannedName, "Barbell Bench Press");
  assert.equal(replaced.plannedLibraryExerciseId, "barbell-bench-press");
  assert.equal(replaced.alternativeToday.original.name, "Barbell Bench Press");
  assert.equal(replaced.sets[0].weight, "50");

  // Everything else is logged as before.
  assert.equal(untouched.exerciseId, "e2");
  assert.equal(untouched.name, "Lat Pulldown");
  assert.ok(!("alternativeToday" in untouched));
  assert.equal(custom.exerciseId, "e3");
  assert.ok(!("libraryExerciseId" in custom));
});

test("a replacement never shares history with the original exercise", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world);

  assert.deepEqual(
    world.previousCalls.filter(c => c.planId === "p1").map(c => c.exerciseId).sort(),
    ["e1", "e2", "e3"]
  );

  world.previousCalls.length = 0;

  await page.chooseAlternative(0, "incline", INCLINE);

  // Only the replaced exercise was looked up again, under its OWN identity.
  assert.deepEqual(world.previousCalls, [
    { planId: "p1", exerciseId: "alt:e1:incline-dumbbell-press" }
  ]);
});

test("a NEW session from the same plan uses the original planned exercise", { skip }, async () => {
  const world = makeWorld();
  let page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);
  page.fillAll();
  await page.complete();

  page = boot(world);
  await page.signIn("userA");
  await page.api.openWorkoutSession("p1");

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
  assert.ok(!page.$("[data-alt-today='0']"));
  assert.equal(page.api.session.exercises[0].libraryExerciseId, "barbell-bench-press");
  assert.ok(!("alternativeToday" in page.api.session.exercises[0]));
  assert.equal(JSON.stringify(world.plans), world.plansAtStart);
});

test("closing (discarding) the workout leaves no alternative behind", { skip }, async () => {
  const world = makeWorld();
  let page = await startUpperA(world);

  await page.chooseAlternative(0, "incline", INCLINE);

  page.$("#close-workout-session").click();
  await settle();

  assert.equal(world.storage[KEY("userA")], undefined);

  await page.api.openWorkoutSession("p1");
  assert.equal(page.exerciseName(0), "Barbell Bench Press");
});

test("closing the workout also closes an open sheet", { skip }, async () => {
  const page = await startUpperA();

  await page.openSheet(0);
  assert.equal(page.sheetOpen(), true);

  page.api.closeWorkoutSession();

  assert.equal(page.sheetOpen(), false);
});


// ---- no alternative ---------------------------------------------------------------------

test("without an alternative, logging is unchanged", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world);

  assert.equal(page.api.session.exercises.some(e => "alternativeToday" in e), false);

  page.fillAll();
  await page.complete();

  const [log] = world.logs;

  assert.deepEqual(log.exercises.map(e => e.exerciseId), ["e1", "e2", "e3"]);
  assert.deepEqual(
    log.exercises.map(e => e.name),
    ["Barbell Bench Press", "Lat Pulldown", "Cable Lateral Raise"]
  );

  for (const exercise of log.exercises) {
    for (const key of ["alternativeToday", "plannedExerciseId", "plannedName", "plannedLibraryExerciseId"]) {
      assert.ok(!(key in exercise), `${key} must not exist`);
    }
  }

  assert.equal(world.alerts.at(-1), "Workout completed and saved.");
});

test("opening the sheet and picking nothing writes nothing", { skip }, async () => {
  const page = await startUpperA();
  const before = page.world.storage[KEY("userA")];

  await page.openSheet(0);
  await page.search("incline");

  assert.equal(page.confirmDisabled(), true);
  assert.equal(page.world.storage[KEY("userA")], before);
});


// ---- invalid replacements ------------------------------------------------------------------

test("an exercise already in today's workout cannot be chosen (no duplicates)", { skip }, async () => {
  const page = await startUpperA();

  await page.openSheet(0);
  await page.search("lat pulldown");
  await page.pick("Lat Pulldown");

  assert.match(page.error(), /already in today's workout/);
  assert.equal(page.confirmDisabled(), true);

  await page.confirm();   // disabled button: nothing happens

  assert.equal(page.exerciseName(0), "Barbell Bench Press");
  assert.equal(page.api.session.exercises.filter(e => e.name === "Lat Pulldown").length, 1);
});

test("the planned exercise itself is not a valid alternative", { skip }, async () => {
  const page = await startUpperA();

  await page.openSheet(0);
  await page.search("bench press");
  await page.pick("Barbell Bench Press");

  assert.match(page.error(), /already the planned exercise/);
  assert.equal(page.confirmDisabled(), true);
});

test("only library exercises are offered: there is no custom row", { skip }, async () => {
  const page = await startUpperA();

  await page.openSheet(0);
  await page.search("my invented lift");

  assert.equal(page.options().length, 0);
  assert.match(page.text("#alt-today-sheet [data-alt-hint]"), /No library exercise matches/);
  assert.equal(page.confirmDisabled(), true);

  await page.search("incline");
  assert.ok(page.options().length > 0);
  assert.ok(page.options().every(o => o.dataset.optionType === "library"));
});

test("typing again discards an earlier choice", { skip }, async () => {
  const page = await startUpperA();

  await page.openSheet(0);
  await page.search("incline");
  await page.pick(INCLINE);
  assert.equal(page.confirmDisabled(), false);

  await page.search("incl");
  assert.equal(page.confirmDisabled(), true);
  assert.equal(page.text("#alt-today-sheet [data-alt-summary]"), "");
});

test("an exercise the library no longer knows fails safely: session and plan untouched", { skip }, async () => {
  const world = makeWorld();

  // Search can find it, but by the time it is confirmed the library cannot resolve it.
  const flaky = {
    searchExercises: world.library.searchExercises,
    getExercise: async () => null
  };

  const page = await startUpperA(world, { library: flaky });
  const before = JSON.stringify(page.api.session.exercises);

  await page.openSheet(0);
  await page.search("incline");
  await page.pick(INCLINE);
  await page.confirm();

  assert.match(page.error(), /could not be loaded/);
  assert.equal(page.sheetOpen(), true, "sheet stays open so the user can pick another");
  assert.equal(JSON.stringify(page.api.session.exercises), before);
  assert.equal(page.stored().exercises[0].alternativeToday, undefined);
  assert.equal(JSON.stringify(world.plans), world.plansAtStart);
});

test("a library that throws on confirm also fails safely", { skip }, async () => {
  const world = makeWorld();

  const broken = {
    searchExercises: world.library.searchExercises,
    getExercise: async () => { throw new Error("offline"); }
  };

  const page = await startUpperA(world, { library: broken });
  const before = JSON.stringify(page.api.session.exercises);

  const errors = console.error;
  console.error = () => {};

  try {
    await page.openSheet(0);
    await page.search("incline");
    await page.pick(INCLINE);
    await page.confirm();
  } finally {
    console.error = errors;
  }

  assert.match(page.error(), /Nothing was changed/);
  assert.equal(JSON.stringify(page.api.session.exercises), before);
});

test("if the picker module cannot load, the sheet says so and nothing changes", { skip }, async () => {
  const world = makeWorld();
  const page = await startUpperA(world, { pickerFails: true });
  const before = JSON.stringify(page.api.session.exercises);

  const errors = console.error;
  console.error = () => {};

  try {
    await page.openSheet(0);
  } finally {
    console.error = errors;
  }

  assert.equal(page.$("#alt-today-sheet .exercise-picker-note").hidden, false);
  assert.equal(page.$("#alt-today-sheet .exercise-name-input").disabled, true);

  page.$("#alt-today-sheet [data-alt-cancel]").click();

  assert.equal(JSON.stringify(page.api.session.exercises), before);
  assert.equal(JSON.stringify(world.plans), world.plansAtStart);
});

test("a library that cannot search leaves the workout usable", { skip }, async () => {
  const world = makeWorld();

  const offline = {
    searchExercises: async () => { throw new Error("offline"); },
    getExercise: async () => null
  };

  const page = await startUpperA(world, { library: offline });

  await page.openSheet(0);
  await page.search("incline");

  assert.equal(page.$("#alt-today-sheet .exercise-picker-note").hidden, false);

  page.$("#alt-today-sheet [data-alt-cancel]").click();

  page.fillAll();
  await page.complete();

  assert.equal(world.creates, 1);
  assert.equal(world.logs[0].exercises[0].exerciseId, "e1");
});

test("typed sets are cleared when the exercise is replaced, with a warning first", { skip }, async () => {
  const page = await startUpperA();

  page.type(0, 0, "weight", "80");
  page.type(0, 0, "reps", "8");

  await page.openSheet(0);
  await page.search("incline");
  await page.pick(INCLINE);

  assert.match(page.text("#alt-today-sheet [data-alt-summary]"), /will be cleared/);

  await page.confirm();

  assert.equal(page.value(0, 0, "weight"), "");
  assert.equal(page.value(0, 0, "reps"), "");
  assert.equal(page.api.session.exercises[0].sets.length, 3);
});

test("the sheet markup fits a phone: single column, scrolls inside itself", { skip }, async () => {
  const css = readFileSync(resolve(here, "..", "style.css"), "utf8");

  const sheetCss = css.slice(css.indexOf("Alternative Today (Exercise Library Step 4)"));

  assert.match(sheetCss, /\.alt-sheet\s*\{[^}]*max-height:\s*100%/);
  assert.match(sheetCss, /\.alt-sheet\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(sheetCss, /\.alt-sheet\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(sheetCss, /\.alt-sheet\s*\{[^}]*max-width:\s*480px/);
  assert.match(sheetCss, /\.alt-sheet-backdrop\s*\{[^}]*position:\s*fixed/);
  assert.match(sheetCss, /env\(safe-area-inset-top\)/);

  // No hard-coded theme colours: only tokens (plus the neutral backdrop dim).
  assert.doesNotMatch(sheetCss, /#[0-9a-fA-F]{3,8}\b(?![^{]*\{)/);
});
