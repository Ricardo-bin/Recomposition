// ============================================================================
// TEST HELPER — runs the REAL data/recompositionData.js against a fake Firestore.
// Firestore references are plain path strings; every write is recorded in `calls`.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isCompletedLog } from "../../workoutLogStatus.js";
import { findPreviousSessions } from "../../previousSession.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function loadDataLayer({ currentUid, docs = [] }) {
  const calls = { set: [], update: [], delete: [], reads: [] };

  const source = readFileSync(resolve(root, "data/recompositionData.js"), "utf8")
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
    .replace(/\bexport\s+(async\s+)?function/g, "$1function")
    .replace(/\bexport\s+const/g, "const");

  const stubs = {
    collection: (_db, ...path) => path.join("/"),
    doc: (_db, ...path) => path.join("/"),
    query: (ref, ...constraints) => ({ ref, constraints }),
    orderBy: () => ({}),
    limit: () => ({}),
    startAfter: () => ({}),
    getDoc: async () => ({ exists: () => false }),
    getDocs: async query => {
      calls.reads.push(query.ref ?? query);

      return {
        docs: docs.map(item => ({ id: item.id, data: () => structuredClone(item.data) }))
      };
    },
    addDoc: async () => ({ id: "auto" }),
    updateDoc: async (path, data) => { calls.update.push({ path, data }); },
    deleteDoc: async path => { calls.delete.push({ path }); },
    setDoc: async (path, data) => { calls.set.push({ path, data }); },
    db: {},
    auth: { currentUser: currentUid ? { uid: currentUid } : null },
    isCompletedLog,
    findPreviousSessions
  };

  const api = new Function(
    ...Object.keys(stubs),
    `${source}
     return {
       saveWorkoutLogOnce, getPreviousWorkoutLog, findPreviousLogs,
       getWorkoutLogsPage, updateWorkoutLog, deleteWorkoutLog
     };`
  )(...Object.values(stubs));

  return { ...api, calls, stubs };
}
