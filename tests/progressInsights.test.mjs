// ============================================================================
// Phase 4 pure calculations (progressInsights.js). No DOM, no Firebase.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExerciseProgress, describeGoal, setVolume, strengthSummary,
  trainingConsistency, weeklyVolumes, weightTrend
} from "../progressInsights.js";

const NOW = new Date(2026, 9, 7, 12, 0, 0);                       // Wed 7 Oct 2026
const ago = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d; };
const sets = (...pairs) => pairs.map(([weight, reps]) => ({ weight: String(weight), reps: String(reps) }));
const log = (id, date, exercises) => ({ id, date, exercises });
const ex = (name, s, extra = {}) => ({ name, sets: sets(...s), ...extra });

test("volume counts only sets with a positive weight AND positive reps", () => {
  assert.equal(setVolume({ weight: "60", reps: "10" }), 600);
  for (const bad of [{ weight: "", reps: "10" }, { weight: "0", reps: "10" }, { weight: "60" }, { weight: "x", reps: "5" }, { weight: "-5", reps: "5" }, null]) {
    assert.equal(setVolume(bad), 0);
  }
});

test("consistency: empty, duplicate ids and undated logs never produce NaN", () => {
  const empty = trainingConsistency([], NOW);
  assert.equal(empty.totalWorkouts, 0);
  assert.equal(empty.averagePerWeek, null);
  assert.equal(empty.weekStreak, 0);

  const c = trainingConsistency([
    log("a", ago(1), [ex("Bench", [[60, 10]])]),
    log("a", ago(1), [ex("Bench", [[60, 10]])]),                  // duplicate
    log("b", "not a date", [ex("Bench", [[60, 10]])])             // counts in totals only
  ], NOW);

  assert.equal(c.totalWorkouts, 2);
  assert.equal(c.last7Days, 1);
  assert.ok(Number.isFinite(c.averagePerWeek));
});

test("week streak: the current empty week does not break it; a gap does", () => {
  // Wed 7 Oct. Last week (Mon 28 Sep - Sun 4 Oct) and the week before have workouts; this week none yet.
  const running = trainingConsistency([log("a", ago(5), []), log("b", ago(12), [])], NOW);
  assert.equal(running.weekStreak, 2);

  const gap = trainingConsistency([log("a", ago(5), []), log("b", ago(19), [])], NOW);
  assert.equal(gap.weekStreak, 1);
});

test("weekly volumes: this week vs last week by Monday boundaries", () => {
  const weeks = weeklyVolumes([
    log("a", ago(0), [ex("Bench", [[100, 10]])]),                 // Wed this week
    log("b", ago(3), [ex("Bench", [[100, 5]])]),                  // Sun last week
    log("c", ago(9), [ex("Bench", [[100, 1]])])                   // Mon 28 Sep = last week
  ], NOW, 4);

  assert.equal(weeks[0].volume, 1000);
  assert.equal(weeks[1].volume, 600);
});

test("exercise identity: Alternative Today is its own exercise, never the planned one", () => {
  const list = buildExerciseProgress([
    log("a", ago(14), [ex("Barbell Bench Press", [[80, 8]], { libraryExerciseId: "barbell-bench-press" })]),
    log("b", ago(7), [ex("Dumbbell Bench Press", [[30, 10]], {
      libraryExerciseId: "dumbbell-bench-press", plannedName: "Barbell Bench Press",
      alternativeToday: { original: { name: "Barbell Bench Press" } }
    })]),
    log("c", ago(1), [ex("Barbell Bench Press", [[82.5, 8]], { libraryExerciseId: "barbell-bench-press" })])
  ], NOW);

  const barbell = list.find(i => i.key === "lib:barbell-bench-press");
  const dumbbell = list.find(i => i.key === "lib:dumbbell-bench-press");

  assert.equal(barbell.sessionCount, 2);
  assert.equal(dumbbell.sessionCount, 1);
  assert.equal(dumbbell.alternativeSessions, 1);
  assert.equal(dumbbell.previous, null);
});

test("exercise identity: libraryExerciseId beats a changed display name; legacy falls back to name", () => {
  const list = buildExerciseProgress([
    log("a", ago(14), [ex("Bench Press", [[60, 10]], { libraryExerciseId: "bp" })]),
    log("b", ago(7), [ex("Flat Bench", [[62.5, 10]], { libraryExerciseId: "bp" })]),
    log("c", ago(3), [ex("Row", [[50, 10]])]),
    log("d", ago(2), [ex("row ", [[52.5, 10]])])
  ], NOW);

  assert.equal(list.find(i => i.key === "lib:bp").sessionCount, 2);
  assert.equal(list.find(i => i.key === "name:row").sessionCount, 2);
});

test("estimated 1RM change and PR rules", () => {
  const [bench] = buildExerciseProgress([
    log("a", ago(21), [ex("Bench", [[60, 12], [70, 8]])]),        // best e1RM 88.7 (not 60x12 = 84)
    log("b", ago(14), [ex("Bench", [[60, 5]])]),                  // lower: not a PR
    log("c", ago(7), [ex("Bench", [[72.5, 8]])])                  // 91.8: PR
  ], NOW);

  assert.equal(bench.sessionCount, 3);
  assert.equal(bench.prCount, 1, "the first session is a baseline, never a PR");
  assert.equal(bench.isRecentPr, true);
  assert.ok(Math.abs(bench.best.best.estimatedOneRepMax - 91.8333) < 0.01);
  // previous session is the 60x5 one (e1RM 70)
  assert.ok(bench.changeKg > 0);
  assert.equal(strengthSummary([bench]).recentPrs, 1);
});

test("bodyweight/blank exercises and a single session are handled honestly", () => {
  const list = buildExerciseProgress([
    log("a", ago(7), [ex("Pull-up", [[0, 10]]), ex("Curl", [["", 10]]), ex("Squat", [[100, 5]])])
  ], NOW);

  assert.deepEqual(list.map(i => i.name), ["Squat"]);
  assert.equal(list[0].previous, null);
  assert.equal(list[0].changeKg, null);
  assert.equal(list[0].isRecentPr, false);
});

test("weight trend: windowed, single entry, and no earlier entry", () => {
  assert.equal(weightTrend([]).status, "none");
  assert.equal(weightTrend([{ weight: 80, date: "2026-10-01" }]).status, "single");

  const ok = weightTrend([
    { weight: "79.2", date: "2026-09-10" },
    { weight: 80, date: "2026-10-01" }
  ]);
  assert.equal(ok.status, "ok");
  assert.equal(ok.days, 21);
  assert.ok(Math.abs(ok.change - 0.8) < 1e-9);

  assert.equal(weightTrend([{ weight: 75, date: "2026-05-01" }, { weight: 80, date: "2026-10-01" }]).status, "insufficient");
});

test("goal context carries a label and targets only, never a percentage", () => {
  assert.equal(describeGoal(null), null);
  assert.deepEqual(describeGoal({ goalType: "Lean Bulk", calories: 2800, protein: "" }), { label: "Lean Bulk", calories: 2800, protein: null });
  assert.equal(describeGoal({}).label, "Custom");
});
