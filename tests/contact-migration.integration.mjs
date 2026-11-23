import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";
if (!process.env.DATABASE_URL?.includes("wedding_test"))
  throw Error("Use an isolated wedding_test database.");
const control = new pg.Client({ connectionString: process.env.DATABASE_URL });
await control.connect();
const databaseName = `wedding_test_contact_migration_${randomUUID().replaceAll("-", "")}`;
const target = new URL(process.env.DATABASE_URL);
target.pathname = `/${databaseName}`;
let created = false,
  db;
try {
  await control.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  await db.query(
    schema
      .split("\n")
      .filter(
        (line) =>
          !/^CREATE (TABLE IF NOT EXISTS member_phones|INDEX IF NOT EXISTS member_phones_member_idx)/.test(
            line,
          ),
      )
      .join("\n"),
  );
  const householdId = randomUUID(),
    primaryId = randomUUID(),
    ambiguousId = randomUUID();
  await db.query(
    "INSERT INTO households(id,token_hash,name,contact,mobile,expected) VALUES($1,$2,'Legacy family','Primary','tel:0091-1234567890;ext=123',2),($3,$4,'Ambiguous family','Same name','1234509876',2)",
    [householdId, randomUUID(), ambiguousId, randomUUID()],
  );
  await db.query(
    "INSERT INTO members(id,household_id,name) VALUES($1,$2,'Primary'),($3,$2,'Secondary'),($4,$5,'Same name'),($6,$5,'Same name')",
    [
      primaryId,
      householdId,
      randomUUID(),
      randomUUID(),
      ambiguousId,
      randomUUID(),
    ],
  );
  for (const flags of [[], ["--production"]])
    execFileSync(process.execPath, ["scripts/setup-contacts.mjs", ...flags], {
      env: { ...process.env, DATABASE_URL: target.toString() },
      stdio: "pipe",
    });
  const { rows } = await db.query("SELECT * FROM member_phones");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "911234567890");
  assert.equal(rows[0].member_id, primaryId);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM members")).rows[0].n,
    4,
  );
  console.log(
    "PASS legacy contact migration, normalized primary phone backfill, ambiguous-name protection and repeat startup",
  );
} finally {
  if (db) await db.end();
  if (created) await control.query(`DROP DATABASE "${databaseName}"`);
  await control.end();
}
