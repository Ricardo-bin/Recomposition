// ============================================================================
// RECOMPOSITION — THEME ASSET CONFIGURATION (pure data, no DOM)
// ----------------------------------------------------------------------------
// The ONE place that names every theme-specific image. Components never hardcode
// theme image paths; they ask for an asset by key ("logo", "hero", ...).
//
//   BATMAN DARK        -> assets/themes/batman/...
//   LINKIN PARK LIGHT  -> assets/themes/linkin-park/...
//
// Paths are relative to index.html and reference LOCAL files only. Drop your
// files into the folders (see assets/themes/README.md); nothing else to edit.
// A theme only ever resolves its OWN folder: a missing Linkin Park file is never
// replaced with a Batman one, or the other way round.
//
// To keep a not-yet-provided asset from being requested at all, set it to null.
// ============================================================================

export const THEME_IDS = Object.freeze(["batman", "linkin-park"]);

export const DEFAULT_THEME = "batman";

// What each theme is called in the UI later (e.g. a Theme settings screen).
export const THEME_LABELS = Object.freeze({
  "batman": "Batman Dark",
  "linkin-park": "Linkin Park Light"
});

// logo is vector (SVG); the artwork is WebP (small, mobile-friendly).
export const ASSET_FILES = Object.freeze({
  logo: "logo.svg",
  hero: "hero.webp",
  dashboard: "dashboard.webp",
  profile: "profile.webp",
  background: "background.webp",
  decorative: "decorative.webp",
  texture: "texture.webp"
});

export const ASSET_KEYS = Object.freeze(Object.keys(ASSET_FILES));

const BASE = "assets/themes";

const forTheme = themeId =>
  Object.freeze(
    Object.fromEntries(
      ASSET_KEYS.map(key => [key, `${BASE}/${themeId}/${ASSET_FILES[key]}`])
    )
  );

export const THEME_ASSETS = Object.freeze({
  "batman": forTheme("batman"),
  "linkin-park": forTheme("linkin-park")
});

// Unknown / missing ids resolve to the default theme (never to the other one).
export function normalizeThemeId(value, themes = THEME_ASSETS) {
  return typeof value === "string" && Object.hasOwn(themes, value)
    ? value
    : DEFAULT_THEME;
}

// Every key for one theme: the URL, or null when that asset is not provided.
// Always returns all keys, so callers can destructure safely.
export function getThemeAssets(themeId, themes = THEME_ASSETS) {
  const own = themes[normalizeThemeId(themeId, themes)] ?? {};

  return Object.freeze(
    Object.fromEntries(
      ASSET_KEYS.map(key => [
        key,
        typeof own[key] === "string" && own[key] ? own[key] : null
      ])
    )
  );
}
