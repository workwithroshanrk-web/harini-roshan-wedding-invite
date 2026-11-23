import { test } from "node:test";
import assert from "node:assert/strict";
import { celebrations, countdown } from "../src/lib/celebrations.ts";
test("celebration day countdown changes at Indian midnight", () => {
  const dateOnly = { ...celebrations[1], starts: null };
  assert.equal(
    countdown(dateOnly, Date.parse("2027-04-16T18:29:59Z")),
    "1 day to go",
  );
  assert.equal(
    countdown(dateOnly, Date.parse("2027-04-16T18:30:00Z")),
    "Today is the day",
  );
  assert.equal(
    countdown(dateOnly, Date.parse("2027-04-17T18:30:00Z")),
    "A day to remember",
  );
});
test("Poo Vaikum countdown uses the exact India-time start", () => {
  assert.equal(
    countdown(celebrations[0], Date.parse("2027-01-20T11:30:00Z")),
    "0d 1h 0m 0s",
  );
  assert.equal(
    countdown(celebrations[1], Date.parse("2027-04-17T11:30:00Z")),
    "0d 1h 0m 0s",
  );
  assert.equal(
    countdown(celebrations[2], Date.parse("2027-04-18T02:30:00Z")),
    "0d 1h 0m 0s",
  );
});

test("finished events never show a negative countdown", () => {
  assert.equal(
    countdown(celebrations[0], Date.parse("2027-01-20T15:00:00Z")),
    "This function’s scheduled time has passed",
  );
});
