// ============================================================================
// RECOMPOSITION — PROGRESS
// ============================================================================

import {
  getAllWorkoutLogs,
  getWeightHistory,
  getMeasurements,
  getProfile
} from "./data/recompositionData.js";

import {
  formatWeight,
  normalizeWeightUnit
} from "./units.js";


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
      (await getAllWorkoutLogs()).filter(
        log => !log.status || log.status === "completed"
      );


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

    const exerciseHistory = calculateExerciseProgress(logs);
    const strengthProgress = getStrengthProgress(exerciseHistory);
    const personalRecords = calculatePersonalRecords(logs);
    const weightHistory = await getWeightHistory();
    const measurements = await getMeasurements();

    // Unit preference only affects how weights are SHOWN (stored values are kg).
    const weightUnit =
      normalizeWeightUnit(
        (await getProfile().catch(() => null))?.unitPreference
      );

  const totalWorkouts =
    logs.length;


  const totalExercises =
    logs.reduce(
      (total, log) => {

        return total +
          (
            Array.isArray(log.exercises)
              ? log.exercises.length
              : 0
          );

      },
      0
    );


  const totalSets =
    logs.reduce(
      (total, log) => {

        const exercises =
          Array.isArray(log.exercises)
            ? log.exercises
            : [];

        return total +
          exercises.reduce(
            (exerciseTotal, exercise) => {

              return exerciseTotal +
                (
                  Array.isArray(exercise.sets)
                    ? exercise.sets.filter(set =>
                        String(set?.weight ?? "") !== "" ||
                        String(set?.reps ?? "") !== ""
                      ).length
                    : 0
                );

            },
            0
          );

      },
      0
    );

const totalVolume =
  logs.reduce(
    (total, log) => {

      const exercises =
        Array.isArray(log.exercises)
          ? log.exercises
          : [];

      return total +
        exercises.reduce(
          (exerciseTotal, exercise) => {

            const sets =
              Array.isArray(exercise.sets)
                ? exercise.sets
                : [];

            return exerciseTotal +
              sets.reduce(
                (setTotal, set) => {

                  const weight =
                    Number(set.weight);

                  const reps =
                    Number(set.reps);

                  if (
                    !Number.isFinite(weight) ||
                    !Number.isFinite(reps)
                  ) {
                    return setTotal;
                  }

                  return setTotal +
                    (weight * reps);

                },
                0
              );

          },
          0
        );

    },
    0
  );

  const averageVolume =
  totalWorkouts > 0
    ? totalVolume / totalWorkouts
    : 0;

    const now = new Date();

const startOfWeek = new Date(now);
startOfWeek.setHours(0, 0, 0, 0);

const day = startOfWeek.getDay();

const daysSinceMonday =
  day === 0 ? 6 : day - 1;

startOfWeek.setDate(
  startOfWeek.getDate() - daysSinceMonday
);

const weeklyVolume =
  logs.reduce(
    (total, log) => {

      const logDate =
        log.date?.toDate
          ? log.date.toDate()
          : new Date(log.date);

      if (
        Number.isNaN(logDate.getTime()) ||
        logDate < startOfWeek
      ) {
        return total;
      }

      const exercises =
        Array.isArray(log.exercises)
          ? log.exercises
          : [];

      return total +
        exercises.reduce(
          (exerciseTotal, exercise) => {

            const sets =
              Array.isArray(exercise.sets)
                ? exercise.sets
                : [];

            return exerciseTotal +
              sets.reduce(
                (setTotal, set) => {

                  const weight =
                    Number(set.weight);

                  const reps =
                    Number(set.reps);

                  if (
                    !Number.isFinite(weight) ||
                    !Number.isFinite(reps)
                  ) {
                    return setTotal;
                  }

                  return setTotal +
                    (weight * reps);

                },
                0
              );

          },
          0
        );

    },
    0
  );


  const startOfLastWeek = new Date(startOfWeek);

startOfLastWeek.setDate(
  startOfLastWeek.getDate() - 7
);

const endOfLastWeek = new Date(startOfWeek);

const lastWeekVolume =
  logs.reduce(
    (total, log) => {

      const logDate =
        log.date?.toDate
          ? log.date.toDate()
          : new Date(log.date);

      if (
        Number.isNaN(logDate.getTime()) ||
        logDate < startOfLastWeek ||
        logDate >= endOfLastWeek
      ) {
        return total;
      }

      const exercises =
        Array.isArray(log.exercises)
          ? log.exercises
          : [];

      return total +
        exercises.reduce(
          (exerciseTotal, exercise) => {

            const sets =
              Array.isArray(exercise.sets)
                ? exercise.sets
                : [];

            return exerciseTotal +
              sets.reduce(
                (setTotal, set) => {

                  const weight =
                    Number(set.weight);

                  const reps =
                    Number(set.reps);

                  if (
                    !Number.isFinite(weight) ||
                    !Number.isFinite(reps)
                  ) {
                    return setTotal;
                  }

                  return setTotal +
                    (weight * reps);

                },
                0
              );

          },
          0
        );

    },
    0
  );

const volumeChangePercent =
  lastWeekVolume > 0
    ? ((weeklyVolume - lastWeekVolume) / lastWeekVolume) * 100
    : null;

    const startOfMonth =
  new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

const workoutsThisWeek =
  logs.filter(log => {

    const date =
      log.date?.toDate
        ? log.date.toDate()
        : new Date(log.date);

    return date >= startOfWeek;

  }).length;

const workoutsThisMonth =
  logs.filter(log => {

    const date =
      log.date?.toDate
        ? log.date.toDate()
        : new Date(log.date);

    return date >= startOfMonth;

  }).length;


  const recentLogs =
    [...logs]
      .sort(
        (a, b) => {

          const dateA =
            a.date?.toDate
              ? a.date.toDate()
              : new Date(a.date);

          const dateB =
            b.date?.toDate
              ? b.date.toDate()
              : new Date(b.date);

          return dateB - dateA;

        }
      )
      .slice(0, 5);



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

    <div class="progress-overview">

      <article class="progress-stat-card">

        <div class="progress-stat-label">
          WORKOUTS
        </div>

        <div class="progress-stat-value">
          ${totalWorkouts}
        </div>

        <div class="progress-stat-subtitle">
          Completed sessions
        </div>

      </article>


      <article class="progress-stat-card">

  <div class="progress-stat-label">
    AVG VOLUME
  </div>

  <div class="progress-stat-value">
    ${Math.round(averageVolume).toLocaleString()}
  </div>

  <div class="progress-stat-subtitle">
    kg per workout
  </div>

</article>


      <article class="progress-stat-card">

        <div class="progress-stat-label">
          EXERCISES
        </div>

        <div class="progress-stat-value">
          ${totalExercises}
        </div>

        <div class="progress-stat-subtitle">
          Exercises recorded
        </div>

      </article>


     <article class="progress-stat-card">

  <div class="progress-stat-label">
    SETS
  </div>

  <div class="progress-stat-value">
    ${totalSets}
  </div>

  <div class="progress-stat-subtitle">
    Sets completed
  </div>

</article>


<article class="progress-stat-card">

  <div class="progress-stat-label">
    VOLUME
  </div>

  <div class="progress-stat-value">
    ${Math.round(totalVolume).toLocaleString()}
  </div>

  <div class="progress-stat-subtitle">
    kg lifted
  </div>

</article>



<article class="progress-stat-card">

  <div class="progress-stat-label">
    THIS WEEK
  </div>

  <div class="progress-stat-value">
    ${Math.round(weeklyVolume).toLocaleString()}
  </div>

  <div class="progress-stat-subtitle">
    kg this week
  </div>

</article>

    </div>

    <!-- TRAINING CONSISTENCY -->

<div class="progress-panel">

  <div class="progress-panel-header">

    <div>

      <div class="panel-title">
        TRAINING CONSISTENCY
      </div>

      <div class="panel-subtitle">
        Track your training frequency.
      </div>

    </div>

  </div>

  <div class="progress-overview">

    <article class="progress-stat-card">

      <div class="progress-stat-label">
        THIS WEEK
      </div>

      <div class="progress-stat-value">
        ${workoutsThisWeek}
      </div>

      <div class="progress-stat-subtitle">
        Workouts completed
      </div>

    </article>

    <article class="progress-stat-card">

      <div class="progress-stat-label">
        THIS MONTH
      </div>

      <div class="progress-stat-value">
        ${workoutsThisMonth}
      </div>

      <div class="progress-stat-subtitle">
        Workouts completed
      </div>

    </article>

  </div>

</div>


    <!-- WEEKLY VOLUME -->

<div class="progress-panel weekly-volume-panel">

  <div class="progress-panel-header">

    <div>
      <div class="panel-title">
        WEEKLY VOLUME
      </div>

      <div class="panel-subtitle">
        Compare your training volume with last week.
      </div>
    </div>

  </div>


  <div class="weekly-volume-content">

    <div class="weekly-volume-stat">

      <div class="weekly-volume-label">
        THIS WEEK
      </div>

      <div class="weekly-volume-value">
        ${Math.round(weeklyVolume).toLocaleString()}
        <span>kg</span>
      </div>

    </div>


    <div class="weekly-volume-divider"></div>


    <div class="weekly-volume-stat">

      <div class="weekly-volume-label">
        LAST WEEK
      </div>

      <div class="weekly-volume-value">
        ${Math.round(lastWeekVolume).toLocaleString()}
        <span>kg</span>
      </div>

    </div>


    <div class="weekly-volume-change">

      ${
        volumeChangePercent === null
          ? "No data from last week"
          : `
            <span>
              ${volumeChangePercent >= 0 ? "+" : ""}
              ${volumeChangePercent.toFixed(1)}%
            </span>

            compared with last week
          `
      }

    </div>

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
        Compare your latest and previous session.
      </div>
    </div>

  </div>

  ${
    strengthProgress.length > 0

      ? `
        <div class="strength-progress-selector">

          <label for="strength-exercise-select">
            EXERCISE
          </label>

          <select id="strength-exercise-select">

            ${strengthProgress.map((item, index) => `
              <option value="${index}">
                ${item.name}
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
          Complete at least two sessions of an exercise
          to see strength progression.
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
        Your strongest recorded performances.
      </div>

    </div>

  </div>

  <div class="personal-records-list">

    ${
      personalRecords.length > 0

        ? personalRecords.map(record => `
            
            <div class="personal-record-row">

              <div class="personal-record-main">

                <div class="personal-record-name">
                  ${record.name}
                </div>

                <div class="personal-record-set">
                  ${record.weight} kg × ${record.reps}
                </div>

              </div>

              <div class="personal-record-1rm">

                <div class="personal-record-1rm-label">
                  EST. 1RM
                </div>

                <div class="personal-record-1rm-value">
                  ${record.estimatedOneRepMax.toFixed(1)} kg
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
                        ${workoutName}
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

  renderStrengthProgressDetail(
    strengthProgress[
      Number(strengthExerciseSelect.value)
    ]
  );

  strengthExerciseSelect.addEventListener(
    "change",
    () => {

      const index =
        Number(strengthExerciseSelect.value);

      renderStrengthProgressDetail(
        strengthProgress[index]
      );

    }
  );

}
}

function calculateExerciseProgress(logs) {

  const exerciseHistory = {};

  logs.forEach(log => {

    const logDate =
      log.date?.toDate
        ? log.date.toDate()
        : new Date(log.date);

    if (Number.isNaN(logDate.getTime())) {
      return;
    }

    const exercises =
      Array.isArray(log.exercises)
        ? log.exercises
        : [];

    exercises.forEach(exercise => {

      const exerciseId =
        exercise.exerciseId ||
        exercise.name;

      const exerciseName =
        exercise.name ||
        exercise.exerciseName ||
        "Unknown Exercise";

      if (!exerciseId) {
        return;
      }

      const sets =
        Array.isArray(exercise.sets)
          ? exercise.sets
          : [];

      const validSets =
        sets.filter(set => {

          const weight =
            Number(set.weight);

          const reps =
            Number(set.reps);

          return (
            Number.isFinite(weight) &&
            Number.isFinite(reps) &&
            weight >= 0 &&
            reps > 0
          );

        });

      if (validSets.length === 0) {
        return;
      }

      if (!exerciseHistory[exerciseId]) {

        exerciseHistory[exerciseId] = {
          name: exerciseName,
          sessions: []
        };

      }

      exerciseHistory[exerciseId].sessions.push({
        date: logDate,
        sets: validSets
      });

    });

  });

  return exerciseHistory;
}

function getStrengthProgress(exerciseHistory) {

  const progression = [];

  Object.values(exerciseHistory).forEach(exercise => {

    const sessions = [...exercise.sessions]
      .sort((a, b) => b.date - a.date);

    if (sessions.length < 2) {
      return;
    }

    const latestSession = sessions[0];
    const previousSession = sessions[1];

    const getBestSet = (session) => {

      let bestSet = null;

      session.sets.forEach(set => {

        const weight = Number(set.weight);
        const reps = Number(set.reps);

        if (
          !Number.isFinite(weight) ||
          !Number.isFinite(reps) ||
          weight <= 0 ||
          reps <= 0
        ) {
          return;
        }

        const volume = weight * reps;

        const estimatedOneRepMax =
          weight * (1 + reps / 30);

        if (
          !bestSet ||
          volume > bestSet.volume
        ) {

          bestSet = {
            weight,
            reps,
            volume,
            estimatedOneRepMax
          };

        }

      });

      return bestSet;
    };

    const latestBest =
      getBestSet(latestSession);

    const previousBest =
      getBestSet(previousSession);

    if (!latestBest || !previousBest) {
      return;
    }

    const volumeChangePercent =
      previousBest.volume > 0
        ? (
            (latestBest.volume - previousBest.volume) /
            previousBest.volume
          ) * 100
        : null;

    const oneRepMaxChangePercent =
      previousBest.estimatedOneRepMax > 0
        ? (
            (
              latestBest.estimatedOneRepMax -
              previousBest.estimatedOneRepMax
            ) /
            previousBest.estimatedOneRepMax
          ) * 100
        : null;

    progression.push({

      name: exercise.name,

      latest: latestBest,

      previous: previousBest,

      volumeChangePercent,

      oneRepMaxChangePercent

    });

  });

  return progression;
}


function renderStrengthProgressDetail(item) {

  const container =
    document.getElementById("strength-progress-detail");

  if (!container || !item) {
    return;
  }

  const change =
    item.oneRepMaxChangePercent;

  const changeText =
    change === null
      ? "No previous comparison"
      : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;

  container.innerHTML = `

    <div class="strength-progress-detail-grid">

      <div class="strength-progress-detail-card">

        <div class="strength-progress-detail-label">
          LATEST
        </div>

        <div class="strength-progress-detail-value">
          ${item.latest.weight} kg × ${item.latest.reps}
        </div>

        <div class="strength-progress-estimated">
          Estimated 1RM:
          ${item.latest.estimatedOneRepMax.toFixed(1)} kg
        </div>

      </div>


      <div class="strength-progress-detail-card">

        <div class="strength-progress-detail-label">
          PREVIOUS
        </div>

        <div class="strength-progress-detail-value">
          ${item.previous.weight} kg × ${item.previous.reps}
        </div>

        <div class="strength-progress-estimated">
          Estimated 1RM:
          ${item.previous.estimatedOneRepMax.toFixed(1)} kg
        </div>

      </div>

    </div>


    <div class="strength-progress-result">

      <span>
        ESTIMATED 1RM CHANGE
      </span>

      <strong>
        ${changeText}
      </strong>

    </div>

  `;
}

function calculatePersonalRecords(logs) {

  const records = {};

  logs.forEach(log => {

    const exercises =
      Array.isArray(log.exercises)
        ? log.exercises
        : [];

    exercises.forEach(exercise => {

      const exerciseId =
        exercise.exerciseId ||
        exercise.name;

      const exerciseName =
        exercise.name ||
        exercise.exerciseName ||
        "Unknown Exercise";

      if (!exerciseId) {
        return;
      }

      const sets =
        Array.isArray(exercise.sets)
          ? exercise.sets
          : [];

      sets.forEach(set => {

        const weight = Number(set.weight);
        const reps = Number(set.reps);

        if (
          !Number.isFinite(weight) ||
          !Number.isFinite(reps) ||
          weight <= 0 ||
          reps <= 0
        ) {
          return;
        }

        const volume = weight * reps;

        const estimatedOneRepMax =
          weight * (1 + reps / 30);

        if (!records[exerciseId]) {

          records[exerciseId] = {
            name: exerciseName,
            weight: 0,
            reps: 0,
            volume: 0,
            estimatedOneRepMax: 0
          };

        }

        const record = records[exerciseId];

        if (
          estimatedOneRepMax >
          record.estimatedOneRepMax
        ) {

          record.name = exerciseName;
          record.weight = weight;
          record.reps = reps;
          record.volume = volume;
          record.estimatedOneRepMax =
            estimatedOneRepMax;

        }

      });

    });

  });

  return Object.values(records)
    .sort(
      (a, b) =>
        b.estimatedOneRepMax -
        a.estimatedOneRepMax
    );
}



window.RecompositionProgress = {
  loadProgress
};