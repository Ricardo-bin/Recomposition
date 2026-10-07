// ============================================================================
// RECOMPOSITION — EXERCISE PICKER HELPERS
// ----------------------------------------------------------------------------
// Pure, DOM-free logic for linking a workout-plan exercise to the Exercise
// Library. The picker UI (a later step) calls these helpers; they never touch
// the page, Firebase or the library file.
//
// TWO DIFFERENT IDS — this distinction is permanent:
//
//   exercise.id                = the PLAN SLOT id (random UUID, created once)
//   exercise.libraryExerciseId = the Exercise Library identity (optional)
//
// Rules enforced here:
//   - `id` is never changed, added or removed by any helper.
//   - Only an EXPLICIT library selection links an exercise.
//   - Changing the name text by hand UNLINKS it (it becomes a custom exercise).
//   - Helpers never mutate their arguments; they return new objects.
//   - An unlinked exercise has NO libraryExerciseId key at all (Firestore
//     rejects `undefined`, and legacy plans must stay byte-for-byte similar).
// ============================================================================

import { normalizeExerciseText } from "./data/exerciseLibrary.js";

// Search is never truncated: the list scrolls inside the picker. Pass this as
// the library search `limit` (a huge integer) so every match is returned.
export const PICKER_SEARCH_LIMIT = Number.MAX_SAFE_INTEGER;


// ----------------------------------------------------------------------------
// CATEGORIES (simple browse filter). Derived from the FIRST primary muscle, so
// no new schema field is needed and every exercise has exactly one category.
// ----------------------------------------------------------------------------

export const PICKER_CATEGORIES = Object.freeze([
  "ALL", "CHEST", "BACK", "SHOULDERS", "ARMS", "LEGS", "CORE"
]);

const MUSCLE_CATEGORY = Object.freeze({
  chest: "CHEST",
  lats: "BACK",
  "upper-back": "BACK",
  traps: "BACK",
  "lower-back": "BACK",
  "front-delts": "SHOULDERS",
  "side-delts": "SHOULDERS",
  "rear-delts": "SHOULDERS",
  biceps: "ARMS",
  triceps: "ARMS",
  forearms: "ARMS",
  quadriceps: "LEGS",
  hamstrings: "LEGS",
  glutes: "LEGS",
  adductors: "LEGS",
  calves: "LEGS",
  "tibialis-anterior": "LEGS",
  abs: "CORE",
  obliques: "CORE",
  "hip-flexors": "CORE"
});

// "CHEST" | "BACK" | ... or null when the exercise has no known muscle.
export function getExerciseCategory(libraryExercise) {
  const first = libraryExercise?.primaryMuscles?.[0];

  return MUSCLE_CATEGORY[first] ?? null;
}

// Keeps library order. "ALL" (or an unknown category) returns every exercise.
export function filterByCategory(exercises, category) {
  const list = Array.isArray(exercises) ? exercises : [];

  if (!PICKER_CATEGORIES.includes(category) || category === "ALL") {
    return list;
  }

  return list.filter(exercise => getExerciseCategory(exercise) === category);
}


// ----------------------------------------------------------------------------
// LINK STATE
// ----------------------------------------------------------------------------

const isNonEmptyString = value =>
  typeof value === "string" && value.trim().length > 0;

// True when the plan exercise carries a library link.
export function isLinked(planExercise) {
  return isNonEmptyString(planExercise?.libraryExerciseId);
}

// A plain object to spread into the saved exercise:
//   { ...base, ...libraryLinkField(exercise) }
// Linked   -> { libraryExerciseId: "barbell-back-squat" }
// Unlinked -> {}   (the key is omitted entirely, never undefined)
export function libraryLinkField(planExercise) {
  return isLinked(planExercise)
    ? { libraryExerciseId: planExercise.libraryExerciseId }
    : {};
}


// ----------------------------------------------------------------------------
// LINKING / UNLINKING
// ----------------------------------------------------------------------------

// EXPLICIT library selection. Replaces the name with the library's canonical
// name and sets libraryExerciseId. Everything else (including the
// prescription: sets, reps, RIR, rest, notes) is preserved.
//
// IDENTITY: `id` is the plan SLOT id; workout logs and Progress group by it. When
// the slot was linked to a DIFFERENT library exercise, this is a new exercise, so
// it gets a NEW slot id (old logs keep the old id and stay untouched). Linking a
// legacy/custom exercise, or re-picking the same library exercise, keeps the id.
//
// options.previousLibraryExerciseId: the library exercise this slot was linked
// to before the user started typing (typing unlinks it, so the editor remembers
// it). Defaults to the exercise's current link.
// options.createId: injectable for tests.
export function applyLibrarySelection(
  planExercise,
  libraryExercise,
  {
    previousLibraryExerciseId = undefined,
    createId = () => globalThis.crypto.randomUUID()
  } = {}
) {
  if (!planExercise || typeof planExercise !== "object") {
    throw new TypeError("applyLibrarySelection: planExercise must be an object");
  }

  if (
    !libraryExercise ||
    !isNonEmptyString(libraryExercise.id) ||
    !isNonEmptyString(libraryExercise.name)
  ) {
    throw new TypeError(
      "applyLibrarySelection: libraryExercise needs a non-empty id and name"
    );
  }

  const previous = isNonEmptyString(previousLibraryExerciseId)
    ? previousLibraryExerciseId
    : isLinked(planExercise)
      ? planExercise.libraryExerciseId
      : null;

  const changesIdentity =
    previous !== null && previous !== libraryExercise.id;

  return {
    ...planExercise,
    ...(changesIdentity ? { id: createId() } : {}),
    name: libraryExercise.name,
    libraryExerciseId: libraryExercise.id
  };
}

// Removes the library link (the exercise becomes a custom/free-text one).
// The name text and `id` are kept.
export function clearLibraryLink(planExercise) {
  const { libraryExerciseId, ...rest } = planExercise ?? {};

  return rest;
}

// The user typed in the name box. Any change to the text unlinks the exercise;
// an input event that leaves the text identical does not. Retyping the
// canonical name afterwards does NOT relink: only an explicit pick links.
export function applyNameEdit(planExercise, newName) {
  const name = typeof newName === "string" ? newName : "";

  if (isLinked(planExercise) && name !== planExercise.name) {
    return { ...clearLibraryLink(planExercise), name };
  }

  return { ...planExercise, name };
}


// ----------------------------------------------------------------------------
// STATUS LINE (shown under the name box)
// ----------------------------------------------------------------------------

// libraryExercise = the result of getExercise(planExercise.libraryExerciseId)
// (or null/undefined when the library does not know that id, or is offline).
//
//   kind "library"         linked, and the library knows the exercise
//   kind "library-missing" linked, but the library does not know the id:
//                          the link is KEPT, never silently dropped
//   kind "custom"          not linked (legacy or free text)
export function getLinkStatus(planExercise, libraryExercise) {
  if (!isLinked(planExercise)) {
    return { kind: "custom", text: "Custom exercise" };
  }

  if (libraryExercise && isNonEmptyString(libraryExercise.name)) {
    return { kind: "library", text: `Library: ${libraryExercise.name}` };
  }

  return { kind: "library-missing", text: "Library exercise unavailable" };
}


// ----------------------------------------------------------------------------
// PICKER OPTIONS
// ----------------------------------------------------------------------------

// "front-delts" -> "front delts"
export function formatSlug(slug) {
  return String(slug ?? "").replace(/-/g, " ");
}

// "quadriceps, glutes · barbell, squat rack"
export function formatExerciseSubtitle(libraryExercise) {
  const muscles = (libraryExercise?.primaryMuscles ?? []).map(formatSlug);
  const equipment = (libraryExercise?.equipment ?? []).map(formatSlug);

  return [
    muscles.join(", "),
    equipment.length ? equipment.join(", ") : "no equipment"
  ]
    .filter(Boolean)
    .join(" · ");
}

// When the match came through an alias (not the name), return that alias so the
// UI can show 'matches "RDL"'. Returns null when the name itself matches.
export function findMatchedAlias(libraryExercise, query) {
  const q = normalizeExerciseText(query);

  if (!q || !libraryExercise) {
    return null;
  }

  const tokens = q.split(" ");

  const matches = text => tokens.every(token => text.includes(token));

  if (matches(normalizeExerciseText(libraryExercise.name))) {
    return null;
  }

  const alias = (libraryExercise.aliases ?? []).find(candidate =>
    matches(normalizeExerciseText(candidate))
  );

  return alias ?? null;
}

// Builds the dropdown rows from the library's search results.
//
//   searchResults : result of searchExercises(query) (already ranked)
//   returns       : up to `max` library rows, then ONE custom row when
//                   appropriate
//
// Library row : { type: "library", id, name, subtitle, matchedAlias }
// Custom row  : { type: "custom", name }
//
// The custom row is offered whenever the trimmed text is not empty and is not
// an exact (normalised) match of a library exercise NAME. An exact alias match
// still shows it, so the user can always choose a custom "Squat" on purpose.
// An EMPTY query is "browse all": every result becomes a library row (no
// custom row, nothing typed). Pass the complete library as searchResults.
// { allowCustom: false } never adds the custom row (library-only pickers).
export function buildPickerOptions(
  query,
  searchResults,
  { max = Infinity, allowCustom = true } = {}
) {
  const text = typeof query === "string" ? query.trim() : "";

  const results = Array.isArray(searchResults) ? searchResults : [];

  const limit = Number.isInteger(max) && max > 0 ? max : Infinity;

  if (!text) {
    return results.slice(0, limit).map(exercise => ({
      type: "library",
      id: exercise.id,
      name: exercise.name,
      subtitle: formatExerciseSubtitle(exercise),
      matchedAlias: null
    }));
  }

  const options = results.slice(0, limit).map(exercise => ({
    type: "library",
    id: exercise.id,
    name: exercise.name,
    subtitle: formatExerciseSubtitle(exercise),
    matchedAlias: findMatchedAlias(exercise, text)
  }));

  const normalized = normalizeExerciseText(text);

  const exactNameMatch = results.some(
    exercise => normalizeExerciseText(exercise.name) === normalized
  );

  // allowCustom: false = library-only pickers (Alternative Today).
  if (allowCustom && !exactNameMatch) {
    options.push({ type: "custom", name: text });
  }

  return options;
}
