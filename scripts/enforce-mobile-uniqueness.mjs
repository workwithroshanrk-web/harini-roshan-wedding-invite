import pg from "pg";
import { readFile } from "node:fs/promises";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  const index = schema
    .split("\n")
    .find((line) => line.startsWith("CREATE UNIQUE INDEX"));
  // Existing duplicate records make this fail; never delete or merge saved households automatically.
  await db.query(index);
  console.log("Mobile uniqueness index ready.");
} finally {
  await db.end();
}
