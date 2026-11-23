import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVcard,
  phoneKey,
  householdImportSchema,
  resizeImportMembers,
  matchSavedContact,
} from "../src/lib/contacts.ts";
const card = (body: string) =>
  `BEGIN:VCARD\r\nVERSION:3.0\r\n${body}\r\nEND:VCARD\r\n`;
test("saved contacts match secondary numbers regardless of names; names alone never auto-match", () => {
  const households = [
    {
      id: "h",
      name: "Family",
      mobile: "123456",
      contact: "Primary",
      expected: 2,
      additional: 0,
      version: 0,
      archived: false,
      members: [
        {
          id: "m",
          name: "Original name",
          age_group: "Adult",
          phones: ["+91 98765 43210"],
        },
      ],
    },
  ];
  const matched = matchSavedContact(
    { id: "c", name: "Renamed", phones: ["0091-9876543210"] },
    households,
  );
  assert.equal(matched[0].members[0].id, "m");
  assert.equal(
    matchSavedContact(
      { id: "c", name: "Original name", phones: [] },
      households,
    ).length,
    0,
  );
  const primary = matchSavedContact(
    { id: "c", name: "New label", phones: ["123456"] },
    households,
  );
  assert.equal(primary[0].household.id, "h");
  assert.equal(primary[0].members.length, 0);
});
test("merges renamed contacts by normalized mobile number", () => {
  const r = parseVcard(
    card("FN:Kumar\r\nTEL;TYPE=CELL:+91 99999 11111") +
      card("FN:Meena\r\nTEL:tel:+919999911111;ext=4"),
  );
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].name, "Kumar");
  assert.equal(r.contacts[0].phones.length, 1);
  assert.ok(r.warnings[0].includes("names differ"));
});
test("merging duplicates preserves other numbers and collapses overlapping records", () => {
  const r = parseVcard(
    card("FN:Original\r\nTEL:1234567") +
      card("FN:Other\r\nTEL:7654321") +
      card("FN:Renamed\r\nTEL:1234567\r\nTEL:7654321\r\nTEL:9876543"),
  );
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].name, "Original");
  assert.deepEqual(r.contacts[0].phones.sort(), [
    "1234567",
    "7654321",
    "9876543",
  ]);
});
test("unfolds names, supports grouped fields, escapes and structured name fallback", () => {
  const r = parseVcard(
    card("FN:Long தமிழ்\r\n name\\, Jr.\r\nitem1.TEL;PREF=1:123456789") +
      card("N:Family;Given;Middle;Dr.;Jr."),
  );
  assert.equal(r.contacts[0].name, "Long தமிழ்name, Jr.");
  assert.equal(r.contacts[1].name, "Dr. Given Middle Family Jr.");
});
test("decodes legacy UTF-8 quoted-printable names and soft wrapping", () => {
  const r = parseVcard(
    card(
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=4A=6F=\r\n=73=C3=A9\r\nTEL:1234567",
    ),
  );
  assert.equal(r.contacts[0].name, "José");
});
test("deduplicates identical contacts, keeps no-phone members, ignores private properties", () => {
  const c = card(
    "FN:Kumar\r\nTEL:1234567\r\nEMAIL:private@example.invalid\r\nNOTE:secret",
  );
  const r = parseVcard(c + c + card("FN:Child"));
  assert.equal(r.contacts.length, 2);
  assert.equal(r.warnings.length, 2);
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.ok(!JSON.stringify(r).includes("private@"));
});
test("rejects malformed and unsupported files", () => {
  assert.throws(() => parseVcard("name,phone"));
  assert.throws(() => parseVcard("BEGIN:VCARD\nFN:Kumar"));
});
test("phone comparison removes formatting and international dialing prefix", () =>
  assert.equal(phoneKey("0091 (98765) 43210"), phoneKey("+91 9876543210")));
const group = () => ({
  id: "6c15b364-a465-4a54-81cc-27d52c9c67b1",
  name: "Kumar Family",
  primaryId: "c1",
  mobile: "1234567",
  expected: 2,
  additional: 0,
  category: "",
  city: "",
  area: "",
  allowDuplicatePhone: false,
  members: [
    { id: "c1", name: "Kumar", age_group: "Adult" },
    { id: "c2", name: "Meena", age_group: "Adult" },
  ],
});
test("validates a reviewed household mapping", () =>
  assert.equal(
    householdImportSchema.parse({ groups: [group()] }).groups.length,
    1,
  ));
test("expected guests require names for family members without phone contacts", () => {
  const original = group();
  const expanded = resizeImportMembers(
    original.members as any,
    4,
    new Set(["c1", "c2"]),
    (() => {
      let n = 0;
      return () => `extra-${++n}`;
    })(),
  );
  assert.equal(expanded.length, 4);
  assert.equal(expanded[0].name, "Kumar");
  assert.equal(expanded[1].name, "Meena");
  assert.equal(
    householdImportSchema.safeParse({
      groups: [{ ...original, expected: 4, members: expanded }],
    }).success,
    false,
  );
  expanded[2].name = "Third member";
  expanded[3].name = "Fourth member";
  assert.equal(
    householdImportSchema.safeParse({
      groups: [{ ...original, expected: 4, members: expanded }],
    }).success,
    true,
  );
  assert.equal(
    householdImportSchema.safeParse({ groups: [{ ...original, expected: 4 }] })
      .success,
    false,
  );
});
test("reducing expected count removes only blank slots and preserves entered family details", () => {
  const members = [
    { id: "contact", name: "", age_group: "Adult" as const },
    { id: "entered", name: "Named child", age_group: "Child" as const },
    { id: "blank", name: "", age_group: "Adult" as const },
  ];
  const resized = resizeImportMembers(
    members,
    1,
    new Set(["contact"]),
    () => "new",
  );
  assert.deepEqual(
    resized.map((m) => m.id),
    ["contact", "entered"],
  );
  assert.equal(members.length, 3);
});
test("rejects shared numbers despite different names and a legacy override", () => {
  const one = { ...group(), mobile: "+91 98765 43210" };
  const two = {
    ...group(),
    id: "6c15b364-a465-4a54-81cc-27d52c9c67b2",
    name: "Renamed contact",
    primaryId: "other",
    mobile: "0091-9876543210",
    allowDuplicatePhone: true,
    members: [{ id: "other", name: "Different name", age_group: "Adult" }],
  };
  const result = householdImportSchema.safeParse({ groups: [one, two] });
  assert.equal(result.success, false);
  if (!result.success)
    assert.ok(
      result.error.issues.some((i) => i.message.includes("must be unique")),
    );
});
test("rejects member reuse across households", () =>
  assert.equal(
    householdImportSchema.safeParse({
      groups: [
        group(),
        { ...group(), id: "6c15b364-a465-4a54-81cc-27d52c9c67b2" },
      ],
    }).success,
    false,
  ));
test("allows fewer expected guests than mapped contacts without losing members", () => {
  const result = householdImportSchema.parse({
    groups: [{ ...group(), expected: 1 }],
  });
  assert.equal(result.groups[0].expected, 1);
  assert.equal(result.groups[0].members.length, 2);
});
test("requires a member primary contact, positive expectation and a phone", () => {
  for (const bad of [{ primaryId: "absent" }, { expected: 0 }, { mobile: "" }])
    assert.equal(
      householdImportSchema.safeParse({ groups: [{ ...group(), ...bad }] })
        .success,
      false,
    );
});
