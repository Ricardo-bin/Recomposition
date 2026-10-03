
// ============================================================================
// RECOMPOSITION — Profile
// ============================================================================

import {
  getProfile,
  updateProfileData
} from "./data/recompositionData.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";


import {
  auth
} from "./firebase.js";

import {
  normalizeWeightUnit,
  weightInputValue,
  displayToKg,
  convertInputText,
  weightRange
} from "./units.js";

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


// ============================================================================
// PROFILE RENDER
// ============================================================================

async function renderProfile() {

  const container =
document.getElementById("settings-profile-content");
  if (!container) {
    return;
  }


  container.innerHTML = `
    <div class="section-heading">

      <div class="section-kicker">
        ATHLETE PROFILE
      </div>

      <h1 class="section-title">
        Your Profile
      </h1>

      <p class="section-description">
        Keep your personal, body and training information up to date.
      </p>

    </div>

    <div class="loading-row">
      Loading profile...
    </div>
  `;


  try {

    const profile = await getProfile();

    // Stored weights are kilograms. The preference only changes how the weight
    // is shown / typed (see units.js).
    const weightUnit = normalizeWeightUnit(profile.unitPreference);
    const weightBounds = weightRange(weightUnit);

const currentUser = auth.currentUser;

    if (!profile) {
      throw new Error("Recomposition profile was not found.");
    }


    // ========================================================================
    // PROFILE FORM
    // ========================================================================

    container.innerHTML = `

      <div class="profile-form">

        <!-- ================================================================
             PERSONAL
        ================================================================= -->

        <div class="panel">

          <div class="panel-header">

            <div>

              <div class="panel-title">
                PERSONAL INFORMATION
              </div>

              <div class="panel-subtitle">
                Basic information about you.
              </div>

            </div>

          </div>


          <div class="form-grid">

            <!-- NAME -->

            <div class="form-group full">

              <label
                class="form-label"
                for="profile-name"
              >
                NAME
              </label>

              <input
                type="text"
                id="profile-name"
                class="form-input"
                placeholder="Your name"
                value="${escapeHTML(profile.name || "")}"
                autocomplete="name"
              >

            </div>


            <!-- AGE -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-age"
              >
                AGE
              </label>

              <input
                type="number"
                id="profile-age"
                class="form-input"
                placeholder="e.g. 22"
                min="13"
                max="120"
                step="1"
                value="${
                  profile.age !== null &&
                  profile.age !== undefined
                    ? escapeHTML(profile.age)
                    : ""
                }"
                inputmode="numeric"
              >

            </div>


            <!-- SEX -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-sex"
              >
                SEX
              </label>

              <select
                id="profile-sex"
                class="form-select"
              >

                <option value="">
                  Select
                </option>

                <option
                  value="Male"
                  ${profile.sex === "Male" ? "selected" : ""}
                >
                  Male
                </option>

                <option
                  value="Female"
                  ${profile.sex === "Female" ? "selected" : ""}
                >
                  Female
                </option>

                <option
                  value="Other"
                  ${profile.sex === "Other" ? "selected" : ""}
                >
                  Other
                </option>

                <option
                  value="Prefer not to say"
                  ${
                    profile.sex === "Prefer not to say"
                      ? "selected"
                      : ""
                  }
                >
                  Prefer not to say
                </option>

              </select>

            </div>


            <!-- UNIT -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-unit"
              >
                WEIGHT UNIT
              </label>

              <select
                id="profile-unit"
                class="form-select"
              >

                <option
                  value="kg"
                  ${
                    !profile.unitPreference ||
                    profile.unitPreference === "kg"
                      ? "selected"
                      : ""
                  }
                >
                  Kilograms (kg)
                </option>

                <option
                  value="lb"
                  ${
                    profile.unitPreference === "lb"
                      ? "selected"
                      : ""
                  }
                >
                  Pounds (lb)
                </option>

              </select>

            </div>

          </div>

        </div>


        <!-- ================================================================
             BODY
        ================================================================= -->

        <div class="panel">

          <div class="panel-header">

            <div>

              <div class="panel-title">
                BODY INFORMATION
              </div>

              <div class="panel-subtitle">
                Used for your progress and future nutrition calculations.
              </div>

            </div>

          </div>


          <div class="form-grid">

            <!-- HEIGHT -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-height"
              >
                HEIGHT (CM)
              </label>

              <input
                type="number"
                id="profile-height"
                class="form-input"
                placeholder="e.g. 173"
                min="50"
                max="250"
                step="0.1"
                value="${
                  profile.height !== null &&
                  profile.height !== undefined
                    ? escapeHTML(profile.height)
                    : ""
                }"
                inputmode="decimal"
              >

            </div>


            <!-- CURRENT WEIGHT -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-weight"
              >
                CURRENT WEIGHT (${weightUnit.toUpperCase()})
              </label>
              <input
                type="number"
                id="profile-weight"
                class="form-input"
                placeholder="e.g. ${weightUnit === "lb" ? "154" : "70"}"
                min="${weightBounds.min}"
                max="${weightBounds.max}"
                step="0.1"
                value="${escapeHTML(weightInputValue(profile.currentWeight, weightUnit))}"
                inputmode="decimal"
              >

            </div>

          </div>

        </div>


        <!-- ================================================================
             TRAINING
        ================================================================= -->

        <div class="panel">

          <div class="panel-header">

            <div>

              <div class="panel-title">
                TRAINING INFORMATION
              </div>

              <div class="panel-subtitle">
                Help Recomposition understand your training background.
              </div>

            </div>

          </div>


          <div class="form-grid">

            <!-- GYM START -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-gym-start"
              >
                GYM START DATE
              </label>

              <input
                type="date"
                id="profile-gym-start"
                class="form-input"
                value="${escapeHTML(profile.gymStartDate || "")}"
              >

            </div>


            <!-- ACTIVITY LEVEL -->

            <div class="form-group">

              <label
                class="form-label"
                for="profile-activity"
              >
                ACTIVITY LEVEL
              </label>

              <select
                id="profile-activity"
                class="form-select"
              >

                <option value="">
                  Select
                </option>

                <option
                  value="Sedentary"
                  ${
                    profile.activityLevel === "Sedentary"
                      ? "selected"
                      : ""
                  }
                >
                  Sedentary
                </option>

                <option
                  value="Lightly active"
                  ${
                    profile.activityLevel === "Lightly active"
                      ? "selected"
                      : ""
                  }
                >
                  Lightly active
                </option>

                <option
                  value="Moderately active"
                  ${
                    profile.activityLevel === "Moderately active"
                      ? "selected"
                      : ""
                  }
                >
                  Moderately active
                </option>

                <option
                  value="Very active"
                  ${
                    profile.activityLevel === "Very active"
                      ? "selected"
                      : ""
                  }
                >
                  Very active
                </option>

                <option
                  value="Extremely active"
                  ${
                    profile.activityLevel === "Extremely active"
                      ? "selected"
                      : ""
                  }
                >
                  Extremely active
                </option>

              </select>

            </div>


            <!-- EXPERIENCE -->

            <div class="form-group full">

              <label
                class="form-label"
                for="profile-experience"
              >
                TRAINING EXPERIENCE
              </label>

              <select
                id="profile-experience"
                class="form-select"
              >

                <option value="">
                  Select
                </option>

                <option
                  value="Beginner"
                  ${
                    profile.trainingExperience === "Beginner"
                      ? "selected"
                      : ""
                  }
                >
                  Beginner
                </option>

                <option
                  value="Intermediate"
                  ${
                    profile.trainingExperience === "Intermediate"
                      ? "selected"
                      : ""
                  }
                >
                  Intermediate
                </option>

                <option
                  value="Advanced"
                  ${
                    profile.trainingExperience === "Advanced"
                      ? "selected"
                      : ""
                  }
                >
                  Advanced
                </option>

              </select>

            </div>

          </div>

        </div>

        <!-- ================================================================
             SAVE
        ================================================================= -->

        <div class="profile-save-row">

          <div
            id="profile-save-message"
            class="profile-save-message"
          ></div>

          <button
            type="button"
            id="btn-save-profile"
            class="btn btn-primary"
          >
            SAVE PROFILE
          </button>

        </div>


      </div>

    `;


    // ========================================================================
    // SAVE PROFILE
    // ========================================================================

    // When the unit selector changes, convert the number already typed so the
    // box always agrees with the selected unit; stored data is untouched.
    let activeWeightUnit = weightUnit;

    document
      .getElementById("profile-unit")
      ?.addEventListener("change", event => {
        const nextUnit = normalizeWeightUnit(event.target.value);
        const weightInput = document.getElementById("profile-weight");
        const weightLabel = document.querySelector('label[for="profile-weight"]');
        const bounds = weightRange(nextUnit);

        if (weightInput) {
          weightInput.value = convertInputText(
            weightInput.value,
            activeWeightUnit,
            nextUnit
          );
          weightInput.min = String(bounds.min);
          weightInput.max = String(bounds.max);
          weightInput.placeholder = `e.g. ${nextUnit === "lb" ? "154" : "70"}`;
        }

        if (weightLabel) {
          weightLabel.textContent = `CURRENT WEIGHT (${nextUnit.toUpperCase()})`;
        }

        activeWeightUnit = nextUnit;
      });

    const saveButton =
      document.getElementById("btn-save-profile");

    const saveMessage =
      document.getElementById("profile-save-message");


    saveButton.addEventListener(
      "click",
      async () => {

        saveButton.disabled = true;
        saveButton.textContent = "SAVING...";

        saveMessage.textContent = "";
        saveMessage.className = "profile-save-message";


        try {

          const name =
            document
              .getElementById("profile-name")
              .value
              .trim();


          const ageValue =
            document
              .getElementById("profile-age")
              .value;


          const heightValue =
            document
              .getElementById("profile-height")
              .value;


          const weightValue =
            document
              .getElementById("profile-weight")
              .value;


          const sex =
            document
              .getElementById("profile-sex")
              .value;


          const unitPreference =
            document
              .getElementById("profile-unit")
              .value;


          const gymStartDate =
            document
              .getElementById("profile-gym-start")
              .value;


          const activityLevel =
            document
              .getElementById("profile-activity")
              .value;


          const trainingExperience =
            document
              .getElementById("profile-experience")
              .value;


          // ================================================================
          // BASIC VALIDATION
          // ================================================================

          if (!name) {

            throw new Error(
              "Please enter your name."
            );

          }


          const age =
            ageValue === ""
              ? null
              : Number(ageValue);


          const height =
            heightValue === ""
              ? null
              : Number(heightValue);


          // The box is in the selected unit; storage is always kilograms.
          const currentWeight =
            weightValue === ""
              ? null
              : displayToKg(
                  weightValue,
                  unitPreference
                );


          if (
            age !== null &&
            (!Number.isFinite(age) ||
             age < 13 ||
             age > 120)
          ) {

            throw new Error(
              "Please enter a valid age."
            );

          }


          if (
            height !== null &&
            (!Number.isFinite(height) ||
             height < 50 ||
             height > 250)
          ) {

            throw new Error(
              "Please enter a valid height."
            );

          }


          if (
            currentWeight !== null &&
            (!Number.isFinite(currentWeight) ||
             currentWeight < 20 ||
             currentWeight > 400)
          ) {

            throw new Error(
              "Please enter a valid body weight."
            );

          }


          // ================================================================
          // SAVE
          // ================================================================

          await updateProfileData({

            name,
            age,
            sex,
            height,
            currentWeight,
            gymStartDate,
            activityLevel,
            trainingExperience,
            unitPreference

          });


          saveMessage.textContent =
            "Profile saved successfully.";

          saveMessage.classList.add(
            "success"
          );


          saveButton.textContent =
            "SAVED";


          // ================================================================
          // REFRESH DASHBOARD
          // ================================================================

          if (
            window.RecompositionDashboard &&
            typeof window.RecompositionDashboard.render === "function"
          ) {

            await window.RecompositionDashboard.render();

          }


          setTimeout(() => {

            saveButton.disabled = false;
            saveButton.textContent = "SAVE PROFILE";

          }, 1200);


        } catch (error) {

          console.error(
            "Profile save failed:",
            error
          );


          saveMessage.textContent =
            error.message ||
            "Could not save your profile.";

          saveMessage.classList.add(
            "error"
          );


          saveButton.disabled = false;
          saveButton.textContent =
            "SAVE PROFILE";

        }

      }
    );

  } catch (error) {

    console.error(
      "Profile failed to load:",
      error
    );


    container.innerHTML = `

      <div class="section-heading">

        <div class="section-kicker">
          SYSTEM ERROR
        </div>

        <h1 class="section-title">
          Profile unavailable
        </h1>

        <p class="section-description">
          Recomposition could not load your profile.
        </p>

      </div>


      <div class="empty-state">

        <div class="empty-state-title">
          Something went wrong
        </div>

        <div class="empty-state-text">
          Check the browser console for the technical
          error details.
        </div>

      </div>

    `;

  }

}


// ============================================================================
// GLOBAL ACCESS
// ============================================================================

window.RecompositionProfile = {
  render: renderProfile
};