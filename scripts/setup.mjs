import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
if (!process.env.ADMIN_EMAIL || (process.env.ADMIN_PASSWORD || "").length < 16)
  throw Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (16+ characters)");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query(
    await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString("hex");
  await db.query(
    "INSERT INTO admins(id,email,password) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET password=excluded.password",
    [randomUUID(), process.env.ADMIN_EMAIL.toLowerCase(), `${salt}:${hash}`],
  );
  console.log("Schema and admin ready.");
} finally {
  await db.end();
}
