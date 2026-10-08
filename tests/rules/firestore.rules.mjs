// ============================================================================
// Firestore security rules - Firebase Emulator test.
// Run with:  npm run test:rules
// (needs Java + the Firestore emulator; it is NOT part of `npm test`).
//
// Proves, against the real rules engine and the real firestore.rules file:
//   - User A can read/write User A's data
//   - User A cannot read User B's data
//   - User A cannot write User B's data
//   - Unauthenticated access is denied
//   - Everything outside users/{uid}/... is denied
// ============================================================================

import { before, after, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(here, "..", "..", "firestore.rules"), "utf8");

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

let lib = null;

try {
  lib = await import("@firebase/rules-unit-testing");
} catch {
  lib = null;
}

const skip = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST is not set - run through `npm run test:rules`"
  : !lib
    ? "@firebase/rules-unit-testing is not installed - run `npm install`"
    : false;

describe("firestore.rules", { skip }, () => {
  let env;
  let fsA;
  let fsB;
  let fsAnon;

  const { initializeTestEnvironment, assertSucceeds, assertFails } = lib ?? {};

  before(async () => {
    const [host, port] = emulatorHost.split(":");

    env = await initializeTestEnvironment({
      projectId: "demo-recomposition",
      firestore: { rules: RULES, host, port: Number(port) }
    });

    fsA = env.authenticatedContext("userA").firestore();
    fsB = env.authenticatedContext("userB").firestore();
    fsAnon = env.unauthenticatedContext().firestore();
  });

  beforeEach(async () => {
    await env.clearFirestore();

    // B's data is created with rules disabled, so it exists to be attacked.
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();

      await db.doc("users/userB").set({ name: "B", currentWeight: 80 });
      await db.doc("users/userB/workoutLogs/log1").set({ workoutName: "B secret" });
      await db.doc("users/userB/goals/g1").set({ calories: 2500 });
    });
  });

  after(async () => {
    await env?.cleanup();
  });

  test("User A can read and write A's profile document", async () => {
    await assertSucceeds(fsA.doc("users/userA").set({ name: "A" }));
    await assertSucceeds(fsA.doc("users/userA").get());
  });

  test("User A can read, write, list and delete A's sub-collections", async () => {
    for (const path of [
      "users/userA/workoutPlans/p1",
      "users/userA/workoutLogs/l1",
      "users/userA/weightHistory/w1",
      "users/userA/measurements/m1",
      "users/userA/goals/g1"
    ]) {
      await assertSucceeds(fsA.doc(path).set({ ok: true }));
      await assertSucceeds(fsA.doc(path).get());
      await assertSucceeds(fsA.doc(path).delete());
    }

    await assertSucceeds(fsA.collection("users/userA/workoutLogs").get());
  });

  test("User A cannot read B's profile or B's data", async () => {
    await assertFails(fsA.doc("users/userB").get());
    await assertFails(fsA.doc("users/userB/workoutLogs/log1").get());
    await assertFails(fsA.doc("users/userB/goals/g1").get());
    await assertFails(fsA.collection("users/userB/workoutLogs").get());
  });

  test("User A cannot write, update or delete B's data", async () => {
    await assertFails(fsA.doc("users/userB").set({ name: "hacked" }));
    await assertFails(fsA.doc("users/userB").update({ currentWeight: 1 }));
    await assertFails(fsA.doc("users/userB/workoutLogs/new").set({ x: 1 }));
    await assertFails(fsA.doc("users/userB/workoutLogs/log1").delete());
    await assertFails(fsA.doc("users/userB/goals/g1").update({ calories: 1 }));
  });

  test("B cannot reach A's data either (symmetry)", async () => {
    await assertSucceeds(fsA.doc("users/userA/goals/g1").set({ calories: 1 }));
    await assertFails(fsB.doc("users/userA/goals/g1").get());
    await assertFails(fsB.doc("users/userA/goals/g1").set({ calories: 2 }));
  });

  test("Unauthenticated users are denied everything", async () => {
    await assertFails(fsAnon.doc("users/userA").get());
    await assertFails(fsAnon.doc("users/userB").get());
    await assertFails(fsAnon.doc("users/userB/workoutLogs/log1").get());
    await assertFails(fsAnon.doc("users/userA/goals/g1").set({ x: 1 }));
    await assertFails(fsAnon.collection("users/userB/workoutLogs").get());
  });

  test("Anything outside users/{uid}/... is denied, even when signed in", async () => {
    await assertFails(fsA.doc("publicStuff/x").get());
    await assertFails(fsA.doc("publicStuff/x").set({ x: 1 }));
    await assertFails(fsA.collection("users").get());
    await assertFails(fsA.doc("admin/config").get());
  });
});
