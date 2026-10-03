// ─────────────────────────────────────────────────────────────────────────────
// firebase.js — Recomposition Firebase
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────────────────────
// Firebase project configuration
// ─────────────────────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyAOPawU8sYofHpONlN8Z2utehCfQiHAMcg",
  authDomain: "recomposition-1.firebaseapp.com",
  projectId: "recomposition-1",
  storageBucket: "recomposition-1.firebasestorage.app",
  messagingSenderId: "843294162636",
  appId: "1:843294162636:web:bf915a1fa9f2471d238c69"
};

// ─────────────────────────────────────────────────────────────────────────────
// Initialize Firebase
// ─────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);

// Firebase Authentication
export const auth = getAuth(app);

// Cloud Firestore
export const db = getFirestore(app);