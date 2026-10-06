// ============================================================================
// RECOMPOSITION — ALTERNATIVE TODAY (pure logic)
// ----------------------------------------------------------------------------
// PLAN    = intended exercise      (Firestore; NEVER touched by this module)
// SESSION = what is being done now (memory + localStorage, logWorkout.js)
// LOG     = what was actually done (Firestore, written on Complete)
//
// An "Alternative Today" is a temporary replacement of ONE exercise inside the
// active SESSION. It lives on the session exercise as `alternativeToday`:
//
//   {
//     name, libraryExerciseId,          // what is being performed today
//     original: { name, libraryExerciseId? },   // the planned exercise
//     selectedAt                        // ISO string
//   }
//
// While active, the session exercise's `name` / `libraryExerciseId` are the
// ALTERNATIVE's. `exerciseId` always stays the plan SLOT id (so the session
// can always be mapped back to its plan slot); the log uses a distinct
// "performed id" so a replacement never pollutes the original exercise's
// history, previous performance, strength progression or personal records.
//
// Everything here is pure: functions never mutate their arguments and return
// new objects. No Firebase, no DOM, no library file access.
// ============================================================================

import { normalizeExerciseText } from "./data/exerciseLibrary.js";

export const ALTERNATIVE_VERSION = 1;

const isText = value =>
  typeof value === "string" && value.trim().length > 0;


// ----------------------------------------------------------------------------
// STATE
// ----------------------------------------------------------------------------

// True when the session exercise carries a well-formed alternative.
export function hasAlternative(exercise) {
  return normalizeAlternative(exercise?.alternativeToday) !== null;
}

// Returns a clean copy of a stored alternative, or null when it is missing or
// malformed (so a damaged stored session can never crash or corrupt anything).
export function normalizeAlternative(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (
    !isText(raw.name) ||
    !isText(raw.libraryExerciseId) ||
    !raw.original ||
    typeof raw.original !== "object" ||
    !isText(raw.original.name)
  ) {
    return null;
  }

  return {
    version: ALTERNATIVE_VERSION,
    name: raw.name,
    libraryExerciseId: raw.libraryExerciseId,
    original: {
      name: raw.original.name,
      ...(isText(raw.original.libraryExerciseId)
        ? { libraryExerciseId: raw.original.libraryExerciseId }
        : {})
    },
    selectedAt: typeof raw.selectedAt === "string" ? raw.selectedAt : ""
  };
}

// `{ libraryExerciseId }` when linked, `{}` otherwise (Firestore rejects
// `undefined`, so the key is omitted entirely).
export function libraryField(exercise) {
  return isText(exercise?.libraryExerciseId)
    ? { libraryExerciseId: exercise.libraryExerciseId }
    : {};
}

// The identity used for previous-performance lookups and for the saved log.
//   no alternative -> the plan slot id (exactly as before this feature)
//   alternative    -> "alt:<slotId>:<libraryExerciseId>"
export function getPerformedExerciseId(exercise) {
  const alternative = normalizeAlternative(exercise?.alternativeToday);

  return alternative
    ? `alt:${exercise.exerciseId}:${alternative.libraryExerciseId}`
    : exercise?.exerciseId;
}

// True when any set holds typed data.
export function hasEnteredData(exercise) {
  return (exercise?.sets ?? []).some(set =>
    ["weight", "reps", "rir"].some(
      field => set?.[field] !== "" && set?.[field] != null
    )
  );
}

// Fresh, empty sets with the same count (never fewer than one).
function freshSets(exercise) {
  const count = Math.max(
    1,
    Array.isArray(exercise?.sets) ? exercise.sets.length : 0
  );

  return Array.from({ length: count }, () => ({
    weight: "",
    reps: "",
    rir: ""
  }));
}


// ----------------------------------------------------------------------------
// VALIDATION
// ----------------------------------------------------------------------------

// Can `libraryExercise` replace session.exercises[exerciseIndex] today?
//   returns { ok: true } | { ok: false, reason, message }
//
// Reasons: invalid-session, invalid-exercise, invalid-library-exercise,
//          deprecated, same-as-planned, duplicate
export function validateReplacement(session, exerciseIndex, libraryExercise) {
  const fail = (reason, message) => ({ ok: false, reason, message });

  const exercises = session?.exercises;

  if (!Array.isArray(exercises)) {
    return fail("invalid-session", "There is no active workout session.");
  }

  const current = exercises[exerciseIndex];

  if (!current) {
    return fail("invalid-exercise", "That exercise is not in this session.");
  }

  if (
    !libraryExercise ||
    typeof libraryExercise !== "object" ||
    !isText(libraryExercise.id) ||
    !isText(libraryExercise.name)
  ) {
    return fail(
      "invalid-library-exercise",
      "Choose an exercise from the exercise library."
    );
  }

  if (libraryExercise.status === "deprecated") {
    return fail(
      "deprecated",
      `${libraryExercise.name} is no longer available.`
    );
  }

  const alternative = normalizeAlternative(current.alternativeToday);

  const planned = alternative
    ? alternative.original
    : { name: current.name, libraryExerciseId: current.libraryExerciseId };

  const pickedName = normalizeExerciseText(libraryExercise.name);

  if (
    (isText(planned.libraryExerciseId) &&
      planned.libraryExerciseId === libraryExercise.id) ||
    normalizeExerciseText(planned.name) === pickedName
  ) {
    return fail(
      "same-as-planned",
      alternative
        ? `${planned.name} is the planned exercise. Use Restore instead.`
        : `${planned.name} is already the planned exercise.`
    );
  }

  const duplicate = exercises.some((other, index) => {
    if (index === exerciseIndex) {
      return false;
    }

    return (
      (isText(other.libraryExerciseId) &&
        other.libraryExerciseId === libraryExercise.id) ||
      normalizeExerciseText(other.name) === pickedName
    );
  });

  if (duplicate) {
    return fail(
      "duplicate",
      `${libraryExercise.name} is already in today's workout.`
    );
  }

  return { ok: true };
}


// ----------------------------------------------------------------------------
// APPLY / RESTORE (return a NEW exercise; the plan is not an input)
// ----------------------------------------------------------------------------

// returns { ok: true, exercise } | { ok: false, reason, message }
// On failure nothing is returned to assign, so nothing can be changed.
export function applyAlternative(
  session,
  exerciseIndex,
  libraryExercise,
  now = new Date()
) {
  const check = validateReplacement(session, exerciseIndex, libraryExercise);

  if (!check.ok) {
    return check;
  }

  const current = session.exercises[exerciseIndex];

  const existing = normalizeAlternative(current.alternativeToday);

  const original = existing
    ? existing.original
    : {
        name: current.name,
        ...libraryField(current)
      };

  const { previousLog, ...rest } = current;

  return {
    ok: true,
    exercise: {
      ...rest,
      name: libraryExercise.name,
      libraryExerciseId: libraryExercise.id,
      // Values typed for another exercise never carry over.
      sets: freshSets(current),
      previousLog: null,
      alternativeToday: {
        version: ALTERNATIVE_VERSION,
        name: libraryExercise.name,
        libraryExerciseId: libraryExercise.id,
        original,
        selectedAt: now.toISOString()
      }
    }
  };
}

// Back to the planned exercise. Returns the same exercise unchanged when no
// alternative is active.
export function restoreOriginal(exercise) {
  const alternative = normalizeAlternative(exercise?.alternativeToday);

  if (!alternative) {
    return exercise;
  }

  const {
    alternativeToday,
    libraryExerciseId,
    previousLog,
    ...rest
  } = exercise;

  return {
    ...rest,
    name: alternative.original.name,
    ...libraryField(alternative.original),
    sets: freshSets(exercise),
    previousLog: null
  };
}

// Used when a stored session is read back. Repairs or drops a damaged
// alternative; never throws.
export function sanitizeSessionExercise(exercise) {
  if (!exercise || typeof exercise !== "object") {
    return exercise;
  }

  if (!("alternativeToday" in exercise)) {
    return exercise;
  }

  const alternative = normalizeAlternative(exercise.alternativeToday);

  const { alternativeToday, ...rest } = exercise;

  if (alternative) {
    return {
      ...rest,
      name: alternative.name,
      libraryExerciseId: alternative.libraryExerciseId,
      alternativeToday: alternative
    };
  }

  // Damaged: go back to the planned exercise when it can be recovered,
  // otherwise just drop the marker and keep what is on screen.
  const original = alternativeToday?.original;

  if (original && typeof original === "object" && isText(original.name)) {
    const { libraryExerciseId, ...withoutLink } = rest;

    return {
      ...withoutLink,
      name: original.name,
      ...libraryField(original)
    };
  }

  return rest;
}


// ----------------------------------------------------------------------------
// LOG
// ----------------------------------------------------------------------------

// The session as it should be SAVED. Without any alternative the very same
// object is returned, so logging behaves exactly as it did before.
//
// A replaced exercise is logged as what was actually performed:
//   exerciseId         "alt:<slotId>:<libraryId>"  (own history / PR identity)
//   name               the alternative
//   libraryExerciseId  the alternative
//   plannedExerciseId  the plan slot id
//   plannedName        the planned exercise
//   alternativeToday   the record (original, selectedAt)
export function buildLogSession(session) {
  if (!session || !Array.isArray(session.exercises)) {
    return session;
  }

  if (!session.exercises.some(hasAlternative)) {
    return session;
  }

  return {
    ...session,
    exercises: session.exercises.map(exercise => {
      const alternative = normalizeAlternative(exercise.alternativeToday);

      if (!alternative) {
        // Untouched exercises pass through as-is; only a damaged marker is dropped.
        if (!("alternativeToday" in exercise)) {
          return exercise;
        }

        const { alternativeToday, ...clean } = exercise;

        return clean;
      }

      return {
        ...exercise,
        exerciseId: getPerformedExerciseId(exercise),
        name: alternative.name,
        libraryExerciseId: alternative.libraryExerciseId,
        plannedExerciseId: exercise.exerciseId,
        plannedName: alternative.original.name,
        ...(alternative.original.libraryExerciseId
          ? {
              plannedLibraryExerciseId:
                alternative.original.libraryExerciseId
            }
          : {}),
        alternativeToday: alternative
      };
    })
  };
}
