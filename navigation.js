import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { auth } from "./firebase.js";

// ============================================================================
// RECOMPOSITION — Navigation Controller
// ============================================================================

const sections = [
  "dashboard",
  "workout",
  "history",
  "progress",
  "settings"
];

function showSection(sectionName) {

  if (!sections.includes(sectionName)) {
    console.warn(`Unknown Recomposition section: ${sectionName}`);
    return;
  }


  // Hide every application section
  sections.forEach(section => {

    const sectionElement =
      document.getElementById(`section-${section}`);

    if (sectionElement) {
      sectionElement.classList.toggle(
        "active",
        section === sectionName
      );
    }

  });


  // Update navigation buttons
  sections.forEach(section => {

    const navButton =
      document.getElementById(`nav-${section}`);

    if (navButton) {
      navButton.classList.toggle(
        "active",
        section === sectionName
      );
    }

  });


  // Remember the current section
  try {
    sessionStorage.setItem(
      "recomposition-current-section",
      sectionName
    );
  } catch (error) {
    console.warn(
      "Could not save navigation state:",
      error
    );
  }
loadSectionData(sectionName);






}




// ============================================================================
// SECTION DATA LOADING
// ============================================================================

function loadSectionData(sectionName) {

  // Navigation can initialize before Firebase restores the authenticated
  // session. Do not query user-scoped Firestore until auth is ready.
  if (!auth.currentUser) {
    return;
  }

  if (sectionName === "history") {

    if (
      window.RecompositionHistory &&
      typeof window.RecompositionHistory.loadHistory === "function"
    ) {
      window.RecompositionHistory.loadHistory();
    }

  }

if (sectionName === "settings") {

  if (
    window.RecompositionSettings &&
    typeof window.RecompositionSettings.renderSettings === "function"
  ) {

    window.RecompositionSettings.renderSettings();

  }

}

  if (sectionName === "progress") {

    if (
      window.RecompositionProgress &&
      typeof window.RecompositionProgress.loadProgress === "function"
    ) {
      window.RecompositionProgress.loadProgress();
    }

  }
}


// ============================================================================
// NAVIGATION BUTTON EVENTS
// ============================================================================

function initializeNavigation() {

  sections.forEach(section => {

    const navButton =
      document.getElementById(`nav-${section}`);

    if (!navButton) {
      return;
    }

    navButton.addEventListener("click", () => {

      showSection(section);

    });

  });

  // Start on Dashboard
  let initialSection = "dashboard";

  try {

    const savedSection =
      sessionStorage.getItem(
        "recomposition-current-section"
      );

    if (sections.includes(savedSection)) {
      initialSection = savedSection;
    }

  } catch (error) {

    console.warn(
      "Could not read navigation state:",
      error
    );

  }


  showSection(initialSection);

}


// ============================================================================
// START NAVIGATION
// ============================================================================

if (document.readyState === "loading") {

  document.addEventListener(
    "DOMContentLoaded",
    initializeNavigation
  );

} else {

  initializeNavigation();

}


// ============================================================================
// AUTHENTICATION READY
// ============================================================================

// If the user refreshes while History or Progress was the last open section,
// the section is selected before Firebase restores auth. Reload it once the
// authenticated session becomes available.
onAuthStateChanged(auth, user => {

  if (!user) {
    // Signed out (or no session yet): every module drops the previous user's
    // in-memory data and screen so nothing can show to the next account.
    window.dispatchEvent(new CustomEvent("recomposition-signed-out"));
    return;
  }

  let currentSection = "dashboard";

  try {
    currentSection =
      sessionStorage.getItem("recomposition-current-section") ||
      "dashboard";
  } catch (error) {
    console.warn("Could not read current navigation section:", error);
  }

  if (sections.includes(currentSection)) {
    loadSectionData(currentSection);
  }
});


// ============================================================================
// OPTIONAL GLOBAL ACCESS
// ============================================================================

window.RecompositionNavigation = {
  showSection
};