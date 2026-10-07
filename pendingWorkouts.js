// ============================================================================
// RECOMPOSITION — PENDING WORKOUTS (offline completion queue)
// ----------------------------------------------------------------------------
// A completed workout is written HERE first (localStorage, per user), then
// synced to Firestore. It only leaves this queue after Firestore confirmed it.
//
// Duplicate safety: every workout has one stable id (`syncId`, created when
// the session starts). The Firestore log document id IS that id, and the write
// is a set(): retrying any number of times (double tap, timeout after a
// successful write, reload, reconnect) overwrites the same document.
//
// Pure module: storage and the Firestore writer are injected.
// ============================================================================

const PENDING_KEY_PREFIX = "recomposition.pendingWorkouts.v1.";

export const pendingKey = uid => PENDING_KEY_PREFIX + uid;

// Firestore-safe, URL-safe, stable. Not cryptographic: it only needs to be
// unique per workout of one user.
export function createSyncId(now = Date.now(), random = Math.random) {
  const part = () => Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");

  return `w${now.toString(36)}${part()}${part()}`;
}

export function readPending(uid, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(pendingKey(uid));
    const list = raw ? JSON.parse(raw) : [];

    return Array.isArray(list)
      ? list.filter(item => item && typeof item.id === "string" && item.log)
      : [];
  } catch (error) {
    return [];
  }
}

function writePending(uid, list, storage) {
  if (list.length === 0) {
    storage.removeItem(pendingKey(uid));
    return;
  }

  storage.setItem(pendingKey(uid), JSON.stringify(list));
}

// Idempotent: queueing the same id again replaces the entry (never adds one).
// Throws if the device cannot store it, so the caller can keep the session.
export function enqueuePending(uid, id, log, storage = globalThis.localStorage) {
  const list = readPending(uid, storage).filter(item => item.id !== id);

  list.push({
    id,
    log,
    completedAt: Date.now(),
    attempts: 0,
    lastError: null
  });

  writePending(uid, list, storage);
}

export function removePending(uid, id, storage = globalThis.localStorage) {
  writePending(
    uid,
    readPending(uid, storage).filter(item => item.id !== id),
    storage
  );
}

export function isPending(uid, id, storage = globalThis.localStorage) {
  return readPending(uid, storage).some(item => item.id === id);
}

// A Firestore write can stay pending forever on a flaky connection (the browser
// says "online" but nothing gets through). Without a limit, that one hung write
// would block every later sync for the user. After this long the attempt is
// counted as FAILED: the workout stays queued and the normal retry runs. A late
// success of the abandoned write is harmless: it is the same set() on the same
// document id.
export const SYNC_WRITE_TIMEOUT_MS = 20000;

export function withTimeout(promise, ms) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `Sync timed out after ${Math.round(ms / 1000)}s; the workout is still saved on this device.`
      );
      error.code = "sync-timeout";
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// One sync at a time per user, so two triggers (online + auth, say) never
// race. A second call while one runs joins the running one.
const running = new Map();

// write(id, log, item) must resolve only when Firestore accepted the write.
// Failures keep the item queued; nothing is ever dropped on error.
export function syncPending(
  uid,
  write,
  {
    storage = globalThis.localStorage,
    onItemSynced = () => {},
    // False when someone else is signed in now: this queue is left untouched.
    isCurrentUser = () => true,
    timeoutMs = SYNC_WRITE_TIMEOUT_MS
  } = {}
) {
  if (running.has(uid)) {
    return running.get(uid);
  }

  const job = (async () => {
    let synced = 0;
    let failed = 0;
    let skipped = false;

    for (const item of readPending(uid, storage)) {
      if (!isCurrentUser()) {
        skipped = true;
        break;
      }

      try {
        await withTimeout(
          Promise.resolve().then(() => write(item.id, item.log, item)),
          timeoutMs
        );

        removePending(uid, item.id, storage);
        synced += 1;

        try {
          onItemSynced(item);
        } catch (error) {
          // A UI hook must never undo a successful sync.
        }
      } catch (error) {
        if (error?.code === "account-changed") {
          // Not a failure of the workout: leave the item exactly as it is.
          skipped = true;
          break;
        }

        failed += 1;

        try {
          const list = readPending(uid, storage).map(entry =>
            entry.id === item.id
              ? {
                  ...entry,
                  attempts: (entry.attempts || 0) + 1,
                  lastError: String(error?.message ?? error).slice(0, 200)
                }
              : entry
          );

          writePending(uid, list, storage);
        } catch (storageError) {
          // Bookkeeping only; the item itself is still stored.
        }
      }
    }

    return { synced, failed, skipped, remaining: readPending(uid, storage).length };
  })().finally(() => running.delete(uid));

  running.set(uid, job);

  return job;
}
