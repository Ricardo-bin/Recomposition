// Shared helper for DOM-based tests (not itself a test: the name does not match *.test.mjs).
//
// jsdom is a dev-only dependency used to simulate the browser. Install it with
//     npm install --no-save jsdom
// If it is missing, DOM tests are SKIPPED (not failed) with a clear message.
// To use a jsdom installed elsewhere, set JSDOM_PATH to its lib/api.js file.

import { pathToFileURL } from "node:url";

export async function loadJSDOM() {
  try {
    const target = process.env.JSDOM_PATH
      ? pathToFileURL(process.env.JSDOM_PATH).href
      : "jsdom";

    const module = await import(target);

    return module.JSDOM ?? module.default?.JSDOM ?? null;
  } catch {
    return null;
  }
}

export const SKIP_MESSAGE =
  "jsdom is not installed (run: npm install --no-save jsdom)";

// Lets pending promises/microtasks and 0ms timers run.
export const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};
