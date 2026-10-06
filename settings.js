// ============================================================================
// RECOMPOSITION — SETTINGS
// ============================================================================

import {
  getProfile,
  getWorkoutPlans,
    getAllWorkoutLogs,
  getGoals,
  getWeightHistory,
  addWeightEntry,
  addMeasurement,
  getMeasurements
} from "./data/recompositionData.js";

import {
  normalizeWeightUnit,
  weightUnitLabel,
  displayToKg,
  formatWeight,
  weightRange
} from "./units.js";

import {
  sendPasswordResetEmail,
  signOut,
  linkWithCredential,
  EmailAuthProvider,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import {
  auth
} from "./firebase.js";

import {
  loadGoals
} from "./goals.js";

// Theme is reached through the global the theme foundation already exposes
// (no module coupling to the theme foundation files).
const THEME_LABELS = { "batman": "Batman Dark", "linkin-park": "Linkin Park Light" };
const getTheme = () => window.RecompositionTheme;

const THEME_META_COLOR = { "batman": "#050608", "linkin-park": "#ebe8e1" };

function syncThemeChrome(id) {
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_META_COLOR[id] ?? "#050608");
}

function themeOptionMarkup(id, sub) {
  return `
    <button type="button" class="theme-option" role="radio"
      data-theme-id="${id}" aria-checked="false">
      <span class="theme-preview" data-p="${id}" aria-hidden="true">
        <i class="bar"></i><i class="blk"></i><i class="pb"></i><i class="dot"></i>
      </span>
      <span class="theme-option-name">${THEME_LABELS[id]}</span>
      <span class="theme-option-sub">${sub}</span>
    </button>`;
}

function initializeThemeSwitch() {
  const switcher = document.getElementById("theme-switch");
  if (!switcher) return;

  const paint = () => {
    switcher.querySelectorAll(".theme-option").forEach(option => {
      option.setAttribute("aria-checked", String(option.dataset.themeId === getTheme()?.get()));
    });
  };

  switcher.addEventListener("click", event => {
    const option = event.target.closest(".theme-option");
    if (!option) return;
    if (getTheme()?.set(option.dataset.themeId)) {
      syncThemeChrome(getTheme().get());
      paint();
    }
  });

  paint();
}

function renderSettings() {

  const container =
    document.getElementById("settings-content");

  if (!container) {
    return;
  }

  

container.innerHTML = `
  <div class="settings-page">

    <div class="section-header">
      <div>
        <div class="section-eyebrow">
          APP CONFIGURATION
        </div>

        <h2>Settings</h2>

        <p>
          Manage your profile, body data and account.
        </p>
      </div>
    </div>


    <div class="settings-group">

      <div class="settings-group-title">
        APPEARANCE
      </div>

      <div class="theme-switch" id="theme-switch" role="radiogroup" aria-label="Theme">
        ${themeOptionMarkup("batman", "Tactical • Command center")}
        ${themeOptionMarkup("linkin-park", "Industrial • Alt rock")}
      </div>

    </div>


    <div class="settings-group">

      <div class="settings-group-title">
        ACCOUNT
      </div>

      <button
        type="button"
        class="settings-card"
        id="settings-profile"
      >
        <div class="settings-card-content">
          <div class="settings-card-title">
            Profile
          </div>

          <div class="settings-card-description">
            Personal, body & training
          </div>
        </div>

        <div class="settings-card-arrow">
          →
        </div>
          </button>

    <button
      type="button"
      class="settings-card"
      id="settings-account"
    >
      <div class="settings-card-content">
        <div class="settings-card-title">
          Account Settings
        </div>

        <div class="settings-card-description">
          Manage your account, password and session
        </div>
      </div>

      <div class="settings-card-arrow">
        →
      </div>
    </button>

  </div>


  <div class="settings-group">

    <div class="settings-group-title">
      BODY & PROGRESS
    </div>

      <button
        type="button"
        class="settings-card"
        id="settings-weight"
      >
        <div class="settings-card-content">
          <div class="settings-card-title">
            Weight History
          </div>

          <div class="settings-card-description">
            Track your body weight
          </div>
        </div>

        <div class="settings-card-arrow">
          →
        </div>
      </button>


      <button
        type="button"
        class="settings-card"
        id="settings-measurements"
      >
        <div class="settings-card-content">
          <div class="settings-card-title">
            Body Measurements
          </div>

          <div class="settings-card-description">
            Track body measurements
          </div>
        </div>

        <div class="settings-card-arrow">
          →
        </div>
      </button>

      <button
  type="button"
  class="settings-card"
  id="settings-goals"
>
  <div class="settings-card-content">
    <div class="settings-card-title">
      Goals
    </div>

    <div class="settings-card-description">
      Manage your nutrition targets
    </div>
  </div>

  <div class="settings-card-arrow">
    →
  </div>
</button>

    </div>


    <div class="settings-group">

      <div class="settings-group-title">
        DATA
      </div>

      <button
        type="button"
        class="settings-card"
        id="settings-export"
      >
        <div class="settings-card-content">
          <div class="settings-card-title">
            Export & Backup
          </div>

          <div class="settings-card-description">
            JSON • CSV • Excel
          </div>
        </div>

        <div class="settings-card-arrow">
          →
        </div>
      </button>

      </div>


  <div
    id="settings-export-panel"
    style="display: none;"
  >

    <div class="settings-group">

      <div class="settings-group-title">
        EXPORT & BACKUP
      </div>

      <div class="settings-export-actions">

        <button
          type="button"
          id="settings-export-json"
          class="primary-btn"
        >
          Download JSON Backup
        </button>

        <button
          type="button"
          id="settings-export-csv"
          class="primary-btn"
        >
          Download CSV Export
        </button>

        <button
          type="button"
          id="settings-export-excel"
          class="primary-btn"
        >
          Download Excel Workbook
        </button>

        <p class="settings-export-note">
          Download your Recomposition data for backup or external use.
        </p>

      </div>

    </div>

  </div>


</div>
`;

initializeSettingsNavigation();
initializeThemeSwitch();

  const exportButton =
    document.getElementById(
      "settings-export-json"
    );


  exportButton?.addEventListener(
  "click",
  async () => {

    try {

      exportButton.disabled = true;

      exportButton.textContent =
        "Preparing Backup...";

      const backup = {
        exportedAt:
          new Date().toISOString(),

        profile:
          await getProfile(),

        workoutPlans:
          await getWorkoutPlans(),

        workoutLogs:
          await getAllWorkoutLogs(),

        goals:
          await getGoals(),

        weightHistory:
          await getWeightHistory(),

        measurements:
          await getMeasurements()
      };


      const json =
        JSON.stringify(
          backup,
          null,
          2
        );


      const blob =
        new Blob(
          [json],
          {
            type:
              "application/json"
          }
        );


      const url =
        URL.createObjectURL(blob);


      const link =
        document.createElement("a");

      link.href = url;

      link.download =
        `recomposition-backup-${new Date()
          .toISOString()
          .slice(0, 10)}.json`;

      document.body.appendChild(link);

      link.click();

      link.remove();

      URL.revokeObjectURL(url);


      exportButton.disabled = false;
      exportButton.textContent =
        "Download JSON Backup";

      alert(
        "Backup downloaded successfully."
      );

    } catch (error) {

      console.error(
        "JSON export failed:",
        error
      );

      exportButton.disabled = false;

      exportButton.textContent =
        "Download JSON Backup";

      alert(
        "Could not create backup."
      );

    }

  }
);

  const csvButton =
    document.getElementById(
      "settings-export-csv"
    );

  function downloadCSV(filename, rows) {

    const csv = rows
      .map(row =>
        row
          .map(value => {
            const text = String(value ?? "");

            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob =
      new Blob(
        [csv],
        {
          type: "text/csv;charset=utf-8;"
        }
      );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();

    link.remove();

    URL.revokeObjectURL(url);
  }


  csvButton?.addEventListener(
    "click",
    async () => {

      try {

        csvButton.disabled = true;

        csvButton.textContent =
          "Preparing CSV...";


        const [
          workoutPlans,
          workoutLogs,
          goals,
          weightHistory,
          measurements
        ] = await Promise.all([

          getWorkoutPlans(),

          getAllWorkoutLogs(),

          getGoals(),

          getWeightHistory(),

          getMeasurements()

        ]);


        // ------------------------------------------------------------
        // WORKOUTS CSV
        // ------------------------------------------------------------

        const workoutRows = [
          [
            "Date",
            "Workout",
            "Exercise",
            "Set",
            "Weight (kg)",
            "Reps",
            "Actual RIR",
            "Notes"
          ]
        ];


        workoutLogs.forEach(log => {

          const date =
            log.date?.toDate
              ? log.date.toDate().toISOString()
              : log.date ?? "";

          const workout =
            log.planName ||
            log.workoutName ||
            "Workout Session";


          const exercises =
            Array.isArray(log.exercises)
              ? log.exercises
              : [];


          exercises.forEach(exercise => {

            const sets =
              Array.isArray(exercise.sets)
                ? exercise.sets
                : [];


            sets.forEach((set, index) => {

              workoutRows.push([
                date,
                workout,
                exercise.exerciseName ||
                  exercise.name ||
                  exercise.exerciseId ||
                  "",
                index + 1,
                set.weight ?? "",
                set.reps ?? "",
                (set.rir ?? set.actualRIR) ?? "",
                set.notes ?? ""
              ]);

            });

          });

        });


        // ------------------------------------------------------------
        // WEIGHT HISTORY CSV
        // ------------------------------------------------------------

        const weightRows = [
          [
            "Date",
            "Weight (kg)"
          ]
        ];


        weightHistory.forEach(entry => {

          const date =
            entry.date?.toDate
              ? entry.date.toDate().toISOString()
              : entry.date ?? "";

          weightRows.push([
            date,
            entry.weight ?? ""
          ]);

        });


        // ------------------------------------------------------------
        // BODY MEASUREMENTS CSV
        // ------------------------------------------------------------

        const measurementRows = [
          [
            "Date",
            "Shoulder",
            "Chest",
            "Waist",
            "Left Arm",
            "Right Arm",
            "Thigh",
            "Calves",
            "Forearms"
          ]
        ];


        measurements.forEach(entry => {

          const date =
            entry.date?.toDate
              ? entry.date.toDate().toISOString()
              : entry.date ?? "";

          measurementRows.push([
            date,
            (entry.shoulders ?? entry.shoulder) ?? "",
            entry.chest ?? "",
            entry.waist ?? "",
            (entry.leftArm ?? entry.arms) ?? "",
            (entry.rightArm ?? entry.arms) ?? "",
            (entry.thighs ?? entry.thigh) ?? "",
            entry.calves ?? "",
            entry.forearms ?? ""
          ]);

        });


        // ------------------------------------------------------------
        // GOALS CSV
        // ------------------------------------------------------------

        const goalRows = [
          [
            "Goal ID",
            "Goal Type",
            "Calories",
            "Protein (g)",
            "Carbs (g)",
            "Fat (g)",
            "Start Date",
            "End Date"
          ]
        ];


        goals.forEach(goal => {

          goalRows.push([
            goal.id ?? "",
            goal.type ||
              goal.goalType ||
              "",
            goal.calories ?? "",
            goal.protein ?? "",
            goal.carbs ?? "",
            goal.fat ?? "",
            goal.startDate ?? "",
            goal.endDate ?? ""
          ]);

        });


        // ------------------------------------------------------------
        // DOWNLOAD
        // ------------------------------------------------------------

        const date =
          new Date()
            .toISOString()
            .slice(0, 10);


        downloadCSV(
          `recomposition-workouts-${date}.csv`,
          workoutRows
        );


        setTimeout(() => {

          downloadCSV(
            `recomposition-weight-${date}.csv`,
            weightRows
          );

        }, 300);


        setTimeout(() => {

          downloadCSV(
            `recomposition-measurements-${date}.csv`,
            measurementRows
          );

        }, 600);


        setTimeout(() => {

          downloadCSV(
            `recomposition-goals-${date}.csv`,
            goalRows
          );

        }, 900);


        csvButton.textContent =
          "Download CSV Export";

        csvButton.disabled = false;


        alert(
          "CSV files downloaded successfully."
        );


      } catch (error) {

        console.error(
          "CSV export failed:",
          error
        );

        csvButton.disabled = false;

        csvButton.textContent =
          "Download CSV Export";

        alert(
          "Could not create CSV export."
        );

      }

    }
  );

  const excelButton =
    document.getElementById(
      "settings-export-excel"
    );


  excelButton?.addEventListener(
    "click",
    async () => {

      try {

        excelButton.disabled = true;

        excelButton.textContent =
          "Preparing Excel...";


        const [
          workoutPlans,
          workoutLogs,
          goals,
          weightHistory,
          measurements
        ] = await Promise.all([

          getWorkoutPlans(),

          getAllWorkoutLogs(),

          getGoals(),

          getWeightHistory(),

          getMeasurements()

        ]);


        // ------------------------------------------------------------
        // WORKOUT LOGS
        // ------------------------------------------------------------

        const workoutRows = [];


        workoutLogs.forEach(log => {

          const date =
            log.date?.toDate
              ? log.date.toDate()
              : new Date(log.date);


          const workout =
            log.planName ||
            log.workoutName ||
            "Workout Session";


          const exercises =
            Array.isArray(log.exercises)
              ? log.exercises
              : [];


          exercises.forEach(exercise => {

            const sets =
              Array.isArray(exercise.sets)
                ? exercise.sets
                : [];


            sets.forEach((set, index) => {

              workoutRows.push({

                Date:
                  Number.isNaN(date.getTime())
                    ? ""
                    : date,

                Workout:
                  workout,

                Exercise:
                  exercise.exerciseName ||
                  exercise.name ||
                  exercise.exerciseId ||
                  "",

                Set:
                  index + 1,

                "Weight (kg)":
                  set.weight ?? "",

                Reps:
                  set.reps ?? "",

                "Actual RIR":
                  (set.rir ?? set.actualRIR) ?? "",

                Notes:
                  set.notes ?? ""

              });

            });

          });

        });


        // ------------------------------------------------------------
        // WORKOUT PLANS
        // ------------------------------------------------------------

        const planRows = [];


        workoutPlans.forEach(plan => {

          const exercises =
            Array.isArray(plan.exercises)
              ? plan.exercises
              : [];


          if (exercises.length === 0) {

            planRows.push({

              Workout:
                plan.name ||
                plan.title ||
                "Workout",

              Day:
                planDayName(plan),

              Exercise:
                "",

              Sets:
                "",

              "Rep Range":
                "",

              "Target RIR":
                "",

              "Rest Time":
                "",

              Notes:
                ""

            });

            return;

          }


          exercises.forEach(exercise => {

            planRows.push({

              Workout:
                plan.name ||
                plan.title ||
                "Workout",

              Day:
                planDayName(plan),

              Exercise:
                exercise.exerciseName ||
                exercise.name ||
                exercise.exerciseId ||
                "",

              Sets:
                (typeof exercise.sets === "number" || typeof exercise.sets === "string" ? exercise.sets : (Array.isArray(exercise.sets) ? exercise.sets.length : "")),

              "Rep Range":
                planRepRange(exercise),

              "Target RIR":
                exercise.targetRIR ?? "",

              "Rest Time":
                (exercise.restSeconds ?? exercise.restTime) ?? "",

              Notes:
                exercise.notes ?? ""

            });

          });

        });


        // ------------------------------------------------------------
        // WEIGHT HISTORY
        // ------------------------------------------------------------

        const weightRows =
          weightHistory.map(entry => {

            const date =
              entry.date?.toDate
                ? entry.date.toDate()
                : new Date(entry.date);


            return {

              Date:
                Number.isNaN(date.getTime())
                  ? ""
                  : date,

              "Weight (kg)":
                entry.weight ?? ""

            };

          });


        // ------------------------------------------------------------
        // BODY MEASUREMENTS
        // ------------------------------------------------------------

        const measurementRows =
          measurements.map(entry => {

            const date =
              entry.date?.toDate
                ? entry.date.toDate()
                : new Date(entry.date);


            return {

              Date:
                Number.isNaN(date.getTime())
                  ? ""
                  : date,

              Shoulder:
                (entry.shoulders ?? entry.shoulder) ?? "",

              Chest:
                entry.chest ?? "",

              Waist:
                entry.waist ?? "",

              "Left Arm":
                (entry.leftArm ?? entry.arms) ?? "",

              "Right Arm":
                (entry.rightArm ?? entry.arms) ?? "",

              Thigh:
                (entry.thighs ?? entry.thigh) ?? "",

              Calves:
                entry.calves ?? "",

              Forearms:
                entry.forearms ?? ""

            };

          });


        // ------------------------------------------------------------
        // GOALS
        // ------------------------------------------------------------

        const goalRows =
          goals.map(goal => ({

            "Goal ID":
              goal.id ?? "",

            "Goal Type":
              goal.type ||
              goal.goalType ||
              "",

            Calories:
              goal.calories ?? "",

            "Protein (g)":
              goal.protein ?? "",
            "Carbs (g)":
              goal.carbs ?? "",
            "Fat (g)":
              goal.fat ?? "",

            "Start Date":
              goal.startDate ?? "",

            "End Date":
              goal.endDate ?? ""

          }));


        // ------------------------------------------------------------
        // CREATE WORKBOOK
        // ------------------------------------------------------------

        const workbook =
          XLSX.utils.book_new();


        const workoutSheet =
          XLSX.utils.json_to_sheet(
            workoutRows
          );


        const plansSheet =
          XLSX.utils.json_to_sheet(
            planRows
          );


        const weightSheet =
          XLSX.utils.json_to_sheet(
            weightRows
          );


        const measurementSheet =
          XLSX.utils.json_to_sheet(
            measurementRows
          );


        const goalsSheet =
          XLSX.utils.json_to_sheet(
            goalRows
          );


        // ------------------------------------------------------------
        // COLUMN WIDTHS
        // ------------------------------------------------------------

        workoutSheet["!cols"] = [
          { wch: 22 },
          { wch: 22 },
          { wch: 28 },
          { wch: 8 },
          { wch: 14 },
          { wch: 10 },
          { wch: 14 },
          { wch: 35 }
        ];


        plansSheet["!cols"] = [
          { wch: 22 },
          { wch: 15 },
          { wch: 28 },
          { wch: 10 },
          { wch: 15 },
          { wch: 14 },
          { wch: 15 },
          { wch: 35 }
        ];


        weightSheet["!cols"] = [
          { wch: 22 },
          { wch: 15 }
        ];


        measurementSheet["!cols"] = [
          { wch: 22 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 }
        ];


        goalsSheet["!cols"] = [
          { wch: 24 },
          { wch: 18 },
          { wch: 14 },
          { wch: 16 },
          { wch: 18 },
          { wch: 18 }
        ];


        // ------------------------------------------------------------
        // ADD SHEETS
        // ------------------------------------------------------------

        XLSX.utils.book_append_sheet(
          workbook,
          workoutSheet,
          "Workout Logs"
        );


        XLSX.utils.book_append_sheet(
          workbook,
          plansSheet,
          "Workout Plans"
        );


        XLSX.utils.book_append_sheet(
          workbook,
          weightSheet,
          "Weight History"
        );


        XLSX.utils.book_append_sheet(
          workbook,
          measurementSheet,
          "Measurements"
        );


        XLSX.utils.book_append_sheet(
          workbook,
          goalsSheet,
          "Goals"
        );


        // ------------------------------------------------------------
        // DOWNLOAD
        // ------------------------------------------------------------

        const date =
          new Date()
            .toISOString()
            .slice(0, 10);


        XLSX.writeFile(
          workbook,
          `recomposition-export-${date}.xlsx`
        );


        excelButton.textContent =
          "Download Excel Workbook";

        excelButton.disabled = false;


        alert(
          "Excel workbook downloaded successfully."
        );


      } catch (error) {

        console.error(
          "Excel export failed:",
          error
        );

        excelButton.disabled = false;

        excelButton.textContent =
          "Download Excel Workbook";

        alert(
          "Could not create Excel workbook."
        );

      }

    }
  );


}

async function renderAccountSettings() {
  const container = document.getElementById(
    "account-settings-content"
  );

  if (!container) return;

  container.innerHTML = `
    <div class="settings-account-panel">

      <div class="settings-account-section">
        <div class="settings-account-label">
          ACCOUNT EMAIL
        </div>

        <div
          class="settings-account-value"
          id="account-email"
        >
          Loading...
        </div>
      </div>

      <div class="settings-account-section">
        <div class="settings-account-label">
          PASSWORD
        </div>

        <button
          type="button"
          class="settings-action-button"
          id="account-password-button"
        >
          Set / Change Password
        </button>
      </div>

      <div class="settings-account-section">
        <div class="settings-account-label">
          PASSWORD RESET
        </div>

        <button
          type="button"
          class="settings-action-button"
          id="account-reset-button"
        >
          Send Reset Email
        </button>
      </div>

      <div class="settings-account-section">
        <div class="settings-account-label">
          SESSION
        </div>

        <button
          type="button"
          class="settings-action-button"
          id="account-logout-button"
        >
          Log Out
        </button>
      </div>

    </div>
  `;



  const currentUser = auth.currentUser;

  const emailElement =
    document.getElementById("account-email");

  if (emailElement) {
    emailElement.textContent =
      currentUser?.email || "No email available";
  }

    const passwordButton =
    document.getElementById("account-password-button");

  if (passwordButton) {
    passwordButton.addEventListener("click", async () => {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        alert("You are not logged in.");
        return;
      }

      if (!currentUser.email) {
        alert("No email is associated with this account.");
        return;
      }

      const password = prompt(
        "Choose a password for your Recomposition account:"
      );

      if (!password) return;

      if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
      }

      const confirmPassword = prompt(
        "Confirm your new password:"
      );

      if (password !== confirmPassword) {
        alert("Passwords do not match.");
        return;
      }

      try {
        const hasPasswordProvider =
          currentUser.providerData.some(
            provider => provider.providerId === "password"
          );

        if (hasPasswordProvider) {
          await updatePassword(currentUser, password);
        } else {
          const credential =
            EmailAuthProvider.credential(
              currentUser.email,
              password
            );

          await linkWithCredential(
            currentUser,
            credential
          );
        }

        alert("Password saved successfully.");
      } catch (error) {
        console.error(error);
        alert(
          "Could not save password. Please try again."
        );
      }
    });
  }

    const resetButton =
    document.getElementById("account-reset-button");

  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      const currentUser = auth.currentUser;

      if (!currentUser?.email) {
        alert("No email is associated with this account.");
        return;
      }

      try {
        await sendPasswordResetEmail(
          auth,
          currentUser.email
        );

        alert(
          `Password reset email sent to ${currentUser.email}.`
        );
      } catch (error) {
        console.error(error);
        alert(
          "Could not send the password reset email. Please try again."
        );
      }
    });
  }

    const logoutButton =
    document.getElementById("account-logout-button");

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      const confirmed = confirm(
        "Are you sure you want to log out?"
      );

      if (!confirmed) return;

      try {
        await signOut(auth);
      } catch (error) {
        console.error(error);
        alert(
          "Could not log out. Please try again."
        );
      }
    });
  }
}

function showSettingsHub() {
  renderSettings();
}


function showSettingsSubPage(title, content) {

  const container =
    document.getElementById("settings-content");

  if (!container) {
    return;
  }


  container.innerHTML = `
    <div class="settings-subpage">

      <button
        type="button"
        class="settings-back-button"
        id="settings-back-button"
      >
        ← Back to Settings
      </button>


      <div class="section-header">

        <div>

          <div class="section-eyebrow">
            SETTINGS
          </div>

          <h2>
            ${title}
          </h2>

        </div>

      </div>


      <div class="settings-subpage-content">
        ${content}
      </div>

    </div>
  `;


  const backButton =
    document.getElementById(
      "settings-back-button"
    );


  if (backButton) {

    backButton.addEventListener(
      "click",
      () => {

        showSettingsHub();

      }
    );

  }

}

function initializeSettingsNavigation() {

  const profileCard =
    document.getElementById("settings-profile");

  const weightCard =
    document.getElementById("settings-weight");

  const measurementsCard =
    document.getElementById("settings-measurements");

  const exportCard =
    document.getElementById("settings-export");

  const accountCard =
    document.getElementById("settings-account");

  const goalsCard = 
    document.getElementById("settings-goals");

  if (profileCard) {
  profileCard.addEventListener("click", async () => {

    showSettingsSubPage(
  "Profile",
  `
    <div id="settings-profile-content"></div>
  `
);

    if (
      window.RecompositionProfile &&
      typeof window.RecompositionProfile.render === "function"
    ) {
      await window.RecompositionProfile.render();
    }

  });
}


  if (weightCard) {
  weightCard.addEventListener("click", async () => {

    showSettingsSubPage(
      "Weight History",
      `
        <div id="settings-weight-page"></div>
      `
    );

    await renderSettingsWeightHistory();

  });
}


  if (measurementsCard) {
  measurementsCard.addEventListener("click", async () => {

    showSettingsSubPage(
      "Body Measurements",
      `
        <div id="settings-measurements-page"></div>
      `
    );

    await renderSettingsMeasurements();

  });
}

if (goalsCard) {

  goalsCard.addEventListener(
    "click",
    async () => {

      showSettingsSubPage(
        "Goals",
        `
          <div id="settings-goals-content"></div>
        `
      );

      const container =
        document.getElementById(
          "settings-goals-content"
        );

      await loadGoals(container);

    }
  );

}


 if (exportCard) {
  exportCard.addEventListener("click", () => {

    const exportPanel =
      document.getElementById("settings-export-panel");

    if (!exportPanel) {
      return;
    }

    exportPanel.style.display = "block";

    exportCard.style.display = "none";

  });
}

if (accountCard) {
  accountCard.addEventListener("click", async () => {
    showSettingsSubPage(
      "Account Settings",
      `<div id="account-settings-content"></div>`
    );

    await renderAccountSettings();
  });
}

}

async function renderSettingsWeightHistory() {

  const content =
    document.getElementById("settings-weight-page");

  if (!content) {
    return;
  }

  // Stored weights are kilograms. The unit preference only changes what is
  // shown and what the typed number means (converted to kg before saving).
  const weightUnit =
    normalizeWeightUnit(
      (await getProfile().catch(() => null))?.unitPreference
    );

  const weightBounds =
    weightRange(weightUnit, 0, 500);


  content.innerHTML = `
    <div class="profile-section">

      <div class="profile-section-header">

        <div>

          <div class="section-kicker">
            WEIGHT HISTORY
          </div>

          <h2 class="profile-section-title">
            Track Your Weight
          </h2>

          <p class="profile-section-description">
            Record your body weight over time to track your progress.
          </p>

        </div>

      </div>


      <div class="weight-entry-form">

        <div class="form-group">

          <label
            class="form-label"
            for="settings-weight-value"
          >
                        WEIGHT (${weightUnitLabel(weightUnit).toUpperCase()})
          </label>
          <input
            type="number"
            id="settings-weight-value"
            class="form-input"
            placeholder="e.g. ${weightUnit === "lb" ? "157" : "71"}"
            min="0"
            max="${weightBounds.max}"
            step="0.1"
          >

        </div>


        <div class="form-group">

          <label
            class="form-label"
            for="settings-weight-date"
          >
            DATE
          </label>

          <input
            type="date"
            id="settings-weight-date"
            class="form-input"
          >

        </div>


        <button
          type="button"
          id="settings-add-weight"
          class="btn-primary"
        >
          ADD WEIGHT
        </button>

      </div>


      <div
        id="settings-weight-history-list"
        class="weight-history-list"
      >
        Loading weight history...
      </div>

    </div>
  `;


  const dateInput =
    document.getElementById("settings-weight-date");

  if (dateInput && !dateInput.value) {
    dateInput.value =
      new Date().toISOString().split("T")[0];
  }


  const list =
    document.getElementById(
      "settings-weight-history-list"
    );


  async function refreshWeightHistory() {

    const history =
      await getWeightHistory();

    if (!list) {
      return;
    }

    if (!history.length) {

      list.innerHTML = `
        <div class="empty-state">
          No weight entries yet.
        </div>
      `;

      return;
    }


    list.innerHTML =
      history.map(entry => {

        const weight =
          formatWeight(entry.weight, weightUnit);

        return `
          <div class="weight-history-item">

            <div class="weight-history-date">
              ${entry.date}
            </div>

            <div class="weight-history-value">
              ${weight}
            </div>

          </div>
        `;

      }).join("");
  }


  await refreshWeightHistory();


  const addButton =
    document.getElementById(
      "settings-add-weight"
    );


  if (addButton) {

    addButton.addEventListener(
      "click",
      async () => {

        const weightInput =
          document.getElementById(
            "settings-weight-value"
          );

        const dateInput =
          document.getElementById(
            "settings-weight-date"
          );


        // What the user typed is in their preferred unit; store kilograms.
        const weight =
          displayToKg(
            parseFloat(weightInput.value),
            weightUnit
          );

        const date =
          dateInput.value;


        if (!weight || weight <= 0) {

          alert(
            "Please enter a valid weight."
          );

          return;
        }


        if (!date) {

          alert(
            "Please select a date."
          );

          return;
        }


        addButton.disabled = true;

        addButton.textContent =
          "ADDING...";


        try {

          await addWeightEntry({
            weight,
            date
          });


          weightInput.value = "";


          await refreshWeightHistory();


        } catch (error) {

          console.error(
            "Failed to add weight:",
            error
          );

          alert(
            "Failed to save weight. Please try again."
          );

        } finally {

          addButton.disabled = false;

          addButton.textContent =
            "ADD WEIGHT";

        }

      }
    );

  }

}

const DAY_NAMES = [
  "", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday", "Sunday"
];

// Plans store dayOfWeek (1-7); older data may use `day`.
function planDayName(plan) {
  const n = Number(plan?.dayOfWeek);
  return DAY_NAMES[n] || plan?.day || "";
}

// Plans store repMin / repMax.
function planRepRange(exercise) {
  if (exercise?.repMin != null && exercise?.repMax != null) {
    return `${exercise.repMin}-${exercise.repMax}`;
  }
  return exercise?.repRange ?? "";
}


// Blank / invalid measurement input -> null (never NaN)
function readMeasurementInput(id) {
  const raw = document.getElementById(id)?.value;
  if (raw === undefined || String(raw).trim() === "") return null;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}


async function renderSettingsMeasurements() {

  const content =
    document.getElementById("settings-measurements-page");

  if (!content) {
    return;
  }

  content.innerHTML = `
    <div class="profile-section">

      <div class="profile-section-header">

        <div>

          <div class="section-kicker">
            BODY MEASUREMENTS
          </div>

          <h2 class="profile-section-title">
            Track Your Measurements
          </h2>

          <p class="profile-section-description">
            Record your body measurements over time to track your progress.
          </p>

        </div>

      </div>


      <div class="measurement-form">

        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-date"
          >
            DATE
          </label>

          <input
            type="date"
            id="settings-measurement-date"
            class="form-input"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-chest"
          >
            CHEST
          </label>

          <input
            type="number"
            id="settings-measurement-chest"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-waist"
          >
            WAIST
          </label>

          <input
            type="number"
            id="settings-measurement-waist"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-shoulders"
          >
            SHOULDERS
          </label>

          <input
            type="number"
            id="settings-measurement-shoulders"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-left-arm"
          >
            LEFT ARM
          </label>

          <input
            type="number"
            id="settings-measurement-left-arm"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-right-arm"
          >
            RIGHT ARM
          </label>

          <input
            type="number"
            id="settings-measurement-right-arm"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-thighs"
          >
            THIGHS
          </label>

          <input
            type="number"
            id="settings-measurement-thighs"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <div class="form-group">
          <label
            class="form-label"
            for="settings-measurement-calves"
          >
            CALVES
          </label>

          <input
            type="number"
            id="settings-measurement-calves"
            class="form-input"
            step="0.1"
            min="0"
          >
        </div>


        <button
          type="button"
          id="settings-add-measurement"
          class="btn-primary"
        >
          ADD MEASUREMENT
        </button>

      </div>


      <div
        id="settings-measurements-list"
        class="weight-history-list"
      >
        Loading measurements...
      </div>

    </div>
  `;


  const dateInput =
    document.getElementById(
      "settings-measurement-date"
    );

  if (dateInput && !dateInput.value) {
    dateInput.value =
      new Date().toISOString().split("T")[0];
  }


  const list =
    document.getElementById(
      "settings-measurements-list"
    );


  async function refreshMeasurements() {

    const measurements =
      await getMeasurements();

    if (!list) {
      return;
    }

    if (!measurements.length) {

      list.innerHTML = `
        <div class="empty-state">
          No measurements yet.
        </div>
      `;

      return;
    }


    list.innerHTML =
      measurements.map(entry => {

        return `
          <div class="weight-history-item">

            <div class="weight-history-date">
              ${entry.date}
            </div>

            <div class="weight-history-value">
              Chest: ${entry.chest ?? "—"} |
              Waist: ${entry.waist ?? "—"} |
              Shoulders: ${entry.shoulders ?? "—"} |
              Arms: ${entry.arms ?? `${entry.leftArm ?? "—"} / ${entry.rightArm ?? "—"}`} |
              Thighs: ${entry.thighs ?? "—"} |
              Calves: ${entry.calves ?? "—"}
            </div>

          </div>
        `;

      }).join("");
  }


  await refreshMeasurements();


  const addButton =
    document.getElementById(
      "settings-add-measurement"
    );


  if (addButton) {

    addButton.addEventListener(
      "click",
      async () => {

        const date =
          document.getElementById(
            "settings-measurement-date"
          ).value;

        const chest = readMeasurementInput("settings-measurement-chest");

        const waist = readMeasurementInput("settings-measurement-waist");

        const shoulders = readMeasurementInput("settings-measurement-shoulders");

        const leftArm = readMeasurementInput("settings-measurement-left-arm");

        const rightArm = readMeasurementInput("settings-measurement-right-arm");

        const thighs = readMeasurementInput("settings-measurement-thighs");

        const calves = readMeasurementInput("settings-measurement-calves");


        if (!date) {
          alert("Please select a date.");
          return;
        }


        addButton.disabled = true;

        addButton.textContent =
          "ADDING...";


        try {

          await addMeasurement({
            date,
            chest,
            waist,
            shoulders,
            leftArm,
            rightArm,
            thighs,
            calves
          });


          await refreshMeasurements();


        } catch (error) {

          console.error(
            "Failed to add measurement:",
            error
          );

          alert(
            "Failed to save measurement. Please try again."
          );

        } finally {

          addButton.disabled = false;

          addButton.textContent =
            "ADD MEASUREMENT";

        }

      }
    );

  }

}

window.RecompositionSettings = {
  renderSettings
};