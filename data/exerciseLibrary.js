// ============================================================================
// RECOMPOSITION — EXERCISE LIBRARY MODULE
// ----------------------------------------------------------------------------
// Read-only access to the curated exercise library (data/exercise-library.v1.json).
//
// UI and feature code must use this API and never read the JSON file directly,
// so the data source can change later (for example to Firestore) without
// touching callers.
//
// Design notes
//   - The file is loaded once, indexed once, and cached in memory.
//   - All data handed out is deeply frozen: callers cannot change the library.
//     Returned arrays are frozen too; copy them ([...result]) before sorting.
//   - Every query is async and loads the library on first use, so callers can
//     never forget to "load" it first.
//   - getExercise(id) also returns DEPRECATED exercises, so old workout logs
//     always resolve. Search and list queries hide deprecated exercises unless
//     { includeDeprecated: true } is passed.
//   - This module knows nothing about workouts, plans, logs or Firebase.
// ============================================================================

const SUPPORTED_SCHEMA_VERSION = 1;

const LIBRARY_FILE = "./exercise-library.v1.json";

const DEFAULT_SEARCH_LIMIT = 20;


// ============================================================================
// TEXT NORMALISATION
// ----------------------------------------------------------------------------
// Case-, punctuation- and spacing-insensitive. Identical to the rule used by
// scripts/validate-exercise-library.mjs, so the validator's "no colliding names
// or aliases" guarantee applies to exactly what search compares.
// ============================================================================

export function normalizeExerciseText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


// ============================================================================
// DEFAULT LOADER (browser)
// ============================================================================

async function fetchLibraryJson() {
  const response = await fetch(
    new URL(LIBRARY_FILE, import.meta.url)
  );

  if (!response.ok) {
    throw new Error(
      `Exercise library request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}


// ============================================================================
// HELPERS
// ============================================================================

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }

  return value;
}

function pushTo(map, key, value) {
  if (!map.has(key)) {
    map.set(key, []);
  }

  map.get(key).push(value);
}

function freezeIndex(map) {
  for (const list of map.values()) {
    Object.freeze(list);
  }

  return map;
}

const EMPTY = Object.freeze([]);


// ============================================================================
// FACTORY
// ----------------------------------------------------------------------------
// createExerciseLibrary({ loadJson }) builds an independent library instance.
// The app uses the default instance exported at the bottom of this file;
// tests create their own instances with a fake loader.
// ============================================================================

export function createExerciseLibrary({
  loadJson = fetchLibraryJson
} = {}) {

  let loadPromise = null;

  // --------------------------------------------------------------------------
  // BUILD (runs once per successful load)
  // --------------------------------------------------------------------------

  function buildLibrary(raw) {

    if (!raw || typeof raw !== "object" || !Array.isArray(raw.exercises)) {
      throw new Error("Exercise library is malformed: missing exercises array.");
    }

    if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported exercise library schemaVersion ${raw.schemaVersion} ` +
        `(this app supports ${SUPPORTED_SCHEMA_VERSION}).`
      );
    }

    const data = deepFreeze(raw);

    const exercises = data.exercises;

    const byId = new Map();
    const byText = new Map();            // normalised name/alias -> exercise
    const searchEntries = [];
    const primaryByMuscle = new Map();
    const secondaryByMuscle = new Map();
    const byPattern = new Map();
    const byEquipment = new Map();

    for (const exercise of exercises) {

      byId.set(exercise.id, exercise);

      // Names / aliases
      const nameNorm = normalizeExerciseText(exercise.name);
      const aliasNorms = exercise.aliases.map(normalizeExerciseText);

      byText.set(nameNorm, exercise);

      for (const alias of aliasNorms) {
        // The validator guarantees uniqueness; first claim wins defensively.
        if (!byText.has(alias)) {
          byText.set(alias, exercise);
        }
      }

      searchEntries.push({ exercise, nameNorm, aliasNorms });

      // Indexes
      for (const muscle of exercise.primaryMuscles) {
        pushTo(primaryByMuscle, muscle, exercise);
      }

      for (const muscle of exercise.secondaryMuscles) {
        pushTo(secondaryByMuscle, muscle, exercise);
      }

      pushTo(byPattern, exercise.movementPattern, exercise);

      for (const item of exercise.equipment) {
        pushTo(byEquipment, item, exercise);
      }
    }

    freezeIndex(primaryByMuscle);
    freezeIndex(secondaryByMuscle);
    freezeIndex(byPattern);
    freezeIndex(byEquipment);

    return Object.freeze({
      data,
      exercises,
      byId,
      byText,
      searchEntries,
      primaryByMuscle,
      secondaryByMuscle,
      byPattern,
      byEquipment
    });
  }

  // --------------------------------------------------------------------------
  // LOAD + CACHE
  // --------------------------------------------------------------------------

  function load() {
    if (!loadPromise) {
      loadPromise = Promise.resolve()
        .then(() => loadJson())
        .then(buildLibrary)
        .catch(error => {
          // Do not cache a failure: the next call retries.
          loadPromise = null;
          throw error;
        });
    }

    return loadPromise;
  }

  const visible = (list, includeDeprecated) =>
    includeDeprecated
      ? list
      : list.filter(exercise => exercise.status !== "deprecated");

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  // Loads (once) and returns basic library info.
  async function loadExerciseLibrary() {
    const library = await load();

    return Object.freeze({
      schemaVersion: library.data.schemaVersion,
      libraryVersion: library.data.libraryVersion,
      exerciseCount: library.exercises.length
    });
  }

  // Exercise by permanent id, or null. Includes deprecated exercises.
  async function getExercise(id) {
    const library = await load();

    return library.byId.get(id) ?? null;
  }

  // Several ids at once. Unknown ids are skipped; order follows `ids`.
  async function getExercises(ids) {
    const library = await load();

    return Object.freeze(
      (Array.isArray(ids) ? ids : [])
        .map(id => library.byId.get(id))
        .filter(Boolean)
    );
  }

  // Every exercise, in library order.
  async function getAllExercises({ includeDeprecated = false } = {}) {
    const library = await load();

    return Object.freeze(
      visible(library.exercises, includeDeprecated)
    );
  }

  // Exact match (after normalisation) on a name or alias, or null.
  // Intended for linking legacy free-text names, e.g. "Cable crunches".
  async function findExerciseByName(text) {
    const library = await load();

    const key = normalizeExerciseText(text);

    return key ? (library.byText.get(key) ?? null) : null;
  }

  // Ranked search over names and aliases.
  //   1 exact name, 2 exact alias, 3 name starts with, 4 alias starts with,
  //   5 every word found in the name, 6 every word found in one alias,
  //   7 words spread across the name and aliases.
  // Ties keep a stable alphabetical order. Tier is deliberately not used.
  async function searchExercises(
    query,
    { limit = DEFAULT_SEARCH_LIMIT, includeDeprecated = false } = {}
  ) {
    const library = await load();

    const q = normalizeExerciseText(query);

    if (!q) {
      return EMPTY;
    }

    const tokens = q.split(" ");

    const results = [];

    for (const entry of library.searchEntries) {

      if (!includeDeprecated && entry.exercise.status === "deprecated") {
        continue;
      }

      let rank = null;

      const matchesAll = text =>
        tokens.every(token => text.includes(token));

      if (entry.nameNorm === q) {
        rank = 1;
      } else if (entry.aliasNorms.includes(q)) {
        rank = 2;
      } else if (entry.nameNorm.startsWith(q)) {
        rank = 3;
      } else if (entry.aliasNorms.some(alias => alias.startsWith(q))) {
        rank = 4;
      } else if (matchesAll(entry.nameNorm)) {
        rank = 5;
      } else if (entry.aliasNorms.some(matchesAll)) {
        rank = 6;
      } else if (
        matchesAll([entry.nameNorm, ...entry.aliasNorms].join(" "))
      ) {
        rank = 7;
      }

      if (rank !== null) {
        results.push({ rank, exercise: entry.exercise });
      }
    }

    results.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.exercise.name.localeCompare(b.exercise.name)
    );

    const max = Number.isInteger(limit) && limit > 0
      ? limit
      : DEFAULT_SEARCH_LIMIT;

    return Object.freeze(
      results.slice(0, max).map(result => result.exercise)
    );
  }

  // Exercises that train a muscle.
  //   role: "primary" (default) | "secondary" | "any"
  async function getExercisesByMuscle(
    muscle,
    { role = "primary", includeDeprecated = false } = {}
  ) {
    const library = await load();

    const primary = library.primaryByMuscle.get(muscle) ?? EMPTY;
    const secondary = library.secondaryByMuscle.get(muscle) ?? EMPTY;

    let list;

    if (role === "secondary") {
      list = secondary;
    } else if (role === "any") {
      const ids = new Set(primary.map(exercise => exercise.id));
      list = [...primary, ...secondary.filter(e => !ids.has(e.id))];
    } else {
      list = primary;
    }

    return Object.freeze(visible(list, includeDeprecated));
  }

  // Exercises of one movement pattern.
  async function getExercisesByMovementPattern(
    pattern,
    { includeDeprecated = false } = {}
  ) {
    const library = await load();

    return Object.freeze(
      visible(library.byPattern.get(pattern) ?? EMPTY, includeDeprecated)
    );
  }

  // Exercises that REQUIRE a given piece of equipment.
  async function getExercisesByEquipment(
    equipment,
    { includeDeprecated = false } = {}
  ) {
    const library = await load();

    return Object.freeze(
      visible(library.byEquipment.get(equipment) ?? EMPTY, includeDeprecated)
    );
  }

  // Exercises doable with ONLY the given equipment (every requirement met).
  // Honors the library's equipmentSatisfiedBy rules, e.g. an adjustable bench
  // satisfies a bench requirement. Foundation for later equipment filtering.
  async function getExercisesAvailableWith(
    availableEquipment,
    { includeDeprecated = false } = {}
  ) {
    const library = await load();

    const owned = new Set(
      Array.isArray(availableEquipment) ? availableEquipment : []
    );

    const satisfiedBy = library.data.equipmentSatisfiedBy || {};

    const hasRequirement = required =>
      owned.has(required) ||
      (satisfiedBy[required] || []).some(provider => owned.has(provider));

    return Object.freeze(
      visible(library.exercises, includeDeprecated).filter(exercise =>
        exercise.equipment.every(hasRequirement)
      )
    );
  }

  // The controlled vocabularies (muscles, equipment, patterns, ...).
  async function getVocabularies() {
    const library = await load();

    return library.data.vocabularies;
  }

  return Object.freeze({
    loadExerciseLibrary,
    getExercise,
    getExercises,
    getAllExercises,
    findExerciseByName,
    searchExercises,
    getExercisesByMuscle,
    getExercisesByMovementPattern,
    getExercisesByEquipment,
    getExercisesAvailableWith,
    getVocabularies
  });
}


// ============================================================================
// DEFAULT INSTANCE (what the app imports)
// ============================================================================

const defaultLibrary = createExerciseLibrary();

export const {
  loadExerciseLibrary,
  getExercise,
  getExercises,
  getAllExercises,
  findExerciseByName,
  searchExercises,
  getExercisesByMuscle,
  getExercisesByMovementPattern,
  getExercisesByEquipment,
  getExercisesAvailableWith,
  getVocabularies
} = defaultLibrary;
