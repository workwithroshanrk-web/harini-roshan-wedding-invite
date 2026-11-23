import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backupSchema, backupTables } from "../src/lib/backup-format.ts";
test("full export includes every persisted wedding data table", () => {
  const schema = readFileSync(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  const securityTables = new Set(["admins", "sessions", "rate_limits"]);
  const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)]
    .map((match) => match[1])
    .filter((name) => !securityTables.has(name));
  assert.deepEqual([...backupTables].sort(), tables.sort());
});
const backup = () => ({
  format: "wedding-workspace-backup",
  version: 1,
  createdAt: "2026-10-14T12:00:00.000Z",
  tables: Object.fromEntries(
    backupTables
      .filter(
        (t) =>
          ![
            "member_phones",
            "dress_categories",
            "household_dress",
            "dress_classes",
            "dress_sizes",
            "member_dress",
          ].includes(t),
      )
      .map((t) => [t, t === "wedding" ? [{ id: 1 }] : []]),
  ) as Record<string, Record<string, unknown>[]>,
});
test("older event backups receive empty date metadata without changing saved event fields", () => {
  const original = backup();
  original.tables.events = [
    {
      id: "event",
      name: "Old event",
      starts: null,
      ends: null,
      location: "Saved venue",
      description: "Saved description",
    },
  ];
  const parsed = backupSchema.parse(original);
  assert.deepEqual(parsed.tables.events[0], {
    ...original.tables.events[0],
    event_date: null,
    tamil_date: "",
    time_label: "",
  });
});
test("older backups load with no dress categories or assignments", () => {
  const parsed = backupSchema.parse(backup());
  assert.deepEqual(parsed.tables.dress_categories, []);
  assert.deepEqual(parsed.tables.household_dress, []);
  assert.deepEqual(parsed.tables.dress_classes, []);
  assert.deepEqual(parsed.tables.dress_sizes, []);
  assert.deepEqual(parsed.tables.member_dress, []);
  assert.deepEqual(parsed.tables.member_phones, []);
});
test("dress categories and assignments are preserved in new backups", () => {
  const original = backup();
  original.tables.dress_categories = [{ id: "category", name: "Chosen dress" }];
  original.tables.household_dress = [
    { household_id: "family", category_id: "category" },
  ];
  const parsed = backupSchema.parse(original);
  assert.deepEqual(
    parsed.tables.dress_categories,
    original.tables.dress_categories,
  );
  assert.deepEqual(
    parsed.tables.household_dress,
    original.tables.household_dress,
  );
});
