import { z } from "zod";
import {
  backupSchema,
  backupTables,
  normalizeEventRows,
  type WorkspaceBackup,
} from "./backup-format";

export type DataTable = (typeof backupTables)[number];
export type DataRow = Record<string, unknown>;
export const transferSections = [
  {
    id: "households",
    label: "Households & family members",
    tables: ["households", "members", "member_phones", "locations"],
  },
  {
    id: "dress",
    label: "Dress categories, classes, sizes & assignments",
    tables: [
      "dress_categories",
      "dress_classes",
      "dress_sizes",
      "household_dress",
      "member_dress",
    ],
  },
  {
    id: "accommodation",
    label: "Accommodation & room allocations",
    tables: ["properties", "rooms", "allocations"],
  },
  {
    id: "events",
    label: "Events & event RSVPs",
    tables: ["events", "event_rsvps"],
  },
  {
    id: "trips",
    label: "Invitation trips & visits",
    tables: ["trips", "stops"],
  },
  {
    id: "updates",
    label: "Notifications, activity & alerts",
    tables: ["notifications", "activity", "alerts"],
  },
  { id: "wedding", label: "Wedding settings", tables: ["wedding"] },
] as const;
export type SectionId = (typeof transferSections)[number]["id"];
const sectionSchema = z.enum([
  "households",
  "dress",
  "accommodation",
  "events",
  "trips",
  "updates",
  "wedding",
]);
export const selectedSectionsSchema = z
  .array(sectionSchema)
  .min(1)
  .max(7)
  .refine((ids) => new Set(ids).size === ids.length);
export function sectionTables(sections: readonly SectionId[]): DataTable[] {
  const requested = new Set<string>(
    transferSections
      .filter((s) => sections.includes(s.id))
      .flatMap((s) => [...s.tables]),
  );
  return backupTables.filter((table) => requested.has(table));
}
const selectiveSchema = z
  .object({
    format: z.literal("wedding-workspace-backup"),
    version: z.literal(2),
    mode: z.literal("selective"),
    createdAt: z.string().datetime(),
    sections: selectedSectionsSchema,
    tables: z.record(
      z.enum(backupTables),
      z.array(z.record(z.unknown())).max(50000),
    ),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const table of sectionTables(file.sections))
      if (table !== "member_phones" && !Object.hasOwn(file.tables, table))
        ctx.addIssue({
          code: "custom",
          message: `Selected section is missing ${table}.`,
        });
    if (
      file.tables.wedding &&
      (file.tables.wedding.length !== 1 || file.tables.wedding[0].id !== 1)
    )
      ctx.addIssue({
        code: "custom",
        message: "Wedding settings must contain one wedding record.",
      });
  });
export const transferSchema = z.union([
  backupSchema,
  selectiveSchema.transform((file) => {
    if (file.tables.events)
      file.tables.events = normalizeEventRows(file.tables.events);
    return file;
  }),
]);
export type TransferFile = z.infer<typeof transferSchema>;
export const importModeSchema = z.enum(["restore", "keep", "update"]);
export type ImportMode = z.infer<typeof importModeSchema>;
export type ImportPreview = {
  token: string;
  added: number;
  updated: number;
  skipped: number;
  conflicts: number;
  tables: {
    name: string;
    added: number;
    updated: number;
    skipped: number;
    conflicts: number;
  }[];
};
export function primaryKeys(table: DataTable): string[] {
  if (table === "member_phones") return ["phone"];
  return table === "event_rsvps"
    ? ["event_id", "member_id"]
    : table === "household_dress"
      ? ["household_id"]
      : table === "member_dress"
        ? ["member_id"]
        : ["id"];
}
export function recordKey(table: DataTable, row: DataRow) {
  return JSON.stringify(primaryKeys(table).map((column) => row[column]));
}
// Supporting rows travel with a section so its foreign keys remain valid.
const references: Partial<Record<DataTable, [string, DataTable][]>> = {
  member_phones: [["member_id", "members"]],
  members: [["household_id", "households"]],
  locations: [["household_id", "households"]],
  event_rsvps: [
    ["event_id", "events"],
    ["member_id", "members"],
  ],
  rooms: [["property_id", "properties"]],
  allocations: [
    ["household_id", "households"],
    ["room_id", "rooms"],
  ],
  notifications: [["household_id", "households"]],
  activity: [["household_id", "households"]],
  alerts: [["household_id", "households"]],
  stops: [
    ["trip_id", "trips"],
    ["household_id", "households"],
    ["location_id", "locations"],
  ],
  household_dress: [
    ["household_id", "households"],
    ["category_id", "dress_categories"],
  ],
  member_dress: [
    ["member_id", "members"],
    ["category_id", "dress_categories"],
    ["class_id", "dress_classes"],
    ["size_id", "dress_sizes"],
  ],
};
export function selectExport(
  full: WorkspaceBackup,
  input: unknown,
): TransferFile {
  const sections = selectedSectionsSchema.parse(input);
  const included = new Map<DataTable, Map<string, DataRow>>();
  const byId = new Map(
    backupTables.map((t) => [
      t,
      new Map(full.tables[t].map((row) => [row.id, row])),
    ]),
  );
  function add(table: DataTable, row: DataRow) {
    if (!included.has(table)) included.set(table, new Map());
    const rows = included.get(table)!;
    const key = recordKey(table, row);
    if (rows.has(key)) return;
    rows.set(key, row);
    if (table === "members")
      for (const phone of full.tables.member_phones || [])
        if (phone.member_id === row.id) add("member_phones", phone);
    for (const [column, parent] of references[table] || []) {
      const value = row[column];
      if (value == null) continue;
      const related = byId.get(parent)?.get(value);
      if (!related) throw Error(`Missing supporting ${parent} record.`);
      add(parent, related);
    }
  }
  for (const table of sectionTables(sections)) {
    if (!included.has(table)) included.set(table, new Map());
    for (const row of full.tables[table]) add(table, row);
  }
  return selectiveSchema.parse({
    format: full.format,
    version: 2,
    mode: "selective",
    createdAt: full.createdAt,
    sections,
    tables: Object.fromEntries(
      backupTables
        .filter((t) => included.has(t))
        .map((t) => [t, [...included.get(t)!.values()]]),
    ),
  });
}
