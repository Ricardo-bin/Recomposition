// SheetJS is requested only when Excel export is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSheetJs, resetSheetJsLoader, SHEETJS_SRC } from "../sheetjsLoader.js";

function fakeDom() {
  const appended = [];
  const win = {};
  const doc = {
    head: { appendChild: node => appended.push(node) },
    createElement: () => ({ remove() {} })
  };

  return { appended, win, doc };
}

test("nothing is requested until the loader is called", () => {
  resetSheetJsLoader();

  const { appended } = fakeDom();

  assert.equal(appended.length, 0);
});

test("one script tag is added, pointing at SheetJS, and the library is returned", async () => {
  resetSheetJsLoader();

  const { appended, win, doc } = fakeDom();
  const promise = loadSheetJs({ doc, win });

  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, SHEETJS_SRC);
  assert.equal(appended[0].async, true);

  win.XLSX = { utils: {} };
  appended[0].onload();

  assert.equal(await promise, win.XLSX);

  // Already loaded: no second request.
  assert.equal(await loadSheetJs({ doc, win }), win.XLSX);
  assert.equal(appended.length, 1);
});

test("a second click while loading shares the same request", async () => {
  resetSheetJsLoader();

  const { appended, win, doc } = fakeDom();
  const first = loadSheetJs({ doc, win });
  const second = loadSheetJs({ doc, win });

  assert.equal(appended.length, 1);

  win.XLSX = {};
  appended[0].onload();
  await Promise.all([first, second]);
});

test("a network failure rejects with a readable message and can be retried", async () => {
  resetSheetJsLoader();

  const { appended, win, doc } = fakeDom();
  const promise = loadSheetJs({ doc, win });

  appended[0].onerror();

  await assert.rejects(promise, /Could not load the Excel library/);

  const retry = loadSheetJs({ doc, win });

  assert.equal(appended.length, 2, "a retry makes a new request");

  win.XLSX = {};
  appended[1].onload();
  await retry;
});

test("a configured integrity hash is applied to the script tag", () => {
  resetSheetJsLoader();

  const { appended, win, doc } = fakeDom();

  loadSheetJs({ doc, win, integrity: "sha384-abc" });

  assert.equal(appended[0].integrity, "sha384-abc");
  assert.equal(appended[0].crossOrigin, "anonymous");
});
