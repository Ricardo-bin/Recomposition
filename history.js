// ============================================================================
// RECOMPOSITION — WORKOUT HISTORY
// ----------------------------------------------------------------------------
// Workout LOGS (Firestore) are the only History data. This file only loads,
// shows, edits and deletes them. All search / filter / summary / comparison
// logic is the pure historyView.js.
//
// Workouts finished offline that have not synced yet are READ from the
// existing pending queue (pendingWorkouts.js) and shown in a separate
// PENDING SYNC section. They are never copied anywhere: once a workout syncs,
// the queue entry is removed and the normal Firestore log takes over.
// ============================================================================

import { isCompletedLog } from "./workoutLogStatus.js";

import { auth } from "./firebase.js";

import {
  getWorkoutLogsPage,
  getPreviousWorkoutLog,
  findPreviousLogs,
  updateWorkoutLog,
  deleteWorkoutLog
} from "./data/recompositionData.js";

import { readPending } from "./pendingWorkouts.js";

import {
  DEFAULT_CRITERIA,
  DATE_RANGES,
  filterLogs,
  hasActiveFilters,
  planOptions,
  exerciseOptions,
  rangeStartKey,
  summarizeLog,
  describeExercise,
  previousExercise,
  applySetEdits,
  pendingDisplayLogs,
  dateKey,
  toDate
} from "./historyView.js";

// ============================================================================
// HISTORY STATE
// ============================================================================

let historyLogs = [];
let historyCursor = null;
let historyHasMore = false;
let historyLoadingMore = false;

// Current search / filters. Kept here so BACK and CANCEL restore them.
let historyCriteria = { ...DEFAULT_CRITERIA };

let historyRequestId = 0;     // ignores a load that finished after sign-out / reload
let detailToken = 0;          // ignores previous-session lookups after leaving a detail

// A date range may need more pages than the first one; never load forever.
const MAX_RANGE_PAGES = 10;

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
  const value = toDate(date);

  if (!value) {
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

// "Mon 6 Oct 2026 · 10:15"
function formatCardDate(date) {
  const value = toDate(date);

  if (!value) {
    return "Unknown date";
  }

  const day = value.toLocaleDateString(
    undefined,
    { weekday: "short", day: "numeric", month: "short", year: "numeric" }
  );

  return `${day} · ${formatTime(value)}`;
}

function formatTime(date) {
  const value = toDate(date);

  if (!value) {
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

// Workouts finished on this device that are still waiting to sync, for the
// signed-in user only. A workout that already appears in Firestore is skipped.
function getPendingLogs() {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    return [];
  }

  return pendingDisplayLogs(readPending(uid), historyLogs);
}

function findLog(logId) {
  return historyLogs.find(log => log.id === logId) ||
    getPendingLogs().find(log => log.id === logId) ||
    null;
}

// Compact "45kg×8" (no spaces) so four sets fit on one phone-width row.
const formatSetValue = set =>
  set.weight !== "" || set.reps !== ""
    ? `${set.weight !== "" ? `${set.weight}kg` : "—"}×${set.reps !== "" ? set.reps : "—"}`
    : "—";

const formatOneRm = value => {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}kg`;
};

// ============================================================================
// LIST VIEW
// ============================================================================

function renderMessage(icon, title, extra = "") {
  return `
    <div class="history-empty-state">

      <div class="history-empty-icon">
        ${icon}
      </div>

      <h3>
        ${escapeHtml(title)}
      </h3>

      ${extra}

    </div>
  `;
}

function renderBadges(summary, log) {
  return `
    ${log.isPending ? `<span class="history-badge history-badge-pending">WAITING TO SYNC</span>` : ""}
    ${summary.hasAlternative ? `<span class="history-badge">ALTERNATIVE TODAY</span>` : ""}
    ${summary.isEdited ? `<span class="history-badge">EDITED</span>` : ""}
  `;
}

function renderWorkoutCard(log) {
  const summary = summarizeLog(log);

  return `
    <article class="history-workout-card">

      <button
        type="button"
        class="history-card-open"
        data-history-open="${escapeHtml(log.id)}"
      >

        <span class="history-card-main">

          <span class="history-workout-date">
            ${escapeHtml(formatCardDate(log.date))}
          </span>

          <span class="history-workout-title">
            ${escapeHtml(summary.name)}
          </span>

          <span class="history-workout-meta">
            <span>${summary.exerciseCount} exercise${summary.exerciseCount !== 1 ? "s" : ""}</span>
            <span>•</span>
            <span>${summary.setCount} set${summary.setCount !== 1 ? "s" : ""}</span>
            ${summary.volume > 0 ? `<span>•</span><span>${summary.volume.toLocaleString()} kg</span>` : ""}
          </span>

          <span class="history-badges">
            ${renderBadges(summary, log)}
          </span>

        </span>

        <span class="history-card-chevron" aria-hidden="true">›</span>

      </button>

    </article>
  `;
}

function renderPendingSection() {
  const pending = getPendingLogs();

  if (!pending.length) {
    return "";
  }

  return `
    <section class="history-pending">

      <h3 class="history-pending-title">
        PENDING SYNC
      </h3>

      <p class="history-pending-note">
        Saved on this device. ${pending.length === 1 ? "It" : "They"} will
        sync automatically when you're online.
      </p>

      ${pending.map(renderWorkoutCard).join("")}

    </section>
  `;
}

function renderHistoryShell() {
  const container = getHistoryContainer();

  if (!container) {
    console.error("History container not found.");
    return;
  }

  container.innerHTML = `
    <div id="history-pending-holder"></div>

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
          value="${escapeHtml(historyCriteria.search)}"
        >

      </div>

      <div class="history-filter-grid">

        <select id="history-range" class="history-filter-select" aria-label="Date range">
          ${DATE_RANGES.map(range => `
            <option value="${range.value}" ${historyCriteria.range === range.value ? "selected" : ""}>
              ${range.label}
            </option>
          `).join("")}
        </select>

        <select id="history-sort" class="history-filter-select" aria-label="Sort">
          <option value="newest" ${historyCriteria.sort === "newest" ? "selected" : ""}>Newest first</option>
          <option value="oldest" ${historyCriteria.sort === "oldest" ? "selected" : ""}>Oldest first</option>
        </select>

        <select id="history-workout-filter" class="history-filter-select" aria-label="Workout"></select>

        <select id="history-exercise-filter" class="history-filter-select" aria-label="Exercise"></select>

      </div>

      <div
        class="history-custom-range"
        id="history-custom-range"
        ${historyCriteria.range === "custom" ? "" : "hidden"}
      >

        <label>
          <span>FROM</span>
          <input type="date" id="history-from" class="history-date-input" value="${escapeHtml(historyCriteria.from)}">
        </label>

        <label>
          <span>TO</span>
          <input type="date" id="history-to" class="history-date-input" value="${escapeHtml(historyCriteria.to)}">
        </label>

      </div>

      <div class="history-filter-status">
        <span id="history-count"></span>
        <button type="button" class="history-clear-filters" id="history-clear-filters" hidden>
          CLEAR
        </button>
      </div>

    </div>

    <div id="history-results"></div>

    <div id="history-load-more"></div>
  `;

  populateFilterOptions();
  attachHistoryFilterEvents();
}

// Fills the plan / exercise dropdowns from the LOADED logs and keeps the
// current selection when it still exists.
function populateFilterOptions() {
  const plans = planOptions(historyLogs);
  const exercises = exerciseOptions(historyLogs);

  if (historyCriteria.plan !== "all" && !plans.includes(historyCriteria.plan)) {
    historyCriteria.plan = "all";
  }

  if (historyCriteria.exercise !== "all" && !exercises.some(option => option.key === historyCriteria.exercise)) {
    historyCriteria.exercise = "all";
  }

  const planSelect = document.getElementById("history-workout-filter");
  const exerciseSelect = document.getElementById("history-exercise-filter");

  if (planSelect) {
    planSelect.innerHTML = `
      <option value="all">All workouts</option>
      ${plans.map(name => `
        <option value="${escapeHtml(name)}" ${historyCriteria.plan === name ? "selected" : ""}>
          ${escapeHtml(name)}
        </option>
      `).join("")}
    `;
  }

  if (exerciseSelect) {
    exerciseSelect.innerHTML = `
      <option value="all">All exercises</option>
      ${exercises.map(option => `
        <option value="${escapeHtml(option.key)}" ${historyCriteria.exercise === option.key ? "selected" : ""}>
          ${escapeHtml(option.label)}
        </option>
      `).join("")}
    `;
  }
}

function emptyResultsMessage() {
  if (hasActiveFilters(historyCriteria)) {
    return "No workouts match these filters.";
  }

  return "No workouts match your search.";
}

// Re-renders ONLY the results area (the search box keeps focus).
function refreshHistoryResults() {
  const results = document.getElementById("history-results");

  if (!results) {
    return;
  }

  const filtered = filterLogs(historyLogs, historyCriteria);

  const filtering = hasActiveFilters(historyCriteria) || historyCriteria.search.trim() !== "";

  const count = document.getElementById("history-count");

  if (count) {
    count.textContent = filtering
      ? `${filtered.length} of ${historyLogs.length} workout${historyLogs.length !== 1 ? "s" : ""}`
      : `${historyLogs.length} workout${historyLogs.length !== 1 ? "s" : ""}`;
  }

  const clear = document.getElementById("history-clear-filters");

  if (clear) {
    clear.hidden = !filtering;
  }

  const pendingHolder = document.getElementById("history-pending-holder");

  if (pendingHolder) {
    pendingHolder.innerHTML = renderPendingSection();
    attachOpenEvents(pendingHolder);
  }

  results.innerHTML = filtered.length
    ? filtered.map(renderWorkoutCard).join("")
    : renderMessage("◇", emptyResultsMessage());

  attachOpenEvents(results);
  renderHistoryLoadMore();
}

function attachOpenEvents(root) {
  root
    .querySelectorAll("[data-history-open]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => openWorkoutDetail(button.dataset.historyOpen)
      );
    });
}

function readCriteriaFromDom() {
  const value = (id, fallback) => document.getElementById(id)?.value ?? fallback;

  historyCriteria = {
    search: value("history-search", historyCriteria.search),
    sort: value("history-sort", historyCriteria.sort),
    plan: value("history-workout-filter", historyCriteria.plan),
    exercise: value("history-exercise-filter", historyCriteria.exercise),
    range: value("history-range", historyCriteria.range),
    from: value("history-from", historyCriteria.from),
    to: value("history-to", historyCriteria.to)
  };

  const custom = document.getElementById("history-custom-range");

  if (custom) {
    custom.hidden = historyCriteria.range !== "custom";
  }
}

function attachHistoryFilterEvents() {
  const onChange = async () => {
    readCriteriaFromDom();
    refreshHistoryResults();
    await ensureRangeLoaded();
  };

  document.getElementById("history-search")?.addEventListener("input", () => {
    readCriteriaFromDom();
    refreshHistoryResults();
  });

  [
    "history-sort",
    "history-workout-filter",
    "history-exercise-filter",
    "history-range",
    "history-from",
    "history-to"
  ].forEach(id => {
    document.getElementById(id)?.addEventListener("change", onChange);
  });

  document.getElementById("history-clear-filters")?.addEventListener("click", () => {
    historyCriteria = { ...DEFAULT_CRITERIA, sort: historyCriteria.sort };
    renderHistoryShell();
    refreshHistoryResults();
  });
}

// No cloud workouts: just the (possible) pending section and a short message.
function renderEmptyHistory() {
  const container = getHistoryContainer();

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div id="history-pending-holder">${renderPendingSection()}</div>
    ${renderMessage(
      "◇",
      "No workouts yet.",
      `<p>Complete your first workout and it will appear here.</p>`
    )}
  `;

  attachOpenEvents(container);
}

// Back from a detail / edit screen: same search and filters as before.
function showHistoryList() {
  if (!historyLogs.length) {
    renderEmptyHistory();
    return;
  }

  renderHistoryShell();
  refreshHistoryResults();
  getHistoryContainer()?.scrollIntoView({ block: "start" });
}

// ============================================================================
// PAGINATION
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

// Fetches ONE older page. Returns false when nothing more was added/possible.
async function fetchOlderPage() {
  if (historyLoadingMore || !historyHasMore) {
    return false;
  }

  historyLoadingMore = true;

  const requestId = historyRequestId;

  try {

    const page = await getWorkoutLogsPage({
      after: historyCursor
    });

    // Signed out / reloaded while waiting: this page is not ours any more.
    if (requestId !== historyRequestId) {
      return false;
    }

    historyCursor = page.cursor;
    historyHasMore = page.hasMore;

    const knownIds = new Set(historyLogs.map(log => log.id));

    historyLogs = [
      ...historyLogs,
      ...page.logs.filter(
        log => !knownIds.has(log.id) && isCompletedLog(log)
      )
    ];

    return true;

  } finally {

    historyLoadingMore = false;

  }
}

async function loadOlderHistory() {
  renderHistoryLoadMore();

  try {

    await fetchOlderPage();

  } catch (error) {

    console.error("Failed to load older workouts:", error);

    window.alert("Could not load older workouts. Please try again.");

  } finally {

    populateFilterOptions();
    refreshHistoryResults();

  }
}

// Logs come back newest-first, so a "last N days" / custom-from range is
// complete as soon as the oldest loaded workout is older than its first day.
async function ensureRangeLoaded() {
  const startKey =
    historyCriteria.range === "custom"
      ? historyCriteria.from || null
      : rangeStartKey(historyCriteria.range);

  if (!startKey) {
    return;
  }

  const oldestKey = () => {
    const oldest = toDate(historyLogs[historyLogs.length - 1]?.date);
    return oldest ? dateKey(oldest) : null;
  };

  let pages = 0;

  try {

    while (
      historyHasMore &&
      pages < MAX_RANGE_PAGES &&
      (oldestKey() === null || oldestKey() >= startKey)
    ) {
      if (!(await fetchOlderPage())) {
        break;
      }

      pages += 1;
    }

  } catch (error) {

    console.error("Failed to load workouts for the date range:", error);

  } finally {

    if (pages > 0) {
      populateFilterOptions();
      refreshHistoryResults();
    }

  }
}

// ============================================================================
// DETAIL VIEW
// ============================================================================

// Compact horizontal sets: "45kg×8" with "· R2" directly beneath it, one column
// per set. Up to 4 sets stay on one row; the font shrinks (never below 12px)
// to fit, and only when even that cannot fit do the sets wrap naturally.
function renderSetRows(sets, { showRir = true, muted = false } = {}) {
  if (!sets.length) {
    return `<div class="history-empty-sets">No set data recorded.</div>`;
  }

  const values = sets.map(formatSetValue);
  const chars = Math.max(...values.map(value => value.length), 4);

  return `
    <div class="history-sets${muted ? " history-sets--muted" : ""}" style="--set-n:${sets.length};--set-chars:${chars}">
      ${sets.map((set, index) => `
        <div class="history-set" data-set="${set.number}">
          <span class="history-set-value">${escapeHtml(values[index])}</span>
          ${showRir ? `<span class="history-set-rir">${set.rir !== "" ? `· R${escapeHtml(set.rir)}` : "&nbsp;"}</span>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function formatBestSet(best) {
  return `${best.weight}kg×${best.reps} · 1RM ${formatOneRm(best.estimatedOneRepMax)}`;
}

function renderDetailExercise(exercise, index) {
  const info = describeExercise(exercise);

  // Alternative Today: performed exercise is the title; the planned exercise,
  // the TODAY ONLY marker and the "plan unchanged" explanation share one line.
  const altLine = info.isAlternative
    ? `
      <div class="history-alt-line">
        <span class="history-alt-tag">TODAY ONLY</span>
        <span class="history-alt-names">${escapeHtml(info.plannedName || "Planned exercise")} → ${escapeHtml(info.name)}</span>
        <span class="history-alt-note">Saved plan not changed.</span>
      </div>
    `
    : "";

  const target = [
    info.target,
    info.targetRir ? `RIR ${info.targetRir}` : ""
  ].filter(Boolean).join(" · ");

  return `
    <article class="history-detail-exercise${info.isAlternative ? " history-detail-exercise--alt" : ""}" data-detail-exercise="${index}">

      <header class="history-ex-head">

        <h3 class="history-detail-name">${escapeHtml(info.name)}</h3>

        ${altLine}

        ${target ? `<div class="history-target-line">${escapeHtml(target)}</div>` : ""}

      </header>

      ${renderSetRows(info.sets)}

      <div class="history-ex-foot">

        ${info.best ? `<div class="history-best">BEST ${escapeHtml(formatBestSet(info.best))}</div>` : ""}

        ${info.notes ? `<div class="history-detail-notes">${escapeHtml(info.notes)}</div>` : ""}

        <div class="history-compare" data-compare="${index}">
          <div class="history-compare-status">Looking for the previous session…</div>
        </div>

      </div>

    </article>
  `;
}

function renderComparison(currentSets, previousLog, previousEx) {
  const previousDetail = describeExercise(previousEx);
  const previousBest = previousDetail.best;
  const date = formatCardDate(previousLog.date).split(" · ")[0];

  return `
    <div class="history-compare-head">
      <span class="history-compare-label">PREVIOUS · ${escapeHtml(date)}</span>
      ${previousBest ? `<span class="history-compare-best">${escapeHtml(formatBestSet(previousBest))}</span>` : ""}
    </div>

    ${renderSetRows(previousDetail.sets, { showRir: false, muted: true })}

    <div class="history-compare-note">Performance comparison only.</div>
  `;
}

// Same lookup the active workout uses (findPreviousLogs). The loaded history is
// tried first; only if nothing is found there AND older pages exist does it ask
// the data layer, which searches everything.
async function findPreviousSession(log, exercise) {
  const local = findPreviousLogs(
    historyLogs.filter(item => item.id !== log.id),
    log.planId,
    exercise.exerciseId,
    log.date
  )[0];

  if (local) {
    return local;
  }

  if (!historyHasMore) {
    return null;
  }

  return getPreviousWorkoutLog(log.planId, exercise.exerciseId, log.date);
}

async function fillComparisons(log, token) {
  const exercises = Array.isArray(log.exercises) ? log.exercises : [];

  await Promise.all(exercises.map(async (exercise, index) => {

    let html;

    try {

      const previousLog = await findPreviousSession(log, exercise);
      const previousEx = previousLog && previousExercise(previousLog, exercise.exerciseId);

      html = previousEx
        ? renderComparison(exercise.sets, previousLog, previousEx)
        : `<div class="history-compare-status">No earlier session of this exercise.</div>`;

    } catch (error) {

      console.error("Failed to find the previous session:", error);

      html = `<div class="history-compare-status">Previous session couldn't be loaded.</div>`;

    }

    // The user may have gone back / opened another workout meanwhile.
    if (token !== detailToken) {
      return;
    }

    const holder = document.querySelector(`[data-compare="${index}"]`);

    if (holder) {
      holder.innerHTML = html;
    }

  }));
}

function openWorkoutDetail(logId) {
  const log = findLog(logId);
  const container = getHistoryContainer();

  if (!log || !container) {
    showHistoryList();
    return;
  }

  const summary = summarizeLog(log);
  const exercises = Array.isArray(log.exercises) ? log.exercises : [];

  detailToken += 1;
  const token = detailToken;

  container.innerHTML = `
    <div class="history-detail">

      <button type="button" class="history-back-btn" id="history-back">
        ‹ BACK TO HISTORY
      </button>

      <header class="history-detail-header">

        <div class="history-workout-date">
          ${escapeHtml(formatDate(log.date))}${formatTime(log.date) ? ` · ${escapeHtml(formatTime(log.date))}` : ""}
        </div>

        <h2>${escapeHtml(summary.name)}</h2>

        <div class="history-workout-meta">
          <span>${summary.exerciseCount} exercise${summary.exerciseCount !== 1 ? "s" : ""}</span>
          <span>•</span>
          <span>${summary.setCount} set${summary.setCount !== 1 ? "s" : ""}</span>
          ${summary.volume > 0 ? `<span>•</span><span>${summary.volume.toLocaleString()} kg</span>` : ""}
        </div>

        <div class="history-badges">
          ${renderBadges(summary, log)}
        </div>

      </header>

      ${log.isPending ? `
        <p class="history-pending-note">
          This workout is saved on this device and has not synced yet.
          It can be edited or deleted after it syncs.
        </p>
      ` : ""}

      <div class="history-detail-exercises">
        ${exercises.length ? exercises.map(renderDetailExercise).join("") : `<div class="history-empty-sets">No exercises recorded.</div>`}
      </div>

      ${log.isPending ? "" : `
        <div class="history-detail-actions">

          <button type="button" class="history-edit-btn" data-history-edit="${escapeHtml(log.id)}">
            EDIT
          </button>

          <button type="button" class="history-delete-btn" data-history-delete="${escapeHtml(log.id)}">
            DELETE
          </button>

        </div>
      `}

    </div>
  `;

  container.scrollIntoView({ block: "start" });

  document.getElementById("history-back")?.addEventListener("click", showHistoryList);

  container.querySelector("[data-history-edit]")?.addEventListener(
    "click",
    () => editWorkout(log.id, historyLogs)
  );

  container.querySelector("[data-history-delete]")?.addEventListener(
    "click",
    () => deleteWorkout(log.id, historyLogs)
  );

  fillComparisons(log, token);
}

// ============================================================================
// EDIT WORKOUT
// ============================================================================

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
        openWorkoutDetail(log.id);
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
  // Read what the user typed: edits[exerciseIndex][setIndex] = { weight, reps, rir }.
  const edits = Array.from(
    document.querySelectorAll("[data-edit-exercise]")
  ).map(exerciseElement =>
    Array.from(
      exerciseElement.querySelectorAll("[data-edit-set]")
    ).map(setElement => {
      const field = name =>
        setElement.querySelector(`[data-edit-field="${name}"]`)?.value ?? "";

      return {
        weight: field("weight"),
        reps: field("reps"),
        rir: field("rir")
      };
    })
  );

  // Only the sets' weight / reps / RIR change. Exercise identity (exerciseId,
  // name, library link, Alternative Today fields, targets) is carried over.
  const updatedExercises = applySetEdits(log.exercises, edits);

  const saveButton =
    document.getElementById(
      "history-save-edit"
    );

  try {

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "SAVING...";
    }

    // ONLY the log's exercises are written - never a workout plan.
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
// LOAD HISTORY
// ============================================================================

// Dashboard deep link: "open this workout once the list has loaded". The request
// expires quickly so a stale one can never open something later.
let openRequest = null;

function requestOpenWorkout(logId) {
  openRequest = { logId, at: Date.now() };
}

function consumeOpenRequest() {
  const request = openRequest;

  openRequest = null;

  if (request && Date.now() - request.at < 15000 && findLog(request.logId)) {
    openWorkoutDetail(request.logId);
  }
}

export async function loadHistory() {
  const container =
    getHistoryContainer();

  if (!container) {
    return;
  }

  const requestId = ++historyRequestId;

  container.innerHTML = `
    <div class="history-loading">
      Loading history...
    </div>
  `;

  try {

    const page =
      await getWorkoutLogsPage();

    // Another load started, or the user signed out, while this one was running.
    if (requestId !== historyRequestId) {
      return;
    }

    historyCursor = page.cursor;
    historyHasMore = page.hasMore;

    historyLogs =
      Array.isArray(page.logs)
        ? page.logs.filter(isCompletedLog)
        : [];

    if (!historyLogs.length) {
      renderEmptyHistory();
      consumeOpenRequest();
      return;
    }

    renderHistoryShell();
    refreshHistoryResults();
    consumeOpenRequest();

    await ensureRangeLoaded();

  } catch (error) {

    if (requestId !== historyRequestId) {
      return;
    }

    console.error(
      "Failed to load workout history:",
      error
    );

    container.innerHTML = `
      ${renderMessage(
        "!",
        "History couldn't be loaded.",
        `<button type="button" class="secondary-btn" id="history-retry">TRY AGAIN</button>`
      )}
    `;

    document
      .getElementById("history-retry")
      ?.addEventListener("click", loadHistory);

  }
}

// ============================================================================
// WORKOUT DATA REFRESH
// ============================================================================

window.addEventListener(
  "recomposition-workout-updated",
  async () => {
    // Nobody signed in: there is nothing to load.
    if (!auth.currentUser) {
      return;
    }

    await loadHistory();
  }
);

// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionHistory = {
  loadHistory,
  requestOpenWorkout
};

// ============================================================================
// SIGN-OUT: drop the previous user's data
// ============================================================================

window.addEventListener("recomposition-signed-out", () => {
  historyRequestId += 1;        // a load still in flight must not render later
  detailToken += 1;

  openRequest = null;
  historyLogs = [];
  historyCursor = null;
  historyHasMore = false;
  historyLoadingMore = false;
  historyCriteria = { ...DEFAULT_CRITERIA };   // search / filters belong to the user

  const container = getHistoryContainer();

  if (container) {
    container.innerHTML = "";
  }
});
