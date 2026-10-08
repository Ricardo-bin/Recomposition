// ============================================================================
// RECOMPOSITION — INDEPENDENT EXERCISE LOGGING (pure logic, no DOM)
// ----------------------------------------------------------------------------
//   PLAN    = what was intended          (never touched here)
//   SESSION = what was started today     (each exercise carries `logStatus`)
//   LOG     = what was actually performed (built by buildPerformedSession)
//
// `logStatus` lives on the existing session exercise, so it is persisted by the
// existing active-session snapshot. There is no second store.
//
//   "logged"   the user pressed SAVE EXERCISE
//   "skipped"  the user pressed SKIP TODAY (today's session only)
//   anything else / missing = not saved yet. It is then "in-progress" when sets
//   have been typed, otherwise "not-started". Older stored sessions (no
//   logStatus at all) therefore keep working.
// ============================================================================

export const LOG_STATUS = Object.freeze({
  LOGGED: "logged",
  SKIPPED: "skipped"
});

export const EXERCISE_STATES = Object.freeze([
  "not-started",
  "in-progress",
  "logged",
  "skipped"
]);

const isEmpty = value => value === "" || value === null || value === undefined;

const setsOf = exercise => (Array.isArray(exercise?.sets) ? exercise.sets : []);

// A set that counts as performed: it has both weight and reps.
export const isCompletedSet = set =>
  !isEmpty(set?.weight) && !isEmpty(set?.reps);

// Anything typed at all (a half-typed set still means "started").
export const hasAnyInput = set =>
  !isEmpty(set?.weight) || !isEmpty(set?.reps) || !isEmpty(set?.rir);

export function exerciseState(exercise) {
  if (exercise?.logStatus === LOG_STATUS.LOGGED) return "logged";
  if (exercise?.logStatus === LOG_STATUS.SKIPPED) return "skipped";

  return setsOf(exercise).some(hasAnyInput) ? "in-progress" : "not-started";
}

// ----------------------------------------------------------------------------
// VALIDATION (one exercise). Same rules the whole-workout check always used.
// ----------------------------------------------------------------------------
export function validateExercise(exercise) {
  const name = exercise?.name || "This exercise";
  const sets = setsOf(exercise);

  for (let index = 0; index < sets.length; index += 1) {
    const set = sets[index];

    if (!hasAnyInput(set)) {
      continue;
    }

    if (isEmpty(set.weight)) {
      return { valid: false, message: `Please enter the weight for Set ${index + 1} of ${name}.` };
    }

    if (isEmpty(set.reps)) {
      return { valid: false, message: `Please enter the reps for Set ${index + 1} of ${name}.` };
    }

    const weight = Number(set.weight);
    const reps = Number(set.reps);

    if (!Number.isFinite(weight) || weight < 0) {
      return { valid: false, message: `Weight for Set ${index + 1} of ${name} must be 0 or greater.` };
    }

    if (!Number.isInteger(reps) || reps < 1 || reps > 100) {
      return { valid: false, message: `Reps for Set ${index + 1} of ${name} must be between 1 and 100.` };
    }

    if (!isEmpty(set.rir)) {
      const rir = Number(set.rir);

      if (!Number.isInteger(rir) || rir < 0 || rir > 5) {
        return { valid: false, message: `RIR for Set ${index + 1} of ${name} must be between 0 and 5.` };
      }
    }
  }

  if (!sets.some(isCompletedSet)) {
    return {
      valid: false,
      message: `Enter weight and reps for at least one set of ${name}.`
    };
  }

  return { valid: true, message: "" };
}

// ----------------------------------------------------------------------------
// COUNTS + SUMMARY
// ----------------------------------------------------------------------------
export function summarizeSession(session) {
  const exercises = Array.isArray(session?.exercises) ? session.exercises : [];

  const counts = { total: exercises.length, logged: 0, skipped: 0, inProgress: 0, notStarted: 0 };

  for (const exercise of exercises) {
    const state = exerciseState(exercise);

    if (state === "logged") counts.logged += 1;
    else if (state === "skipped") counts.skipped += 1;
    else if (state === "in-progress") counts.inProgress += 1;
    else counts.notStarted += 1;
  }

  return counts;
}

// "3 sets · 40kg × 10" for a logged card. Same weight/reps on every set shows
// once; otherwise the heaviest set is shown.
export function summarizeLoggedExercise(exercise) {
  const done = setsOf(exercise).filter(isCompletedSet);

  if (!done.length) {
    return "";
  }

  const label = `${done.length} set${done.length === 1 ? "" : "s"}`;
  const same = done.every(
    set => String(set.weight) === String(done[0].weight) && String(set.reps) === String(done[0].reps)
  );

  const top = same
    ? done[0]
    : done.reduce((best, set) => (Number(set.weight) > Number(best.weight) ? set : best), done[0]);

  return `${label} · ${top.weight}kg × ${top.reps}`;
}

// ----------------------------------------------------------------------------
// FINISH
// ----------------------------------------------------------------------------
// What FINISH WORKOUT will do with the session as it stands. It never demands
// that every planned exercise is done.
//  - logged exercises are kept,
//  - an exercise with valid typed sets that was never saved is saved with them,
//    so nothing the user entered is thrown away,
//  - an unsaved exercise with half-typed sets (e.g. weight but no reps) is left
//    out and named in `unsaved`, so the question can mention it - it never
//    blocks finishing,
//  - skipped / not-started exercises are left out.
// The only refusals: nothing at all was logged, or an exercise the user SAVED
// was edited into an invalid state (they can fix or skip it).
export function planFinish(session) {
  const exercises = Array.isArray(session?.exercises) ? session.exercises : [];
  const included = [];
  const unsaved = [];

  for (const exercise of exercises) {
    const state = exerciseState(exercise);

    if (state === "logged") {
      const check = validateExercise(exercise);

      if (!check.valid) {
        return { ok: false, message: check.message, included: [], unsaved, total: exercises.length };
      }

      included.push(exercise);
    } else if (state === "in-progress") {
      if (validateExercise(exercise).valid) {
        included.push(exercise);
      } else {
        unsaved.push(exercise.name || "An exercise");
      }
    }
  }

  if (!included.length) {
    return {
      ok: false,
      message: "Log at least one exercise before finishing the workout.",
      included,
      unsaved,
      total: exercises.length
    };
  }

  return { ok: true, message: "", included, unsaved, total: exercises.length };
}

// Needs the "Finish this workout anyway?" question?
export const needsFinishConfirmation = plan =>
  plan.ok && plan.included.length < plan.total;

// The session as it is SAVED: only performed exercises, only performed sets.
// Nothing is invented for exercises that were skipped or never started, and
// the per-exercise `logStatus` marker is not written into the log.
export function buildPerformedSession(session) {
  const plan = planFinish(session);

  const exercises = plan.included.map(exercise => {
    const { logStatus, ...rest } = exercise;

    return { ...rest, sets: setsOf(exercise).filter(isCompletedSet).map(set => ({ ...set })) };
  });

  return { ...session, exercises };
}

// Plain English for the confirmation question.
export function finishQuestion(plan) {
  const unsaved = Array.isArray(plan.unsaved) && plan.unsaved.length
    ? ` Unsaved sets for ${plan.unsaved.join(", ")} will not be included.`
    : "";

  return `You logged ${plan.included.length} of ${plan.total} exercise${plan.total === 1 ? "" : "s"}.${unsaved} Finish this workout anyway?`;
}
