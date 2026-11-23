import { z } from "zod";

export type ImportedContact = { id: string; name: string; phones: string[] };
export type ContactHousehold = {
  id: string;
  name: string;
  mobile: string;
  contact: string;
  expected: number;
  additional: number;
  version: number;
  archived: boolean;
  members: { id: string; name: string; age_group: string; phones: string[] }[];
};
export function matchSavedContact(
  contact: ImportedContact,
  households: ContactHousehold[],
) {
  const keys = new Set(contact.phones.map(phoneKey));
  return households.flatMap((h) => {
    const members = h.members.filter((m) =>
      m.phones.some((p) => keys.has(phoneKey(p))),
    );
    return members.length || keys.has(phoneKey(h.mobile))
      ? [{ household: h, members }]
      : [];
  });
}
export function phoneKey(value: string) {
  return value
    .replace(/^tel:/i, "")
    .split(";")[0]
    .replace(/\D/g, "")
    .replace(/^00/, "");
}
function unescapeText(value: string) {
  return value
    .replace(/\\([nN,;\\])/g, (_, c: string) =>
      c.toLowerCase() === "n" ? " " : c,
    )
    .trim();
}
function parts(value: string) {
  return value.split(/(?<!\\);/).map(unescapeText);
}
function quotedPrintable(value: string, charset: string) {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "=" && /^[0-9a-f]{2}$/i.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...new TextEncoder().encode(value[i]));
  }
  return new TextDecoder(charset, { fatal: true }).decode(
    new Uint8Array(bytes),
  );
}
// Names and phone numbers only. Other vCard properties never enter the import payload.
export function parseVcard(source: string): {
  contacts: ImportedContact[];
  warnings: string[];
} {
  if (new TextEncoder().encode(source).length > 10 * 1024 * 1024)
    throw Error("Choose a contacts file smaller than 10 MB.");
  const lines = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
  const contacts: ImportedContact[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let card: {
    name: string;
    fallback: string;
    phones: { value: string; pref: number }[];
  } | null = null;
  let cards = 0,
    duplicates = 0,
    unnamed = 0;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.toUpperCase() === "BEGIN:VCARD") {
      if (card) throw Error("A contact is missing END:VCARD.");
      card = { name: "", fallback: "", phones: [] };
      cards++;
      if (cards > 5000) throw Error("Import up to 5,000 contacts at a time.");
      continue;
    }
    if (line.toUpperCase() === "END:VCARD") {
      if (!card) throw Error("Invalid contacts file.");
      const name = (card.name || card.fallback).trim();
      const phones = [
        ...new Map(
          card.phones
            .sort((a, b) => a.pref - b.pref)
            .map((p) => [phoneKey(p.value), p.value]),
        ).values(),
      ];
      if (!name) unnamed++;
      else {
        const matches = contacts.filter((c) =>
          c.phones.some((p) => phones.some((v) => phoneKey(v) === phoneKey(p))),
        );
        const key =
          name.toLocaleLowerCase() +
          "|" +
          phones.map(phoneKey).sort().join("|");
        if (matches.length) {
          const first = matches[0];
          first.phones = [
            ...new Map(
              [...matches.flatMap((c) => c.phones), ...phones].map((p) => [
                phoneKey(p),
                p,
              ]),
            ).values(),
          ];
          for (const match of matches.slice(1))
            contacts.splice(contacts.indexOf(match), 1);
          duplicates += matches.length;
        } else if (seen.has(key)) duplicates++;
        else {
          seen.add(key);
          contacts.push({ id: `contact-${cards}`, name, phones });
        }
      }
      card = null;
      continue;
    }
    if (!card) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const header = line.slice(0, colon),
      field = header.split(";")[0].split(".").pop()?.toUpperCase();
    if (!["FN", "N", "TEL"].includes(field || "")) continue;
    let value = line.slice(colon + 1);
    if (/ENCODING=QUOTED-PRINTABLE/i.test(header)) {
      while (value.endsWith("=") && i + 1 < lines.length)
        value = value.slice(0, -1) + lines[++i];
      try {
        value = quotedPrintable(
          value,
          /CHARSET="?([^;":]+)/i.exec(header)?.[1] || "utf-8",
        );
      } catch {
        throw Error(
          "A contact uses an unsupported text encoding. Export a UTF-8 vCard file.",
        );
      }
    }
    if (field === "FN") card.name = unescapeText(value);
    if (field === "N") {
      const [family, given, middle, prefix, suffix] = parts(value);
      card.fallback = [prefix, given, middle, family, suffix]
        .filter(Boolean)
        .join(" ");
    }
    if (field === "TEL") {
      const phone = unescapeText(value).replace(/^tel:/i, "").split(";")[0];
      if (phoneKey(phone).length >= 5 && phone.length <= 200)
        card.phones.push({
          value: phone,
          pref: Number(
            /(?:^|;)PREF=(\d+)/i.exec(header)?.[1] ||
              (/(?:[=;,])PREF(?:[;,]|$)/i.test(header) ? 1 : 100),
          ),
        });
    }
  }
  if (card) throw Error("The contacts file is incomplete (missing END:VCARD).");
  if (!cards || !contacts.length)
    throw Error("No named contacts found. Choose a .vcf contacts export.");
  if (duplicates)
    warnings.push(
      `${duplicates} duplicate contact(s) merged or skipped. Matching mobile numbers identify the same contact even when names differ; the first name is kept.`,
    );
  if (unnamed) warnings.push(`${unnamed} contact(s) without a name skipped.`);
  const missing = contacts.filter((c) => !c.phones.length).length;
  if (missing)
    warnings.push(
      `${missing} contact(s) have no phone number. They can be family members; add a primary household number before saving.`,
    );
  return { contacts, warnings };
}

const name = z.string().trim().min(1).max(200);
export const householdImportSchema = z
  .object({
    groups: z
      .array(
        z.object({
          id: z.string().uuid(),
          targetHouseholdId: z.string().uuid().optional(),
          targetVersion: z.number().int().min(0).optional(),
          name,
          primaryId: z.string().min(1).max(80),
          mobile: name.refine(
            (v) => phoneKey(v).length >= 5,
            "Enter a primary phone number.",
          ),
          expected: z.number().int().min(1).max(100),
          additional: z.number().int().min(0).max(100),
          category: z.string().trim().max(200),
          city: z.string().trim().max(200),
          area: z.string().trim().max(200),
          members: z
            .array(
              z.object({
                id: z.string().min(1).max(80),
                name: z
                  .string()
                  .trim()
                  .min(1, "Enter a name for every expected family member.")
                  .max(200),
                age_group: z.enum([
                  "Infant",
                  "Child",
                  "Teen",
                  "Adult",
                  "Senior",
                ]),
                phones: z
                  .array(
                    z
                      .string()
                      .trim()
                      .max(200)
                      .refine(
                        (v) => phoneKey(v).length >= 5,
                        "Invalid member phone number.",
                      ),
                  )
                  .max(30)
                  .optional(),
                existingMemberId: z.string().uuid().optional(),
                updateDetails: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine(({ groups }, ctx) => {
    const ids = new Set<string>(),
      contacts = new Set<string>(),
      phones = new Set<string>();
    const targets = new Set<string>(),
      memberPhones = new Set<string>(),
      savedMembers = new Set<string>();
    let total = 0;
    for (const g of groups) {
      if (g.targetHouseholdId) {
        if (g.targetVersion === undefined || targets.has(g.targetHouseholdId))
          ctx.addIssue({
            code: "custom",
            message:
              "Map each existing household once and reload its latest details before saving.",
          });
        targets.add(g.targetHouseholdId);
      }
      const mobile = phoneKey(g.mobile);
      if (phones.has(mobile))
        ctx.addIssue({
          code: "custom",
          message: `The primary mobile number for ${g.name} is already used by another mapped household. Mobile numbers must be unique.`,
        });
      phones.add(mobile);
      if (ids.has(g.id))
        ctx.addIssue({
          code: "custom",
          message: "A household is included twice.",
        });
      ids.add(g.id);
      if (!g.targetHouseholdId && !g.members.some((m) => m.id === g.primaryId))
        ctx.addIssue({
          code: "custom",
          message: `Choose a primary contact for ${g.name}.`,
        });
      if (!g.targetHouseholdId && g.expected > g.members.length)
        ctx.addIssue({
          code: "custom",
          message: `Enter details for all ${g.expected} expected family members in ${g.name}.`,
        });
      for (const m of g.members) {
        if (m.existingMemberId) {
          if (!g.targetHouseholdId || savedMembers.has(m.existingMemberId))
            ctx.addIssue({
              code: "custom",
              message:
                "An existing member can only be mapped once within their household.",
            });
          savedMembers.add(m.existingMemberId);
        }
        for (const phone of new Set((m.phones || []).map(phoneKey))) {
          if (memberPhones.has(phone))
            ctx.addIssue({
              code: "custom",
              message: "A mobile number cannot belong to two mapped members.",
            });
          memberPhones.add(phone);
        }
        if (contacts.has(m.id))
          ctx.addIssue({
            code: "custom",
            message: "A contact cannot belong to two imported households.",
          });
        contacts.add(m.id);
        total++;
      }
    }
    if (total > 500)
      ctx.addIssue({
        code: "custom",
        message: "Save up to 500 mapped contacts at a time.",
      });
  });
export type HouseholdImport = z.infer<
  typeof householdImportSchema
>["groups"][number];

export function resizeImportMembers(
  members: HouseholdImport["members"],
  expected: number,
  contactIds: ReadonlySet<string>,
  makeId: () => string,
) {
  if (!Number.isInteger(expected) || expected < 1 || expected > 100)
    return members;
  const next = [...members];
  // Only remove unnamed extra slots; preserve imported contacts and entered details.
  for (let i = next.length - 1; next.length > expected && i >= 0; i--)
    if (!contactIds.has(next[i].id) && !next[i].name.trim()) next.splice(i, 1);
  while (next.length < expected)
    next.push({ id: makeId(), name: "", age_group: "Adult" });
  return next;
}

export const missingFamilyMembersSchema = z
  .array(
    z.object({
      name,
      age_group: z.enum(["Infant", "Child", "Teen", "Adult", "Senior"]),
      accessibility: z.string().trim().max(200).default(""),
    }),
  )
  .min(1)
  .max(1000);

export const additionalFamilyMemberSchema =
  missingFamilyMembersSchema.element.extend({
    id: z.string().uuid(),
    version: z.number().int().min(0),
    phone: z
      .string()
      .trim()
      .max(200)
      .refine(
        (value) => !value || phoneKey(value).length >= 5,
        "Enter a valid mobile number or leave it blank.",
      )
      .default(""),
  });
