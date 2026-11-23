import pg from "pg";
import nextEnv from "@next/env";
import { celebrations } from "../src/lib/celebrations.ts";
if (process.argv.includes("--production")) process.env.NODE_ENV = "production";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL before saving the function details.");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS event_date date, ADD COLUMN IF NOT EXISTS tamil_date text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS time_label text NOT NULL DEFAULT ''",
  );
  if (!process.argv.includes("--schema-only")) {
    for (const e of celebrations) {
      const existing = await db.query(
        "SELECT id FROM events WHERE id=$1 OR lower(trim(name))=lower($2)",
        [e.id, e.name],
      );
      if (existing.rows.length > 1)
        throw Error(
          `Multiple matching events for ${e.name}; review before updating.`,
        );
      await db.query(
        "INSERT INTO events(id,name,starts,ends,location,description,event_date,tamil_date,time_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,starts=excluded.starts,ends=excluded.ends,location=excluded.location,event_date=excluded.event_date,tamil_date=excluded.tamil_date,time_label=excluded.time_label",
        [
          existing.rows[0]?.id || e.id,
          e.name,
          e.starts,
          e.ends,
          e.location,
          e.description,
          e.event_date,
          e.tamil_date,
          e.time_label,
        ],
      );
    }
    await db.query("UPDATE wedding SET date=$1,venue=$2 WHERE id=1", [
      "2027-04-18",
      "Divyaguru Mahal, Peraiyur",
    ]);
  }
  await db.query("COMMIT");
  console.log(
    process.argv.includes("--schema-only")
      ? "Event date and Tamil date fields ready."
      : "Wedding details and three celebrations saved (2027, IST).",
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
