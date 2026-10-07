// ============================================================================
// RECOMPOSITION — Workout (execution only)
// ----------------------------------------------------------------------------
// WORKOUT = "What am I training today?"  ->  START WORKOUT.
//
// This screen NEVER edits a plan: no create, edit, delete, reorder or exercise
// settings. Permanent plan editing lives only in
// Settings -> Edit Workouts. Exercises appear once the
// session starts (logWorkout.js), which is also where Alternative Today lives.
// ============================================================================

import {
  getWorkoutPlans
} from "./data/recompositionData.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import {
  auth
} from "./firebase.js";


const DAYS = [
  { value: 1, name: "Monday" },
  { value: 2, name: "Tuesday" },
  { value: 3, name: "Wednesday" },
  { value: 4, name: "Thursday" },
  { value: 5, name: "Friday" },
  { value: 6, name: "Saturday" },
  { value: 7, name: "Sunday" }
];

let workoutPlans = [];

let workoutRenderRequestId = 0;


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

function getTodayDayNumber() {

  const javascriptDay =
    new Date().getDay();

  return javascriptDay === 0
    ? 7
    : javascriptDay;
}

const exerciseCountOf = plan =>
  Array.isArray(plan.exercises)
    ? plan.exercises.length
    : 0;

const exerciseCountLabel = plan => {
  const count = exerciseCountOf(plan);

  return `${count} ${count === 1 ? "exercise" : "exercises"}`;
};

function heading(kicker, title, description) {

  return `
    <div class="section-heading">

      <div class="section-kicker">
        ${kicker}
      </div>

      <h1 class="section-title">
        ${title}
      </h1>

      <p class="section-description">
        ${description}
      </p>

    </div>
  `;
}


// ============================================================================
// RENDER
// ============================================================================

async function renderWorkout() {

  const renderRequestId = ++workoutRenderRequestId;

  const container =
    document.getElementById("workout-content");

  if (!container) {
    return;
  }

  container.innerHTML = `
    ${heading("TRAINING SYSTEM", "Workout", "What are you training today?")}

    <div class="loading-row">
      Loading today's workout...
    </div>
  `;

  try {

    const loadedPlans =
      await getWorkoutPlans();

    // Ignore an older async render if a newer one has started.
    if (renderRequestId !== workoutRenderRequestId) {
      return;
    }

    const unique = [];
    const seen = new Set();

    for (const plan of loadedPlans) {

      if (!plan?.id || seen.has(plan.id)) {
        continue;
      }

      seen.add(plan.id);
      unique.push(plan);
    }

    workoutPlans = unique;

    renderWorkoutInterface(container);

  } catch (error) {

    console.error(
      "Workout failed to load:",
      error
    );

    container.innerHTML = `
      ${heading("SYSTEM ERROR", "Workout unavailable", "Recomposition could not load your workout plans.")}

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

function renderTodayCard(plan) {

  return `
    <article class="workout-today-card">

      <div class="workout-today-kicker">
        TODAY
      </div>

      <div class="workout-today-name">
        ${escapeHTML(plan.name || "Workout")}
      </div>

      <div class="workout-today-meta">
        ${exerciseCountLabel(plan)}
        ${plan.focus ? ` · ${escapeHTML(plan.focus)}` : ""}
      </div>

      <button
        type="button"
        class="btn btn-primary workout-start-button"
        data-start-plan="${escapeHTML(plan.id)}"
      >
        START WORKOUT
      </button>

    </article>
  `;
}

function renderWorkoutInterface(container) {

  const today =
    getTodayDayNumber();

  const todayPlans =
    workoutPlans.filter(
      plan => Number(plan.dayOfWeek) === today
    );

  const todayMarkup =
    todayPlans.length > 0
      ? todayPlans.map(renderTodayCard).join("")
      : `
        <div class="workout-today-card workout-today-card--rest">

          <div class="workout-today-kicker">
            TODAY
          </div>

          <div class="workout-today-name">
            ${workoutPlans.length === 0 ? "No workouts yet" : "Rest day"}
          </div>

          <div class="workout-today-meta">
            ${
              workoutPlans.length === 0
                ? "Create your workouts in Settings → Edit Workouts."
                : "Nothing is scheduled today. You can still start a workout below."
            }
          </div>

        </div>
      `;

  container.innerHTML = `
    ${heading("TRAINING SYSTEM", "Workout", "What are you training today?")}

    <div class="workout-today">
      ${todayMarkup}
    </div>

    <div class="weekly-schedule">

      ${DAYS.map(day => {

        const plansForDay =
          workoutPlans.filter(
            plan => Number(plan.dayOfWeek) === day.value
          );

        const isToday =
          today === day.value;

        return `
          <article class="workout-day-card ${isToday ? "today" : ""}">

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
                  ? `<span class="today-badge">TODAY</span>`
                  : ""
              }

            </div>

            <div class="workout-day-plans">

              ${
                plansForDay.length > 0
                  ? plansForDay.map(plan => `
                      <div class="workout-plan-card">

                        <div class="workout-plan-main">

                          <div class="workout-plan-name">
                            ${escapeHTML(plan.name || "Workout")}
                          </div>

                          <div class="workout-plan-exercise-count">
                            ${exerciseCountLabel(plan)}
                          </div>

                        </div>

                        <div class="workout-plan-actions">

                          <button
                            type="button"
                            class="workout-small-button workout-log-button"
                            data-start-plan="${escapeHTML(plan.id)}"
                          >
                            Start
                          </button>

                        </div>

                      </div>
                    `).join("")
                  : `
                    <div class="rest-day">
                      <span class="rest-day-icon">—</span>
                      <span>Rest / No workout</span>
                    </div>
                  `
              }

            </div>

          </article>
        `;
      }).join("")}

    </div>
  `;

  container
    .querySelectorAll("[data-start-plan]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => startWorkout(button)
      );
    });
}


// ============================================================================
// START WORKOUT -> hands over to the session logger
// ============================================================================

async function startWorkout(button) {

  const planId =
    button.dataset.startPlan;

  if (!planId) {
    return;
  }

  const logger =
    window.RecompositionWorkoutLogger;

  if (
    !logger ||
    typeof logger.openWorkoutSession !== "function"
  ) {

    console.error("Workout logger is not available.");

    window.alert(
      "Workout logger is not ready. Please refresh the page and try again."
    );

    return;
  }

  try {

    button.disabled = true;

    await logger.openWorkoutSession(planId);

  } catch (error) {

    console.error(
      "Failed to open workout session:",
      error
    );

    window.alert(
      "Could not open the workout session."
    );

  } finally {

    button.disabled = false;
  }
}


// ============================================================================
// AUTHENTICATION / REFRESH
// ============================================================================

onAuthStateChanged(
  auth,
  async user => {

    if (!user) {
      return;
    }

    await renderWorkout();
  }
);

// Plans are edited in Settings; show the change next time Workout is seen.
window.addEventListener(
  "recomposition-plans-updated",
  () => { renderWorkout(); }
);

window.RecompositionWorkout = {
  render: renderWorkout
};


// Signed out: drop the previous user's plans and screen.
window.addEventListener("recomposition-signed-out", () => {
  workoutPlans = [];
  workoutRenderRequestId += 1;      // a render still in flight must not paint

  const container = document.getElementById("workout-content");

  if (container) {
    container.innerHTML = "";
  }
});

