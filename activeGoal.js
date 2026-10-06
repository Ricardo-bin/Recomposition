// ============================================================================
// RECOMPOSITION — CURRENT NUTRITION TARGET (pure)
// ----------------------------------------------------------------------------
// Several goals can exist. The CURRENT one is the goal whose period contains
// today (an empty start/end date means "open"); if several do, the one that
// started most recently. This is the same rule the Dashboard has always used
// (dashboard.js findActiveGoal), so Goals can now show which target the
// Dashboard is reading. Dates only choose the current goal. They never produce
// a completion percentage.
// ============================================================================

export function findActiveGoal(goals, today) {
  return (Array.isArray(goals) ? goals : [])
    .filter(goal =>
      (!goal.startDate || goal.startDate <= today) &&
      (!goal.endDate || goal.endDate >= today)
    )
    .sort((a, b) =>
      String(b.startDate || "").localeCompare(String(a.startDate || ""))
    )[0] || null;
}

// Local calendar day as YYYY-MM-DD (same format as the date inputs).
export function todayKey(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}
