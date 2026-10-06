// ============================================================================
// WORKOUT = execute today's workout
// SETTINGS -> EDIT WORKOUTS = permanently manage workout plans
//
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(root, file), "utf8");

const todayNumber = () => (new Date().getDay() === 0 ? 7 : new Date().getDay());

const PLANS = () => [
  {
    id: "p-today", name: "Upper A", focus: "Chest / Back / Shoulders",
    dayOfWeek: todayNumber(),
    exercises: [
      { id: "e1", name: "Barbell Bench Press", sets: 4, repMin: 6, repMax: 8 },
      { id: "e2", name: "Lat Pulldown", sets: 3, repMin: 10, repMax: 12 }
    ]
  },
  {
    id: "p-other", name: "Lower A", focus: "Legs",
    dayOfWeek: (todayNumber() % 7) + 1,
    exercises: [{ id: "e9", name: "Back Squat", sets: 3, repMin: 5, repMax: 8 }]
  }
];

async function bootWorkout(plans = PLANS()) {
  const { window } = new JSDOM(`<div id="workout-content"></div>`, { url: "http://localhost/" });

  const started = [];
  const alerts = [];
  let loads = 0;

  window.alert = m => alerts.push(m);
  window.RecompositionWorkoutLogger = {
    openWorkoutSession: async id => { started.push(id); }
  };

  const stubs = {
    getWorkoutPlans: async () => { loads += 1; return plans; },
    onAuthStateChanged: () => {},
    auth: {}
  };

  const code =
    read("workout.js").replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "");

  new Function("document", "window", ...Object.keys(stubs), code)(
    window.document, window, ...Object.values(stubs)
  );

  await window.RecompositionWorkout.render();
  await settle();

  return { window, $: s => window.document.querySelector(s), $$: s => [...window.document.querySelectorAll(s)], started, alerts, loads: () => loads, plans };
}


// ---- Workout is execution-only ---------------------------------------------------

test("Workout shows today's workout with START WORKOUT", { skip }, async () => {
  const page = await bootWorkout();

  const card = page.$(".workout-today-card");

  assert.ok(card);
  assert.match(card.textContent, /TODAY/);
  assert.match(card.textContent, /Upper A/);
  assert.match(card.textContent, /2 exercises/);
  assert.match(card.textContent, /Chest \/ Back \/ Shoulders/);
  assert.match(card.querySelector("button").textContent, /START WORKOUT/);
});

test("Workout exposes NO permanent plan editing", { skip }, async () => {
  const page = await bootWorkout();

  for (const selector of [
    "[data-edit-plan]", "[data-delete-plan]", "[data-create-day]",
    "#btn-create-workout-plan", "#workout-plan-form-container",
    "[data-exercise-card]", "[data-delete-exercise]", "[data-move-up]",
    "[data-move-down]", "#btn-add-exercise", "#btn-save-workout-plan",
    ".day-add-button", "input", "select", "textarea"
  ]) {
    assert.equal(page.$$(selector).length, 0, `${selector} must not exist on Workout`);
  }

  const text = page.$("#workout-content").textContent;

  assert.doesNotMatch(text, /CREATE WORKOUT|\+ Add workout|Delete|\bEdit\b/);
});

test("exercises are not listed before the workout is started", { skip }, async () => {
  const page = await bootWorkout();

  const text = page.$("#workout-content").textContent;

  assert.doesNotMatch(text, /Barbell Bench Press|Lat Pulldown|Back Squat/);
});

test("START WORKOUT hands today's plan to the session logger", { skip }, async () => {
  const page = await bootWorkout();

  page.$(".workout-today-card [data-start-plan]").click();
  await settle();

  assert.deepEqual(page.started, ["p-today"]);
});

test("the weekly schedule is read-only but can still start any workout", { skip }, async () => {
  const page = await bootWorkout();

  assert.equal(page.$$(".workout-day-card").length, 7);

  const other = page.$$(".workout-day-card [data-start-plan]")
    .find(button => button.dataset.startPlan === "p-other");

  other.click();
  await settle();

  assert.deepEqual(page.started, ["p-other"]);
});

test("a rest day and an empty account point to Settings -> Edit Workouts", { skip }, async () => {
  const rest = await bootWorkout([PLANS()[1]]);

  assert.match(rest.$(".workout-today-card--rest").textContent, /Rest day/);
  assert.equal(rest.$$(".workout-today-card [data-start-plan]").length, 0);

  const empty = await bootWorkout([]);

  assert.match(empty.$(".workout-today-card--rest").textContent, /Settings → Edit Workouts/);
});

test("Workout refreshes after a plan is changed in Settings", { skip }, async () => {
  const plans = PLANS();
  const page = await bootWorkout(plans);

  const before = page.loads();

  plans[0].name = "Upper A (edited)";
  page.window.dispatchEvent(new page.window.Event("recomposition-plans-updated"));
  await settle();

  assert.equal(page.loads(), before + 1);
  assert.match(page.$(".workout-today-card").textContent, /Upper A \(edited\)/);
});

test("Workout failing to load shows an error and no editing controls", { skip }, async () => {
  const { window } = new JSDOM(`<div id="workout-content"></div>`, { url: "http://localhost/" });

  const code = read("workout.js").replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "");

  const stubs = { getWorkoutPlans: async () => { throw new Error("offline"); }, onAuthStateChanged: () => {}, auth: {} };

  new Function("document", "window", ...Object.keys(stubs), code)(window.document, window, ...Object.values(stubs));

  const errors = console.error;
  console.error = () => {};
  await window.RecompositionWorkout.render();
  console.error = errors;

  assert.match(window.document.body.textContent, /Workout unavailable/);
  assert.equal(window.document.querySelectorAll("button").length, 0);
});


// ---- Plan editing exists only in Settings ------------------------------------------

test("only Settings' editor (and the data layer) can write workout plans", () => {
  const writers = ["createWorkoutPlan", "updateWorkoutPlan", "deleteWorkoutPlan"];

  const offenders = [];

  for (const file of readdirSync(root).filter(f => f.endsWith(".js"))) {
    const source = read(file);

    if (writers.some(name => new RegExp(`\\b${name}\\b`).test(source))) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, ["workoutPlanEditor.js"]);

  // The session logger and Workout can neither import nor reach the editor.
  assert.doesNotMatch(read("workout.js"), /workoutPlanEditor|RecompositionWorkoutEditor/);
  assert.doesNotMatch(read("logWorkout.js"), /workoutPlanEditor|RecompositionWorkoutEditor/);
});

test("Settings has an Edit Workouts entry that mounts the plan editor", () => {
  const settings = read("settings.js");

  assert.match(settings, /id="settings-workouts"/);
  assert.match(settings, /Edit Workouts/);
  assert.match(settings, /settings-workouts-page/);
  assert.match(settings, /RecompositionWorkoutEditor\??\.render/);

  const html = read("index.html");

  assert.match(html, /src="workoutPlanEditor\.js"/);
  assert.ok(html.indexOf("workoutPlanEditor.js") < html.indexOf('src="settings.js"'));
});

test("the plan editor keeps every permanent-editing control", () => {
  const editor = read("workoutPlanEditor.js");

  for (const control of [
    "btn-create-workout-plan", "data-edit-plan", "data-delete-plan",
    "btn-add-exercise", "data-delete-exercise", "data-move-up", "data-move-down",
    "btn-save-workout-plan", "workout-plan-name", "workout-plan-rest"
  ]) {
    assert.ok(editor.includes(control), control);
  }

  // Editing is not reachable from the Workout tab: no "Log Workout" mixing either.
  assert.doesNotMatch(editor, /data-log-plan|openWorkoutSession/);
});

test("saving or deleting a plan announces the change to Workout", () => {
  const editor = read("workoutPlanEditor.js");

  assert.equal((editor.match(/announcePlansChanged\(\);/g) ?? []).length, 2);
  assert.match(editor, /recomposition-plans-updated/);
});

test("Workout and session CSS: no overflow-prone fixed widths in the new blocks", () => {
  const css = read("style.css");
  const block = css.slice(css.indexOf("Workout = execution only"));

  assert.match(block, /\.workout-start-button\s*\{[^}]*width:\s*100%/);
  assert.match(block, /#section-workout\.workout-session-active \.workout-today\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(block, /\bwidth:\s*\d{3,}px/);
});
