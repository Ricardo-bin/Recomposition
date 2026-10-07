// ============================================================================
// Integration tests: the REAL workoutPlanEditor.js plan editor (Settings → Edit Workouts) + exercise picker
// (in jsdom, with the data layer / Firebase replaced by in-memory stubs).
//
// The test loads workoutPlanEditor.js's source, removes its import lines, and injects
// stubs. It drives the editor only through the page's own buttons and inputs.
// Run:  node --test tests/*.test.mjs
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createExerciseLibrary } from "../data/exerciseLibrary.js";
import {
  applyLibrarySelection,
  applyNameEdit,
  clearLibraryLink,
  getLinkStatus,
  libraryLinkField
} from "../exercisePicker.js";
import { attachExercisePicker as realAttach } from "../exercisePickerUI.js";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));
const WORKOUT_SOURCE = resolve(here, "..", "workoutPlanEditor.js");

const realLibrary = createExerciseLibrary({
  loadJson: async () =>
    JSON.parse(
      readFileSync(resolve(here, "..", "data", "exercise-library.v1.json"), "utf8")
    )
});


// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

const legacyExercise = (n, extra = {}) => ({
  id: `slot-${n}`,
  name: `Legacy ${n}`,
  sets: 3,
  repMin: 8,
  repMax: 12,
  targetRIR: 2,
  restSeconds: 120,
  notes: `note ${n}`,
  ...extra
});

const makePlan = (exercises, extra = {}) => ({
  id: "plan-1",
  name: "Upper B",
  dayOfWeek: 3,
  focus: "Upper body",
  targetRIR: 2,
  defaultRestSeconds: 120,
  notes: "",
  exercises,
  ...extra
});

async function boot({ plans = [], library = realLibrary, source = WORKOUT_SOURCE } = {}) {
  const dom = new JSDOM(`<div id="settings-workouts-page"></div>`, { url: "http://localhost/" });
  const { window } = dom;
  const { document } = window;

  const calls = { created: [], updated: [], searches: [], alerts: [] };

  window.confirm = () => true;
  window.alert = message => calls.alerts.push(message);

  // jsdom does not implement layout APIs that every real browser has.
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

  const countingLibrary = {
    searchExercises: (...args) => {
      calls.searches.push(args[0]);
      return library.searchExercises(...args);
    },
    getExercise: (...args) => library.getExercise(...args)
  };

  const stubs = {
    getWorkoutPlans: async () => plans,
    createWorkoutPlan: async payload => { calls.created.push(payload); },
    updateWorkoutPlan: async (id, payload) => { calls.updated.push({ id, payload }); },
    deleteWorkoutPlan: async () => {},
    onAuthStateChanged: () => {},
    auth: {},
    loadExerciseLibrary: () => library.loadExerciseLibrary(),
    applyLibrarySelection,
    applyNameEdit,
    clearLibraryLink,
    getLinkStatus,
    libraryLinkField,
    // Real picker UI, pointed at the test library instead of fetch().
    attachExercisePicker: (element, ctx) =>
      realAttach(element, { ...ctx, library: countingLibrary })
  };

  const code =
    readFileSync(source, "utf8").replace(
      /import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g,
      ""
    ) + "\n;return { getEditing: () => editingExercises };";

  const internals = new Function(
    "document",
    "window",
    ...Object.keys(stubs),
    code
  )(document, window, ...Object.values(stubs));

  await window.RecompositionWorkoutEditor.render();
  await settle();

  const q = selector => document.querySelector(selector);

  const api = {
    window, document, calls, plans, internals,

    editing: () => internals.getEditing(),

    field: (index, name) =>
      q(`[data-exercise-index="${index}"][data-field="${name}"]`),

    exerciseCount: () => document.querySelectorAll("[data-exercise-card]").length,

    async openNew() {
      q("#btn-create-workout-plan")?.click() ??
        q("[data-create-day]")?.click();
      await settle();
    },

    async openExisting(planId = "plan-1") {
      q(`[data-edit-plan="${planId}"]`).click();
      await settle();
    },

    async closeEditor() {
      q("#btn-close-workout-form").click();
      await settle();
    },

    async addExercise() {
      (q("#btn-add-exercise") ?? q("#btn-add-first-exercise")).click();
      await settle();
    },

    async type(index, text) {
      const input = api.field(index, "name");
      input.value = text;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await settle();
    },

    async setField(index, name, value) {
      const input = api.field(index, name);
      input.value = String(value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await settle(1);
    },

    dropdown: index => q(`#exercise-picker-list-${index}`),
    rows: index => [...api.dropdown(index).querySelectorAll(".exercise-picker-option")],
    isOpen: index => api.dropdown(index).classList.contains("is-open"),
    status: index => document.querySelectorAll(".exercise-link-status")[index],
    note: index => document.querySelectorAll(".exercise-picker-note")[index],
    title: index => document.querySelector(`[data-exercise-card="${index}"] .exercise-builder-name`)?.textContent,

    tap(element) {
      const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
      element.dispatchEvent(down);
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      return down;
    },

    key(index, key) {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      api.field(index, "name").dispatchEvent(event);
      return event;
    },

    click: selector => { q(selector).click(); },

    async move(index, direction) {
      q(`[data-move-${direction}="${index}"]`).click();
      await settle();
    },

    async remove(index) {
      q(`[data-delete-exercise="${index}"]`).click();
      await settle();
    },

    async fillPlanBasics(name = "My Plan") {
      q("#workout-plan-name").value = name;
      const day = q("#workout-plan-day");
      if (day && !day.value) day.value = "1";
    },

    async save() {
      q("#btn-save-workout-plan").click();
      await settle(5);
    },

    savedExercises() {
      const call = calls.updated.at(-1)?.payload ?? calls.created.at(-1);
      return call?.exercises;
    }
  };

  return api;
}


// ----------------------------------------------------------------------------
// 1. NEW EXERCISES
// ----------------------------------------------------------------------------

test("new CUSTOM exercise saves with no libraryExerciseId key at all", { skip }, async () => {
  const t = await boot();

  await t.openNew();
  await t.fillPlanBasics();
  await t.addExercise();
  await t.type(0, "Zottman Curl");
  await t.save();

  assert.equal(t.calls.created.length, 1, `alerts: ${t.calls.alerts.join("|")}`);

  const [exercise] = t.savedExercises();

  assert.equal(exercise.name, "Zottman Curl");
  assert.equal("libraryExerciseId" in exercise, false);
  assert.ok(!JSON.stringify(t.calls.created[0]).includes("libraryExerciseId"));
  assert.ok(!JSON.stringify(t.calls.created[0]).includes("undefined"));
  assert.deepEqual(
    Object.keys(exercise).sort(),
    ["id", "name", "notes", "repMax", "repMin", "restSeconds", "sets", "targetRIR"]
  );
});

test("new LIBRARY exercise: canonical name saved with libraryExerciseId; slot id is its own UUID", { skip }, async () => {
  const t = await boot();

  await t.openNew();
  await t.fillPlanBasics();
  await t.addExercise();

  const slotId = t.editing()[0].id;

  await t.type(0, "rdl");

  assert.equal(t.isOpen(0), true);

  t.tap(t.rows(0)[0]);

  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.name, "Barbell Romanian Deadlift");
  assert.equal(exercise.libraryExerciseId, "barbell-romanian-deadlift");
  assert.equal(exercise.id, slotId, "slot id is exactly what it was before selection");
  assert.notEqual(exercise.id, exercise.libraryExerciseId);
  assert.match(exercise.id, /^[0-9a-f-]{36}$/, "slot ids stay random UUIDs");
  assert.equal(exercise.sets, 3);
  assert.equal(exercise.repMin, 8);
  assert.equal(exercise.repMax, 12);
  assert.equal(exercise.targetRIR, 2);
  assert.equal(exercise.restSeconds, 120);
});

test("selecting preserves prescription the user already edited", { skip }, async () => {
  const t = await boot();

  await t.openNew();
  await t.fillPlanBasics();
  await t.addExercise();

  await t.setField(0, "sets", 5);
  await t.setField(0, "repMin", 4);
  await t.setField(0, "repMax", 6);
  await t.setField(0, "targetRIR", 1);
  await t.setField(0, "restSeconds", 240);
  await t.setField(0, "notes", "heavy singles");

  await t.type(0, "bench");
  t.tap(t.rows(0)[0]);
  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.libraryExerciseId, "barbell-bench-press");
  assert.deepEqual(
    [exercise.sets, exercise.repMin, exercise.repMax, exercise.targetRIR, exercise.restSeconds, exercise.notes],
    [5, 4, 6, 1, 240, "heavy singles"]
  );
});

test("card title and status line follow typing and selection", { skip }, async () => {
  const t = await boot();

  await t.openNew();
  await t.addExercise();

  await t.type(0, "squat");
  assert.equal(t.title(0), "squat");
  assert.equal(t.status(0).dataset.linkKind, "custom");

  t.tap(t.rows(0)[0]);

  assert.equal(t.title(0), "Barbell High-Bar Back Squat");
  assert.equal(t.status(0).dataset.linkKind, "library");
  assert.equal(t.status(0).textContent, "Library: Barbell High-Bar Back Squat");
  assert.equal(t.field(0, "name").value, "Barbell High-Bar Back Squat");
});


// ----------------------------------------------------------------------------
// 2. EXISTING PLANS
// ----------------------------------------------------------------------------

test("existing LEGACY plan: untouched save keeps exactly the legacy structure", { skip }, async () => {
  const original = [legacyExercise(1), legacyExercise(2, { name: "Squat" })];

  const t = await boot({ plans: [makePlan(structuredClone(original))] });

  await t.openExisting();

  assert.equal(t.status(0).dataset.linkKind, "custom");
  assert.equal(t.status(1).dataset.linkKind, "custom");

  await t.save();

  assert.equal(t.calls.updated.length, 1, `alerts: ${t.calls.alerts.join("|")}`);
  assert.deepEqual(t.savedExercises(), original, "no key added, none changed, no auto-link of 'Squat'");
  assert.ok(!JSON.stringify(t.calls.updated[0].payload).includes("libraryExerciseId"));
});

test("existing LINKED plan: untouched save keeps the link, name and slot ids", { skip }, async () => {
  const original = [
    legacyExercise(1, { name: "Hack Squat", libraryExerciseId: "hack-squat" }),
    legacyExercise(2)
  ];

  const t = await boot({ plans: [makePlan(structuredClone(original))] });

  await t.openExisting();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "library");
  assert.equal(t.status(0).textContent, "Library: Machine Hack Squat");
  assert.equal(t.status(1).dataset.linkKind, "custom");

  await t.save();

  assert.deepEqual(t.savedExercises(), original);
});

test("existing exercise with a library id the library does not know: link kept, flagged unavailable", { skip }, async () => {
  const original = [legacyExercise(1, { name: "Old Thing", libraryExerciseId: "retired-exercise" })];

  const t = await boot({ plans: [makePlan(structuredClone(original))] });

  await t.openExisting();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "library-missing");

  await t.save();

  assert.equal(t.savedExercises()[0].libraryExerciseId, "retired-exercise");
});

test("editing a legacy exercise's prescription still works and stays legacy-shaped", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1)])] });

  await t.openExisting();
  await t.setField(0, "sets", 4);
  await t.setField(0, "repMin", 6);
  await t.setField(0, "notes", "updated");
  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.id, "slot-1");
  assert.equal(exercise.name, "Legacy 1");
  assert.equal(exercise.sets, 4);
  assert.equal(exercise.repMin, 6);
  assert.equal(exercise.notes, "updated");
  assert.equal("libraryExerciseId" in exercise, false);
});

test("manual name edit on a LINKED exercise unlinks it; slot id and prescription kept", { skip }, async () => {
  const t = await boot({
    plans: [makePlan([legacyExercise(1, { name: "Hack Squat", libraryExerciseId: "hack-squat" })])]
  });

  await t.openExisting();
  await t.type(0, "Hack Squat (slow)");

  assert.equal(t.status(0).dataset.linkKind, "custom");

  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.name, "Hack Squat (slow)");
  assert.equal("libraryExerciseId" in exercise, false);
  assert.equal(exercise.id, "slot-1");
  assert.equal(exercise.sets, 3);
  assert.equal(exercise.notes, "note 1");
});

test("typing text equal to a library name does NOT relink; re-selecting does", { skip }, async () => {
  const t = await boot({
    plans: [makePlan([legacyExercise(1, { name: "Hack Squat", libraryExerciseId: "hack-squat" })])]
  });

  await t.openExisting();

  await t.type(0, "Machine Hack Squat ");     // unlink
  await t.type(0, "Machine Hack Squat");      // exactly the library name again

  assert.equal("libraryExerciseId" in t.editing()[0], false, "no automatic relink");

  assert.ok(t.rows(0).every(row => row.dataset.optionType === "library"), "exact name -> no custom row");

  t.tap(t.rows(0)[0]);                // explicit selection

  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.libraryExerciseId, "hack-squat");
  assert.equal(exercise.name, "Machine Hack Squat");
  assert.equal(exercise.id, "slot-1");
});

test("re-selecting a DIFFERENT library exercise keeps the slot id (Leg Press -> Hack Squat)", { skip }, async () => {
  const t = await boot({
    plans: [makePlan([legacyExercise(1, { name: "Leg Press", libraryExerciseId: "leg-press" })])]
  });

  await t.openExisting();
  await t.type(0, "hack");

  t.tap(t.rows(0)[0]);

  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.libraryExerciseId, "hack-squat");
  assert.equal(exercise.name, "Machine Hack Squat");
  assert.equal(exercise.id, "slot-1");
  assert.equal(exercise.restSeconds, 120);
});

test("explicitly linking a LEGACY exercise ('Squat') only happens by selection", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1, { name: "Squat" })])] });

  await t.openExisting();

  assert.equal("libraryExerciseId" in t.editing()[0], false);

  await t.type(0, "Squat");           // same text re-typed: dropdown opens, nothing changes

  assert.equal("libraryExerciseId" in t.editing()[0], false);

  t.tap(t.rows(0)[0]);

  await t.save();

  assert.equal(t.savedExercises()[0].libraryExerciseId, "barbell-back-squat");
  assert.equal(t.savedExercises()[0].id, "slot-1");
});

test("choosing the custom row on a legacy exercise saves it unlinked", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1, { name: "Squat" })])] });

  await t.openExisting();
  await t.type(0, "Squat");

  t.tap(t.rows(0).at(-1));

  await t.save();

  const [exercise] = t.savedExercises();

  assert.equal(exercise.name, "Squat");
  assert.equal("libraryExerciseId" in exercise, false);
});


// ----------------------------------------------------------------------------
// 3. ADD / REMOVE / REORDER
// ----------------------------------------------------------------------------

test("add / move / delete still work and links travel with their exercise", { skip }, async () => {
  const t = await boot({
    plans: [
      makePlan([
        legacyExercise(1, { name: "Hack Squat", libraryExerciseId: "hack-squat" }),
        legacyExercise(2),
        legacyExercise(3, { name: "Pull-Up", libraryExerciseId: "pull-up" })
      ])
    ]
  });

  await t.openExisting();

  assert.equal(t.exerciseCount(), 3);

  await t.move(0, "down");            // [2, 1, 3]
  await t.move(2, "up");              // [2, 3, 1]

  assert.deepEqual(t.editing().map(e => e.id), ["slot-2", "slot-3", "slot-1"]);

  // Status lines are re-rendered for the new order.
  assert.deepEqual(
    [...t.document.querySelectorAll(".exercise-link-status")].map(s => s.dataset.linkKind),
    ["custom", "library", "library"]
  );

  await t.remove(0);                  // delete slot-2

  assert.equal(t.exerciseCount(), 2);

  await t.addExercise();

  assert.equal(t.exerciseCount(), 3);

  await t.type(2, "Brand New");
  await t.save();

  const saved = t.savedExercises();

  assert.deepEqual(saved.map(e => e.id).slice(0, 2), ["slot-3", "slot-1"]);
  assert.deepEqual(saved.map(e => e.libraryExerciseId), ["pull-up", "hack-squat", undefined]);
  assert.equal("libraryExerciseId" in saved[2], false);
  assert.equal(saved[2].name, "Brand New");
});

test("an open dropdown is cleanly discarded when the list re-renders", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1), legacyExercise(2)])] });

  await t.openExisting();
  await t.type(0, "squat");

  assert.equal(t.isOpen(0), true);

  await t.move(0, "down");

  assert.equal(t.document.querySelectorAll(".exercise-picker-list.is-open").length, 0);
});


// ----------------------------------------------------------------------------
// 4. LIBRARY UNAVAILABLE
// ----------------------------------------------------------------------------

test("library search failure: editor still works, note shown, custom exercise saves", { skip }, async () => {
  const brokenLibrary = {
    loadExerciseLibrary: async () => { throw new Error("offline"); },
    searchExercises: async () => { throw new Error("offline"); },
    getExercise: async () => { throw new Error("offline"); }
  };

  const t = await boot({ library: brokenLibrary });

  await t.openNew();
  await t.fillPlanBasics();
  await t.addExercise();
  await t.type(0, "Cable Zottman Curl");

  assert.equal(t.note(0).hidden, false, "non-blocking note is shown");
  assert.equal(t.isOpen(0), false);

  await t.save();

  assert.equal(t.calls.created.length, 1, `alerts: ${t.calls.alerts.join("|")}`);

  const [exercise] = t.savedExercises();

  assert.equal(exercise.name, "Cable Zottman Curl");
  assert.equal("libraryExerciseId" in exercise, false);
});

test("library down while editing a linked exercise: link preserved on save", { skip }, async () => {
  const brokenLibrary = {
    loadExerciseLibrary: async () => { throw new Error("offline"); },
    searchExercises: async () => { throw new Error("offline"); },
    getExercise: async () => { throw new Error("offline"); }
  };

  const original = [legacyExercise(1, { name: "Hack Squat", libraryExerciseId: "hack-squat" })];

  const t = await boot({ plans: [makePlan(structuredClone(original))], library: brokenLibrary });

  await t.openExisting();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "library-missing");

  await t.save();

  assert.deepEqual(t.savedExercises(), original, "nothing lost while offline");
});


// ----------------------------------------------------------------------------
// 5. LISTENERS
// ----------------------------------------------------------------------------

test("re-opening the editor repeatedly never duplicates listeners", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1)])] });

  for (let i = 0; i < 3; i += 1) {
    await t.openExisting();
    await t.closeEditor();
  }

  await t.openExisting();
  await t.move(0, "down");           // re-render of the same list

  t.calls.searches.length = 0;

  await t.type(0, "squat");

  assert.equal(t.calls.searches.length, 1, "exactly one search per keystroke");

  t.tap(t.rows(0)[0]);

  assert.equal(t.editing()[0].libraryExerciseId, "barbell-back-squat");
  assert.equal(t.editing().length, 1);
});

test("closing the editor leaves no orphaned dropdowns", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1)])] });

  await t.openExisting();
  await t.type(0, "squat");

  await t.closeEditor();

  assert.equal(t.document.querySelectorAll(".exercise-picker-list").length, 0);
  assert.equal(t.document.querySelectorAll(".exercise-picker").length, 0);
});


// ----------------------------------------------------------------------------
// 6. KEYBOARD + TOUCH
// ----------------------------------------------------------------------------

test("keyboard: ArrowDown, ArrowDown, Enter selects the second row; Escape closes", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1)])] });

  await t.openExisting();
  await t.type(0, "squat");

  const second = t.rows(0)[1].dataset.exerciseId;

  t.key(0, "ArrowDown");
  t.key(0, "ArrowDown");

  assert.equal(t.key(0, "Enter").defaultPrevented, true);
  assert.equal(t.editing()[0].libraryExerciseId, second);
  assert.equal(t.isOpen(0), false);

  await t.type(0, "row");
  assert.equal(t.isOpen(0), true);

  t.key(0, "Escape");

  assert.equal(t.isOpen(0), false);
  assert.equal(t.field(0, "name").value, "row", "Escape keeps the typed text");
  assert.equal("libraryExerciseId" in t.editing()[0], false, "and the text edit unlinked it");
});

test("touch: mousedown is prevented (keeps focus) and the click selects", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1)])] });

  await t.openExisting();
  await t.type(0, "pull");

  const row = t.rows(0)[0];
  const down = t.tap(row);

  assert.equal(down.defaultPrevented, true);
  assert.equal(t.editing()[0].libraryExerciseId, row.dataset.exerciseId);
});

test("normal editing keys inside the editor are not swallowed", { skip }, async () => {
  const t = await boot({ plans: [makePlan([legacyExercise(1)])] });

  await t.openExisting();
  await t.type(0, "squat");

  for (const key of ["a", "Backspace", "ArrowLeft", "Tab"]) {
    assert.equal(t.key(0, key).defaultPrevented, false, key);
  }

  const sets = t.field(0, "sets");
  const enter = new t.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });

  sets.dispatchEvent(enter);

  assert.equal(enter.defaultPrevented, false, "Enter in other fields is untouched");
});
