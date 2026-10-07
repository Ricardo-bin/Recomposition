// ============================================================================
// RECOMPOSITION — SERVICE WORKER (app shell only)
// ----------------------------------------------------------------------------
// Makes the app open without a connection. It caches STATIC CODE AND ASSETS
// only. It never touches Firebase / Firestore / Auth network traffic (those
// requests are not intercepted at all), and it stores no user data, tokens or
// credentials. Workout data lives in localStorage (see logWorkout.js).
//
// Bump CACHE_VERSION to ship a new shell; old caches are deleted on activate.
// ============================================================================

const CACHE_VERSION = "v1";
const CACHE = `recomposition-shell-${CACHE_VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "style.css",
  "favicon.ico",
  "theme.js",
  "themeAssets.js",
  "navigation.js",
  "dashboard.js",
  "profile.js",
  "workout.js",
  "workoutPlanEditor.js",
  "logWorkout.js",
  "pendingWorkouts.js",
  "workoutLogStatus.js",
  "historyView.js",
  "history.js",
  "progress.js",
  "progressMetrics.js",
  "goals.js",
  "activeGoal.js",
  "auth.js",
  "settings.js",
  "firebase.js",
  "units.js",
  "currentWeight.js",
  "nutritionEngine.js",
  "alternativeToday.js",
  "exercisePicker.js",
  "exercisePickerUI.js",
  "smartAlternatives.js",
  "data/recompositionData.js",
  "data/exerciseLibrary.js",
  "data/exercise-library.v1.json",
  "assets/fonts/ChakraPetch-Medium.ttf",
  "assets/fonts/ChakraPetch-Regular.ttf",
  "assets/fonts/ChakraPetch-SemiBold.ttf",
  "assets/fonts/batmfa__.ttf",
  "assets/fonts/batmfo__.ttf",
  "assets/pwa/icon-192.png",
  "assets/pwa/icon-512.png",
  "assets/pwa/apple-touch-icon.png"
];

// Pinned Firebase SDK files (code only), cached at install so the very first
// offline start works. Keep the version in sync with firebase.js.
const SDK = [
  "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js"
];

// Static, versioned third-party code the app needs to start. Responses are
// code only; Firebase DATA requests go to other hosts and are never cached.
const CODE_HOSTS = [
  { host: "www.gstatic.com", prefix: "/firebasejs/" },
  { host: "cdn.sheetjs.com", prefix: "/" }
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // One missing file must not break the install.
      Promise.all([...SHELL, ...SDK].map(url => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("recomposition-shell-") && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isCodeHost(url) {
  return CODE_HOSTS.some(
    rule => url.hostname === rule.host && url.pathname.startsWith(rule.prefix)
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (request.mode === "navigate" ? await cache.match("index.html") : null);

    if (cached) {
      return cached;
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  // Opaque (no-cors script) responses are fine to keep: they are code.
  if (response && (response.ok || response.type === "opaque")) {
    cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (isCodeHost(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else cross-origin (Firestore, Auth, ...) is left alone.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Own files: fresh when online, cached shell when offline.
  event.respondWith(networkFirst(request));
});
