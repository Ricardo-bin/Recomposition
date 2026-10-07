// ============================================================================
// RECOMPOSITION — EXERCISE PICKER UI
// ----------------------------------------------------------------------------
// The inline "combobox" under an exercise name box in the workout plan editor.
//
//   - Search-as-you-type over the Exercise Library (via data/exerciseLibrary.js).
//   - BROWSE ALL: an empty box lists the complete library (focus, tap or clear
//     the text); typing filters it. The list scrolls inside itself. Simple
//     category chips (ALL / CHEST / BACK / ...) narrow the list.
//   - Library rows, then the custom row (rules live in exercisePicker.js).
//     ctx.allowCustom === false makes it library-only (no custom row).
//     ctx.onResults(query, rowCount) is an optional hook after each search.
//   - ctx.browse === false turns browse-all off (typing is required).
//   - ctx.pinned === true keeps the list open (blur, selecting and Escape do
//     not close it) and marks the chosen row; used by the Alternative Today
//     sheet. controller.openAll() / closeAll() drive it.
//   - Mouse, touch, ArrowUp/ArrowDown, Enter, Escape.
//   - Never owns plan data: it asks workout.js (through `ctx`) to change state.
//   - Never blocks typing: if the library fails to load, a small note appears and
//     the user keeps typing a custom name.
//
// Wiring: attachExercisePicker(listElement, ctx) installs ONE set of delegated
// listeners on the exercise list element. It is idempotent per element, so
// re-rendering the cards (add / delete / move) or re-opening the editor can
// never stack duplicate listeners.
//
// Expected card markup (rendered by workout.js):
//
//   <div class="exercise-picker">
//     <input class="exercise-name-input" data-exercise-index="N" data-field="name"
//            role="combobox" ...>
//     <ul class="exercise-picker-list" role="listbox"></ul>
//     <div class="exercise-link-status"></div>
//     <div class="exercise-picker-note" hidden>…</div>
//   </div>
// ============================================================================

import {
  searchExercises as defaultSearchExercises,
  getAllExercises as defaultGetAllExercises,
  getExercise as defaultGetExercise
} from "./data/exerciseLibrary.js";

import {
  PICKER_SEARCH_LIMIT,
  PICKER_CATEGORIES,
  buildPickerOptions,
  getExerciseCategory,
  getLinkStatus,
  isLinked
} from "./exercisePicker.js";

const NAME_INPUT = "input.exercise-name-input[data-field='name']";

const attachments = new WeakMap();


// ----------------------------------------------------------------------------
// STATUS LINE
// ----------------------------------------------------------------------------

// Updates the "Library: X / Custom exercise / Library exercise unavailable" line.
export function renderStatus(wrap, planExercise, libraryExercise) {
  const status = wrap?.querySelector(".exercise-link-status");

  if (!status) {
    return;
  }

  const { kind, text } = getLinkStatus(planExercise, libraryExercise);

  status.className = `exercise-link-status exercise-link-status--${kind}`;
  status.dataset.linkKind = kind;
  status.textContent = text;
}


// ----------------------------------------------------------------------------
// ATTACH
// ----------------------------------------------------------------------------

export function attachExercisePicker(listElement, ctx) {
  if (!listElement) {
    return null;
  }

  // Idempotent: a second attach to the same element returns the first controller.
  if (attachments.has(listElement)) {
    return attachments.get(listElement);
  }

  const library = {
    searchExercises: ctx.library?.searchExercises ?? defaultSearchExercises,
    getAllExercises: ctx.library
      ? ctx.library.getAllExercises
      : defaultGetAllExercises,
    getExercise: ctx.library?.getExercise ?? defaultGetExercise
  };

  const pinned = ctx.pinned === true;
  const browse = ctx.browse !== false;

  // Pinned mode: true once the list has been opened, until closeAll().
  let pinnedActive = false;

  // Pinned mode: the row the user chose.
  let selectedId = null;

  // Category chip state per picker (reset when the list closes).
  const categories = new WeakMap();

  // Increments on every new query / close. A search result is only applied if
  // its number is still current, so stale async results can never overwrite a
  // newer query.
  let sequence = 0;

  // Per-dropdown data (rows + library exercises), keyed by the <ul>.
  const dropdownData = new WeakMap();


  // --------------------------------------------------------------------------
  // helpers
  // --------------------------------------------------------------------------

  const partsOf = input => {
    const wrap = input.closest(".exercise-picker");

    return {
      wrap,
      dropdown: wrap?.querySelector(".exercise-picker-list") ?? null,
      note: wrap?.querySelector(".exercise-picker-note") ?? null
    };
  };

  const indexOf = input => Number(input.dataset.exerciseIndex);

  const isOpen = dropdown =>
    Boolean(dropdown && dropdown.classList.contains("is-open"));

  function closeDropdown(wrap) {
    const dropdown = wrap?.querySelector(".exercise-picker-list");
    const input = wrap?.querySelector(NAME_INPUT);

    if (dropdown) {
      dropdown.classList.remove("is-open");
      dropdown.replaceChildren();
      dropdownData.delete(dropdown);
    }

    wrap?.querySelector(".exercise-picker-filters")?.remove();
    categories.delete(wrap);

    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
  }

  function closeAllDropdowns() {
    listElement
      .querySelectorAll(".exercise-picker")
      .forEach(closeDropdown);
  }

  function setNoteVisible(wrap, visible) {
    const note = wrap?.querySelector(".exercise-picker-note");

    if (note) {
      note.hidden = !visible;
    }
  }

  function setActive(wrap, nextIndex) {
    const dropdown = wrap.querySelector(".exercise-picker-list");
    const input = wrap.querySelector(NAME_INPUT);
    const options = [...dropdown.querySelectorAll(".exercise-picker-option")];

    options.forEach((option, i) => {
      const active = i === nextIndex;

      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");

      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      }
    });

    if (nextIndex < 0) {
      input.removeAttribute("aria-activedescendant");
    }

    dropdown.dataset.activeIndex = String(nextIndex);
  }

  const activeIndexOf = dropdown =>
    Number(dropdown?.dataset.activeIndex ?? -1);


  // --------------------------------------------------------------------------
  // render dropdown (built with DOM APIs + textContent: user text is never HTML)
  // --------------------------------------------------------------------------

  const doc = () => listElement.ownerDocument;

  // The chip row sits just above the list; created on demand so every card
  // template keeps working unchanged.
  function ensureFilters(wrap, dropdown) {
    let bar = wrap.querySelector(".exercise-picker-filters");

    if (!bar) {
      bar = doc().createElement("div");
      bar.className = "exercise-picker-filters";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Filter by muscle group");

      PICKER_CATEGORIES.forEach(category => {
        const chip = doc().createElement("button");

        chip.type = "button";
        chip.className = "exercise-picker-filter";
        chip.dataset.category = category;
        chip.textContent = category;

        bar.append(chip);
      });

      dropdown.before(bar);
    }

    const current = categories.get(wrap) ?? "ALL";

    bar.querySelectorAll(".exercise-picker-filter").forEach(chip => {
      const active = chip.dataset.category === current;

      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderDropdown(wrap, input, allRows, results, query) {
    const dropdown = wrap.querySelector(".exercise-picker-list");

    if (!dropdown) {
      return;
    }

    const index = indexOf(input);

    const byId = new Map(results.map(exercise => [exercise.id, exercise]));

    const category = categories.get(wrap) ?? "ALL";

    const rows =
      category === "ALL"
        ? allRows
        : allRows.filter(
            row =>
              row.type !== "library" ||
              getExerciseCategory(byId.get(row.id)) === category
          );

    dropdown.replaceChildren();

    rows.forEach((row, i) => {
      const li = doc().createElement("li");

      li.id = `exercise-picker-${index}-option-${i}`;
      li.className = `exercise-picker-option exercise-picker-option--${row.type}`;
      li.setAttribute("role", "option");
      li.dataset.optionIndex = String(i);
      li.dataset.optionType = row.type;

      const chosen = pinned && row.type === "library" && row.id === selectedId;

      li.setAttribute("aria-selected", chosen ? "true" : "false");
      li.classList.toggle("is-selected", chosen);

      const title = doc().createElement("span");
      title.className = "exercise-picker-option-name";

      if (row.type === "library") {
        title.textContent = row.name;
        li.dataset.exerciseId = row.id;
        li.append(title);

        const sub = doc().createElement("span");
        sub.className = "exercise-picker-option-sub";
        sub.textContent = row.subtitle;
        li.append(sub);

        if (row.matchedAlias) {
          const alias = doc().createElement("span");
          alias.className = "exercise-picker-option-alias";
          alias.textContent = `matches "${row.matchedAlias}"`;
          li.append(alias);
        }
      } else {
        title.textContent = `Use "${row.name}" as a custom exercise`;
        li.append(title);

        const sub = doc().createElement("span");
        sub.className = "exercise-picker-option-sub";
        sub.textContent = "Not linked to the exercise library";
        li.append(sub);
      }

      dropdown.append(li);
    });

    if (!rows.some(row => row.type === "library")) {
      const empty = doc().createElement("li");

      empty.className = "exercise-picker-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "No exercises in this category.";

      dropdown.prepend(empty);
    }

    ensureFilters(wrap, dropdown);

    // "rows" (not allRows) is what keyboard / click indexes refer to.
    dropdownData.set(dropdown, { rows, results, allRows, query });

    dropdown.dataset.activeIndex = "-1";
    dropdown.classList.add("is-open");

    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
  }


  // --------------------------------------------------------------------------
  // search
  // --------------------------------------------------------------------------

  async function runSearch(input) {
    const mine = ++sequence;

    const { wrap, dropdown } = partsOf(input);

    const wasOpen = isOpen(dropdown);

    const query = input.value.trim();

    // Only one dropdown is ever open.
    listElement
      .querySelectorAll(".exercise-picker")
      .forEach(other => {
        if (other !== wrap) {
          closeDropdown(other);
        }
      });

    const browsing = !query;

    // Nothing typed and browse-all is off (and not pinned open): stay closed.
    if (browsing && !browse && !pinnedActive) {
      closeDropdown(wrap);
      ctx.onResults?.("", 0);
      return;
    }

    let results;

    try {
      if (browsing) {
        if (typeof library.getAllExercises !== "function") {
          closeDropdown(wrap);
          ctx.onResults?.("", 0);
          return;
        }

        results = await library.getAllExercises();
      } else {
        results = await library.searchExercises(query, {
          limit: PICKER_SEARCH_LIMIT
        });
      }
    } catch (error) {
      if (mine !== sequence) {
        return;
      }

      // Library unavailable: stay out of the way, keep typing possible.
      closeDropdown(wrap);
      setNoteVisible(wrap, true);

      return;
    }

    // Stale result (a newer query started, the card was re-rendered, or the
    // text changed): ignore it.
    if (
      mine !== sequence ||
      !input.isConnected ||
      input.value.trim() !== query
    ) {
      return;
    }

    setNoteVisible(wrap, false);

    const rows = buildPickerOptions(query, [...results], {
      allowCustom: ctx.allowCustom !== false
    });

    // Optional hook (library-only pickers use it for a "no match" hint).
    ctx.onResults?.(query, rows.length);

    if (rows.length === 0) {
      closeDropdown(wrap);
      return;
    }

    if (pinned) {
      pinnedActive = true;
    }

    renderDropdown(wrap, input, rows, [...results], query);

    // Inline lists: bring the box to the top so the keyboard cannot hide rows.
    if (!wasOpen && !pinned) {
      input.scrollIntoView?.({ block: "start" });
    }
  }

  // Re-render the open list for another category (no new search).
  function applyCategory(wrap, input, category) {
    const dropdown = wrap.querySelector(".exercise-picker-list");
    const data = dropdownData.get(dropdown);

    if (!data) {
      return;
    }

    categories.set(wrap, category);

    renderDropdown(wrap, input, data.allRows, data.results, data.query);
  }


  // --------------------------------------------------------------------------
  // choose a row
  // --------------------------------------------------------------------------

  function chooseOption(wrap, input, optionIndex) {
    const dropdown = wrap.querySelector(".exercise-picker-list");
    const data = dropdownData.get(dropdown);
    const row = data?.rows[optionIndex];

    if (!row) {
      return;
    }

    const index = indexOf(input);

    if (row.type === "library") {
      const libraryExercise =
        data.results.find(exercise => exercise.id === row.id) ??
        { id: row.id, name: row.name };

      ctx.onSelect(index, libraryExercise);

      if (pinned) {
        // Stay open, keep the search text, just mark the chosen row.
        selectedId = row.id;

        dropdown.querySelectorAll(".exercise-picker-option").forEach(option => {
          const chosen = option.dataset.exerciseId === row.id;

          option.classList.toggle("is-selected", chosen);
          option.setAttribute("aria-selected", chosen ? "true" : "false");
        });

        return;
      }

      const current = ctx.getExercise(index);

      input.value = current?.name ?? libraryExercise.name;

      renderStatus(wrap, current, libraryExercise);
    } else {
      ctx.onChooseCustom(index, row.name);

      const current = ctx.getExercise(index);

      input.value = current?.name ?? row.name;

      renderStatus(wrap, current, null);
    }

    sequence += 1;

    closeDropdown(wrap);

    input.focus?.();
  }


  // --------------------------------------------------------------------------
  // event handlers (delegated)
  // --------------------------------------------------------------------------

  function onInput(event) {
    const input = event.target.closest?.(NAME_INPUT);

    if (!input) {
      return;
    }

    const index = indexOf(input);
    const { wrap } = partsOf(input);

    selectedId = null;

    // State first (may unlink the exercise), then the status line, then search.
    ctx.onNameInput(index, input.value);

    renderStatus(wrap, ctx.getExercise(index), null);

    runSearch(input);
  }

  function onKeyDown(event) {
    const input = event.target.closest?.(NAME_INPUT);

    if (!input) {
      return;
    }

    const { wrap, dropdown } = partsOf(input);

    const open = isOpen(dropdown);

    const count = open
      ? dropdown.querySelectorAll(".exercise-picker-option").length
      : 0;

    switch (event.key) {

      case "ArrowDown":
        event.preventDefault();

        if (!open) {
          if (input.value.trim() || browse) {
            runSearch(input);
          }
          return;
        }

        setActive(wrap, (activeIndexOf(dropdown) + 1) % count);
        return;

      case "ArrowUp":
        event.preventDefault();

        if (!open) {
          return;
        }

        setActive(
          wrap,
          activeIndexOf(dropdown) <= 0 ? count - 1 : activeIndexOf(dropdown) - 1
        );
        return;

      case "Enter":
        if (!open) {
          return;
        }

        event.preventDefault();

        if (activeIndexOf(dropdown) >= 0) {
          chooseOption(wrap, input, activeIndexOf(dropdown));
        } else {
          sequence += 1;
          closeDropdown(wrap);
        }
        return;

      case "Escape":
        if (!open || pinned) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        sequence += 1;
        closeDropdown(wrap);
        return;

      default:
    }
  }

  function onFocusOut(event) {
    const input = event.target.closest?.(NAME_INPUT);

    if (!input) {
      return;
    }

    // Pinned lists stay open. Moving focus to a chip in the same picker keeps
    // the list too.
    if (pinned) {
      return;
    }

    const { wrap } = partsOf(input);

    if (event.relatedTarget && wrap?.contains(event.relatedTarget)) {
      return;
    }

    // Invalidate any in-flight search and close.
    sequence += 1;

    closeDropdown(wrap);
  }

  // Focusing (or tapping) an EMPTY box shows the whole library.
  function onFocusIn(event) {
    const input = event.target.closest?.(NAME_INPUT);

    if (!input || !browse || input.value.trim() || input.disabled) {
      return;
    }

    if (!isOpen(partsOf(input).dropdown)) {
      runSearch(input);
    }
  }

  // Keep focus in the text box when an option is pressed (prevents the blur
  // that would close the list before the click lands, on mouse and on touch).
  function onMouseDown(event) {
    if (
      event.target.closest?.(
        ".exercise-picker-option, .exercise-picker-filter"
      )
    ) {
      event.preventDefault();
    }
  }

  function onClick(event) {
    const chip = event.target.closest?.(".exercise-picker-filter");

    if (chip) {
      const wrap = chip.closest(".exercise-picker");
      const input = wrap?.querySelector(NAME_INPUT);

      if (wrap && input) {
        applyCategory(wrap, input, chip.dataset.category);
      }

      return;
    }

    const box = event.target.closest?.(NAME_INPUT);

    // Tapping the box again (after Escape) reopens the full list.
    if (box) {
      if (browse && !box.value.trim() && !isOpen(partsOf(box).dropdown)) {
        runSearch(box);
      }

      return;
    }

    const option = event.target.closest?.(".exercise-picker-option");

    if (!option) {
      return;
    }

    const wrap = option.closest(".exercise-picker");
    const input = wrap?.querySelector(NAME_INPUT);

    if (!wrap || !input) {
      return;
    }

    chooseOption(wrap, input, Number(option.dataset.optionIndex));
  }


  // --------------------------------------------------------------------------
  // hydrate status lines of linked cards after a (re)render
  // --------------------------------------------------------------------------

  function hydrate() {
    listElement.querySelectorAll(".exercise-picker").forEach(wrap => {
      const input = wrap.querySelector(NAME_INPUT);

      if (!input) {
        return;
      }

      const index = indexOf(input);
      const exercise = ctx.getExercise(index);

      if (!isLinked(exercise)) {
        return;
      }

      const linkedId = exercise.libraryExerciseId;

      const stillSame = () =>
        wrap.isConnected &&
        ctx.getExercise(index)?.libraryExerciseId === linkedId;

      Promise.resolve()
        .then(() => library.getExercise(linkedId))
        .then(libraryExercise => {
          if (stillSame()) {
            renderStatus(wrap, ctx.getExercise(index), libraryExercise);
          }
        })
        .catch(() => {
          if (stillSame()) {
            renderStatus(wrap, ctx.getExercise(index), null);
            setNoteVisible(wrap, true);
          }
        });
    });
  }


  // --------------------------------------------------------------------------
  // install
  // --------------------------------------------------------------------------

  listElement.addEventListener("input", onInput);
  listElement.addEventListener("keydown", onKeyDown);
  listElement.addEventListener("focusin", onFocusIn);
  listElement.addEventListener("focusout", onFocusOut);
  listElement.addEventListener("mousedown", onMouseDown);
  listElement.addEventListener("click", onClick);

  const controller = Object.freeze({
    hydrate,
    closeAll() {
      pinnedActive = false;
      selectedId = null;
      sequence += 1;
      closeAllDropdowns();
    },
    // Opens the list for whatever is in the box (empty = the whole library).
    openAll() {
      const input = listElement.querySelector(NAME_INPUT);

      if (input) {
        return runSearch(input);
      }
    },
    destroy() {
      listElement.removeEventListener("input", onInput);
      listElement.removeEventListener("keydown", onKeyDown);
      listElement.removeEventListener("focusin", onFocusIn);
      listElement.removeEventListener("focusout", onFocusOut);
      listElement.removeEventListener("mousedown", onMouseDown);
      listElement.removeEventListener("click", onClick);
      attachments.delete(listElement);
    }
  });

  attachments.set(listElement, controller);

  return controller;
}
