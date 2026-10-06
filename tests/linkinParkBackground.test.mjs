// ============================================================================
// Linkin Park Light background artwork (portrait) + asset cache-busting.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSET_FILES,
  ASSET_KEYS,
  ASSET_VERSION,
  PROVIDED_ASSETS,
  THEME_ASSETS,
  getThemeAssets,
  withAssetVersion
} from "../themeAssets.js";
import { createThemeManager } from "../theme.js";
import { loadJSDOM, SKIP_MESSAGE } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "style.css"), "utf8");

// The rule text of one selector (first match, comments removed).
const rule = (selector, source = css) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  assert.ok(match, `rule ${selector} exists`);

  return match[1];
};

const LP_RULE = rule('[data-theme="linkin-park"] body::before');


// ---- the seven-slot architecture is untouched -----------------------------------------------

test("still exactly seven slots, same names, same files", () => {
  assert.deepEqual(ASSET_KEYS, ["logo", "hero", "dashboard", "profile", "background", "decorative", "texture"]);
  assert.equal(ASSET_FILES.background, "background.webp");
  assert.equal(THEME_ASSETS["linkin-park"].background, "assets/themes/linkin-park/background.webp");
  assert.ok(PROVIDED_ASSETS["linkin-park"].includes("background"));
});

test("the background file exists on disk and is a real WebP", () => {
  const file = resolve(root, "assets/themes/linkin-park/background.webp");

  assert.ok(existsSync(file));

  const bytes = readFileSync(file);

  assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP");
});


// ---- cache-busting: a replaced file is actually requested again -------------------------------

test("local artwork URLs carry a version so a replaced file is re-fetched", () => {
  assert.match(ASSET_VERSION, /^[\w.-]+$/);
  assert.equal(withAssetVersion("assets/x.webp", "7"), "assets/x.webp?v=7");
  assert.equal(withAssetVersion("assets/x.webp?a=1", "7"), "assets/x.webp?a=1&v=7");
  assert.equal(withAssetVersion(null), null);
  assert.equal(withAssetVersion(""), null);
});

test("bumping the version changes the URL the browser requests (not just the file)", { skip }, () => {
  const dom = new JSDOM("<html><body></body></html>", { url: "http://localhost/" });

  const manager = createThemeManager({ doc: dom.window.document, win: dom.window, storage: null });

  manager.init?.();
  manager.set("linkin-park");

  const style = dom.window.document.documentElement.style;
  const url = style.getPropertyValue("--theme-asset-background");

  assert.equal(url, `url("assets/themes/linkin-park/background.webp?v=${ASSET_VERSION}")`);
  assert.notEqual(url, `url("${getThemeAssets("linkin-park").background}")`, "never the bare, cacheable URL");

  const bumped = withAssetVersion("assets/themes/linkin-park/background.webp", "next");

  assert.notEqual(`url("${bumped}")`, url);
});

test("each theme still resolves only its own folder", () => {
  for (const id of ["batman", "linkin-park"]) {
    for (const url of Object.values(getThemeAssets(id)).filter(Boolean)) {
      assert.ok(url.startsWith(`assets/themes/${id}/`), url);
    }
  }
});


// ---- CSS: the old wide-band behaviour is gone ------------------------------------------------------

test("the background is no longer a 320px band sized for a wide image", () => {
  assert.doesNotMatch(LP_RULE, /height:\s*320px/);
  assert.doesNotMatch(LP_RULE, /background-size:\s*100%\s*auto/);
  assert.doesNotMatch(LP_RULE, /background-position:\s*100%\s*0/);
  assert.doesNotMatch(LP_RULE, /bottom:\s*auto/);
});

test("portrait artwork: controlled cover from the top, faint, faded, behind the UI", () => {
  assert.match(LP_RULE, /background-image:\s*var\(--theme-asset-background/);
  assert.match(LP_RULE, /background-size:\s*cover/);
  assert.match(LP_RULE, /background-position:\s*50%\s*0/);
  assert.match(LP_RULE, /mix-blend-mode:\s*multiply/);
  assert.match(LP_RULE, /mask-image:\s*linear-gradient/);

  const opacity = Number(LP_RULE.match(/opacity:\s*([\d.]+)/)[1]);

  assert.ok(opacity > 0 && opacity <= 0.25, `subtle (opacity ${opacity})`);
});

test("the layer is fixed, inset 0, non-interactive and below the app (no overflow, no obstruction)", () => {
  const shared = css.match(/body::before,\s*body::after\s*\{([^}]*)\}/)[1];

  assert.match(shared, /position:\s*fixed/);
  assert.match(shared, /inset:\s*0/);
  assert.match(shared, /pointer-events:\s*none/);

  const base = rule("body::before");

  assert.match(base, /z-index:\s*0/);
  assert.ok(/\.app-shell\s*\{[^}]*z-index:\s*1/.test(css), "app shell sits above the artwork layer");
});

test("wide screens use a side panel instead of blowing a portrait image up", () => {
  const media = css.match(/@media \(min-width: 768px\)\s*\{\s*\[data-theme="linkin-park"\] body::before\s*\{([^}]*)\}/);

  assert.ok(media, "desktop rule exists");
  assert.match(media[1], /left:\s*auto/);
  assert.match(media[1], /width:\s*min\(520px,\s*42vw\)/);
});

test("Batman Dark's background rule is unchanged", () => {
  const batman = rule('[data-theme="batman"] body::before');

  assert.match(batman, /background-size:\s*cover/);
  assert.match(batman, /opacity:\s*0\.3/);
});


// ---- geometry on real phone sizes ---------------------------------------------------------------------

// CSS `background-size: cover; background-position: 50% 0` for an image in a box.
function cover(box, image) {
  const scale = Math.max(box.w / image.w, box.h / image.h);
  const w = image.w * scale;
  const h = image.h * scale;

  return { w, h, x: (box.w - w) * 0.5, y: 0, scale, visibleShare: Math.min(1, box.h / h) };
}

const PORTRAIT = { w: 852, h: 1846 };
const OLD_WIDE = { w: 728, h: 399 };

for (const [w, h] of [[390, 844], [393, 852], [430, 932]]) {
  test(`${w} x ${h}: the portrait image fills the screen with almost no cropping and no overflow`, () => {
    const placed = cover({ w, h }, PORTRAIT);

    // The layer is exactly the viewport wide (fixed, inset 0), so the page cannot scroll sideways.
    assert.ok(placed.w >= w);
    assert.ok(placed.h >= h);
    assert.ok(placed.visibleShare > 0.97, `${Math.round(placed.visibleShare * 100)}% of the artwork is visible`);
    assert.ok(Math.abs(placed.w - w) < 12, "side crop is a few pixels at most");
    assert.ok(placed.scale < 0.6, "downscaled, never enlarged (stays sharp)");
  });
}

test("for contrast: the OLD wide image would have been enlarged ~2x and mostly cropped on a phone", () => {
  const placed = cover({ w: 393, h: 852 }, OLD_WIDE);

  assert.ok(placed.scale > 2);
  assert.ok(placed.w / 393 > 3, "under a third of its width would show");
});
