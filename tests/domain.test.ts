import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRsvp,
  csvCell,
  householdCapacity,
  expectedAfterAdding,
} from "../src/lib/domain.ts";

test("lower expectations preserve recorded members and do not expand themselves on additions", () => {
  assert.equal(householdCapacity(2, 0, 4), 4);
  assert.equal(householdCapacity(2, 1, 4), 4);
  assert.equal(householdCapacity(4, 2, 4), 6);
  assert.equal(expectedAfterAdding(2, 4, 5), 2);
  assert.equal(expectedAfterAdding(4, 4, 5), 5);
});
test("CSV blocks whitespace-prefixed formulas", () =>
  assert.equal(csvCell("  =1+1"), '"\'  =1+1"'));
test("malformed stay dates rejected", () =>
  assert.throws(() =>
    validateRsvp(
      {
        ...base(),
        stay: {
          required: "Yes",
          people: 1,
          arrival: "2027-02-30",
          departure: "2027-03-03",
          notes: "",
        },
      },
      2,
    ),
  ));
const travel = {
  required: "No",
  origin: "",
  mode: "Not decided",
  arrival: "",
  departure: "",
  point: "",
  departurePoint: "",
  reference: "",
  notes: "",
};
const base = () => ({
  version: 0,
  response: "Confirmed",
  members: [
    { name: "Kumar", attendance: "Yes", age_group: "Adult", accessibility: "" },
    { name: "Meena", attendance: "No", age_group: "Adult", accessibility: "" },
  ],
  travel,
  stay: { required: "No", people: 0, arrival: "", departure: "", notes: "" },
});
test("headcount derives from attending members", () =>
  assert.equal(validateRsvp(base(), 2).count, 1));
test("household allowance applies to all members", () =>
  assert.throws(() => validateRsvp(base(), 1), /allows up to/));
test("declining clears member attendance", () => {
  const r = validateRsvp({ ...base(), response: "Declined" }, 2);
  assert.equal(r.count, 0);
  assert.ok(r.members.every((m) => m.attendance === "No"));
});
test("maybe clears previous confirmations", () =>
  assert.equal(validateRsvp({ ...base(), response: "Maybe" }, 2).count, 0));
test("stay demand cannot exceed confirmed members", () =>
  assert.throws(
    () =>
      validateRsvp(
        {
          ...base(),
          stay: {
            required: "Yes",
            people: 2,
            arrival: "2027-01-01",
            departure: "2027-01-02",
            notes: "",
          },
        },
        2,
      ),
    /attending members/,
  ));
test("stay dates must form a valid interval", () =>
  assert.throws(
    () =>
      validateRsvp(
        {
          ...base(),
          stay: {
            required: "Yes",
            people: 1,
            arrival: "2027-01-02",
            departure: "2027-01-01",
            notes: "",
          },
        },
        2,
      ),
    /dates/,
  ));
test("empty confirmed response rejected", () =>
  assert.throws(
    () =>
      validateRsvp(
        { ...base(), members: [{ ...base().members[0], attendance: "No" }] },
        2,
      ),
    /at least one/,
  ));
test("CSV escapes formulas and quotes", () => {
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell('A"B'), '"A""B"');
});
