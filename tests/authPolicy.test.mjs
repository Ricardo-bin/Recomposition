import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_PASSWORD_LENGTH, isAcceptableNewPassword, LOGIN_FAILED_MESSAGE } from "../authPolicy.js";

test("a NEW password needs at least 8 characters", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(isAcceptableNewPassword("1234567"), false);
  assert.equal(isAcceptableNewPassword("12345678"), true);
  assert.equal(isAcceptableNewPassword(""), false);
  assert.equal(isAcceptableNewPassword(null), false);
});

test("sign-in never applies the new length rule (existing accounts are not locked out)", () => {
  const source = readFileSync(new URL("../auth.js", import.meta.url), "utf8");
  const signIn = source.slice(source.indexOf("signInWithEmailAndPassword(auth"), source.indexOf("signInWithEmailAndPassword(auth") + 400);

  assert.doesNotMatch(signIn, /isAcceptableNewPassword|MIN_PASSWORD_LENGTH/);
});

test("login does not reveal whether an email is registered", () => {
  const source = readFileSync(new URL("../auth.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /No account was found/);
  assert.doesNotMatch(source, /"Incorrect password\."/);
  assert.match(source, /case "auth\/user-not-found":[\s\S]{0,120}LOGIN_FAILED_MESSAGE/);
  assert.equal(LOGIN_FAILED_MESSAGE, "Incorrect email or password.");
});
