// ============================================================================
// Progress screen (real progress.js in jsdom): objective metrics only.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";
import * as units from "../units.js";
import * as progressMetrics from "../progressMetrics.js";
import * as logStatus from "../workoutLogStatus.js";
import * as activeGoal from "../activeGoal.js";
import * as progressInsights from "../progressInsights.js";
import * as historyView from "../historyView.js";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));

const SOURCE = readFileSync(resolve(here, "..", "progress.js"), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
  .replace(/\bexport\s+(async\s+)?function/g, "$1function");

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const log = (id, date, exercises) => ({ id, status: "completed", workoutName: "Upper A", date, exercises });

const bench = sets => ({ exerciseId: "e1", name: "Bench Press", sets });

async function openProgress({ logs = [], weights = [], measurements = [], unit = "kg", goals = [] } = {}) {
  const { window } = new JSDOM(`<div id="progress-content"></div>`, { url: "http://localhost/" });

  window.alert = () => {};
  window.RecompositionNavigation = { showSection: () => {} };

  const stubs = {
    getAllWorkoutLogs: async () => logs,
    getWeightHistory: async () => weights,
    getMeasurements: async () => measurements,
    getProfile: async () => ({ unitPreference: unit }),
    getGoals: async () => goals,
    toDate: historyView.toDate,
    findActiveGoal: activeGoal.findActiveGoal,
    todayKey: activeGoal.todayKey,
    formatWeight: units.formatWeight,
    normalizeWeightUnit: units.normalizeWeightUnit,
    isCompletedLog: logStatus.isCompletedLog,
    ...progressMetrics,
    ...progressInsights
  };

  new Function("document", "window", ...Object.keys(stubs), SOURCE)(window.document, window, ...Object.values(stubs));

  await window.RecompositionProgress.loadProgress();
  await settle();

  const $ = s => window.document.querySelector(s);
  const text = el => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

  return { window, $, $$: s => [...window.document.querySelectorAll(s)], text, page: () => text($("#progress-content")) };
}


// ---- strength: best set = highest estimated 1RM -----------------------------------

test("strength progression compares each session's strongest set by estimated 1RM", { skip }, async () => {
  const p = await openProgress({
    logs: [
      // older session: 60 x 12 (volume 720, e1RM 84.0) and 70 x 8 (volume 560, e1RM 88.7)
      log("L1", daysAgo(14), [bench([{ weight: "60", reps: "12", rir: "2" }, { weight: "70", reps: "8", rir: "1" }])]),
      // latest session: 72.5 x 8 (e1RM 91.8)
      log("L2", daysAgo(7), [bench([{ weight: "72.5", reps: "8", rir: "1" }])])
    ]
  });

  const detail = p.text(p.$("#strength-progress-detail"));

  assert.match(detail, /PREVIOUS 70 kg × 8/, "the previous best set is 70 x 8, not 60 x 12");
  assert.match(detail, /Estimated 1RM: 88\.7 kg/);
  assert.match(detail, /LATEST 72\.5 kg × 8/);
  assert.match(detail, /Estimated 1RM: 91\.8 kg/);
  assert.match(detail, /ESTIMATED 1RM CHANGE \+3\.6%/);
  assert.doesNotMatch(detail, /60 kg × 12/);
});

test("strength wording says it is a performance estimate, not muscle growth", { skip }, async () => {
  const p = await openProgress({ logs: [log("L1", daysAgo(3), [bench([{ weight: "60", reps: "10" }])])] });

  assert.match(p.page(), /estimated 1RM is a training-performance estimate, not muscle growth/i);
});

test("historical logs are not modified by rendering Progress", { skip }, async () => {
  const logs = [
    log("L1", daysAgo(14), [bench([{ weight: "60", reps: "12" }, { weight: "70", reps: "8" }])]),
    log("L2", daysAgo(7), [bench([{ weight: "72.5", reps: "8" }])])
  ];

  const before = JSON.stringify(logs);

  await openProgress({ logs });

  assert.equal(JSON.stringify(logs), before);
});

test("an exercise logged under an alternative keeps its own strength line", { skip }, async () => {
  const p = await openProgress({
    logs: [
      log("L1", daysAgo(14), [{ exerciseId: "alt:e1:incline-dumbbell-press", name: "Incline Dumbbell Press", sets: [{ weight: "30", reps: "10" }] }]),
      log("L2", daysAgo(7), [{ exerciseId: "alt:e1:incline-dumbbell-press", name: "Incline Dumbbell Press", sets: [{ weight: "32", reps: "10" }] }])
    ]
  });

  assert.match(p.text(p.$("#strength-progress-detail")), /LATEST 32 kg × 10/);
});


test("after an exercise identity change, the old and new exercise are separate strength lines", { skip }, async () => {
  const leg = (id, w) => log(id, daysAgo(id === "L1" ? 21 : 14), [{ exerciseId: "slot-1", name: "Leg Press", sets: [{ weight: w, reps: "10" }] }]);
  const hack = (id, w) => log(id, daysAgo(id === "L3" ? 7 : 1), [{ exerciseId: "slot-NEW", name: "Machine Hack Squat", sets: [{ weight: w, reps: "10" }] }]);

  const p = await openProgress({ logs: [leg("L1", "100"), leg("L2", "110"), hack("L3", "60"), hack("L4", "65")] });

  const names = p.$$("#strength-exercise-select option").map(o => p.text(o));

  assert.deepEqual([...names].sort(), ["Leg Press", "Machine Hack Squat"]);
});

test("exercise names are escaped in Progress (no HTML injection)", { skip }, async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const e = (w) => [{ exerciseId: "slot-x", name: evil, sets: [{ weight: w, reps: "10" }] }];

  const p = await openProgress({ logs: [log("L1", daysAgo(14), e("50")), log("L2", daysAgo(7), e("55"))] });

  assert.equal(p.$$("#progress-content img").length, 0, "the name must be text, never markup");
  assert.match(p.page(), /<img src=x onerror=alert\(1\)>/, "the text itself is still shown");
});

// ---- weekly volume ------------------------------------------------------------------

test("weekly volume is labelled as a volume comparison, never as muscle growth", { skip }, async () => {
  const p = await openProgress({
    logs: [
      log("L1", daysAgo(7), [bench([{ weight: "100", reps: "10" }])]),   // last week: 1000
      log("L2", new Date(), [bench([{ weight: "100", reps: "11" }])])    // this week: 1100
    ]
  });

  const change = p.$("[data-volume-comparison]");

  assert.equal(change.dataset.volumeComparison, "changed");
  assert.match(p.text(change), /\+10\.0% training volume vs last week/);
  assert.doesNotMatch(p.text(change), /muscle|physique|growth/i);
  assert.match(p.page(), /compares the work you did, not muscle growth/);
});

test("volume comparison with no volume last week shows a message, never Infinity/NaN", { skip }, async () => {
  const p = await openProgress({ logs: [log("L1", new Date(), [bench([{ weight: "100", reps: "10" }])])] });

  assert.equal(p.$("[data-volume-comparison]").dataset.volumeComparison, "no-previous");
  assert.match(p.text(p.$("[data-volume-comparison]")), /No volume logged last week/);
  assert.doesNotMatch(p.page(), /Infinity|NaN|undefined|null/);
});

test("a decrease is shown as a negative number", { skip }, async () => {
  const p = await openProgress({
    logs: [
      log("L1", daysAgo(7), [bench([{ weight: "100", reps: "10" }])]),
      log("L2", new Date(), [bench([{ weight: "100", reps: "5" }])])
    ]
  });

  assert.match(p.text(p.$("[data-volume-comparison]")), /-50\.0% training volume vs last week/);
});


// ---- empty / zero history ------------------------------------------------------------------

test("a brand-new account renders every panel without errors or NaN", { skip }, async () => {
  const p = await openProgress();

  assert.ok(p.$("#progress-content").children.length > 0);
  assert.equal(p.$("[data-volume-comparison]").dataset.volumeComparison, "no-data");
  assert.match(p.text(p.$("[data-volume-comparison]")), /No volume logged this week or last week/);
  assert.equal(p.$$("[data-compare]").length, 0, "no comparison cards without data");
  assert.doesNotMatch(p.page(), /Infinity|NaN|undefined|\bnull\b/);
});


// ---- body weight (Weight History is the source) -------------------------------------------------

test("body weight shows previous -> current -> change from Weight History", { skip }, async () => {
  const p = await openProgress({
    weights: [{ weight: 71, date: "2026-09-23" }, { weight: "72.5", date: "2026-09-30" }]
  });

  const card = p.text(p.$('[data-compare="weight"]'));

  assert.match(card, /71 kg → 72\.5 kg \+1\.5 kg/);
  assert.match(card, /not the same as body-composition changes/);
});

test("body weight follows the unit preference (stored kg, shown lb)", { skip }, async () => {
  const p = await openProgress({
    weights: [{ weight: 70, date: "2026-09-23" }, { weight: 72, date: "2026-09-30" }],
    unit: "lb"
  });

  const card = p.text(p.$('[data-compare="weight"]'));

  assert.match(card, /154\.\d lb → 158\.\d lb/);
});

test("a single weigh-in has no change; a weight loss is negative", { skip }, async () => {
  const one = await openProgress({ weights: [{ weight: 80, date: "2026-09-30" }] });

  assert.match(one.text(one.$('[data-compare="weight"]')), /80 kg no previous weigh-in/);

  const loss = await openProgress({ weights: [{ weight: 80, date: "2026-09-01" }, { weight: 78.5, date: "2026-09-30" }] });

  assert.match(loss.text(loss.$('[data-compare="weight"]')), /80 kg → 78\.5 kg −1\.5 kg/);
});

test("Progress has no second weight storage: it only reads Weight History", () => {
  assert.doesNotMatch(SOURCE, /addWeight|saveWeight|setWeight|currentWeight\s*[:=]/);
});


// ---- measurements -----------------------------------------------------------------------------------

test("measurements show previous -> current -> change per site", { skip }, async () => {
  const p = await openProgress({
    measurements: [
      { date: "2026-09-01", chest: 41, waist: 33, arms: 14.5 },
      { date: "2026-08-01", chest: 40, waist: 34, arms: 14 }
    ]
  });

  const card = p.$('[data-compare="measurements"]');

  assert.match(p.text(card.querySelector('[data-site="chest"]')), /Chest 40 → 41 \+1 in/);
  assert.match(p.text(card.querySelector('[data-site="waist"]')), /Waist 34 → 33 -1 in/);
  assert.match(p.text(card.querySelector('[data-site="arms"]')), /Arms 14 → 14\.5 \+0\.5 in/);
  assert.equal(card.querySelector('[data-site="calves"]'), null);
});

test("a single measurement entry is shown without a change", { skip }, async () => {
  const p = await openProgress({ measurements: [{ date: "2026-09-01", chest: 41 }] });

  assert.match(p.text(p.$('[data-site="chest"]')), /Chest — → 41 —/);
});


// ---- NO generic progress bar --------------------------------------------------------------------------

test("no overall progress percentage or progress bar is rendered anywhere", { skip }, async () => {
  const p = await openProgress({
    logs: [
      log("L1", daysAgo(14), [bench([{ weight: "60", reps: "10" }])]),
      log("L2", new Date(), [bench([{ weight: "65", reps: "10" }])])
    ],
    weights: [{ weight: 71, date: "2026-09-23" }, { weight: 72, date: "2026-09-30" }],
    measurements: [{ date: "2026-09-01", chest: 41 }]
  });

  assert.equal(p.$$("progress, meter, [role='progressbar'], [class*='progress-bar'], [class*='progress-fill']").length, 0);
  assert.doesNotMatch(p.page(), /overall progress|body progress|recomposition progress|muscle progress|physique|completion/i);
});
