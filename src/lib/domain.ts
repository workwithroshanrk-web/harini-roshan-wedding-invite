import { z } from "zod";
// Recorded family members can always respond even when fewer guests are expected.
export function householdCapacity(
  expected: number,
  additional: number,
  registered: number,
) {
  return Math.max(expected + additional, registered);
}
export function expectedAfterAdding(
  expected: number,
  registered: number,
  nextCount: number,
) {
  return expected < registered ? expected : Math.max(expected, nextCount);
}
const short = z.string().trim().max(200);
const date = z.union([z.literal(""), z.string().date()]);
const localTime = z.union([
  z.literal(""),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .refine(
      (value) => Number.isFinite(Date.parse(value)),
      "Invalid travel date",
    ),
]);
export const travelSchema = z.object({
  required: z.enum(["Yes", "No", "Not decided"]),
  origin: short,
  mode: z.enum(["Car", "Bus", "Train", "Flight", "Other", "Not decided"]),
  arrival: localTime,
  departure: localTime,
  point: short,
  departurePoint: short,
  reference: short,
  notes: z.string().max(1000),
});
export const rsvpSchema = z.object({
  version: z.number().int().min(0),
  response: z.enum(["Confirmed", "Declined", "Maybe"]),
  members: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: short.min(1),
        attendance: z.enum(["Yes", "No", "Maybe"]),
        age_group: z.enum(["Infant", "Child", "Teen", "Adult", "Senior"]),
        accessibility: short,
        travel: travelSchema.optional(),
      }),
    )
    .min(1)
    .max(100),
  travel: travelSchema,
  stay: z.object({
    required: z.enum(["Yes", "No", "Not decided"]),
    people: z.number().int().min(0).max(100),
    arrival: date,
    departure: date,
    notes: z.string().max(1000),
  }),
});
export function validateRsvp(input: unknown, capacity: number) {
  const r = rsvpSchema.parse(input);
  for (const t of [
    r.travel,
    ...r.members.flatMap((m) => (m.travel ? [m.travel] : [])),
  ]) {
    if (t.arrival && t.departure && t.departure < t.arrival)
      throw Error("Departure must be after arrival.");
  }
  if (r.members.length > capacity)
    throw Error(`This invitation allows up to ${capacity} members.`);
  if (r.response !== "Confirmed")
    r.members = r.members.map((m) => ({
      ...m,
      attendance: r.response === "Declined" ? "No" : "Maybe",
    }));
  const count = r.members.filter((m) => m.attendance === "Yes").length;
  if (r.response === "Confirmed" && !count)
    throw Error("Select at least one attending member.");
  if (r.stay.required === "Yes" && (r.stay.people < 1 || r.stay.people > count))
    throw Error("Stay requests must be for attending members.");
  if (
    r.stay.required === "Yes" &&
    (!r.stay.arrival || !r.stay.departure || r.stay.departure <= r.stay.arrival)
  )
    throw Error("Enter valid check-in and check-out dates.");
  return { ...r, count };
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-]|^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
