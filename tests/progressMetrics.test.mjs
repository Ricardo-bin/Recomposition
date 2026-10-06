// ============================================================================
// PROGRESS = objective evidence of what actually happened.
// Pure metrics (progressMetrics.js). No DOM, no Firebase.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEASUREMENT_SITES,
  compareLatest,
  compareMeasurements,
  compareVolume,
  compareWeight,
  estimateOneRepMax,
  getBestSet,
  percentChange
} from "../progressMetrics.js";

const near = (actual, expected, digits = 6) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} != ${expected}`);


// ---- estimated 1RM (Epley) ------------------------------------------------------

test("Epley: weight x (1 + reps / 30)", () => {
  near(estimateOneRepMax(100, 1), 100 * (1 + 1 / 30));
  near(estimateOneRepMax(60, 12), 84);
  near(estimateOneRepMax("70", "8"), 70 * (1 + 8 / 30));
});

test("estimated 1RM refuses invalid input instead of producing NaN", () => {
  for (const [w, r] of [[0, 5], [-5, 5], [50, 0], [50, -1], ["", 5], [50, ""], [null, 5], [undefined, 5], ["x", 5], [50, NaN]]) {
    assert.equal(estimateOneRepMax(w, r), null, `${w} x ${r}`);
  }
});


// ---- best set = highest estimated 1RM ---------------------------------------------

test("best set is the highest estimated 1RM, NOT the highest weight x reps", () => {
  // 60 x 12 -> volume 720, e1RM 84.0
  // 70 x  8 -> volume 560, e1RM 88.7   <- strongest set
  const best = getBestSet([
    { weight: 60, reps: 12 },
    { weight: 70, reps: 8 }
  ]);

  assert.equal(best.weight, 70);
  assert.equal(best.reps, 8);
  assert.equal(best.volume, 560);
  near(best.estimatedOneRepMax, 70 * (1 + 8 / 30));
});

test("the result does not depend on set order", () => {
  const sets = [{ weight: 70, reps: 8 }, { weight: 60, reps: 12 }, { weight: 50, reps: 20 }];

  assert.equal(getBestSet(sets).weight, 70);
  assert.equal(getBestSet([...sets].reverse()).weight, 70);
});

test("a tie goes to the heavier set", () => {
  // 90 x 10 and 100 x 6 are both e1RM 120.
  const best = getBestSet([{ weight: 90, reps: 10 }, { weight: 100, reps: 6 }]);

  assert.equal(best.weight, 100);
});

test("text numbers from stored logs work; invalid sets are ignored", () => {
  const best = getBestSet([
    { weight: "", reps: "" },
    { weight: "abc", reps: "5" },
    { weight: "0", reps: "10" },
    { weight: "-20", reps: "10" },
    { weight: "40", reps: "0" },
    null,
    undefined,
    { weight: "80", reps: "5" }
  ]);

  assert.deepEqual([best.weight, best.reps], [80, 5]);
});

test("no valid set -> null (never throws)", () => {
  assert.equal(getBestSet([]), null);
  assert.equal(getBestSet(undefined), null);
  assert.equal(getBestSet(null), null);
  assert.equal(getBestSet("nope"), null);
  assert.equal(getBestSet([{ weight: 0, reps: 0 }]), null);
});

test("getBestSet does not modify its input (historical logs are never touched)", () => {
  const sets = Object.freeze([Object.freeze({ weight: 70, reps: 8 })]);

  assert.doesNotThrow(() => getBestSet(sets));
});


// ---- percentage change ----------------------------------------------------------------

test("percentChange: valid, negative, zero and undefined cases", () => {
  near(percentChange(110, 100), 10);
  near(percentChange(90, 100), -10);
  assert.equal(percentChange(100, 100), 0);
  assert.equal(percentChange(5, 0), null);
  assert.equal(percentChange(5, -3), null);
  assert.equal(percentChange(5, null), null);
  assert.equal(percentChange(undefined, 5), null);
  assert.equal(percentChange("x", 5), null);
});


// ---- volume comparison ------------------------------------------------------------------

test("volume comparison: (current - previous) / previous x 100", () => {
  const up = compareVolume(11000, 10000);

  assert.equal(up.status, "changed");
  near(up.percent, 10);
  assert.equal(up.difference, 1000);

  const down = compareVolume(7500, 10000);

  near(down.percent, -25);
  assert.equal(down.difference, -2500);

  assert.equal(compareVolume(10000, 10000).percent, 0);
});

test("volume comparison with zero / undefined previous volume is safe (no Infinity, no NaN)", () => {
  for (const previous of [0, undefined, null, "", NaN, -5]) {
    const result = compareVolume(5000, previous);

    assert.equal(result.status, "no-previous");
    assert.equal(result.percent, null);
    assert.equal(result.difference, 5000);
  }

  for (const [c, p] of [[0, 0], [undefined, undefined], [null, null], [NaN, NaN]]) {
    const result = compareVolume(c, p);

    assert.equal(result.status, "no-data");
    assert.equal(result.percent, null);
  }

  // Training last week, nothing this week: a real -100 %.
  const none = compareVolume(0, 8000);

  assert.equal(none.status, "changed");
  assert.equal(none.percent, -100);
});


// ---- dated comparisons (weight, measurements) --------------------------------------------------

test("body weight: previous -> current -> change from the two latest weigh-ins, any input order", () => {
  const result = compareWeight([
    { weight: 71, date: "2026-09-23" },
    { weight: "72.5", date: "2026-09-30" },
    { weight: 74, date: "2026-08-01" }
  ]);

  assert.equal(result.current, 72.5);
  assert.equal(result.previous, 71);
  near(result.change, 1.5);
  assert.equal(result.currentDate, "2026-09-30");
  assert.equal(result.previousDate, "2026-09-23");
});

test("body weight: one entry, no entries, junk entries", () => {
  const one = compareWeight([{ weight: 80, date: "2026-09-30" }]);

  assert.equal(one.current, 80);
  assert.equal(one.previous, null);
  assert.equal(one.change, null);

  assert.deepEqual(
    compareWeight([]),
    { current: null, previous: null, change: null, currentDate: null, previousDate: null }
  );
  assert.equal(compareWeight(undefined).current, null);
  assert.equal(compareWeight(null).current, null);
  assert.equal(compareWeight([{ weight: "", date: "2026-09-30" }, { weight: "abc", date: "2026-09-29" }]).current, null);
});

test("an entry with an unreadable date never counts as the newest", () => {
  const result = compareWeight([
    { weight: 99, date: "not a date" },
    { weight: 80, date: "2026-09-30" },
    { weight: 79, date: "2026-09-23" }
  ]);

  assert.equal(result.current, 80);
  assert.equal(result.previous, 79);
});

test("Firestore-style timestamps are understood", () => {
  const stamp = iso => ({ toDate: () => new Date(iso) });

  const result = compareLatest(
    [{ date: stamp("2026-09-01T00:00:00Z"), value: 1 }, { date: stamp("2026-09-10T00:00:00Z"), value: 5 }]
  );

  assert.equal(result.current, 5);
  assert.equal(result.change, 4);
});

test("measurements: previous -> current -> change per site", () => {
  const rows = compareMeasurements([
    { date: "2026-08-01", chest: 40, waist: 34, arms: 14 },
    { date: "2026-09-01", chest: "41", waist: 33, arms: 14.5, thighs: 23 }
  ]);

  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));

  assert.deepEqual([byKey.chest.previous, byKey.chest.current, byKey.chest.change], [40, 41, 1]);
  assert.deepEqual([byKey.waist.previous, byKey.waist.current, byKey.waist.change], [34, 33, -1]);
  near(byKey.arms.change, 0.5);

  // Only one reading for thighs: shown, but nothing to compare with.
  assert.deepEqual([byKey.thighs.previous, byKey.thighs.current, byKey.thighs.change], [null, 23, null]);

  // Sites that were never measured are not listed.
  assert.ok(!("calves" in byKey));
  assert.ok(!("forearms" in byKey));
});

test("each site compares its own two latest readings (a site missing from the newest entry still works)", () => {
  const rows = compareMeasurements([
    { date: "2026-07-01", calves: 15 },
    { date: "2026-08-01", calves: 15.5, chest: 40 },
    { date: "2026-09-01", chest: 41 }
  ]);

  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));

  assert.deepEqual([byKey.chest.previous, byKey.chest.current], [40, 41]);
  assert.deepEqual([byKey.calves.previous, byKey.calves.current, byKey.calves.change], [15, 15.5, 0.5]);
});

test("legacy field names are supported: shoulder, thigh, leftArm/rightArm", () => {
  const rows = compareMeasurements([
    { date: "2026-08-01", shoulder: 48, thigh: 22, leftArm: 13, rightArm: 14 },
    { date: "2026-09-01", shoulder: 49, thigh: 22.5, leftArm: 14, rightArm: 15 }
  ]);

  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));

  assert.equal(byKey.shoulders.change, 1);
  assert.equal(byKey.thighs.change, 0.5);
  assert.equal(byKey.arms.current, 14.5);
  assert.equal(byKey.arms.change, 1);
});

test("measurements: empty and malformed input is safe", () => {
  assert.deepEqual(compareMeasurements([]), []);
  assert.deepEqual(compareMeasurements(undefined), []);
  assert.deepEqual(compareMeasurements(null), []);
  assert.deepEqual(compareMeasurements([null, undefined, {}, { date: "2026-09-01", chest: "" }]), []);
  assert.equal(MEASUREMENT_SITES.length, 7);
});


// ---- the product decision: NO fake overall progress ---------------------------------------------------

test("progress code has no overall / body / physique / muscle percentage and no progress bar", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const file of ["progressMetrics.js", "progress.js", "goals.js", "dashboard.js"]) {
    const code = strip(readFileSync(resolve(here, "..", file), "utf8"));

    assert.doesNotMatch(
      code,
      /overall[\s_-]+progress|body[\s_-]+progress|recomposition[\s_-]+progress|muscle[\s_-]+progress|physique[\s_-]+(completion|progress)|goal[\s_-]+(completion|progress)/i,
      `${file} must not define a fake progress figure`
    );

    assert.doesNotMatch(code, /<progress\b|role="progressbar"|progress-bar|progress-fill|progressbar/i, `${file} has no progress bar`);
  }
});

test("progressMetrics.js is pure (no imports, no DOM, no Firebase)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = readFileSync(resolve(here, "..", "progressMetrics.js"), "utf8").replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(code, /^\s*import\s/m);
  assert.doesNotMatch(code, /\b(document|window|firebase|localStorage)\b/);
});
