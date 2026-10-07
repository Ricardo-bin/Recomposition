// ─────────────────────────────────────────────────────────────────────────────
// recompositionData.js
// Recomposition user-scoped Firestore data layer
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
    orderBy,
  limit,
  startAfter
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

import { db, auth } from "../firebase.js";

import { isCompletedLog } from "../workoutLogStatus.js";


// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

function getCurrentUser() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("No authenticated Recomposition user.");
  }

  return user;
}

function getUserId() {
  return getCurrentUser().uid;
}


// ─────────────────────────────────────────────────────────────────────────────
// User-scoped Firestore references
// ─────────────────────────────────────────────────────────────────────────────

function userDocument() {
  return doc(db, "users", getUserId());
}

function userCollection(collectionName) {
  return collection(
    db,
    "users",
    getUserId(),
    collectionName
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export async function getProfile() {
  const snapshot = await getDoc(userDocument());

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

export async function updateProfileData(data) {
  return updateDoc(userDocument(), {
    ...data,
    updatedAt: new Date()
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Workout Plans
// ─────────────────────────────────────────────────────────────────────────────

export async function createWorkoutPlan(plan) {
  const planRef = await addDoc(
    userCollection("workoutPlans"),
    {
      ...plan,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  );

  return planRef.id;
}

export async function getWorkoutPlans() {
  const snapshot = await getDocs(
    query(
      userCollection("workoutPlans"),
      orderBy("updatedAt", "desc")
    )
  );

  return snapshot.docs.map(document => ({
    id: document.id,
    ...document.data()
  }));
}

export async function getWorkoutPlan(planId) {
  const snapshot = await getDoc(
    doc(
      db,
      "users",
      getUserId(),
      "workoutPlans",
      planId
    )
  );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

export async function updateWorkoutPlan(planId, data) {
  return updateDoc(
    doc(
      db,
      "users",
      getUserId(),
      "workoutPlans",
      planId
    ),
    {
      ...data,
      updatedAt: new Date()
    }
  );
}

export async function deleteWorkoutPlan(planId) {
  return deleteDoc(
    doc(
      db,
      "users",
      getUserId(),
      "workoutPlans",
      planId
    )
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Workout Logs
// ─────────────────────────────────────────────────────────────────────────────

export async function createWorkoutLog(log) {
  const now = new Date();

  const logRef = await addDoc(userCollection("workoutLogs"), {
    ...log,

    // Every workout gets a date automatically if one was not supplied.
    date: log.date ?? now,

    // Used to distinguish unfinished/completed sessions later.
    status: log.status ?? "completed",

    createdAt: now,
    updatedAt: now
  });

  return logRef.id;
}

// Idempotent save used by the offline queue: the log document id is the
// workout's stable id, so retrying the same workout overwrites ONE document
// instead of creating another. `createdAt` comes from the queued payload so a
// retry never changes it.
export async function saveWorkoutLogOnce(uid, logId, log) {
  // The queued write is bound to the UID whose queue is syncing. It never
  // falls back to whoever is signed in now: if that is someone else, nothing
  // is written.
  if (!uid || auth.currentUser?.uid !== uid) {
    const error = new Error("The signed-in account changed; nothing was written.");
    error.code = "account-changed";
    throw error;
  }

  const now = new Date();

  await setDoc(
    doc(db, "users", uid, "workoutLogs", logId),
    {
      ...log,
      date: log.date ?? now,
      status: log.status ?? "completed",
      createdAt: log.createdAt ?? now,
      updatedAt: log.createdAt ?? now
    }
  );

  return logId;
}

// ---------------------------------------------------------------------------
// WORKOUT LOG QUERIES
//
// Firestore has no "unlimited" read, so logs are read in pages, newest first.
//
//   getWorkoutLogsPage()  one page + a cursor for the next (used by History)
//   getWorkoutLogs()      the most recent page only (fast; Dashboard, restore)
//   getAllWorkoutLogs()   every log, read page by page (Progress, exports)
// ---------------------------------------------------------------------------

export const WORKOUT_LOG_PAGE_SIZE = 100;

// Safety ceiling for getAllWorkoutLogs() so one runaway query can never
// read an unbounded number of documents.
const WORKOUT_LOG_MAX_TOTAL = 5000;

export async function getWorkoutLogsPage({
  pageSize = WORKOUT_LOG_PAGE_SIZE,
  after = null
} = {}) {
  const constraints = [
    orderBy("date", "desc")
  ];

  if (after) {
    constraints.push(startAfter(after));
  }

  constraints.push(limit(pageSize));

  const snapshot = await getDocs(
    query(
      userCollection("workoutLogs"),
      ...constraints
    )
  );

  const docs = snapshot.docs;

  return {
    logs: docs.map(document => ({
      id: document.id,
      ...document.data()
    })),

    // Pass this back as `after` to read the next (older) page.
    cursor: docs.length ? docs[docs.length - 1] : null,

    // A full page means there may be older logs.
    hasMore: docs.length === pageSize
  };
}

// Most recent page only. Behaviour unchanged: newest 100 logs.
export async function getWorkoutLogs() {
  const { logs } = await getWorkoutLogsPage();

  return logs;
}

// Every workout log (newest first), read page by page.
export async function getAllWorkoutLogs() {
  const all = [];
  let cursor = null;

  while (all.length < WORKOUT_LOG_MAX_TOTAL) {
    const page = await getWorkoutLogsPage({
      pageSize: 200,
      after: cursor
    });

    all.push(...page.logs);

    if (!page.hasMore || !page.cursor) {
      break;
    }

    cursor = page.cursor;
  }

  return all;
}

export async function getWorkoutLog(logId) {
  const snapshot = await getDoc(
    doc(db, "users", getUserId(), "workoutLogs", logId)
  );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

export async function getPreviousWorkoutLog(
  planId,
  exerciseId,
  beforeDate = null
) {
  const firstPage = await getWorkoutLogsPage();

  let previousLogs = findPreviousLogs(
    firstPage.logs,
    planId,
    exerciseId,
    beforeDate
  );

  // Nothing in the most recent page, but older logs exist:
  // this plan/exercise may simply not have been trained recently.
  if (previousLogs.length === 0 && firstPage.hasMore) {
    previousLogs = findPreviousLogs(
      await getAllWorkoutLogs(),
      planId,
      exerciseId,
      beforeDate
    );
  }

  if (previousLogs.length === 0) {
    return null;
  }

  // Logs are newest-first, so the first match is the previous session.
  return previousLogs[0];
}


export function findPreviousLogs(
  logs,
  planId,
  exerciseId,
  beforeDate
) {
  return logs.filter(log => {
    // Must belong to the same workout plan.
    if (log.planId !== planId) {
      return false;
    }

    if (!isCompletedLog(log)) {
      return false;
    }

    // If we're looking before a particular session,
    // don't include that session or anything newer.
    if (beforeDate && log.date) {
      const logDate = new Date(log.date.toDate
        ? log.date.toDate()
        : log.date);

      const comparisonDate = new Date(
        beforeDate.toDate
          ? beforeDate.toDate()
          : beforeDate
      );

      if (logDate >= comparisonDate) {
        return false;
      }
    }

    // The workout must contain this exercise.
    return Array.isArray(log.exercises) &&
      log.exercises.some(
        exercise => exercise.exerciseId === exerciseId
      );
    });
}

export async function updateWorkoutLog(logId, data) {
  return updateDoc(
    doc(db, "users", getUserId(), "workoutLogs", logId),
    {
      ...data,
      updatedAt: new Date()
    }
  );
}

export async function deleteWorkoutLog(logId) {
  return deleteDoc(
    doc(db, "users", getUserId(), "workoutLogs", logId)
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Weight History
// ─────────────────────────────────────────────────────────────────────────────

export async function addWeightEntry(entry) {
  const weightRef = await addDoc(
    userCollection("weightHistory"),
    {
      ...entry,
      createdAt: new Date()
    }
  );

  return weightRef.id;
}

export async function getWeightHistory() {
  const snapshot = await getDocs(
    query(
      userCollection("weightHistory"),
      orderBy("date", "desc"),
      limit(365)
    )
  );

  return snapshot.docs.map(document => ({
    id: document.id,
    ...document.data()
  }));
}


// ─────────────────────────────────────────────────────────────────────────────
// Measurements
// ─────────────────────────────────────────────────────────────────────────────

export async function addMeasurement(entry) {
  const measurementRef = await addDoc(
    userCollection("measurements"),
    {
      ...entry,
      createdAt: new Date()
    }
  );

  return measurementRef.id;
}

export async function getMeasurements() {
  const snapshot = await getDocs(
    query(
      userCollection("measurements"),
      orderBy("date", "desc"),
      limit(100)
    )
  );

  return snapshot.docs.map(document => ({
    id: document.id,
    ...document.data()
  }));
}


// ─────────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────────

export async function saveGoal(goalId, goal) {
  return setDoc(
    doc(
      db,
      "users",
      getUserId(),
      "goals",
      goalId
    ),
    {
      ...goal,
      updatedAt: new Date()
    },
    {
      merge: true
    }
  );
}

export async function getGoals() {
  const snapshot = await getDocs(
    userCollection("goals")
  );

  return snapshot.docs.map(document => ({
    id: document.id,
    ...document.data()
  }));
}

export async function deleteGoal(goalId) {
  return deleteDoc(
    doc(
      db,
      "users",
      getUserId(),
      "goals",
      goalId
    )
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Delete All User Data
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteAllUserData() {
  const userId = getUserId();

  const collectionsToDelete = [
    "workoutPlans",
    "workoutLogs",
    "weightHistory",
    "measurements",
    "goals"
  ];

  for (const collectionName of collectionsToDelete) {
    const snapshot = await getDocs(
      userCollection(collectionName)
    );

    for (const documentSnapshot of snapshot.docs) {
      await deleteDoc(documentSnapshot.ref);
    }
  }

  // Delete the main profile document last.
  await deleteDoc(
    doc(db, "users", userId)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug
// ─────────────────────────────────────────────────────────────────────────────

export function getAuthenticatedUserId() {
  return getUserId();
}
