import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { backupTables } from "./backup-format";
import {
  transferSchema,
  importModeSchema,
  sectionTables,
  primaryKeys,
  recordKey,
  type DataTable,
  type DataRow,
  type ImportMode,
  type ImportPreview,
} from "./data-transfer";

function explain(error: unknown): Error {
  const e = error as Error & { code?: string };
  if (e.code === "23505")
    return Error(
      "Import conflicts with a saved unique value, such as a mobile number, dress option or room. The records have different IDs. Resolve that duplicate before importing; nothing was changed.",
    );
  if (e.code === "23503")
    return Error(
      "This file is missing a required household, member or other linked record. Export the section again with its supporting records; nothing was changed.",
    );
  if (e.code)
    return Error(
      "Import contains invalid or conflicting data. Nothing was changed.",
    );
  return e;
}

async function buildPlan(
  db: PoolClient,
  input: unknown,
  requestedMode: unknown,
) {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success)
    throw Error("Choose a valid full or selective wedding data export.");
  const file = parsed.data,
    mode = importModeSchema.parse(requestedMode);
  if (mode === "restore" && file.version !== 1)
    throw Error(
      "Selective files must be merged using Keep existing or Update matching records.",
    );
  await db.query(
    `LOCK TABLE ${backupTables.map((t) => `"${t}"`).join(",")} IN ACCESS EXCLUSIVE MODE`,
  );
  if (mode === "restore") {
    for (const table of backupTables.filter((t) => t !== "wedding"))
      if ((await db.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount)
        throw Error(
          "Restore requires an empty wedding workspace. Choose a merge option to import into this workspace.",
        );
  }
  const tables = backupTables.filter((t) => Object.hasOwn(file.tables, t));
  const { rows: savedHouseholds } = await db.query("SELECT id FROM households");
  const savedHouseholdIds = new Set(savedHouseholds.map((h) => h.id));
  const primary = new Set<DataTable>(
    file.version === 1 ? backupTables : sectionTables(file.sections),
  );
  const { rows: columns } = await db.query(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY ordinal_position",
    [tables],
  );
  const operations: {
    table: DataTable;
    row: DataRow;
    update: boolean;
    columns: string[];
  }[] = [];
  const preview: ImportPreview = {
    token: "",
    added: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    tables: [],
  };
  const snapshot: unknown[] = [];
  const changedHouseholds = new Set<string>();
  for (const table of tables) {
    const names: string[] = columns
      .filter((c) => c.table_name === table)
      .map((c) => c.column_name);
    if (!names.length)
      throw Error(
        `Destination is missing ${table}. Update the database schema first.`,
      );
    const { rows } = await db.query(
      `SELECT to_jsonb(t) AS row FROM "${table}" t`,
    );
    const existing = new Map<string, DataRow>(
      rows.map((r) => [recordKey(table, r.row), r.row]),
    );
    snapshot.push([
      table,
      [...existing.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const seen = new Set<string>();
    const counts = {
      name: table,
      added: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
    };
    for (const row of file.tables[table] || []) {
      if (
        Object.keys(row).length !== names.length ||
        names.some((name) => !Object.hasOwn(row, name))
      )
        throw Error(
          `Backup columns for ${table} do not match this app version.`,
        );
      const key = recordKey(table, row);
      if (seen.has(key))
        throw Error(`The file contains a duplicate ${table} record.`);
      seen.add(key);
      const old = existing.get(key);
      if (old && table === "member_phones" && old.member_id !== row.member_id)
        throw Error(
          "A mobile number in this file belongs to a different saved member. Resolve that duplicate before importing; nothing was changed.",
        );
      // Version is an RSVP concurrency counter, not user-editable household data.
      const comparable =
        old && table === "households" && mode !== "restore"
          ? { ...row, version: old.version }
          : row;
      if (old && isDeepStrictEqual(old, comparable)) {
        counts.skipped++;
        continue;
      }
      if (old) {
        counts.conflicts++;
        // Supporting records establish references; existing supporting records are never overwritten.
        if (mode === "keep" || !primary.has(table)) {
          counts.skipped++;
          continue;
        }
        counts.updated++;
      } else counts.added++;
      operations.push({ table, row, update: !!old, columns: names });
      if (mode !== "restore" && old && table === "households")
        changedHouseholds.add(String(row.id));
      if (
        mode !== "restore" &&
        table === "members" &&
        savedHouseholdIds.has(row.household_id)
      )
        changedHouseholds.add(String(row.household_id));
      if (mode !== "restore" && table === "members" && old)
        changedHouseholds.add(String(old.household_id));
    }
    preview.tables.push(counts);
    for (const field of ["added", "updated", "skipped", "conflicts"] as const)
      preview[field] += counts[field];
  }
  preview.token = createHash("sha256")
    .update(JSON.stringify({ file, mode, snapshot }))
    .digest("hex");
  return { preview, operations, changedHouseholds, mode };
}

async function applyPlan(
  db: PoolClient,
  plan: Awaited<ReturnType<typeof buildPlan>>,
) {
  // Keep parent-first ordering, but batch rows to avoid a hosted DB round trip per record.
  for (let offset = 0; offset < plan.operations.length;) {
    const op = plan.operations[offset];
    const batch = [op.row];
    offset++;
    while (
      offset < plan.operations.length &&
      batch.length < 500 &&
      plan.operations[offset].table === op.table &&
      plan.operations[offset].update === op.update
    ) {
      batch.push(plan.operations[offset++].row);
    }
    const keys = primaryKeys(op.table);
    const assignments = op.columns
      .filter((name) => !keys.includes(name))
      .map((name) =>
        op.table === "households" &&
        name === "version" &&
        plan.mode !== "restore"
          ? `"version"=greatest("${op.table}"."version",excluded."version")`
          : `"${name}"=excluded."${name}"`,
      );
    const conflict = op.update
      ? ` ON CONFLICT (${keys.map((k) => `"${k}"`).join(",")}) DO UPDATE SET ${assignments.join(",")}`
      : "";
    await db.query(
      `INSERT INTO "${op.table}" SELECT * FROM jsonb_populate_recordset(NULL::"${op.table}",$1::jsonb)${conflict}`,
      [JSON.stringify(batch)],
    );
  }
  if (plan.changedHouseholds.size)
    await db.query(
      "UPDATE households SET version=version+1 WHERE id=ANY($1::uuid[])",
      [[...plan.changedHouseholds]],
    );
  const conflictingPhones = await db.query(
    "SELECT 1 FROM member_phones p JOIN members m ON m.id=p.member_id JOIN households h ON p.phone=regexp_replace(regexp_replace(split_part(regexp_replace(h.mobile,'^tel:','','i'),';',1),'[^0-9]','','g'),'^00','') WHERE h.id<>m.household_id LIMIT 1",
  );
  if (conflictingPhones.rowCount)
    throw Error(
      "A member mobile is already used by another household. Resolve that duplicate before importing; nothing was changed.",
    );
}

export async function previewImport(input: unknown, mode: ImportMode) {
  return transaction(async (db) => {
    const plan = await buildPlan(db, input, mode);
    await db.query("SAVEPOINT import_preview");
    try {
      await applyPlan(db, plan);
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT import_preview");
      throw explain(error);
    }
    // Exercise real unique/FK/check constraints without saving any preview changes.
    await db.query("ROLLBACK TO SAVEPOINT import_preview");
    return plan.preview;
  });
}

export async function importBackup(
  input: unknown,
  mode: ImportMode,
  token: string,
) {
  return transaction(async (db) => {
    const plan = await buildPlan(db, input, mode);
    if (!token || plan.preview.token !== token)
      throw Error(
        "The data or import options changed since your preview. Review the import again before saving.",
      );
    try {
      await applyPlan(db, plan);
    } catch (error) {
      throw explain(error);
    }
    return plan.preview;
  });
}
