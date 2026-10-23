// ============================================================================
// RECOMPOSITION — PREVIOUS SESSION SELECTION (pure: no DOM, no Firebase)
// ----------------------------------------------------------------------------
// "Previous Session" for an exercise = the NEWEST earlier, COMPLETED workout
// that holds a COMPLETED performance of the SAME UNDERLYING EXERCISE - whatever
// the workout was called, which plan it belonged to, or which day/split it was.
//
//   identity     historyView.sameExercise (library id, else name). NOT the plan
//                slot id and NOT the plan id: both differ between, say, an
//                Upper plan and a Pull plan that contain the same exercise.
//   Alternative  a log stores the PERFORMED exercise's name/libraryExerciseId,
//   Today        so an alternative has the timeline of what was really done
//                and never borrows (or pollutes) the planned exercise's.
//   order        sorted here by date (newest first). The order the records
//                arrive in is never trusted.
//
// Nothing is written, merged or rewritten: this only CHOOSES among records.
// ============================================================================

import { isCompletedLog } from "./workoutLogStatus.js";
import { sameExercise } from "./historyView.js";

const exercisesOf = log => (Array.isArray(log?.exercises) ? log.exercises : []);
const setsOf = exercise => (Array.isArray(exercise?.sets) ? exercise.sets : []);

const present = value => value !== "" && value !== null && value !== undefined;

// A performed set has BOTH weight and reps. Weight 0 counts (bodyweight work).
export const hasCompletedSet = set => present(set?.weight) && present(set?.reps);

// Only an exercise with at least one performed set is a performance. A blank,
// unsaved or skipped entry can never become "the previous session".
export const isEligiblePerformance = exercise => setsOf(exercise).some(hasCompletedSet);

const toMillis = value => {
  if (value === null || value === undefined || value === "") return null;

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  const time = date.getTime();

  return Number.isNaN(time) ? null : time;
};

// The eligible matching exercise inside ONE log (the first, in log order).
export function previousExerciseIn(log, exercise) {
  return (
    exercisesOf(log).find(
      item => sameExercise(item, exercise) && isEligiblePerformance(item)
    ) ?? null
  );
}

// Every earlier eligible performance of `exercise`, newest first:
//   [{ log, exercise }]
// beforeDate    only logs strictly older than this (the session being viewed)
// excludeLogId  never a log's own previous
export function findPreviousSessions(logs, exercise, beforeDate = null, { excludeLogId = null } = {}) {
  const cutoff = toMillis(beforeDate);

  return (Array.isArray(logs) ? logs : [])
    .filter(log => {
      if (!isCompletedLog(log)) return false;
      if (excludeLogId !== null && log.id === excludeLogId) return false;

      const time = toMillis(log.date);

      // A log with no usable date cannot be placed in time, so it is only kept
      // when no cutoff applies (same as before).
      if (cutoff !== null && (time === null || time >= cutoff)) return false;

      return true;
    })
    .map(log => ({ log, exercise: previousExerciseIn(log, exercise) }))
    .filter(match => match.exercise !== null)
    .sort((a, b) => {
      const timeA = toMillis(a.log.date) ?? -Infinity;
      const timeB = toMillis(b.log.date) ?? -Infinity;

      if (timeA !== timeB) return timeB - timeA;

      // Same moment: the later-saved record, then a stable id order.
      const createdA = toMillis(a.log.createdAt) ?? -Infinity;
      const createdB = toMillis(b.log.createdAt) ?? -Infinity;

      if (createdA !== createdB) return createdB - createdA;

      return String(b.log.id ?? "").localeCompare(String(a.log.id ?? ""));
    });
}

// The single previous session, or null.
export function selectPreviousSession(logs, exercise, beforeDate = null, options = {}) {
  return findPreviousSessions(logs, exercise, beforeDate, options)[0] ?? null;
}
