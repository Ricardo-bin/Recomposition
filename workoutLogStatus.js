// ============================================================================
// RECOMPOSITION — COMPLETED-LOG CHECK (pure, one rule)
// ----------------------------------------------------------------------------
// A log counts as a completed workout when its status is "completed" OR when it
// has no status at all (logs saved before `status` existed). Anything else
// (for example "in-progress") is not a finished workout.
//
// Dashboard, History, Progress and the previous-performance lookup all use this
// one function so they can never disagree about which logs count.
// ============================================================================

export function isCompletedLog(log) {
  return Boolean(log) && (!log.status || log.status === "completed");
}
