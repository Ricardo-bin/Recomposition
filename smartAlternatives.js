// ============================================================================
// RECOMPOSITION — SMART ALTERNATIVES (pure, deterministic)
// ----------------------------------------------------------------------------
// Ranks library exercises as replacements for one exercise, using ONLY library
// metadata. No AI, no network, no randomness: the same input always gives the
// same ordered output.
//
// Ranking (earlier rules always beat later ones):
//   1. explicit alternativeIds of the original, in their curated order
//   2. same movement pattern, then a similar one (same pattern family)
//   3. shared primary muscles (more shared = better)
//   4. compatible equipment (shared equipment, then same resistance type)
//   5. laterality compatibility (same laterality first)
//   then library order (stable), so ties never depend on sort quirks.
//
// Eligibility: an exercise that is not explicitly curated must share at least
// one primary muscle with the original, so a squat is never "recommended" for
// a bench press. Never offered: the original itself, deprecated exercises and
// anything in `excludeIds`.
//
// Pure: no mutation of arguments, no DOM, no library access.
// ============================================================================

export const DEFAULT_RECOMMENDATION_LIMIT = 5;

// Patterns in one family count as "similar" (rule 2).
const PATTERN_FAMILIES = Object.freeze([
  ["squat", "lunge", "knee-extension"],
  ["hinge", "knee-flexion"],
  ["horizontal-push", "horizontal-adduction"],
  ["vertical-push", "shoulder-abduction"],
  ["horizontal-pull", "vertical-pull", "shoulder-extension"],
  ["shoulder-horizontal-abduction"],
  ["spinal-flexion", "trunk-rotation", "trunk-stability"],
  ["wrist-flexion", "wrist-extension"]
]);

function patternScore(a, b) {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 2;
  }

  return PATTERN_FAMILIES.some(
    family => family.includes(a) && family.includes(b)
  )
    ? 1
    : 0;
}

const count = (a = [], b = []) => a.filter(item => b.includes(item)).length;

// The comparable facts about one candidate (exported for tests).
export function scoreAlternative(original, candidate) {
  const explicitIndex = (original.alternativeIds ?? []).indexOf(candidate.id);

  const sharedEquipment = count(original.equipment, candidate.equipment);

  const bothBodyweight =
    (original.equipment ?? []).length === 0 &&
    (candidate.equipment ?? []).length === 0;

  return {
    explicitIndex,
    pattern: patternScore(original.movementPattern, candidate.movementPattern),
    primaryOverlap: count(original.primaryMuscles, candidate.primaryMuscles),
    equipment:
      (sharedEquipment > 0 || bothBodyweight ? 2 : 0) +
      (original.resistanceType === candidate.resistanceType ? 1 : 0),
    laterality: original.laterality === candidate.laterality ? 1 : 0
  };
}

// original   : a library exercise record
// exercises  : the library list, in library order
// options    : { excludeIds = [], limit = 5 }
// returns    : a NEW array of library exercises, best first
export function rankAlternatives(
  original,
  exercises,
  { excludeIds = [], limit = DEFAULT_RECOMMENDATION_LIMIT } = {}
) {
  if (!original || typeof original !== "object" || !Array.isArray(exercises)) {
    return [];
  }

  const excluded = new Set([original.id, ...excludeIds]);

  const max = Number.isInteger(limit) && limit > 0 ? limit : Infinity;

  const scored = [];

  exercises.forEach((candidate, order) => {
    if (
      !candidate ||
      excluded.has(candidate.id) ||
      candidate.status === "deprecated"
    ) {
      return;
    }

    const score = scoreAlternative(original, candidate);

    if (score.explicitIndex < 0 && score.primaryOverlap === 0) {
      return;
    }

    scored.push({ candidate, score, order });
  });

  scored.sort((a, b) => {
    const x = a.score;
    const y = b.score;

    const aExplicit = x.explicitIndex >= 0;
    const bExplicit = y.explicitIndex >= 0;

    if (aExplicit !== bExplicit) {
      return aExplicit ? -1 : 1;
    }

    if (aExplicit && bExplicit) {
      return x.explicitIndex - y.explicitIndex;
    }

    return (
      y.pattern - x.pattern ||
      y.primaryOverlap - x.primaryOverlap ||
      y.equipment - x.equipment ||
      y.laterality - x.laterality ||
      a.order - b.order
    );
  });

  return scored.slice(0, max).map(item => item.candidate);
}
