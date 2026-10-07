// ============================================================================
// PHASE 2 HARDENING — focused tests
//
//   pending queue · sync timeout · account-switch protection ·
//   exercise identity change · old logs stay unchanged · completed-log rule
//
// Pure Node, no browser. The real data-layer source is evaluated against a
// fake Firestore (a Map), so saveWorkoutLogOnce / findPreviousLogs are the
// REAL code, not copies.
//
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  enqueuePending,
  readPending,
  removePending,
  isPending,
  syncPending,
  withTimeout,
  pendingKey,
  SYNC_WRITE_TIMEOUT_MS
} from "../pendingWorkouts.js";
import { applyLibrarySelection, applyNameEdit } from "../exercisePicker.js";
import { isCompletedLog } from "../workoutLogStatus.js";
import { loadDataLayer } from "./helpers/dataLayer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- in-memory localStorage ---------------------------------------------------

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));

  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    _map: map
  };
}

const LOG = (extra = {}) => ({
  planId: "plan-1",
  date: "2026-10-06T10:00:00.000Z",
  status: "completed",
  exercises: [{ exerciseId: "slot-1", name: "Leg Press", sets: [{ weight: "100", reps: "10" }] }],
  ...extra
});

const never = () => new Promise(() => {});          // a write that hangs forever
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));


// ============================================================================
// PENDING QUEUE
// ============================================================================

test("queue: enqueue stores one entry per workout id; same id again replaces it", () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);
  enqueuePending("uA", "w1", LOG({ planId: "plan-2" }), storage);
  enqueuePending("uA", "w2", LOG(), storage);

  const list = readPending("uA", storage);

  assert.deepEqual(list.map(item => item.id).sort(), ["w1", "w2"]);
  assert.equal(list.find(item => item.id === "w1").log.planId, "plan-2", "latest payload wins, still ONE entry");
  assert.ok(isPending("uA", "w1", storage));
});

test("queue: removing the last entry removes the storage key", () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);
  removePending("uA", "w1", storage);

  assert.equal(storage.getItem(pendingKey("uA")), null);
  assert.deepEqual(readPending("uA", storage), []);
});

test("queue: corrupted storage reads as empty and never throws", () => {
  for (const raw of ["{not json", "42", "{\"a\":1}", "null", "[null, 5, {\"id\":1}, {\"id\":\"ok\"}]"]) {
    const storage = memoryStorage({ [pendingKey("uA")]: raw });

    assert.doesNotThrow(() => readPending("uA", storage), raw);
    assert.ok(Array.isArray(readPending("uA", storage)));
  }

  // Entries without a string id or a log are ignored, valid ones survive.
  const mixed = memoryStorage({
    [pendingKey("uA")]: JSON.stringify([null, { id: 1, log: {} }, { id: "ok", log: LOG() }])
  });

  assert.deepEqual(readPending("uA", mixed).map(i => i.id), ["ok"]);
});

test("queue: a failed write keeps the workout and counts the attempt; success removes it", async () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);

  const failed = await syncPending("uA", async () => { throw new Error("permission-denied"); }, { storage });

  assert.deepEqual([failed.synced, failed.failed, failed.remaining], [0, 1, 1]);

  const [item] = readPending("uA", storage);

  assert.equal(item.attempts, 1);
  assert.match(item.lastError, /permission-denied/);
  assert.deepEqual(item.log, LOG(), "the workout itself is untouched");

  const ok = await syncPending("uA", async () => {}, { storage });

  assert.deepEqual([ok.synced, ok.failed, ok.remaining], [1, 0, 0]);
  assert.deepEqual(readPending("uA", storage), []);
});

test("queue: one user's queue is invisible to another user (UID-scoped keys)", () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);

  assert.deepEqual(readPending("uB", storage), []);
  assert.notEqual(pendingKey("uA"), pendingKey("uB"));
});


// ============================================================================
// SYNC TIMEOUT  (F1)
// ============================================================================

test("timeout: the default is about 20 seconds", () => {
  assert.equal(SYNC_WRITE_TIMEOUT_MS, 20000);
});

test("timeout: withTimeout rejects with code sync-timeout, and passes results through", async () => {
  await assert.rejects(withTimeout(never(), 20), error => error.code === "sync-timeout");
  assert.equal(await withTimeout(Promise.resolve("done"), 1000), "done");
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 1000), /boom/);
});

test("timeout: a hung write keeps the workout queued and counts as a failure", async () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);

  const result = await syncPending("uA", never, { storage, timeoutMs: 25 });

  assert.deepEqual([result.synced, result.failed, result.remaining], [0, 1, 1]);

  const [item] = readPending("uA", storage);

  assert.equal(item.id, "w1");
  assert.equal(item.attempts, 1);
  assert.match(item.lastError, /timed out/i);
  assert.deepEqual(item.log, LOG());
});

test("timeout: after a timeout the next sync runs (the hung write no longer blocks the user)", async () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);

  await syncPending("uA", never, { storage, timeoutMs: 25 });

  const retry = await syncPending("uA", async () => {}, { storage, timeoutMs: 25 });

  assert.deepEqual([retry.synced, retry.remaining], [1, 0]);
});

test("timeout: a later sync joins a running one instead of starting a second write", async () => {
  const storage = memoryStorage();
  let writes = 0;

  enqueuePending("uA", "w1", LOG(), storage);

  const write = async () => { writes += 1; await tick(20); };

  const [a, b] = await Promise.all([
    syncPending("uA", write, { storage }),
    syncPending("uA", write, { storage })
  ]);

  assert.equal(writes, 1);
  assert.equal(a, b, "the second call joined the first job");
});

test("timeout + idempotency: timing out, a late success of the old write, and a retry leave exactly ONE document", async () => {
  const storage = memoryStorage();
  const firestore = new Map();                       // docId -> data (set() semantics)

  enqueuePending("uA", "w1", LOG(), storage);

  let releaseSlowWrite;

  const slowSet = (id, log) =>
    new Promise(resolveWrite => {
      releaseSlowWrite = () => { firestore.set(id, log); resolveWrite(); };
    });

  const first = await syncPending("uA", slowSet, { storage, timeoutMs: 25 });

  assert.equal(first.remaining, 1, "timed out: still queued");

  releaseSlowWrite();                                // the abandoned write lands late

  const retry = await syncPending(
    "uA",
    async (id, log) => { firestore.set(id, log); },
    { storage, timeoutMs: 25 }
  );

  assert.equal(retry.remaining, 0);
  assert.equal(firestore.size, 1, "same syncId -> same document: no duplicate log");
  assert.deepEqual([...firestore.keys()], ["w1"]);
});


// ============================================================================
// ACCOUNT-SWITCH PROTECTION
// ============================================================================

test("account switch: if someone else is signed in, the queue is left exactly as it was", async () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);

  const before = storage.getItem(pendingKey("uA"));
  let writes = 0;

  const result = await syncPending("uA", async () => { writes += 1; }, { storage, isCurrentUser: () => false });

  assert.equal(writes, 0, "nothing is written for a user who is no longer signed in");
  assert.equal(result.skipped, true);
  assert.equal(storage.getItem(pendingKey("uA")), before, "byte-for-byte unchanged");
});

test("account switch: an 'account-changed' error is not a failure and does not count an attempt", async () => {
  const storage = memoryStorage();

  enqueuePending("uA", "w1", LOG(), storage);

  const result = await syncPending("uA", async () => {
    const error = new Error("account changed");
    error.code = "account-changed";
    throw error;
  }, { storage });

  assert.equal(result.skipped, true);
  assert.equal(result.failed, 0);
  assert.equal(readPending("uA", storage)[0].attempts, 0);
});

test("account switch: syncing A never touches B's queue", async () => {
  const storage = memoryStorage();

  enqueuePending("uA", "wa", LOG(), storage);
  enqueuePending("uB", "wb", LOG(), storage);

  const written = [];

  await syncPending("uA", async id => { written.push(id); }, { storage });

  assert.deepEqual(written, ["wa"]);
  assert.deepEqual(readPending("uB", storage).map(i => i.id), ["wb"]);
});


// ============================================================================
// REAL DATA LAYER against a fake Firestore
// ============================================================================

test("data layer: saveWorkoutLogOnce refuses to write when the signed-in user is not the queue's user", async () => {
  const layer = loadDataLayer({ currentUid: "uB" });

  await assert.rejects(
    layer.saveWorkoutLogOnce("uA", "w1", LOG()),
    error => error.code === "account-changed"
  );

  assert.equal(layer.calls.set.length, 0, "nothing was written, for anybody");

  const signedOut = loadDataLayer({ currentUid: null });

  await assert.rejects(signedOut.saveWorkoutLogOnce("uA", "w1", LOG()), error => error.code === "account-changed");
  assert.equal(signedOut.calls.set.length, 0);
});

test("data layer: saveWorkoutLogOnce writes to users/<uid>/workoutLogs/<syncId> and a retry hits the SAME document", async () => {
  const layer = loadDataLayer({ currentUid: "uA" });
  const createdAt = new Date("2026-10-06T10:05:00.000Z");

  await layer.saveWorkoutLogOnce("uA", "w123", LOG({ createdAt }));
  await layer.saveWorkoutLogOnce("uA", "w123", LOG({ createdAt }));

  assert.equal(layer.calls.set.length, 2);
  assert.equal(layer.calls.set[0].path, "users/uA/workoutLogs/w123");
  assert.equal(layer.calls.set[1].path, layer.calls.set[0].path, "idempotent: same document id both times");
  assert.equal(layer.calls.set[1].data.createdAt, createdAt, "a retry never changes createdAt");
});


// ============================================================================
// EXERCISE IDENTITY CHANGE  (F3)
// ============================================================================

const legacy = () => ({
  id: "slot-1", name: "Squat", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120, notes: "pause"
});
const libA = { id: "leg-press", name: "Leg Press" };
const libB = { id: "hack-squat", name: "Machine Hack Squat" };
let counter = 0;
const createId = () => `new-slot-${++counter}`;

test("identity: library A -> library B gets a NEW slot id, keeps the prescription, links to B", () => {
  const onA = applyLibrarySelection(legacy(), libA, { createId });
  const onB = applyLibrarySelection(onA, libB, { createId });

  assert.equal(onA.id, "slot-1", "legacy -> library keeps the slot (it is the same exercise being linked)");
  assert.notEqual(onB.id, "slot-1");
  assert.match(onB.id, /^new-slot-/);
  assert.equal(onB.libraryExerciseId, "hack-squat", "libraryExerciseId semantics unchanged");
  assert.equal(onB.name, "Machine Hack Squat");

  for (const field of ["sets", "repMin", "repMax", "targetRIR", "restSeconds", "notes"]) {
    assert.equal(onB[field], legacy()[field], field);
  }
});

test("identity: re-picking the SAME library exercise keeps the slot id", () => {
  const onA = applyLibrarySelection(legacy(), libA, { createId });
  const again = applyLibrarySelection(onA, libA, { createId });

  assert.equal(again.id, "slot-1");
});

test("identity: legacy / custom exercises keep working (picking links without changing the id)", () => {
  const custom = applyNameEdit(legacy(), "My own squat variation");

  assert.equal(applyLibrarySelection(custom, libB, { createId }).id, "slot-1");
  assert.equal("libraryExerciseId" in custom, false);
});

test("identity: typing in the name box unlinks first - the editor passes the ORIGINAL link so A -> (typed) -> B is still a new exercise", () => {
  const onA = applyLibrarySelection(legacy(), libA, { createId });
  const typed = applyNameEdit(onA, "hack");             // what typing does: unlinks, same id

  assert.equal(typed.id, onA.id);
  assert.equal("libraryExerciseId" in typed, false);

  const picked = applyLibrarySelection(typed, libB, { createId, previousLibraryExerciseId: "leg-press" });

  assert.notEqual(picked.id, onA.id);

  const sameAgain = applyLibrarySelection(typed, libA, { createId, previousLibraryExerciseId: "leg-press" });

  assert.equal(sameAgain.id, onA.id, "typing then picking the SAME exercise is not a change");
});

test("identity: the input object is never mutated", () => {
  const onA = applyLibrarySelection(legacy(), libA, { createId });
  const snapshot = JSON.stringify(onA);

  applyLibrarySelection(onA, libB, { createId });

  assert.equal(JSON.stringify(onA), snapshot);
});

test("identity: the real editor wires the original link through (source check)", () => {
  const editor = readFileSync(resolve(root, "workoutPlanEditor.js"), "utf8");

  assert.match(editor, /slotLibraryOrigin/);
  assert.match(editor, /previousLibraryExerciseId/);
});


// ============================================================================
// OLD LOGS STAY UNCHANGED + PREVIOUS PERFORMANCE DISTINGUISHES OLD / NEW
// ============================================================================

test("old logs are not modified by a plan identity change, and previous performance follows the right exercise", async () => {
  // A saved plan with a library-linked exercise, and logs recorded under its slot id.
  const planBefore = { id: "plan-1", exercises: [{ ...legacy(), name: "Leg Press", libraryExerciseId: "leg-press" }] };

  const oldLogs = [
    { id: "L2", ...LOG({ date: "2026-10-05T10:00:00.000Z" }) },
    { id: "L1", ...LOG({ date: "2026-09-28T10:00:00.000Z" }) }
  ];

  const logsSnapshot = JSON.stringify(oldLogs);

  // The user switches the slot's exercise from Leg Press to Hack Squat in the editor.
  const changed = applyLibrarySelection(planBefore.exercises[0], libB, { createId });
  const planAfter = { ...planBefore, exercises: [changed] };

  assert.notEqual(planAfter.exercises[0].id, planBefore.exercises[0].id);
  assert.equal(JSON.stringify(oldLogs), logsSnapshot, "history is data the plan editor never touches");

  // Previous performance through the REAL lookup code.
  const layer = loadDataLayer({
    currentUid: "uA",
    docs: oldLogs.map(({ id, ...data }) => ({ id, data }))
  });

  const newExercisePrevious = await layer.getPreviousWorkoutLog("plan-1", planAfter.exercises[0].id);
  const oldExercisePrevious = await layer.getPreviousWorkoutLog("plan-1", "slot-1");

  assert.equal(newExercisePrevious, null, "Hack Squat has no history: Leg Press numbers are NOT shown as its previous");
  assert.equal(oldExercisePrevious?.id, "L2", "the old exercise's history is still found, newest first");
});

test("old logs written under the old slot id still resolve for a plan that still uses it", async () => {
  const layer = loadDataLayer({
    currentUid: "uA",
    docs: [{ id: "L1", data: LOG() }]
  });

  assert.equal((await layer.getPreviousWorkoutLog("plan-1", "slot-1"))?.id, "L1");
});


// ============================================================================
// ONE SHARED COMPLETED-LOG CHECK
// ============================================================================

test("completed log: 'completed' and legacy no-status logs count; anything else does not", () => {
  assert.equal(isCompletedLog({ status: "completed" }), true);
  assert.equal(isCompletedLog({}), true, "logs from before status existed");
  assert.equal(isCompletedLog({ status: "in-progress" }), false);
  assert.equal(isCompletedLog({ status: "abandoned" }), false);
  assert.equal(isCompletedLog(null), false);
  assert.equal(isCompletedLog(undefined), false);
});

test("completed log: the previous-performance lookup ignores unfinished logs", async () => {
  const layer = loadDataLayer({
    currentUid: "uA",
    docs: [
      { id: "draft", data: LOG({ status: "in-progress" }) },
      { id: "done", data: LOG() }
    ]
  });

  assert.equal((await layer.getPreviousWorkoutLog("plan-1", "slot-1"))?.id, "done");
});

test("completed log: Dashboard, History, Progress and the data layer all use the shared check (no private copies)", () => {
  for (const file of ["dashboard.js", "history.js", "progress.js", "data/recompositionData.js"]) {
    const source = readFileSync(resolve(root, file), "utf8");

    assert.match(source, /isCompletedLog/, `${file} uses the shared check`);
    assert.doesNotMatch(source, /status\s*===\s*"completed"/, `${file} has no private status comparison`);
    assert.doesNotMatch(source, /status\s*!==\s*"completed"/, `${file} has no private status comparison`);
  }
});
