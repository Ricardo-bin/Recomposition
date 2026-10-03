// ============================================================================
// RECOMPOSITION — Workout Session Logger
// ============================================================================

import {
  getWorkoutPlan,
  getPreviousWorkoutLog,
  getWorkoutLogs,
  createWorkoutLog,
  getAuthenticatedUserId
} from "./data/recompositionData.js";

import { auth } from "./firebase.js";

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
      async exercise => {

        try {

          exercise.previousLog =
            await getPreviousWorkoutLog(
              currentWorkoutSession.planId,
              exercise.exerciseId,
              currentWorkoutSession.date
            );

        } catch (error) {

          console.error(
            `Could not load previous performance for ${exercise.name}:`,
            error
          );

          exercise.previousLog =
            null;
        }

      }
    )

  );
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
        exercise.exerciseId
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
        exercise.exerciseId
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
// CLOSE SESSION
// ============================================================================

function closeWorkoutSession({ keepStored = false } = {}) {
  // Closing/completing discards the stored session.
  // keepStored is only used when the user signs out or switches account.
  if (!keepStored) {
    clearActiveSession();
  }

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

async function handleCompleteWorkout() {

  if (!currentWorkoutSession) {
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


  try {

    if (completeButton) {

      completeButton.disabled =
        true;

      completeButton.textContent =
        "Saving...";
    }


        currentWorkoutSession.status =
      "completed";

    // Flag the stored copy: if the page is refreshed while saving, the
    // restore step checks Firestore before offering the session again.
    persistActiveSession({ completing: true });



        const logId =
      await createWorkoutLog(
        currentWorkoutSession
      );

    // The log now exists: drop the temporary session immediately.
    clearActiveSession();




    window.dispatchEvent(
      new CustomEvent("recomposition-workout-updated", {
        detail: { logId }
      })
    );

    closeWorkoutSession();


    window.alert(
      "Workout completed and saved."
    );


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

      completeButton.textContent =
        "Complete Workout";
    }

  }

}


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

  session.exercises = session.exercises.map(exercise => ({
    ...exercise,
    sets: Array.isArray(exercise.sets) ? exercise.sets : [],
    previousLog: null
  }));

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
});


// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionWorkoutLogger = {
  openWorkoutSession
};