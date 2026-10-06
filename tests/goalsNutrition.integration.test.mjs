// ============================================================================
// Integration tests: Goals screen + Nutrition Engine (recommendation -> review
// -> APPLY), and Dashboard compatibility. Runs the REAL goals.js / dashboard.js
// in jsdom with the data layer stubbed (saveGoal merges like Firestore does).
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as units from "../units.js";
import * as engine from "../nutritionEngine.js";
import * as currentWeight from "../currentWeight.js";
import * as activeGoal from "../activeGoal.js";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(resolve(here, "..", file), "utf8");

const PROFILE = {
  name: "Lin", age: 30, sex: "Male", height: 175, currentWeight: 80,
  activityLevel: "Moderately active", unitPreference: "kg", trainingExperience: "", gymStartDate: ""
};

const WEIGHTS = [{ weight: 80, date: "2026-09-30" }, { weight: 79, date: "2026-09-23" }];

// weight 80 kg, male, 30, 175 cm, moderately active -> (calories, protein, carbs, fat)
const EXPECT = {
  "Maintenance": [2710, 145, 385, 65],
  "Lean Bulk": [2850, 145, 420, 65],
  "Bulk": [2980, 145, 455, 65],
  "Cut": [2300, 160, 270, 65],
  "Fat Loss": [2170, 160, 235, 65]
};

function loadSource(file, stubs) {
  const source = read(file)
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
    .replace(/\bexport\s+(async\s+)?function/g, "$1function");

  return { source, names: Object.keys(stubs) };
}

async function bootGoals({ goals = [], profile = PROFILE, weights = WEIGHTS, profileFails = false, confirmAnswer = true } = {}) {
  const store = goals.map(goal => ({ ...goal }));
  const calls = { saveGoal: [], alert: [], confirm: [], navigate: [] };

  const live = { profile, weights, profileFails };

  const dom = new JSDOM(`<div id="settings-goals-content"></div><button id="settings-profile"></button>`, { url: "http://localhost/" });
  const { window } = dom;
  const { document } = window;

  window.alert = message => calls.alert.push(message);
  window.confirm = message => { calls.confirm.push(message); return confirmAnswer; };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  window.RecompositionNavigation = { showSection: id => calls.navigate.push(id) };

  const profileClicks = [];
  document.getElementById("settings-profile").addEventListener("click", () => profileClicks.push("profile"));

  const stubs = {
    getGoals: async () => store.map(goal => ({ ...goal })),
    saveGoal: async (id, data) => {
      calls.saveGoal.push({ id, data: structuredClone(data) });
      const existing = store.find(goal => goal.id === id);
      if (existing) Object.assign(existing, data); else store.push({ id, ...data });
    },
    deleteGoal: async id => { store.splice(store.findIndex(g => g.id === id), 1); },
    getProfile: async () => { if (live.profileFails) throw new Error("offline"); return live.profile; },
    getWeightHistory: async () => live.weights,
    ...Object.fromEntries(Object.keys(engine).map(k => [k, engine[k]])),
    ...Object.fromEntries(Object.keys(units).map(k => [k, units[k]])),
    ...Object.fromEntries(Object.keys(currentWeight).map(k => [k, currentWeight[k]])),
    ...activeGoal
  };

  const { source } = loadSource("goals.js", stubs);

  const api = new Function("document", "window", "alert", "confirm", "crypto", ...Object.keys(stubs), source + "\n;return { loadGoals };")(
    document, window, window.alert, window.confirm, globalThis.crypto, ...Object.values(stubs)
  );

  const container = document.getElementById("settings-goals-content");

  await api.loadGoals(container);
  await settle();

  const text = el => el?.textContent.replace(/\s+/g, " ").trim();

  const t = {
    window, document, calls, store, live, profileClicks,
    panel: () => document.getElementById("goal-nutrition-panel"),
    panelText: () => text(document.getElementById("goal-nutrition-panel")),
    cardsText: () => text(document.getElementById("goals-list")),
    applyButton: () => document.getElementById("btn-apply-nutrition"),
    field: id => document.getElementById(id),

    async openNew() { document.getElementById("btn-new-goal").click(); await settle(4); },
    async openEdit(id) { document.querySelector(`.btn-edit-goal[data-id="${id}"]`).click(); await settle(4); },
    async chooseType(type) {
      const select = document.getElementById("goal-type");
      select.value = type;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      await settle(2);
    },
    setValue(id, value) { document.getElementById(id).value = value; },
    async apply() { t.applyButton().click(); await settle(6); },
    async save() { document.getElementById("btn-save-goal").click(); await settle(6); },
    cancel() { document.getElementById("btn-cancel-goal").click(); }
  };

  return t;
}

const goalDoc = (over = {}) => ({
  id: "g1", goalType: "Cut", calories: 2500, protein: 150, carbs: 300, fat: 70,
  startDate: "2026-09-01", endDate: "", ...over
});


// ----------------------------------------------------------------------------
// RECOMMENDATION IS SHOWN, NOT APPLIED
// ----------------------------------------------------------------------------

test("new goal: the recommendation is shown for review; the form and database are untouched", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();

  const panel = t.panelText();

  assert.match(panel, /NUTRITION RECOMMENDATION/);
  assert.match(panel, /NOT ACTIVE UNTIL APPLIED/);
  assert.match(panel, /ACTIVE RECOMMENDED/);
  assert.match(panel, /Calories — 2710 kcal/);
  assert.match(panel, /Protein — 145 g/);
  assert.match(panel, /Carbs — 385 g/);
  assert.match(panel, /Fat — 65 g/);
  assert.match(panel, /BMR 1749 kcal · TDEE 2711 kcal/);
  assert.match(panel, /Based on 80 kg \(latest weigh-in 2026-09-30\)/);

  for (const id of ["goal-calories", "goal-protein", "goal-carbs", "goal-fat"]) {
    assert.equal(t.field(id).value, "", `${id} must NOT be auto-filled`);
  }

  assert.equal(t.calls.saveGoal.length, 0, "nothing saved");
  assert.ok(t.applyButton(), "an explicit Apply button is offered");
});

test("changing the goal type recalculates the recommendation (still nothing saved)", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();

  for (const [type, [calories, protein, carbs, fat]] of Object.entries(EXPECT)) {
    await t.chooseType(type);

    const panel = t.panelText();

    assert.match(panel, new RegExp(`Calories — ${calories} kcal`), type);
    assert.match(panel, new RegExp(`Protein — ${protein} g`), type);
    assert.match(panel, new RegExp(`Carbs — ${carbs} g`), type);
    assert.match(panel, new RegExp(`Fat — ${fat} g`), type);
  }

  assert.equal(t.calls.saveGoal.length, 0);
});

test("the recommendation never auto-fills or changes the manual number fields", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  t.setValue("goal-calories", "2222");
  await t.chooseType("Bulk");

  assert.equal(t.field("goal-calories").value, "2222");
  assert.equal(t.calls.saveGoal.length, 0);
});


// ----------------------------------------------------------------------------
// APPLY
// ----------------------------------------------------------------------------

test("APPLY on a new goal: saves recommended numbers + metadata, then shows them as the active target", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  await t.chooseType("Lean Bulk");
  t.setValue("goal-start", "2026-10-02");

  await t.apply();

  assert.equal(t.calls.saveGoal.length, 1);

  const { id, data } = t.calls.saveGoal[0];

  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(data.goalType, "Lean Bulk");
  assert.equal(data.startDate, "2026-10-02");
  assert.deepEqual([data.calories, data.protein, data.carbs, data.fat], [2850, 145, 420, 65]);
  assert.equal(data.nutritionSource, "recommended");
  assert.equal(data.calculatedFromWeightKg, 80);
  assert.equal(data.calculatedFromGoal, "lean-bulk");
  assert.equal(data.nutritionFormulaVersion, "nutrition-v1");
  assert.match(data.nutritionAppliedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Object.values(data).every(v => v !== undefined), "no undefined values");

  const cards = t.cardsText();

  assert.match(cards, /Lean Bulk/);
  assert.match(cards, /Calories 2850 kcal/);
  assert.match(cards, /Recommended targets · applied/);
  assert.match(cards, /based on 80 kg/);
  assert.equal(t.document.getElementById("goal-nutrition-panel"), null, "form closed after applying");
});

test("APPLY needs a goal type and start date (nothing saved without them)", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  await t.apply();

  assert.equal(t.calls.saveGoal.length, 0);
  assert.match(t.calls.alert.at(-1), /start date are required/);
});

test("APPLY over existing numbers asks for confirmation; 'No' changes nothing", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc()], confirmAnswer: false });

  await t.openEdit("g1");

  assert.match(t.panelText(), /Calories 2500 kcal 2300 kcal/, "ACTIVE (saved) beside RECOMMENDED");

  await t.apply();

  assert.equal(t.calls.confirm.length, 1);
  assert.match(t.calls.confirm[0], /Replace your active targets/);
  assert.match(t.calls.confirm[0], /Now: 2500 kcal/);
  assert.match(t.calls.confirm[0], /New: 2300 kcal/);
  assert.equal(t.calls.saveGoal.length, 0, "declined: nothing saved");
  assert.deepEqual([t.store[0].calories, t.store[0].protein, t.store[0].carbs, t.store[0].fat], [2500, 150, 300, 70]);
});

test("APPLY over existing numbers with 'Yes' updates the goal (and only then)", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc()], confirmAnswer: true });

  await t.openEdit("g1");

  assert.equal(t.calls.saveGoal.length, 0, "opening the editor changed nothing");

  await t.apply();

  assert.equal(t.calls.saveGoal.length, 1);
  assert.equal(t.calls.saveGoal[0].id, "g1", "the existing goal is updated, not duplicated");
  assert.deepEqual(
    [t.store[0].calories, t.store[0].protein, t.store[0].carbs, t.store[0].fat],
    [2300, 160, 270, 65]
  );
  assert.equal(t.store[0].nutritionSource, "recommended");
  assert.equal(t.store.length, 1);
});

test("the ACTIVE column always shows the SAVED goal, not what is typed in the form", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc()] });

  await t.openEdit("g1");

  t.setValue("goal-calories", "9999");
  t.setValue("goal-protein", "1");
  await t.chooseType("Bulk");                 // re-renders the panel

  assert.match(t.panelText(), /Calories 2500 kcal 2980 kcal/, "saved 2500, not the typed 9999");
  assert.match(t.panelText(), /Protein 150 g 145 g/, "saved 150, not the typed 1");
  assert.equal(t.calls.saveGoal.length, 0);
});

test("an already-matching active target says so and offers no Apply button", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc({ goalType: "Cut", calories: 2300, protein: 160, carbs: 270, fat: 65 })] });

  await t.openEdit("g1");

  assert.match(t.panelText(), /already matches this recommendation/);
  assert.equal(t.applyButton(), null);
});

test("existing goals are preserved: an unchanged legacy goal saves with no new metadata", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc()] });

  await t.openEdit("g1");
  await t.save();

  assert.equal(t.calls.saveGoal.length, 1);

  const { data } = t.calls.saveGoal[0];

  assert.deepEqual([data.calories, data.protein, data.carbs, data.fat], [2500, 150, 300, 70]);
  assert.equal("nutritionSource" in data, false, "legacy goal is saved exactly as before");
  assert.equal("calculatedFromWeightKg" in data, false);
});

test("hand-editing a number marks the goal manual; editing a recommended goal reverts it to manual", { skip }, async () => {
  const legacy = await bootGoals({ goals: [goalDoc()] });
  await legacy.openEdit("g1");
  legacy.setValue("goal-calories", "2600");
  await legacy.save();
  assert.equal(legacy.calls.saveGoal[0].data.nutritionSource, "manual");

  const applied = await bootGoals({
    goals: [goalDoc({ goalType: "Cut", calories: 2300, protein: 160, carbs: 270, fat: 65, nutritionSource: "recommended", nutritionAppliedAt: "2026-10-01T10:00:00.000Z", calculatedFromWeightKg: 80, calculatedFromGoal: "cut", nutritionFormulaVersion: "nutrition-v1" })]
  });
  await applied.openEdit("g1");

  await applied.save();
  assert.equal("nutritionSource" in applied.calls.saveGoal[0].data, false, "unchanged recommended goal keeps its metadata");

  await applied.openEdit("g1");
  applied.setValue("goal-protein", "170");
  await applied.save();

  const data = applied.calls.saveGoal[1].data;

  assert.equal(data.nutritionSource, "manual");
  assert.equal(data.calculatedFromWeightKg, null);
  assert.equal(data.nutritionAppliedAt, null);
});

test("a brand-new goal saved by hand is recorded as manual", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  t.setValue("goal-start", "2026-10-02");
  t.setValue("goal-calories", "2400");
  await t.save();

  assert.equal(t.calls.saveGoal[0].data.nutritionSource, "manual");
  assert.equal(t.calls.saveGoal[0].data.calories, 2400);
  assert.match(t.cardsText(), /Manual targets/);
});


// ----------------------------------------------------------------------------
// CUSTOM
// ----------------------------------------------------------------------------

test("Custom stays fully manual: no recommendation, no Apply, values saved as typed", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  await t.chooseType("Custom");

  assert.match(t.panelText(), /Custom goals use the numbers you enter above/);
  assert.equal(t.applyButton(), null);
  assert.ok(!/ACTIVE RECOMMENDED/.test(t.panelText()), "no comparison table");

  t.setValue("goal-start", "2026-10-02");
  t.setValue("goal-calories", "3100");
  t.setValue("goal-protein", "200");
  t.setValue("goal-carbs", "350");
  t.setValue("goal-fat", "90");
  await t.save();

  const { data } = t.calls.saveGoal[0];

  assert.equal(data.goalType, "Custom");
  assert.deepEqual([data.calories, data.protein, data.carbs, data.fat], [3100, 200, 350, 90]);
  assert.equal(data.nutritionSource, "manual");
});

test("an existing Custom goal is never overwritten by opening, switching away or cancelling", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc({ goalType: "Custom", calories: 3100, protein: 200, carbs: 350, fat: 90 })] });

  await t.openEdit("g1");
  await t.chooseType("Cut");
  await t.chooseType("Custom");
  t.cancel();

  assert.equal(t.calls.saveGoal.length, 0);
  assert.deepEqual([t.store[0].calories, t.store[0].protein, t.store[0].carbs, t.store[0].fat], [3100, 200, 350, 90]);
});


// ----------------------------------------------------------------------------
// MISSING / INVALID PROFILE DATA
// ----------------------------------------------------------------------------

test("sex = Other / Prefer not to say: clear message, no numbers, no Apply, link to Profile", { skip }, async () => {
  for (const sex of ["Other", "Prefer not to say"]) {
    const t = await bootGoals({ profile: { ...PROFILE, sex } });

    await t.openNew();

    assert.match(t.panelText(), /needs a few details in your profile first/);
    assert.match(t.panelText(), /Male or Female/);
    assert.match(t.panelText(), /Custom goal/);
    assert.equal(t.applyButton(), null);
    assert.ok(!/kcal/.test(t.panelText().replace(/BMR|TDEE/g, "")), "no calorie numbers");

    t.document.getElementById("btn-open-profile").click();

    assert.deepEqual(t.calls.navigate, ["settings"]);
    assert.deepEqual(t.profileClicks, ["profile"]);
    assert.equal(t.calls.saveGoal.length, 0);
  }
});

test("an empty profile lists everything that is missing", { skip }, async () => {
  const t = await bootGoals({ profile: { name: "New" }, weights: [] });

  await t.openNew();

  const panel = t.panelText();

  for (const needle of [/Sex is required/, /Activity level is required/, /Age is required/, /Height is required/, /Current weight is required/]) {
    assert.match(panel, needle);
  }

  assert.equal(t.applyButton(), null);
});

test("under 18: explained, with a pointer to Custom goals", { skip }, async () => {
  const t = await bootGoals({ profile: { ...PROFILE, age: 16 } });

  await t.openNew();

  assert.match(t.panelText(), /adults \(18\+\)/);
  assert.equal(t.applyButton(), null);
});

test("impossible profile values are rejected with a clear message", { skip }, async () => {
  const t = await bootGoals({ profile: { ...PROFILE, height: 50 } });

  await t.openNew();

  assert.match(t.panelText(), /Height must be between 100 and 250 cm/);
});

test("profile load failure: the panel says so, manual entry still works", { skip }, async () => {
  const t = await bootGoals({ profileFails: true });

  await t.openNew();

  assert.match(t.panelText(), /profile could not be loaded/);
  assert.equal(t.applyButton(), null);

  t.setValue("goal-start", "2026-10-02");
  t.setValue("goal-calories", "2600");
  await t.save();

  assert.equal(t.calls.saveGoal.length, 1);
  assert.equal(t.calls.saveGoal[0].data.calories, 2600);
});


// ----------------------------------------------------------------------------
// WEIGHT
// ----------------------------------------------------------------------------

test("weight changes produce a new recommendation but never touch the active goal", { skip }, async () => {
  const goal = goalDoc({ goalType: "Lean Bulk", calories: 2850, protein: 145, carbs: 420, fat: 65 });
  const t = await bootGoals({ goals: [goal], weights: [{ weight: 80, date: "2026-09-30" }] });

  await t.openEdit("g1");
  assert.match(t.panelText(), /already matches this recommendation/);
  t.cancel();

  // independently calculated: Lean Bulk, male 30y 175cm, moderately active
  for (const [kg, calories] of [[82, 2880], [84, 2910], [90, 3010]]) {
    t.live.weights = [{ weight: kg, date: "2026-10-02" }, { weight: 80, date: "2026-09-30" }];

    await t.openEdit("g1");

    const panel = t.panelText();

    assert.match(panel, new RegExp(`Based on ${kg} kg`), `${kg} kg`);
    assert.match(panel, new RegExp(`Calories 2850 kcal ${calories} kcal`), "ACTIVE still 2850; RECOMMENDED moved with the weight");
    assert.ok(t.applyButton(), "available to apply, but not applied");

    t.cancel();
  }

  assert.equal(t.calls.saveGoal.length, 0, "no weigh-in ever changed a goal");
  assert.equal(t.store[0].calories, 2850);
});

test("the recommendation follows the current weight (70 -> 71 -> 72)", { skip }, async () => {
  const t = await bootGoals();
  const seen = [];

  for (const kg of [70, 71, 72]) {
    t.live.weights = [{ weight: kg, date: "2026-10-02" }];

    await t.openNew();
    await t.chooseType("Lean Bulk");

    seen.push(t.panelText().match(/Calories — (\d+) kcal/)[1]);

    t.cancel();
  }

  assert.deepEqual(seen, ["2680", "2700", "2720"]);
  assert.equal(t.calls.saveGoal.length, 0);
});

test("the profile weight is the fallback when there is no weight history", { skip }, async () => {
  const t = await bootGoals({ weights: [] });

  await t.openNew();

  assert.match(t.panelText(), /Based on 80 kg \(from your profile\)/);
  assert.match(t.panelText(), /Calories — 2710 kcal/);
});

test("pounds: weight is shown in lb, the calculation uses the stored kg (same numbers)", { skip }, async () => {
  const kg = await bootGoals();
  await kg.openNew();

  const lb = await bootGoals({ profile: { ...PROFILE, unitPreference: "lb" } });
  await lb.openNew();

  assert.match(lb.panelText(), /Based on 176\.4 lb \(latest weigh-in 2026-09-30\)/);

  for (const field of ["Calories — 2710 kcal", "Protein — 145 g", "Carbs — 385 g", "Fat — 65 g"]) {
    assert.ok(kg.panelText().includes(field) && lb.panelText().includes(field), field);
  }

  await lb.chooseType("Lean Bulk");
  t_applyStartDate(lb);
  await lb.apply();

  assert.equal(lb.calls.saveGoal[0].data.calculatedFromWeightKg, 80, "stored in kg, never in pounds");
  assert.match(lb.cardsText(), /based on 176\.4 lb/);
});

function t_applyStartDate(t) { t.setValue("goal-start", "2026-10-02"); }


// ----------------------------------------------------------------------------
// OTHER GOALS FEATURES STILL WORK
// ----------------------------------------------------------------------------

test("edit form still pre-fills, cancel closes it, delete still works", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc(), goalDoc({ id: "g2", goalType: "Bulk" })] });

  await t.openEdit("g1");

  assert.equal(t.field("goal-type").value, "Cut");
  assert.equal(t.field("goal-calories").value, "2500");
  assert.equal(t.field("goal-start").value, "2026-09-01");

  t.cancel();

  assert.equal(t.panel(), null);

  t.document.querySelector('.btn-delete-goal[data-id="g2"]').click();
  await settle(5);

  assert.equal(t.store.length, 1);
  assert.equal(t.calls.saveGoal.length, 0);
});

test("goal cards show nutrition numbers exactly as before for legacy goals (no source line)", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc()] });

  const text = t.cardsText();

  assert.match(text, /Calories 2500 kcal/);
  assert.ok(!/Recommended targets|Manual targets/.test(text));
});


// ----------------------------------------------------------------------------
// DASHBOARD COMPATIBILITY
// ----------------------------------------------------------------------------

async function openDashboard(goals) {
  const calls = {};

  const stubs = {
    auth: { currentUser: { uid: "u1" } },
    onAuthStateChanged: () => {},
    getProfile: async () => PROFILE,
    getWorkoutPlans: async () => [],
    getWorkoutLogs: async () => [],
    getWeightHistory: async () => WEIGHTS,
    getGoals: async () => goals,
    ...Object.fromEntries(Object.keys(units).map(k => [k, units[k]])),
    ...Object.fromEntries(Object.keys(currentWeight).map(k => [k, currentWeight[k]]))
  };

  const names = [...read("dashboard.js").matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)].flatMap(m => m[1].split(",").map(x => x.trim()).filter(Boolean));

  for (const name of names) if (!(name in stubs)) stubs[name] = async (...a) => { (calls[name] ??= []).push(a); };

  const dom = new JSDOM(`<div id="dashboard-content"></div>`, { url: "http://localhost/" });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = function () {};

  const source = read("dashboard.js").replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "").replace(/\bexport\s+(async\s+)?function/g, "$1function");

  new Function("document", "window", ...Object.keys(stubs), source)(window.document, window, ...Object.values(stubs));

  await window.RecompositionDashboard.render();
  await settle();

  return window.document.getElementById("dashboard-content").textContent.replace(/\s+/g, " ");
}

test("Dashboard shows the ACTIVE goal's saved numbers (manual, recommended and legacy alike)", { skip }, async () => {
  const today = new Date().toLocaleDateString("en-CA");

  const manual = await openDashboard([goalDoc({ startDate: "2026-01-01", nutritionSource: "manual" })]);
  assert.match(manual, /ACTIVE GOAL Cut 2500 kcal 150 g protein 300 g carbs 70 g fat/);

  const recommended = await openDashboard([
    goalDoc({ goalType: "Lean Bulk", calories: 2850, protein: 145, carbs: 420, fat: 65, startDate: "2026-01-01", nutritionSource: "recommended", calculatedFromWeightKg: 80 })
  ]);
  assert.match(recommended, /ACTIVE GOAL Lean Bulk 2850 kcal 145 g protein 420 g carbs 65 g fat/);

  const legacy = await openDashboard([goalDoc({ startDate: "2026-01-01" })]);
  assert.match(legacy, /2500 kcal/);

  assert.ok(today);
});

test("Dashboard does NOT calculate: it shows the saved goal even if the profile would give different numbers", { skip }, async () => {
  const text = await openDashboard([goalDoc({ goalType: "Bulk", calories: 1234, protein: 111, carbs: 222, fat: 33, startDate: "2026-01-01" })]);

  assert.match(text, /1234 kcal 111 g protein 222 g carbs 33 g fat/);
  assert.ok(!/2980/.test(text), "the engine's Bulk number must not appear");
});

test("single source of truth: only goals.js uses the engine; the Dashboard never imports it", () => {
  assert.ok(!/nutritionEngine|calculateNutritionRecommendation/.test(read("dashboard.js")));
  assert.ok(/from "\.\/nutritionEngine\.js"/.test(read("goals.js")));

  for (const file of ["progress.js", "history.js", "logWorkout.js", "workout.js", "auth.js", "settings.js", "profile.js"]) {
    assert.ok(!/nutritionEngine/.test(read(file)), `${file} must not calculate nutrition`);
  }
});


// ============================================================================
// GOALS REFINEMENT: honest wording, current target, no fake progress
// ============================================================================

const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

test("engine constants are exactly the intended starting calculations", () => {
  assert.deepEqual({ ...engine.ACTIVITY_MULTIPLIERS }, {
    "sedentary": 1.2, "lightly-active": 1.375, "moderately-active": 1.55, "very-active": 1.725, "extremely-active": 1.9
  });

  const adjustments = Object.fromEntries(Object.entries(engine.GOAL_RULES).map(([k, v]) => [k, [v.adjustment, v.proteinPerKg]]));

  assert.deepEqual(adjustments, {
    "maintenance": [0, 1.8], "recomposition": [0, 1.8], "lean-bulk": [0.05, 1.8],
    "bulk": [0.10, 1.8], "cut": [-0.15, 2.0], "fat-loss": [-0.20, 2.0]
  });

  assert.equal(engine.FAT_PER_KG, 0.8);
  assert.ok(!("custom" in engine.GOAL_RULES), "custom is manual: never calculated");
});

test("Recomposition is presented as a maintenance-calorie starting point, same numbers as Maintenance", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  await t.chooseType("Recomposition");

  const panel = t.panelText();

  assert.match(panel, /recomposition \(maintenance-calorie starting point\)/);
  assert.doesNotMatch(panel, /recomposition requires|recomposition \+0%/i);
  assert.match(panel, /Calories — 2710 kcal/);
  assert.match(panel, /Protein — 145 g/);
  assert.match(panel, /Carbs — 385 g/);
  assert.match(panel, /Fat — 65 g/);
});

test("every recommendation says these are practical starting targets, not exact requirements", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();

  for (const type of ["Maintenance", "Recomposition", "Lean Bulk", "Bulk", "Cut", "Fat Loss"]) {
    await t.chooseType(type);

    assert.match(t.panelText(), /practical starting targets, not exact requirements/i, type);
    assert.doesNotMatch(t.panelText(), /you need|requires exactly|exactly the calories|optimal|guaranteed/i, type);
  }
});

test("Custom goals are not calculated and carry no recommendation numbers", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();
  await t.chooseType("Custom");

  assert.doesNotMatch(t.panelText().replace(/BMR|TDEE/g, ""), /kcal/);
});

test("the goal form explains that dates only label the period", { skip }, async () => {
  const t = await bootGoals();

  await t.openNew();

  const hint = t.document.querySelector(".goal-date-hint");

  assert.ok(hint);
  assert.match(hint.textContent, /label the goal period/);
  assert.match(hint.textContent, /don't measure progress/);
});

test("the goal whose period contains today is marked CURRENT TARGET (and only it)", { skip }, async () => {
  const t = await bootGoals({
    goals: [
      goalDoc({ id: "past", goalType: "Cut", startDate: dayOffset(-120), endDate: dayOffset(-60) }),
      goalDoc({ id: "now", goalType: "Maintenance", startDate: dayOffset(-30), endDate: "" }),
      goalDoc({ id: "future", goalType: "Bulk", startDate: dayOffset(30), endDate: "" })
    ]
  });

  const badges = [...t.document.querySelectorAll("[data-current-goal]")];

  assert.equal(badges.length, 1);
  assert.equal(badges[0].closest(".goal-card").dataset.goalId, "now");
  assert.match(badges[0].textContent, /CURRENT TARGET/);
});

test("no goal is current when none applies today; saved data is untouched", { skip }, async () => {
  const goals = [goalDoc({ id: "past", startDate: dayOffset(-120), endDate: dayOffset(-60) })];
  const before = JSON.stringify(goals);

  const t = await bootGoals({ goals });

  assert.equal(t.document.querySelectorAll("[data-current-goal]").length, 0);
  assert.equal(JSON.stringify(goals), before);
  assert.equal(t.calls.saveGoal.length, 0, "viewing goals never writes");
});

test("overlapping goals: the one that started most recently is current", { skip }, async () => {
  const t = await bootGoals({
    goals: [
      goalDoc({ id: "old", goalType: "Cut", startDate: dayOffset(-90), endDate: "" }),
      goalDoc({ id: "newer", goalType: "Lean Bulk", startDate: dayOffset(-10), endDate: "" })
    ]
  });

  assert.equal(t.document.querySelector("[data-current-goal]").closest(".goal-card").dataset.goalId, "newer");
});

test("Goals uses the SAME current-goal rule as the Dashboard", () => {
  const dashboard = read("dashboard.js");
  const match = dashboard.match(/function findActiveGoal\(goals\) \{[\s\S]*?\n\}/);

  assert.ok(match, "dashboard findActiveGoal still exists");

  const dashboardRule = new Function("dateKey", `${match[0]}; return findActiveGoal;`)(() => "2026-10-06");

  const goals = [
    { id: "a", startDate: "2026-01-01", endDate: "2026-12-31" },
    { id: "b", startDate: "2026-09-01", endDate: "" },
    { id: "c", startDate: "", endDate: "" },
    { id: "d", startDate: "2026-11-01", endDate: "" },
    { id: "e", startDate: "2025-01-01", endDate: "2025-12-31" }
  ];

  for (const subset of [goals, goals.slice(0, 1), goals.slice(2), goals.slice(3), goals.slice(4), []]) {
    assert.equal(
      activeGoal.findActiveGoal(subset, "2026-10-06")?.id ?? null,
      dashboardRule(subset)?.id ?? null
    );
  }
});

test("Goals shows no completion percentage or progress bar", { skip }, async () => {
  const t = await bootGoals({ goals: [goalDoc({ id: "now", startDate: dayOffset(-30), endDate: dayOffset(30) })] });

  assert.equal(t.document.querySelectorAll("progress, meter, [role='progressbar'], [class*='progress-bar'], [class*='progress-fill']").length, 0);
  assert.doesNotMatch(t.cardsText(), /%|complete|completion|days left|progress/i);
});
