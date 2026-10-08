// ─────────────────────────────────────────────────────────────────────────────
// auth.js — Recomposition Authentication
// ─────────────────────────────────────────────────────────────────────────────

import {
  isAcceptableNewPassword,
  PASSWORD_TOO_SHORT_MESSAGE,
  LOGIN_FAILED_MESSAGE
} from "./authPolicy.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import { auth, db } from "./firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";


// ─────────────────────────────────────────────────────────────────────────────
// User Profile
// ─────────────────────────────────────────────────────────────────────────────

// createUserWithEmailAndPassword signs the user in immediately, which fires
// onAuthStateChanged (and ensureUserProfile) BEFORE updateProfile() has set the
// Firebase displayName. The name typed in the registration form is held here
// so the first profile document is created with it.
let pendingRegistrationName = "";

function notifyProfileReady() {
  window.dispatchEvent(new CustomEvent("recomposition-profile-ready"));
}

async function ensureUserProfile(user) {
  // Read synchronously, before any await, so a later reset cannot affect it.
  const registrationName = pendingRegistrationName;

  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      name: user.displayName || registrationName || "",

      sex: "",
      age: null,
      height: null,
      currentWeight: null,

      gymStartDate: "",
      activityLevel: "",
      trainingExperience: "",
      unitPreference: "kg",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  }
}


// Only fills a BLANK name. Never overwrites a name the user already has.
async function applyRegistrationName(user, name) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  if (snapshot.exists() && !snapshot.data().name) {
    await updateDoc(userRef, {
      name,
      updatedAt: serverTimestamp()
    });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// DOM elements
// ─────────────────────────────────────────────────────────────────────────────

const authScreen = document.getElementById("auth-screen");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");

const registerName = document.getElementById("register-name");
const registerEmail = document.getElementById("register-email");
const registerPassword = document.getElementById("register-password");
const registerPasswordConfirm = document.getElementById(
  "register-password-confirm"
);

const authMessage = document.getElementById("auth-message");

const btnLogin = document.getElementById("btn-login");
const btnGoogleLogin = document.getElementById("btn-google-login");
const btnForgotPassword = document.getElementById("btn-forgot-password");

const btnShowRegister = document.getElementById("btn-show-register");
const btnShowLogin = document.getElementById("btn-show-login");

const btnRegister = document.getElementById("btn-register");


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function showMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.style.color = isError ? "#ff6b6b" : "#f5c542";
}

function clearMessage() {
  authMessage.textContent = "";
}

function showLoginForm() {
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");

  clearMessage();
}

function showRegisterForm() {
  loginForm.classList.add("hidden");
  registerForm.classList.remove("hidden");

  clearMessage();
}

function setButtonLoading(button, loading, loadingText, normalText) {
  button.disabled = loading;
  button.textContent = loading ? loadingText : normalText;
}


// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

btnLogin.addEventListener("click", async () => {
  clearMessage();

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showMessage("Please enter your email and password.", true);
    return;
  }

  try {
    setButtonLoading(
      btnLogin,
      true,
      "SIGNING IN...",
      "SIGN IN"
    );

    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    showMessage("Signed in successfully.");
  } catch (error) {
    console.error("Login error:", error);

    switch (error.code) {
      // Same wording for every "credentials do not match" case.
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        showMessage(LOGIN_FAILED_MESSAGE, true);
        break;

      case "auth/invalid-email":
        showMessage("Please enter a valid email address.", true);
        break;

      case "auth/too-many-requests":
        showMessage(
          "Too many attempts. Please wait a little and try again.",
          true
        );
        break;

      default:
        showMessage(
          "Unable to sign in. Please try again.",
          true
        );
    }
  } finally {
    setButtonLoading(
      btnLogin,
      false,
      "SIGNING IN...",
      "SIGN IN"
    );
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// Google Sign-In
// ─────────────────────────────────────────────────────────────────────────────

btnGoogleLogin.addEventListener("click", async () => {
  clearMessage();

  const provider = new GoogleAuthProvider();

  try {
    setButtonLoading(
      btnGoogleLogin,
      true,
      "CONNECTING...",
      "CONTINUE WITH GOOGLE"
    );

    await signInWithPopup(auth, provider);

    showMessage("Signed in successfully.");
  } catch (error) {
    console.error("Google sign-in error:", error);

    if (error.code === "auth/popup-closed-by-user") {
      showMessage("Google sign-in was cancelled.", true);
    } else if (error.code === "auth/popup-blocked") {
      showMessage(
        "Your browser blocked the Google sign-in popup.",
        true
      );
    } else {
      showMessage(
        "Unable to sign in with Google.",
        true
      );
    }
  } finally {
    setButtonLoading(
      btnGoogleLogin,
      false,
      "CONNECTING...",
      "CONTINUE WITH GOOGLE"
    );
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password
// ─────────────────────────────────────────────────────────────────────────────

btnForgotPassword.addEventListener("click", async () => {
  clearMessage();

  const email = loginEmail.value.trim();

  if (!email) {
    showMessage(
      "Enter your email address first.",
      true
    );
    loginEmail.focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);

    showMessage(
      "Password reset email sent. Check your inbox."
    );
  } catch (error) {
    console.error("Password reset error:", error);

    if (error.code === "auth/invalid-email") {
      showMessage(
        "Please enter a valid email address.",
        true
      );
    } else {
      showMessage(
        "Unable to send the reset email.",
        true
      );
    }
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

btnRegister.addEventListener("click", async () => {
  clearMessage();

  const name = registerName.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;
  const passwordConfirm = registerPasswordConfirm.value;

  if (!name) {
    showMessage("Please enter your name.", true);
    return;
  }

  if (!email) {
    showMessage("Please enter your email.", true);
    return;
  }

  if (!isAcceptableNewPassword(password)) {
    showMessage(
      PASSWORD_TOO_SHORT_MESSAGE,
      true
    );
    return;
  }

  if (password !== passwordConfirm) {
    showMessage(
      "Passwords do not match.",
      true
    );
    return;
  }

  try {
    setButtonLoading(
      btnRegister,
      true,
      "CREATING...",
      "CREATE ACCOUNT"
    );

    pendingRegistrationName = name;

    const userCredential =
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

    const user = userCredential.user;

    // Store the user's name in Firebase Authentication.
    await updateProfile(user, {
      displayName: name
    });

    // If the profile document was created before displayName existed,
    // fill in the blank name now (no new document is created here).
    try {
      await applyRegistrationName(user, name);
      notifyProfileReady();
    } catch (nameError) {
      console.error("Could not save registration name:", nameError);
    }


    showMessage(
      "Account created successfully."
    );
  } catch (error) {
    console.error("Registration error:", error);

    switch (error.code) {
      case "auth/email-already-in-use":
        showMessage(
          "An account already exists with this email.",
          true
        );
        break;

      case "auth/invalid-email":
        showMessage(
          "Please enter a valid email address.",
          true
        );
        break;

      case "auth/weak-password":
        showMessage(
          "Please choose a stronger password.",
          true
        );
        break;

      default:
        showMessage(
          "Unable to create the account.",
          true
        );
    }
  } finally {
    pendingRegistrationName = "";

    setButtonLoading(
      btnRegister,
      false,
      "CREATING...",
      "CREATE ACCOUNT"
    );
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// Switch Login / Register
// ─────────────────────────────────────────────────────────────────────────────

btnShowRegister.addEventListener("click", () => {
  showRegisterForm();
});

btnShowLogin.addEventListener("click", () => {
  showLoginForm();
});


// ─────────────────────────────────────────────────────────────────────────────
// Authentication state
// ─────────────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (user) {

    try {
      await ensureUserProfile(user);
      notifyProfileReady();

      authScreen.classList.add("hidden");

      // Recomposition modules are loaded directly by index.html.
      // Do not load the legacy GymTracker app.js here.
    } catch (error) {
      console.error(
        "Failed to initialize user profile:",
        error
      );

      showMessage(
        "Unable to load your profile. Please try again.",
        true
      );
    }
  } else {
    authScreen.classList.remove("hidden");
    showLoginForm();
  }
});