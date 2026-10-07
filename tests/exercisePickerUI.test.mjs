// ============================================================================
// Tests for exercisePickerUI.js (DOM behaviour, in jsdom)
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
  clearLibraryLink
} from "../exercisePicker.js";
import { attachExercisePicker, renderStatus } from "../exercisePickerUI.js";
import { loadJSDOM, SKIP_MESSAGE, settle } from "./_jsdom.mjs";

const JSDOM = await loadJSDOM();
const skip = JSDOM ? false : SKIP_MESSAGE;

const here = dirname(fileURLToPath(import.meta.url));

const realLibrary = createExerciseLibrary({
  loadJson: async () =>
    JSON.parse(
      readFileSync(resolve(here, "..", "data", "exercise-library.v1.json"), "utf8")
    )
});

// --------------------------------------------------------------------------
// Test harness: the same card markup workout.js renders + a ctx that mirrors
// workout.js (applyNameEdit / applyLibrarySelection on an in-memory array).
// --------------------------------------------------------------------------

const card = (index, name) => `
  <article data-exercise-card="${index}">
    <div class="exercise-picker">
      <input type="text" id="exercise-name-${index}"
        class="form-input exercise-name-input" role="combobox"
        aria-expanded="false" aria-controls="exercise-picker-list-${index}"
        data-exercise-index="${index}" data-field="name" value="${name}">
      <ul class="exercise-picker-list" id="exercise-picker-list-${index}" role="listbox"></ul>
      <div class="exercise-link-status exercise-link-status--custom"
           data-link-kind="custom">Custom exercise</div>
      <div class="exercise-picker-note" role="status" hidden>unavailable</div>
    </div>
  </article>`;

function setup({ exercises, library = realLibrary } = {}) {
  const dom = new JSDOM(`<div id="list"></div>`, { url: "http://localhost/" });
  const { window } = dom;
  const list = window.document.getElementById("list");

  const state = {
    exercises: exercises ?? [
      { id: "slot-1", name: "", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120, notes: "keep me" },
      { id: "slot-2", name: "", sets: 4, repMin: 5, repMax: 8, targetRIR: 1, restSeconds: 180, notes: "" }
    ],
    nameInputs: 0,
    selects: 0,
    customs: 0
  };

  const render = () => {
    list.innerHTML = state.exercises.map((e, i) => card(i, e.name)).join("");
  };

  const ctx = {
    library,
    getExercise: i => state.exercises[i],
    onNameInput(i, value) {
      state.nameInputs += 1;
      state.exercises[i] = applyNameEdit(state.exercises[i], value);
    },
    onSelect(i, libraryExercise) {
      state.selects += 1;
      state.exercises[i] = applyLibrarySelection(state.exercises[i], libraryExercise);
    },
    onChooseCustom(i, name) {
      state.customs += 1;
      state.exercises[i] = applyNameEdit(clearLibraryLink(state.exercises[i]), name);
    }
  };

  render();

  const controller = attachExercisePicker(list, ctx);

  const api = {
    window, list, state, ctx, controller, render,
    input: i => list.querySelector(`#exercise-name-${i}`),
    dropdown: i => list.querySelector(`#exercise-picker-list-${i}`),
    wrap: i => list.querySelectorAll(".exercise-picker")[i],
    rows: i => [...api.dropdown(i).querySelectorAll(".exercise-picker-option")],
    status: i => list.querySelectorAll(".exercise-link-status")[i],
    note: i => list.querySelectorAll(".exercise-picker-note")[i],
    isOpen: i => api.dropdown(i).classList.contains("is-open"),

    async type(i, text) {
      const input = api.input(i);
      input.value = text;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await settle();
    },
    key(i, key) {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      api.input(i).dispatchEvent(event);
      return event;
    },
    // A real tap: mousedown (must be default-prevented) then click.
    tap(element) {
      const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
      element.dispatchEvent(down);
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      return down;
    },
    blur(i) {
      api.input(i).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    }
  };

  return api;
}

// A controllable fake library for async/failure tests.
function fakeLibrary(searchImpl, getImpl = async () => null) {
  return { searchExercises: searchImpl, getExercise: getImpl };
}

const deferred = () => {
  let resolveFn, rejectFn;
  const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: resolveFn, reject: rejectFn };
};


// ----------------------------------------------------------------------------
// OPENING + ROWS
// ----------------------------------------------------------------------------

test("typing opens the dropdown with EVERY match (no cap), then the custom row", { skip }, async () => {
  const t = setup();

  await t.type(0, "a");

  assert.equal(t.isOpen(0), true);
  assert.equal(t.input(0).getAttribute("aria-expanded"), "true");

  const rows = t.rows(0);
  const expected = await realLibrary.searchExercises("a", { limit: 1000 });

  assert.ok(expected.length > 6, "more than the old cap of 6");
  assert.equal(rows.filter(r => r.dataset.optionType === "library").length, expected.length);
  assert.equal(rows.at(-1).dataset.optionType, "custom");
  assert.equal(rows.length, expected.length + 1);
  assert.ok(rows.every(r => r.getAttribute("role") === "option"));
});

test("rows show name, subtitle and alias-match info", { skip }, async () => {
  const t = setup();

  await t.type(0, "rdl");

  const first = t.rows(0)[0];

  assert.equal(first.dataset.exerciseId, "barbell-romanian-deadlift");
  assert.equal(first.querySelector(".exercise-picker-option-name").textContent, "Barbell Romanian Deadlift");
  assert.equal(first.querySelector(".exercise-picker-option-sub").textContent, "hamstrings, glutes · barbell");
  assert.equal(first.querySelector(".exercise-picker-option-alias").textContent, 'matches "RDL"');
});

test("no alias line when the NAME matched; exact name -> no custom row", { skip }, async () => {
  const t = setup();

  await t.type(0, "machine hack squat");

  const rows = t.rows(0);

  assert.equal(rows[0].dataset.exerciseId, "hack-squat");
  assert.equal(rows[0].querySelector(".exercise-picker-option-alias"), null);
  assert.ok(rows.every(r => r.dataset.optionType === "library"));
});

test("exact ALIAS match still offers the custom row", { skip }, async () => {
  const t = setup();

  await t.type(0, "Squat");

  const rows = t.rows(0);

  assert.equal(rows[0].dataset.exerciseId, "barbell-back-squat");
  assert.equal(rows.at(-1).dataset.optionType, "custom");
  assert.match(rows.at(-1).textContent, /Use "Squat" as a custom exercise/);
});

test("empty text shows the WHOLE library; no match shows only the custom row", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");
  assert.equal(t.isOpen(0), true);

  await t.type(0, "");
  assert.equal(t.isOpen(0), true);
  assert.equal(t.rows(0).length, (await realLibrary.getAllExercises()).length);
  assert.ok(t.rows(0).every(r => r.dataset.optionType === "library"));

  await t.type(0, "zzzzqqq");
  assert.deepEqual(t.rows(0).map(r => r.dataset.optionType), ["custom"]);
});

test("user text is rendered as text, never as HTML", { skip }, async () => {
  const t = setup();

  await t.type(0, '<img src=x onerror="window.pwned=1">');

  assert.equal(t.dropdown(0).querySelector("img"), null);
  assert.equal(t.window.pwned, undefined);
  assert.match(t.rows(0).at(-1).textContent, /<img src=x/);
});


// ----------------------------------------------------------------------------
// SELECTION: mouse / touch
// ----------------------------------------------------------------------------

test("tapping a library row links it: canonical name, link, same slot id, prescription kept", { skip }, async () => {
  const t = setup();

  await t.type(0, "rdl");

  const down = t.tap(t.rows(0)[0]);

  assert.equal(down.defaultPrevented, true, "mousedown must be prevented so the input keeps focus");

  const exercise = t.state.exercises[0];

  assert.equal(exercise.name, "Barbell Romanian Deadlift");
  assert.equal(exercise.libraryExerciseId, "barbell-romanian-deadlift");
  assert.equal(exercise.id, "slot-1");
  assert.equal(exercise.sets, 3);
  assert.equal(exercise.repMin, 8);
  assert.equal(exercise.repMax, 12);
  assert.equal(exercise.targetRIR, 2);
  assert.equal(exercise.restSeconds, 120);
  assert.equal(exercise.notes, "keep me");

  assert.equal(t.input(0).value, "Barbell Romanian Deadlift");
  assert.equal(t.isOpen(0), false);
  assert.equal(t.status(0).dataset.linkKind, "library");
  assert.equal(t.status(0).textContent, "Library: Barbell Romanian Deadlift");
  assert.equal(t.state.selects, 1);
});

test("the dropdown is not removed by a tap before the click lands (touch sequence)", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");

  const option = t.rows(0)[1];

  // Browsers fire: touchstart, touchend, then synthetic mousedown, mouseup, click.
  option.dispatchEvent(new t.window.Event("touchstart", { bubbles: true, cancelable: true }));
  option.dispatchEvent(new t.window.Event("touchend", { bubbles: true, cancelable: true }));

  const down = new t.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  option.dispatchEvent(down);

  assert.equal(down.defaultPrevented, true);
  assert.equal(t.isOpen(0), true, "still open until the click");

  option.dispatchEvent(new t.window.MouseEvent("click", { bubbles: true }));

  assert.equal(t.state.exercises[0].libraryExerciseId, option.dataset.exerciseId);
});

test("choosing the custom row keeps the typed text, unlinked", { skip }, async () => {
  const t = setup();

  await t.type(0, "Zottman Curl");
  t.tap(t.rows(0).at(-1));

  const exercise = t.state.exercises[0];

  assert.equal(exercise.name, "Zottman Curl");
  assert.equal("libraryExerciseId" in exercise, false);
  assert.equal(exercise.id, "slot-1");
  assert.equal(t.isOpen(0), false);
  assert.equal(t.status(0).dataset.linkKind, "custom");
  assert.equal(t.state.customs, 1);
});

test("custom row on a LINKED exercise (alias text) results in an unlinked custom exercise", { skip }, async () => {
  const t = setup();

  await t.type(0, "rdl");
  t.tap(t.rows(0)[0]);
  assert.equal(t.state.exercises[0].libraryExerciseId, "barbell-romanian-deadlift");

  await t.type(0, "Squat");
  t.tap(t.rows(0).at(-1));

  assert.equal("libraryExerciseId" in t.state.exercises[0], false);
  assert.equal(t.state.exercises[0].name, "Squat");
  assert.equal(t.state.exercises[0].id, "slot-1");
});


// ----------------------------------------------------------------------------
// LINK / UNLINK / RE-SELECT through the UI
// ----------------------------------------------------------------------------

test("manual edit of a linked exercise unlinks it; explicit re-select relinks (slot id constant)", { skip }, async () => {
  const t = setup();

  await t.type(0, "leg press");
  t.tap(t.rows(0)[0]);
  assert.equal(t.state.exercises[0].libraryExerciseId, "leg-press");

  await t.type(0, "Leg Press (feet high)");

  assert.equal("libraryExerciseId" in t.state.exercises[0], false);
  assert.equal(t.status(0).dataset.linkKind, "custom");
  assert.equal(t.state.exercises[0].id, "slot-1");
  assert.equal(t.state.exercises[0].notes, "keep me");

  await t.type(0, "hack squat");
  t.tap(t.rows(0)[0]);

  assert.equal(t.state.exercises[0].libraryExerciseId, "hack-squat");
  assert.equal(t.state.exercises[0].name, "Machine Hack Squat");
  assert.equal(t.state.exercises[0].id, "slot-1");
  assert.equal(t.status(0).textContent, "Library: Machine Hack Squat");
});

test("typing text that exactly equals a library name does NOT auto-link", { skip }, async () => {
  const t = setup();

  await t.type(0, "Hack Squat");

  assert.equal("libraryExerciseId" in t.state.exercises[0], false);
  assert.equal(t.status(0).dataset.linkKind, "custom");
});


// ----------------------------------------------------------------------------
// KEYBOARD
// ----------------------------------------------------------------------------

test("ArrowDown / ArrowUp move the active row (with wrap) and set aria-activedescendant", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");

  const count = t.rows(0).length;
  const activeIndex = () => t.rows(0).findIndex(r => r.classList.contains("is-active"));

  assert.equal(activeIndex(), -1, "nothing is active until a key is pressed");

  assert.equal(t.key(0, "ArrowDown").defaultPrevented, true);
  assert.equal(activeIndex(), 0);
  assert.equal(t.input(0).getAttribute("aria-activedescendant"), t.rows(0)[0].id);
  assert.equal(t.rows(0)[0].getAttribute("aria-selected"), "true");

  t.key(0, "ArrowDown");
  assert.equal(activeIndex(), 1);

  t.key(0, "ArrowUp");
  t.key(0, "ArrowUp");
  assert.equal(activeIndex(), count - 1, "ArrowUp from the first row wraps to the last");

  t.key(0, "ArrowDown");
  assert.equal(activeIndex(), 0, "ArrowDown from the last row wraps to the first");
});

test("Enter selects the active row", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");
  t.key(0, "ArrowDown");

  const wanted = t.rows(0)[0].dataset.exerciseId;
  const enter = t.key(0, "Enter");

  assert.equal(enter.defaultPrevented, true);
  assert.equal(t.state.exercises[0].libraryExerciseId, wanted);
  assert.equal(t.isOpen(0), false);
});

test("Enter with nothing active closes without selecting; Enter when closed is untouched", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");

  t.key(0, "Enter");

  assert.equal(t.isOpen(0), false);
  assert.equal("libraryExerciseId" in t.state.exercises[0], false);
  assert.equal(t.state.selects, 0);

  const closedEnter = t.key(0, "Enter");

  assert.equal(closedEnter.defaultPrevented, false, "normal typing keys are never swallowed");
});

test("Escape closes the list and keeps the typed text", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");

  const escape = t.key(0, "Escape");

  assert.equal(escape.defaultPrevented, true);
  assert.equal(t.isOpen(0), false);
  assert.equal(t.input(0).value, "squat");

  assert.equal(t.key(0, "Escape").defaultPrevented, false, "Escape when closed is not swallowed");
});

test("ArrowDown on a closed list opens it (text filters; no text browses all)", { skip }, async () => {
  const t = setup();

  t.key(0, "ArrowDown");
  await settle();
  assert.equal(t.isOpen(0), true);
  assert.equal(t.rows(0).length, (await realLibrary.getAllExercises()).length);

  t.key(0, "Escape");
  assert.equal(t.isOpen(0), false);

  t.input(0).value = "row";
  t.key(0, "ArrowDown");
  await settle();

  assert.equal(t.isOpen(0), true);
});

test("other keys are never intercepted (normal typing still works)", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");

  for (const key of ["a", "Backspace", " ", "ArrowLeft", "Tab", "Home"]) {
    assert.equal(t.key(0, key).defaultPrevented, false, key);
  }
});


// ----------------------------------------------------------------------------
// ASYNC SAFETY
// ----------------------------------------------------------------------------

test("stale async results never overwrite a newer query", { skip }, async () => {
  const slow = deferred();
  const fast = deferred();

  const library = fakeLibrary(async query => {
    if (query === "sq") return slow.promise;      // first request: slow
    return fast.promise;                          // second request: fast
  });

  const t = setup({ library });

  const first = t.type(0, "sq");
  const second = t.type(0, "squat");

  const bench = await realLibrary.getExercise("barbell-bench-press");
  const squat = await realLibrary.getExercise("barbell-back-squat");

  fast.resolve([squat]);
  await second;

  slow.resolve([bench]);                          // the OLD query resolves last
  await first;
  await settle();

  const ids = t.rows(0).filter(r => r.dataset.optionType === "library").map(r => r.dataset.exerciseId);

  assert.deepEqual(ids, ["barbell-back-squat"], "older results must not replace newer ones");
});

test("a late result after the text was cleared does not reopen the dropdown", { skip }, async () => {
  const pending = deferred();
  const library = fakeLibrary(async () => pending.promise);

  const t = setup({ library });

  const typing = t.type(0, "squat");
  await t.type(0, "");

  pending.resolve([await realLibrary.getExercise("barbell-back-squat")]);
  await typing;
  await settle();

  assert.equal(t.isOpen(0), false);
});

test("blur closes the dropdown and drops in-flight results", { skip }, async () => {
  const pending = deferred();
  const library = fakeLibrary(async () => pending.promise);

  const t = setup({ library });

  const typing = t.type(0, "squat");
  t.blur(0);

  pending.resolve([await realLibrary.getExercise("barbell-back-squat")]);
  await typing;
  await settle();

  assert.equal(t.isOpen(0), false);

  // and with a normal library: open, then blur
  const u = setup();
  await u.type(0, "squat");
  assert.equal(u.isOpen(0), true);
  u.blur(0);
  assert.equal(u.isOpen(0), false);
});

test("results arriving after the card was re-rendered are ignored", { skip }, async () => {
  const pending = deferred();
  const library = fakeLibrary(async () => pending.promise);

  const t = setup({ library });

  const typing = t.type(0, "squat");

  t.render();   // add / delete / move re-renders every card

  pending.resolve([await realLibrary.getExercise("barbell-back-squat")]);
  await typing;
  await settle();

  assert.equal(t.isOpen(0), false);
  assert.equal(t.rows(0).length, 0);
});

test("only one dropdown is open at a time", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");
  assert.equal(t.isOpen(0), true);

  await t.type(1, "row");

  assert.equal(t.isOpen(1), true);
  assert.equal(t.isOpen(0), false);
});


// ----------------------------------------------------------------------------
// LISTENERS
// ----------------------------------------------------------------------------

test("attaching repeatedly (re-opening the editor / re-rendering) never duplicates listeners", { skip }, async () => {
  const searches = [];
  const library = fakeLibrary(async query => {
    searches.push(query);
    return realLibrary.searchExercises(query, { limit: 6 });
  });

  const t = setup({ library });

  const again = attachExercisePicker(t.list, t.ctx);
  attachExercisePicker(t.list, t.ctx);
  attachExercisePicker(t.list, t.ctx);

  assert.equal(again, t.controller, "idempotent: same controller returned");

  t.render();
  t.render();
  attachExercisePicker(t.list, t.ctx);

  await t.type(0, "squat");

  assert.equal(t.state.nameInputs, 1, "one input event -> exactly one state update");
  assert.equal(searches.length, 1, "one input event -> exactly one search");

  t.tap(t.rows(0)[0]);
  assert.equal(t.state.selects, 1, "one tap -> exactly one selection");
});

test("destroy() removes the listeners", { skip }, async () => {
  const t = setup();

  t.controller.destroy();

  await t.type(0, "squat");

  assert.equal(t.state.nameInputs, 0);
  assert.equal(t.isOpen(0), false);
});


// ----------------------------------------------------------------------------
// LIBRARY UNAVAILABLE
// ----------------------------------------------------------------------------

test("library failure: non-blocking note, no dropdown, typing + custom names still work", { skip }, async () => {
  let failing = true;

  const library = fakeLibrary(async query => {
    if (failing) throw new Error("offline");
    return realLibrary.searchExercises(query, { limit: 6 });
  });

  const t = setup({ library });

  await t.type(0, "Cable Zottman Curl");

  assert.equal(t.note(0).hidden, false, "the unavailable note is shown");
  assert.equal(t.isOpen(0), false);
  assert.equal(t.state.exercises[0].name, "Cable Zottman Curl", "typing still updates the plan exercise");
  assert.equal("libraryExerciseId" in t.state.exercises[0], false);

  failing = false;
  await t.type(0, "squat");

  assert.equal(t.note(0).hidden, true, "the note disappears once the library works again");
  assert.equal(t.isOpen(0), true);
});


// ----------------------------------------------------------------------------
// STATUS HYDRATION
// ----------------------------------------------------------------------------

const linkedExercise = (id, extra = {}) => ({
  id: "slot-1", name: "Stored Name", sets: 3, repMin: 8, repMax: 12,
  targetRIR: 2, restSeconds: 120, notes: "", libraryExerciseId: id, ...extra
});

test("hydrate: a linked card shows the library's canonical name", { skip }, async () => {
  const t = setup({ exercises: [linkedExercise("barbell-back-squat")] });

  t.controller.hydrate();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "library");
  assert.equal(t.status(0).textContent, "Library: Barbell High-Bar Back Squat");
  assert.equal(t.state.exercises[0].libraryExerciseId, "barbell-back-squat", "link untouched");
});

test("hydrate: unknown library id keeps the link and says it is unavailable", { skip }, async () => {
  const t = setup({ exercises: [linkedExercise("no-such-exercise")] });

  t.controller.hydrate();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "library-missing");
  assert.equal(t.status(0).textContent, "Library exercise unavailable");
  assert.equal(t.state.exercises[0].libraryExerciseId, "no-such-exercise", "link is never dropped");
});

test("hydrate: library failure shows the note and keeps the link", { skip }, async () => {
  const library = fakeLibrary(async () => [], async () => { throw new Error("offline"); });

  const t = setup({ exercises: [linkedExercise("barbell-back-squat")], library });

  t.controller.hydrate();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "library-missing");
  assert.equal(t.note(0).hidden, false);
  assert.equal(t.state.exercises[0].libraryExerciseId, "barbell-back-squat");
});

test("hydrate: legacy/custom cards are left alone (no automatic matching)", { skip }, async () => {
  const t = setup({ exercises: [{ id: "slot-1", name: "Squat", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 120, notes: "" }] });

  t.controller.hydrate();
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "custom");
  assert.equal("libraryExerciseId" in t.state.exercises[0], false);
  assert.equal(t.state.exercises[0].name, "Squat");
});

test("hydrate: a late answer for a card that was unlinked meanwhile is ignored", { skip }, async () => {
  const pending = deferred();
  const library = fakeLibrary(async () => [], async () => pending.promise);

  const t = setup({ exercises: [linkedExercise("barbell-back-squat")], library });

  t.controller.hydrate();

  t.state.exercises[0] = applyNameEdit(t.state.exercises[0], "Something else");
  renderStatus(t.wrap(0), t.state.exercises[0], null);

  pending.resolve(await realLibrary.getExercise("barbell-back-squat"));
  await settle();

  assert.equal(t.status(0).dataset.linkKind, "custom");
});


// ----------------------------------------------------------------------------
// CSS (mobile touch targets)
// ----------------------------------------------------------------------------

test("CSS: rows are touch-sized and the list adds no height when closed", () => {
  const css = readFileSync(resolve(here, "..", "style.css"), "utf8");

  assert.match(css, /--touch-min:\s*44px/);
  assert.match(css, /\.exercise-picker-option\s*{[^}]*min-height:\s*var\(--touch-min\)/);
  assert.match(css, /\.exercise-picker-list\s*{[^}]*display:\s*none/);
  assert.match(css, /\.exercise-picker-list\.is-open\s*{[^}]*display:\s*block/);
});


// ----------------------------------------------------------------------------
// BROWSE ALL + CATEGORY FILTERS
// ----------------------------------------------------------------------------

const focusIn = (t, i) =>
  t.input(i).dispatchEvent(new t.window.FocusEvent("focusin", { bubbles: true }));

const chips = (t, i) => [...t.wrap(i).querySelectorAll(".exercise-picker-filter")];
const chip = (t, i, name) => chips(t, i).find(c => c.dataset.category === name);

test("focusing an EMPTY box shows every library exercise immediately (no search needed)", { skip }, async () => {
  const t = setup();
  const all = await realLibrary.getAllExercises();

  focusIn(t, 0);
  await settle();

  assert.equal(t.isOpen(0), true);
  assert.equal(t.rows(0).length, all.length);
  assert.deepEqual(t.rows(0).map(r => r.dataset.exerciseId), all.map(e => e.id));
  assert.ok(t.rows(0).every(r => r.dataset.optionType === "library"), "no custom row when nothing is typed");
});

test("focusing a box that already has text does not open the list", { skip }, async () => {
  const t = setup({ exercises: [{ id: "s", name: "My lift", sets: 3, repMin: 8, repMax: 12, targetRIR: 2, restSeconds: 60, notes: "" }] });

  focusIn(t, 0);
  await settle();

  assert.equal(t.isOpen(0), false);
});

test("the six category chips are offered with the list; ALL is active first", { skip }, async () => {
  const t = setup();

  focusIn(t, 0);
  await settle();

  assert.deepEqual(chips(t, 0).map(c => c.dataset.category), ["ALL", "CHEST", "BACK", "SHOULDERS", "ARMS", "LEGS", "CORE"]);
  assert.equal(chip(t, 0, "ALL").getAttribute("aria-pressed"), "true");
  assert.equal(chip(t, 0, "CHEST").getAttribute("aria-pressed"), "false");
});

test("a chip filters the list; tapping it keeps the list open; ALL restores everything", { skip }, async () => {
  const t = setup();
  const all = await realLibrary.getAllExercises();

  focusIn(t, 0);
  await settle();

  const down = t.tap(chip(t, 0, "CHEST"));

  assert.equal(down.defaultPrevented, true, "focus stays in the box");
  assert.equal(t.isOpen(0), true);

  const { filterByCategory } = await import("../exercisePicker.js");
  const chest = filterByCategory(all, "CHEST");

  assert.deepEqual(t.rows(0).map(r => r.dataset.exerciseId), chest.map(e => e.id));
  assert.equal(chip(t, 0, "CHEST").getAttribute("aria-pressed"), "true");

  t.tap(chip(t, 0, "ALL"));
  assert.equal(t.rows(0).length, all.length);
});

test("search and chip combine; the custom row is not duplicated by a filter", { skip }, async () => {
  const t = setup();

  await t.type(0, "press");

  const total = t.rows(0).filter(r => r.dataset.optionType === "library").length;

  t.tap(chip(t, 0, "SHOULDERS"));

  const shoulderRows = t.rows(0).filter(r => r.dataset.optionType === "library");

  assert.ok(shoulderRows.length > 0 && shoulderRows.length < total);
  const { getExerciseCategory } = await import("../exercisePicker.js");

  for (const row of shoulderRows) {
    assert.equal(getExerciseCategory(await realLibrary.getExercise(row.dataset.exerciseId)), "SHOULDERS");
  }

  assert.equal(t.rows(0).at(-1).dataset.optionType, "custom");
  assert.equal(t.rows(0).filter(r => r.dataset.optionType === "custom").length, 1);
});

test("an empty category shows a note instead of rows", { skip }, async () => {
  const t = setup();

  await t.type(0, "zzzzqqq");   // custom row only
  t.tap(chip(t, 0, "CORE"));

  assert.ok(t.dropdown(0).querySelector(".exercise-picker-empty"));
});

test("choosing a browsed exercise links it, keeps the slot id and closes the list", { skip }, async () => {
  const t = setup();

  focusIn(t, 0);
  await settle();

  t.tap(chip(t, 0, "LEGS"));
  t.tap(t.rows(0).find(r => r.dataset.exerciseId === "hack-squat"));

  assert.equal(t.state.exercises[0].libraryExerciseId, "hack-squat");
  assert.equal(t.state.exercises[0].id, "slot-1");
  assert.equal(t.state.exercises[0].notes, "keep me");
  assert.equal(t.isOpen(0), false);
  assert.equal(t.wrap(0).querySelector(".exercise-picker-filters"), null, "chips are removed with the list");
});

test("clearing the box shows the whole library again; blur closes it", { skip }, async () => {
  const t = setup();

  await t.type(0, "squat");
  await t.type(0, "");

  assert.equal(t.rows(0).length, (await realLibrary.getAllExercises()).length);

  t.blur(0);
  assert.equal(t.isOpen(0), false);
});

test("the list scrolls inside itself (CSS) and chips fit a phone", () => {
  const css = readFileSync(resolve(here, "..", "style.css"), "utf8");

  assert.match(css, /\.exercise-picker-list\.is-open\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.exercise-picker-filters\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.exercise-picker-filter\s*\{[^}]*min-height:\s*36px/s);
});

test("browse: false keeps the old type-to-search behaviour", { skip }, async () => {
  const t = setup();

  t.controller.destroy();
  t.ctx.browse = false;
  attachExercisePicker(t.list, t.ctx);

  focusIn(t, 0);
  await settle();

  assert.equal(t.isOpen(0), false);
});
