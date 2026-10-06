// ============================================================================
// RECOMPOSITION — THEME STATE + THEME ASSET BINDING (framework-free)
// ----------------------------------------------------------------------------
// This app has no framework, so this is the plain-JS equivalent of a theme
// context + a useThemeAssets() hook:
//
//   theme.get() / theme.set(id)        the ONE theme state
//   theme.assets()                     assets of the active theme
//   theme.watch(callback)              like useThemeAssets(): runs now and again
//                                      on every theme change; returns unsubscribe
//   <img data-theme-asset="logo">      binds an element to an asset (also for
//                                      elements added to the page later)
//   --theme-asset-<key>                CSS variables: url("...") or none
//
// Switching the theme re-binds everything. No business logic, Firebase or user
// data is involved: the preference is a device setting in localStorage.
//
// A missing or broken asset never throws and never shows a broken-image icon:
// the element stays hidden (data-theme-asset-state="missing"), the CSS variable
// is `none`, and the page keeps its normal look.
// ============================================================================

import {
  DEFAULT_THEME,
  THEME_ASSETS,
  ASSET_KEYS,
  normalizeThemeId,
  getThemeAssets,
  onlyProvidedAssets
} from "./themeAssets.js";

export const THEME_STORAGE_KEY = "recomposition.theme.v1";

export const THEME_CHANGED_EVENT = "recomposition-theme-changed";

const SELECTOR = "[data-theme-asset]";

export function createThemeManager({
  themes = THEME_ASSETS,
  storage = globalThis.localStorage,
  doc = globalThis.document,
  win = globalThis.window
} = {}) {

  let current = DEFAULT_THEME;
  let observer = null;

  const bound = new WeakSet();
  const watchers = new Set();

  // ---- storage (a failure must never break the app) -----------------------------
  const readStored = () => {
    try {
      return storage?.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };

  const writeStored = id => {
    try {
      storage?.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* private mode / storage disabled: the theme still works for this session */
    }
  };

  const assets = () => getThemeAssets(current, themes);

  // ---- one element --------------------------------------------------------------
  function markMissing(element) {
    element.hidden = true;
    element.dataset.themeAssetState = "missing";

    if (element.localName === "img") {
      element.removeAttribute("src");   // never keep showing the previous theme's image
    }
  }

  function bindElement(element) {
    if (!element?.dataset) return;

    const url = assets()[element.dataset.themeAsset] ?? null;

    if (element.localName !== "img") {
      // Non-image elements can use the CSS variables; just expose the state.
      element.dataset.themeAssetState = url ? "available" : "missing";
      return;
    }

    if (!bound.has(element)) {
      bound.add(element);

      element.addEventListener("load", () => {
        // Ignore a late answer for a previous theme's request.
        if (element.getAttribute("src") !== (assets()[element.dataset.themeAsset] ?? null)) return;

        element.hidden = false;
        element.dataset.themeAssetState = "loaded";
      });

      element.addEventListener("error", () => {
        if (element.getAttribute("src") !== (assets()[element.dataset.themeAsset] ?? null)) return;

        markMissing(element);
      });
    }

    if (!url) {
      markMissing(element);
      return;
    }

    element.hidden = true;
    element.dataset.themeAssetState = "loading";

    if (element.getAttribute("src") !== url) {
      element.setAttribute("src", url);
    } else if (element.complete && element.naturalWidth > 0) {
      element.hidden = false;
      element.dataset.themeAssetState = "loaded";
    }
  }

  // ---- everything ---------------------------------------------------------------
  function apply(root = doc) {
    if (!doc?.documentElement) return;

    const style = doc.documentElement.style;
    const own = assets();

    for (const key of ASSET_KEYS) {
      style.setProperty(
        `--theme-asset-${key}`,
        own[key] ? `url("${own[key]}")` : "none"
      );
    }

    root?.querySelectorAll?.(SELECTOR).forEach(bindElement);
  }

  function startObserving() {
    if (observer || !win?.MutationObserver || !doc?.body) return;

    // Elements added later (e.g. a re-rendered dashboard) are bound automatically.
    observer = new win.MutationObserver(mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;

          if (node.matches?.(SELECTOR)) bindElement(node);

          node.querySelectorAll?.(SELECTOR).forEach(bindElement);
        });
      }
    });

    observer.observe(doc.body, { childList: true, subtree: true });
  }

  function notify() {
    const detail = { theme: current, assets: assets() };

    watchers.forEach(callback => {
      try {
        callback(detail.assets, detail.theme);
      } catch (error) {
        console.error("Theme watcher failed:", error);
      }
    });

    try {
      win?.dispatchEvent(new win.CustomEvent(THEME_CHANGED_EVENT, { detail }));
    } catch {
      /* no window (tests / non-browser): the watchers above already ran */
    }
  }

  // ---- public API -----------------------------------------------------------------
  const api = {

    // Read the saved theme, mark <html data-theme>, bind assets. Writes nothing.
    init() {
      current = normalizeThemeId(readStored(), themes);

      if (doc?.documentElement) {
        doc.documentElement.dataset.theme = current;
      }

      apply();
      startObserving();

      return current;
    },

    get: () => current,

    // Unknown ids are rejected (returns false) and change nothing.
    set(id) {
      if (typeof id !== "string" || !Object.hasOwn(themes, id)) {
        return false;
      }

      current = id;

      writeStored(id);

      if (doc?.documentElement) {
        doc.documentElement.dataset.theme = id;
      }

      apply();
      notify();

      return true;
    },

    assets,

    // Framework-free "useThemeAssets": runs now, and after every theme change.
    watch(callback) {
      watchers.add(callback);
      callback(assets(), current);

      return () => watchers.delete(callback);
    },

    // Re-scan a container you just rendered (the observer normally does this).
    apply,

    destroy() {
      observer?.disconnect();
      observer = null;
      watchers.clear();
    }
  };

  return Object.freeze(api);
}

// ---- the app's single instance --------------------------------------------------
export const theme = createThemeManager({ themes: onlyProvidedAssets() });

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.RecompositionTheme = theme;

  const start = () => theme.init();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
