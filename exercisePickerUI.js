// ============================================================================
// RECOMPOSITION — EXERCISE PICKER UI
// ----------------------------------------------------------------------------
// The inline "combobox" under an exercise name box in the workout plan editor.
//
//   - Search-as-you-type over the Exercise Library (via data/exerciseLibrary.js).
//   - Up to 6 library rows, then the custom row (rules live in exercisePicker.js).
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
  getExercise as defaultGetExercise
} from "./data/exerciseLibrary.js";

import {
  PICKER_MAX_RESULTS,
  buildPickerOptions,
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
    getExercise: ctx.library?.getExercise ?? defaultGetExercise
  };

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

  function renderDropdown(wrap, input, rows, results) {
    const dropdown = wrap.querySelector(".exercise-picker-list");

    if (!dropdown) {
      return;
    }

    const index = indexOf(input);

    dropdown.replaceChildren();

    rows.forEach((row, i) => {
      const li = listElement.ownerDocument.createElement("li");

      li.id = `exercise-picker-${index}-option-${i}`;
      li.className = `exercise-picker-option exercise-picker-option--${row.type}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.dataset.optionIndex = String(i);
      li.dataset.optionType = row.type;

      const title = listElement.ownerDocument.createElement("span");
      title.className = "exercise-picker-option-name";

      if (row.type === "library") {
        title.textContent = row.name;
        li.dataset.exerciseId = row.id;
        li.append(title);

        const sub = listElement.ownerDocument.createElement("span");
        sub.className = "exercise-picker-option-sub";
        sub.textContent = row.subtitle;
        li.append(sub);

        if (row.matchedAlias) {
          const alias = listElement.ownerDocument.createElement("span");
          alias.className = "exercise-picker-option-alias";
          alias.textContent = `matches "${row.matchedAlias}"`;
          li.append(alias);
        }
      } else {
        title.textContent = `Use "${row.name}" as a custom exercise`;
        li.append(title);

        const sub = listElement.ownerDocument.createElement("span");
        sub.className = "exercise-picker-option-sub";
        sub.textContent = "Not linked to the exercise library";
        li.append(sub);
      }

      dropdown.append(li);
    });

    dropdownData.set(dropdown, { rows, results });

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

    const { wrap } = partsOf(input);

    const query = input.value.trim();

    // Only one dropdown is ever open.
    listElement
      .querySelectorAll(".exercise-picker")
      .forEach(other => {
        if (other !== wrap) {
          closeDropdown(other);
        }
      });

    if (!query) {
      closeDropdown(wrap);
      return;
    }

    let results;

    try {
      results = await library.searchExercises(query, {
        limit: PICKER_MAX_RESULTS
      });
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

    const rows = buildPickerOptions(query, results);

    if (rows.length === 0) {
      closeDropdown(wrap);
      return;
    }

    renderDropdown(wrap, input, rows, results);
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
          if (input.value.trim()) {
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
        if (!open) {
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

    // Invalidate any in-flight search and close.
    sequence += 1;

    closeDropdown(partsOf(input).wrap);
  }

  // Keep focus in the text box when an option is pressed (prevents the blur
  // that would close the list before the click lands, on mouse and on touch).
  function onMouseDown(event) {
    if (event.target.closest?.(".exercise-picker-option")) {
      event.preventDefault();
    }
  }

  function onClick(event) {
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
  listElement.addEventListener("focusout", onFocusOut);
  listElement.addEventListener("mousedown", onMouseDown);
  listElement.addEventListener("click", onClick);

  const controller = Object.freeze({
    hydrate,
    closeAll: closeAllDropdowns,
    destroy() {
      listElement.removeEventListener("input", onInput);
      listElement.removeEventListener("keydown", onKeyDown);
      listElement.removeEventListener("focusout", onFocusOut);
      listElement.removeEventListener("mousedown", onMouseDown);
      listElement.removeEventListener("click", onClick);
      attachments.delete(listElement);
    }
  });

  attachments.set(listElement, controller);

  return controller;
}
