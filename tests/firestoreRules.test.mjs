// ============================================================================
// Firestore rules - checks that run everywhere (no emulator needed).
//   1. firestore.rules is exactly the approved production rules.
//   2. The app only ever touches Firestore under users/{uid}/...
// The behavioural proof (A vs B vs anonymous) lives in tests/rules/ and needs
// the Firebase emulator: `npm run test:rules`.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(root, file), "utf8");
const squash = text => text.replace(/\s+/g, " ").trim();

const APPROVED = `
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                        && request.auth.uid == userId;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

test("firestore.rules is exactly the approved production rules", () => {
  assert.equal(squash(read("firestore.rules")), squash(APPROVED));
});

test("the rules never allow anything unconditionally", () => {
  const rules = read("firestore.rules");

  assert.doesNotMatch(rules, /if\s+true/);
  assert.doesNotMatch(rules, /allow[^;]*:\s*;/);
  assert.equal((rules.match(/allow\s/g) ?? []).length, 2);
});

test("firebase.json deploys firestore.rules", () => {
  assert.equal(JSON.parse(read("firebase.json")).firestore.rules, "firestore.rules");
});

test("every Firestore path in the app starts at users/{signed-in uid}", () => {
  const files = readdirSync(root).filter(name => name.endsWith(".js"));
  files.push("data/recompositionData.js");

  let checked = 0;

  for (const file of files) {
    const source = read(file);

    if (!/firebase-firestore\.js/.test(source) && file !== "data/recompositionData.js") {
      continue;
    }

    // doc(db, "a", ...)  /  collection(db, "a", ...)  - first path segment.
    for (const match of source.matchAll(/\b(?:doc|collection|collectionGroup)\(\s*db\s*,\s*("[^"]*"|[\w.]+)\s*(?:,\s*(getUserId\(\)|[\w."]+))?/g)) {
      const first = match[1].trim();
      const second = (match[2] ?? "").trim();

      checked += 1;

      assert.equal(first, '"users"', `${file}: first path segment must be "users" (found ${first})`);
      assert.match(
        second,
        /^(user\.uid|uid|userId|getUserId\(\))$/,
        `${file}: second path segment must be the signed-in uid (found ${second})`
      );
    }

    assert.doesNotMatch(source, /collectionGroup\(/, `${file}: collection-group queries bypass per-user paths`);
  }

  assert.ok(checked >= 10, `expected to inspect the data layer (inspected ${checked})`);
});

test("the sub-collections the app uses are exactly the ones the rules cover", () => {
  const source = read("data/recompositionData.js");
  const names = new Set(
    [...source.matchAll(/(?:userCollection\(|"users",\s*(?:getUserId\(\)|uid),\s*)"([A-Za-z]+)"/g)].map(m => m[1])
  );

  assert.deepEqual(
    [...names].sort(),
    ["goals", "measurements", "weightHistory", "workoutLogs", "workoutPlans"]
  );
});
