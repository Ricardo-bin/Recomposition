// ============================================================================
// RECOMPOSITION — Dashboard
// ============================================================================

import {
  getProfile,
  getWorkoutPlans,
  getWorkoutLogs,
  getWeightHistory,
  getGoals
} from "./data/recompositionData.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import {
  auth
} from "./firebase.js";

import {
  formatWeight,
  normalizeWeightUnit,
  weightUnitLabel
} from "./units.js";

import {
  resolveCurrentWeight
} from "./currentWeight.js";
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


function formatDate(dateValue) {

  if (!dateValue) {
    return "—";
  }

  let date;

  if (
    dateValue &&
    typeof dateValue.toDate === "function"
  ) {
    date = dateValue.toDate();
  } else {
    date = new Date(dateValue);
  }

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric"
    }
  );
}


// ============================================================================
// DASHBOARD HELPERS
// ============================================================================

function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.toLocaleDateString("en-CA");
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay() === 0 ? 7 : start.getDay();
  start.setDate(start.getDate() - (day - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

function countLoggedSets(log) {
  if (!Array.isArray(log?.exercises)) return 0;
  return log.exercises.reduce((total, exercise) => {
    const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
    return total + sets.filter(set =>
      String(set?.weight ?? "") !== "" || String(set?.reps ?? "") !== ""
    ).length;
  }, 0);
}

function findActiveGoal(goals) {
  const today = dateKey(new Date());
  return goals
    .filter(goal =>
      (!goal.startDate || goal.startDate <= today) &&
      (!goal.endDate || goal.endDate >= today)
    )
    .sort((a, b) =>
      String(b.startDate || "").localeCompare(String(a.startDate || ""))
    )[0] || null;
}

function safeLoad(promise, fallback) {
  return promise.catch(error => {
    console.error("Dashboard optional data failed:", error);
    return fallback;
  });
}


// ============================================================================
// DASHBOARD RENDERING
// ============================================================================

async function renderDashboard() {

  const container = document.getElementById("dashboard-content");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="section-label">RECOMPOSITION SYSTEM</div>
      <h1 class="page-title">Loading...</h1>
      <p class="page-subtitle">Preparing your training dashboard.</p>
    </div>
    <div class="loading-state">Loading your data…</div>
  `;

  try {

    const [
      profile,
      workoutPlans,
      workoutLogs,
      weightHistory,
      goals
    ] = await Promise.all([
      getProfile(),
      getWorkoutPlans(),
      getWorkoutLogs(),
      safeLoad(getWeightHistory(), []),
      safeLoad(getGoals(), [])
    ]);

    const userName = profile?.name || "Athlete";

    // Weight History is the source of truth (the same resolver Profile and
    // Goals use). The old profile weight is only a fallback when there are no
    // weigh-ins.
    const currentWeight = resolveCurrentWeight(
      weightHistory,
      profile?.currentWeight
    );

    const latestWeightEntry =
      currentWeight.source === "weight-history";

    const weight = currentWeight.weightKg;
    // Stored weights are kilograms; the preference only changes the display.
    const weightUnit =
      normalizeWeightUnit(profile?.unitPreference);

    const hasWeight =
      weight !== null && weight !== undefined && weight !== "";

    const completedLogs = workoutLogs.filter(
      log => log.status === "completed"
    );

    const todayKey = dateKey(new Date());

    const todayCompletedPlanIds = completedLogs
      .filter(log => {
        const logDate = toDate(log.date);
        return logDate && dateKey(logDate) === todayKey;
      })
      .map(log => log.planId)
      .filter(Boolean);

    const todayDayNumber =
      new Date().getDay() === 0 ? 7 : new Date().getDay();

    const todayPlans = workoutPlans.filter(
      plan => Number(plan.dayOfWeek) === todayDayNumber
    );

    const weekStart = startOfWeek(new Date());
    const workoutsThisWeek = completedLogs.filter(log => {
      const logDate = toDate(log.date);
      return logDate && logDate >= weekStart;
    }).length;

    const scheduledPerWeek = new Set(
      workoutPlans.map(plan => Number(plan.dayOfWeek)).filter(Boolean)
    ).size;

    const recentLogs = completedLogs.slice(0, 3);
    const activeGoal = findActiveGoal(goals);

    const allTodayDone =
      todayPlans.length > 0 &&
      todayPlans.every(plan => todayCompletedPlanIds.includes(plan.id));

    container.innerHTML = `

      <!-- HEADER -->
      <div class="page-header">
        <div class="section-label">COMMAND CENTER</div>
        <h1 class="page-title">Welcome, ${escapeHTML(userName)}.</h1>
        <p class="page-subtitle">
          ${
            todayPlans.length === 0
              ? "No workout scheduled today."
              : allTodayDone
                ? "Today's training is complete. Recover well."
                : "Your training for today is ready."
          }
        </p>
      </div>


      <!-- TODAY -->
      <section class="section">
        <div class="dash-section-row">
          <div class="section-label">TODAY'S TRAINING</div>
          <button type="button" class="dash-link-button"
                  id="dashboard-open-workout">
            ALL WORKOUTS →
          </button>
        </div>

        ${
          todayPlans.length
            ? todayPlans.map(plan => {
                const done = todayCompletedPlanIds.includes(plan.id);
                const exerciseCount =
                  Array.isArray(plan.exercises) ? plan.exercises.length : 0;
                return `
                  <article class="card dash-today-card ${done ? "is-done" : ""}">
                    <div class="dash-today-top">
                      <div>
                        <div class="dash-card-label">
                          ${done ? "COMPLETED" : "SCHEDULED"}
                        </div>
                        <h2 class="dash-today-name">
                          ${escapeHTML(plan.name || "Workout")}
                        </h2>
                        <div class="dash-today-meta">
                          ${escapeHTML(plan.focus || "General training")}
                          · ${exerciseCount}
                          exercise${exerciseCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      ${done ? `<div class="dash-done-badge">✓</div>` : ""}
                    </div>
                    ${
                      done
                        ? `<button type="button" class="btn btn-secondary dash-full-button" disabled>
                             ✓ COMPLETED TODAY
                           </button>`
                        : `<button type="button" class="btn btn-primary dash-full-button"
                                  data-dashboard-log-plan="${escapeHTML(plan.id)}">
                             START WORKOUT
                           </button>`
                    }
                  </article>
                `;
              }).join("")
            : `
              <div class="empty-state">
                <h3>Rest day</h3>
                <p>Your weekly schedule has no workout for today.</p>
              </div>
            `
        }
      </section>


      <!-- CURRENT STATUS -->
      <section class="section">
        <div class="section-label">CURRENT STATUS</div>

        <div class="dash-status-grid">
          <article class="stat-card dash-stat">
            <div class="stat-label">CURRENT WEIGHT</div>
            <div class="stat-value">
              ${hasWeight ? escapeHTML(formatWeight(weight, weightUnit, { withUnit: false })) : "—"}
              ${hasWeight ? `<span class="stat-unit">${weightUnitLabel(weightUnit)}</span>` : ""}
            </div>
            <div class="stat-note">
              ${latestWeightEntry ? "Latest weigh-in" : "Add a weigh-in in Settings"}
            </div>
          </article>

          <article class="stat-card dash-stat">
            <div class="stat-label">THIS WEEK</div>
            <div class="stat-value">
              ${workoutsThisWeek}${
                scheduledPerWeek
                  ? `<span class="stat-unit">/ ${scheduledPerWeek}</span>`
                  : ""
              }
            </div>
            <div class="stat-note">Workouts completed</div>
          </article>
        </div>

        <article class="card dash-goal-card">
          <div class="dash-card-label">ACTIVE GOAL</div>
          ${
            activeGoal
              ? `
                <h2 class="dash-goal-name">
                  ${escapeHTML(activeGoal.goalType || "Custom")}
                </h2>
                <div class="dash-macros">
                  <span><strong>${escapeHTML(activeGoal.calories ?? "—")}</strong> kcal</span>
                  <span><strong>${escapeHTML(activeGoal.protein ?? "—")}</strong> g protein</span>
                  ${activeGoal.carbs ? `<span><strong>${escapeHTML(activeGoal.carbs)}</strong> g carbs</span>` : ""}
                  ${activeGoal.fat ? `<span><strong>${escapeHTML(activeGoal.fat)}</strong> g fat</span>` : ""}
                </div>
              `
              : `
                <h2 class="dash-goal-name is-empty">Not set</h2>
                <div class="dash-today-meta">
                  Set nutrition targets in Settings → Goals.
                </div>
              `
          }
        </article>
      </section>


      <!-- RECENT TRAINING -->
      <section class="section">
        <div class="dash-section-row">
          <div class="section-label">RECENT TRAINING</div>
          ${
            recentLogs.length
              ? `<button type="button" class="dash-link-button"
                         id="dashboard-open-history">VIEW HISTORY →</button>`
              : ""
          }
        </div>

        ${
          recentLogs.length
            ? `<div class="card dash-recent-list">
                ${recentLogs.map(log => {
                  const exerciseCount =
                    Array.isArray(log.exercises) ? log.exercises.length : 0;
                  return `
                    <div class="dash-recent-row">
                      <div class="dash-recent-main">
                        <div class="dash-recent-name">
                          ${escapeHTML(log.workoutName || log.name || "Workout")}
                        </div>
                        <div class="dash-recent-date">${formatDate(log.date)}</div>
                      </div>
                      <div class="dash-recent-meta">
                        ${exerciseCount} ex · ${countLoggedSets(log)} sets
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>`
            : `
              <div class="empty-state">
                <h3>No workouts yet</h3>
                <p>Complete your first workout and it will appear here.</p>
              </div>
            `
        }
      </section>


      <!-- ATHLETE -->
      <section class="section">
        <article class="card dash-athlete">
          <div class="dash-athlete-info">
            <div class="dash-card-label">ATHLETE</div>
            <div class="dash-athlete-line">
              ${[
                profile?.age ? `${escapeHTML(profile.age)} yrs` : null,
                profile?.height ? `${escapeHTML(profile.height)} cm` : null,
                profile?.trainingExperience
                  ? escapeHTML(profile.trainingExperience)
                  : null
              ].filter(Boolean).join(" · ") || "Profile incomplete"}
            </div>
          </div>
          <button type="button" class="btn btn-secondary"
                  id="dashboard-open-profile">
            PROFILE
          </button>
        </article>
      </section>
    `;


    // ========================================================================
    // DASHBOARD BUTTONS
    // ========================================================================

    document
      .getElementById("dashboard-open-workout")
      ?.addEventListener("click", () => {
        window.RecompositionNavigation?.showSection("workout");
      });

    document
      .getElementById("dashboard-open-history")
      ?.addEventListener("click", () => {
        window.RecompositionNavigation?.showSection("history");
      });

    document
      .querySelectorAll("[data-dashboard-log-plan]")
      .forEach(button => {
        button.addEventListener("click", async () => {

          const planId = button.dataset.dashboardLogPlan;
          const logger = window.RecompositionWorkoutLogger;

          if (!planId || !logger?.openWorkoutSession) {
            window.RecompositionNavigation?.showSection("workout");
            return;
          }

          button.disabled = true;

          try {
            window.RecompositionNavigation?.showSection("workout");
            await logger.openWorkoutSession(planId);
          } finally {
            button.disabled = false;
          }

        });
      });

    document
      .getElementById("dashboard-open-profile")
      ?.addEventListener("click", () => {
        window.RecompositionNavigation?.showSection("settings");
        document.getElementById("settings-profile")?.click();
      });

  } catch (error) {

    console.error("Dashboard failed to load:", error);

    container.innerHTML = `
      <div class="page-header">
        <div class="section-label">SYSTEM ERROR</div>
        <h1 class="page-title">Dashboard unavailable</h1>
        <p class="page-subtitle">
          Recomposition could not load your dashboard data.
        </p>
      </div>
      <div class="error-state">
        <h3>Something went wrong</h3>
        <p>Check your connection and refresh. Details are in the console.</p>
      </div>
    `;
  }
}


// ============================================================================
// START
// ============================================================================
//
// Firebase authentication may take a moment to restore the existing session.
// Do NOT render the dashboard until Firebase confirms that a user exists.
// ============================================================================

onAuthStateChanged(auth, async (user) => {

  if (!user) {


    return;
  }


  await renderDashboard();

});


// ============================================================================
// WORKOUT DATA REFRESH
// ============================================================================

// The profile document can finish being created after the first render
// (new registrations). Re-render once it is ready so the name appears.
window.addEventListener(
  "recomposition-profile-ready",
  async () => {
    if (auth.currentUser) {
      await renderDashboard();
    }
  }
);

window.addEventListener(
  "recomposition-workout-updated",
  async () => {
    if (auth.currentUser) {
      await renderDashboard();
    }
  }
);


// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionDashboard = {
  render: renderDashboard
};