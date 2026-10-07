// ============================================================================
// RECOMPOSITION — Workout Session Logger
// ============================================================================

import {
  getWorkoutPlan,
  getPreviousWorkoutLog,
  getWorkoutLogs,
  saveWorkoutLogOnce,
  getAuthenticatedUserId
} from "./data/recompositionData.js";

import {
  createSyncId,
  enqueuePending,
  isPending,
  readPending,
  syncPending
} from "./pendingWorkouts.js";

import { auth } from "./firebase.js";

import {
  applyAlternative,
  buildLogSession,
  getPerformedExerciseId,
  hasAlternative,
  hasEnteredData,
  libraryField,
  normalizeAlternative,
  restoreOriginal,
  sanitizeSessionExercise,
  validateReplacement
} from "./alternativeToday.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";


// ============================================================================
// STATE
// ============================================================================

let currentWorkoutPlan = null;
let currentWorkoutSession = null;


// ============================================================================
// ACTIVE SESSION PERSISTENCE (survives refresh / reload)
// ----------------------------------------------------------------------------
// PLAN    = what the user intended to train      (Firestore, never touched here)
// SESSION = the workout being performed right now (kept in memory + localStorage)
// LOG     = the completed workout                 (Firestore, created on Complete)
//
// Only the SESSION is mirrored into localStorage, scoped per user id. It is
// removed when the workout is completed or explicitly closed (discarded).
// ============================================================================

const ACTIVE_SESSION_KEY_PREFIX =
  "recomposition.activeWorkoutSession.v1.";

function getActiveSessionKey(uid) {
  return ACTIVE_SESSION_KEY_PREFIX + uid;
}

function persistActiveSession(extra = {}) {
  if (!currentWorkoutSession) {
    return;
  }

  try {
    const uid = getAuthenticatedUserId();

    const snapshot = {
      ...currentWorkoutSession,
      // previousLog is re-fetched from Firestore on restore.
      exercises: currentWorkoutSession.exercises.map(
        ({ previousLog, ...exercise }) => exercise
      ),
      ...extra,
      savedAt: Date.now()
    };

    localStorage.setItem(
      getActiveSessionKey(uid),
      JSON.stringify(snapshot)
    );
  } catch (error) {
    console.error(
      "Could not save the active workout session:",
      error
    );
  }
}

function clearActiveSession(uid = null) {
  try {
    const userId = uid || getAuthenticatedUserId();
    localStorage.removeItem(getActiveSessionKey(userId));
  } catch (error) {
    // Signed out or storage unavailable: nothing to clear.
  }
}

function toMillis(value) {
  if (!value) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  return new Date(value).getTime();
}

function setSessionViewActive(isActive) {
  document
    .getElementById("section-workout")
    ?.classList.toggle("workout-session-active", isActive);
}


// ============================================================================
// HELPERS
// ============================================================================

function getSessionContainer() {

  let container =
    document.getElementById(
      "workout-session-container"
    );

  if (!container) {

    const workoutSection =
      document.getElementById(
        "section-workout"
      );

    if (!workoutSection) {

      console.error(
        "Workout section not found."
      );

      return null;
    }

    container =
      document.createElement("div");

    container.id =
      "workout-session-container";

    container.className =
      "workout-session-container";

    workoutSection.appendChild(
      container
    );
  }

  return container;
}


function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatDate(date) {

  const value =
    date?.toDate
      ? date.toDate()
      : new Date(date);

  return value.toLocaleDateString(
    undefined,
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }
  );
}


// ============================================================================
// CREATE SESSION
// ============================================================================

function createWorkoutSession(plan) {

  return {

    // One stable id per workout: becomes the Firestore log document id, so
    // any retry of the same workout can never create a second log.
    syncId: createSyncId(),

    planId: plan.id,

    workoutName:
      plan.name,

    date:
      new Date(),

    status:
      "in-progress",

    exercises:
      (plan.exercises || []).map(
        exercise => ({

          exerciseId:
            exercise.id,

          name:
            exercise.name,

          ...libraryField(
            exercise
          ),

          targetSets:
            exercise.sets,

          repMin:
            exercise.repMin,

          repMax:
            exercise.repMax,

          targetRIR:
            exercise.targetRIR,

          restSeconds:
            exercise.restSeconds,

          notes:
            exercise.notes || "",

          sets:
            Array.from(
              {
                length:
                  Number(exercise.sets) || 0
              },
              () => ({
                weight: "",
                reps: "",
                rir: ""
              })
            ),

          previousLog:
            null

        })
      )

  };
}


// ============================================================================
// LOAD PREVIOUS PERFORMANCE
// ============================================================================

async function loadPreviousPerformance() {

  if (!currentWorkoutSession) {
    return;
  }

  await Promise.all(

    currentWorkoutSession.exercises.map(
      loadPreviousForExercise
    )

  );
}

// Previous performance follows what is actually performed: a replaced
// exercise only ever shows earlier sessions of that same replacement.
const PREVIOUS_LOOKUP_TIMEOUT_MS = 4000;

async function loadPreviousForExercise(exercise) {

  try {

    // Offline (or a hanging request) must never hold up the workout screen.
    if (globalThis.navigator?.onLine === false) {
      exercise.previousLog = null;
      return;
    }

    let timer;

    try {
      exercise.previousLog =
        await Promise.race([
          getPreviousWorkoutLog(
            currentWorkoutSession.planId,
            getPerformedExerciseId(
              exercise
            ),
            currentWorkoutSession.date
          ),
          new Promise(resolve => {
            timer = setTimeout(() => resolve(null), PREVIOUS_LOOKUP_TIMEOUT_MS);
          })
        ]);
    } finally {
      clearTimeout(timer);
    }

  } catch (error) {

    console.error(
      `Could not load previous performance for ${exercise.name}:`,
      error
    );

    exercise.previousLog =
      null;
  }
}


// ============================================================================
// RENDER SESSION
// ============================================================================

async function renderWorkoutSession() {

  const container =
    getSessionContainer();

  if (
    !container ||
    !currentWorkoutSession
  ) {
    return;
  }

  container.innerHTML = `
    <div class="workout-session-header">

      <div>

        <div class="workout-session-eyebrow">
          WORKOUT SESSION
        </div>

        <h2>
          ${escapeHtml(
            currentWorkoutSession.workoutName
          )}
        </h2>

        <p>
          ${formatDate(
            currentWorkoutSession.date
          )}
        </p>

      </div>

      <button
        type="button"
        class="workout-small-button"
        id="close-workout-session"
      >
        Close
      </button>

    </div>

    <div class="workout-session-status">
      Session in progress
    </div>

    <div id="workout-session-exercises">
      <div class="loading-row">
        Loading previous performance...
      </div>
    </div>

    <div class="workout-session-footer">

      <button
        type="button"
        class="workout-primary-button"
        id="complete-workout-button"
      >
        Complete Workout
      </button>

    </div>
  `;

  await loadPreviousPerformance();

  const exerciseContainer =
    document.getElementById(
      "workout-session-exercises"
    );

  if (exerciseContainer) {

    exerciseContainer.innerHTML =
      renderExercises();

  }

  attachSessionEvents();
}


// ============================================================================
// RENDER EXERCISES
// ============================================================================

function renderExercises() {

  if (
    !currentWorkoutSession.exercises.length
  ) {

    return `
      <div class="workout-empty-state">

        <h3>
          No exercises in this workout
        </h3>

        <p>
          Add exercises to the workout plan
          before starting a session.
        </p>

      </div>
    `;
  }


  return currentWorkoutSession.exercises
    .map(
      (exercise, exerciseIndex) => {

        return `
          <article
            class="workout-session-exercise"
            data-session-exercise="${exerciseIndex}"
          >

            <div
              class="workout-session-exercise-header"
            >

              <div>

                <span
                  class="workout-session-exercise-number"
                >
                  ${String(
                    exerciseIndex + 1
                  ).padStart(2, "0")}
                </span>

                <h3>
                  ${escapeHtml(
                    exercise.name
                  )}
                </h3>

              </div>

              <div
                class="workout-session-target"
              >
                ${exercise.targetSets}
                sets
                ·
                ${exercise.repMin}-${exercise.repMax}
                reps
                ·
                RIR ${exercise.targetRIR}
              </div>

            </div>

            ${renderAlternativeToday(
              exercise,
              exerciseIndex
            )}

            ${renderPreviousPerformance(
              exercise
            )}

            <div
  class="workout-session-sets"
>

  ${renderSetHeader()}

  ${exercise.sets
    .map(
      (set, setIndex) =>
        renderSetRow(
          exercise,
          exerciseIndex,
          set,
          setIndex
        )
    )
    .join("")}

  <div class="workout-set-actions">

    <button
      type="button"
      class="workout-small-button"
      data-add-set="${exerciseIndex}"
      ${exercise.sets.length >= 20 ? "disabled" : ""}
    >
      + Add Set
    </button>

  </div>

</div>

          </article>
        `;
      }
    )
    .join("");
}


// ============================================================================
// ALTERNATIVE TODAY — card block
// ----------------------------------------------------------------------------
// Always makes it clear the change is for TODAY'S SESSION ONLY and shows the
// planned exercise next to the replacement.
// ============================================================================

function renderAlternativeToday(
  exercise,
  exerciseIndex
) {

  const alternative =
    normalizeAlternative(
      exercise.alternativeToday
    );

  if (!alternative) {

    return `
      <div class="alt-today-actions">

        <button
          type="button"
          class="workout-small-button"
          data-alt-open="${exerciseIndex}"
        >
          ALTERNATIVE TODAY
        </button>

      </div>
    `;
  }

  return `
    <div
      class="alt-today-banner"
      data-alt-today="${exerciseIndex}"
    >

      <div class="alt-today-tag">
        TODAY ONLY
      </div>

      <div class="alt-today-planned">
        Alternative for
        <strong>${escapeHtml(
          alternative.original.name
        )}</strong>
      </div>

      <div class="alt-today-note">
        Your saved workout plan is unchanged.
      </div>

      <div class="alt-today-banner-actions">

        <button
          type="button"
          class="workout-small-button"
          data-alt-open="${exerciseIndex}"
        >
          Change
        </button>

        <button
          type="button"
          class="workout-small-button"
          data-alt-restore="${exerciseIndex}"
        >
          Restore ${escapeHtml(
            alternative.original.name
          )}
        </button>

      </div>

    </div>
  `;
}


// ============================================================================
// PREVIOUS PERFORMANCE
// ============================================================================

function renderPreviousPerformance(
  exercise
) {

  if (!exercise.previousLog) {

    return `
      <div
        class="workout-previous-performance"
      >
        <span>
          No previous session
        </span>
      </div>
    `;
  }


  const previousExercise =
    exercise.previousLog.exercises?.find(
      item =>
        item.exerciseId ===
        getPerformedExerciseId(
          exercise
        )
    );


  if (
    !previousExercise ||
    !Array.isArray(previousExercise.sets) ||
    previousExercise.sets.length === 0
  ) {

    return `
      <div
        class="workout-previous-performance"
      >
        <span>
          No previous performance recorded
        </span>
      </div>
    `;
  }


  const summary =
    previousExercise.sets
      .map(
        (set, index) => {

          const weight =
            set.weight !== ""
              ? `${set.weight} kg`
              : "—";

          const reps =
            set.reps !== ""
              ? `${set.reps} reps`
              : "—";

          const rir =
            set.rir !== ""
              ? `RIR ${set.rir}`
              : "RIR —";

          return `
            <span class="workout-previous-set">
              ${index + 1}.
              ${weight}
              ×
              ${reps.replace(" reps", "")}
              ·
              ${rir}
            </span>
          `;
        }
      )
      .join("");


  return `
    <div
      class="workout-previous-performance"
    >

      <div
        class="workout-previous-title"
      >
        PREVIOUS SESSION
      </div>

      <div
        class="workout-previous-date"
      >
        ${formatDate(
          exercise.previousLog.date
        )}
      </div>

      <div
        class="workout-previous-sets"
      >
        ${summary}
      </div>

    </div>
  `;
}


// ============================================================================
// SET TABLE HEADER
// ============================================================================

function renderSetHeader() {

  return `
    <div class="workout-set-row workout-set-header">

      <div>
        SET
      </div>

      <div>
        PREVIOUS
      </div>

      <div>
        WEIGHT
      </div>

      <div>
        REPS
      </div>

      <div>
        RIR
      </div>

    </div>
  `;
}


// ============================================================================
// SET ROW
// ============================================================================

function renderSetRow(
  exercise,
  exerciseIndex,
  set,
  setIndex
) {

  const previousSet =
    getPreviousSet(
      exercise,
      setIndex
    );


  const previousText =
    previousSet
      ? `${previousSet.weight ?? "—"} × ${previousSet.reps ?? "—"}`
      : "—";


  return `
    <div
      class="workout-set-row"
      data-exercise-index="${exerciseIndex}"
      data-set-index="${setIndex}"
    >

      <div
        class="workout-set-number"
      >
        ${setIndex + 1}
      </div>


      <div
        class="workout-set-previous"
      >
        ${escapeHtml(
          previousText
        )}
      </div>


      <div>

        <input
          type="number"
          class="form-input workout-set-input"
          data-set-field="weight"
          data-exercise-index="${exerciseIndex}"
          data-set-index="${setIndex}"
          min="0"
          step="0.5"
          placeholder="kg"
          value="${escapeHtml(
            set.weight
          )}"
        >

      </div>


      <div>

        <input
          type="number"
          class="form-input workout-set-input"
          data-set-field="reps"
          data-exercise-index="${exerciseIndex}"
          data-set-index="${setIndex}"
          min="0"
          step="1"
          placeholder="reps"
          value="${escapeHtml(
            set.reps
          )}"
        >

      </div>


      <div class="workout-set-rir-cell">

  <input
    type="number"
    class="form-input workout-set-input"
    data-set-field="rir"
    data-exercise-index="${exerciseIndex}"
    data-set-index="${setIndex}"
    min="0"
    max="5"
    step="1"
    placeholder="RIR"
    value="${escapeHtml(
      set.rir
    )}"
  >

  <button
    type="button"
    class="workout-set-remove-button"
    data-remove-set="${exerciseIndex}"
    data-set-index="${setIndex}"
    title="Remove set"
    ${exercise.sets.length <= 1 ? "disabled" : ""}
  >
    ×
  </button>

</div>

    </div>
  `;
}


// ============================================================================
// PREVIOUS SET HELPER
// ============================================================================

function getPreviousSet(
  exercise,
  setIndex
) {

  if (!exercise.previousLog) {
    return null;
  }

  const previousExercise =
    exercise.previousLog.exercises?.find(
      item =>
        item.exerciseId ===
        getPerformedExerciseId(
          exercise
        )
    );

  if (
    !previousExercise ||
    !Array.isArray(previousExercise.sets)
  ) {
    return null;
  }

  return (
    previousExercise.sets[setIndex] ||
    null
  );
}


// ============================================================================
// SESSION EVENTS
// ============================================================================

function attachSessionEvents() {

  const closeButton =
    document.getElementById(
      "close-workout-session"
    );

  if (closeButton) {

    closeButton.addEventListener(
      "click",
      closeWorkoutSession
    );

  }


  const completeButton =
    document.getElementById(
      "complete-workout-button"
    );

  if (completeButton) {

    completeButton.addEventListener(
      "click",
      handleCompleteWorkout
    );

  }

    // Listen for changes to workout set inputs
  document
    .querySelectorAll(".workout-set-input")
    .forEach(input => {

      input.addEventListener(
        "input",
        handleSetInput
      );

    });


  document
  .querySelectorAll(
    "[data-add-set]"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const exerciseIndex =
          Number(
            button.dataset.addSet
          );

        addSet(exerciseIndex);

      }
    );

  });


  document
    .querySelectorAll(
      "[data-alt-open]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => openAlternativeSheet(
          Number(
            button.dataset.altOpen
          )
        )
      );

    });


  document
    .querySelectorAll(
      "[data-alt-restore]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => restoreOriginalExercise(
          Number(
            button.dataset.altRestore
          )
        )
      );

    });


document
  .querySelectorAll(
    "[data-remove-set]"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const exerciseIndex =
          Number(
            button.dataset.removeSet
          );

        const setIndex =
          Number(
            button.dataset.setIndex
          );

        removeSet(
          exerciseIndex,
          setIndex
        );

      }
    );

  });

}


// ============================================================================
// SET INPUT
// ============================================================================

function handleSetInput(event) {

  const input = event.target;

  const exerciseIndex =
    Number(input.dataset.exerciseIndex);

  const setIndex =
    Number(input.dataset.setIndex);

  const field =
  input.dataset.setField;


  if (
    Number.isNaN(exerciseIndex) ||
    Number.isNaN(setIndex) ||
    !field
  ) {
    return;
  }


  const exercise =
    currentWorkoutSession.exercises[exerciseIndex];

  if (!exercise) {
    return;
  }


  const set =
    exercise.sets[setIndex];

  if (!set) {
    return;
  }


    set[field] =
    input.value;

  persistActiveSession();


}


// ============================================================================
// VALIDATE WORKOUT SESSION
// ============================================================================

function validateWorkoutSession() {

  if (!currentWorkoutSession) {
    return {
      valid: false,
      message: "No active workout session."
    };
  }


  if (
    !Array.isArray(
      currentWorkoutSession.exercises
    ) ||
    currentWorkoutSession.exercises.length === 0
  ) {
    return {
      valid: false,
      message: "This workout has no exercises."
    };
  }


  for (
    let exerciseIndex = 0;
    exerciseIndex <
    currentWorkoutSession.exercises.length;
    exerciseIndex++
  ) {

    const exercise =
      currentWorkoutSession
        .exercises[exerciseIndex];


    if (
      !Array.isArray(exercise.sets) ||
      exercise.sets.length === 0
    ) {

      return {
        valid: false,
        message:
          `${exercise.name} must have at least one set.`
      };
    }


    // Check whether the exercise has at least
    // one completed set.
    const hasCompletedSet =
      exercise.sets.some(
        set =>
          set.weight !== "" &&
          set.weight !== null &&
          set.reps !== "" &&
          set.reps !== null
      );


    if (!hasCompletedSet) {

      return {
        valid: false,
        message:
          `Please complete at least one set of ${exercise.name}.`
      };
    }


    for (
      let setIndex = 0;
      setIndex < exercise.sets.length;
      setIndex++
    ) {

      const set =
        exercise.sets[setIndex];


      const weightEmpty =
        set.weight === "" ||
        set.weight === null ||
        set.weight === undefined;


      const repsEmpty =
        set.reps === "" ||
        set.reps === null ||
        set.reps === undefined;


      const rirEmpty =
        set.rir === "" ||
        set.rir === null ||
        set.rir === undefined;


      // Completely empty set:
      // This is allowed as long as it is not
      // between completed sets.
      if (
        weightEmpty &&
        repsEmpty &&
        rirEmpty
      ) {
        continue;
      }


      // Weight is required if the set has data.
      if (weightEmpty) {

        return {
          valid: false,
          message:
            `Please enter the weight for Set ${setIndex + 1} of ${exercise.name}.`
        };
      }


      // Reps are required.
      if (repsEmpty) {

        return {
          valid: false,
          message:
            `Please enter the reps for Set ${setIndex + 1} of ${exercise.name}.`
        };
      }


      const weight =
        Number(set.weight);


      const reps =
        Number(set.reps);


      if (
        !Number.isFinite(weight) ||
        weight < 0
      ) {

        return {
          valid: false,
          message:
            `Weight for Set ${setIndex + 1} of ${exercise.name} must be 0 or greater.`
        };
      }


      if (
        !Number.isInteger(reps) ||
        reps < 1 ||
        reps > 100
      ) {

        return {
          valid: false,
          message:
            `Reps for Set ${setIndex + 1} of ${exercise.name} must be between 1 and 100.`
        };
      }


      // RIR is optional.
      // But if entered, it must be 0–5.
      if (!rirEmpty) {

        const rir =
          Number(set.rir);


        if (
          !Number.isInteger(rir) ||
          rir < 0 ||
          rir > 5
        ) {

          return {
            valid: false,
            message:
              `RIR for Set ${setIndex + 1} of ${exercise.name} must be between 0 and 5.`
          };
        }

      }

    }

  }


  return {
    valid: true,
    message: ""
  };
}

// ============================================================================
// ADD SET
// ============================================================================

function addSet(exerciseIndex) {

  const exercise =
    currentWorkoutSession
      ?.exercises[
        exerciseIndex
      ];

  if (!exercise) {
    return;
  }

  // Safety limit.
  if (exercise.sets.length >= 20) {
    return;
  }

    exercise.sets.push({
    weight: "",
    reps: "",
    rir: ""
  });

  persistActiveSession();


  rerenderSessionExercises(
    exerciseIndex,
    exercise.sets.length - 1
  );
}

// ============================================================================
// REMOVE SET
// ============================================================================

function removeSet(
  exerciseIndex,
  setIndex
) {

  const exercise =
    currentWorkoutSession
      ?.exercises[
        exerciseIndex
      ];

  if (!exercise) {
    return;
  }

  // Never allow an exercise to have zero sets.
  if (exercise.sets.length <= 1) {
    return;
  }

    exercise.sets.splice(
    setIndex,
    1
  );

  persistActiveSession();


  rerenderSessionExercises(
    exerciseIndex
  );
}

// ============================================================================
// RERENDER EXERCISES
// ============================================================================

function rerenderSessionExercises(
  focusExerciseIndex = null,
  focusSetIndex = null
) {

  const container =
    document.getElementById(
      "workout-session-exercises"
    );

  if (!container) {
    return;
  }

  container.innerHTML =
    renderExercises();

  attachSessionEvents();

  if (
    focusExerciseIndex !== null &&
    focusSetIndex !== null
  ) {

    const input =
      document.querySelector(
        `[data-exercise-index="${focusExerciseIndex}"][data-set-index="${focusSetIndex}"][data-set-field="weight"]`
      );

    input?.focus();

  }
}


// ============================================================================
// ALTERNATIVE TODAY — actions
// ----------------------------------------------------------------------------
// Only the SESSION exercise changes. The saved workout plan is never read for
// writing, never written, and not even imported here for update.
// ============================================================================

let alternativeSheet = null;

// Loaded on demand: the library and picker are only needed when the sheet opens.
async function loadAlternativePicker() {

  const [pickerUi, library, smart, pickerHelpers] =
    await Promise.all([
      import("./exercisePickerUI.js"),
      import("./data/exerciseLibrary.js"),
      import("./smartAlternatives.js"),
      import("./exercisePicker.js")
    ]);

  return {
    attachExercisePicker:
      pickerUi.attachExercisePicker,
    library,
    rankAlternatives:
      smart.rankAlternatives,
    formatExerciseSubtitle:
      pickerHelpers.formatExerciseSubtitle
  };
}

function closeAlternativeSheet() {

  if (!alternativeSheet) {
    return;
  }

  const { root, controller, onKeyDown, opener, unfit } =
    alternativeSheet;

  alternativeSheet = null;

  document.removeEventListener(
    "keydown",
    onKeyDown,
    true
  );

  unfit?.();

  try {
    controller?.destroy();
  } catch (error) {
    // Nothing to clean up.
  }

  root.remove();

  opener?.focus?.();
}

async function applyAlternativeToday(
  exerciseIndex,
  slotId,
  libraryExerciseId,
  library
) {

  const session =
    currentWorkoutSession;

  // The session may have been closed or changed while the sheet was open.
  if (
    !session ||
    session.exercises[exerciseIndex]
      ?.exerciseId !== slotId
  ) {
    return {
      ok: false,
      message:
        "This workout changed. Please try again."
    };
  }

  // Always use the library's own record, never the picker's copy.
  let libraryExercise = null;

  try {
    libraryExercise =
      await library.getExercise(
        libraryExerciseId
      );
  } catch (error) {
    console.error(
      "Could not read the exercise library:",
      error
    );
  }

  if (!libraryExercise) {
    return {
      ok: false,
      message:
        "That exercise could not be loaded from the library. Nothing was changed."
    };
  }

  // The session can have changed during the await.
  if (
    currentWorkoutSession !== session ||
    session.exercises[exerciseIndex]
      ?.exerciseId !== slotId
  ) {
    return {
      ok: false,
      message:
        "This workout changed. Please try again."
    };
  }

  const result =
    applyAlternative(
      session,
      exerciseIndex,
      libraryExercise
    );

  if (!result.ok) {
    return result;
  }

  session.exercises[exerciseIndex] =
    result.exercise;

  persistActiveSession();

  await loadPreviousForExercise(
    session.exercises[exerciseIndex]
  );

  rerenderSessionExercises();

  return { ok: true };
}

async function restoreOriginalExercise(
  exerciseIndex
) {

  const exercise =
    currentWorkoutSession
      ?.exercises[exerciseIndex];

  if (
    !exercise ||
    !hasAlternative(exercise)
  ) {
    return;
  }

  const original =
    normalizeAlternative(
      exercise.alternativeToday
    ).original.name;

  if (
    hasEnteredData(exercise) &&
    !window.confirm(
      `Restore ${original}? Sets entered for ${exercise.name} will be cleared.`
    )
  ) {
    return;
  }

  currentWorkoutSession.exercises[exerciseIndex] =
    restoreOriginal(exercise);

  persistActiveSession();

  await loadPreviousForExercise(
    currentWorkoutSession.exercises[exerciseIndex]
  );

  rerenderSessionExercises();
}

async function openAlternativeSheet(
  exerciseIndex
) {

  const exercise =
    currentWorkoutSession
      ?.exercises[exerciseIndex];

  if (!exercise) {
    return;
  }

  closeAlternativeSheet();

  const slotId =
    exercise.exerciseId;

  const alternative =
    normalizeAlternative(
      exercise.alternativeToday
    );

  const plannedName =
    alternative
      ? alternative.original.name
      : exercise.name;

  const root =
    document.createElement("div");

  root.className =
    "alt-sheet-backdrop";

  root.id =
    "alt-today-sheet";

  root.innerHTML = `
    <div
      class="alt-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alt-sheet-title"
      tabindex="-1"
    >

      <div class="alt-sheet-header">

        <h3 id="alt-sheet-title">
          ALTERNATIVE TODAY
        </h3>

        <button
          type="button"
          class="workout-small-button"
          data-alt-cancel
        >
          Cancel
        </button>

      </div>

      <div class="alt-sheet-current">
        ${escapeHtml(plannedName)}
      </div>

      <p class="alt-sheet-lead">
        Choose a temporary replacement for today's session.
      </p>

      <p class="alt-sheet-lead alt-sheet-lead--strong">
        Your saved workout plan will NOT change.
        The replacement applies to TODAY ONLY.
      </p>

      <div class="alt-recommended" data-alt-recommended hidden>

        <div class="alt-recommended-label">
          RECOMMENDED
        </div>

        <ul
          class="alt-recommended-list"
          data-alt-recommended-list
        ></ul>

        <button
          type="button"
          class="workout-small-button alt-view-all"
          data-alt-view-all
        >
          VIEW ALL EXERCISES
        </button>

      </div>

      <button
        type="button"
        class="workout-small-button alt-back"
        data-alt-back
        hidden
      >
        ← RECOMMENDED
      </button>

      <div class="alt-picker-host" data-alt-picker-host>

        <div class="exercise-picker">

          <input
            type="text"
            class="form-input exercise-name-input"
            data-exercise-index="0"
            data-field="name"
            role="combobox"
            aria-label="Search exercises"
            aria-expanded="false"
            aria-autocomplete="list"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint="search"
            placeholder="Search exercises..."
          >

          <ul
            class="exercise-picker-list"
            role="listbox"
          ></ul>

          <div class="exercise-link-status"></div>

          <div
            class="exercise-picker-note"
            hidden
          >
            The exercise library could not be loaded.
            Your workout was not changed.
          </div>

        </div>

      </div>

      <div
        class="alt-sheet-hint"
        data-alt-hint
        hidden
      ></div>

      <div
        class="alt-sheet-summary"
        data-alt-summary
        hidden
      ></div>

      <div
        class="alt-sheet-error"
        data-alt-error
        role="alert"
        hidden
      ></div>

      <div class="alt-sheet-actions">

        <button
          type="button"
          class="workout-primary-button"
          data-alt-confirm
          disabled
        >
          USE THIS TODAY
        </button>

        <button
          type="button"
          class="workout-small-button alt-sheet-cancel"
          data-alt-cancel
        >
          CANCEL
        </button>

      </div>

    </div>
  `;

  const part = selector =>
    root.querySelector(selector);

  const setText = (selector, text) => {

    const element =
      part(selector);

    element.textContent =
      text || "";

    element.hidden =
      !text;
  };

  let pending = null;

  let busy = false;

  const setSummary = (original, replacement, warning) => {

    const element =
      part("[data-alt-summary]");

    element.hidden =
      !replacement;

    element.innerHTML =
      replacement
        ? `
          <div class="alt-summary-label">
            TODAY'S ALTERNATIVE
          </div>

          <div class="alt-summary-from">
            ${escapeHtml(original)}
          </div>

          <div class="alt-summary-arrow" aria-hidden="true">
            ↓
          </div>

          <div class="alt-summary-to">
            ${escapeHtml(replacement)}
          </div>

          <div class="alt-summary-note">
            Your saved workout plan is unchanged.
            ${warning ? escapeHtml(warning) : ""}
          </div>
        `
        : "";
  };

  const clearPending = () => {

    pending = null;

    part("[data-alt-confirm]")
      .disabled = true;

    setSummary("", "");
    setText("[data-alt-error]", "");
  };

  const onKeyDown = event => {

    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();

    closeAlternativeSheet();
  };

  document.body.appendChild(root);

  // Keep the sheet inside the VISIBLE area: when the phone keyboard opens the
  // visual viewport shrinks, and the list scrolls inside what is left.
  const viewport = window.visualViewport;

  const fit = () => {
    root.style.setProperty(
      "--alt-vv-height",
      `${Math.max(240, viewport.height - 24)}px`
    );
  };

  if (viewport) {
    fit();
    viewport.addEventListener("resize", fit);
  }

  alternativeSheet = {
    root,
    controller: null,
    unfit: viewport
      ? () => viewport.removeEventListener("resize", fit)
      : null,
    onKeyDown,
    opener:
      document.querySelector(
        `[data-alt-open="${exerciseIndex}"]`
      )
  };

  document.addEventListener(
    "keydown",
    onKeyDown,
    true
  );

  root
    .querySelectorAll("[data-alt-cancel]")
    .forEach(button =>
      button.addEventListener(
        "click",
        closeAlternativeSheet
      )
    );

  root.addEventListener(
    "click",
    event => {

      if (event.target === root) {
        closeAlternativeSheet();
      }
    }
  );

  const input =
    part(".exercise-name-input");

  let deps;

  try {
    deps =
      await loadAlternativePicker();
  } catch (error) {

    console.error(
      "Could not load the exercise picker:",
      error
    );

    part(".exercise-picker-note")
      .hidden = false;

    input.disabled = true;

    return;
  }

  // Closed (or replaced by another sheet) while the picker was loading.
  if (alternativeSheet?.root !== root) {
    return;
  }

  // ---- choosing (shared by recommended rows and the full list) -------------

  const choose = libraryExercise => {

    const check =
      validateReplacement(
        currentWorkoutSession,
        exerciseIndex,
        libraryExercise
      );

    if (!check.ok) {

      pending = null;

      part("[data-alt-confirm]")
        .disabled = true;

      setSummary("", "");
      setText("[data-alt-error]", check.message);

      return;
    }

    pending = libraryExercise;

    setText("[data-alt-error]", "");

    const current =
      currentWorkoutSession
        ?.exercises[exerciseIndex];

    const warning =
      hasEnteredData(current)
        ? ` Sets already entered for ${current.name} will be cleared.`
        : "";

    setSummary(
      plannedName,
      libraryExercise.name,
      warning.trim()
    );

    part("[data-alt-confirm]")
      .disabled = false;
  };

  const markRecommended = id => {

    root
      .querySelectorAll(".alt-recommended-option")
      .forEach(option =>
        option.classList.toggle(
          "is-selected",
          option.dataset.exerciseId === id
        )
      );
  };

  // ---- recommended / all modes ---------------------------------------------

  let hasRecommended = false;

  const setMode = mode => {

    const all =
      mode === "all" || !hasRecommended;

    root.classList.toggle("alt-sheet--all", all);
    root.querySelector(".alt-sheet")?.classList.toggle("alt-sheet--all", all);

    part("[data-alt-recommended]")
      .hidden = all || !hasRecommended;

    part("[data-alt-back]")
      .hidden = !(all && hasRecommended);
  };

  alternativeSheet.controller =
    deps.attachExercisePicker(
      part("[data-alt-picker-host]"),
      {
        library: deps.library,

        // Library exercises only: no custom row.
        allowCustom: false,

        // The list stays open, shows the whole library and scrolls inside.
        pinned: true,

        // The picker reads this to fill the input and the status line.
        getExercise: () =>
          pending
            ? {
                id: "alternative-today",
                name: pending.name,
                libraryExerciseId: pending.id
              }
            : { id: "alternative-today", name: input.value },

        // Typing again discards any earlier choice.
        onNameInput: () => {
          clearPending();
          markRecommended(null);
        },

        onSelect: (index, libraryExercise) => {
          markRecommended(null);
          choose(libraryExercise);
        },

        // Not reachable (allowCustom is false); kept so the picker contract holds.
        onChooseCustom: () => {},

        onResults: (query, count) => {

          if (query || count > 0) {
            setMode("all");
          }

          setText(
            "[data-alt-hint]",
            query && count === 0
              ? `No library exercise matches "${query}".`
              : ""
          );
        }
      }
    );

  // ---- smart recommendations (library metadata only) -----------------------

  let allExercises = [];

  try {

    if (typeof deps.library.getAllExercises === "function") {

      allExercises =
        await deps.library.getAllExercises();

      const plannedId =
        alternative
          ? alternative.original.libraryExerciseId
          : exercise.libraryExerciseId;

      let original = null;

      if (plannedId) {
        original =
          await deps.library.getExercise(plannedId);
      }

      // Unlinked (custom) plan exercise: an EXACT library name/alias match is
      // used for ranking only. Nothing is linked or saved.
      if (
        !original &&
        typeof deps.library.findExerciseByName === "function"
      ) {
        original =
          await deps.library.findExerciseByName(plannedName);
      }

      if (original) {

        const ranked =
          deps.rankAlternatives(
            original,
            allExercises,
            {
              limit: 0,
              excludeIds: alternative
                ? [alternative.libraryExerciseId]
                : []
            }
          );

        const usable =
          ranked
            .filter(candidate =>
              validateReplacement(
                currentWorkoutSession,
                exerciseIndex,
                candidate
              ).ok
            )
            .slice(0, 5);

        const list =
          part("[data-alt-recommended-list]");

        usable.forEach(candidate => {

          const item =
            document.createElement("li");

          const button =
            document.createElement("button");

          button.type = "button";
          button.className =
            "alt-recommended-option";
          button.dataset.exerciseId =
            candidate.id;

          const name =
            document.createElement("span");

          name.className =
            "exercise-picker-option-name";
          name.textContent =
            candidate.name;

          const sub =
            document.createElement("span");

          sub.className =
            "exercise-picker-option-sub";
          sub.textContent =
            deps.formatExerciseSubtitle(candidate);

          button.append(name, sub);

          button.addEventListener(
            "click",
            () => {
              clearPending();
              markRecommended(candidate.id);
              choose(candidate);
            }
          );

          item.append(button);
          list.append(item);
        });

        hasRecommended = usable.length > 0;
      }
    }

  } catch (error) {

    // Recommendations are optional: the full list still works.
    console.error(
      "Could not build recommendations:",
      error
    );

    hasRecommended = false;
  }

  // The sheet may have been closed while recommendations were computed.
  if (alternativeSheet?.root !== root) {
    return;
  }

  part("[data-alt-view-all]")
    .addEventListener(
      "click",
      () => {
        setMode("all");
        alternativeSheet?.controller?.openAll();
      }
    );

  part("[data-alt-back]")
    .addEventListener(
      "click",
      () => {
        input.value = "";
        clearPending();
        markRecommended(null);
        setText("[data-alt-hint]", "");
        alternativeSheet?.controller?.closeAll();
        setMode("recommended");
      }
    );

  setMode("recommended");

  // Without recommendations the full library is shown straight away.
  if (!hasRecommended) {
    alternativeSheet.controller.openAll();
  }

  part("[data-alt-confirm]")
    .addEventListener(
      "click",
      async () => {

        if (!pending || busy) {
          return;
        }

        busy = true;

        part("[data-alt-confirm]")
          .disabled = true;

        const result =
          await applyAlternativeToday(
            exerciseIndex,
            slotId,
            pending.id,
            deps.library
          );

        busy = false;

        if (result.ok) {

          closeAlternativeSheet();

          return;
        }

        // Fail safely: the session and the plan are untouched.
        pending = null;

        setSummary("", "");
        setText("[data-alt-error]", result.message);
      }
    );

  // Focus the dialog, not the search box: the phone keyboard stays closed
  // until the user chooses to search.
  part(".alt-sheet").focus?.();
}


// ============================================================================
// CLOSE SESSION
// ============================================================================

function closeWorkoutSession({ keepStored = false } = {}) {
  // Closing/completing discards the stored session.
  // keepStored is only used when the user signs out or switches account.
  if (!keepStored) {
    clearActiveSession();
  }

  closeAlternativeSheet();

  setSessionViewActive(false);

  currentWorkoutPlan =
    null;

  currentWorkoutSession =
    null;


  const container =
    document.getElementById(
      "workout-session-container"
    );

  if (container) {

    container.innerHTML =
      "";

    container.classList.remove(
      "active"
    );

  }


  const weeklySchedule =
    document.querySelector(
      ".weekly-schedule"
    );

  if (weeklySchedule) {

    weeklySchedule.style.display =
      "";

  }


  const workoutActionBar =
    document.querySelector(
      ".workout-action-bar"
    );

  if (workoutActionBar) {

    workoutActionBar.style.display =
      "";

  }

}


// ============================================================================
// COMPLETE WORKOUT
// ============================================================================

let completionInFlight = false;

async function handleCompleteWorkout() {

  // A double tap (or a second trigger) must not complete the workout twice.
  if (!currentWorkoutSession || completionInFlight) {
    return;
  }


  const validation =
    validateWorkoutSession();


  if (!validation.valid) {

    window.alert(
      validation.message
    );

    return;
  }


  const completeButton =
    document.getElementById(
      "complete-workout-button"
    );


  completionInFlight = true;

  try {

    if (completeButton) {

      completeButton.disabled =
        true;
    }

    const uid =
      getAuthenticatedUserId();

    if (!currentWorkoutSession.syncId) {
      currentWorkoutSession.syncId = createSyncId();
    }

    currentWorkoutSession.status =
      "completed";

    const syncId =
      currentWorkoutSession.syncId;

    // 1. Save the finished workout ON THIS DEVICE first. If this throws, the
    //    session below is untouched and the user can simply try again.
    const log =
      toStorableLog(
        buildLogSession(
          currentWorkoutSession
        )
      );

    enqueuePending(uid, syncId, log, localStorage);

    // 2. The queue now owns the workout; the temporary session can go.
    clearActiveSession();

    closeWorkoutSession();

    // 3. Sync in the background. The UI is never blocked on the network.
    const online =
      globalThis.navigator?.onLine !== false;

    showSyncStatus(
      online
        ? "SYNCING"
        : "OFFLINE — SAVING LOCALLY",
      {
        detail: online
          ? ""
          : SAVED_LOCALLY_MESSAGE
      }
    );

    if (online) {
      syncPendingWorkouts({ announce: true });
    }

  } catch (error) {

    console.error(
      "Failed to save workout:",
      error
    );

    window.alert(
      "Could not save the workout. Please try again."
    );

    // Still an unfinished session: keep it and keep it restorable.
    if (currentWorkoutSession) {
      currentWorkoutSession.status = "in-progress";
      persistActiveSession();
    }

    if (completeButton) {

      completeButton.disabled =
        false;
    }

  } finally {

    completionInFlight = false;
  }

}


// ============================================================================
// PENDING WORKOUT SYNC + STATUS
// ----------------------------------------------------------------------------
// Completed workouts wait in a local queue (pendingWorkouts.js) until Firestore
// confirms them. Failures keep them queued and are retried later; the log
// document id is the workout's syncId, so a retry can never duplicate a log.
// ============================================================================

const SAVED_LOCALLY_MESSAGE =
  "Workout saved on this device. It will sync when you're back online.";

const SYNC_RETRY_MS = 30000;

let syncRetryTimer = null;
let statusHideTimer = null;

// Plain JSON (no previous-performance data, dates as ISO strings).
function toStorableLog(log) {
  const copy = JSON.parse(JSON.stringify(log));

  if (Array.isArray(copy.exercises)) {
    copy.exercises = copy.exercises.map(
      ({ previousLog, ...exercise }) => exercise
    );
  }

  copy.createdAt = new Date().toISOString();

  return copy;
}

function writePendingLog(uid, syncId, log) {
  return saveWorkoutLogOnce(uid, syncId, {
    ...log,
    date: new Date(log.date),
    createdAt: new Date(log.createdAt)
  });
}

function getStatusElement() {
  let element = document.getElementById("sync-status");

  if (!element && document.body) {
    element = document.createElement("div");
    element.id = "sync-status";
    element.className = "sync-status";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.hidden = true;
    document.body.appendChild(element);
  }

  return element;
}

function showSyncStatus(label, { detail = "", hideAfterMs = 0 } = {}) {
  const element = getStatusElement();

  if (!element) {
    return;
  }

  clearTimeout(statusHideTimer);

  element.innerHTML = "";

  const strong = document.createElement("strong");
  strong.textContent = label;
  element.appendChild(strong);

  if (detail) {
    const text = document.createElement("span");
    text.textContent = detail;
    element.appendChild(text);
  }

  element.dataset.state =
    label.startsWith("OFFLINE") ? "offline"
      : label === "SYNCING" ? "syncing"
        : "saved";

  element.hidden = false;

  if (hideAfterMs) {
    statusHideTimer = setTimeout(hideSyncStatus, hideAfterMs);
  }
}

function hideSyncStatus() {
  const element = document.getElementById("sync-status");

  if (element) {
    element.hidden = true;
  }
}

function safeUserId() {
  try {
    return getAuthenticatedUserId();
  } catch (error) {
    return null;
  }
}

function hasPendingWorkouts() {
  const uid = safeUserId();

  return Boolean(uid) && readPending(uid, localStorage).length > 0;
}

// Shows the quiet connectivity indicator only when it matters.
function refreshConnectivityStatus() {
  const offline = globalThis.navigator?.onLine === false;

  if (offline && (currentWorkoutSession || hasPendingWorkouts())) {
    showSyncStatus("OFFLINE — SAVING LOCALLY", {
      detail: hasPendingWorkouts() ? SAVED_LOCALLY_MESSAGE : ""
    });
    return;
  }

  if (!offline && !hasPendingWorkouts()) {
    hideSyncStatus();
  }
}

async function syncPendingWorkouts({ announce = false } = {}) {
  const uid = safeUserId();

  if (!uid || readPending(uid, localStorage).length === 0) {
    return null;
  }

  if (globalThis.navigator?.onLine === false) {
    refreshConnectivityStatus();
    return null;
  }

  showSyncStatus("SYNCING");

  const result = await syncPending(
    uid,
    (syncId, log) => writePendingLog(uid, syncId, log),
    {
    storage: localStorage,
    isCurrentUser: () => safeUserId() === uid,
    onItemSynced: item => {
      window.dispatchEvent(
        new CustomEvent("recomposition-workout-updated", {
          detail: { logId: item.id }
        })
      );
    }
    }
  );

  // The account changed mid-sync: that queue was left untouched, and the
  // sync for the account now signed in is started by its own sign-in.
  if (result.skipped) {
    refreshConnectivityStatus();
    return result;
  }

  clearTimeout(syncRetryTimer);

  if (result.remaining > 0) {
    // Keep the workout; try again later. Never reported as cloud-saved.
    showSyncStatus(
      globalThis.navigator?.onLine === false
        ? "OFFLINE — SAVING LOCALLY"
        : "SYNC PENDING",
      {
        detail: SAVED_LOCALLY_MESSAGE
      }
    );

    syncRetryTimer = setTimeout(
      () => syncPendingWorkouts(),
      SYNC_RETRY_MS
    );
  } else if (result.synced > 0) {
    showSyncStatus("SAVED", {
      detail: "Workout saved to your account.",
      hideAfterMs: 4000
    });
  } else {
    refreshConnectivityStatus();
  }

  return result;
}

window.addEventListener("online", () => syncPendingWorkouts());
window.addEventListener("offline", refreshConnectivityStatus);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncPendingWorkouts();
  }
});


// ============================================================================
// OPEN WORKOUT SESSION
// ============================================================================

export async function openWorkoutSession(
  planId
) {
  try {
    // A session is already in progress.
    if (currentWorkoutSession) {
      // Same workout: just resume it (never wipe entered data).
      if (currentWorkoutSession.planId === planId) {
        showActiveSessionView();
        await renderWorkoutSession();
        return;
      }

      // Different workout: do not silently discard the unfinished one.
      const startNew = window.confirm(
        "A workout is already in progress. Discard it and start a new one?"
      );

      if (!startNew) {
        showActiveSessionView();
        await renderWorkoutSession();
        return;
      }
    }

    const plan =
      await getWorkoutPlan(
        planId
      );


    if (!plan) {

      console.error(
        "Workout plan not found:",
        planId
      );

      window.alert(
        "Workout plan could not be found."
      );

      return;
    }


    currentWorkoutPlan =
      plan;


    currentWorkoutSession =
      createWorkoutSession(
        plan
      );


    const container =
      getSessionContainer();


    if (!container) {
      return;
    }


    const weeklySchedule =
      document.querySelector(
        ".weekly-schedule"
      );

    if (weeklySchedule) {

      weeklySchedule.style.display =
        "none";

    }


    const workoutActionBar =
      document.querySelector(
        ".workout-action-bar"
      );

    if (workoutActionBar) {

      workoutActionBar.style.display =
        "none";

    }


        container.classList.add(
      "active"
    );

    setSessionViewActive(true);

    persistActiveSession();

    await renderWorkoutSession();
  } catch (error) {
    console.error(
      "Failed to open workout session:",
      error
    );

  }

}


// ============================================================================
// SHOW / RESTORE ACTIVE SESSION
// ============================================================================

function showActiveSessionView() {
  const container =
    getSessionContainer();

  if (!container) {
    return;
  }

  const weeklySchedule =
    document.querySelector(".weekly-schedule");

  if (weeklySchedule) {
    weeklySchedule.style.display = "none";
  }

  const workoutActionBar =
    document.querySelector(".workout-action-bar");

  if (workoutActionBar) {
    workoutActionBar.style.display = "none";
  }

  container.classList.add("active");

  // The Workout screen can re-render after sign-in; this class keeps the
  // plan list hidden while a session is active regardless of render order.
  setSessionViewActive(true);
}

async function restoreActiveSession(uid) {
  const key = getActiveSessionKey(uid);

  let stored;

  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return;
    }

    stored = JSON.parse(raw);
  } catch (error) {
    console.error("Stored workout session is unreadable:", error);
    clearActiveSession(uid);
    return;
  }

  if (
    !stored ||
    !stored.planId ||
    !Array.isArray(stored.exercises)
  ) {
    clearActiveSession(uid);
    return;
  }

  const { completing, savedAt, ...session } = stored;

  session.status = "in-progress";

  session.date = new Date(session.date);

  if (Number.isNaN(session.date.getTime())) {
    session.date = new Date(savedAt || Date.now());
  }

  session.exercises = session.exercises.map(exercise =>
    sanitizeSessionExercise({
      ...exercise,
      sets: Array.isArray(exercise.sets) ? exercise.sets : [],
      previousLog: null
    })
  );

  // Finished on this device already (waiting in the sync queue): never offer
  // it again as an unfinished session.
  if (session.syncId && isPending(uid, session.syncId, localStorage)) {
    clearActiveSession(uid);
    return;
  }

  // The page was refreshed WHILE the workout was being saved.
  // If that log reached Firestore, do not offer the session again.
  if (completing) {
    try {
      const logs = await getWorkoutLogs();

      const alreadySaved = logs.some(log =>
        log.planId === session.planId &&
        toMillis(log.date) === session.date.getTime()
      );

      if (alreadySaved) {
        clearActiveSession(uid);
        return;
      }
    } catch (error) {
      console.error(
        "Could not verify whether the workout was saved:",
        error
      );
    }
  }

  // The user already started something while this was loading.
  if (currentWorkoutSession) {
    return;
  }

  currentWorkoutPlan = null;
  currentWorkoutSession = session;

  showActiveSessionView();
  await renderWorkoutSession();
}

// Restore after sign-in. On sign-out / account switch, only the in-memory
// session is dropped: the stored copy stays for that user's next sign-in.
onAuthStateChanged(auth, async user => {
  if (currentWorkoutSession) {
    closeWorkoutSession({ keepStored: true });
  }

  if (!user) {
    return;
  }

  await restoreActiveSession(user.uid);

  // Workouts finished earlier (possibly offline) that never reached Firestore.
  syncPendingWorkouts();
  refreshConnectivityStatus();
});


// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionWorkoutLogger = {
  openWorkoutSession
};