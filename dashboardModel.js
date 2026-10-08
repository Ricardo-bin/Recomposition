// ============================================================================
// RECOMPOSITION — DASHBOARD MODEL (pure: no DOM, no Firebase, no storage)
// ----------------------------------------------------------------------------
// The Dashboard is a SUMMARY + LAUNCHPAD. This module only DERIVES what to show
// from data that already exists; it stores nothing and writes nothing.
//
//   plans            -> today's workouts, next workout, planned days
//   logs + pending   -> done today, workouts this week, recent training
//   active session   -> RESUME instead of START (from the existing Workout logger)
//   weight           -> latest weigh-in, change since the previous one
//   active goal      -> goal name, calories, protein (saved numbers, never calculated)
//   profile          -> whether a "complete your profile" nudge is needed
//
// Reused, never re-implemented:
//   completed-log rule     workoutLogStatus.js
//   dates / log naming     historyView.js (toDate, dateKey, summarizeLog)
//   pending workouts       historyView.js pendingDisplayLogs over the EXISTING queue
//   workouts this week     progressInsights.js trainingConsistency
//   weight change          progressMetrics.js compareWeight
//   current weight         resolved by the caller with currentWeight.js
//   active goal            resolved by the caller with activeGoal.js
//
// Every text/number it returns is safe to print: never NaN, undefined or null.
// ============================================================================

import { isCompletedLog } from "./workoutLogStatus.js";
import { toDate, dateKey, summarizeLog, pendingDisplayLogs } from "./historyView.js";
import { compareWeight } from "./progressMetrics.js";
import { trainingConsistency } from "./progressInsights.js";
import { formatWeighInDate } from "./currentWeight.js";

const DAY_NAMES = Object.freeze([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
]);

const list = value => (Array.isArray(value) ? value : []);
const text = value => (typeof value === "string" ? value.trim() : "");

const dayNumber = value => {
  const number = Number(value);

  return Number.isInteger(number) && number >= 1 && number <= 7 ? number : null;
};

const positive = value => {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// Monday = 1 ... Sunday = 7 (the same numbering the plans use).
const todayNumber = now => (now.getDay() === 0 ? 7 : now.getDay());


// ----------------------------------------------------------------------------
// PLANS
// ----------------------------------------------------------------------------

export function normalizePlans(plans) {
  return list(plans)
    .filter(plan => plan && typeof plan === "object" && plan.id !== undefined && plan.id !== null && plan.id !== "")
    .map(plan => ({
      id: String(plan.id),
      name: text(plan.name) || "Workout",
      focus: text(plan.focus),
      exerciseCount: list(plan.exercises).length,
      day: dayNumber(plan.dayOfWeek)
    }));
}

// The next scheduled workout AFTER today, wrapping through the week.
export function findNextWorkout(plans, now = new Date()) {
  const scheduled = normalizePlans(plans).filter(plan => plan.day !== null);

  for (let offset = 1; offset <= 7; offset += 1) {
    const day = ((todayNumber(now) - 1 + offset) % 7) + 1;
    const matches = scheduled.filter(plan => plan.day === day);

    if (matches.length > 0) {
      return {
        dayName: DAY_NAMES[day - 1],
        planName: matches[0].name,
        extraCount: matches.length - 1
      };
    }
  }

  return null;
}


// ----------------------------------------------------------------------------
// LOGS (cloud + pending, completed only)
// ----------------------------------------------------------------------------

// Completed logs from Firestore plus workouts finished on this device that are
// still waiting to sync (the existing pending queue; already-synced items are
// dropped by pendingDisplayLogs). Duplicate ids are removed.
export function mergeCompletedLogs(cloudLogs, pendingItems) {
  const cloud = list(cloudLogs).filter(log => log && isCompletedLog(log));
  const pending = pendingDisplayLogs(list(pendingItems), cloud).filter(isCompletedLog);

  const seen = new Set();
  const merged = [];

  for (const log of [...pending, ...cloud]) {
    if (typeof log.id === "string" && log.id) {
      if (seen.has(log.id)) continue;
      seen.add(log.id);
    }

    merged.push(log);
  }

  return { merged, pending };
}


// ----------------------------------------------------------------------------
// TEXT HELPERS
// ----------------------------------------------------------------------------

// "Today" / "Yesterday" / "7 Oct" (device locale, year only when it is not this year).
export function formatDayLabel(date, now = new Date(), locale = undefined) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "Date unknown";
  }

  const key = dateKey(date);

  if (key === dateKey(now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (key === dateKey(yesterday)) return "Yesterday";

  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" })
  });
}

export function describeWeek(workouts, plannedDays) {
  const done = workouts > 0 ? plural(workouts, "workout", "workouts") : "No workouts yet this week";

  return plannedDays > 0 ? `${done} · ${plural(plannedDays, "planned day", "planned days")}` : done;
}


// ----------------------------------------------------------------------------
// THE MODEL
// ----------------------------------------------------------------------------

// input: {
//   profile, plans, logs (cloud logs), pendingItems (readPending output),
//   currentWeight ({ weightKg, source, date } from currentWeight.js),
//   weightHistory, activeGoal (from activeGoal.js findActiveGoal),
//   activeSession ({ planId, name, setsLogged } | null), now
// }
export function buildDashboardModel(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const plans = normalizePlans(input.plans);
  const { merged, pending } = mergeCompletedLogs(input.logs, input.pendingItems);

  // ---- TODAY -----------------------------------------------------------------
  const todayKeyText = dateKey(now);

  const doneToday = merged
    .filter(log => {
      const date = toDate(log.date);

      return date && dateKey(date) === todayKeyText && log.planId !== undefined && log.planId !== null;
    })
    .map(log => ({ id: typeof log.id === "string" ? log.id : null, planId: String(log.planId), isPending: Boolean(log.isPending) }));

  const todayItems = plans
    .filter(plan => plan.day === todayNumber(now))
    .map(plan => {
      const finished = doneToday.filter(item => item.planId === plan.id);

      return { ...plan, done: finished.length > 0, pending: finished.some(item => item.isPending) };
    });

  const session =
    input.activeSession && typeof input.activeSession === "object"
      ? {
          planId: input.activeSession.planId === undefined || input.activeSession.planId === null
            ? null
            : String(input.activeSession.planId),
          name: text(input.activeSession.name) || "Workout",
          setsLogged: Math.max(0, Math.floor(Number(input.activeSession.setsLogged) || 0))
        }
      : null;

  let today;

  if (session) {
    today = {
      variant: "active",
      ...session,
      detail: plural(session.setsLogged, "set logged", "sets logged"),
      subtitle: "Workout in progress."
    };
  } else if (plans.length === 0) {
    today = { variant: "no-plans", subtitle: "Set up your first workout to get started." };
  } else if (todayItems.length === 0) {
    today = { variant: "rest", next: findNextWorkout(input.plans, now), subtitle: "Rest day. Recover well." };
  } else if (todayItems.every(item => item.done)) {
    const ids = [...new Set(
      doneToday
        .filter(item => todayItems.some(plan => plan.id === item.planId))
        .map(item => item.id)
        .filter(Boolean)
    )];

    today = {
      variant: "done",
      items: todayItems,
      anyPending: todayItems.some(item => item.pending),
      // One finished workout opens its History detail; several open the list.
      logId: ids.length === 1 ? ids[0] : null,
      subtitle: "Today's training is complete. Recover well."
    };
  } else {
    today = {
      variant: "scheduled",
      items: todayItems,
      subtitle: "Your training for today is ready."
    };
  }

  // ---- WEEK -------------------------------------------------------------------
  const workouts = trainingConsistency(merged, now).thisWeek;
  const plannedDays = new Set(plans.map(plan => plan.day).filter(day => day !== null)).size;

  const week = {
    workouts,
    plannedDays,
    text: describeWeek(workouts, plannedDays)
  };

  // ---- SYNC -------------------------------------------------------------------
  const sync = {
    pendingCount: pending.length,
    text: pending.length === 0
      ? ""
      : `${plural(pending.length, "workout", "workouts")} saved on this device, waiting to sync`
  };

  // ---- WEIGHT -----------------------------------------------------------------
  const resolved = input.currentWeight ?? {};
  const kg = positive(resolved.weightKg);

  let weight = { state: "none", valueKg: null, changeKg: null, dateText: "" };

  if (kg !== null && resolved.source === "weight-history") {
    const compared = compareWeight(input.weightHistory);

    weight = {
      state: "history",
      valueKg: kg,
      // Only when it is the same weigh-in the shared resolver picked.
      changeKg:
        compared.current !== null && compared.change !== null && Math.abs(compared.current - kg) < 1e-9
          ? compared.change
          : null,
      dateText: formatWeighInDate(resolved.date)
    };
  } else if (kg !== null && resolved.source === "profile") {
    weight = { state: "legacy", valueKg: kg, changeKg: null, dateText: "" };
  }

  // ---- NUTRITION --------------------------------------------------------------
  const goal = input.activeGoal && typeof input.activeGoal === "object" ? input.activeGoal : null;

  let nutrition = { state: "no-goal", goalName: "", calories: null, protein: null };

  if (goal) {
    const calories = positive(goal.calories);
    const protein = positive(goal.protein);

    nutrition = {
      state: calories !== null || protein !== null ? "ok" : "no-targets",
      goalName: text(goal.goalType) || "Custom",
      calories: calories === null ? null : Math.round(calories),
      protein: protein === null ? null : Math.round(protein)
    };
  }

  // ---- RECENT -----------------------------------------------------------------
  const recent = [...merged]
    .map(log => ({ log, date: toDate(log.date) }))
    .sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity))
    .slice(0, 3)
    .map(({ log }) => {
      const summary = summarizeLog(log);

      return {
        id: typeof log.id === "string" ? log.id : null,
        name: summary.name,
        dateLabel: formatDayLabel(summary.date, now),
        exerciseCount: summary.exerciseCount,
        setCount: summary.setCount,
        hasAlternative: summary.hasAlternative,
        isPending: Boolean(log.isPending)
      };
    });

  // ---- PROFILE NUDGE ----------------------------------------------------------
  const profile = input.profile && typeof input.profile === "object" ? input.profile : {};

  const missing = [
    positive(profile.age) === null ? "age" : null,
    positive(profile.height) === null ? "height" : null,
    text(profile.sex) === "" ? "sex" : null,
    text(profile.activityLevel) === "" ? "activity level" : null
  ].filter(Boolean);

  return {
    name: text(profile.name) || "Athlete",
    today,
    week,
    sync,
    weight,
    nutrition,
    recent,
    profileNudge: missing.length > 0 ? { missing } : null
  };
}
