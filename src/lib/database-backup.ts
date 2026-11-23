import "server-only";
import { transaction } from "./db";
import { backupTables, backupSchema } from "./backup-format";

export async function exportBackup() {
  return transaction(async (db) => {
    await db.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const tables: Record<string, unknown[]> = {};
    for (const table of backupTables) {
      const { rows } = await db.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t`,
      );
      tables[table] = rows.map((r) => r.row);
    }
    return backupSchema.parse({
      format: "wedding-workspace-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      tables,
    });
  });
}

export async function restoreBackup(input: unknown) {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success)
    throw Error("Choose a valid wedding workspace backup (version 1).");
  return transaction(async (db) => {
    // Prevent another admin/guest write between the empty check and restoration.
    await db.query(
      `LOCK TABLE ${backupTables.map((t) => `"${t}"`).join(",")} IN ACCESS EXCLUSIVE MODE`,
    );
    for (const table of backupTables.filter((t) => t !== "wedding")) {
      const { rowCount } = await db.query(`SELECT 1 FROM "${table}" LIMIT 1`);
      if (rowCount)
        throw Error(
          "Restore requires an empty wedding workspace. Existing records were not changed. Use a new database to avoid overwriting hosted work.",
        );
    }
    const { rows: columns } = await db.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY ordinal_position",
      [backupTables],
    );
    // Validate against the destination schema before changing any records.
    for (const table of backupTables) {
      const names = columns
        .filter((c) => c.table_name === table)
        .map((c) => c.column_name as string);
      if (!names.length)
        throw Error(
          "Destination schema is missing tables. Run database setup first.",
        );
      for (const row of parsed.data.tables[table]) {
        if (
          Object.keys(row).length !== names.length ||
          names.some((name) => !Object.hasOwn(row, name))
        )
          throw Error(
            `Backup columns for ${table} do not match this app version.`,
          );
      }
    }
    await db.query("DELETE FROM wedding");
    let count = 0;
    for (const table of backupTables) {
      const rows = parsed.data.tables[table];
      if (rows.length) {
        // Preserve DB types and restore each table in one query for hosted latency.
        await db.query(
          `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
          [JSON.stringify(rows)],
        );
        count += rows.length;
      }
    }
    return { records: count, households: parsed.data.tables.households.length };
  });
}
