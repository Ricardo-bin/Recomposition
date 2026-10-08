// ============================================================================
// RECOMPOSITION — Workout PLAN editor (Settings → Edit Workouts)
// ----------------------------------------------------------------------------
// The ONLY place where workout plans are created, edited or deleted.
// Mounted by settings.js into #settings-workouts-page. The Workout section
// (workout.js) is execution-only and never imports this module.
// ============================================================================

import {
  getWorkoutPlans,
  createWorkoutPlan,
  updateWorkoutPlan,
  deleteWorkoutPlan
} from "./data/recompositionData.js";

import {
  loadExerciseLibrary
} from "./data/exerciseLibrary.js";

import {
  applyLibrarySelection,
  applyNameEdit,
  clearLibraryLink,
  getLinkStatus,
  libraryLinkField
} from "./exercisePicker.js";

import {
  attachExercisePicker
} from "./exercisePickerUI.js";


// ============================================================================
// CONSTANTS
// ============================================================================

const DAYS = [
  {
    value: 1,
    name: "Monday"
  },
  {
    value: 2,
    name: "Tuesday"
  },
  {
    value: 3,
    name: "Wednesday"
  },
  {
    value: 4,
    name: "Thursday"
  },
  {
    value: 5,
    name: "Friday"
  },
  {
    value: 6,
    name: "Saturday"
  },
  {
    value: 7,
    name: "Sunday"
  }
];


// ============================================================================
// STATE
// ============================================================================

let workoutPlans = [];

let editingPlanId = null;

let editingExercises = [];

// slot id -> the library exercise that slot was linked to when it was loaded or
// last picked. Typing in the name box unlinks an exercise, so this is how a
// later pick of a DIFFERENT library exercise is recognised as a new exercise
// (and given a new slot id). Editor-session only; never saved.
const slotLibraryOrigin = new Map();

let workoutRenderRequestId = 0;

const EDITOR_CONTAINER_ID = "settings-workouts-page";


// ============================================================================
// HELPERS
// ============================================================================

function escapeHTML(value) {

  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function getDayName(dayNumber) {

  const day = DAYS.find(
    item => item.value === Number(dayNumber)
  );

  return day ? day.name : "Unassigned";
}


function getTodayDayNumber() {

  const javascriptDay =
    new Date().getDay();

  return javascriptDay === 0
    ? 7
    : javascriptDay;
}


// The Workout tab (execution-only) refreshes itself when a plan changes.
function announcePlansChanged() {
  window.dispatchEvent(
    new window.CustomEvent("recomposition-plans-updated")
  );
}


// ============================================================================
// MAIN RENDER
// ============================================================================

async function renderWorkout() {   // = render the plan editor

  const renderRequestId = ++workoutRenderRequestId;

  const container =
    document.getElementById(EDITOR_CONTAINER_ID);

  if (!container) {
    return;
  }


  container.innerHTML = `

    <p class="section-description">Permanent changes to your plan. To train today, use the Workout tab.</p>

    <div class="loading-row">
      Loading workout plans...
    </div>

  `;


  try {

    const loadedPlans =
      await getWorkoutPlans();

    // Ignore an older async render if a newer render has already started.
    if (renderRequestId !== workoutRenderRequestId) {
      return;
    }

    // Keep each Firestore document only once in the in-memory render list.
    // We intentionally do NOT deduplicate by workout name because users may
    // legitimately create two workouts with the same name.
    const uniquePlans = [];
    const seenPlanIds = new Set();

    for (const plan of loadedPlans) {
      if (!plan?.id || seenPlanIds.has(plan.id)) {
        continue;
      }

      seenPlanIds.add(plan.id);
      uniquePlans.push(plan);
    }

    workoutPlans = uniquePlans;

    renderWorkoutInterface(container);

  } catch (error) {

    console.error(
      "Workout failed to load:",
      error
    );


    container.innerHTML = `

      <div class="section-heading">

        <div class="section-kicker">
          SYSTEM ERROR
        </div>

        <h1 class="section-title">
          Workout unavailable
        </h1>

        <p class="section-description">
          Recomposition could not load your workout plans.
        </p>

      </div>


      <div class="empty-state">

        <div class="empty-state-title">
          Something went wrong
        </div>

        <div class="empty-state-text">
          Check the browser console for the technical error.
        </div>

      </div>

    `;

  }

}


// ============================================================================
// WORKOUT INTERFACE
// ============================================================================

function renderWorkoutInterface(container) {

  const today =
    getTodayDayNumber();


  container.innerHTML = `

    <p class="section-description">Permanent changes to your plan. To train today, use the Workout tab.</p>


    <!-- ACTION BAR -->

    <div class="workout-action-bar">

      <div>

        <div class="panel-title">
          WEEKLY SCHEDULE
        </div>

        <div class="panel-subtitle">
          Create any split you want. Recomposition does not force a routine.
        </div>

      </div>


      <button
        type="button"
        class="btn btn-primary"
        id="btn-create-workout-plan"
      >
        + CREATE WORKOUT
      </button>

    </div>


    <!-- WEEKLY SCHEDULE -->

    <div class="weekly-schedule">

      ${
        DAYS.map(day => {

          const plansForDay =
            workoutPlans.filter(
              plan =>
                Number(plan.dayOfWeek) === day.value
            );


          const isToday =
            today === day.value;


          return `

            <article
              class="
                workout-day-card
                ${isToday ? "today" : ""}
              "
            >

              <div class="workout-day-top">

                <div>

                  <div class="workout-day-number">
                    DAY ${day.value}
                  </div>

                  <div class="workout-day-name">
                    ${day.name}
                  </div>

                </div>

                ${
                  isToday
                    ? `
                      <span class="today-badge">
                        TODAY
                      </span>
                    `
                    : ""
                }

              </div>


              <div class="workout-day-plans">

                ${
                  plansForDay.length > 0

                    ? plansForDay
                        .map(
                          plan =>
                            renderWorkoutPlanCard(plan)
                        )
                        .join("")

                    : `

                      <div class="rest-day">

                        <span class="rest-day-icon">
                          —
                        </span>

                        <span>
                          Rest / No workout
                        </span>

                      </div>

                    `
                }

              </div>


              <button
                type="button"
                class="day-add-button"
                data-create-day="${day.value}"
              >
                + Add workout
              </button>

            </article>

          `;

        }).join("")

      }

    </div>


    <!-- WORKOUT PLAN FORM -->

    <div
      id="workout-plan-form-container"
      class="workout-form-container hidden"
    ></div>

  `;


  // ========================================================================
  // CREATE
  // ========================================================================

  document
    .getElementById("btn-create-workout-plan")
    ?.addEventListener(
      "click",
      () => openWorkoutForm()
    );


  // ========================================================================
  // ADD TO DAY
  // ========================================================================

  document
    .querySelectorAll("[data-create-day]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const day =
            Number(
              button.dataset.createDay
            );

          openWorkoutForm({
            dayOfWeek: day
          });

        }
      );

    });


  // ========================================================================
  // EDIT
  // ========================================================================

  document
    .querySelectorAll("[data-edit-plan]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const planId =
            button.dataset.editPlan;

          const plan =
            workoutPlans.find(
              item => item.id === planId
            );

          if (plan) {
            openWorkoutForm(plan);
          }

        }
      );

    });


  // ========================================================================
  // DELETE
  // ========================================================================

  document
    .querySelectorAll("[data-delete-plan]")
    .forEach(button => {

      button.addEventListener(
        "click",
        async () => {

          const planId =
            button.dataset.deletePlan;

          const plan =
            workoutPlans.find(
              item => item.id === planId
            );


          if (!plan) {
            return;
          }


          const confirmed =
            window.confirm(
              `Delete "${plan.name}"?`
            );


          if (!confirmed) {
            return;
          }


          try {

            button.disabled = true;

            await deleteWorkoutPlan(planId);

            announcePlansChanged();

            await renderWorkout();

          } catch (error) {

            console.error(
              "Workout deletion failed:",
              error
            );

            window.alert(
              "Could not delete the workout."
            );

            button.disabled = false;

          }

        }
      );

    });

}


// ============================================================================
// WORKOUT PLAN CARD
// ============================================================================

function renderWorkoutPlanCard(plan) {

  const exerciseCount =
    Array.isArray(plan.exercises)
      ? plan.exercises.length
      : 0;


  return `

    <div class="workout-plan-card">

      <div class="workout-plan-main">

        <div class="workout-plan-name">
          ${escapeHTML(plan.name || "Workout")}
        </div>

        <div class="workout-plan-focus">
          ${escapeHTML(plan.focus || "General training")}
        </div>

        <div class="workout-plan-exercise-count">
          ${exerciseCount}
          ${exerciseCount === 1 ? "exercise" : "exercises"}
        </div>

      </div>


    <div class="workout-plan-actions">

  <button
    type="button"
    class="workout-small-button"
    data-edit-plan="${escapeHTML(plan.id)}"
  >
    Edit
  </button>

  <button
    type="button"
    class="workout-small-button danger"
    data-delete-plan="${escapeHTML(plan.id)}"
  >
    Delete
  </button>

</div>

    </div>

  `;

}


// ============================================================================
// OPEN WORKOUT FORM
// ============================================================================

function openWorkoutForm(existingPlan = null) {

  const container =
    document.getElementById(
      "workout-plan-form-container"
    );

  if (!container) {
    return;
  }

  editingPlanId =
    existingPlan?.id || null;

  // Warm the exercise library cache. If it fails, the editor still works:
  // exercise names can always be typed as custom exercises.
  loadExerciseLibrary().catch(() => {});



  editingExercises =
    Array.isArray(existingPlan?.exercises)
      ? structuredClone(existingPlan.exercises)
      : [];

  slotLibraryOrigin.clear();

  editingExercises.forEach(exercise => {
    if (exercise?.id && exercise.libraryExerciseId) {
      slotLibraryOrigin.set(exercise.id, exercise.libraryExerciseId);
    }
  });


  const isEditing =
    Boolean(editingPlanId);


  const selectedDay =
    existingPlan?.dayOfWeek ||
    getTodayDayNumber();


  container.classList.remove("hidden");


  container.innerHTML = `

    <div class="panel workout-editor">

      <div class="panel-header">

        <div>

          <div class="panel-title">
            ${
              isEditing
                ? "EDIT WORKOUT"
                : "CREATE WORKOUT"
            }
          </div>

          <div class="panel-subtitle">
            ${
              isEditing
                ? "Update your workout plan and exercises."
                : "Create a workout and add its exercises."
            }
          </div>

        </div>


        <button
          type="button"
          class="btn btn-secondary"
          id="btn-close-workout-form"
        >
          CLOSE
        </button>

      </div>


      <!-- ================================================================
           WORKOUT DETAILS
      ================================================================= -->

      <div class="workout-editor-section">

        <div class="workout-editor-section-title">
          WORKOUT DETAILS
        </div>


        <div class="form-grid">


          <!-- NAME -->

          <div class="form-group full">

            <label
              class="form-label"
              for="workout-plan-name"
            >
              WORKOUT NAME
            </label>

            <input
              type="text"
              id="workout-plan-name"
              class="form-input"
              placeholder="e.g. Upper A"
              value="${escapeHTML(existingPlan?.name || "")}"
              maxlength="80"
            >

          </div>


          <!-- DAY -->

          <div class="form-group">

            <label
              class="form-label"
              for="workout-plan-day"
            >
              TRAINING DAY
            </label>

            <select
              id="workout-plan-day"
              class="form-select"
            >

              ${
                DAYS.map(day => `

                  <option
                    value="${day.value}"
                    ${
                      Number(selectedDay) === day.value
                        ? "selected"
                        : ""
                    }
                  >
                    ${day.name}
                  </option>

                `).join("")
              }

            </select>

          </div>


          <!-- FOCUS -->

          <div class="form-group">

            <label
              class="form-label"
              for="workout-plan-focus"
            >
              TRAINING FOCUS
            </label>

            <input
              type="text"
              id="workout-plan-focus"
              class="form-input"
              placeholder="e.g. Chest / Back / Arms"
              value="${escapeHTML(existingPlan?.focus || "")}"
              maxlength="120"
            >

          </div>


          <!-- TARGET RIR -->

          <div class="form-group">

            <label
              class="form-label"
              for="workout-plan-rir"
            >
              DEFAULT TARGET RIR
            </label>

            <input
              type="number"
              id="workout-plan-rir"
              class="form-input"
              placeholder="e.g. 2"
              min="0"
              max="5"
              step="1"
              value="${
                existingPlan?.targetRIR !== undefined &&
                existingPlan?.targetRIR !== null
                  ? escapeHTML(existingPlan.targetRIR)
                  : "2"
              }"
            >

          </div>


          <!-- REST -->

          <div class="form-group">

            <label
              class="form-label"
              for="workout-plan-rest"
            >
              DEFAULT REST (SECONDS)
            </label>

            <input
              type="number"
              id="workout-plan-rest"
              class="form-input"
              placeholder="e.g. 120"
              min="0"
              max="1800"
              step="15"
              value="${
                existingPlan?.defaultRestSeconds !== undefined &&
                existingPlan?.defaultRestSeconds !== null
                  ? escapeHTML(existingPlan.defaultRestSeconds)
                  : "120"
              }"
            >

          </div>


          <!-- NOTES -->

          <div class="form-group full">

            <label
              class="form-label"
              for="workout-plan-notes"
            >
              WORKOUT NOTES
            </label>

            <textarea
              id="workout-plan-notes"
              class="form-textarea"
              placeholder="Optional notes about this workout..."
            >${escapeHTML(existingPlan?.notes || "")}</textarea>

          </div>


        </div>

      </div>


      <!-- ================================================================
           EXERCISES
      ================================================================= -->

      <div class="workout-editor-section">

        <div class="workout-exercise-header">

          <div>

            <div class="workout-editor-section-title">
              EXERCISES
            </div>

            <div class="panel-subtitle">
              Add exercises in the exact order you want to perform them.
            </div>

          </div>


          <button
            type="button"
            class="btn btn-secondary"
            id="btn-add-exercise"
          >
            + ADD EXERCISE
          </button>

        </div>


        <div
          id="exercise-list"
          class="exercise-builder-list"
        ></div>


        <div
          id="exercise-empty-state"
          class="empty-state exercise-empty-state"
        >

          <div class="empty-state-title">
            No exercises yet
          </div>

          <div class="empty-state-text">
            Add your first exercise to this workout.
          </div>

          <button
            type="button"
            class="btn btn-secondary"
            id="btn-add-first-exercise"
          >
            + ADD EXERCISE
          </button>

        </div>

      </div>


      <!-- ================================================================
           SAVE
      ================================================================= -->

      <div class="workout-editor-footer">

        <div
          id="workout-form-message"
          class="workout-form-message"
        ></div>

        <button
          type="button"
          class="btn btn-primary"
          id="btn-save-workout-plan"
        >
          ${
            isEditing
              ? "SAVE CHANGES"
              : "CREATE WORKOUT"
          }
        </button>

      </div>

    </div>

  `;


  renderExerciseList();


  // ========================================================================
  // CLOSE
  // ========================================================================

  document
    .getElementById("btn-close-workout-form")
    ?.addEventListener(
      "click",
      closeWorkoutForm
    );


  // ========================================================================
  // ADD EXERCISE
  // ========================================================================

  document
    .getElementById("btn-add-exercise")
    ?.addEventListener(
      "click",
      () => addExercise()
    );


  document
    .getElementById("btn-add-first-exercise")
    ?.addEventListener(
      "click",
      () => addExercise()
    );


  // ========================================================================
  // SAVE PLAN
  // ========================================================================

  document
    .getElementById("btn-save-workout-plan")
    ?.addEventListener(
      "click",
      saveWorkoutPlan
    );


  container.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

}


// ============================================================================
// CLOSE WORKOUT FORM
// ============================================================================

function closeWorkoutForm() {

  const container =
    document.getElementById(
      "workout-plan-form-container"
    );

  if (!container) {
    return;
  }


  editingPlanId = null;

  editingExercises = [];

  slotLibraryOrigin.clear();


  container.classList.add("hidden");

  container.innerHTML = "";

}


// ============================================================================
// ADD EXERCISE
// ============================================================================

function addExercise() {

  editingExercises.push({

    id:
      crypto.randomUUID(),

    name:
      "",

    sets:
      3,

    repMin:
      8,

    repMax:
      12,

    targetRIR:
      2,

    restSeconds:
      120,

    notes:
      ""

  });


  renderExerciseList();


  const cards =
    document.querySelectorAll(
      ".exercise-builder-card"
    );


  const newestCard =
    cards[cards.length - 1];


  newestCard?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });


  const input =
    newestCard?.querySelector(
      ".exercise-name-input"
    );


  input?.focus();

}


// ============================================================================
// EXERCISE PICKER CONTEXT
// ----------------------------------------------------------------------------
// exercise.id               = plan SLOT id (never changed here)
// exercise.libraryExerciseId = optional Exercise Library identity
//
// Only an explicit library selection links an exercise. Typing in the name
// box unlinks it. The prescription (sets, reps, RIR, rest, notes) is untouched.
// ============================================================================

function syncExerciseTitle(index) {
  const exercise =
    editingExercises[index];

  const title =
    document.querySelector(
      `[data-exercise-card="${index}"] .exercise-builder-name`
    );

  if (exercise && title) {
    title.textContent =
      exercise.name ||
      `Exercise ${index + 1}`;
  }
}

const exercisePickerContext = {

  getExercise(index) {
    return editingExercises[index];
  },

  // The user typed in the name box: any change unlinks the exercise.
  onNameInput(index, value) {
    if (!editingExercises[index]) {
      return;
    }

    editingExercises[index] =
      applyNameEdit(
        editingExercises[index],
        value
      );

    syncExerciseTitle(index);
  },

  // The user explicitly picked a library exercise.
  onSelect(index, libraryExercise) {
    if (!editingExercises[index]) {
      return;
    }

    const current = editingExercises[index];

    editingExercises[index] =
      applyLibrarySelection(
        current,
        libraryExercise,
        {
          previousLibraryExerciseId:
            current.libraryExerciseId ||
            slotLibraryOrigin.get(current.id)
        }
      );

    slotLibraryOrigin.set(
      editingExercises[index].id,
      libraryExercise.id
    );

    syncExerciseTitle(index);
  },

  // The user explicitly chose "use as a custom exercise".
  onChooseCustom(index, name) {
    if (!editingExercises[index]) {
      return;
    }

    editingExercises[index] =
      applyNameEdit(
        clearLibraryLink(
          editingExercises[index]
        ),
        name
      );

    syncExerciseTitle(index);
  }
};


// ============================================================================
// RENDER EXERCISES
// ============================================================================

function renderExerciseList() {

  const list =
    document.getElementById(
      "exercise-list"
    );

  const emptyState =
    document.getElementById(
      "exercise-empty-state"
    );


  if (!list || !emptyState) {
    return;
  }


  if (editingExercises.length === 0) {

    list.innerHTML = "";

    emptyState.classList.remove("hidden");

    return;

  }


  emptyState.classList.add("hidden");


  list.innerHTML =
    editingExercises
      .map(
        (exercise, index) =>
          renderExerciseCard(
            exercise,
            index
          )
      )
      .join("");


  // ========================================================================
  // EXERCISE EVENTS
  // ========================================================================

  list
    .querySelectorAll("[data-delete-exercise]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const index =
            Number(
              button.dataset.deleteExercise
            );

          deleteExercise(index);

        }
      );

    });


  list
    .querySelectorAll("[data-move-up]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          moveExercise(
            Number(button.dataset.moveUp),
            -1
          );

        }
      );

    });


  list
    .querySelectorAll("[data-move-down]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          moveExercise(
            Number(button.dataset.moveDown),
            1
          );

        }
      );

    });


  // ========================================================================
  // INPUT EVENTS
  // ========================================================================

  list
    .querySelectorAll("[data-exercise-index]")
    .forEach(input => {

      // The exercise name box is handled by the picker (it can link/unlink).
      if (input.dataset.field === "name") {
        return;
      }

      input.addEventListener(
        "input",
        () => {
          updateExerciseFromInput(
            input
          );
        }
      );
    });

  // ========================================================================
  // EXERCISE PICKER (one set of delegated listeners per list element)
  // ========================================================================

  attachExercisePicker(
    list,
    exercisePickerContext
  )?.hydrate();
}


// ============================================================================
// EXERCISE CARD
// ============================================================================

function renderExerciseCard(
  exercise,
  index
) {

  const isFirst =
    index === 0;


  const isLast =
    index === editingExercises.length - 1;

  // Provisional status (the stored name); refreshed asynchronously from the
  // library right after the list is rendered.
  const exerciseStatus =
    getLinkStatus(exercise, { name: exercise.name });

  return `
    <article
      class="exercise-builder-card"
      data-exercise-card="${index}"
    >


      <!-- EXERCISE HEADER -->

      <div class="exercise-builder-card-header">

        <div class="exercise-order">
          ${index + 1}
        </div>


        <div class="exercise-builder-title">

          <div class="exercise-builder-name">
            ${
              escapeHTML(
                exercise.name ||
                `Exercise ${index + 1}`
              )
            }
          </div>

          <div class="exercise-builder-summary">

            ${escapeHTML(exercise.sets || 0)} sets
            ·
            ${escapeHTML(exercise.repMin || 0)}–${escapeHTML(exercise.repMax || 0)} reps
            ·
            RIR ${escapeHTML(exercise.targetRIR ?? 2)}

          </div>

        </div>


        <div class="exercise-builder-actions">

          <button
            type="button"
            class="exercise-order-button"
            data-move-up="${index}"
            ${isFirst ? "disabled" : ""}
            title="Move up"
          >
            ↑
          </button>

          <button
            type="button"
            class="exercise-order-button"
            data-move-down="${index}"
            ${isLast ? "disabled" : ""}
            title="Move down"
          >
            ↓
          </button>

          <button
            type="button"
            class="exercise-delete-button"
            data-delete-exercise="${index}"
            title="Delete exercise"
          >
            Delete
          </button>

        </div>

      </div>


      <!-- EXERCISE FORM -->

      <div class="exercise-builder-fields">


        <!-- NAME -->

        <div class="form-group exercise-name-group">

          <label
            class="form-label"
            for="exercise-name-${index}"
          >
            EXERCISE
          </label>

          <div class="exercise-picker">
            <input
              type="text"
              id="exercise-name-${index}"
              class="form-input exercise-name-input"
              placeholder="Search library or type a custom name"
              maxlength="100"
              autocomplete="off"
              autocapitalize="words"
              spellcheck="false"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="false"
              aria-controls="exercise-picker-list-${index}"
              data-exercise-index="${index}"
              data-field="name"
              value="${escapeHTML(exercise.name || "")}"
            >

            <ul
              class="exercise-picker-list"
              id="exercise-picker-list-${index}"
              role="listbox"
            ></ul>

            <div
              class="exercise-link-status exercise-link-status--${exerciseStatus.kind}"
              data-link-kind="${exerciseStatus.kind}"
            >${escapeHTML(exerciseStatus.text)}</div>

            <div
              class="exercise-picker-note"
              role="status"
              hidden
            >
              Exercise library unavailable. You can still type a custom name.
            </div>
          </div>

        </div>


        <!-- SETS -->

        <div class="form-group">

          <label class="form-label">
            SETS
          </label>

          <input
            type="number"
            class="form-input"
            min="1"
            max="20"
            step="1"
            data-exercise-index="${index}"
            data-field="sets"
            value="${escapeHTML(exercise.sets ?? 3)}"
          >

        </div>


        <!-- REP MIN -->

        <div class="form-group">

          <label class="form-label">
            MIN REPS
          </label>

          <input
            type="number"
            class="form-input"
            min="1"
            max="100"
            step="1"
            data-exercise-index="${index}"
            data-field="repMin"
            value="${escapeHTML(exercise.repMin ?? 8)}"
          >

        </div>


        <!-- REP MAX -->

        <div class="form-group">

          <label class="form-label">
            MAX REPS
          </label>

          <input
            type="number"
            class="form-input"
            min="1"
            max="100"
            step="1"
            data-exercise-index="${index}"
            data-field="repMax"
            value="${escapeHTML(exercise.repMax ?? 12)}"
          >

        </div>


        <!-- RIR -->

        <div class="form-group">

          <label class="form-label">
            TARGET RIR
          </label>

          <input
            type="number"
            class="form-input"
            min="0"
            max="5"
            step="1"
            data-exercise-index="${index}"
            data-field="targetRIR"
            value="${escapeHTML(exercise.targetRIR ?? 2)}"
          >

        </div>


        <!-- REST -->

        <div class="form-group">

          <label class="form-label">
            REST (SEC)
          </label>

          <input
            type="number"
            class="form-input"
            min="0"
            max="1800"
            step="15"
            data-exercise-index="${index}"
            data-field="restSeconds"
            value="${escapeHTML(exercise.restSeconds ?? 120)}"
          >

        </div>


        <!-- NOTES -->

        <div class="form-group full">

          <label class="form-label">
            NOTES
          </label>

          <textarea
            class="form-textarea"
            placeholder="Optional exercise notes..."
            data-exercise-index="${index}"
            data-field="notes"
          >${escapeHTML(exercise.notes || "")}</textarea>

        </div>


      </div>

    </article>

  `;

}


// ============================================================================
// UPDATE EXERCISE FROM INPUT
// ============================================================================

function updateExerciseFromInput(input) {

  const index =
    Number(
      input.dataset.exerciseIndex
    );

  const field =
    input.dataset.field;

  const exercise =
    editingExercises[index];

  if (!exercise) {
    return;
  }

  if (field === "name") {

    // Any manual change unlinks the exercise from the library.
    editingExercises[index] =
      applyNameEdit(
        exercise,
        input.value
      );

  } else if (field === "notes") {

    exercise.notes =
      input.value;

  } else {

    exercise[field] =
      Number(input.value);
  }

  // Update summary/header without rebuilding
  // the entire list while typing the name.
  if (field !== "name") {
    return;
  }

  syncExerciseTitle(index);
}


// ============================================================================
// DELETE EXERCISE
// ============================================================================

function deleteExercise(index) {

  const exercise =
    editingExercises[index];


  if (!exercise) {
    return;
  }


  const confirmed =
    window.confirm(
      `Remove "${exercise.name || `Exercise ${index + 1}`}"?`
    );


  if (!confirmed) {
    return;
  }


  editingExercises.splice(
    index,
    1
  );


  renderExerciseList();

}


// ============================================================================
// MOVE EXERCISE
// ============================================================================

function moveExercise(
  index,
  direction
) {

  const newIndex =
    index + direction;


  if (
    newIndex < 0 ||
    newIndex >= editingExercises.length
  ) {
    return;
  }


  const temporary =
    editingExercises[index];


  editingExercises[index] =
    editingExercises[newIndex];


  editingExercises[newIndex] =
    temporary;


  renderExerciseList();

}


// ============================================================================
// SAVE WORKOUT PLAN
// ============================================================================

async function saveWorkoutPlan() {

  const button =
    document.getElementById(
      "btn-save-workout-plan"
    );


  const message =
    document.getElementById(
      "workout-form-message"
    );


  if (!button || !message) {
    return;
  }


  const name =
    document
      .getElementById("workout-plan-name")
      .value
      .trim();


  const dayOfWeek =
    Number(
      document
        .getElementById("workout-plan-day")
        .value
    );


  const focus =
    document
      .getElementById("workout-plan-focus")
      .value
      .trim();


  const targetRIR =
    Number(
      document
        .getElementById("workout-plan-rir")
        .value
    );


  const defaultRestSeconds =
    Number(
      document
        .getElementById("workout-plan-rest")
        .value
    );


  const notes =
    document
      .getElementById("workout-plan-notes")
      .value
      .trim();


  // ========================================================================
  // VALIDATION
  // ========================================================================

  if (!name) {

    message.textContent =
      "Please enter a workout name.";

    message.className =
      "workout-form-message error";

    return;

  }


  if (
    !Number.isInteger(dayOfWeek) ||
    dayOfWeek < 1 ||
    dayOfWeek > 7
  ) {

    message.textContent =
      "Please select a valid training day.";

    message.className =
      "workout-form-message error";

    return;

  }


  if (
    !Number.isFinite(targetRIR) ||
    targetRIR < 0 ||
    targetRIR > 5
  ) {

    message.textContent =
      "Target RIR must be between 0 and 5.";

    message.className =
      "workout-form-message error";

    return;

  }


  if (
    !Number.isFinite(defaultRestSeconds) ||
    defaultRestSeconds < 0 ||
    defaultRestSeconds > 1800
  ) {

    message.textContent =
      "Rest time must be between 0 and 1800 seconds.";

    message.className =
      "workout-form-message error";

    return;

  }


  // ========================================================================
  // VALIDATE EXERCISES
  // ========================================================================

  for (
    let index = 0;
    index < editingExercises.length;
    index++
  ) {

    const exercise =
      editingExercises[index];


    if (!exercise.name.trim()) {

      message.textContent =
        `Exercise ${index + 1} needs a name.`;

      message.className =
        "workout-form-message error";

      return;

    }


    if (
      !Number.isInteger(exercise.sets) ||
      exercise.sets < 1 ||
      exercise.sets > 20
    ) {

      message.textContent =
        `${exercise.name}: sets must be between 1 and 20.`;

      message.className =
        "workout-form-message error";

      return;

    }


    if (
      !Number.isInteger(exercise.repMin) ||
      exercise.repMin < 1 ||
      exercise.repMin > 100
    ) {

      message.textContent =
        `${exercise.name}: minimum reps are invalid.`;

      message.className =
        "workout-form-message error";

      return;

    }


    if (
      !Number.isInteger(exercise.repMax) ||
      exercise.repMax < exercise.repMin ||
      exercise.repMax > 100
    ) {

      message.textContent =
        `${exercise.name}: maximum reps must be >= minimum reps.`;

      message.className =
        "workout-form-message error";

      return;

    }


    if (
      !Number.isInteger(exercise.targetRIR) ||
      exercise.targetRIR < 0 ||
      exercise.targetRIR > 5
    ) {

      message.textContent =
        `${exercise.name}: RIR must be between 0 and 5.`;

      message.className =
        "workout-form-message error";

      return;

    }


    if (
      !Number.isFinite(exercise.restSeconds) ||
      exercise.restSeconds < 0 ||
      exercise.restSeconds > 1800
    ) {

      message.textContent =
        `${exercise.name}: rest time is invalid.`;

      message.className =
        "workout-form-message error";

      return;

    }

  }


  // ========================================================================
  // DATA
  // ========================================================================

  const workoutData = {

    name,

    dayOfWeek,

    focus,

    targetRIR,

    defaultRestSeconds,

    notes,

    exercises:
      editingExercises.map(
        exercise => ({
          id:
            exercise.id ||
            crypto.randomUUID(),

          name:
            exercise.name.trim(),

          sets:
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
            exercise.notes.trim(),

          // Optional. Present only for exercises explicitly linked to the
          // library; the key is omitted entirely otherwise.
          ...libraryLinkField(exercise)
        })
      )

  };


  // ========================================================================
  // SAVE
  // ========================================================================

  button.disabled = true;

  button.textContent =
    editingPlanId
      ? "SAVING..."
      : "CREATING...";


  message.textContent = "";


  try {

    if (editingPlanId) {

      await updateWorkoutPlan(
        editingPlanId,
        workoutData
      );

    } else {

      await createWorkoutPlan(
        workoutData
      );

    }


    announcePlansChanged();

    await renderWorkout();


  } catch (error) {

    console.error(
      "Workout save failed:",
      error
    );


    message.textContent =
      "Could not save the workout.";

    message.className =
      "workout-form-message error";


    button.disabled = false;

    button.textContent =
      editingPlanId
        ? "SAVE CHANGES"
        : "CREATE WORKOUT";

  }

}


// ============================================================================
// GLOBAL ACCESS (used by settings.js)
// ============================================================================

window.RecompositionWorkoutEditor = {
  render: renderWorkout
};


// Signed out: drop the previous user's plans and any half-edited plan.
window.addEventListener("recomposition-signed-out", () => {
  workoutPlans = [];
  editingPlanId = null;
  editingExercises = [];
  slotLibraryOrigin.clear();
  workoutRenderRequestId += 1;

  const form = document.getElementById("workout-plan-form-container");

  if (form) {
    form.classList.add("hidden");
    form.innerHTML = "";
  }
});

