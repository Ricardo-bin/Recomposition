// ============================================================================
// Hosting configuration (vercel.json / .vercelignore) - runs everywhere.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(root, file), "utf8");

const config = JSON.parse(read("vercel.json"));
const global = config.headers.find(rule => rule.source === "/(.*)");
const header = name => global.headers.find(item => item.key.toLowerCase() === name.toLowerCase())?.value;

test("the baseline security headers are configured for every route", () => {
  assert.match(header("Strict-Transport-Security"), /max-age=\d{7,}/);
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.ok(header("Permissions-Policy"));
});

test("COOP is not set to a value that would break Google sign-in popups", () => {
  const coop = header("Cross-Origin-Opener-Policy");

  assert.ok(coop === undefined || coop === "same-origin-allow-popups");
});

test("the CSP carries a hash for every inline script in index.html (no drift)", () => {
  const csp = header("Content-Security-Policy") ?? header("Content-Security-Policy-Report-Only");

  assert.ok(csp, "a CSP (or Report-Only CSP) is configured");

  const inline = [...read("index.html").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

  assert.ok(inline.length > 0);

  for (const body of inline) {
    const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

    assert.ok(csp.includes(hash), `CSP is missing the hash for an inline script starting: ${body.trim().slice(0, 40)}`);
  }
});

test("the CSP is restrictive where it matters", () => {
  const csp = header("Content-Security-Policy") ?? header("Content-Security-Policy-Report-Only");

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);

  const scriptSrc = csp.split(";").map(part => part.trim()).find(part => part.startsWith("script-src"));

  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/, "scripts are never allowed inline or via eval");
});

test("the service worker script is always revalidated", () => {
  const rule = config.headers.find(item => item.source === "/sw.js");
  const cache = rule.headers.find(item => item.key === "Cache-Control").value;

  assert.match(cache, /no-cache|no-store|max-age=0/);
});

test("the third-party script is no longer on every page", () => {
  assert.doesNotMatch(read("index.html"), /sheetjs/i);
});

test("tests, tooling and rules source are not deployed", () => {
  const ignored = read(".vercelignore").split("\n").map(line => line.trim());

  for (const entry of ["node_modules", "tests", ".git", "firestore.rules", "package.json"]) {
    assert.ok(ignored.includes(entry), `${entry} is excluded from deployment`);
  }

  assert.ok(!ignored.includes("assets") && !ignored.includes("data"), "app assets/data are still deployed");
});
