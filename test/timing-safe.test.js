/**
 * tokenEquals bewaakt token-/handtekening-verificatie (bonnen, wallet-pas, webhooks,
 * nieuwsbrief-afmelding, studio-API). Deze tests leggen het fail-closed-gedrag vast.
 *
 * Draaien: node --experimental-strip-types --test test/timing-safe.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tokenEquals } from "../lib/timing-safe.ts";

test("gelijke strings → true", () => {
  assert.equal(tokenEquals("abc123", "abc123"), true);
});

test("verschillende strings van gelijke lengte → false", () => {
  assert.equal(tokenEquals("abc123", "abc124"), false);
});

test("verschillende lengte → false (geen throw)", () => {
  assert.equal(tokenEquals("abc", "abcd"), false);
});

test("leeg/undefined/null → false (fail-closed)", () => {
  assert.equal(tokenEquals("", "x"), false);
  assert.equal(tokenEquals("x", ""), false);
  assert.equal(tokenEquals(undefined, "x"), false);
  assert.equal(tokenEquals("x", null), false);
  assert.equal(tokenEquals("", ""), false);
});

test("unicode van gelijke byte-lengte vergelijkt correct", () => {
  assert.equal(tokenEquals("café", "café"), true);
  assert.equal(tokenEquals("café", "cafe"), false); // andere byte-lengte
});
