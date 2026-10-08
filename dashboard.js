// ============================================================================
// RECOMPOSITION — Dashboard
// ----------------------------------------------------------------------------
// SUMMARY + LAUNCHPAD: "What should I do now?" then "How am I doing?".
// This file loads data, renders, navigates and wires events. Everything that is
// DERIVED (today's state, pending merge, week summary, weight/nutrition tiles)
// lives in the pure dashboardModel.js. Nothing here stores or calculates data.
// ============================================================================

import { isCompletedLog } from "./workoutLogStatus.js";

import { findActiveGoal } from "./activeGoal.js";

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

import { readPending } from "./pendingWorkouts.js";

import { dateKey } from "./historyView.js";

import { buildDashboardModel } from "./dashboardModel.js";


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

function safeLoad(promise, fallback) {
  return promise.catch(error => {
    console.error("Dashboard optional data failed:", error);
    return fallback;
  });
}


// ============================================================================
// SECTION MARKUP (presentation only: the model decides WHAT to show)
// ============================================================================

function renderHeader(model) {
  return `
    <div class="page-header">
      <div class="section-label">COMMAND CENTER</div>
      <h1 class="page-title">Welcome, ${escapeHTML(model.name)}.</h1>
      <p class="page-subtitle">${escapeHTML(model.today.subtitle)}</p>
    </div>
  `;
}

function renderSyncStrip(model) {
  if (model.sync.pendingCount === 0) {
    return "";
  }

  return `
    <div class="dash-sync" data-dash="sync" role="status">
      <strong>SYNC PENDING</strong>
      <span>${escapeHTML(model.sync.text)}</span>
    </div>
  `;
}

function planMeta(plan) {
  return `${escapeHTML(plan.focus || "General training")} · ${plan.exerciseCount} exercise${plan.exerciseCount === 1 ? "" : "s"}`;
}

function renderTodayCard(today) {

  // ---- A. workout in progress: RESUME, never START ------------------------------
  if (today.variant === "active") {
    return `
      <article class="card dash-today-card is-active" data-today="active">
        <div class="dash-today-top">
          <div>
            <div class="dash-card-label">IN PROGRESS</div>
            <h2 class="dash-today-name">${escapeHTML(today.name)}</h2>
            <div class="dash-today-meta">${escapeHTML(today.detail)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-primary dash-full-button"
                data-dashboard-resume="${escapeHTML(today.planId ?? "")}">
          RESUME
        </button>
      </article>
    `;
  }

  // ---- E. no plans at all (never "Rest day") ------------------------------------
  if (today.variant === "no-plans") {
    return `
      <article class="card dash-today-card" data-today="no-plans">
        <div class="dash-today-top">
          <div>
            <div class="dash-card-label">NO WORKOUT PLANS YET</div>
            <h2 class="dash-today-name">No workout plans yet</h2>
            <div class="dash-today-meta">Create a plan to start training.</div>
          </div>
        </div>
        <button type="button" class="btn btn-primary dash-full-button"
                data-dashboard-link="workouts">
          SET UP WORKOUT
        </button>
      </article>
    `;
  }

  // ---- D. plans exist, nothing scheduled today ----------------------------------
  if (today.variant === "rest") {
    const next = today.next
      ? `Next: ${escapeHTML(today.next.dayName)} · ${escapeHTML(today.next.planName)}${today.next.extraCount > 0 ? ` +${today.next.extraCount} more` : ""}`
      : "Nothing else is scheduled this week.";

    return `
      <article class="card dash-today-card" data-today="rest">
        <div class="dash-today-top">
          <div>
            <div class="dash-card-label">REST DAY</div>
            <h2 class="dash-today-name">Rest day</h2>
            <div class="dash-today-meta">${next}</div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary dash-full-button"
                data-dashboard-link="choose-workout">
          CHOOSE A WORKOUT
        </button>
      </article>
    `;
  }

  // ---- C. everything scheduled today is done -------------------------------------
  if (today.variant === "done") {
    const first = today.items[0];
    const more = today.items.length - 1;

    return `
      <article class="card dash-today-card is-done" data-today="done">
        <div class="dash-today-top">
          <div>
            <div class="dash-card-label">COMPLETED</div>
            <h2 class="dash-today-name">
              ${escapeHTML(first.name)}${more > 0 ? ` +${more} more` : ""}
            </h2>
            <div class="dash-today-meta">
              Done for today.${today.anyPending ? " Saved on this device, waiting to sync." : ""}
            </div>
          </div>
          <div class="dash-done-badge" aria-hidden="true">✓</div>
        </div>
        <button type="button" class="btn btn-secondary dash-full-button"
                data-dashboard-history-log="${escapeHTML(today.logId ?? "")}">
          VIEW IN HISTORY
        </button>
      </article>
    `;
  }

  // ---- B. scheduled today -----------------------------------------------------------
  if (today.items.length === 1) {
    const plan = today.items[0];

    return `
      <article class="card dash-today-card" data-today="scheduled">
        <div class="dash-today-top">
          <div>
            <div class="dash-card-label">SCHEDULED</div>
            <h2 class="dash-today-name">${escapeHTML(plan.name)}</h2>
            <div class="dash-today-meta">${planMeta(plan)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-primary dash-full-button"
                data-dashboard-log-plan="${escapeHTML(plan.id)}">
          START WORKOUT
        </button>
      </article>
    `;
  }

  // Several workouts today: one compact card, one row each.
  return `
    <article class="card dash-today-card" data-today="scheduled">
      <div class="dash-card-label">SCHEDULED · ${today.items.length} WORKOUTS</div>
      <div class="dash-today-list">
        ${today.items.map(plan => `
          <div class="dash-today-row ${plan.done ? "is-done" : ""}">
            <div class="dash-today-row-main">
              <div class="dash-today-row-name">${escapeHTML(plan.name)}</div>
              <div class="dash-today-meta">${planMeta(plan)}</div>
            </div>
            ${
              plan.done
                ? `<span class="dash-row-done">✓ DONE</span>`
                : `<button type="button" class="btn btn-primary dash-row-button"
                           data-dashboard-log-plan="${escapeHTML(plan.id)}">START</button>`
            }
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderWeightMetric(weight, unit) {
  const show = kg => formatWeight(kg, unit);

  let body;

  if (weight.state === "none") {
    body = `
      <div class="stat-value">—</div>
      <div class="stat-note">Add your first weigh-in</div>
    `;
  } else {
    let change = "";

    if (weight.changeKg !== null) {
      const shown = formatWeight(Math.abs(weight.changeKg), unit, { withUnit: false });

      change = Number(shown) === 0
        ? "No change since previous"
        : `${weight.changeKg > 0 ? "+" : "−"}${show(Math.abs(weight.changeKg))} since previous`;
    }

    const note =
      weight.state === "legacy"
        ? "From your earlier profile entry"
        : [change, weight.dateText].filter(Boolean).join(" · ") || "Latest weigh-in";

    body = `
      <div class="stat-value">
        ${escapeHTML(formatWeight(weight.valueKg, unit, { withUnit: false }))}
        <span class="stat-unit">${escapeHTML(weightUnitLabel(unit))}</span>
      </div>
      <div class="stat-note">${escapeHTML(note)}</div>
    `;
  }

  return `
    <button type="button" class="stat-card dash-metric" data-dashboard-link="weight">
      <div class="stat-label">CURRENT WEIGHT</div>
      ${body}
      <span class="dash-metric-link">WEIGHT HISTORY →</span>
    </button>
  `;
}

function renderNutritionMetric(nutrition) {
  let body;

  if (nutrition.state === "no-goal") {
    body = `
      <div class="dash-metric-name is-empty">No goal yet</div>
      <div class="stat-note">Set a goal and targets</div>
    `;
  } else if (nutrition.state === "no-targets") {
    body = `
      <div class="dash-metric-name">${escapeHTML(nutrition.goalName)}</div>
      <div class="stat-note">No targets saved yet</div>
    `;
  } else {
    body = `
      <div class="dash-metric-name">${escapeHTML(nutrition.goalName)}</div>
      <div class="dash-macros">
        ${nutrition.calories !== null ? `<span><strong>${nutrition.calories}</strong> kcal</span>` : ""}
        ${nutrition.protein !== null ? `<span><strong>${nutrition.protein}</strong> g protein</span>` : ""}
      </div>
    `;
  }

  return `
    <button type="button" class="stat-card dash-metric" data-dashboard-link="goals">
      <div class="stat-label">CURRENT GOAL</div>
      ${body}
      <span class="dash-metric-link">GOALS →</span>
    </button>
  `;
}

function renderRecent(recent) {
  return `
    <section class="section">
      <div class="dash-section-row">
        <div class="section-label">RECENT TRAINING</div>
        ${
          recent.length
            ? `<button type="button" class="dash-link-button"
                       id="dashboard-open-history">VIEW HISTORY →</button>`
            : ""
        }
      </div>

      ${
        recent.length
          ? `<div class="card dash-recent-list">
              ${recent.map(item => `
                <button type="button" class="dash-recent-row"
                        data-dashboard-open-log="${escapeHTML(item.id ?? "")}">
                  <span class="dash-recent-main">
                    <span class="dash-recent-name">${escapeHTML(item.name)}</span>
                    <span class="dash-recent-date">
                      ${escapeHTML(item.dateLabel)}${
                        item.isPending ? ` · <span class="dash-tag">PENDING SYNC</span>` : ""
                      }${
                        item.hasAlternative ? ` · <span class="dash-tag">ALTERNATIVE</span>` : ""
                      }
                    </span>
                  </span>
                  <span class="dash-recent-meta">
                    ${item.exerciseCount} ex · ${item.setCount} sets
                  </span>
                </button>
              `).join("")}
            </div>`
          : `
            <div class="empty-state">
              <h3>No workouts yet</h3>
              <p>Complete your first workout and it will appear here.</p>
            </div>
          `
      }
    </section>
  `;
}

function renderNudge(nudge) {
  if (!nudge) {
    return "";
  }

  return `
    <section class="section">
      <button type="button" class="card dash-nudge" data-dashboard-link="profile">
        <span class="dash-card-label">COMPLETE YOUR PROFILE</span>
        <span class="dash-nudge-text">
          Add the missing details (${escapeHTML(nudge.missing.join(", "))}) for better personalization.
        </span>
      </button>
    </section>
  `;
}

function renderDashboardMarkup(model, weightUnit) {
  const hasPlans = model.today.variant !== "no-plans";

  return `

    ${renderHeader(model)}

    ${renderSyncStrip(model)}

    <!-- TODAY -->
    <section class="section">
      <div class="dash-section-row">
        <div class="section-label">TODAY'S TRAINING</div>
        ${
          hasPlans && model.today.variant !== "rest"
            ? `<button type="button" class="dash-link-button"
                       id="dashboard-open-workout">ALL WORKOUTS →</button>`
            : ""
        }
      </div>

      ${renderTodayCard(model.today)}

      <div class="dash-week" data-dash="week">
        <span class="dash-card-label">THIS WEEK</span>
        <span class="dash-week-text">${escapeHTML(model.week.text)}</span>
      </div>
    </section>

    <!-- BODY + NUTRITION -->
    <section class="section">
      <div class="dash-metric-grid">
        ${renderWeightMetric(model.weight, weightUnit)}
        ${renderNutritionMetric(model.nutrition)}
      </div>
    </section>

    ${renderRecent(model.recent)}

    ${renderNudge(model.profileNudge)}
  `;
}


// ============================================================================
// NAVIGATION (the Dashboard only launches; it never edits)
// ============================================================================

function showSection(name) {
  window.RecompositionNavigation?.showSection(name);
}

// Settings pages are opened the same way Progress does it: switch to Settings,
// then press the page's own entry button.
function openSettingsPage(buttonId) {
  showSection("settings");
  document.getElementById(buttonId)?.click();
}

const SETTINGS_TARGETS = {
  weight: "settings-weight",
  goals: "settings-goals",
  workouts: "settings-workouts",
  profile: "settings-profile"
};

function wireDashboard(container) {

  const on = (selector, handler) =>
    container.querySelectorAll(selector).forEach(element => handler(element));

  on("#dashboard-open-workout", button =>
    button.addEventListener("click", () => showSection("workout")));

  on("#dashboard-open-history", button =>
    button.addEventListener("click", () => showSection("history")));

  on("[data-dashboard-link]", button =>
    button.addEventListener("click", () => {
      const target = button.dataset.dashboardLink;

      if (target === "choose-workout") {
        showSection("workout");
        return;
      }

      openSettingsPage(SETTINGS_TARGETS[target]);
    }));

  // START: the same hand-over the Workout screen uses.
  on("[data-dashboard-log-plan]", button =>
    button.addEventListener("click", async () => {

      const planId = button.dataset.dashboardLogPlan;
      const logger = window.RecompositionWorkoutLogger;

      if (!planId || !logger?.openWorkoutSession) {
        showSection("workout");
        return;
      }

      button.disabled = true;

      try {
        showSection("workout");
        await logger.openWorkoutSession(planId);
      } finally {
        button.disabled = false;
      }
    }));

  // RESUME: opening the SAME plan resumes the existing session untouched.
  on("[data-dashboard-resume]", button =>
    button.addEventListener("click", async () => {

      const planId = button.dataset.dashboardResume;
      const logger = window.RecompositionWorkoutLogger;

      showSection("workout");

      if (planId && logger?.openWorkoutSession) {
        button.disabled = true;

        try {
          await logger.openWorkoutSession(planId);
        } finally {
          button.disabled = false;
        }
      }
    }));

  // History: open that workout's detail (or the list when there is no single one).
  const openHistory = logId => {
    if (logId) {
      window.RecompositionHistory?.requestOpenWorkout?.(logId);
    }

    showSection("history");
  };

  on("[data-dashboard-open-log]", button =>
    button.addEventListener("click", () => openHistory(button.dataset.dashboardOpenLog)));

  on("[data-dashboard-history-log]", button =>
    button.addEventListener("click", () => openHistory(button.dataset.dashboardHistoryLog)));
}


// ============================================================================
// DASHBOARD RENDERING
// ============================================================================

// Only the NEWEST render may paint: an older one that finishes later is dropped.
let renderRequest = 0;
let lastRenderAt = 0;
let stale = false;               // a change happened while the Dashboard was hidden

const REFRESH_FRESH_MS = 2000;   // returning to the tab right after a render re-uses it

async function renderDashboard() {

  const container = document.getElementById("dashboard-content");

  if (!container) {
    return;
  }

  const request = ++renderRequest;

  // The loading screen is only for the very first paint. Later renders keep
  // the current screen until the new one is ready (no flash, no scroll jump).
  if (!container.dataset.ready) {
    container.innerHTML = `
      <div class="page-header">
        <div class="section-label">RECOMPOSITION SYSTEM</div>
        <h1 class="page-title">Loading...</h1>
        <p class="page-subtitle">Preparing your training dashboard.</p>
      </div>
      <div class="loading-state">Loading your data…</div>
    `;
  }

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

    // A newer render started (or the user signed out) while this one loaded.
    if (request !== renderRequest) {
      return;
    }

    // Weight History is the source of truth (the same resolver Profile and
    // Goals use). The old profile weight is only a fallback when there are no
    // weigh-ins.
    const currentWeight = resolveCurrentWeight(
      weightHistory,
      profile?.currentWeight
    );

    // Stored weights are kilograms; the preference only changes the display.
    const weightUnit =
      normalizeWeightUnit(profile?.unitPreference);

    // The EXISTING pending-workout queue and the Workout screen's own
    // read-only view of an unfinished session. Nothing is copied or stored.
    const uid = auth?.currentUser?.uid;

    const model = buildDashboardModel({
      profile,
      plans: workoutPlans,
      logs: workoutLogs.filter(isCompletedLog),
      pendingItems: uid ? readPending(uid) : [],
      currentWeight,
      weightHistory,
      activeGoal: findActiveGoal(goals, dateKey(new Date())),
      activeSession:
        window.RecompositionWorkoutLogger?.getActiveSessionSummary?.() ?? null,
      now: new Date()
    });

    container.innerHTML = renderDashboardMarkup(model, weightUnit);
    container.dataset.ready = "1";

    stale = false;
    lastRenderAt = Date.now();

    wireDashboard(container);

  } catch (error) {

    if (request !== renderRequest) {
      return;
    }

    console.error("Dashboard failed to load:", error);

    // A background refresh that fails keeps what is already on screen.
    if (container.dataset.ready) {
      return;
    }

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

function dashboardIsVisible() {
  const section = document.getElementById("section-dashboard");

  return !section || section.classList.contains("active");
}

// Returning to the Dashboard tab (called by navigation.js).
function refreshDashboard() {
  if (!auth?.currentUser) {
    return Promise.resolve();
  }

  const container = document.getElementById("dashboard-content");

  const fresh =
    container?.dataset.ready &&
    !stale &&
    Date.now() - lastRenderAt < REFRESH_FRESH_MS;

  return fresh ? Promise.resolve() : renderDashboard();
}

// Something changed. Render now if the Dashboard is on screen; otherwise just
// remember, and the next visit renders (no work for a hidden screen).
async function refreshAfterChange() {
  if (!auth?.currentUser) {
    return;
  }

  if (!dashboardIsVisible()) {
    stale = true;
    return;
  }

  await renderDashboard();
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

  await refreshAfterChange();

});


// ============================================================================
// EXISTING APPLICATION EVENTS
// ============================================================================

// The profile document can finish being created after the first render
// (new registrations). Re-render once it is ready so the name appears.
window.addEventListener("recomposition-profile-ready", refreshAfterChange);

// A workout was saved, synced, edited or deleted.
window.addEventListener("recomposition-workout-updated", refreshAfterChange);

// Workout plans were edited in Settings.
window.addEventListener("recomposition-plans-updated", refreshAfterChange);

// An unfinished workout was restored after sign-in.
window.addEventListener("recomposition-session-changed", refreshAfterChange);


// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionDashboard = {
  render: renderDashboard,
  refresh: refreshDashboard
};


// ============================================================================
// SIGN-OUT: drop the previous user's screen
// ============================================================================

window.addEventListener("recomposition-signed-out", () => {
  renderRequest += 1;        // a render still loading must not paint later
  stale = false;

  const container = document.getElementById("dashboard-content");

  if (container) {
    container.innerHTML = "";
    delete container.dataset.ready;
  }
});
