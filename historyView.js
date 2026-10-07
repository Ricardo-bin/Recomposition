// ============================================================================
// RECOMPOSITION — HISTORY VIEW LOGIC (pure: no DOM, no Firebase, no storage)
// ----------------------------------------------------------------------------
// WORKOUT LOGS are the only source of truth. This module never stores anything;
// it only READS log objects (the same objects History already loads) and works
// out what to show: card summaries, search, filters, the detail view model and
// the previous-session comparison.
//
// Reused, not re-implemented:
//   - best set / estimated 1RM   progressMetrics.js (Progress's definitions)
//   - "previous session" lookup  data/recompositionData.js findPreviousLogs
//   - completed-log rule         workoutLogStatus.js (applied by history.js)
// ============================================================================

import { getBestSet } from "./progressMetrics.js";

// ----------------------------------------------------------------------------
// DATES
// ----------------------------------------------------------------------------

// Firestore Timestamp | Date | ISO string | number  ->  Date, or null.
export function toDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

// Local calendar day as YYYY-MM-DD (same format as the app's date inputs).
export function dateKey(date) {
  return date.toLocaleDateString("en-CA");
}

const toMillis = value => toDate(value)?.getTime() ?? null;

// ----------------------------------------------------------------------------
// NAMES / IDENTITY
// ----------------------------------------------------------------------------

export function logName(log) {
  return log?.planName || log?.workoutName || "Workout Session";
}

export function exerciseName(exercise) {
  return exercise?.name || exercise?.exerciseName || "Exercise";
}

// The Alternative Today marker written by buildLogSession (alternativeToday.js):
//   name / exerciseId       what was PERFORMED
//   plannedName             what the plan said
export function plannedInfo(exercise) {
  const plannedName =
    exercise?.plannedName ||
    exercise?.alternativeToday?.original?.name ||
    "";

  return {
    isAlternative: Boolean(plannedName || exercise?.alternativeToday),
    plannedName
  };
}

// Stable identity for the "By exercise" filter. Library link when there is one,
// otherwise the normalised name. (Not the plan slot id: after an exercise
// change a slot id can mean two different exercises across old and new logs.)
export function exerciseKey(exercise) {
  const libraryId = exercise?.libraryExerciseId;

  return typeof libraryId === "string" && libraryId
    ? `lib:${libraryId}`
    : `name:${exerciseName(exercise).trim().toLowerCase()}`;
}

const exercisesOf = log => (Array.isArray(log?.exercises) ? log.exercises : []);
const setsOf = exercise => (Array.isArray(exercise?.sets) ? exercise.sets : []);

// ----------------------------------------------------------------------------
// CARD SUMMARY
// ----------------------------------------------------------------------------

// A set counts when weight or reps was entered (same rule History always used).
export function isLoggedSet(set) {
  return String(set?.weight ?? "") !== "" || String(set?.reps ?? "") !== "";
}

// True when the log was changed after it was saved. Logs are written with
// updatedAt == createdAt; History's edit moves updatedAt forward.
export function isEditedLog(log) {
  const created = toMillis(log?.createdAt);
  const updated = toMillis(log?.updatedAt);

  return created !== null && updated !== null && updated - created > 2000;
}

export function summarizeLog(log) {
  const exercises = exercisesOf(log);
  const loggedSets = exercises.flatMap(exercise => setsOf(exercise).filter(isLoggedSet));

  const volume = Math.round(
    loggedSets.reduce(
      (total, set) => total + (Number(set.weight) || 0) * (Number(set.reps) || 0),
      0
    )
  );

  return {
    name: logName(log),
    date: toDate(log?.date),
    exerciseCount: exercises.length,
    setCount: loggedSets.length,
    volume,
    hasAlternative: exercises.some(exercise => plannedInfo(exercise).isAlternative),
    isEdited: isEditedLog(log)
  };
}

// ----------------------------------------------------------------------------
// SEARCH + FILTERS
// ----------------------------------------------------------------------------

export const DATE_RANGES = Object.freeze([
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" }
]);

export const DEFAULT_CRITERIA = Object.freeze({
  search: "",
  sort: "newest",
  plan: "all",
  exercise: "all",
  range: "all",
  from: "",
  to: ""
});

// The first calendar day (YYYY-MM-DD) a "last N days" range includes: today and
// the N-1 days before it. null for "all" / "custom".
export function rangeStartKey(range, now = new Date()) {
  const days = Number(range);

  if (!Number.isInteger(days) || days <= 0) {
    return null;
  }

  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));

  return dateKey(start);
}

function inDateRange(log, criteria, now) {
  const range = criteria.range ?? "all";

  if (range === "all") {
    return true;
  }

  const date = toDate(log?.date);

  if (!date) {
    return false;           // an undated log cannot be placed in a date range
  }

  const key = dateKey(date);

  if (range === "custom") {
    let from = criteria.from || "";
    let to = criteria.to || "";

    if (from && to && from > to) {
      [from, to] = [to, from];
    }

    return (!from || key >= from) && (!to || key <= to);
  }

  const start = rangeStartKey(range, now);

  return start === null || key >= start;
}

function matchesSearch(log, search) {
  const tokens = String(search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  // Workout name + performed exercise names + the PLANNED name of any
  // Alternative Today exercise (people remember "bench day").
  const haystack = [
    logName(log),
    ...exercisesOf(log).flatMap(exercise => [
      exerciseName(exercise),
      plannedInfo(exercise).plannedName
    ])
  ].join(" ").toLowerCase();

  return tokens.every(token => haystack.includes(token));
}

export function hasActiveFilters(criteria = {}) {
  return (
    (criteria.plan ?? "all") !== "all" ||
    (criteria.exercise ?? "all") !== "all" ||
    (criteria.range ?? "all") !== "all"
  );
}

// Returns a NEW array; the input is never changed.
export function filterLogs(logs, criteria = {}, now = new Date()) {
  const c = { ...DEFAULT_CRITERIA, ...criteria };

  const result = (Array.isArray(logs) ? logs : []).filter(log => {
    if (!log) {
      return false;
    }

    if (c.plan !== "all" && logName(log) !== c.plan) {
      return false;
    }

    if (c.exercise !== "all" && !exercisesOf(log).some(exercise => exerciseKey(exercise) === c.exercise)) {
      return false;
    }

    return inDateRange(log, c, now) && matchesSearch(log, c.search);
  });

  const direction = c.sort === "oldest" ? 1 : -1;

  // Undated logs always go last, whichever way the list is sorted.
  return result.sort((a, b) => {
    const left = toMillis(a.date);
    const right = toMillis(b.date);

    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    return (left - right) * direction;
  });
}

export function planOptions(logs) {
  return [...new Set((Array.isArray(logs) ? logs : []).map(logName))].sort((a, b) => a.localeCompare(b));
}

// -> [{ key, label }], one per distinct exercise performed in the loaded logs.
export function exerciseOptions(logs) {
  const seen = new Map();

  for (const log of Array.isArray(logs) ? logs : []) {
    for (const exercise of exercisesOf(log)) {
      const key = exerciseKey(exercise);

      if (!seen.has(key)) {
        seen.set(key, exerciseName(exercise));
      }
    }
  }

  return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ----------------------------------------------------------------------------
// DETAIL VIEW MODEL
// ----------------------------------------------------------------------------

const hasValue = value => value !== undefined && value !== null && value !== "";

// "3 × 8–12", "3 sets" or "8–12 reps" - only what the log actually stored;
// "" for older logs that stored no target.
export function formatTarget(exercise) {
  const { targetSets, repMin, repMax } = exercise ?? {};

  let reps = "";

  if (hasValue(repMin) && hasValue(repMax)) {
    reps = String(repMin) === String(repMax) ? String(repMin) : `${repMin}–${repMax}`;
  } else if (hasValue(repMin) || hasValue(repMax)) {
    reps = String(hasValue(repMin) ? repMin : repMax);
  }

  if (hasValue(targetSets) && reps) return `${targetSets} × ${reps}`;
  if (hasValue(targetSets)) return `${targetSets} sets`;
  if (reps) return `${reps} reps`;

  return "";
}

export function describeExercise(exercise) {
  const alternative = plannedInfo(exercise);
  const sets = setsOf(exercise);

  // Plans store targetRIR; older logs may use targetRir.
  const targetRir = exercise?.targetRIR ?? exercise?.targetRir;
  const best = getBestSet(sets);

  return {
    name: exerciseName(exercise),
    isAlternative: alternative.isAlternative,
    plannedName: alternative.plannedName,
    target: formatTarget(exercise),
    targetRir: hasValue(targetRir) ? String(targetRir) : "",
    notes: typeof exercise?.notes === "string" ? exercise.notes.trim() : "",
    sets: sets.map((set, index) => ({
      number: index + 1,
      weight: hasValue(set?.weight) ? String(set.weight) : "",
      reps: hasValue(set?.reps) ? String(set.reps) : "",
      rir: hasValue(set?.rir) ? String(set.rir) : ""
    })),
    best
  };
}

// The same exercise inside a previous log (found by the exact performed id).
export function previousExercise(previousLog, exerciseId) {
  return exercisesOf(previousLog).find(exercise => exercise?.exerciseId === exerciseId) ?? null;
}

// Rows for a CURRENT | PREVIOUS table; the shorter side is padded with null.
export function alignSets(current, previous) {
  const left = Array.isArray(current) ? current : [];
  const right = Array.isArray(previous) ? previous : [];
  const length = Math.max(left.length, right.length);

  return Array.from({ length }, (_, index) => ({
    number: index + 1,
    current: left[index] ?? null,
    previous: right[index] ?? null
  }));
}

// ----------------------------------------------------------------------------
// PENDING WORKOUTS (display only)
// ----------------------------------------------------------------------------

// Turns pending-queue items into display logs for the PENDING SYNC section.
// They are flagged isPending and are NEVER part of the cloud history list. An
// item whose id already exists in the cloud logs (it synced a moment ago) is
// dropped so a workout is never shown twice.
export function pendingDisplayLogs(pendingItems, cloudLogs) {
  const synced = new Set((Array.isArray(cloudLogs) ? cloudLogs : []).map(log => log?.id));

  return (Array.isArray(pendingItems) ? pendingItems : [])
    .filter(item => item && typeof item.id === "string" && item.log && !synced.has(item.id))
    .map(item => ({
      ...item.log,
      id: item.id,
      isPending: true,
      pendingAttempts: item.attempts ?? 0
    }));
}

// ----------------------------------------------------------------------------
// EDITING (pure part)
// ----------------------------------------------------------------------------

// Returns NEW exercises where ONLY weight / reps / rir of existing sets changed.
// Identity (exerciseId, name, libraryExerciseId, Alternative Today fields,
// targets) is carried over untouched. `edits[exerciseIndex][setIndex]` is
// { weight, reps, rir }; anything not edited is kept as it was.
export function applySetEdits(exercises, edits) {
  return (Array.isArray(exercises) ? exercises : []).map((exercise, exerciseIndex) => ({
    ...exercise,
    sets: setsOf(exercise).map((set, setIndex) => {
      const edit = edits?.[exerciseIndex]?.[setIndex];

      return edit
        ? { ...set, weight: edit.weight ?? "", reps: edit.reps ?? "", rir: edit.rir ?? "" }
        : set;
    })
  }));
}
