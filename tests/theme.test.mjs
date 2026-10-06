// Tests for theme.js (theme state + asset binding) in jsdom.
// Run: node --test tests/*.test.mjs   (DOM tests are skipped if jsdom is missing)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createThemeManager, THEME_STORAGE_KEY, THEME_CHANGED_EVENT } from "../theme.js";
import { THEME_ASSETS, ASSET_KEYS, ASSET_VERSION } from "../themeAssets.js";

// Local artwork is requested as <file>?v=<ASSET_VERSION> (cache-busting).
const V = `?v=${ASSET_VERSION}`;
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));

function setup({ stored, themes = THEME_ASSETS, storage, html = "" } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: "http://localhost/" });
  const { window } = dom;

  const memory = new Map(stored ? [[THEME_STORAGE_KEY, stored]] : []);

  const store = storage ?? {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, value); }
  };

  const manager = createThemeManager({ themes, storage: store, doc: window.document, win: window });

  const img = (key, id = key) => {
    window.document.body.insertAdjacentHTML("beforeend", `<img id="${id}" data-theme-asset="${key}" alt="">`);
    return window.document.getElementById(id);
  };

  const cssVar = key => window.document.documentElement.style.getPropertyValue(`--theme-asset-${key}`);

  return { window, document: window.document, manager, memory, img, cssVar,
    fire: (el, type) => el.dispatchEvent(new window.Event(type)) };
}

// ---- theme state ----------------------------------------------------------------

test("default theme is Batman and <html data-theme> is set; init writes nothing", { skip }, () => {
  const t = setup();

  assert.equal(t.manager.init(), "batman");
  assert.equal(t.manager.get(), "batman");
  assert.equal(t.document.documentElement.dataset.theme, "batman");
  assert.equal(t.memory.size, 0, "reading the preference never writes it");
});

test("a saved valid theme is restored; a corrupt one falls back to the default", { skip }, () => {
  assert.equal(setup({ stored: "linkin-park" }).manager.init(), "linkin-park");

  for (const bad of ["joker", "", "__proto__", "BATMAN"]) {
    assert.equal(setup({ stored: bad }).manager.init(), "batman", bad);
  }
});

test("set() switches theme, persists it, updates <html> and emits one event", { skip }, () => {
  const t = setup();
  t.manager.init();

  const events = [];
  t.window.addEventListener(THEME_CHANGED_EVENT, e => events.push(e.detail.theme));

  assert.equal(t.manager.set("linkin-park"), true);
  assert.equal(t.manager.get(), "linkin-park");
  assert.equal(t.document.documentElement.dataset.theme, "linkin-park");
  assert.equal(t.memory.get(THEME_STORAGE_KEY), "linkin-park");
  assert.deepEqual(events, ["linkin-park"]);
});

test("set() rejects unknown ids and changes nothing", { skip }, () => {
  const t = setup();
  t.manager.init();

  for (const bad of ["joker", "", undefined, null, 3, "__proto__"]) {
    assert.equal(t.manager.set(bad), false, String(bad));
  }

  assert.equal(t.manager.get(), "batman");
  assert.equal(t.memory.size, 0);
});

test("storage that throws (private mode) never breaks the theme", { skip }, () => {
  const t = setup({ storage: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } });

  assert.equal(t.manager.init(), "batman");
  assert.equal(t.manager.set("linkin-park"), true);
  assert.equal(t.manager.get(), "linkin-park");
});

// ---- the "hook" -------------------------------------------------------------------

test("watch() is the framework-free useThemeAssets: runs now and on every change, then unsubscribes", { skip }, () => {
  const t = setup();
  t.manager.init();

  const seen = [];
  const stop = t.manager.watch((assets, id) => seen.push([id, assets.logo]));

  t.manager.set("linkin-park");
  t.manager.set("batman");
  stop();
  t.manager.set("linkin-park");

  assert.deepEqual(seen, [
    ["batman", "assets/themes/batman/logo.svg" + V],
    ["linkin-park", "assets/themes/linkin-park/logo.svg" + V],
    ["batman", "assets/themes/batman/logo.svg" + V]
  ]);
});

test("a throwing watcher cannot break theme switching or other watchers", { skip }, () => {
  const t = setup();
  t.manager.init();

  const calls = [];
  const original = console.error;
  console.error = () => {};

  t.manager.watch((_a, id) => { if (id === "linkin-park") throw new Error("boom"); });
  t.manager.watch((_a, id) => calls.push(id));

  assert.doesNotThrow(() => t.manager.set("linkin-park"));
  console.error = original;

  assert.deepEqual(calls, ["batman", "linkin-park"]);
});

// ---- CSS variables ----------------------------------------------------------------

test("CSS variables hold the ACTIVE theme's artwork and change with the theme", { skip }, () => {
  const t = setup();
  t.manager.init();

  for (const key of ASSET_KEYS) {
    assert.equal(t.cssVar(key), `url("assets/themes/batman/${key === "logo" ? "logo.svg" : key + ".webp"}${V}")`);
  }

  t.manager.set("linkin-park");

  assert.equal(t.cssVar("background"), `url("assets/themes/linkin-park/background.webp${V}")`);
  assert.equal(t.cssVar("logo"), `url("assets/themes/linkin-park/logo.svg${V}")`);
  assert.ok(!t.cssVar("hero").includes("batman"));
});

test("a missing asset becomes `none` (normal theme background), not another theme's file", { skip }, () => {
  const themes = { ...THEME_ASSETS, "linkin-park": { ...THEME_ASSETS["linkin-park"], background: null, decorative: null } };
  const t = setup({ themes });
  t.manager.init();
  t.manager.set("linkin-park");

  assert.equal(t.cssVar("background"), "none");
  assert.equal(t.cssVar("decorative"), "none");
  assert.match(t.cssVar("hero"), /linkin-park\/hero\.webp/);
});

// ---- <img data-theme-asset> ---------------------------------------------------------

test("an image binds to the active theme's file and stays hidden until it really loads", { skip }, () => {
  const t = setup();
  const logo = t.img("logo");
  t.manager.init();

  assert.equal(logo.getAttribute("src"), "assets/themes/batman/logo.svg" + V);
  assert.equal(logo.hidden, true, "no broken-image icon while loading");
  assert.equal(logo.dataset.themeAssetState, "loading");

  t.fire(logo, "load");

  assert.equal(logo.hidden, false);
  assert.equal(logo.dataset.themeAssetState, "loaded");
});

test("switching the theme swaps the image automatically (no component code involved)", { skip }, () => {
  const t = setup();
  const logo = t.img("logo");
  const hero = t.img("hero");
  t.manager.init();
  t.fire(logo, "load");

  t.manager.set("linkin-park");

  assert.equal(logo.getAttribute("src"), "assets/themes/linkin-park/logo.svg" + V);
  assert.equal(hero.getAttribute("src"), "assets/themes/linkin-park/hero.webp" + V);
  assert.equal(logo.hidden, true, "hidden again until the new file loads");

  t.fire(logo, "load");
  assert.equal(logo.hidden, false);

  t.manager.set("batman");
  assert.equal(logo.getAttribute("src"), "assets/themes/batman/logo.svg" + V);
});

test("a file that fails to load hides the element; it is NEVER replaced by the other theme's file", { skip }, () => {
  const t = setup();
  const hero = t.img("hero");
  t.manager.init();
  t.manager.set("linkin-park");

  t.fire(hero, "error");

  assert.equal(hero.hidden, true);
  assert.equal(hero.dataset.themeAssetState, "missing");
  assert.equal(hero.hasAttribute("src"), false, "no stale or foreign image left behind");
  assert.ok(!(hero.getAttribute("src") ?? "").includes("batman"));
});

test("asset configured as null: element is hidden and never requested", { skip }, () => {
  const themes = { ...THEME_ASSETS, "linkin-park": { ...THEME_ASSETS["linkin-park"], logo: null } };
  const t = setup({ themes });
  const logo = t.img("logo");
  t.manager.init();

  t.manager.set("linkin-park");

  assert.equal(logo.hidden, true);
  assert.equal(logo.dataset.themeAssetState, "missing");
  assert.equal(logo.hasAttribute("src"), false);

  t.manager.set("batman");
  assert.equal(logo.getAttribute("src"), "assets/themes/batman/logo.svg" + V, "and it comes back when a theme provides it");
});

test("a late load event from the PREVIOUS theme is ignored", { skip }, () => {
  const t = setup();
  const hero = t.img("hero");
  t.manager.init();

  t.manager.set("linkin-park");
  hero.setAttribute("src", "assets/themes/batman/hero.webp");   // pretend the old request answers late
  t.fire(hero, "load");

  assert.equal(hero.hidden, true);
  assert.notEqual(hero.dataset.themeAssetState, "loaded");
});

test("an unknown asset key hides the element without throwing", { skip }, () => {
  const t = setup();
  const odd = t.img("not-a-real-asset", "odd");

  assert.doesNotThrow(() => t.manager.init());
  assert.equal(odd.hidden, true);
  assert.equal(odd.dataset.themeAssetState, "missing");
});

test("non-image elements get a state flag so CSS can react", { skip }, () => {
  const t = setup({ html: `<div id="panel" data-theme-asset="decorative"></div>` });
  t.manager.init();

  assert.equal(t.document.getElementById("panel").dataset.themeAssetState, "available");

  const themes = { ...THEME_ASSETS, "linkin-park": { ...THEME_ASSETS["linkin-park"], decorative: null } };
  const u = setup({ themes, html: `<div id="panel" data-theme-asset="decorative"></div>` });
  u.manager.init();
  u.manager.set("linkin-park");

  assert.equal(u.document.getElementById("panel").dataset.themeAssetState, "missing");
});

// ---- elements added later (re-rendered screens) ------------------------------------------

test("elements added after init are bound automatically and follow later theme switches", { skip }, async () => {
  const t = setup();
  t.manager.init();

  t.document.body.insertAdjacentHTML("beforeend", `<section><img id="late" data-theme-asset="dashboard" alt=""></section>`);
  await settle();

  const late = t.document.getElementById("late");

  assert.equal(late.getAttribute("src"), "assets/themes/batman/dashboard.webp" + V);

  t.manager.set("linkin-park");

  assert.equal(late.getAttribute("src"), "assets/themes/linkin-park/dashboard.webp" + V);
});

test("destroy() stops observing and notifying", { skip }, async () => {
  const t = setup();
  t.manager.init();
  const calls = [];
  t.manager.watch((_a, id) => calls.push(id));

  t.manager.destroy();
  t.document.body.insertAdjacentHTML("beforeend", `<img id="after" data-theme-asset="hero" alt="">`);
  await settle();

  assert.equal(t.document.getElementById("after").hasAttribute("src"), false);
  t.manager.set("linkin-park");
  assert.deepEqual(calls, ["batman"]);
});

// ---- scope guards ---------------------------------------------------------------------------

test("theme.js touches no business logic, Firebase, or user data", () => {
  const code = readFileSync(resolve(here, "..", "theme.js"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.deepEqual([...code.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)].map(m => m[1]), ["./themeAssets.js"]);

  for (const forbidden of ["firebase", "firestore", "getProfile", "saveGoal", "workout", "sessionStorage", "fetch(", "http://", "https://"]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }
});

test("no application module imports the theme files (no logic coupling)", () => {
  for (const file of ["dashboard.js", "workout.js", "logWorkout.js", "history.js", "progress.js", "goals.js", "settings.js", "profile.js", "auth.js", "navigation.js", "nutritionEngine.js", "currentWeight.js"]) {
    const path = resolve(here, "..", file);

    if (!existsSync(path)) continue;          // present in your project, absent from some checkouts

    assert.ok(!/theme\.js|themeAssets\.js/.test(readFileSync(path, "utf8")), file);
  }
});

test("index.html loads theme.js as a module", () => {
  const html = readFileSync(resolve(here, "..", "index.html"), "utf8");

  assert.match(html, /<script\s+type="module"\s+src="theme\.js"\s*><\/script>/);
});
