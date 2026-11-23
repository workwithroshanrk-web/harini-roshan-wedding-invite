import "server-only";
import { randomUUID } from "node:crypto";
import { transaction } from "./db";
import { expectedAfterAdding } from "./domain";
import { hash, token } from "./security";
import {
  householdImportSchema,
  phoneKey,
  type ContactHousehold,
} from "./contacts";

export async function contactImportContext(): Promise<ContactHousehold[]> {
  return transaction(async (db) => {
    await db.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const { rows: households } = await db.query(
      "SELECT id,name,contact,mobile,expected,additional,version,archived FROM households ORDER BY name",
    );
    const { rows: members } = await db.query(
      "SELECT m.id,m.household_id,m.name,m.age_group,coalesce(array_agg(p.display) FILTER(WHERE p.phone IS NOT NULL),'{}') AS phones FROM members m LEFT JOIN member_phones p ON p.member_id=m.id GROUP BY m.id",
    );
    return households.map((h) => ({
      ...h,
      members: members.filter((m) => m.household_id === h.id),
    })) as ContactHousehold[];
  });
}

export async function importHouseholds(
  input: unknown,
  actor: string,
  preview = false,
) {
  const parsed = householdImportSchema.safeParse(input);
  if (!parsed.success)
    throw Error(parsed.error.issues.map((i) => i.message).join(" "));
  return transaction(async (db) => {
    // Include manual edits and guest responses in the lock, not just other imports.
    await db.query(
      "LOCK TABLE households,members,member_phones IN SHARE ROW EXCLUSIVE MODE",
    );
    if (preview) await db.query("SAVEPOINT contact_preview");
    const { rows: existing } = await db.query("SELECT * FROM households");
    const { rows: savedMembers } = await db.query("SELECT * FROM members");
    const { rows: savedPhones } = await db.query(
      "SELECT p.*,m.household_id FROM member_phones p JOIN members m ON m.id=p.member_id",
    );
    const phoneOwners = new Map(savedPhones.map((p) => [p.phone, p]));
    const results: {
      id: string;
      name: string;
      link?: string;
      skipped?: boolean;
      merged?: boolean;
      added?: number;
      updated?: number;
      duplicates?: number;
      phonesAdded?: number;
      expected?: number;
    }[] = [];
    for (const g of parsed.data.groups) {
      const target = g.targetHouseholdId
        ? existing.find((h) => h.id === g.targetHouseholdId)
        : undefined;
      if (g.targetHouseholdId && (!target || target.archived))
        throw Error(
          "The selected household is unavailable or archived. Reload and choose an active household.",
        );
      if (target && target.version !== g.targetVersion)
        throw Error(
          `${target.name} changed since you loaded it. Reopen contact import and review the latest household before saving.`,
        );
      if (!target && existing.some((h) => h.id === g.id)) {
        results.push({ id: g.id, name: g.name, skipped: true });
        continue;
      }
      const hid = target?.id || g.id;
      const registered = savedMembers.filter(
        (m) => m.household_id === hid,
      ).length;
      if (!target) {
        const duplicate = existing.find(
          (h) => phoneKey(h.mobile) === phoneKey(g.mobile),
        );
        if (duplicate || phoneOwners.has(phoneKey(g.mobile)))
          throw Error(
            `The primary number for ${g.name} is already used by ${duplicate?.name || "a saved member"}. Mobile numbers must be unique. Choose Add to existing household.`,
          );
      }
      let invitation: string | undefined;
      if (!target) {
        const primary = g.members.find((m) => m.id === g.primaryId)!;
        const t = token();
        await db.query(
          "INSERT INTO households(id,token_hash,name,contact,mobile,category,expected,additional) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            hid,
            hash(t),
            g.name,
            primary.name,
            g.mobile,
            g.category,
            g.expected,
            g.additional,
          ],
        );
        invitation = `/invite/${t}`;
        existing.push({ id: hid, name: g.name, mobile: g.mobile });
      }
      let added = 0,
        updated = 0,
        duplicates = 0,
        phonesAdded = 0;
      const mappedIds = new Set<string>();
      for (const m of g.members) {
        const numbers = [
          ...new Map(
            [
              ...(m.phones || []),
              ...(!target && m.id === g.primaryId ? [g.mobile] : []),
            ].map((p) => [phoneKey(p), p]),
          ).entries(),
        ];
        const matches = new Set(
          numbers.flatMap(([key]) =>
            phoneOwners.has(key) ? [phoneOwners.get(key)!.member_id] : [],
          ),
        );
        if (m.existingMemberId) matches.add(m.existingMemberId);
        if (matches.size > 1)
          throw Error(
            `${m.name} has numbers belonging to different saved members. Split or correct this contact before importing.`,
          );
        const matchId = [...matches][0];
        const saved = matchId
          ? savedMembers.find((s) => s.id === matchId)
          : undefined;
        if (matchId && (!target || !saved || saved.household_id !== hid))
          throw Error(
            `${m.name} is already assigned to another household. Select that household; a contact cannot be added twice.`,
          );
        // A legacy household primary number may not yet have a known member mapping.
        for (const [key] of numbers) {
          const owner = existing.find((h) => phoneKey(h.mobile) === key);
          if (owner && owner.id !== hid)
            throw Error(
              `${m.name}'s number is already used by ${owner.name}. Choose that household instead.`,
            );
          if (target && owner && !saved)
            throw Error(
              `Match ${m.name} to an existing member of ${target.name} before saving this primary number.`,
            );
        }
        const mid = saved?.id || randomUUID();
        if (mappedIds.has(mid))
          throw Error(
            "Two selected contacts refer to the same saved member. Keep one mapping and combine its numbers.",
          );
        mappedIds.add(mid);
        if (saved) {
          if (
            m.updateDetails &&
            (saved.name !== m.name || saved.age_group !== m.age_group)
          ) {
            await db.query(
              "UPDATE members SET name=$2,age_group=$3 WHERE id=$1",
              [mid, m.name, m.age_group],
            );
            // Keep the household's primary contact label aligned when this is its primary member.
            if (
              numbers.some(([key]) => key === phoneKey(target.mobile)) ||
              savedPhones.some(
                (p) =>
                  p.member_id === mid && p.phone === phoneKey(target.mobile),
              )
            )
              await db.query("UPDATE households SET contact=$2 WHERE id=$1", [
                hid,
                m.name,
              ]);
            updated++;
          } else duplicates++;
        } else {
          await db.query(
            "INSERT INTO members(id,household_id,name,age_group) VALUES($1,$2,$3,$4)",
            [mid, hid, m.name, m.age_group],
          );
          savedMembers.push({
            id: mid,
            household_id: hid,
            name: m.name,
            age_group: m.age_group,
          });
          added++;
        }
        for (const [key, display] of numbers)
          if (!phoneOwners.has(key)) {
            await db.query(
              "INSERT INTO member_phones(phone,display,member_id) VALUES($1,$2,$3)",
              [key, display, mid],
            );
            phoneOwners.set(key, {
              phone: key,
              display,
              member_id: mid,
              household_id: hid,
            });
            phonesAdded++;
          }
      }
      let expected = g.expected;
      if (target) {
        const {
          rows: [count],
        } = await db.query(
          "SELECT count(*)::int AS n FROM members WHERE household_id=$1",
          [hid],
        );
        expected = expectedAfterAdding(target.expected, registered, count.n);
        if (count.n > 100)
          throw Error(
            "A household supports up to 100 named members. Split this group before importing.",
          );
        if (added || updated || phonesAdded) {
          await db.query(
            "UPDATE households SET expected=$2,version=version+1,status=CASE WHEN status IN ('Confirmed','Modified After Confirmation') THEN 'Modified After Confirmation' ELSE status END WHERE id=$1",
            [hid, expected],
          );
          if (added)
            await db.query(
              "INSERT INTO alerts(id,household_id,body) SELECT $1,$2,'Members added from contacts. Review room allocations and dress assignments.' WHERE EXISTS(SELECT 1 FROM allocations WHERE household_id=$2 AND status<>'Cancelled')",
              [randomUUID(), hid],
            );
        }
      } else if (g.city || g.area) {
        await db.query(
          "INSERT INTO locations(id,household_id,kind,city,area) VALUES($1,$2,'Primary',$3,$4)",
          [randomUUID(), hid, g.city, g.area],
        );
      }
      if (added || updated || phonesAdded)
        await db.query(
          "INSERT INTO activity(id,household_id,actor,body) VALUES($1,$2,$3,$4)",
          [
            randomUUID(),
            hid,
            actor,
            `Contacts imported: ${added} members added, ${updated} updated, ${duplicates} existing members kept, ${phonesAdded} numbers linked.`,
          ],
        );
      results.push({
        id: hid,
        name: target?.name || g.name,
        link: preview ? undefined : invitation,
        merged: !!target,
        added,
        updated,
        duplicates,
        phonesAdded,
        expected,
      });
    }
    if (preview) await db.query("ROLLBACK TO SAVEPOINT contact_preview");
    return results;
  });
}
