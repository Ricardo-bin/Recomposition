// ============================================================================
// RECOMPOSITION — Goals
// ============================================================================

import {
  getGoals,
  saveGoal,
  deleteGoal,
  getProfile,
  getWeightHistory
} from "./data/recompositionData.js";

import {
  calculateNutritionRecommendation,
  buildNutritionInput,
  buildAppliedNutritionFields,
  recommendationMatchesGoal,
  resolveNutritionSource,
  toGoalKey
} from "./nutritionEngine.js";

import {
  formatWeight,
  normalizeWeightUnit
} from "./units.js";

import {
  resolveCurrentWeight
} from "./currentWeight.js";


// ============================================================================
// STATE
// ============================================================================

let goals = [];
let editingGoalId = null;

// Nutrition recommendation (calculated on demand; never saved until APPLIED)
let nutritionContext = null;     // { profile, weight, unit } | { failed: true } | null
let nutritionRequest = 0;        // ignores stale async loads
let displayWeightUnit = "kg";    // for weights shown on goal cards


// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatGoalType(type) {
  return type || "Custom";
}


// ============================================================================
// LOAD GOALS
// ============================================================================

export async function loadGoals(container) {

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="section-heading">

      <div class="section-kicker">
        NUTRITION TARGETS
      </div>

      <h1 class="section-title">
        Goals
      </h1>

      <p class="section-description">
        Set and manage your current nutrition and body-composition targets.
      </p>

    </div>

    <div class="loading-row">
      Loading goals...
    </div>
  `;

  try {

    goals = await getGoals();

    // Only used to show weights in the preferred unit; a failure is harmless.
    displayWeightUnit = normalizeWeightUnit(
      (await getProfile().catch(() => null))?.unitPreference
    );

    renderGoals(container);

  } catch (error) {

    console.error("Goals failed to load:", error);

    container.innerHTML = `
      <div class="section-heading">

        <div class="section-kicker">
          SYSTEM ERROR
        </div>

        <h1 class="section-title">
          Goals unavailable
        </h1>

        <p class="section-description">
          Recomposition could not load your goals.
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
// MAIN UI
// ============================================================================

function renderGoals(container) {

  container.innerHTML = `

    <div class="section-heading">

      <div class="section-kicker">
        NUTRITION TARGETS
      </div>

      <h1 class="section-title">
        Goals
      </h1>

      <p class="section-description">
        Set and manage your current nutrition and body-composition targets.
      </p>

    </div>


    <div class="goals-actions">

      <button
        type="button"
        class="primary-btn"
        id="btn-new-goal"
      >
        + New Goal
      </button>

    </div>


    <div id="goal-form-container"></div>


    <div id="goals-list">

      ${
        goals.length === 0

          ? `
            <div class="empty-state">

              <div class="empty-state-title">
                No goals yet
              </div>

              <div class="empty-state-text">
                Create your first goal to set your nutrition targets.
              </div>

            </div>
          `

          : goals.map(renderGoalCard).join("")
      }

    </div>

  `;


  document
    .getElementById("btn-new-goal")
    ?.addEventListener("click", () => {

      editingGoalId = null;

      renderGoalForm();

    });


  attachGoalEvents();
}


// ============================================================================
// GOAL CARD
// ============================================================================

function renderGoalCard(goal) {

  return `

    <div
      class="panel goal-card"
      data-goal-id="${escapeHtml(goal.id)}"
    >

      <div class="goal-card-header">

        <div>

          <div class="section-kicker">
            GOAL
          </div>

          <h3>
            ${escapeHtml(formatGoalType(goal.goalType))}
          </h3>

        </div>

      </div>


      <div class="goal-target-grid">

        <div>
          <span>Calories</span>
          <strong>
            ${escapeHtml(goal.calories ?? "—")} kcal
          </strong>
        </div>

        <div>
          <span>Protein</span>
          <strong>
            ${escapeHtml(goal.protein ?? "—")} g
          </strong>
        </div>

        <div>
          <span>Carbs</span>
          <strong>
            ${escapeHtml(goal.carbs ?? "—")} g
          </strong>
        </div>

        <div>
          <span>Fat</span>
          <strong>
            ${escapeHtml(goal.fat ?? "—")} g
          </strong>
        </div>

      </div>


      ${renderNutritionSourceLine(goal)}

      <div class="goal-dates">

        <div>
          <span>Start</span>
          <strong>
            ${escapeHtml(goal.startDate || "—")}
          </strong>
        </div>

        <div>
          <span>End</span>
          <strong>
            ${escapeHtml(goal.endDate || "—")}
          </strong>
        </div>

      </div>


      <div class="goal-actions">

        <button
          type="button"
          class="secondary-btn btn-edit-goal"
          data-id="${escapeHtml(goal.id)}"
        >
          Edit
        </button>

        <button
          type="button"
          class="secondary-btn btn-delete-goal"
          data-id="${escapeHtml(goal.id)}"
        >
          Delete
        </button>

      </div>

    </div>

  `;
}


// ============================================================================
// GOAL FORM
// ============================================================================

function renderGoalForm() {

  const container =
    document.getElementById("goal-form-container");

  if (!container) {
    return;
  }


  const existingGoal =
    goals.find(goal => goal.id === editingGoalId);


  container.innerHTML = `

    <div class="panel goal-form">

      <div class="section-kicker">
        ${existingGoal ? "EDIT GOAL" : "NEW GOAL"}
      </div>

      <h3>
        ${existingGoal ? "Update Goal" : "Create Goal"}
      </h3>


      <div class="form-grid">


        <div class="form-field">

          <label for="goal-type">
            Goal Type
          </label>

          <select id="goal-type">

            ${[
              "Maintenance",
              "Recomposition",
              "Lean Bulk",
              "Bulk",
              "Cut",
              "Fat Loss",
              "Custom"
            ].map(type => `

              <option
                value="${type}"
                ${
                  existingGoal?.goalType === type
                    ? "selected"
                    : ""
                }
              >
                ${type}
              </option>

            `).join("")}

          </select>

        </div>


        <div class="form-field">

          <label for="goal-calories">
            Calories
          </label>

          <input
            id="goal-calories"
            type="number"
            min="0"
            placeholder="2500"
            value="${existingGoal?.calories ?? ""}"
          >

        </div>


        <div class="form-field">

          <label for="goal-protein">
            Protein (g)
          </label>

          <input
            id="goal-protein"
            type="number"
            min="0"
            placeholder="150"
            value="${existingGoal?.protein ?? ""}"
          >

        </div>


        <div class="form-field">

          <label for="goal-carbs">
            Carbs (g)
          </label>

          <input
            id="goal-carbs"
            type="number"
            min="0"
            placeholder="300"
            value="${existingGoal?.carbs ?? ""}"
          >

        </div>


        <div class="form-field">

          <label for="goal-fat">
            Fat (g)
          </label>

          <input
            id="goal-fat"
            type="number"
            min="0"
            placeholder="70"
            value="${existingGoal?.fat ?? ""}"
          >

        </div>


        <div class="form-field">

          <label for="goal-start">
            Start Date
          </label>

          <input
            id="goal-start"
            type="date"
            value="${existingGoal?.startDate ?? ""}"
          >

        </div>


        <div class="form-field">

          <label for="goal-end">
            End Date
          </label>

          <input
            id="goal-end"
            type="date"
            value="${existingGoal?.endDate ?? ""}"
          >

        </div>


      </div>

      <div
        class="nutrition-panel"
        id="goal-nutrition-panel"
        aria-live="polite"
      ></div>

      <div class="goal-form-actions">

        <button
          type="button"
          class="primary-btn"
          id="btn-save-goal"
        >
          Save Goal
        </button>

        <button
          type="button"
          class="secondary-btn"
          id="btn-cancel-goal"
        >
          Cancel
        </button>

      </div>

    </div>

  `;


  document
    .getElementById("btn-save-goal")
    ?.addEventListener("click", saveGoalFromForm);

  // Recommendation panel: calculated from current athlete data, shown for
  // review. Nothing is saved until the user presses APPLY RECOMMENDATION.
  document
    .getElementById("goal-type")
    ?.addEventListener("change", renderNutritionPanel);

  initNutritionPanel();


  document
    .getElementById("btn-cancel-goal")
    ?.addEventListener("click", () => {

      editingGoalId = null;

      container.innerHTML = "";

    });

}


// ============================================================================
// SAVE
// ============================================================================

async function saveGoalFromForm() {

  const goalType =
    document.getElementById("goal-type")?.value;

  const calories =
    document.getElementById("goal-calories")?.value;

  const protein =
    document.getElementById("goal-protein")?.value;

  const carbs =
    document.getElementById("goal-carbs")?.value;

  const fat =
    document.getElementById("goal-fat")?.value;

  const startDate =
    document.getElementById("goal-start")?.value;

  const endDate =
    document.getElementById("goal-end")?.value;


  if (!goalType || !startDate) {

    alert(
      "Goal type and start date are required."
    );

    return;
  }


  const goalId =
    editingGoalId ||
    crypto.randomUUID();


  const goal = {

    goalType,

    calories:
      calories === ""
        ? null
        : Number(calories),

    protein:
      protein === ""
        ? null
        : Number(protein),

    carbs:
      carbs === ""
        ? null
        : Number(carbs),

    fat:
      fat === ""
        ? null
        : Number(fat),

    startDate,

    endDate

  };


  try {

    const saveButton =
      document.getElementById("btn-save-goal");

    if (saveButton) {

      saveButton.disabled = true;

      saveButton.textContent =
        "Saving...";

    }


    await saveGoal(
      goalId,
      {
        ...goal,
        // Metadata only when needed: unchanged legacy goals are saved as before.
        ...resolveNutritionSource(
          goals.find(existing => existing.id === goalId),
          goal
        )
      }
    );


    editingGoalId = null;

    const container =
      document.getElementById("settings-goals-content");

    await loadGoals(container);


  } catch (error) {

    console.error(
      "Could not save goal:",
      error
    );

    alert(
      "Could not save the goal."
    );

  }
}


// ============================================================================
// NUTRITION RECOMMENDATION (review -> APPLY)
// ----------------------------------------------------------------------------
// RECOMMENDED is not ACTIVE. The recommendation is calculated by the pure
// nutritionEngine.js from the profile, the current weight and the selected goal
// type. It is only ever WRITTEN to a goal by applyRecommendation(), which runs
// when the user presses APPLY RECOMMENDATION. The Dashboard does not calculate:
// it keeps reading the active goal's saved numbers.
// ============================================================================

function renderNutritionSourceLine(goal) {
  if (goal.nutritionSource === "recommended") {
    const weight =
      goal.calculatedFromWeightKg !== null &&
      goal.calculatedFromWeightKg !== undefined
        ? ` · based on ${formatWeight(goal.calculatedFromWeightKg, displayWeightUnit)}`
        : "";

    const applied =
      goal.nutritionAppliedAt
        ? ` · applied ${String(goal.nutritionAppliedAt).slice(0, 10)}`
        : "";

    return `
      <div class="goal-source goal-source--recommended">
        Recommended targets${escapeHtml(applied)}${escapeHtml(weight)}
      </div>
    `;
  }

  if (goal.nutritionSource === "manual") {
    return `
      <div class="goal-source goal-source--manual">
        Manual targets
      </div>
    `;
  }

  return "";
}

async function loadNutritionContext() {
  try {
    const [profile, weightHistory] = await Promise.all([
      getProfile(),
      getWeightHistory().catch(() => [])
    ]);

    return {
      profile,
      weight: resolveCurrentWeight(weightHistory, profile?.currentWeight),
      unit: normalizeWeightUnit(profile?.unitPreference)
    };
  } catch (error) {
    console.error("Nutrition recommendation data failed to load:", error);

    return { failed: true };
  }
}

async function initNutritionPanel() {
  const request = ++nutritionRequest;

  nutritionContext = null;

  renderNutritionPanel();

  const context = await loadNutritionContext();

  // Ignore the answer if the form was closed or re-opened meanwhile.
  if (
    request !== nutritionRequest ||
    !document.getElementById("goal-nutrition-panel")
  ) {
    return;
  }

  nutritionContext = context;

  renderNutritionPanel();
}

function currentRecommendation() {
  if (!nutritionContext || nutritionContext.failed) {
    return null;
  }

  return calculateNutritionRecommendation(
    buildNutritionInput({
      profile: nutritionContext.profile,
      weightKg: nutritionContext.weight.weightKg,
      goalType: document.getElementById("goal-type")?.value
    })
  );
}

function renderNutritionPanel() {
  const panel =
    document.getElementById("goal-nutrition-panel");

  if (!panel) {
    return;
  }

  const header = `
    <div class="nutrition-panel-header">
      <div class="section-kicker">
        NUTRITION RECOMMENDATION
      </div>
      <span class="nutrition-badge">
        NOT ACTIVE UNTIL APPLIED
      </span>
    </div>
  `;

  // ---- still loading ----------------------------------------------------------
  if (!nutritionContext) {
    panel.innerHTML = `
      ${header}
      <p class="nutrition-note">
        Calculating a recommendation from your profile…
      </p>
    `;
    return;
  }

  // ---- profile could not be read -------------------------------------------------
  if (nutritionContext.failed) {
    panel.innerHTML = `
      ${header}
      <p class="nutrition-note">
        Your profile could not be loaded, so no recommendation is available.
        You can still enter your targets manually above.
      </p>
    `;
    return;
  }

  const result = currentRecommendation();

  // ---- Custom: fully manual --------------------------------------------------------
  if (result.status === "manual") {
    panel.innerHTML = `
      ${header}
      <p class="nutrition-note">
        Custom goals use the numbers you enter above. No recommendation is
        calculated.
      </p>
    `;
    return;
  }

  // ---- missing / impossible data ------------------------------------------------------
  if (!result.ok) {
    panel.innerHTML = `
      ${header}
      <p class="nutrition-note">
        A recommendation needs a few details in your profile first:
      </p>
      <ul class="nutrition-issues">
        ${result.errors.map(item => `
          <li>${escapeHtml(item.message)}</li>
        `).join("")}
      </ul>
      <button
        type="button"
        class="secondary-btn"
        id="btn-open-profile"
      >
        Open Profile
      </button>
    `;

    document
      .getElementById("btn-open-profile")
      ?.addEventListener("click", () => {
        window.RecompositionNavigation?.showSection("settings");

        document
          .getElementById("settings-profile")
          ?.click();
      });

    return;
  }

  // ---- a recommendation to review ------------------------------------------------------------
  const existing =
    goals.find(goal => goal.id === editingGoalId);

  const meta = result.calculationMetadata;

  const weight = nutritionContext.weight;

  const weightText =
    formatWeight(weight.weightKg, nutritionContext.unit) +
    (weight.source === "weight-history"
      ? ` (latest weigh-in${weight.date ? ` ${weight.date}` : ""})`
      : " (from your profile)");

  const sign = meta.adjustmentPercent > 0 ? "+" : "";

  const alreadyActive =
    recommendationMatchesGoal(existing, result) &&
    toGoalKey(existing?.goalType) === result.goalType;

  const rows = [
    ["Calories", "calories", "kcal"],
    ["Protein", "protein", "g"],
    ["Carbs", "carbs", "g"],
    ["Fat", "fat", "g"]
  ];

  panel.innerHTML = `
    ${header}

    <p class="nutrition-basis">
      ${escapeHtml(
        `BMR ${result.bmr} kcal · TDEE ${result.tdee} kcal · ` +
        `${meta.goalType.replace("-", " ")} ${sign}${meta.adjustmentPercent}%`
      )}
      <br>
      ${escapeHtml(`Based on ${weightText}`)}
    </p>

    <div class="nutrition-compare" role="table">
      <div class="nutrition-compare-row nutrition-compare-head" role="row">
        <span></span>
        <span>ACTIVE</span>
        <span>RECOMMENDED</span>
      </div>

      ${rows.map(([label, field, unit]) => {
        const active = existing?.[field];
        const hasActive =
          active !== null && active !== undefined && active !== "";

        const differs =
          !hasActive || Number(active) !== result[field];

        return `
          <div class="nutrition-compare-row" role="row">
            <span>${label}</span>
            <span class="nutrition-active">
              ${hasActive ? escapeHtml(`${active} ${unit}`) : "—"}
            </span>
            <span class="nutrition-recommended ${differs ? "is-different" : ""}">
              ${escapeHtml(`${result[field]} ${unit}`)}
            </span>
          </div>
        `;
      }).join("")}
    </div>

    ${
      alreadyActive
        ? `
          <p class="nutrition-note">
            Your active target already matches this recommendation.
          </p>
        `
        : `
          <p class="nutrition-note">
            Review the recommendation. Your active target stays as it is
            until you press Apply.
          </p>

          <button
            type="button"
            class="primary-btn nutrition-apply"
            id="btn-apply-nutrition"
          >
            Apply Recommendation
          </button>
        `
    }
  `;

  document
    .getElementById("btn-apply-nutrition")
    ?.addEventListener("click", applyRecommendation);
}

async function applyRecommendation() {
  const result = currentRecommendation();

  if (!result?.ok) {
    return;
  }

  const goalType =
    document.getElementById("goal-type")?.value;

  const startDate =
    document.getElementById("goal-start")?.value;

  const endDate =
    document.getElementById("goal-end")?.value;

  if (!goalType || !startDate) {
    alert(
      "Goal type and start date are required."
    );
    return;
  }

  const existing =
    goals.find(goal => goal.id === editingGoalId);

  // Never replace existing numbers without an explicit yes.
  const hasDifferentActive =
    existing &&
    ["calories", "protein", "carbs", "fat"].some(field => {
      const value = existing[field];

      return (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        Number(value) !== result[field]
      );
    });

  if (hasDifferentActive) {
    const confirmed = confirm(
      "Replace your active targets with the recommendation?\n\n" +
      `Now: ${existing.calories ?? "—"} kcal · ${existing.protein ?? "—"} g protein · ` +
      `${existing.carbs ?? "—"} g carbs · ${existing.fat ?? "—"} g fat\n` +
      `New: ${result.calories} kcal · ${result.protein} g protein · ` +
      `${result.carbs} g carbs · ${result.fat} g fat`
    );

    if (!confirmed) {
      return;
    }
  }

  const goalId =
    editingGoalId ||
    crypto.randomUUID();

  try {
    const button =
      document.getElementById("btn-apply-nutrition");

    if (button) {
      button.disabled = true;
      button.textContent = "Applying...";
    }

    await saveGoal(
      goalId,
      {
        goalType,
        startDate,
        endDate,
        ...buildAppliedNutritionFields(result)
      }
    );

    editingGoalId = null;

    await loadGoals(
      document.getElementById("settings-goals-content")
    );
  } catch (error) {
    console.error(
      "Could not apply the recommendation:",
      error
    );

    alert(
      "Could not apply the recommendation."
    );

    renderNutritionPanel();
  }
}


// ============================================================================
// EDIT / DELETE EVENTS
// ============================================================================

function attachGoalEvents() {


  document
    .querySelectorAll(".btn-edit-goal")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          editingGoalId =
            button.dataset.id;

          renderGoalForm();

          window.scrollTo({
            top: 0,
            behavior: "smooth"
          });

        }
      );

    });


  document
    .querySelectorAll(".btn-delete-goal")
    .forEach(button => {

      button.addEventListener(
        "click",
        async () => {

          const goalId =
            button.dataset.id;


          const confirmed =
            confirm(
              "Delete this goal?"
            );


          if (!confirmed) {
            return;
          }


          try {

            await deleteGoal(
              goalId
            );


            const container =
              document.getElementById(
                "settings-goals-content"
              );

            await loadGoals(
              container
            );


          } catch (error) {

            console.error(
              "Could not delete goal:",
              error
            );

            alert(
              "Could not delete the goal."
            );

          }

        }
      );

    });

}