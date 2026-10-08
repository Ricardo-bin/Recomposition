// ============================================================================
// Integration tests: weight-unit preference + read-only Progress.
// Runs the REAL profile.js / settings.js / dashboard.js / progress.js in jsdom
// with the data layer replaced by stubs (units.js is the real module).
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as progressMetrics from "../progressMetrics.js";
import * as progressInsights from "../progressInsights.js";
import * as historyView from "../historyView.js";
import * as dashboardModel from "../dashboardModel.js";
import * as units from "../units.js";
import * as currentWeight from "../currentWeight.js";
import * as logStatus from "../workoutLogStatus.js";
import * as activeGoal from "../activeGoal.js";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(resolve(here, "..", file), "utf8");

// Loads a browser module's source with ALL of its imports stubbed. Names
// imported from ./units.js are the real functions; everything else defaults to
// an async no-op unless overridden.
function loadModule(file, { html, overrides = {}, auth = { currentUser: { uid: "u1" } }, url = "http://localhost/" }) {
  const source = read(file);

  const imports = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)];

  const names = new Map();

  for (const [, list, from] of imports) {
    for (const raw of list.split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop();
      if (name) names.set(name, from);
    }
  }

  const calls = {};

  const stubs = {};

  for (const [name, from] of names) {
    if (from === "./units.js") {
      stubs[name] = units[name];
    } else if (from === "./progressMetrics.js") {
      stubs[name] = progressMetrics[name];
    } else if (from === "./progressInsights.js") {
      stubs[name] = progressInsights[name];
    } else if (from === "./historyView.js") {
      stubs[name] = historyView[name];
    } else if (from === "./dashboardModel.js") {
      stubs[name] = dashboardModel[name];
    } else if (from === "./pendingWorkouts.js" && name === "readPending") {
      stubs[name] = () => [];
    } else if (from === "./workoutLogStatus.js") {
      stubs[name] = logStatus[name];
    } else if (from === "./activeGoal.js") {
      stubs[name] = activeGoal[name];
    } else if (from === "./currentWeight.js") {
      stubs[name] = currentWeight[name];
    } else if (name in overrides) {
      stubs[name] = overrides[name];
    } else if (name === "auth") {
      stubs[name] = auth;
    } else if (name === "onAuthStateChanged") {
      stubs[name] = () => {};
    } else {
      stubs[name] = async (...args) => { (calls[name] ??= []).push(args); return null; };
    }
  }

  // Record calls for overridden functions too.
  for (const name of Object.keys(overrides)) {
    if (typeof overrides[name] === "function" && names.has(name)) {
      const original = overrides[name];
      stubs[name] = async (...args) => { (calls[name] ??= []).push(args); return original(...args); };
    }
  }

  const dom = new JSDOM(html, { url });
  const { window } = dom;

  window.alert = message => { (calls.alert ??= []).push(message); };
  window.confirm = () => true;
  window.HTMLElement.prototype.scrollIntoView = function () {};

  const body = source
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
    .replace(/\bexport\s+(async\s+)?function/g, "$1function");

  // Browser globals the modules call without `window.` (alert/confirm).
  new Function("document", "window", "alert", "confirm", ...Object.keys(stubs), body)(
    window.document, window, window.alert, window.confirm, ...Object.values(stubs)
  );

  return { window, document: window.document, calls, source };
}

const text = el => el?.textContent.replace(/\s+/g, " ").trim();

const PROFILE = { name: "Lin", age: 30, sex: "Male", height: 173, currentWeight: 72.5, unitPreference: "kg", activityLevel: "", trainingExperience: "", gymStartDate: "" };


// ----------------------------------------------------------------------------
// PROGRESS IS READ-ONLY
// ----------------------------------------------------------------------------

const completedLog = {
  id: "L1", status: "completed", workoutName: "Upper B", planId: "p1",
  date: { toDate: () => new Date("2026-09-28T10:00:00") },
  exercises: [{ exerciseId: "e1", name: "Bench", sets: [{ weight: "60", reps: "10", rir: "2" }] }]
};

async function openProgress({ unit = "kg", weights, measurements } = {}) {
  const m = loadModule("progress.js", {
    html: `<div id="progress-content"></div>`,
    overrides: {
      getAllWorkoutLogs: async () => [completedLog],
      getWeightHistory: async () => weights ?? [{ weight: 72.5, date: "2026-09-30" }, { weight: "71", date: "2026-09-23" }],
      getMeasurements: async () => measurements ?? [{ date: "2026-09-30", chest: 40, waist: 32, arms: 14 }],
      getProfile: async () => ({ ...PROFILE, unitPreference: unit })
    }
  });

  m.window.RecompositionNavigation = { showSection: id => { (m.calls.navigate ??= []).push(id); } };

  await m.window.RecompositionProgress.loadProgress();
  await settle();

  return m;
}

test("Progress has NO weight or measurement entry controls", { skip }, async () => {
  const p = await openProgress();
  const d = p.document;

  for (const id of [
    "progress-weight-input", "progress-weight-date", "progress-add-weight",
    "progress-add-measurement", "measurement-chest", "measurement-waist",
    "measurement-shoulders", "measurement-arms", "measurement-thighs",
    "measurement-calves", "measurement-forearms", "measurement-date"
  ]) {
    assert.equal(d.getElementById(id), null, `#${id} must not exist`);
  }

  assert.equal(d.querySelectorAll("#progress-content input").length, 0, "no inputs of any kind");
  assert.ok(!/Add Weight|Add Measurement/i.test(text(d.getElementById("progress-content"))));
});

test("Progress never references the data-layer write functions", () => {
  const source = read("progress.js");

  assert.ok(!/addWeightEntry|addMeasurement/.test(source));
  assert.ok(/getWeightHistory/.test(source) && /getMeasurements/.test(source), "still reads the data");
});

test("Progress still READS and displays weight history and measurements", { skip }, async () => {
  const p = await openProgress();
  const content = text(p.document.getElementById("progress-content"));

  assert.match(content, /WEIGHT HISTORY/);
  assert.match(content, /72\.5 kg/);
  assert.match(content, /71 kg/, "numeric-string weights from older documents");
  assert.match(content, /BODY MEASUREMENTS/);
  assert.match(content, /Chest 40/);
  assert.match(content, /Waist 32/);
  assert.equal(p.calls.addWeightEntry, undefined);
  assert.equal(p.calls.addMeasurement, undefined);
});

test("Progress panels show a helpful empty state that points to Settings", { skip }, async () => {
  const p = await openProgress({ weights: [], measurements: [] });
  const content = text(p.document.getElementById("progress-content"));

  assert.match(content, /No weight entries yet\. Add one in Settings/);
  assert.match(content, /No measurements yet\. Add one in Settings/);
});

test("Progress MANAGE buttons open the matching Settings page", { skip }, async () => {
  const p = await openProgress();
  const d = p.document;

  d.body.insertAdjacentHTML("beforeend", `<button id="settings-weight"></button><button id="settings-measurements"></button>`);

  const clicked = [];
  d.getElementById("settings-weight").addEventListener("click", () => clicked.push("weight"));
  d.getElementById("settings-measurements").addEventListener("click", () => clicked.push("measurements"));

  d.querySelector('[data-progress-manage="weight"]').click();
  d.querySelector('[data-progress-manage="measurements"]').click();

  assert.deepEqual(p.calls.navigate, ["settings", "settings"]);
  assert.deepEqual(clicked, ["weight", "measurements"]);
});

test("Progress shows body weight in the preferred unit (stored kg untouched)", { skip }, async () => {
  const kg = text((await openProgress({ unit: "kg" })).document.getElementById("progress-content"));
  const lb = text((await openProgress({ unit: "lb" })).document.getElementById("progress-content"));

  assert.match(kg, /72\.5 kg/);
  assert.match(lb, /159\.8 lb/);
  assert.match(lb, /156\.5 lb/, "71 kg -> 156.5 lb");
  assert.ok(!/72\.5 kg/.test(lb.split("BODY MEASUREMENTS")[0].split("WEIGHT HISTORY")[1] ?? ""), "weight panel no longer says kg in lb mode");
});


// ----------------------------------------------------------------------------
// PROFILE
// Weight History is the source of truth: the Profile shows the latest weigh-in
// as a READ-ONLY value (in the preferred unit) and never saves a weight.
// ----------------------------------------------------------------------------

async function openProfile(profile, weights = []) {
  const saved = [];

  const m = loadModule("profile.js", {
    html: `<div id="settings-profile-content"></div>`,
    overrides: {
      getProfile: async () => ({ ...PROFILE, ...profile }),
      getWeightHistory: async () => weights,
      updateProfileData: async data => { saved.push(data); }
    }
  });

  await m.window.RecompositionProfile.render();
  await settle();

  const d = m.document;

  return {
    ...m, saved, d,
    weightValue: () => text(d.getElementById("profile-current-weight")),
    weightNote: () => text(d.getElementById("profile-current-weight-note")),
    unitSelect: () => d.getElementById("profile-unit"),
    setUnit(value) {
      const select = d.getElementById("profile-unit");
      select.value = value;
      select.dispatchEvent(new m.window.Event("change", { bubbles: true }));
    },
    async save() {
      d.getElementById("btn-save-profile").click();
      await settle(5);
    },
    message: () => text(d.getElementById("profile-save-message"))
  };
}

const HISTORY = [
  { weight: 72.57, date: "2026-10-03" },
  { weight: 70.5, date: "2026-09-28" }
];

test("Profile: kg preference shows the latest weigh-in; saving never includes a weight", { skip }, async () => {
  const p = await openProfile({ unitPreference: "kg", currentWeight: 99 }, HISTORY);

  assert.equal(p.weightValue(), "72.6 kg", "latest Weight History entry, not the stale profile value 99");
  assert.equal(p.unitSelect().value, "kg");

  await p.save();

  assert.equal(p.saved.length, 1, p.message());
  assert.equal("currentWeight" in p.saved[0], false, "the profile must not write a competing weight");
  assert.equal(p.saved[0].unitPreference, "kg");
  assert.equal(p.saved[0].height, 173, "height is not part of the unit preference");
});

test("Profile: a legacy profile with no unitPreference shows kilograms", { skip }, async () => {
  const p = await openProfile({ unitPreference: undefined }, [{ weight: 80, date: "2026-10-03" }]);

  assert.equal(p.weightValue(), "80 kg");
});

test("Profile: lb preference shows the stored kg weight in pounds (read-only) and still saves no weight", { skip }, async () => {
  const p = await openProfile({ unitPreference: "lb" }, HISTORY);

  assert.equal(p.weightValue(), "160 lb");
  assert.equal(p.d.getElementById("profile-weight"), null, "there is no weight input to type pounds into");

  await p.save();

  assert.equal(p.saved[0].unitPreference, "lb");
  assert.equal("currentWeight" in p.saved[0], false);
});

test("Profile: there is no editable weight field at all", { skip }, async () => {
  const p = await openProfile({ unitPreference: "kg" }, HISTORY);

  assert.equal(p.d.getElementById("profile-weight"), null);
  assert.equal(p.d.querySelector('label[for="profile-weight"]'), null);
  assert.equal(p.d.querySelectorAll("#settings-profile-content input[type='number']").length, 2, "only age and height remain numeric inputs");
  assert.ok(p.d.getElementById("btn-manage-weight"), "a clear Manage in Weight History action");
});

test("Profile: flipping the unit selector re-displays the same weight in the chosen unit; storage unchanged", { skip }, async () => {
  const p = await openProfile({ unitPreference: "kg" }, [{ weight: 72.5, date: "2026-10-03" }]);

  p.setUnit("lb");
  assert.equal(p.weightValue(), "159.8 lb");

  p.setUnit("kg");
  assert.equal(p.weightValue(), "72.5 kg", "flipping back restores the value");

  p.setUnit("lb");
  await p.save();

  assert.equal(p.saved[0].unitPreference, "lb");
  assert.equal("currentWeight" in p.saved[0], false, "only the unit preference is stored");
});

test("Profile: weight can never block or alter a profile save (even a nonsense legacy value)", { skip }, async () => {
  const p = await openProfile({ unitPreference: "lb", currentWeight: 99999 }, []);

  await p.save();

  assert.equal(p.saved.length, 1, "profile saves normally: " + p.message());
  assert.ok(!/valid body weight/.test(p.message()));
  assert.equal("currentWeight" in p.saved[0], false, "the legacy value is left untouched, not overwritten or cleared");
});

test("Profile: with no weigh-ins the legacy profile weight is shown as a clearly-labelled fallback", { skip }, async () => {
  const p = await openProfile({ unitPreference: "kg", currentWeight: 72.5 }, []);

  assert.equal(p.weightValue(), "72.5 kg");
  assert.match(p.weightNote(), /earlier profile entry/);
  assert.match(p.weightNote(), /Add a weigh-in in Weight History/);
});

test("Profile: nothing recorded at all says so and points to Weight History", { skip }, async () => {
  const p = await openProfile({ currentWeight: null }, []);

  assert.equal(p.weightValue(), "—");
  assert.match(p.weightNote(), /No weight recorded yet/);
});

test("Profile: Manage in Weight History opens Settings -> Weight History", { skip }, async () => {
  const p = await openProfile({}, HISTORY);

  p.d.body.insertAdjacentHTML("beforeend", `<button id="settings-weight"></button>`);

  const clicks = [];
  p.window.RecompositionNavigation = { showSection: id => clicks.push(id) };
  p.d.getElementById("settings-weight").addEventListener("click", () => clicks.push("weight-page"));

  p.d.getElementById("btn-manage-weight").click();

  assert.deepEqual(clicks, ["settings", "weight-page"]);
});


// ----------------------------------------------------------------------------
// DASHBOARD
// ----------------------------------------------------------------------------

async function openDashboard({ unit, currentWeight = 72, weights = [] }) {
  const m = loadModule("dashboard.js", {
    html: `<div id="dashboard-content"></div>`,
    overrides: {
      getProfile: async () => ({ ...PROFILE, unitPreference: unit, currentWeight }),
      getWorkoutPlans: async () => [],
      getWorkoutLogs: async () => [],
      getWeightHistory: async () => weights,
      getGoals: async () => []
    }
  });

  await m.window.RecompositionDashboard.render();
  await settle();

  return text(m.document.getElementById("dashboard-content"));
}

test("Dashboard weight tile: kg unchanged, lb converted", { skip }, async () => {
  assert.match(await openDashboard({ unit: "kg" }), /CURRENT WEIGHT 72 kg/);
  assert.match(await openDashboard({ unit: undefined }), /CURRENT WEIGHT 72 kg/);
  assert.match(await openDashboard({ unit: "lb" }), /CURRENT WEIGHT 158\.7 lb/);
});

test("Dashboard prefers the latest weigh-in and converts it too", { skip }, async () => {
  const content = await openDashboard({ unit: "lb", weights: [{ weight: 70, date: "2026-09-30" }] });

  assert.match(content, /CURRENT WEIGHT 154\.3 lb/);
});

test("Dashboard with no weight at all still shows a dash", { skip }, async () => {
  assert.match(await openDashboard({ unit: "lb", currentWeight: null }), /CURRENT WEIGHT —/);
});


// ----------------------------------------------------------------------------
// SETTINGS -> WEIGHT HISTORY (management lives here)
// ----------------------------------------------------------------------------

async function openSettingsWeight({ unit, history = [] }) {
  const m = loadModule("settings.js", {
    html: `<div id="settings-content"></div>`,
    overrides: {
      getProfile: async () => ({ ...PROFILE, unitPreference: unit }),
      getWeightHistory: async () => history,
      addWeightEntry: async () => {}
    }
  });

  m.window.RecompositionSettings.renderSettings();
  await settle();

  m.document.getElementById("settings-weight").click();
  await settle(4);

  const d = m.document;

  return {
    ...m, d,
    label: () => text(d.querySelector('label[for="settings-weight-value"]')),
    list: () => text(d.getElementById("settings-weight-history-list")),
    async add(value, date = "2026-10-02") {
      d.getElementById("settings-weight-value").value = value;
      d.getElementById("settings-weight-date").value = date;
      d.getElementById("settings-add-weight").click();
      await settle(5);
    }
  };
}

test("Settings → Weight History: kg users see exactly what they saw before", { skip }, async () => {
  const s = await openSettingsWeight({ unit: "kg", history: [{ weight: 72.5, date: "2026-09-30" }, { weight: "71", date: "2026-09-23" }] });

  assert.equal(s.label(), "WEIGHT (KG)");
  assert.match(s.list(), /72\.5 kg/);
  assert.match(s.list(), /71 kg/);

  await s.add("73.4");

  assert.deepEqual(s.calls.addWeightEntry.at(-1)[0], { weight: 73.4, date: "2026-10-02" });
});

test("Settings → Weight History: lb users see pounds and the entry is saved as kg", { skip }, async () => {
  const s = await openSettingsWeight({ unit: "lb", history: [{ weight: 72.57, date: "2026-09-30" }] });

  assert.equal(s.label(), "WEIGHT (LB)");
  assert.match(s.list(), /160 lb/);
  assert.ok(!/kg/.test(s.list()));

  await s.add("165");

  assert.deepEqual(s.calls.addWeightEntry.at(-1)[0], { weight: 74.84, date: "2026-10-02" });
});

test("Settings → Weight History: invalid input still rejected", { skip }, async () => {
  const s = await openSettingsWeight({ unit: "lb" });

  await s.add("");

  assert.equal(s.calls.addWeightEntry, undefined);
  assert.match(s.calls.alert.at(-1), /valid weight/);
});

test("Settings → Body Measurements page still opens and keeps its entry form", { skip }, async () => {
  const m = loadModule("settings.js", {
    html: `<div id="settings-content"></div>`,
    overrides: {
      getProfile: async () => PROFILE,
      getMeasurements: async () => [{ date: "2026-09-30", chest: 40 }],
      addMeasurement: async () => {}
    }
  });

  m.window.RecompositionSettings.renderSettings();
  await settle();

  m.document.getElementById("settings-measurements").click();
  await settle(4);

  assert.ok(m.document.getElementById("settings-measurement-chest"), "entry form is in Settings");
  assert.ok(m.document.getElementById("settings-add-measurement") ?? m.document.querySelector("button[id*='measurement']"));
});


// ----------------------------------------------------------------------------
// EXPORTS STAY CANONICAL
// ----------------------------------------------------------------------------

test("Exports keep canonical kg values and explicit 'Weight (kg)' headers", () => {
  const source = read("settings.js");

  assert.ok((source.match(/"Weight \(kg\)"/g) || []).length >= 4, "all export formats label kilograms");
  assert.ok(!/formatWeight\([^)]*\)[\s\S]{0,40}"Weight \(kg\)"/.test(source));
});
