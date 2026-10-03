#!/usr/bin/env node
// ============================================================================
// RECOMPOSITION — EXERCISE LIBRARY VALIDATOR
// ----------------------------------------------------------------------------
// Usage:   node scripts/validate-exercise-library.mjs [path-to-library.json]
// Default: data/exercise-library.v1.json (relative to the project root)
//
// READ-ONLY: this script never writes or modifies any file.
// Exit code: 0 = valid (warnings allowed), 1 = errors found, 2 = could not run.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libraryPath = resolve(
  process.argv[2] || resolve(here, "..", "data", "exercise-library.v1.json")
);

// ----------------------------------------------------------------------------
// Load
// ----------------------------------------------------------------------------

let library;

try {
  library = JSON.parse(readFileSync(libraryPath, "utf8"));
} catch (error) {
  console.error(`Cannot read/parse ${libraryPath}\n  ${error.message}`);
  process.exit(2);
}

const errors = [];
const warnings = [];

const err = (id, message) => errors.push({ id, message });
const warn = (id, message) => warnings.push({ id, message });

// ----------------------------------------------------------------------------
// Schema definition
// ----------------------------------------------------------------------------

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "libraryVersion",
  "description",
  "vocabularies",
  "equipmentSatisfiedBy",
  "exercises"
];

const REQUIRED_VOCABULARIES = [
  "muscles",
  "equipment",
  "resistanceTypes",
  "movementPatterns",
  "exerciseTypes",
  "difficulties",
  "purposes",
  "tiers",
  "lateralities",
  "statuses"
];

const REQUIRED_FIELDS = [
  "id",
  "name",
  "aliases",
  "description",
  "primaryMuscles",
  "secondaryMuscles",
  "equipment",
  "resistanceType",
  "movementPattern",
  "exerciseType",
  "difficulty",
  "purposes",
  "tier",
  "laterality",
  "alternativeIds",
  "status",
  "schemaVersion"
];

const OPTIONAL_FIELDS = ["notes", "replacedBy"];

const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const isNonEmptyString = value =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = value =>
  Array.isArray(value) && value.every(item => typeof item === "string");

// Same normalisation the app will use to match names / aliases:
// case-, punctuation- and spacing-insensitive.
const normalize = value =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  return [...duplicates];
}

// ----------------------------------------------------------------------------
// Top level
// ----------------------------------------------------------------------------

for (const key of Object.keys(library)) {
  if (!TOP_LEVEL_FIELDS.includes(key)) {
    err("(library)", `Unknown top-level field "${key}"`);
  }
}

if (!Number.isInteger(library.schemaVersion)) {
  err("(library)", "schemaVersion must be an integer");
}

if (!isNonEmptyString(library.libraryVersion)) {
  err("(library)", "libraryVersion must be a non-empty string");
}

const vocab = library.vocabularies || {};

for (const name of REQUIRED_VOCABULARIES) {
  if (!isStringArray(vocab[name]) || vocab[name].length === 0) {
    err("(vocabularies)", `"${name}" must be a non-empty array of strings`);
  } else {
    for (const dup of findDuplicates(vocab[name])) {
      err("(vocabularies)", `"${name}" contains duplicate value "${dup}"`);
    }
  }
}

for (const name of Object.keys(vocab)) {
  if (!REQUIRED_VOCABULARIES.includes(name)) {
    err("(vocabularies)", `Unknown vocabulary "${name}"`);
  }
}

const set = name => new Set(Array.isArray(vocab[name]) ? vocab[name] : []);

const MUSCLES = set("muscles");
const EQUIPMENT = set("equipment");
const RESISTANCE = set("resistanceTypes");
const PATTERNS = set("movementPatterns");
const TYPES = set("exerciseTypes");
const DIFFICULTIES = set("difficulties");
const PURPOSES = set("purposes");
const TIERS = set("tiers");
const LATERALITIES = set("lateralities");
const STATUSES = set("statuses");

// equipmentSatisfiedBy: { required: [equipment that also satisfies it] }
const satisfiedBy = library.equipmentSatisfiedBy || {};

for (const [required, providers] of Object.entries(satisfiedBy)) {
  if (!EQUIPMENT.has(required)) {
    err("(equipmentSatisfiedBy)", `Unknown equipment key "${required}"`);
  }
  if (!isStringArray(providers)) {
    err("(equipmentSatisfiedBy)", `"${required}" must map to an array of strings`);
    continue;
  }
  for (const provider of providers) {
    if (!EQUIPMENT.has(provider)) {
      err("(equipmentSatisfiedBy)", `"${required}" lists unknown equipment "${provider}"`);
    }
    if (provider === required) {
      err("(equipmentSatisfiedBy)", `"${required}" cannot be satisfied by itself`);
    }
  }
}

const exercises = Array.isArray(library.exercises) ? library.exercises : null;

if (!exercises) {
  err("(library)", "exercises must be an array");
}

// ----------------------------------------------------------------------------
// Per-exercise checks
// ----------------------------------------------------------------------------

const list = exercises || [];

const allIds = list.map(exercise => exercise?.id);
const idSet = new Set(allIds.filter(isNonEmptyString));

function checkMembers(id, field, values, allowed, label) {
  if (!isStringArray(values)) {
    err(id, `${field} must be an array of strings`);
    return;
  }

  for (const dup of findDuplicates(values)) {
    err(id, `${field} lists "${dup}" more than once`);
  }

  for (const value of values) {
    if (!allowed.has(value)) {
      err(id, `${field} contains invalid ${label} "${value}"`);
    }
  }
}

function checkEnum(id, field, value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    err(id, `${field} "${value}" is not a valid ${label}`);
  }
}

list.forEach((exercise, index) => {
  const id = isNonEmptyString(exercise?.id) ? exercise.id : `(index ${index})`;

  if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) {
    err(id, "entry must be an object");
    return;
  }

  // Required / unknown fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in exercise)) {
      err(id, `missing required field "${field}"`);
    }
  }

  for (const field of Object.keys(exercise)) {
    if (!ALLOWED_FIELDS.has(field)) {
      err(id, `unknown field "${field}"`);
    }
  }

  // id
  if (!isNonEmptyString(exercise.id) || !SLUG.test(exercise.id)) {
    err(id, `id must be a lowercase slug (a-z, 0-9, hyphens), got "${exercise.id}"`);
  }

  // name
  if (!isNonEmptyString(exercise.name)) {
    err(id, "name must be a non-empty string");
  }

  // aliases
  if (!isStringArray(exercise.aliases)) {
    err(id, "aliases must be an array of strings");
  } else {
    for (const alias of exercise.aliases) {
      if (!isNonEmptyString(alias)) {
        err(id, "aliases must not contain empty strings");
      }
    }
    for (const dup of findDuplicates(exercise.aliases.map(normalize))) {
      err(id, `alias "${dup}" is listed more than once`);
    }
  }

  // description (user-facing) and notes (internal, optional)
  if (!isNonEmptyString(exercise.description)) {
    err(id, "description must be a non-empty string");
  } else if (exercise.description.length > 240) {
    warn(id, `description is long (${exercise.description.length} chars; keep it short)`);
  }

  if ("notes" in exercise && typeof exercise.notes !== "string") {
    err(id, "notes must be a string when present");
  }

  // Vocabulary-backed fields
  checkMembers(id, "primaryMuscles", exercise.primaryMuscles, MUSCLES, "muscle");
  checkMembers(id, "secondaryMuscles", exercise.secondaryMuscles, MUSCLES, "muscle");

  if (Array.isArray(exercise.primaryMuscles) && exercise.primaryMuscles.length === 0) {
    err(id, "primaryMuscles must contain at least one muscle");
  }

  if (isStringArray(exercise.primaryMuscles) && isStringArray(exercise.secondaryMuscles)) {
    for (const muscle of exercise.primaryMuscles) {
      if (exercise.secondaryMuscles.includes(muscle)) {
        err(id, `muscle "${muscle}" is both primary and secondary`);
      }
    }
  }

  checkMembers(id, "equipment", exercise.equipment, EQUIPMENT, "equipment");
  checkEnum(id, "resistanceType", exercise.resistanceType, RESISTANCE, "resistance type");
  checkEnum(id, "movementPattern", exercise.movementPattern, PATTERNS, "movement pattern");
  checkEnum(id, "exerciseType", exercise.exerciseType, TYPES, "exercise type");
  checkEnum(id, "difficulty", exercise.difficulty, DIFFICULTIES, "difficulty");
  checkMembers(id, "purposes", exercise.purposes, PURPOSES, "purpose");

  if (Array.isArray(exercise.purposes) && exercise.purposes.length === 0) {
    err(id, "purposes must contain at least one purpose");
  }

  checkEnum(id, "tier", exercise.tier, TIERS, "tier");
  checkEnum(id, "laterality", exercise.laterality, LATERALITIES, "laterality");
  checkEnum(id, "status", exercise.status, STATUSES, "status");

  // schemaVersion
  if (!Number.isInteger(exercise.schemaVersion)) {
    err(id, "schemaVersion must be an integer");
  } else if (exercise.schemaVersion !== library.schemaVersion) {
    err(id, `schemaVersion ${exercise.schemaVersion} does not match library schemaVersion ${library.schemaVersion}`);
  }

  // alternativeIds
  if (!isStringArray(exercise.alternativeIds)) {
    err(id, "alternativeIds must be an array of strings");
  } else {
    for (const dup of findDuplicates(exercise.alternativeIds)) {
      err(id, `alternativeIds lists "${dup}" more than once`);
    }

    for (const altId of exercise.alternativeIds) {
      if (altId === exercise.id) {
        err(id, "alternativeIds must not reference the exercise itself");
      } else if (!idSet.has(altId)) {
        err(id, `alternativeIds references unknown exercise "${altId}"`);
      }
    }
  }

  // deprecated entries
  if (exercise.status === "deprecated") {
    if ("replacedBy" in exercise && !idSet.has(exercise.replacedBy)) {
      err(id, `replacedBy references unknown exercise "${exercise.replacedBy}"`);
    }
  } else if ("replacedBy" in exercise) {
    err(id, 'replacedBy is only allowed when status is "deprecated"');
  }
});

// ----------------------------------------------------------------------------
// Cross-exercise checks
// ----------------------------------------------------------------------------

// Unique ids
for (const dup of findDuplicates(allIds.filter(isNonEmptyString))) {
  err(dup, "duplicate id");
}

// Unique names (exact, and normalised)
const names = list.filter(e => isNonEmptyString(e?.name));

for (const dup of findDuplicates(names.map(e => e.name))) {
  err("(library)", `duplicate name "${dup}"`);
}

for (const dup of findDuplicates(names.map(e => normalize(e.name)))) {
  err("(library)", `names collide after normalisation: "${dup}"`);
}

// Unique aliases, and no alias may collide with any name or another alias
const claims = new Map(); // normalised text -> [{ id, kind }]

function claim(text, id, kind) {
  const key = normalize(text);
  if (!key) return;
  if (!claims.has(key)) claims.set(key, []);
  claims.get(key).push({ id, kind });
}

for (const exercise of list) {
  if (!exercise || typeof exercise !== "object") continue;
  if (isNonEmptyString(exercise.name)) claim(exercise.name, exercise.id, "name");
  if (isStringArray(exercise.aliases)) {
    for (const alias of exercise.aliases) claim(alias, exercise.id, "alias");
  }
}

for (const [key, owners] of claims) {
  const distinct = new Set(owners.map(o => o.id));
  if (distinct.size > 1) {
    err(
      "(library)",
      `"${key}" is claimed by multiple exercises: ` +
        owners.map(o => `${o.id} (${o.kind})`).join(", ")
    );
  } else if (
    owners.some(o => o.kind === "alias") &&
    owners.some(o => o.kind === "name")
  ) {
    err(owners[0].id, `alias duplicates the exercise's own name ("${key}")`);
  }
}

// Quality warnings (do not fail validation)
const byId = new Map(list.filter(e => e && e.id).map(e => [e.id, e]));

for (const exercise of list) {
  if (!exercise || !isStringArray(exercise.alternativeIds)) continue;
  if (!isStringArray(exercise.primaryMuscles)) continue;

  for (const altId of exercise.alternativeIds) {
    const alt = byId.get(altId);
    if (!alt || !isStringArray(alt.primaryMuscles)) continue;

    const shared = exercise.primaryMuscles.some(m => alt.primaryMuscles.includes(m));
    if (!shared) {
      warn(exercise.id, `alternative "${altId}" shares no primary muscle`);
    }
  }
}

// ----------------------------------------------------------------------------
// Report
// ----------------------------------------------------------------------------

const valid = list.filter(e => e && typeof e === "object");

const count = (field) => {
  const tally = {};
  for (const e of valid) tally[e[field]] = (tally[e[field]] || 0) + 1;
  return Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(", ");
};

console.log("Recomposition exercise library validator");
console.log(`File:      ${libraryPath}`);
console.log(`Library:   v${library.libraryVersion}  (schema ${library.schemaVersion})`);
console.log(`Exercises: ${list.length}`);
console.log("");

if (valid.length) {
  console.log("Summary");
  console.log(`  type:       ${count("exerciseType")}`);
  console.log(`  resistance: ${count("resistanceType")}`);
  console.log(`  difficulty: ${count("difficulty")}`);
  console.log(`  tier:       ${count("tier")}`);
  console.log(`  laterality: ${count("laterality")}`);
  console.log(`  patterns:   ${new Set(valid.map(e => e.movementPattern)).size} of ${PATTERNS.size} used`);

  const none = valid.filter(e => Array.isArray(e.alternativeIds) && e.alternativeIds.length === 0);
  console.log(`  no curated alternatives: ${none.length ? none.map(e => e.id).join(", ") : "none"}`);

  const unusedVocab = [];
  const used = {
    muscles: new Set(valid.flatMap(e => [...(e.primaryMuscles || []), ...(e.secondaryMuscles || [])])),
    equipment: new Set(valid.flatMap(e => e.equipment || [])),
    purposes: new Set(valid.flatMap(e => e.purposes || []))
  };
  for (const [name, usedSet] of Object.entries(used)) {
    const unused = [...set(name)].filter(v => !usedSet.has(v));
    if (unused.length) unusedVocab.push(`${name}: ${unused.join(", ")}`);
  }
  console.log(`  unused vocabulary values: ${unusedVocab.length ? unusedVocab.join(" | ") : "none"}`);
  console.log("");
}

if (warnings.length) {
  console.log(`Warnings (${warnings.length})`);
  for (const w of warnings) console.log(`  ! [${w.id}] ${w.message}`);
  console.log("");
}

if (errors.length) {
  console.log(`ERRORS (${errors.length})`);
  for (const e of errors) console.log(`  x [${e.id}] ${e.message}`);
  console.log("");
  console.log("RESULT: FAILED");
  process.exit(1);
}

console.log("RESULT: PASSED — no errors" + (warnings.length ? `, ${warnings.length} warning(s)` : ", no warnings"));