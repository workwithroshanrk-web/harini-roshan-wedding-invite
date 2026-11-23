import pg from "pg";
import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
if (process.argv.includes("--production")) process.env.NODE_ENV = "production";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL before preparing contact imports.");
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
    .map((s) => s.trim())
    .filter((s) =>
      /^CREATE (TABLE IF NOT EXISTS member_phones\b|INDEX IF NOT EXISTS member_phones_member_idx\b)/.test(
        s,
      ),
    );
  if (statements.length !== 2) throw Error("Contact schema is incomplete.");
  await db.query("BEGIN");
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('contact-schema-migration',0))",
  );
  for (const statement of statements) await db.query(statement);
  // Older imports retained only the household primary number. Link only an unambiguous primary member.
  await db.query(`INSERT INTO member_phones(phone,display,member_id)
    SELECT n.phone,h.mobile,m.id
    FROM households h JOIN members m ON m.household_id=h.id AND lower(trim(m.name))=lower(trim(h.contact))
    CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(split_part(regexp_replace(h.mobile,'^tel:','','i'),';',1),'[^0-9]','','g'),'^00','') AS phone) n
    WHERE (SELECT count(*) FROM members n WHERE n.household_id=h.id AND lower(trim(n.name))=lower(trim(h.contact)))=1
    AND length(n.phone)>=5
    ON CONFLICT(phone) DO NOTHING`);
  await db.query("COMMIT");
  console.log("Contact phone tracking ready.");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
