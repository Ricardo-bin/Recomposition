// ============================================================================
// RECOMPOSITION — PROGRESS INSIGHTS (pure: no DOM, no Firebase, no storage)
// ----------------------------------------------------------------------------
// Phase 4. Everything here is DERIVED at render time from data that already
// exists. Nothing is stored and nothing is written.
//
//   Workout logs   -> consistency, volume, strength progression, PRs
//   Weight History -> body-weight trend
//   Goals          -> label of the current goal (shown as context only)
//
// Reused, not re-implemented:
//   estimated 1RM / best set   progressMetrics.js (Epley; best = highest e1RM)
//   volume comparison          progressMetrics.js compareVolume
//   exercise identity          historyView.js exerciseKey (libraryExerciseId,
//                              else normalised name - same as History's filter)
//   Alternative Today          a log stores the PERFORMED exercise's name and
//                              libraryExerciseId, so it is attributed to what
//                              was actually done, never to the planned one
//
// There is no overall / body / goal "progress percentage" here, by design.
// ============================================================================

import { estimateOneRepMax, getBestSet } from "./progressMetrics.js";

import {
  toDate,
  dateKey,
  exerciseKey,
  exerciseName,
  plannedInfo,
  isLoggedSet
} from "./historyView.js";

const DAY_MS = 86400000;

const toNumber = value => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};

const exercisesOf = log => (Array.isArray(log?.exercises) ? log.exercises : []);
const setsOf = exercise => (Array.isArray(exercise?.sets) ? exercise.sets : []);


// ----------------------------------------------------------------------------
// DATES
// ----------------------------------------------------------------------------

function midnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);

  return d;
}

// Monday 00:00 (local) of the week containing `date`.
export function startOfWeek(date) {
  const d = midnight(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));

  return d;
}

// Whole calendar days from a to b (DST-safe: compares calendar days).
function dayDiff(a, b) {
  return Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS);
}


// ----------------------------------------------------------------------------
// LOG PREPARATION
// ----------------------------------------------------------------------------

// Completed logs only come in (progress.js applies isCompletedLog). Here we
// drop duplicates (same id) and attach a parsed date. A log with an unreadable
// date is kept with date = null: it still counts in all-time totals but can
// never be placed in a week or a window.
export function prepareLogs(logs) {
  const seen = new Set();
  const result = [];

  for (const log of Array.isArray(logs) ? logs : []) {
    if (!log || typeof log !== "object") {
      continue;
    }

    if (typeof log.id === "string" && log.id) {
      if (seen.has(log.id)) {
        continue;
      }

      seen.add(log.id);
    }

    result.push({ log, date: toDate(log.date), index: result.length });
  }

  return result;
}

// Dated, not in the future.
function placed(prepared, now) {
  const end = addDays(midnight(now), 1);

  return prepared.filter(item => item.date && item.date < end);
}


// ----------------------------------------------------------------------------
// VOLUME  (volume = sum of weight x reps; the app's one definition)
// ----------------------------------------------------------------------------

// A set adds volume only with a positive weight AND positive reps. Blank,
// text, zero (bodyweight) and negative values add nothing - never NaN.
export function setVolume(set) {
  const weight = toNumber(set?.weight);
  const reps = toNumber(set?.reps);

  return weight !== null && reps !== null && weight > 0 && reps > 0 ? weight * reps : 0;
}

export function logVolume(log) {
  return exercisesOf(log).reduce(
    (total, exercise) => total + setsOf(exercise).reduce((sum, set) => sum + setVolume(set), 0),
    0
  );
}

export function logSetCount(log) {
  return exercisesOf(log).reduce(
    (total, exercise) => total + setsOf(exercise).filter(isLoggedSet).length,
    0
  );
}

// Newest week first: [{ start: Date, volume, workouts }], index 0 = this week
// (Monday until now), index 1 = last week, and so on.
export function weeklyVolumes(logs, now = new Date(), weeks = 4) {
  const thisWeek = startOfWeek(now);
  const rows = Array.from({ length: weeks }, (_, i) => ({
    start: addDays(thisWeek, -7 * i),
    volume: 0,
    workouts: 0
  }));

  for (const { log, date } of placed(prepareLogs(logs), now)) {
    // Days before this Monday -> whole weeks back (1 = last week).
    const row = rows[date >= thisWeek ? 0 : Math.ceil(dayDiff(date, thisWeek) / 7)];

    if (row) {
      row.volume += logVolume(log);
      row.workouts += 1;
    }
  }

  return rows;
}


// ----------------------------------------------------------------------------
// TRAINING CONSISTENCY
// ----------------------------------------------------------------------------

// Everything is counted from real completed logs. Average windows never exceed
// the time the person has actually been logging (minimum one week), so a new
// account is not shown a diluted average.
export function trainingConsistency(logs, now = new Date()) {
  const prepared = prepareLogs(logs);
  const dated = placed(prepared, now);
  const today = midnight(now);
  const weekStart = startOfWeek(now);

  const since = days => addDays(today, -(days - 1));
  const count = start => dated.filter(item => item.date >= start).length;

  const totalSets = prepared.reduce((sum, item) => sum + logSetCount(item.log), 0);
  const totalVolume = prepared.reduce((sum, item) => sum + logVolume(item.log), 0);

  const result = {
    totalWorkouts: prepared.length,
    thisWeek: count(weekStart),
    last7Days: count(since(7)),
    last30Days: count(since(30)),
    averagePerWeek: null,
    trainingDaysPerWeek: null,
    weekStreak: 0,
    totalSets,
    totalVolume,
    averageVolume: prepared.length > 0 ? totalVolume / prepared.length : 0
  };

  if (dated.length === 0) {
    return result;
  }

  const first = dated.reduce((min, item) => (item.date < min ? item.date : min), dated[0].date);
  const covered = Math.min(28, Math.max(7, dayDiff(first, today) + 1));
  const weeks = covered / 7;
  const windowStart = since(28);
  const inWindow = dated.filter(item => item.date >= windowStart);

  result.averagePerWeek = inWindow.length / weeks;
  result.trainingDaysPerWeek = new Set(inWindow.map(item => dateKey(item.date))).size / weeks;

  // Week streak: consecutive calendar weeks (Mon-Sun) with at least one
  // workout. The current week may still be empty without breaking it.
  const weeksWithWorkout = new Set(dated.map(item => dateKey(startOfWeek(item.date))));

  let cursor = weekStart;

  if (!weeksWithWorkout.has(dateKey(cursor))) {
    cursor = addDays(cursor, -7);
  }

  while (weeksWithWorkout.has(dateKey(cursor))) {
    result.weekStreak += 1;
    cursor = addDays(cursor, -7);
  }

  return result;
}


// ----------------------------------------------------------------------------
// STRENGTH PROGRESSION BY EXERCISE
// ----------------------------------------------------------------------------

// One entry per performed exercise (identity = exerciseKey). Each entry has one
// SESSION per workout log (several blocks of the same exercise in one log are
// merged). Only sets with a positive weight and positive reps can produce an
// estimated 1RM; an exercise without any (pure bodyweight, blank) is skipped.
//
// Entry: { key, name, sessionCount, sessions (newest first), latest, previous,
//          changeKg, changePercent, best, prCount, recentPrCount, isRecentPr,
//          alternativeSessions }
// Session: { date, logId, best: {weight, reps, volume, estimatedOneRepMax},
//            volume, setCount, isAlternative, plannedName }
export function buildExerciseProgress(logs, now = new Date()) {
  const groups = new Map();
  const recentStart = addDays(midnight(now), -29);

  for (const { log, date, index } of placed(prepareLogs(logs), now)) {
    const perLog = new Map();

    for (const exercise of exercisesOf(log)) {
      const key = exerciseKey(exercise);
      const entry = perLog.get(key) ?? { exercise, sets: [] };

      entry.sets.push(...setsOf(exercise));
      entry.exercise = exercise;
      perLog.set(key, entry);
    }

    for (const [key, { exercise, sets }] of perLog) {
      const best = getBestSet(sets);

      if (!best) {
        continue;
      }

      const alternative = plannedInfo(exercise);
      const group = groups.get(key) ?? { key, sessions: [] };

      group.sessions.push({
        date,
        index,
        name: exerciseName(exercise),
        logId: typeof log.id === "string" ? log.id : null,
        best,
        volume: sets.reduce((sum, set) => sum + setVolume(set), 0),
        setCount: sets.filter(set => estimateOneRepMax(set?.weight, set?.reps) !== null).length,
        isAlternative: alternative.isAlternative,
        plannedName: alternative.plannedName
      });

      groups.set(key, group);
    }
  }

  const result = [];

  for (const group of groups.values()) {
    const ascending = [...group.sessions].sort((a, b) => a.date - b.date || a.index - b.index);

    // A PR = a session whose best estimated 1RM beats every EARLIER session.
    // The first session is only a baseline, never a PR.
    let runningMax = -Infinity;
    let prCount = 0;
    let recentPrCount = 0;
    let best = ascending[0];

    ascending.forEach((session, position) => {
      const value = session.best.estimatedOneRepMax;

      if (position > 0 && value > runningMax + 1e-9) {
        prCount += 1;

        if (session.date >= recentStart) {
          recentPrCount += 1;
        }
      }

      if (value > best.best.estimatedOneRepMax) {
        best = session;
      }

      runningMax = Math.max(runningMax, value);
    });

    const sessions = [...ascending].reverse();
    const latest = sessions[0];
    const previous = sessions[1] ?? null;

    const changeKg = previous
      ? latest.best.estimatedOneRepMax - previous.best.estimatedOneRepMax
      : null;

    const changePercent =
      previous && previous.best.estimatedOneRepMax > 0
        ? (changeKg / previous.best.estimatedOneRepMax) * 100
        : null;

    result.push({
      key: group.key,
      name: latest.name,
      sessionCount: sessions.length,
      sessions,
      latest,
      previous,
      changeKg,
      changePercent,
      best,
      prCount,
      recentPrCount,
      isRecentPr: latest.date >= recentStart && isPr(ascending),
      alternativeSessions: sessions.filter(session => session.isAlternative).length
    });
  }

  // Most recently trained first.
  return result.sort((a, b) => b.latest.date - a.latest.date || a.name.localeCompare(b.name));
}

// True when the newest session beats every earlier one.
function isPr(ascending) {
  if (ascending.length < 2) {
    return false;
  }

  const latest = ascending[ascending.length - 1].best.estimatedOneRepMax;
  const earlier = Math.max(...ascending.slice(0, -1).map(s => s.best.estimatedOneRepMax));

  return latest > earlier + 1e-9;
}

// Overview numbers for the STRENGTH card.
export function strengthSummary(exerciseProgress) {
  const list = Array.isArray(exerciseProgress) ? exerciseProgress : [];
  const comparable = list.filter(item => item.previous);

  return {
    exercisesTracked: list.length,
    exercisesWithProgression: comparable.length,
    improved: comparable.filter(item => item.changeKg > 1e-9).length,
    recentPrs: list.reduce((sum, item) => sum + item.recentPrCount, 0)
  };
}


// ----------------------------------------------------------------------------
// BODY WEIGHT TREND (Weight History only)
// ----------------------------------------------------------------------------

export function formatSpan(days) {
  if (days < 14) {
    return `${days} ${days === 1 ? "day" : "days"}`;
  }

  return `${Math.round(days / 7)} weeks`;
}

// Newest weigh-in vs the earliest earlier weigh-in within the 28 days before it.
//   status "none" | "single" | "insufficient" (no earlier weigh-in in that
//   window) | "ok" -> { change (kg), days, from, to }
// Pure arithmetic on the entries; it never claims what the change is made of.
export function weightTrend(weightHistory) {
  const entries = (Array.isArray(weightHistory) ? weightHistory : [])
    .map(entry => ({ kg: toNumber(entry?.weight), date: toDate(entry?.date) }))
    .filter(entry => entry.kg !== null && entry.kg > 0 && entry.date)
    .sort((a, b) => a.date - b.date);

  if (entries.length === 0) {
    return { status: "none" };
  }

  if (entries.length === 1) {
    return { status: "single" };
  }

  const newest = entries[entries.length - 1];
  const windowStart = newest.date.getTime() - 28 * DAY_MS;

  const earlier = entries
    .slice(0, -1)
    .find(entry => entry.date.getTime() >= windowStart && entry.date.getTime() < newest.date.getTime());

  if (!earlier) {
    return { status: "insufficient" };
  }

  return {
    status: "ok",
    change: newest.kg - earlier.kg,
    days: Math.max(1, Math.round((newest.date.getTime() - earlier.date.getTime()) / DAY_MS)),
    from: earlier.kg,
    to: newest.kg
  };
}


// ----------------------------------------------------------------------------
// GOAL CONTEXT (display only)
// ----------------------------------------------------------------------------

// The goal itself comes from activeGoal.js findActiveGoal. This only prepares
// text. No completion percentage, no calculation of targets.
export function describeGoal(goal) {
  if (!goal) {
    return null;
  }

  const positive = value => {
    const number = toNumber(value);

    return number !== null && number > 0 ? Math.round(number) : null;
  };

  const type = typeof goal.goalType === "string" ? goal.goalType.trim() : "";

  return {
    label: type || "Custom",
    calories: positive(goal.calories),
    protein: positive(goal.protein)
  };
}
