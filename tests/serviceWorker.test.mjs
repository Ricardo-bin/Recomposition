// ============================================================================
// Service worker safety: it may only keep the static app shell and the SDK /
// SheetJS *code*. It must never touch Firestore, Auth or any other API.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(resolve(root, "sw.js"), "utf8");

test("only GET requests are ever handled", () => {
  assert.match(sw, /request\.method !== "GET"[\s\S]{0,40}return/);
});

test("the only cross-origin code it caches is the pinned Firebase SDK and SheetJS", () => {
  const block = sw.slice(sw.indexOf("const CODE_HOSTS"), sw.indexOf("];", sw.indexOf("const CODE_HOSTS")));

  assert.deepEqual(
    [...block.matchAll(/host:\s*"([^"]+)"/g)].map(m => m[1]),
    ["www.gstatic.com", "cdn.sheetjs.com"]
  );
  assert.match(block, /\/firebasejs\//);
});

test("no API / auth / data host appears anywhere in the service worker", () => {
  for (const host of [
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "apis.google.com",
    "accounts.google.com",
    "firebaseapp.com"
  ]) {
    assert.ok(!sw.includes(host), `${host} must not be referenced by the service worker`);
  }
});

test("every other cross-origin request is left alone (not intercepted)", () => {
  assert.match(sw, /url\.origin !== self\.location\.origin\)\s*\{\s*return;/);
});

test("same-origin responses are cached only when plain, ok and not private/no-store", () => {
  assert.match(sw, /response\.type === "basic"/);
  assert.match(sw, /no-store\|private/);
});

test("authorization headers / tokens are never read or stored by the service worker", () => {
  assert.doesNotMatch(sw, /authorization|Bearer|idToken|accessToken|refreshToken/i);
});

test("every file listed in the app shell actually exists", () => {
  const shell = sw.slice(sw.indexOf("const SHELL"), sw.indexOf("];", sw.indexOf("const SHELL")));
  const files = [...shell.matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(name => name !== "./");

  assert.ok(files.length > 20);

  for (const file of files) {
    assert.ok(existsSync(resolve(root, file)), `${file} is listed in the shell but missing`);
  }
});
