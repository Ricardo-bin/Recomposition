// ============================================================================
// RECOMPOSITION — WORKOUT HISTORY
// ============================================================================

import {
  getWorkoutLogsPage,
  updateWorkoutLog,
  deleteWorkoutLog
} from "./data/recompositionData.js";

// ============================================================================
// HISTORY STATE
// ============================================================================

let historyLogs = [];
let historyCursor = null;
let historyHasMore = false;
let historyLoadingMore = false;

// ============================================================================
// HELPERS
// ============================================================================

function getHistoryContainer() {
  return document.getElementById(
    "history-content"
  );
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

  if (Number.isNaN(value.getTime())) {
    return "Unknown date";
  }

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

function formatTime(date) {
  const value =
    date?.toDate
      ? date.toDate()
      : new Date(date);

  if (Number.isNaN(value.getTime())) {
    return "";
  }

  return value.toLocaleTimeString(
    undefined,
    {
      hour: "numeric",
      minute: "2-digit"
    }
  );
}

// ============================================================================
// RENDER HISTORY
// ============================================================================

function renderHistory(logs) {
  const container =
    getHistoryContainer();

  if (!container) {
    console.error(
      "History container not found."
    );
    return;
  }

  if (!logs.length) {
    container.innerHTML = `
      <div class="history-empty-state">

        <div class="history-empty-icon">
          ◇
        </div>

        <h3>
          No workouts yet
        </h3>

        <p>
          Complete your first workout and
          it will appear here.
        </p>

      </div>
    `;

    return;
  }

  container.innerHTML = `
  <div class="history-toolbar">

    <div class="history-search-wrapper">

      <span class="history-search-icon">
        ⌕
      </span>

      <input
        type="search"
        id="history-search"
        class="history-search-input"
        placeholder="Search workouts or exercises..."
        autocomplete="off"
      >

    </div>

    <div class="history-filter-row">

      <select
        id="history-sort"
        class="history-filter-select"
      >

        <option value="newest">
          Newest first
        </option>

        <option value="oldest">
          Oldest first
        </option>

      </select>

      <select
        id="history-workout-filter"
        class="history-filter-select"
      >

        <option value="all">
          All workouts
        </option>

      </select>

    </div>

  </div>

  <div id="history-results"></div>

  <div id="history-load-more"></div>
`;
}

// ============================================================================
// EDIT WORKOUT
// ============================================================================

// Restores the full history list (toolbar, filters and results).
// Used by the edit screen's CANCEL button.
function showHistoryList() {
  renderHistory(historyLogs);
  populateWorkoutFilter();
  attachHistoryFilterEvents();
  filterHistory();
  getHistoryContainer()?.scrollIntoView({ block: "start" });
}


function editWorkout(logId, logs) {
  const log =
    logs.find(item => item.id === logId);

  if (!log) {
    console.error(
      "Workout log not found:",
      logId
    );

    return;
  }

  const container =
    getHistoryContainer();

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="history-edit-screen">

      <div class="history-edit-header">

        <div>

          <div class="history-workout-date">
            EDIT WORKOUT
          </div>

          <h2>
            ${escapeHtml(
              log.planName ||
              log.workoutName ||
              "Workout Session"
            )}
          </h2>

          <p>
            ${escapeHtml(
              formatDate(log.date)
            )}
          </p>

        </div>

        <button
          type="button"
          class="history-cancel-edit"
          id="history-cancel-edit"
        >
          CANCEL
        </button>

      </div>

      <div class="history-edit-exercises">

        ${
          (log.exercises || [])
            .map(
              (exercise, exerciseIndex) => `
                <article
                  class="history-edit-exercise"
                  data-edit-exercise="${exerciseIndex}"
                >

                  <div class="history-edit-exercise-header">

                    <div>

                      <span>
                        EXERCISE ${String(
                          exerciseIndex + 1
                        ).padStart(2, "0")}
                      </span>

                      <h3>
                        ${escapeHtml(
                          exercise.name ||
                          exercise.exerciseName ||
                          "Exercise"
                        )}
                      </h3>

                    </div>

                  </div>

                  <div class="history-edit-set-header">
                    <span>SET</span>
                    <span>WEIGHT</span>
                    <span>REPS</span>
                    <span>RIR</span>
                  </div>

                  ${
                    (exercise.sets || [])
                      .map(
                        (set, setIndex) => `
                          <div
                            class="history-edit-set"
                            data-edit-set="${setIndex}"
                          >

                            <span>
                              ${setIndex + 1}
                            </span>

                            <input
                              type="number"
                              class="form-input"
                              data-edit-field="weight"
                              value="${escapeHtml(
                                set.weight ?? ""
                              )}"
                              min="0"
                              step="0.5"
                              placeholder="kg"
                            >

                            <input
                              type="number"
                              class="form-input"
                              data-edit-field="reps"
                              value="${escapeHtml(
                                set.reps ?? ""
                              )}"
                              min="1"
                              step="1"
                              placeholder="reps"
                            >

                            <input
                              type="number"
                              class="form-input"
                              data-edit-field="rir"
                              value="${escapeHtml(
                                set.rir ?? ""
                              )}"
                              min="0"
                              max="5"
                              step="1"
                              placeholder="RIR"
                            >

                          </div>
                        `
                      )
                      .join("")
                  }

                </article>
              `
            )
            .join("")
        }

      </div>

      <div class="history-edit-footer">

        <button
          type="button"
          class="history-save-edit"
          id="history-save-edit"
        >
          SAVE CHANGES
        </button>

      </div>

    </div>
  `;

  container.scrollIntoView({ block: "start" });

  document
    .getElementById("history-cancel-edit")
    ?.addEventListener(
      "click",
      () => {
        showHistoryList();
      }
    );

  document
    .getElementById("history-save-edit")
    ?.addEventListener(
      "click",
      () => saveWorkoutEdit(log, logs)
    );
}

async function saveWorkoutEdit(log, logs) {
  const exerciseElements =
    document.querySelectorAll(
      "[data-edit-exercise]"
    );

  const updatedExercises =
    Array.from(exerciseElements).map(
      (exerciseElement, exerciseIndex) => {

        const originalExercise =
          log.exercises[exerciseIndex];

        const setElements =
          exerciseElement.querySelectorAll(
            "[data-edit-set]"
          );

        const updatedSets =
          Array.from(setElements).map(
            (setElement, setIndex) => {

              const weight =
                setElement.querySelector(
                  '[data-edit-field="weight"]'
                )?.value ?? "";

              const reps =
                setElement.querySelector(
                  '[data-edit-field="reps"]'
                )?.value ?? "";

              const rir =
                setElement.querySelector(
                  '[data-edit-field="rir"]'
                )?.value ?? "";

              return {
                ...originalExercise.sets[setIndex],
                weight,
                reps,
                rir
              };

            }
          );

        return {
          ...originalExercise,
          sets: updatedSets
        };

      }
    );

  const saveButton =
    document.getElementById(
      "history-save-edit"
    );

  try {

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "SAVING...";
    }

    await updateWorkoutLog(
      log.id,
      {
        exercises: updatedExercises
      }
    );

    window.dispatchEvent(
      new CustomEvent("recomposition-workout-updated", {
        detail: { logId: log.id, action: "updated" }
      })
    );

    alert(
      "Workout updated successfully."
    );

    await loadHistory();

  } catch (error) {

    console.error(
      "Failed to update workout:",
      error
    );

    alert(
      "Could not update the workout."
    );

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "SAVE CHANGES";
    }

  }
}

// ============================================================================
// DELETE WORKOUT
// ============================================================================

async function deleteWorkout(logId, logs) {
  const log =
    logs.find(item => item.id === logId);

  if (!log) {
    console.error(
      "Workout log not found:",
      logId
    );

    return;
  }

  const workoutName =
    log.planName ||
    log.workoutName ||
    "Workout Session";

  const confirmed =
    window.confirm(
      `Delete "${workoutName}" from your workout history?\n\nThis cannot be undone.`
    );

  if (!confirmed) {
    return;
  }

  try {

    await deleteWorkoutLog(
      log.id
    );

    window.dispatchEvent(
      new CustomEvent("recomposition-workout-updated", {
        detail: { logId: log.id, action: "deleted" }
      })
    );

    window.alert(
      "Workout deleted successfully."
    );

    await loadHistory();

  } catch (error) {

    console.error(
      "Failed to delete workout:",
      error
    );

    window.alert(
      "Could not delete the workout. Please try again."
    );

  }
}

// ============================================================================
// HISTORY EVENTS
// ============================================================================

function attachHistoryEvents(logs) {

  const container =
    getHistoryContainer();

  if (!container) {
    return;
  }

  // VIEW buttons
  container
    .querySelectorAll(".history-expand-btn")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const card =
            button.closest(
              ".history-workout-card"
            );

          if (!card) {
            return;
          }

          const isExpanded =
            card.classList.contains(
              "expanded"
            );

          card.classList.toggle(
            "expanded"
          );

          button.setAttribute(
            "aria-expanded",
            String(!isExpanded)
          );

          const label =
            button.querySelector("span");

          if (label) {

            label.textContent =
              isExpanded
                ? "VIEW"
                : "HIDE";

          }

        }
      );

    });

  // EDIT buttons
  container
    .querySelectorAll("[data-history-edit]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          editWorkout(
            button.dataset.historyEdit,
            logs
          );

        }
      );

    });

  // DELETE buttons
  container
    .querySelectorAll("[data-history-delete]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          deleteWorkout(
            button.dataset.historyDelete,
            logs
          );

        }
      );

    });

}

// ============================================================================
// WORKOUT CARD
// ============================================================================

function renderWorkoutCard(log) {

  const date = formatDate(log.date);

  const workoutName =
    log.planName ||
    log.workoutName ||
    "Workout Session";

  const exercises = Array.isArray(log.exercises)
    ? log.exercises
    : [];

  const loggedSets = exercises.flatMap(exercise =>
    Array.isArray(exercise.sets)
      ? exercise.sets.filter(set =>
          String(set?.weight ?? "") !== "" ||
          String(set?.reps ?? "") !== ""
        )
      : []
  );

  const totalSets = loggedSets.length;

  const totalVolume = Math.round(
    loggedSets.reduce(
      (total, set) =>
        total +
        (Number(set.weight) || 0) * (Number(set.reps) || 0),
      0
    )
  );

  return `
    <article class="history-workout-card">

      <div class="history-workout-header">

        <div>

          <div class="history-workout-date">
            ${escapeHtml(date)}
          </div>

          <h3 class="history-workout-title">
            ${escapeHtml(workoutName)}
          </h3>

          <div class="history-workout-meta">
            <span>
              ${exercises.length}
              exercise${exercises.length !== 1 ? "s" : ""}
            </span>

            <span>•</span>

            <span>
              ${totalSets}
              set${totalSets !== 1 ? "s" : ""}
            </span>

            ${
              totalVolume > 0
                ? `<span>•</span>
                   <span>${totalVolume.toLocaleString()} kg</span>`
                : ""
            }
          </div>

        </div>

        <div class="history-card-actions">

          <button
            type="button"
            class="history-edit-btn"
            data-history-edit="${escapeHtml(log.id)}"
          >
            EDIT
          </button>

          <button
            type="button"
            class="history-delete-btn"
            data-history-delete="${escapeHtml(log.id)}"
          >
            DELETE
          </button>

          <button
            type="button"
            class="history-expand-btn"
            aria-expanded="false"
          >
            <span>VIEW</span>
            <span class="history-expand-icon">▼</span>
          </button>

        </div>

      </div>

      <div class="history-workout-details">
        ${exercises.map(renderExerciseSummary).join("")}
      </div>

    </article>
  `;
}

// ============================================================================
// EXERCISE SUMMARY
// ============================================================================

function renderExerciseSummary(exercise) {

  const sets = Array.isArray(exercise.sets)
    ? exercise.sets
    : [];

  const exerciseName =
    exercise.name ||
    exercise.exerciseName ||
    "Exercise";

  // Plans store targetRIR; older logs may use targetRir.
  const targetRir =
    exercise.targetRIR ?? exercise.targetRir;

  return `
    <div class="history-exercise">

      <div class="history-exercise-header">

        <h4>
          ${escapeHtml(exerciseName)}
        </h4>

        ${
          targetRir !== undefined &&
          targetRir !== null &&
          targetRir !== ""
            ? `
              <span class="history-target-rir">
                Target RIR ${escapeHtml(
                  String(targetRir)
                )}
              </span>
            `
            : ""
        }

      </div>

      <div class="history-sets">

        <div class="history-set-row history-set-heading">
          <span>SET</span>
          <span>WEIGHT</span>
          <span>REPS</span>
          <span>RIR</span>
        </div>

        ${
          sets.length
            ? sets
                .map(
                  (set, index) => `
                    <div class="history-set-row">

                      <span class="history-set-number">
                        ${index + 1}
                      </span>

                      <span>
                        ${
                          set.weight !== undefined &&
                          set.weight !== ""
                            ? `${escapeHtml(
                                String(set.weight)
                              )} kg`
                            : "—"
                        }
                      </span>

                      <span>
                        ${
                          set.reps !== undefined &&
                          set.reps !== ""
                            ? escapeHtml(
                                String(set.reps)
                              )
                            : "—"
                        }
                      </span>

                      <span>
                        ${
                          set.rir !== undefined &&
                          set.rir !== ""
                            ? escapeHtml(
                                String(set.rir)
                              )
                            : "—"
                        }
                      </span>

                    </div>
                  `
                )
                .join("")
            : `
                <div class="history-empty-sets">
                  No set data recorded.
                </div>
              `
        }

      </div>

    </div>
  `;
}


// ============================================================================
// RENDER FILTERED RESULTS
// ============================================================================

// Shows "Load older workouts" when more history exists beyond what is loaded.
function renderHistoryLoadMore() {
  const holder = document.getElementById("history-load-more");

  if (!holder) {
    return;
  }

  if (!historyHasMore) {
    holder.innerHTML = "";
    return;
  }

  holder.innerHTML = `
    <div class="history-load-more">
      <p class="history-load-more-note">
        Showing ${historyLogs.length} most recent workouts.
        Search and filters cover loaded workouts only.
      </p>

      <button
        type="button"
        class="secondary-btn history-load-more-button"
        id="history-load-more-button"
        ${historyLoadingMore ? "disabled" : ""}
      >
        ${historyLoadingMore ? "LOADING…" : "LOAD OLDER WORKOUTS"}
      </button>
    </div>
  `;

  document
    .getElementById("history-load-more-button")
    ?.addEventListener("click", loadOlderHistory);
}


async function loadOlderHistory() {
  if (historyLoadingMore || !historyHasMore) {
    return;
  }

  historyLoadingMore = true;
  renderHistoryLoadMore();

  try {
    const page = await getWorkoutLogsPage({
      after: historyCursor
    });

    historyCursor = page.cursor;
    historyHasMore = page.hasMore;

    const knownIds = new Set(historyLogs.map(log => log.id));

    const older = page.logs.filter(
      log =>
        !knownIds.has(log.id) &&
        (!log.status || log.status === "completed")
    );

    historyLogs = [...historyLogs, ...older];

    // Keep the user's current selection when the filter list grows.
    const filter = document.getElementById("history-workout-filter");
    const selected = filter ? filter.value : "all";

    populateWorkoutFilter();

    if (filter && [...filter.options].some(o => o.value === selected)) {
      filter.value = selected;
    }
  } catch (error) {
    console.error("Failed to load older workouts:", error);
    window.alert("Could not load older workouts. Please try again.");
  } finally {
    historyLoadingMore = false;
    filterHistory();
  }
}


function renderHistoryResults(logs) {

  const results =
    document.getElementById(
      "history-results"
    );

  if (!results) {
    return;
  }

  if (!logs.length) {

        results.innerHTML = `
      <div class="history-empty-state">
        <div class="history-empty-icon">
          ◇
        </div>

        <h3>
          No matching workouts
        </h3>

        <p>
          Try a different search or filter.
        </p>
      </div>
    `;

    renderHistoryLoadMore();

    return;
  }

  results.innerHTML =
    logs
      .map(renderWorkoutCard)
      .join("");

  attachHistoryEvents(logs);

  renderHistoryLoadMore();
}

// ============================================================================
// FILTER HISTORY
// ============================================================================

function filterHistory() {

  const searchInput =
    document.getElementById(
      "history-search"
    );

  const sortSelect =
    document.getElementById(
      "history-sort"
    );

  const workoutFilter =
    document.getElementById(
      "history-workout-filter"
    );

  const search =
    searchInput?.value
      .trim()
      .toLowerCase() || "";

  const sort =
    sortSelect?.value ||
    "newest";

  const workout =
    workoutFilter?.value ||
    "all";

  let filtered =
    [...historyLogs];

  // ------------------------------------------------------------
  // SEARCH
  // ------------------------------------------------------------

  if (search) {

    filtered =
      filtered.filter(log => {

        const workoutName =
          (
            log.planName ||
            log.workoutName ||
            ""
          )
            .toLowerCase();

        const exerciseNames =
          Array.isArray(log.exercises)
            ? log.exercises
                .map(
                  exercise =>
                    exercise.name ||
                    exercise.exerciseName ||
                    ""
                )
                .join(" ")
                .toLowerCase()
            : "";

        return (
          workoutName.includes(search) ||
          exerciseNames.includes(search)
        );

      });

  }

  // ------------------------------------------------------------
  // WORKOUT FILTER
  // ------------------------------------------------------------

  if (workout !== "all") {

    filtered =
      filtered.filter(log => {

        const workoutName =
          log.planName ||
          log.workoutName ||
          "";

        return workoutName === workout;

      });

  }

  // ------------------------------------------------------------
  // SORT
  // ------------------------------------------------------------

  filtered.sort(
    (a, b) => {

      const dateA =
        a.date?.toDate
          ? a.date.toDate()
          : new Date(a.date);

      const dateB =
        b.date?.toDate
          ? b.date.toDate()
          : new Date(b.date);

      return sort === "oldest"
        ? dateA - dateB
        : dateB - dateA;

    }
  );

  renderHistoryResults(
    filtered
  );
}

// ============================================================================
// POPULATE WORKOUT FILTER
// ============================================================================

function populateWorkoutFilter() {

  const select =
    document.getElementById(
      "history-workout-filter"
    );

  if (!select) {
    return;
  }

  const workoutNames = [
    ...new Set(
      historyLogs
        .map(
          log =>
            log.planName ||
            log.workoutName ||
            "Workout Session"
        )
    )
  ]
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.localeCompare(b)
    );

  select.innerHTML = `
    <option value="all">
      All workouts
    </option>

    ${
      workoutNames
        .map(
          name => `
            <option
              value="${escapeHtml(name)}"
            >
              ${escapeHtml(name)}
            </option>
          `
        )
        .join("")
    }
  `;
}

// ============================================================================
// HISTORY FILTER EVENTS
// ============================================================================

function attachHistoryFilterEvents() {

  const searchInput =
    document.getElementById(
      "history-search"
    );

  const sortSelect =
    document.getElementById(
      "history-sort"
    );

  const workoutFilter =
    document.getElementById(
      "history-workout-filter"
    );

  if (searchInput) {

    searchInput.addEventListener(
      "input",
      filterHistory
    );

  }

  if (sortSelect) {

    sortSelect.addEventListener(
      "change",
      filterHistory
    );

  }

  if (workoutFilter) {

    workoutFilter.addEventListener(
      "change",
      filterHistory
    );

  }

}

// ============================================================================
// LOAD HISTORY
// ============================================================================

export async function loadHistory() {

  const container =
    getHistoryContainer();

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="history-loading">
      Loading workout history...
    </div>
  `;

  try {

    const page =
      await getWorkoutLogsPage();

    historyCursor = page.cursor;
    historyHasMore = page.hasMore;

    historyLogs =
      Array.isArray(page.logs)
        ? page.logs.filter(log => !log.status || log.status === "completed")
        : [];

    renderHistory(
      historyLogs
    );

    populateWorkoutFilter();

    attachHistoryFilterEvents();

    filterHistory();

  } catch (error) {

    console.error(
      "Failed to load workout history:",
      error
    );

    container.innerHTML = `
      <div class="history-empty-state">

        <div class="history-empty-icon">
          !
        </div>

        <h3>
          Could not load workout history
        </h3>

        <p>
          Please try again.
        </p>

      </div>
    `;

  }

}

// ============================================================================
// WORKOUT DATA REFRESH
// ============================================================================

window.addEventListener(
  "recomposition-workout-updated",
  async () => {
    await loadHistory();
  }
);


// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionHistory = {
  loadHistory
};