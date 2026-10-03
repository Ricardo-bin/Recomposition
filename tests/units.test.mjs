// Tests for units.js (weight kg/lb). Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KG_PER_LB, normalizeWeightUnit, weightUnitLabel, kgToDisplay, displayToKg,
  formatNumber, formatWeight, weightInputValue, convertInputText, weightRange
} from "../units.js";

test("normalizeWeightUnit: only 'lb' is pounds; everything else is kg", () => {
  assert.equal(normalizeWeightUnit("lb"), "lb");
  for (const v of ["kg", "", undefined, null, "LB", "pounds", 5]) {
    assert.equal(normalizeWeightUnit(v), "kg");
  }
  assert.equal(weightUnitLabel("lb"), "lb");
  assert.equal(weightUnitLabel(undefined), "kg");
});

test("EXISTING kg data is displayed exactly as before (kg preference or none)", () => {
  for (const unit of ["kg", undefined, null, "bogus"]) {
    assert.equal(formatWeight(72, unit), "72 kg");
    assert.equal(formatWeight(72.5, unit), "72.5 kg");
    assert.equal(formatWeight("71", unit), "71 kg", "numeric strings in old documents");
    assert.equal(formatWeight(0.5, unit), "0.5 kg");
  }
  assert.equal(weightInputValue(72, "kg"), "72");
});

test("kg -> lb display", () => {
  assert.equal(formatWeight(72, "lb"), "158.7 lb");
  assert.equal(formatWeight(100, "lb"), "220.5 lb");
  assert.equal(formatWeight(45.359237, "lb"), "100 lb");
  assert.ok(Math.abs(kgToDisplay(1, "lb") - 2.2046226218) < 1e-9);
});

test("lb typed -> kg stored, rounded to 0.01 (no float noise in Firestore)", () => {
  assert.equal(displayToKg(160, "lb"), 72.57);
  assert.equal(displayToKg(100, "lb"), 45.36);
  assert.equal(displayToKg(72.5, "kg"), 72.5, "kg input is stored unchanged");
  assert.equal(displayToKg("72.5", "kg"), 72.5);
});

test("round trip: what you type is what you see again", () => {
  for (const typed of [100, 150, 159.8, 175, 200.5, 220]) {
    const kg = displayToKg(typed, "lb");
    assert.equal(formatWeight(kg, "lb", { withUnit: false }), String(typed), `${typed} lb`);
  }
  for (const typed of [50, 71.3, 72.5, 99.9]) {
    assert.equal(formatWeight(displayToKg(typed, "kg"), "kg", { withUnit: false }), String(typed));
  }
});

test("switching the preference never changes the stored kg value", () => {
  const stored = 72.5;
  const asLb = formatWeight(stored, "lb");
  const backToKg = formatWeight(stored, "kg");
  assert.equal(asLb, "159.8 lb");
  assert.equal(backToKg, "72.5 kg");
  assert.equal(stored, 72.5);
});

test("blank / invalid values are handled safely", () => {
  for (const v of [null, undefined, "", "abc", NaN, Infinity]) {
    assert.equal(kgToDisplay(v, "lb"), null);
    assert.equal(displayToKg(v, "lb"), null);
    assert.equal(formatWeight(v, "lb"), "—");
    assert.equal(weightInputValue(v, "lb"), "");
  }
  assert.equal(formatNumber(undefined), "—");
});

test("convertInputText converts the box when the unit selector flips", () => {
  assert.equal(convertInputText("72.5", "kg", "lb"), "159.8");
  assert.equal(convertInputText("159.8", "lb", "kg"), "72.5");
  assert.equal(convertInputText("72.5", "kg", "kg"), "72.5");
  assert.equal(convertInputText("", "kg", "lb"), "");
  assert.equal(convertInputText("abc", "kg", "lb"), "abc");
});

test("weightRange follows the unit (profile limit is 20-400 kg)", () => {
  assert.deepEqual(weightRange("kg"), { min: 20, max: 400 });
  assert.deepEqual(weightRange("lb"), { min: 44, max: 882 });
});

test("constant", () => assert.equal(KG_PER_LB, 0.45359237));
