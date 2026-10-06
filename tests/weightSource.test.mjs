// ============================================================================
// WEIGHT HISTORY = SOURCE OF TRUTH FOR CURRENT BODY WEIGHT
//
//   latest valid Weight History entry -> Current Weight -> Profile display,
//                                                          Dashboard, Nutrition
//
// Part 1: the pure resolver (currentWeight.js). No DOM needed.
// Part 2: the real Profile / Settings / Dashboard / Goals modules sharing ONE
//         in-memory "Firestore" (jsdom; skipped if jsdom is not installed).
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
import * as progressMetrics from "../progressMetrics.js";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const { resolveCurrentWeight, formatWeighInDate, describeCurrentWeight } = currentWeight;

const here = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(resolve(here, "..", file), "utf8");


// ============================================================================
// PART 1 — the pure resolver
// ============================================================================

// The example from the task: three entries, two on the same day.
const EXAMPLE = [
  { id: "a", weight: 72, date: "2026-10-03" },
  { id: "b", weight: 70.5, date: "2026-09-28" },
  { id: "c", weight: 73, date: "2026-09-28" }
];

test("resolver: the latest dated Weight History entry is the current weight", () => {
  assert.deepEqual(resolveCurrentWeight(EXAMPLE, 99), { weightKg: 72, source: "weight-history", date: "2026-10-03" });
});

test("resolver: it ignores list order (newest-first, oldest-first or shuffled)", () => {
  for (const order of [EXAMPLE, [...EXAMPLE].reverse(), [EXAMPLE[1], EXAMPLE[0], EXAMPLE[2]]]) {
    assert.equal(resolveCurrentWeight(order, null).weightKg, 72);
  }
});

test("resolver: a newer weigh-in immediately becomes the current weight", () => {
  const withNewer = [{ weight: 72.4, date: "2026-10-05" }, ...EXAMPLE];

  assert.equal(resolveCurrentWeight(withNewer, null).weightKg, 72.4);
  assert.equal(resolveCurrentWeight(withNewer, null).date, "2026-10-05");
});

test("resolver: two entries on the SAME day -> the one added last wins (createdAt)", () => {
  const seconds = s => ({ seconds: s, nanoseconds: 0 });
  const stamp = ms => ({ toMillis: () => ms });

  const sameDay = [
    { weight: 70.5, date: "2026-09-28", createdAt: stamp(1000) },
    { weight: 73, date: "2026-09-28", createdAt: stamp(5000) }
  ];

  assert.equal(resolveCurrentWeight(sameDay, null).weightKg, 73);
  assert.equal(resolveCurrentWeight([...sameDay].reverse(), null).weightKg, 73, "independent of list order");

  const bySeconds = [
    { weight: 70.5, date: "2026-09-28", createdAt: seconds(100) },
    { weight: 73, date: "2026-09-28", createdAt: seconds(200) }
  ];

  assert.equal(resolveCurrentWeight(bySeconds, null).weightKg, 73);

  const asDates = [
    { weight: 70.5, date: "2026-09-28", createdAt: new Date("2026-09-28T08:00:00Z") },
    { weight: 73, date: "2026-09-28", createdAt: "2026-09-28T19:00:00Z" }
  ];

  assert.equal(resolveCurrentWeight(asDates, null).weightKg, 73);
});

test("resolver: same day without createdAt -> the first listed entry wins (deterministic)", () => {
  assert.equal(resolveCurrentWeight([{ weight: 70.5, date: "2026-09-28" }, { weight: 73, date: "2026-09-28" }], null).weightKg, 70.5);
});

test("resolver: a later DATE always beats a later createdAt", () => {
  const history = [
    { weight: 70, date: "2026-09-30", createdAt: { toMillis: () => 9_000_000 } },
    { weight: 71, date: "2026-10-01", createdAt: { toMillis: () => 1 } }
  ];

  assert.equal(resolveCurrentWeight(history, null).weightKg, 71);
});

test("resolver: invalid entries are skipped (not numbers, zero, negative, blank)", () => {
  const history = [
    { weight: "abc", date: "2026-10-09" },
    { weight: 0, date: "2026-10-08" },
    { weight: -4, date: "2026-10-07" },
    { weight: null, date: "2026-10-06" },
    { weight: "", date: "2026-10-05" },
    { weight: "71.5", date: "2026-10-04" },
    { weight: 70, date: "2026-10-01" }
  ];

  assert.deepEqual(resolveCurrentWeight(history, 60), { weightKg: 71.5, source: "weight-history", date: "2026-10-04" });
});

test("resolver: legacy profile weight is only a fallback when there is NO valid history", () => {
  assert.deepEqual(resolveCurrentWeight([], 72.5), { weightKg: 72.5, source: "profile", date: null });
  assert.deepEqual(resolveCurrentWeight(undefined, "72.5"), { weightKg: 72.5, source: "profile", date: null });
  assert.deepEqual(resolveCurrentWeight([{ weight: "abc", date: "2026-10-01" }], 72.5).source, "profile");
  assert.deepEqual(resolveCurrentWeight(EXAMPLE, 55).source, "weight-history", "history wins over a different profile value");
});

test("resolver: nothing anywhere -> no weight", () => {
  for (const args of [[[], null], [null, undefined], [undefined, ""], [[], 0], [[], "abc"]]) {
    assert.deepEqual(resolveCurrentWeight(...args), { weightKg: null, source: null, date: null });
  }
});

test("resolver never mutates the history it reads", () => {
  const history = Object.freeze(EXAMPLE.map(entry => Object.freeze({ ...entry })));
  const before = JSON.stringify(history);

  resolveCurrentWeight(history, 60);

  assert.equal(JSON.stringify(history), before);
});

test("ONE implementation: currentWeight.js and the Nutrition Engine resolve identically", () => {
  assert.equal(resolveCurrentWeight, currentWeight.resolveCurrentWeight);

  for (const history of [EXAMPLE, [], [{ weight: 70, date: "2026-01-01" }]]) {
    assert.deepEqual(resolveCurrentWeight(history, 66), engine.pickCurrentWeightKg(history, 66));
  }
});

test("formatWeighInDate: '2026-10-03' -> '03 Oct 2026' (no time-zone drift)", () => {
  assert.equal(formatWeighInDate("2026-10-03"), "03 Oct 2026");
  assert.equal(formatWeighInDate("2026-01-01"), "01 Jan 2026");
  assert.equal(formatWeighInDate("2026-12-31"), "31 Dec 2026");
  assert.equal(formatWeighInDate("2026-10-03T23:59:00Z"), "03 Oct 2026");

  for (const bad of ["", null, undefined, "yesterday", "2026-13-01", "10/03/2026"]) {
    assert.equal(formatWeighInDate(bad), "", String(bad));
  }
});

test("describeCurrentWeight wording for each situation", () => {
  assert.deepEqual(describeCurrentWeight(resolveCurrentWeight(EXAMPLE, null)), {
    kind: "weight-history", note: "Latest weigh-in: 03 Oct 2026"
  });

  const legacy = describeCurrentWeight(resolveCurrentWeight([], 72));

  assert.equal(legacy.kind, "profile");
  assert.match(legacy.note, /earlier profile entry/);

  const none = describeCurrentWeight(resolveCurrentWeight([], null));

  assert.equal(none.kind, "none");
  assert.match(none.note, /No weight recorded yet/);
  assert.equal(describeCurrentWeight(undefined).kind, "none");
});

test("currentWeight.js is pure: its only import is the engine's pure helper", () => {
  const code = read("currentWeight.js").replace(/\/\/.*$/gm, "");

  assert.deepEqual(
    [...code.matchAll(/^\s*import\s[\s\S]*?from\s+"([^"]+)"/gm)].map(m => m[1]),
    ["./nutritionEngine.js"]
  );

  for (const forbidden of ["document", "window", "localStorage", "fetch(", "firebase", "setDoc", "updateDoc", "addDoc", "saveGoal", "addWeightEntry"]) {
    assert.ok(!code.includes(forbidden), `must not reference ${forbidden}`);
  }
});

test("every screen resolves weight through currentWeight.js (no second implementation)", () => {
  for (const file of ["profile.js", "dashboard.js", "goals.js"]) {
    const source = read(file);

    assert.match(source, /from "\.\/currentWeight\.js"/, file);
    assert.match(source, /resolveCurrentWeight\(/, file);
  }

  assert.ok(!/weightHistory\.find\(/.test(read("dashboard.js")), "the Dashboard's private 'latest weight' logic is gone");
  assert.ok(!/profile\??\.currentWeight/.test(read("dashboard.js").replace(/resolveCurrentWeight\([\s\S]*?\)/g, "")), "no direct profile-weight reads left in the Dashboard");
});

test("the Profile module no longer reads, edits, validates or writes a weight", () => {
  const code = read("profile.js").replace(/\/\/.*$/gm, "");

  assert.ok(!/id="profile-weight"/.test(code));
  assert.ok(!/displayToKg|convertInputText|weightInputValue|weightRange/.test(code));
  assert.ok(!/valid body weight/.test(code));
  assert.ok(!/addWeightEntry/.test(code), "the Profile never writes Weight History");

  const payload = code.slice(code.indexOf("updateProfileData({"), code.indexOf("});", code.indexOf("updateProfileData({")));

  assert.ok(!/\bcurrentWeight\b/.test(payload.replace(/\/\*[\s\S]*?\*\//g, "")), "currentWeight is not in the saved payload");
});


// ============================================================================
// PART 2 — the real modules sharing one in-memory "Firestore"
// ============================================================================

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const BASE_PROFILE = {
  name: "Lin", age: 30, sex: "Male", height: 175, currentWeight: 60,   // stale legacy value on purpose
  activityLevel: "Moderately active", unitPreference: "kg", trainingExperience: "", gymStartDate: ""
};

// What the database holds; every module reads and writes through these stubs.
function makeWorld({ profile = BASE_PROFILE, weights = EXAMPLE } = {}) {
  const world = {
    profile: structuredClone(profile),
    weights: weights.map((entry, i) => ({ id: entry.id ?? `w${i}`, ...entry })),
    writes: { addWeightEntry: [], updateProfileData: [], saveGoal: [], other: [] },
    goals: [],
    clock: 1_000
  };

  world.api = {
    getProfile: async () => structuredClone(world.profile),
    // updateDoc semantics: only the fields given are changed; omitted fields survive
    updateProfileData: async data => { world.writes.updateProfileData.push(structuredClone(data)); Object.assign(world.profile, data); },
    // like Firestore: ordered by date, newest first
    getWeightHistory: async () => [...world.weights].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).map(w => ({ ...w })),
    addWeightEntry: async entry => {
      world.clock += 1000;
      const createdAt = world.clock;           // captured now: a later add must not change it
      world.writes.addWeightEntry.push(structuredClone(entry));
      world.weights.push({ id: `new${createdAt}`, ...entry, createdAt: { toMillis: () => createdAt } });
    },
    // Workout reads used by the Dashboard (not part of this feature; just empty)
    getWorkoutPlans: async () => [],
    getWorkoutLogs: async () => [],
    getGoals: async () => world.goals.map(g => ({ ...g })),
    saveGoal: async (id, data) => {
      world.writes.saveGoal.push({ id, data: structuredClone(data) });
      const existing = world.goals.find(g => g.id === id);
      if (existing) Object.assign(existing, data); else world.goals.push({ id, ...data });
    },
    deleteGoal: async () => {}
  };

  return world;
}

function mount(world, file, html, extra = {}) {
  const source = read(file);

  const names = new Map();

  for (const [, list, from] of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)) {
    for (const raw of list.split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop();
      if (name) names.set(name, from);
    }
  }

  const stubs = {};

  for (const [name, from] of names) {
    if (from === "./units.js") stubs[name] = units[name];
    else if (from === "./currentWeight.js") stubs[name] = currentWeight[name];
    else if (from === "./nutritionEngine.js") stubs[name] = engine[name];
    else if (from === "./activeGoal.js") stubs[name] = activeGoal[name];
    else if (from === "./progressMetrics.js") stubs[name] = progressMetrics[name];
    else if (name in world.api) stubs[name] = world.api[name];
    else if (name === "auth") stubs[name] = { currentUser: { uid: "u1" } };
    else if (name === "onAuthStateChanged") stubs[name] = () => {};
    else stubs[name] = async (...args) => { world.writes.other.push([name, ...args]); return null; };
  }

  const dom = new JSDOM(html, { url: "http://localhost/" });
  const { window } = dom;

  window.alert = message => { (extra.alerts ??= []).push(message); };
  window.confirm = () => true;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.RecompositionNavigation = { showSection: id => { (extra.navigate ??= []).push(id); } };

  const body = source
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
    .replace(/\bexport\s+(async\s+)?function/g, "$1function");

  const internals = new Function("document", "window", "alert", "confirm", "crypto", ...Object.keys(stubs), body + "\n;return typeof loadGoals === 'function' ? { loadGoals } : {};")(
    window.document, window, window.alert, window.confirm, globalThis.crypto, ...Object.values(stubs)
  );

  return { window, document: window.document, extra, internals };
}

const text = el => el?.textContent.replace(/\s+/g, " ").trim();

async function openProfile(world) {
  const m = mount(world, "profile.js", `<div id="settings-profile-content"></div>`);
  await m.window.RecompositionProfile.render();
  await settle();

  return { ...m, value: () => text(m.document.getElementById("profile-current-weight")), note: () => text(m.document.getElementById("profile-current-weight-note")) };
}

async function openDashboard(world) {
  const m = mount(world, "dashboard.js", `<div id="dashboard-content"></div>`);
  await m.window.RecompositionDashboard.render();
  await settle();

  return { ...m, text: () => text(m.document.getElementById("dashboard-content")) };
}

async function openGoalsForm(world) {
  const m = mount(world, "goals.js", `<div id="settings-goals-content"></div><button id="settings-profile"></button>`);
  await m.internals.loadGoals(m.document.getElementById("settings-goals-content"));
  await settle();
  m.document.getElementById("btn-new-goal").click();
  await settle(4);

  return { ...m, panel: () => text(m.document.getElementById("goal-nutrition-panel")), select: type => { const s = m.document.getElementById("goal-type"); s.value = type; s.dispatchEvent(new m.window.Event("change", { bubbles: true })); } };
}

async function addWeightInSettings(world, value, date) {
  const m = mount(world, "settings.js", `<div id="settings-content"></div>`);

  m.window.RecompositionSettings.renderSettings();
  await settle();
  m.document.getElementById("settings-weight").click();
  await settle(4);

  m.document.getElementById("settings-weight-value").value = String(value);
  m.document.getElementById("settings-weight-date").value = date;
  m.document.getElementById("settings-add-weight").click();
  await settle(6);

  return m;
}


// ---- A. Profile shows the latest valid Weight History value --------------------

test("A. Profile displays the latest valid Weight History value (not the stale profile value)", { skip }, async () => {
  const world = makeWorld({ weights: [...EXAMPLE, { weight: "abc", date: "2026-10-09" }, { weight: 0, date: "2026-10-08" }] });

  const p = await openProfile(world);

  assert.equal(p.value(), "72 kg", "latest VALID entry (2026-10-03), ignoring invalid newer rows and the stale 60");
  assert.equal(p.note(), "Latest weigh-in: 03 Oct 2026");
  assert.ok(p.document.getElementById("btn-manage-weight"), "clear Manage in Weight History action");
  assert.match(text(p.document.getElementById("profile-current-weight-box")), /CURRENT WEIGHT|72 kg/);
});

// ---- B. Adding a newer weight is reflected everywhere ---------------------------

test("B. Adding a newer weight in Settings immediately changes Profile, Dashboard and the Nutrition panel", { skip }, async () => {
  const world = makeWorld();

  assert.equal((await openProfile(world)).value(), "72 kg");
  assert.match((await openDashboard(world)).text(), /CURRENT WEIGHT 72 kg/);

  await addWeightInSettings(world, 75.5, "2026-10-04");

  assert.deepEqual(world.writes.addWeightEntry, [{ weight: 75.5, date: "2026-10-04" }]);

  const profile = await openProfile(world);

  assert.equal(profile.value(), "75.5 kg");
  assert.equal(profile.note(), "Latest weigh-in: 04 Oct 2026");
  assert.match((await openDashboard(world)).text(), /CURRENT WEIGHT 75\.5 kg/);

  const goals = await openGoalsForm(world);

  assert.match(goals.panel(), /Based on 75\.5 kg \(latest weigh-in 2026-10-04\)/);
});

test("B2. Two weigh-ins on the same day: the one added last is the current weight everywhere", { skip }, async () => {
  const world = makeWorld({ weights: [] });

  await addWeightInSettings(world, 70.5, "2026-09-28");
  await addWeightInSettings(world, 73, "2026-09-28");

  assert.equal((await openProfile(world)).value(), "73 kg");
  assert.match((await openDashboard(world)).text(), /CURRENT WEIGHT 73 kg/);
  assert.match((await openGoalsForm(world)).panel(), /Based on 73 kg/);
});

// ---- C. Historical entries unchanged -----------------------------------------------

test("C. Existing history is never changed: only the new entry is added", { skip }, async () => {
  const world = makeWorld();
  const before = structuredClone(world.weights);

  await openProfile(world);
  await openDashboard(world);
  await openGoalsForm(world);
  await addWeightInSettings(world, 75.5, "2026-10-04");

  assert.deepEqual(world.weights.slice(0, 3), before, "the three existing entries are identical");
  assert.equal(world.weights.length, 4);
  assert.deepEqual(world.writes.addWeightEntry.length, 1);
  assert.deepEqual(world.writes.other, [], "no deletes or updates of any kind");
});

// ---- D. Nutrition uses the canonical weight ----------------------------------------------

test("D. Nutrition uses the latest Weight History value, not the stale profile weight", { skip }, async () => {
  const world = makeWorld();                       // history latest = 72 kg, profile.currentWeight = 60

  const goals = await openGoalsForm(world);

  const expected = engine.calculateNutritionRecommendation(engine.buildNutritionInput({
    profile: BASE_PROFILE, weightKg: 72, goalType: "Maintenance"
  }));
  const stale = engine.calculateNutritionRecommendation(engine.buildNutritionInput({
    profile: BASE_PROFILE, weightKg: 60, goalType: "Maintenance"
  }));

  assert.notEqual(expected.calories, stale.calories, "the two weights really give different answers");
  assert.match(goals.panel(), new RegExp(`Calories — ${expected.calories} kcal`));
  assert.match(goals.panel(), /Based on 72 kg/);

  goals.document.getElementById("goal-start").value = "2026-10-05";
  goals.document.getElementById("btn-apply-nutrition").click();
  await settle(6);

  assert.equal(world.writes.saveGoal[0].data.calculatedFromWeightKg, 72, "the applied recommendation records the canonical weight");
  assert.equal(world.writes.saveGoal[0].data.calories, expected.calories);
});

test("D2. Profile, Dashboard and Nutrition always agree on the current weight", { skip }, async () => {
  const scenarios = {
    "example (ties + older entries)": makeWorld(),
    "invalid newer rows": makeWorld({ weights: [{ weight: "x", date: "2026-12-01" }, { weight: 81, date: "2026-11-01" }] }),
    "one entry": makeWorld({ weights: [{ weight: 66.5, date: "2026-10-01" }] }),
    "same-day tie by createdAt": makeWorld({ weights: [
      { weight: 70.5, date: "2026-09-28", createdAt: { toMillis: () => 100 } },
      { weight: 73, date: "2026-09-28", createdAt: { toMillis: () => 200 } }] }),
    "no history, legacy profile weight": makeWorld({ weights: [] })
  };

  for (const [name, world] of Object.entries(scenarios)) {
    const kg = engine.pickCurrentWeightKg(await world.api.getWeightHistory(), world.profile.currentWeight).weightKg;
    const expectedText = units.formatWeight(kg, "kg");

    assert.equal((await openProfile(world)).value(), expectedText, `${name}: Profile`);
    assert.match((await openDashboard(world)).text(), new RegExp(`CURRENT WEIGHT ${expectedText}`), `${name}: Dashboard`);
    assert.match((await openGoalsForm(world)).panel(), new RegExp(`Based on ${expectedText.replace(".", "\\.")}`), `${name}: Nutrition`);
  }
});

// ---- E. No duplicate writes -------------------------------------------------------------------

test("E. Opening, refreshing and re-rendering Profile (and the other screens) never writes a weight entry", { skip }, async () => {
  const world = makeWorld();
  const before = structuredClone(world.weights);

  for (let i = 0; i < 4; i += 1) await openProfile(world);          // "refresh" the Profile repeatedly

  const p = await openProfile(world);
  p.document.getElementById("profile-unit").value = "lb";
  p.document.getElementById("profile-unit").dispatchEvent(new p.window.Event("change", { bubbles: true }));

  await openDashboard(world);
  await openGoalsForm(world);

  assert.deepEqual(world.writes.addWeightEntry, [], "no weight entry written");
  assert.deepEqual(world.weights, before, "history identical");
  assert.deepEqual(world.writes.updateProfileData, [], "not even the profile was written");
  assert.deepEqual(world.writes.saveGoal, []);
});

test("E2. Saving the Profile never creates or changes a weigh-in", { skip }, async () => {
  const world = makeWorld();
  const before = structuredClone(world.weights);

  const p = await openProfile(world);
  p.document.getElementById("btn-save-profile").click();
  await settle(6);

  assert.equal(world.writes.updateProfileData.length, 1);
  assert.deepEqual(world.writes.addWeightEntry, []);
  assert.deepEqual(world.weights, before);
});

// ---- F. No competing editable weight ------------------------------------------------------------

test("F. The Profile cannot save a different current weight", { skip }, async () => {
  const world = makeWorld();

  const p = await openProfile(world);

  assert.equal(p.document.getElementById("profile-weight"), null, "no weight input");
  assert.equal(p.document.querySelectorAll('input[id*="weight" i]').length, 0, "no input of any kind mentions weight");

  p.document.getElementById("profile-name").value = "Lin Renamed";
  p.document.getElementById("btn-save-profile").click();
  await settle(6);

  const [payload] = world.writes.updateProfileData;

  assert.equal(payload.name, "Lin Renamed", "other fields still save");
  assert.equal("currentWeight" in payload, false, "weight is not part of the Profile save");
  assert.equal(world.profile.currentWeight, 60, "the legacy stored value is neither changed nor cleared");
  assert.equal((await openProfile(world)).value(), "72 kg", "and the display still comes from Weight History");
});

// ---- G. Units: kg canonical, lb display ----------------------------------------------------------------

test("G. kg stays canonical; lb is display-only on Profile, Dashboard and Nutrition", { skip }, async () => {
  const world = makeWorld({ profile: { ...BASE_PROFILE, unitPreference: "lb" } });

  await addWeightInSettings(world, 165, "2026-10-04");           // typed in pounds

  assert.deepEqual(world.writes.addWeightEntry, [{ weight: 74.84, date: "2026-10-04" }], "stored as kilograms");
  assert.equal(world.weights.at(-1).weight, 74.84);

  assert.equal((await openProfile(world)).value(), "165 lb");
  assert.match((await openDashboard(world)).text(), /CURRENT WEIGHT 165 lb/);

  const goals = await openGoalsForm(world);

  assert.match(goals.panel(), /Based on 165 lb \(latest weigh-in 2026-10-04\)/);

  goals.document.getElementById("goal-start").value = "2026-10-05";
  goals.document.getElementById("btn-apply-nutrition").click();
  await settle(6);

  assert.equal(world.writes.saveGoal[0].data.calculatedFromWeightKg, 74.84, "nutrition stored the kg value, never pounds");

  // switching the display unit never changes stored data
  world.profile.unitPreference = "kg";

  assert.equal((await openProfile(world)).value(), "74.8 kg");
  assert.equal(world.weights.at(-1).weight, 74.84);
});

test("G2. The Profile unit selector re-displays the same stored weight and writes nothing", { skip }, async () => {
  const world = makeWorld({ weights: [{ weight: 72.5, date: "2026-10-03" }] });

  const p = await openProfile(world);
  const select = p.document.getElementById("profile-unit");

  select.value = "lb";
  select.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.value(), "159.8 lb");

  select.value = "kg";
  select.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.value(), "72.5 kg");

  assert.deepEqual(world.writes.updateProfileData, []);
  assert.equal(world.weights[0].weight, 72.5);
});

// ---- legacy / no-history fallback ------------------------------------------------------------------------

test("Legacy fallback: with no weigh-ins everything shows the old profile weight, then switches to history", { skip }, async () => {
  const world = makeWorld({ profile: { ...BASE_PROFILE, currentWeight: 72.5 }, weights: [] });

  const before = await openProfile(world);

  assert.equal(before.value(), "72.5 kg");
  assert.match(before.note(), /earlier profile entry/);
  assert.match((await openDashboard(world)).text(), /CURRENT WEIGHT 72\.5 kg/);
  assert.match((await openGoalsForm(world)).panel(), /Based on 72\.5 kg \(from your profile\)/);

  await addWeightInSettings(world, 74, "2026-10-04");

  const after = await openProfile(world);

  assert.equal(after.value(), "74 kg");
  assert.equal(after.note(), "Latest weigh-in: 04 Oct 2026");
  assert.equal(world.profile.currentWeight, 72.5, "the legacy value is left in place, untouched");
});

test("New user: no weight anywhere -> clear prompt, no invented value, nothing written", { skip }, async () => {
  const world = makeWorld({ profile: { ...BASE_PROFILE, currentWeight: null }, weights: [] });

  const p = await openProfile(world);

  assert.equal(p.value(), "—");
  assert.match(p.note(), /No weight recorded yet/);
  assert.match((await openDashboard(world)).text(), /CURRENT WEIGHT —/);
  assert.deepEqual(world.writes.addWeightEntry, []);
});

test("Weight history that fails to load degrades safely on the Profile", { skip }, async () => {
  const world = makeWorld({ profile: { ...BASE_PROFILE, currentWeight: 72.5 } });
  world.api.getWeightHistory = async () => { throw new Error("offline"); };

  const p = await openProfile(world);

  assert.equal(p.value(), "72.5 kg", "falls back to the stored value");
  assert.match(p.note(), /Weight history could not be loaded/);
  assert.deepEqual(world.writes.addWeightEntry, []);
});
