// Tests for themeAssets.js (pure configuration). Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  THEME_IDS, DEFAULT_THEME, THEME_LABELS, ASSET_FILES, ASSET_KEYS, THEME_ASSETS,
  normalizeThemeId, getThemeAssets
} from "../themeAssets.js";

const here = dirname(fileURLToPath(import.meta.url));

test("two themes, seven asset keys each, exactly as specified", () => {
  assert.deepEqual([...THEME_IDS], ["batman", "linkin-park"]);
  assert.deepEqual([...ASSET_KEYS], ["logo", "hero", "dashboard", "profile", "background", "decorative", "texture"]);
  assert.equal(DEFAULT_THEME, "batman");
  assert.deepEqual({ ...THEME_LABELS }, { "batman": "Batman Dark", "linkin-park": "Linkin Park Light" });

  for (const id of THEME_IDS) {
    assert.deepEqual(Object.keys(THEME_ASSETS[id]), [...ASSET_KEYS], id);
  }
});

test("formats: SVG for the logo, WebP for artwork", () => {
  assert.equal(ASSET_FILES.logo, "logo.svg");

  for (const key of ASSET_KEYS.filter(k => k !== "logo")) {
    assert.match(ASSET_FILES[key], /\.webp$/, key);
  }
});

test("every path is local, relative and inside that theme's own folder", () => {
  for (const id of THEME_IDS) {
    for (const key of ASSET_KEYS) {
      const path = THEME_ASSETS[id][key];

      assert.equal(path, `assets/themes/${id}/${ASSET_FILES[key]}`);
      assert.ok(!/^[a-z]+:\/\//i.test(path) && !path.startsWith("/") && !path.includes(".."), path);
    }
  }
});

test("no path is shared between themes (a theme can never borrow the other's file)", () => {
  const all = THEME_IDS.flatMap(id => Object.values(THEME_ASSETS[id]));

  assert.equal(new Set(all).size, all.length);
  assert.ok(Object.values(THEME_ASSETS.batman).every(p => !p.includes("linkin-park")));
  assert.ok(Object.values(THEME_ASSETS["linkin-park"]).every(p => !p.includes("batman")));
});

test("getThemeAssets returns all keys for the requested theme only", () => {
  assert.equal(getThemeAssets("batman").logo, "assets/themes/batman/logo.svg");
  assert.equal(getThemeAssets("linkin-park").logo, "assets/themes/linkin-park/logo.svg");
  assert.deepEqual(Object.keys(getThemeAssets("linkin-park")), [...ASSET_KEYS]);
});

test("unknown / bad ids resolve to the default theme, never throw", () => {
  for (const bad of ["", "joker", undefined, null, 5, {}, "__proto__", "constructor", "toString"]) {
    assert.equal(normalizeThemeId(bad), "batman", String(bad));
    assert.equal(getThemeAssets(bad).logo, "assets/themes/batman/logo.svg");
  }
});

test("a missing asset is null (and only that key); other keys are untouched; no cross-theme fallback", () => {
  const themes = {
    "batman": { ...THEME_ASSETS.batman },
    "linkin-park": { ...THEME_ASSETS["linkin-park"], hero: null, logo: "" }
  };
  delete themes["linkin-park"].texture;

  const lp = getThemeAssets("linkin-park", themes);

  assert.equal(lp.hero, null);
  assert.equal(lp.logo, null);
  assert.equal(lp.texture, null);
  assert.equal(lp.background, "assets/themes/linkin-park/background.webp");
  assert.deepEqual(Object.keys(lp), [...ASSET_KEYS], "all keys present, safe to destructure");
});

test("configuration is frozen (read-only)", () => {
  assert.throws(() => { THEME_ASSETS.batman.logo = "x"; }, TypeError);
  assert.throws(() => { getThemeAssets("batman").hero = "x"; }, TypeError);
  assert.throws(() => { THEME_IDS.push("x"); }, TypeError);
});

test("themeAssets.js is pure: no imports, no DOM, no network, no Firebase", () => {
  const code = readFileSync(resolve(here, "..", "themeAssets.js"), "utf8").replace(/\/\/.*$/gm, "");

  assert.ok(!/^\s*import\s/m.test(code));
  for (const forbidden of ["document", "window", "localStorage", "fetch(", "firebase", "http://", "https://"]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }
});
