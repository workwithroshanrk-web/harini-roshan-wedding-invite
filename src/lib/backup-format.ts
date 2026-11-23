import { z } from "zod";

// Parent tables precede dependent tables for restoring foreign keys.
export const backupTables = [
  "wedding",
  "households",
  "members",
  "member_phones",
  "locations",
  "events",
  "event_rsvps",
  "properties",
  "rooms",
  "allocations",
  "notifications",
  "activity",
  "alerts",
  "trips",
  "stops",
  "dress_categories",
  "household_dress",
  "dress_classes",
  "dress_sizes",
  "member_dress",
] as const;
export const maxBackupBytes = 4 * 1024 * 1024;
const rows = z.array(z.record(z.unknown())).max(50000);
export function normalizeEventRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized = { ...row };
    for (const [key, value] of Object.entries({
      event_date: null,
      tamil_date: "",
      time_label: "",
    }))
      if (!Object.hasOwn(normalized, key)) normalized[key] = value;
    return normalized;
  });
}
export const backupSchema = z
  .object({
    format: z.literal("wedding-workspace-backup"),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    tables: z
      .object(
        Object.fromEntries(
          backupTables.map((t) => [
            t,
            [
              "member_phones",
              "dress_categories",
              "household_dress",
              "dress_classes",
              "dress_sizes",
              "member_dress",
            ].includes(t)
              ? rows.default([])
              : rows,
          ]),
        ),
      )
      .strict(),
  })
  .strict()
  .superRefine((backup, ctx) => {
    if (backup.tables.wedding.length !== 1 || backup.tables.wedding[0].id !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Backup must contain one wedding record.",
      });
  })
  .transform((backup) => {
    backup.tables.events = normalizeEventRows(backup.tables.events);
    return backup;
  });
export type WorkspaceBackup = z.infer<typeof backupSchema>;
