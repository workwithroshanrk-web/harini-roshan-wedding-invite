import pg from "pg";
import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";

// Resolve .env.local and environment-specific files just as the app does.
if (process.argv.includes("--production")) process.env.NODE_ENV = "production";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL before preparing the Dress tables.");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
await db.connect();
try {
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  const statements = schema
    .split(";")
    .map((statement) => statement.trim())
    .filter((line) =>
      /^(CREATE TABLE IF NOT EXISTS (dress_categories|household_dress|dress_classes|dress_sizes|member_dress)|CREATE UNIQUE INDEX IF NOT EXISTS dress_(categories|classes|sizes)_name_unique)/.test(
        line,
      ),
    );
  if (statements.length !== 8)
    throw Error(
      "Dress schema is incomplete. Expected five tables and three indexes.",
    );
  await db.query("BEGIN");
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('dress-schema-migration',0))",
  );
  const {
    rows: [base],
  } = await db.query(
    "SELECT to_regclass('households') AS households, to_regclass('members') AS members",
  );
  if (!base.households || !base.members)
    throw Error(
      "Initialize this database with npm run db:setup before starting the app.",
    );
  for (const statement of statements) await db.query(statement);
  for (const table of [
    "dress_categories",
    "household_dress",
    "dress_classes",
    "dress_sizes",
    "member_dress",
  ]) {
    const {
      rows: [found],
    } = await db.query("SELECT to_regclass($1) AS table_name", [table]);
    if (!found.table_name)
      throw Error(`Dress migration did not create ${table}.`);
  }
  await db.query("COMMIT");
  const {
    rows: [target],
  } = await db.query("SELECT current_database() AS name");
  console.log(`Dress schema ready in database ${target.name}.`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
