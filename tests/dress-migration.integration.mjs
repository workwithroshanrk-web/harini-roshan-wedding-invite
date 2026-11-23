import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";

if (!process.env.DATABASE_URL?.includes("wedding_test"))
  throw Error("Use an isolated wedding_test database.");
const control = new pg.Client({ connectionString: process.env.DATABASE_URL });
await control.connect();
const databaseName = `wedding_test_dress_migration_${randomUUID().replaceAll("-", "")}`;
const target = new URL(process.env.DATABASE_URL);
target.pathname = `/${databaseName}`;
let created = false;
let db;
try {
  await control.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  const oldSchema = schema
    .split("\n")
    .filter(
      (line) =>
        !/^CREATE (TABLE IF NOT EXISTS (dress_classes|dress_sizes|member_dress)|UNIQUE INDEX IF NOT EXISTS dress_(classes|sizes)_name_unique)/.test(
          line,
        ),
    )
    .join("\n");
  await db.query(oldSchema);
  assert.equal(
    (await db.query("SELECT to_regclass('dress_classes') AS name")).rows[0]
      .name,
    null,
  );
  const householdId = randomUUID(),
    memberId = randomUUID(),
    categoryId = randomUUID();
  await db.query(
    "INSERT INTO households(id,token_hash,name,contact,mobile,expected) VALUES($1,$2,'Existing family','Contact','123456789',1)",
    [householdId, randomUUID()],
  );
  await db.query(
    "INSERT INTO members(id,household_id,name) VALUES($1,$2,'Existing member')",
    [memberId, householdId],
  );
  await db.query(
    "INSERT INTO dress_categories(id,name) VALUES($1,'Existing category')",
    [categoryId],
  );
  await db.query(
    "INSERT INTO household_dress(household_id,category_id) VALUES($1,$2)",
    [householdId, categoryId],
  );
  for (const flags of [[], ["--production"]]) {
    execFileSync(process.execPath, ["scripts/setup-dress.mjs", ...flags], {
      env: { ...process.env, DATABASE_URL: target.toString() },
      stdio: "pipe",
    });
  }
  for (const table of [
    "dress_categories",
    "household_dress",
    "dress_classes",
    "dress_sizes",
    "member_dress",
  ])
    assert.ok(
      (await db.query("SELECT to_regclass($1) AS name", [table])).rows[0].name,
      table,
    );
  assert.equal(
    (await db.query("SELECT name FROM members WHERE id=$1", [memberId])).rows[0]
      .name,
    "Existing member",
  );
  assert.equal(
    (
      await db.query(
        "SELECT category_id FROM household_dress WHERE household_id=$1",
        [householdId],
      )
    ).rows[0].category_id,
    categoryId,
  );
  console.log(
    "PASS missing dress_classes repaired; repeat and production startup preserve household, member and existing dress data",
  );
} finally {
  if (db) await db.end();
  if (created) await control.query(`DROP DATABASE "${databaseName}"`);
  await control.end();
}
