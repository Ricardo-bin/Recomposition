// ============================================================================
// RECOMPOSITION — PROGRESS
// ============================================================================

import { isCompletedLog } from "./workoutLogStatus.js";

import {
  getAllWorkoutLogs,
  getWeightHistory,
  getMeasurements,
  getProfile,
  getGoals
} from "./data/recompositionData.js";

import { findActiveGoal, todayKey } from "./activeGoal.js";

import {
  formatWeight,
  normalizeWeightUnit
} from "./units.js";

import {
  compareMeasurements,
  compareVolume,
  compareWeight
} from "./progressMetrics.js";

import {
  buildExerciseProgress,
  describeGoal,
  formatSpan,
  strengthSummary,
  trainingConsistency,
  weeklyVolumes,
  weightTrend
} from "./progressInsights.js";

import { toDate } from "./historyView.js";


// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Settings saves leftArm/rightArm/thighs; Progress saves arms/thighs.
// Read both so every saved entry displays correctly.
function formatArms(entry) {
  if (entry.arms !== undefined && entry.arms !== null) return entry.arms;
  const left = entry.leftArm;
  const right = entry.rightArm;
  if (left != null && right != null) return `${left}/${right}`;
  return left ?? right ?? null;
}

// previous -> current -> change (objective numbers only; no percentage "progress").
function signed(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));

  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

// Whole number with thousands separators; never NaN / undefined.
function fmtInt(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : "—";
}

// One decimal, or a dash when there is nothing to average yet.
function fmtDecimal(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : String(Number(Number(value).toFixed(1)));
}

// "+3.2 kg" / "-1.0 kg" (estimated 1RM and training loads are shown in kg).
function signedKg(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)} kg` : "—";
}

// Body-weight change in the preferred unit: "+0.8 kg" / "−0.8 kg".
function signedWeight(kgChange, unit) {
  const text = formatWeight(Math.abs(kgChange), unit);

  return `${kgChange > 0 ? "+" : kgChange < 0 ? "−" : ""}${text}`;
}

function renderWeightComparison(weightHistory, weightUnit) {
  const result = compareWeight(weightHistory);

  if (result.current === null) {
    return "";
  }

  const show = kg => formatWeight(kg, weightUnit);
  const trend = weightTrend(weightHistory);

  return `
    <div class="progress-compare" data-compare="weight">
      <div class="progress-compare-title">
        BODY WEIGHT
      </div>
      <div class="progress-compare-row">
        <span>${result.previous === null ? "—" : escapeHtml(show(result.previous))}</span>
        <span class="progress-compare-arrow" aria-hidden="true">→</span>
        <strong>${escapeHtml(show(result.current))}</strong>
        <span class="progress-compare-change">
          ${
            result.change === null
              ? "no previous weigh-in"
              : escapeHtml(
                  `${result.change > 0 ? "+" : result.change < 0 ? "−" : ""}${show(Math.abs(result.change))}`
                )
          }
        </span>
      </div>
      ${
        trend.status === "ok"
          ? `<div class="progress-compare-trend" data-weight-trend="ok">
               Recent trend: ${escapeHtml(signedWeight(trend.change, weightUnit))} over ${escapeHtml(formatSpan(trend.days))}
             </div>`
          : trend.status === "insufficient"
            ? `<div class="progress-compare-trend" data-weight-trend="insufficient">
                 Not enough weigh-ins in the last 4 weeks for a trend.
               </div>`
            : ""
      }
      <div class="progress-compare-note">
        Body weight changes are not the same as body-composition changes.
      </div>
    </div>
  `;
}

function renderMeasurementComparison(measurements) {
  const rows = compareMeasurements(measurements);

  if (rows.length === 0) {
    return "";
  }

  return `
    <div class="progress-compare" data-compare="measurements">
      <div class="progress-compare-title">
        PREVIOUS → CURRENT
      </div>
      ${rows.map(row => `
        <div class="progress-compare-row" data-site="${escapeHtml(row.key)}">
          <span class="progress-compare-site">${escapeHtml(row.label)}</span>
          <span>${row.previous === null ? "—" : escapeHtml(Number(row.previous.toFixed(2)))}</span>
          <span class="progress-compare-arrow" aria-hidden="true">→</span>
          <strong>${escapeHtml(Number(row.current.toFixed(2)))}</strong>
          <span class="progress-compare-change">
            ${row.change === null ? "—" : escapeHtml(`${signed(row.change, 2)} in`)}
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function getProgressContainer() {
  return document.getElementById("progress-content");
}


function formatProgressDate(date) {
  const value =
    date?.toDate
      ? date.toDate()
      : new Date(date);

  if (Number.isNaN(value.getTime())) {
    return "Unknown date";
  }

  return value.toLocaleDateString(
    undefined,
    {
      day: "numeric",
      month: "short",
      year: "numeric"
    }
  );
}


// ============================================================================
// MAIN RENDER
// ============================================================================

export async function loadProgress() {

  const container =
    getProgressContainer();

  if (!container) {
    return;
  }


  container.innerHTML = `
    <div class="section-heading">

      <div class="section-kicker">
        TRAINING ANALYTICS
      </div>

      <h1 class="section-title">
        Progress
      </h1>

      <p class="section-description">
        Track your training consistency and performance over time.
      </p>

    </div>

    <div class="loading-row">
      Loading progress...
    </div>
  `;


  try {

    const logs =
      (await getAllWorkoutLogs()).filter(isCompletedLog);


    renderProgress(
      container,
      logs
    );


  } catch (error) {

    console.error(
      "Progress failed to load:",
      error
    );


    container.innerHTML = `
      <div class="section-heading">

        <div class="section-kicker">
          SYSTEM ERROR
        </div>

        <h1 class="section-title">
          Progress unavailable
        </h1>

        <p class="section-description">
          Recomposition could not load your training progress.
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
// PROGRESS UI
// ============================================================================

async function renderProgress(
  container,
  logs
) {

  // Read-only: every number below is derived from existing data right now.
  const [weightHistory, measurements, profile, goals] = await Promise.all([
    getWeightHistory(),
    getMeasurements(),
    getProfile().catch(() => null),
    getGoals().catch(() => [])
  ]);

  // Unit preference only affects how body weights are SHOWN (stored values are kg).
  const weightUnit = normalizeWeightUnit(profile?.unitPreference);

  const now = new Date();

  const consistency = trainingConsistency(logs, now);
  const weeks = weeklyVolumes(logs, now, 4);
  const volumeComparison = compareVolume(weeks[0].volume, weeks[1].volume);
  const exerciseProgress = buildExerciseProgress(logs, now);
  const strength = strengthSummary(exerciseProgress);
  const records = [...exerciseProgress].sort((a, b) => b.best.best.estimatedOneRepMax - a.best.best.estimatedOneRepMax);
  const weight = compareWeight(weightHistory);
  const goal = describeGoal(findActiveGoal(goals, todayKey(now)));

  const recentLogs =
    [...logs]
      .map(log => ({ log, date: toDate(log.date) }))
      .sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity))
      .slice(0, 5)
      .map(item => item.log);

  const statCard = (label, value, subtitle, attr = "") => `
    <article class="progress-stat-card" ${attr}>
      <div class="progress-stat-label">${escapeHtml(label)}</div>
      <div class="progress-stat-value">${escapeHtml(value)}</div>
      <div class="progress-stat-subtitle">${escapeHtml(subtitle)}</div>
    </article>
  `;

  const weightCardValue =
    weight.current === null
      ? "—"
      : formatWeight(weight.current, weightUnit);

  const weightCardNote =
    weight.current === null
      ? "No weigh-ins yet"
      : weight.change === null
        ? "Latest weigh-in"
        : `${signedWeight(weight.change, weightUnit)} since previous`;

  const volumeChangeText =
    volumeComparison.status === "changed"
      ? `
          <span>
            ${volumeComparison.percent >= 0 ? "+" : ""}${volumeComparison.percent.toFixed(1)}%
          </span>
          training volume vs last week
        `
      : volumeComparison.status === "no-previous"
        ? "No volume logged last week to compare with"
        : "No volume logged this week or last week";

  container.innerHTML = `

    <div class="section-heading">

      <div class="section-kicker">
        TRAINING ANALYTICS
      </div>

      <h1 class="section-title">
        Progress
      </h1>

      <p class="section-description">
        Track your training consistency and performance over time.
      </p>

    </div>


    <!-- OVERVIEW -->

    <div class="progress-overview" data-progress="overview">
      ${statCard("WORKOUTS", fmtInt(consistency.totalWorkouts), `${fmtInt(consistency.last7Days)} in 7 days · ${fmtInt(consistency.last30Days)} in 30 days`)}
      ${statCard("SETS", fmtInt(consistency.totalSets), "Sets completed")}
      ${statCard("VOLUME", fmtInt(Math.round(consistency.totalVolume)), "kg total training volume")}
      ${statCard("NEW PRs", fmtInt(strength.recentPrs), "Estimated 1RM, last 30 days")}
      ${statCard("STRENGTH", fmtInt(strength.improved), `of ${fmtInt(strength.exercisesWithProgression)} exercises up vs previous`)}
      ${statCard("BODY WEIGHT", weightCardValue, weightCardNote)}
    </div>


    ${
      goal
        ? `
          <!-- CURRENT GOAL (context only) -->

          <div class="progress-goal-card" data-progress="goal">
            <div class="progress-goal-label">CURRENT GOAL</div>
            <div class="progress-goal-name">${escapeHtml(goal.label)}</div>
            ${
              goal.calories !== null || goal.protein !== null
                ? `
                  <div class="progress-goal-targets">
                    ${[
                      goal.calories !== null ? `${fmtInt(goal.calories)} kcal` : "",
                      goal.protein !== null ? `${fmtInt(goal.protein)} g protein` : ""
                    ].filter(Boolean).map(escapeHtml).join(" · ")}
                  </div>
                `
                : ""
            }
          </div>
        `
        : ""
    }


    <!-- TRAINING CONSISTENCY -->

    <div class="progress-panel" data-progress="consistency">

      <div class="progress-panel-header">
        <div>
          <div class="panel-title">
            TRAINING CONSISTENCY
          </div>

          <div class="panel-subtitle">
            Counted from your completed workouts.
          </div>
        </div>
      </div>

      ${
        consistency.totalWorkouts === 0
          ? `
            <div class="progress-empty">
              No completed workouts yet.
            </div>
          `
          : `
            <div class="progress-overview progress-overview-inner">
              ${statCard("THIS WEEK", fmtInt(consistency.thisWeek), "Workouts since Monday")}
              ${statCard("LAST 7 DAYS", fmtInt(consistency.last7Days), "Workouts completed")}
              ${statCard("LAST 30 DAYS", fmtInt(consistency.last30Days), "Workouts completed")}
              ${statCard("AVG / WEEK", fmtDecimal(consistency.averagePerWeek), "Workouts per week")}
              ${statCard("TRAINING DAYS", fmtDecimal(consistency.trainingDaysPerWeek), "Days per week")}
              ${statCard("WEEK STREAK", fmtInt(consistency.weekStreak), consistency.weekStreak === 1 ? "Week in a row with a workout" : "Weeks in a row with a workout", 'data-stat="week-streak"')}
            </div>

            <div class="progress-note">
              Averages cover the last 4 weeks, or the time since your first workout if that is shorter.
            </div>
          `
      }

    </div>


    <!-- TRAINING VOLUME -->

    <div class="progress-panel weekly-volume-panel">

      <div class="progress-panel-header">

        <div>
          <div class="panel-title">
            TRAINING VOLUME
          </div>

          <div class="panel-subtitle">
            Weight × reps, week by week. This compares the work you did, not muscle growth.
          </div>
        </div>

      </div>


      <div class="weekly-volume-content">

        <div class="weekly-volume-stat">

          <div class="weekly-volume-label">
            THIS WEEK
          </div>

          <div class="weekly-volume-value">
            ${fmtInt(Math.round(weeks[0].volume))}
            <span>kg</span>
          </div>

        </div>


        <div class="weekly-volume-divider"></div>


        <div class="weekly-volume-stat">

          <div class="weekly-volume-label">
            LAST WEEK
          </div>

          <div class="weekly-volume-value">
            ${fmtInt(Math.round(weeks[1].volume))}
            <span>kg</span>
          </div>

        </div>


        <div class="weekly-volume-change" data-volume-comparison="${volumeComparison.status}">
          ${volumeChangeText}
        </div>

      </div>

      <div class="progress-week-list" data-progress="weekly-trend">
        ${weeks.map((week, index) => `
          <div class="progress-week-row">
            <span>${index === 0 ? "This week" : index === 1 ? "Last week" : `${index} weeks ago`}</span>
            <span class="progress-week-workouts">${fmtInt(week.workouts)} ${week.workouts === 1 ? "workout" : "workouts"}</span>
            <strong>${fmtInt(Math.round(week.volume))} kg</strong>
          </div>
        `).join("")}
      </div>

      <div class="progress-note">
        Training volume is a workload metric, not a direct measurement of muscle growth. Sets without both a weight and reps add nothing.
      </div>

    </div>


    <!-- STRENGTH PROGRESSION -->

    <div class="progress-panel strength-progress-panel">

      <div class="progress-panel-header">

        <div>
          <div class="panel-title">
            STRENGTH PROGRESSION
          </div>

          <div class="panel-subtitle">
            Best set (highest estimated 1RM) in your latest vs previous session. Estimated 1RM is a training-performance estimate, not muscle growth.
          </div>
        </div>

      </div>

      ${
        exerciseProgress.length > 0

          ? `
            <div class="strength-progress-selector">

              <label for="strength-exercise-select">
                EXERCISE
              </label>

              <select id="strength-exercise-select">

                ${exerciseProgress.map((item, index) => `
                  <option value="${index}">
                    ${escapeHtml(item.name)}
                  </option>
                `).join("")}

              </select>

            </div>

            <div
              id="strength-progress-detail"
              class="strength-progress-detail"
            ></div>
          `

          : `
            <div class="progress-empty">
              Log a workout with weight and reps to see strength progression.
            </div>
          `
      }

    </div>


    <!-- PERSONAL RECORDS -->

    <div class="progress-panel personal-records-panel">

      <div class="progress-panel-header">

        <div>

          <div class="panel-title">
            PERSONAL RECORDS
          </div>

          <div class="panel-subtitle">
            Your best set per exercise, by estimated 1RM.
          </div>

        </div>

      </div>

      <div class="personal-records-list">

        ${
          records.length > 0

            ? records.map(item => `

                <div class="personal-record-row">

                  <div class="personal-record-main">

                    <div class="personal-record-name">
                      ${escapeHtml(item.name)}
                    </div>

                    <div class="personal-record-set">
                      ${escapeHtml(item.best.best.weight)} kg × ${escapeHtml(item.best.best.reps)}
                    </div>

                  </div>

                  <div class="personal-record-1rm">

                    <div class="personal-record-1rm-label">
                      EST. 1RM
                    </div>

                    <div class="personal-record-1rm-value">
                      ${escapeHtml(item.best.best.estimatedOneRepMax.toFixed(1))} kg
                    </div>

                  </div>

                </div>

              `).join("")

            : `
              <div class="progress-empty">
                Complete a workout to start building your personal records.
              </div>
            `
        }

      </div>

    </div>


    <!-- WEIGHT HISTORY (read-only: entries are managed in Settings) -->

        <div class="progress-panel">

          <div class="progress-panel-header">
            <div>
              <div class="panel-title">
                WEIGHT HISTORY
              </div>

              <div class="panel-subtitle">
                Your body weight over time.
              </div>
            </div>

            <button
              type="button"
              class="dash-link-button"
              data-progress-manage="weight"
            >
              MANAGE →
            </button>
          </div>

          <div class="progress-panel-body">
            ${renderWeightComparison(weightHistory, weightUnit)}
            ${
              weightHistory.length
                ? weightHistory.map(entry => `
                    <div class="progress-activity-row">
                      <div class="progress-activity-main">
                        <div class="progress-activity-name">
                          ${escapeHtml(formatWeight(entry.weight, weightUnit))}
                        </div>

                        <div class="progress-activity-meta">
                          ${escapeHtml(entry.date || "Unknown date")}
                        </div>
                      </div>
                    </div>
                  `).join("")
                : `
                  <div class="progress-empty">
                    No weight entries yet. Add one in Settings → Weight History.
                  </div>
                `
            }
          </div>

        </div>

        <!-- BODY MEASUREMENTS (read-only: entries are managed in Settings) -->

        <div class="progress-panel">

          <div class="progress-panel-header">
            <div>
              <div class="panel-title">
                BODY MEASUREMENTS
              </div>

              <div class="panel-subtitle">
                Your body measurements over time.
              </div>
            </div>

            <button
              type="button"
              class="dash-link-button"
              data-progress-manage="measurements"
            >
              MANAGE →
            </button>
          </div>

          <div class="progress-panel-body">
            ${renderMeasurementComparison(measurements)}
            ${
              measurements.length
          ? measurements.map(entry => `
              <div class="progress-activity-row">

                <div class="progress-activity-main">

                  <div class="progress-activity-name">
                    ${escapeHtml(entry.date || "Unknown date")}
                  </div>
                  <div class="progress-activity-meta">
                    Chest ${escapeHtml(entry.chest ?? "-")} |
                    Waist ${escapeHtml(entry.waist ?? "-")} |
                    Shoulders ${escapeHtml(entry.shoulders ?? entry.shoulder ?? "-")} |
                    Arms ${escapeHtml(formatArms(entry) ?? "-")} |
                    Thighs ${escapeHtml(entry.thighs ?? entry.thigh ?? "-")} |
                    Calves ${escapeHtml(entry.calves ?? "-")} |
                    Forearms ${escapeHtml(entry.forearms ?? "-")} in
                  </div>

                </div>

              </div>
            `).join("")
          : `
            <div class="progress-empty">
              No measurements yet. Add one in Settings → Body Measurements.
            </div>
          `
      }

    </div>

  </div>

<!-- RECENT ACTIVITY -->

<div class="progress-panel">

      <div class="progress-panel-header">

        <div>

          <div class="panel-title">
            RECENT ACTIVITY
          </div>

          <div class="panel-subtitle">
            Your latest completed training sessions.
          </div>

        </div>

      </div>


      <div class="progress-activity-list">

        ${
          recentLogs.length
            ? recentLogs.map(log => {

                const workoutName =
                  log.planName ||
                  log.workoutName ||
                  "Workout Session";

                const exerciseCount =
                  Array.isArray(log.exercises)
                    ? log.exercises.length
                    : 0;

                return `
                  <div class="progress-activity-row">

                    <div class="progress-activity-main">

                      <div class="progress-activity-name">
                        ${escapeHtml(workoutName)}
                      </div>

                      <div class="progress-activity-meta">
                        ${formatProgressDate(log.date)}
                      </div>

                    </div>

                    <div class="progress-activity-count">
                      ${exerciseCount}
                      ${exerciseCount === 1 ? "exercise" : "exercises"}
                    </div>

                  </div>
                `;

              }).join("")
            : `
              <div class="progress-empty">
                No completed workouts yet.
              </div>
            `
        }

      </div>

    </div>

  `;

  // Entry/edit lives in Settings; Progress only links there.
  document
    .querySelectorAll("[data-progress-manage]")
    .forEach(button => {
      button.addEventListener("click", () => {
        window.RecompositionNavigation?.showSection("settings");

        document
          .getElementById(
            button.dataset.progressManage === "weight"
              ? "settings-weight"
              : "settings-measurements"
          )
          ?.click();
      });
    });

  const strengthExerciseSelect =
    document.getElementById("strength-exercise-select");

  if (strengthExerciseSelect) {

    const show = () =>
      renderStrengthProgressDetail(
        exerciseProgress[Number(strengthExerciseSelect.value)]
      );

    show();

    strengthExerciseSelect.addEventListener("change", show);

  }
}


// ============================================================================
// EXERCISE DETAIL (selected exercise)
// ============================================================================

function renderStrengthProgressDetail(item) {

  const container =
    document.getElementById("strength-progress-detail");

  if (!container || !item) {
    return;
  }

  const setText = session =>
    `${escapeHtml(session.best.weight)} kg × ${escapeHtml(session.best.reps)}`;

  const e1rm = session =>
    `${session.best.estimatedOneRepMax.toFixed(1)} kg`;

  const sessionCard = (label, session) => `
    <div class="strength-progress-detail-card">

      <div class="strength-progress-detail-label">
        ${label}
      </div>

      <div class="strength-progress-detail-value">
        ${setText(session)}
      </div>

      <div class="strength-progress-estimated">
        Estimated 1RM:
        ${e1rm(session)}
      </div>

    </div>
  `;

  // ---- not enough history: say so, do not invent a trend ----
  if (!item.previous) {
    container.innerHTML = `

      <div class="strength-progress-detail-grid">
        ${sessionCard("LATEST", item.latest)}
      </div>

      <div class="progress-empty" data-progress="insufficient">
        Not enough data yet.
        Complete this exercise in another session to see progression.
      </div>

    `;

    return;
  }

  const percent =
    item.changePercent === null
      ? ""
      : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(1)}%`;

  const changeText =
    Math.abs(item.changeKg) < 0.05
      ? `No change${percent ? ` (${percent})` : ""}`
      : [percent, signedKg(item.changeKg)].filter(Boolean).join(" · ");

  const first = item.sessions[item.sessions.length - 1];
  const shown = item.sessions.slice(0, 6);

  container.innerHTML = `

    <div class="strength-progress-detail-grid">
      ${sessionCard("LATEST", item.latest)}
      ${sessionCard("PREVIOUS", item.previous)}
    </div>


    <div class="strength-progress-result">

      <span>
        ESTIMATED 1RM CHANGE
      </span>

      <strong>
        ${escapeHtml(changeText)}
      </strong>

    </div>


    <div class="progress-compare-note">
      Best estimated 1RM so far: ${e1rm(item.best)}
      (${setText(item.best)}, ${escapeHtml(formatProgressDate(item.best.date))}).
      ${item.isRecentPr ? "Your latest session set a new best." : ""}
    </div>


    <div class="progress-compare" data-progress="exercise-sessions">

      <div class="progress-compare-title">
        RECENT SESSIONS
      </div>

      ${shown.map(session => `
        <div class="progress-compare-row">
          <span class="progress-compare-site">${escapeHtml(formatProgressDate(session.date))}</span>
          <span>${setText(session)}</span>
          <span class="progress-compare-change">
            ${escapeHtml(e1rm(session))} · ${escapeHtml(fmtInt(Math.round(session.volume)))} kg vol
          </span>
          ${
            session.isAlternative
              ? `<span class="progress-session-tag">Alternative${session.plannedName ? ` for ${escapeHtml(session.plannedName)}` : ""}</span>`
              : ""
          }
        </div>
      `).join("")}

      ${
        item.sessions.length >= 3
          ? `
            <div class="progress-compare-note">
              Over ${item.sessions.length} sessions: estimated 1RM ${e1rm(first)} → ${e1rm(item.latest)}
              (${signedKg(item.latest.best.estimatedOneRepMax - first.best.estimatedOneRepMax)}).
            </div>
          `
          : ""
      }

    </div>

  `;
}




window.RecompositionProgress = {
  loadProgress
};


// ============================================================================
// SIGN-OUT: drop the previous user's screen
// ============================================================================

window.addEventListener("recomposition-signed-out", () => {
  const container = getProgressContainer();

  if (container) {
    container.innerHTML = "";
  }
});
