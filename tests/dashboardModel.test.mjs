// ============================================================================
// Phase 6: Dashboard model (pure). No DOM, no Firebase, no browser simulation.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardModel, findNextWorkout, formatDayLabel } from "../dashboardModel.js";

const NOW = new Date(2026, 9, 7, 12, 0, 0);                         // Wednesday 7 Oct 2026 (day 3)
const iso = (daysAgo = 0) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); return d.toISOString(); };

const plan = (id, name, dayOfWeek, extra = {}) => ({ id, name, dayOfWeek, focus: "Push", exercises: [{}, {}], ...extra });
const PLANS = [plan("up", "Upper A", 3), plan("low", "Lower A", 4), plan("pull", "Pull", 6)];
const doneLog = (id, planId, daysAgo = 0, extra = {}) => ({
  id, planId, status: "completed", planName: "Upper A", date: iso(daysAgo),
  exercises: [{ name: "Bench", sets: [{ weight: "60", reps: "10" }, { weight: "60", reps: "8" }] }], ...extra
});
const pendingItem = (id, planId, daysAgo = 0) => ({ id, log: doneLog(id, planId, daysAgo) });

const build = (over = {}) => buildDashboardModel({ plans: PLANS, logs: [], now: NOW, ...over });

// every printable string in the model: never NaN / undefined / null / Infinity
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach(v => strings(v, out));
  return out;
}

const assertPrintable = model => {
  for (const text of strings(model)) assert.doesNotMatch(text, /NaN|undefined|\bnull\b|Infinity/, text);
};

test("no plans is NOT a rest day", () => {
  const m = build({ plans: [] });

  assert.equal(m.today.variant, "no-plans");
  assert.doesNotMatch(m.today.subtitle, /rest/i);
});

test("rest day: plans exist, none today; shows the next scheduled workout", () => {
  const m = build({ plans: [plan("low", "Lower A", 4), plan("pull", "Pull", 6)] });

  assert.equal(m.today.variant, "rest");
  assert.deepEqual(m.today.next, { dayName: "Thursday", planName: "Lower A", extraCount: 0 });
  assert.equal(findNextWorkout([plan("a", "A", 7), plan("b", "B", 7)], NOW).extraCount, 1);
  assert.equal(findNextWorkout([plan("a", "A", null)], NOW), null, "unscheduled plans are not 'next'");
  assert.equal(build({ plans: [plan("a", "A", null)] }).today.next, null);
});

test("scheduled workout today", () => {
  const m = build();

  assert.equal(m.today.variant, "scheduled");
  assert.equal(m.today.items.length, 1);
  assert.equal(m.today.items[0].name, "Upper A");
  assert.equal(m.today.items[0].exerciseCount, 2);
  assert.equal(m.today.items[0].done, false);
});

test("several workouts today: finished ones are marked, the rest can still be started", () => {
  const plans = [plan("a", "Upper A", 3), plan("b", "Cardio", 3)];
  const m = build({ plans, logs: [doneLog("L1", "a")] });

  assert.equal(m.today.variant, "scheduled");
  assert.deepEqual(m.today.items.map(i => [i.name, i.done]), [["Upper A", true], ["Cardio", false]]);
  assert.equal(build({ plans, logs: [doneLog("L1", "a"), doneLog("L2", "b")] }).today.variant, "done");
});

test("completed today: 'done' with the log to open in History", () => {
  const m = build({ logs: [doneLog("L1", "up")] });

  assert.equal(m.today.variant, "done");
  assert.equal(m.today.logId, "L1");
  assert.equal(m.today.anyPending, false);
  assert.equal(build({ logs: [doneLog("L1", "up", 1)] }).today.variant, "scheduled", "yesterday's log does not count today");
  assert.equal(build({ logs: [doneLog("L1", "up", 0, { status: "in-progress" })] }).today.variant, "scheduled", "unfinished logs do not count");
});

test("active workout replaces START with RESUME", () => {
  const m = build({ activeSession: { planId: "up", name: "Upper A", setsLogged: 3 } });

  assert.equal(m.today.variant, "active");
  assert.equal(m.today.planId, "up");
  assert.equal(m.today.detail, "3 sets logged");
  assert.equal(build({ activeSession: { planId: "up", name: "", setsLogged: 1 } }).today.detail, "1 set logged");
  assert.equal(build({ activeSession: { planId: null, name: "", setsLogged: "x" } }).today.setsLogged, 0);
  assert.equal(build({ plans: [], activeSession: { planId: "up", name: "A", setsLogged: 0 } }).today.variant, "active");
});

test("pending offline workout: done today, counted in the week, sync strip text", () => {
  const m = build({ pendingItems: [pendingItem("w1", "up")] });

  assert.equal(m.today.variant, "done");
  assert.equal(m.today.anyPending, true);
  assert.equal(m.today.logId, "w1");
  assert.equal(m.sync.pendingCount, 1);
  assert.equal(m.sync.text, "1 workout saved on this device, waiting to sync");
  assert.equal(m.recent[0].isPending, true);
  assert.equal(build({ pendingItems: [pendingItem("w1", "up"), pendingItem("w2", "low", 2)] }).sync.text, "2 workouts saved on this device, waiting to sync");
  assert.equal(build().sync.pendingCount, 0);
  assert.equal(build().sync.text, "");
});

test("week summary: 'X workouts · Y planned days'; pending counts; no ratio; may exceed planned days", () => {
  assert.equal(build().week.text, "No workouts yet this week · 3 planned days");

  const m = build({
    logs: [doneLog("L1", "up", 1), doneLog("L2", "low", 2)],        // Tue + Mon this week
    pendingItems: [pendingItem("w1", "up")]                         // today, not synced yet
  });

  assert.equal(m.week.workouts, 3);
  assert.equal(m.week.text, "3 workouts · 3 planned days");
  assert.doesNotMatch(m.week.text, /\//);

  const many = build({ plans: [plan("a", "A", 1)], logs: [doneLog("L1", "a", 0), doneLog("L2", "a", 1), doneLog("L3", "a", 2)] });
  assert.equal(many.week.text, "3 workouts · 1 planned day");

  assert.equal(build({ logs: [doneLog("L1", "up", 9)] }).week.workouts, 0, "last week is not this week");
  assert.equal(build({ plans: [] }).week.text, "No workouts yet this week");
});

test("an already-synced pending item is not counted twice", () => {
  const m = build({ logs: [doneLog("w1", "up")], pendingItems: [pendingItem("w1", "up")] });

  assert.equal(m.sync.pendingCount, 0);
  assert.equal(m.week.workouts, 1);
});

test("weight: none, legacy profile fallback, history with change", () => {
  assert.deepEqual(build().weight, { state: "none", valueKg: null, changeKg: null, dateText: "" });

  const legacy = build({ currentWeight: { weightKg: 72.5, source: "profile", date: null } });
  assert.equal(legacy.weight.state, "legacy");
  assert.equal(legacy.weight.changeKg, null);

  const history = [{ weight: 72.5, date: "2026-10-03" }, { weight: "72", date: "2026-09-26" }];
  const m = build({ currentWeight: { weightKg: 72.5, source: "weight-history", date: "2026-10-03" }, weightHistory: history });

  assert.equal(m.weight.state, "history");
  assert.equal(m.weight.valueKg, 72.5);
  assert.equal(m.weight.changeKg, 0.5);
  assert.equal(m.weight.dateText, "03 Oct 2026");

  const single = build({ currentWeight: { weightKg: 80, source: "weight-history", date: "2026-10-03" }, weightHistory: [{ weight: 80, date: "2026-10-03" }] });
  assert.equal(single.weight.changeKg, null);

  const mismatch = build({ currentWeight: { weightKg: 99, source: "weight-history", date: "2026-10-03" }, weightHistory: history });
  assert.equal(mismatch.weight.changeKg, null, "no change is shown unless it is the same weigh-in the shared resolver chose");
  assert.equal(build({ currentWeight: { weightKg: -3, source: "profile" } }).weight.state, "none");
});

test("nutrition: no goal, goal without targets, valid goal (saved numbers only)", () => {
  assert.equal(build().nutrition.state, "no-goal");

  const empty = build({ activeGoal: { goalType: "Cut", calories: "", protein: null } });
  assert.deepEqual([empty.nutrition.state, empty.nutrition.goalName], ["no-targets", "Cut"]);
  assert.equal(build({ activeGoal: { goalType: "Cut", calories: 0, protein: -5 } }).nutrition.state, "no-targets");

  const ok = build({ activeGoal: { goalType: "Lean Bulk", calories: "2850", protein: 145.4, carbs: 420, fat: 65 } });
  assert.deepEqual(ok.nutrition, { state: "ok", goalName: "Lean Bulk", calories: 2850, protein: 145 });
  assert.equal("carbs" in ok.nutrition, false, "carbs and fat stay in Goals");

  const partial = build({ activeGoal: { goalType: "", calories: 2400 } });
  assert.deepEqual([partial.nutrition.goalName, partial.nutrition.calories, partial.nutrition.protein], ["Custom", 2400, null]);
});

test("profile nudge only when the profile is incomplete", () => {
  const full = { name: "Sam", age: 30, height: 178, sex: "Male", activityLevel: "Moderately active" };

  assert.equal(build({ profile: full }).profileNudge, null);
  assert.deepEqual(build({ profile: { ...full, height: "", sex: " " } }).profileNudge, { missing: ["height", "sex"] });
  assert.equal(build({ profile: null }).profileNudge.missing.length, 4);
  assert.equal(build({ profile: full }).name, "Sam");
  assert.equal(build({ profile: null }).name, "Athlete");
});

test("recent training: last 3, newest first, shared naming, Alternative Today flagged", () => {
  const alt = doneLog("L4", "low", 1, { exercises: [{ name: "Dumbbell Press", plannedName: "Bench Press", sets: [{ weight: "30", reps: "10" }] }] });
  const m = build({ logs: [doneLog("L1", "up", 5), doneLog("L2", "up", 3), doneLog("L3", "up", 2), alt] });

  assert.deepEqual(m.recent.map(r => r.id), ["L4", "L3", "L2"]);
  assert.equal(m.recent[0].hasAlternative, true);
  assert.equal(m.recent[1].hasAlternative, false);
  assert.equal(m.recent[0].dateLabel, "Yesterday");
  assert.equal(m.recent[1].setCount, 2);
  assert.equal(build({ logs: [{ id: "x", planId: "up", status: "completed", workoutName: "Old name", date: iso(1) }] }).recent[0].name, "Old name");
});

test("malformed and missing optional data never breaks the model or prints NaN/undefined/null", () => {
  const junk = buildDashboardModel({
    profile: "oops", plans: [null, 5, { id: "", name: "x" }, { id: "p", dayOfWeek: "abc", exercises: "no" }, { id: 7, name: "  ", dayOfWeek: 99 }],
    logs: [null, {}, { id: "a", status: "completed", date: "not a date", exercises: "bad" }, { id: "b", planId: "p", date: null }],
    pendingItems: "nope", currentWeight: { weightKg: "x", source: "weight-history" }, weightHistory: "bad",
    activeGoal: "goal", activeSession: 5, now: NOW
  });

  assert.equal(junk.today.variant, "rest");
  assert.equal(junk.sync.pendingCount, 0);
  assert.equal(junk.weight.state, "none");
  assertPrintable(junk);
  assertPrintable(buildDashboardModel());
  assertPrintable(build({ pendingItems: [pendingItem("w1", "up")], activeGoal: { goalType: "Cut", calories: 2500, protein: 150 }, currentWeight: { weightKg: 70, source: "weight-history", date: "bad" }, weightHistory: [{ weight: 70, date: "bad" }] }));
  assert.equal(formatDayLabel(null, NOW), "Date unknown");
});
