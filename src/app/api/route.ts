import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import {
  admin,
  requireAdmin,
  verify,
  hash,
  token,
  household,
  limit,
} from "@/lib/security";
import {
  validateRsvp,
  csvCell,
  householdCapacity,
  expectedAfterAdding,
} from "@/lib/domain";
import {
  importHouseholds,
  contactImportContext,
} from "@/lib/import-households";
import {
  missingFamilyMembersSchema,
  additionalFamilyMemberSchema,
  phoneKey,
} from "@/lib/contacts";
export const dynamic = "force-dynamic";
const id = () => randomUUID();
const text = (v: unknown, max = 200) => {
  if (typeof v !== "string" || v.length > max)
    throw Error("Invalid text field.");
  return v.trim();
};
const number = (v: unknown, min = 0) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > 1000)
    throw Error("Invalid quantity.");
  return n;
};
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const rows = await query(
      `SELECT h.name,h.contact,h.mobile,h.category,h.status,h.delivery,count(m.id) FILTER(WHERE m.attendance='Yes') AS attending FROM households h LEFT JOIN members m ON m.household_id=h.id WHERE NOT h.archived GROUP BY h.id ORDER BY h.name`,
    );
    const keys = [
      "name",
      "contact",
      "mobile",
      "category",
      "status",
      "delivery",
      "attending",
    ];
    return new NextResponse(
      [
        keys.join(","),
        ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(",")),
      ].join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="wedding-guests.csv"',
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
export async function POST(req: NextRequest) {
  try {
    if (
      req.headers.get("origin") !==
      new URL(process.env.APP_URL || req.url).origin
    )
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const raw = await req.text();
    if (raw.length > 500000) throw Error("Request too large.");
    const b = JSON.parse(raw);
    const action = b.action;
    if (action === "login") {
      await limit("login:" + req.headers.get("x-forwarded-for"), 20);
      const email = text(b.email).toLowerCase();
      await limit("account:" + email, 10);
      const [a] = await query("SELECT * FROM admins WHERE email=$1", [email]);
      if (!a || !verify(text(b.password, 500), a.password))
        throw Error("Email or password is incorrect.");
      const t = token();
      await query(
        "INSERT INTO sessions(token,admin_id,expires) VALUES($1,$2,now()+interval '12 hours')",
        [hash(t), a.id],
      );
      (await cookies()).set("wedding_session", t, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 43200,
      });
      return NextResponse.json({ ok: true });
    }
    if (action === "logout") {
      const c = await cookies();
      await query("DELETE FROM sessions WHERE token=$1", [
        hash(c.get("wedding_session")?.value || ""),
      ]);
      c.delete("wedding_session");
      return NextResponse.json({ ok: true });
    }
    if (action === "rsvp" || action === "viewUpdates") {
      const h = await household(text(b.token));
      await limit("guest:" + h.id);
      if (action === "viewUpdates") {
        await query(
          "UPDATE notifications SET delivered_at=coalesce(delivered_at,now()),viewed_at=coalesce(viewed_at,now()) WHERE household_id=$1 AND published_at IS NOT NULL",
          [h.id],
        );
        return NextResponse.json({ ok: true });
      }
      const [registered] = await query(
        "SELECT count(*)::int AS n FROM members WHERE household_id=$1",
        [h.id],
      );
      const r = validateRsvp(
        b.data,
        householdCapacity(h.expected, h.additional, registered.n),
      );
      await transaction(async (db) => {
        const {
          rows: [current],
        } = await db.query(
          "SELECT * FROM households WHERE id=$1 AND NOT archived FOR UPDATE",
          [h.id],
        );
        if (!current || current.token_hash !== hash(b.token))
          throw Error("Invitation unavailable.");
        if (current.version !== r.version)
          throw Error(
            "Your response was updated elsewhere. Reload before editing again.",
          );
        const { rows: existingMembers } = await db.query(
          "SELECT id FROM members WHERE household_id=$1",
          [h.id],
        );
        if (
          r.members.length >
          householdCapacity(
            current.expected,
            current.additional,
            existingMembers.length,
          )
        )
          throw Error("Guest allowance changed. Please reload.");
        const {
          rows: [previous],
        } = await db.query(
          "SELECT count(*)::int AS count FROM members WHERE household_id=$1 AND attendance='Yes'",
          [h.id],
        );
        const changed = ["Confirmed", "Modified After Confirmation"].includes(
          current.status,
        );
        const existingIds = new Set(existingMembers.map((m) => m.id));
        const retained = r.members.flatMap((m) => (m.id ? [m.id] : []));
        if (
          new Set(retained).size !== retained.length ||
          retained.some((memberId) => !existingIds.has(memberId))
        )
          throw Error(
            "Invalid family member reference. Reload your invitation.",
          );
        await db.query(
          "DELETE FROM members WHERE household_id=$1 AND NOT(id=ANY($2::uuid[]))",
          [h.id, retained],
        );
        for (const m of r.members) {
          m.id ||= id();
          await db.query(
            "INSERT INTO members(id,household_id,name,attendance,age_group,accessibility,travel) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,attendance=excluded.attendance,age_group=excluded.age_group,accessibility=excluded.accessibility,travel=excluded.travel",
            [
              m.id,
              h.id,
              m.name,
              m.attendance,
              m.age_group,
              m.accessibility,
              JSON.stringify(m.travel || {}),
            ],
          );
        }
        await db.query(
          "UPDATE households SET status=$2,travel=$3,stay=$4,version=version+1 WHERE id=$1",
          [
            h.id,
            changed ? "Modified After Confirmation" : r.response,
            JSON.stringify(r.travel),
            JSON.stringify(r.stay),
          ],
        );
        await db.query(
          "INSERT INTO activity(id,household_id,actor,body) VALUES($1,$2,$3,$4)",
          [
            id(),
            h.id,
            "Guest",
            `RSVP ${r.response}: ${previous.count} → ${r.count} attending`,
          ],
        );
        const { rowCount } = await db.query(
          "SELECT id FROM allocations WHERE household_id=$1 AND status<>'Cancelled'",
          [h.id],
        );
        if (rowCount)
          await db.query(
            "INSERT INTO alerts(id,household_id,body) VALUES($1,$2,$3)",
            [
              id(),
              h.id,
              `Response changed: ${previous.count} → ${r.count} attending. Review existing accommodation and travel arrangements.`,
            ],
          );
      });
      return NextResponse.json({
        ok: true,
        message: `Thank you. Your response for ${r.count} attending guests has been recorded.`,
        members: r.members,
      });
    }
    const a = await requireAdmin();
    if (action === "contactImportContext")
      return NextResponse.json({
        ok: true,
        households: await contactImportContext(),
      });
    if (action === "importHouseholds" || action === "previewContactImport")
      return NextResponse.json({
        ok: true,
        households: await importHouseholds(
          b,
          a.email,
          action === "previewContactImport",
        ),
      });
    let result: Record<string, unknown> = { ok: true };
    await transaction(async (db) => {
      const audit = async (h: string | null, message: string) => {
        await db.query(
          "INSERT INTO activity(id,household_id,actor,body) VALUES($1,$2,$3,$4)",
          [id(), h, a.email, message],
        );
      };
      if (
        ["createDressCategory", "createDressClass", "createDressSize"].includes(
          action,
        )
      ) {
        const table =
          action === "createDressClass"
            ? "dress_classes"
            : action === "createDressSize"
              ? "dress_sizes"
              : "dress_categories";
        const name = text(b.name);
        if (!name) throw Error("Enter a dress option name.");
        await db.query(`INSERT INTO ${table}(id,name) VALUES($1,$2)`, [
          id(),
          name,
        ]);
        await audit(
          null,
          `Dress ${table === "dress_classes" ? "class" : table === "dress_sizes" ? "size" : "category"} created: ${name}`,
        );
      } else if (action === "assignMemberDress") {
        const {
          rows: [household],
        } = await db.query(
          "SELECT id FROM households WHERE id=$1 AND NOT archived FOR UPDATE",
          [text(b.householdId)],
        );
        if (!household) throw Error("Household unavailable.");
        const {
          rows: [member],
        } = await db.query(
          "SELECT id,name FROM members WHERE id=$1 AND household_id=$2",
          [text(b.memberId), household.id],
        );
        if (!member) throw Error("Choose a member of this household.");
        const categoryId = text(b.categoryId || ""),
          classId = text(b.classId || ""),
          sizeId = text(b.sizeId || "");
        for (const [table, optionId] of [
          ["dress_categories", categoryId],
          ["dress_classes", classId],
          ["dress_sizes", sizeId],
        ]) {
          if (
            optionId &&
            !(await db.query(`SELECT id FROM ${table} WHERE id=$1`, [optionId]))
              .rowCount
          )
            throw Error(
              "Choose existing dress category, class and size options.",
            );
        }
        if (categoryId || classId || sizeId)
          await db.query(
            "INSERT INTO member_dress(member_id,category_id,class_id,size_id) VALUES($1,$2,$3,$4) ON CONFLICT(member_id) DO UPDATE SET category_id=excluded.category_id,class_id=excluded.class_id,size_id=excluded.size_id",
            [member.id, categoryId || null, classId || null, sizeId || null],
          );
        else
          await db.query("DELETE FROM member_dress WHERE member_id=$1", [
            member.id,
          ]);
        await audit(
          household.id,
          `Dress details ${categoryId || classId || sizeId ? "assigned" : "cleared"} for ${member.name}`,
        );
      } else if (action === "assignDress") {
        const {
          rows: [household],
        } = await db.query(
          "SELECT id FROM households WHERE id=$1 AND NOT archived FOR UPDATE",
          [text(b.id)],
        );
        if (!household) throw Error("Household unavailable.");
        const categoryId = text(b.categoryId || "");
        if (categoryId) {
          const {
            rows: [category],
          } = await db.query(
            "SELECT id,name FROM dress_categories WHERE id=$1",
            [categoryId],
          );
          if (!category) throw Error("Choose an existing dress category.");
          await db.query(
            "INSERT INTO household_dress(household_id,category_id) VALUES($1,$2) ON CONFLICT(household_id) DO UPDATE SET category_id=excluded.category_id",
            [household.id, category.id],
          );
          await audit(
            household.id,
            `Dress category assigned: ${category.name}`,
          );
        } else {
          await db.query("DELETE FROM household_dress WHERE household_id=$1", [
            household.id,
          ]);
          await audit(household.id, "Dress category cleared");
        }
      } else if (action === "createHousehold") {
        await db.query(
          "LOCK TABLE households,members,member_phones IN SHARE ROW EXCLUSIVE MODE",
        );
        const linked = await db.query(
          "SELECT 1 FROM member_phones WHERE phone=$1",
          [phoneKey(text(b.mobile))],
        );
        if (linked.rowCount)
          throw Error(
            "This mobile is already used by a saved member. Mobile numbers must be unique; add contacts to their existing household.",
          );
        const hid = id(),
          t = token();
        const name = text(b.name);
        if (!name || !text(b.contact) || !text(b.mobile))
          throw Error("Name, contact and mobile are required.");
        await db.query(
          "INSERT INTO households(id,token_hash,name,contact,mobile,email,category,expected,additional,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            hid,
            hash(t),
            name,
            text(b.contact),
            text(b.mobile),
            text(b.email || ""),
            text(b.category || ""),
            number(b.expected, 1),
            number(b.additional),
            text(b.tags || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          ],
        );
        await db.query(
          "INSERT INTO locations(id,household_id,kind,city,area,state,address) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id(),
            hid,
            "Primary",
            text(b.city),
            text(b.area || ""),
            text(b.state || ""),
            text(b.address || "", 1000),
          ],
        );
        await db.query(
          "INSERT INTO members(id,household_id,name) VALUES($1,$2,$3)",
          [id(), hid, text(b.contact)],
        );
        await audit(hid, "Household created");
        result = { ok: true, link: `/invite/${t}` };
      } else if (action === "rotateLink") {
        const t = token();
        await db.query("UPDATE households SET token_hash=$2 WHERE id=$1", [
          b.id,
          hash(t),
        ]);
        await audit(b.id, "Invitation link generated; previous link revoked");
        result = { ok: true, link: `/invite/${t}` };
      } else if (action === "editHousehold") {
        await db.query(
          "LOCK TABLE households,members,member_phones IN SHARE ROW EXCLUSIVE MODE",
        );
        const linked = await db.query(
          "SELECT 1 FROM member_phones p JOIN members m ON m.id=p.member_id WHERE p.phone=$1 AND m.household_id<>$2",
          [phoneKey(text(b.mobile)), b.id],
        );
        if (linked.rowCount)
          throw Error(
            "This mobile is already used by another household member. Mobile numbers must be unique.",
          );
        await db.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [
          b.id,
        ]);
        await db.query(
          "UPDATE households SET name=$2,contact=$3,mobile=$4,category=$5,tags=$6,notes=$7,expected=$8,additional=$9,version=version+1 WHERE id=$1",
          [
            b.id,
            text(b.name),
            text(b.contact),
            text(b.mobile),
            text(b.category),
            text(b.tags)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            text(b.notes, 4000),
            number(b.expected, 1),
            number(b.additional),
          ],
        );
        await audit(b.id, "Household details updated");
      } else if (action === "completeFamilyMembers") {
        const members = missingFamilyMembersSchema.safeParse(b.members);
        if (!members.success)
          throw Error(
            "Enter a name and valid age group for each remaining family member.",
          );
        const {
          rows: [h],
        } = await db.query(
          "SELECT id,expected FROM households WHERE id=$1 AND NOT archived FOR UPDATE",
          [text(b.id)],
        );
        if (!h) throw Error("Household unavailable.");
        const {
          rows: [existing],
        } = await db.query(
          "SELECT count(*)::int AS count FROM members WHERE household_id=$1",
          [h.id],
        );
        const missing = Math.max(0, h.expected - existing.count);
        if (members.data.length !== missing)
          throw Error(
            `This household needs details for ${missing} more family members. Reload and check the expected guest count.`,
          );
        for (const member of members.data)
          await db.query(
            "INSERT INTO members(id,household_id,name,age_group,accessibility) VALUES($1,$2,$3,$4,$5)",
            [id(), h.id, member.name, member.age_group, member.accessibility],
          );
        await db.query(
          "UPDATE households SET version=version+1,status=CASE WHEN status IN ('Confirmed','Modified After Confirmation') THEN 'Modified After Confirmation' ELSE status END WHERE id=$1",
          [h.id],
        );
        await db.query(
          "INSERT INTO alerts(id,household_id,body) SELECT $1,$2,'Family member details completed by admin. Review allocated rooms.' WHERE EXISTS(SELECT 1 FROM allocations WHERE household_id=$2 AND status<>'Cancelled')",
          [id(), h.id],
        );
        await audit(
          h.id,
          `Details added for ${missing} remaining family members`,
        );
      } else if (action === "addFamilyMember") {
        const parsed = additionalFamilyMemberSchema.safeParse(b);
        if (!parsed.success)
          throw Error(parsed.error.issues.map((i) => i.message).join(" "));
        const member = parsed.data;
        // Share the contact import lock order so primary and member phones cannot race.
        await db.query(
          "LOCK TABLE households,members,member_phones IN SHARE ROW EXCLUSIVE MODE",
        );
        const {
          rows: [h],
        } = await db.query(
          "SELECT * FROM households WHERE id=$1 AND NOT archived FOR UPDATE",
          [member.id],
        );
        if (!h) throw Error("Household unavailable.");
        if (h.version !== member.version)
          throw Error(
            "This household changed since you opened the form. Close and reopen Add family member to review the latest details.",
          );
        const {
          rows: [count],
        } = await db.query(
          "SELECT count(*)::int AS n FROM members WHERE household_id=$1",
          [h.id],
        );
        if (count.n >= 100)
          throw Error("A household supports up to 100 named members.");
        const mobile = phoneKey(member.phone);
        if (mobile) {
          const duplicate = await db.query(
            "SELECT 1 FROM member_phones WHERE phone=$1 UNION ALL SELECT 1 FROM households WHERE regexp_replace(regexp_replace(split_part(regexp_replace(mobile,'^tel:','','i'),';',1),'[^0-9]','','g'),'^00','')=$1 LIMIT 1",
            [mobile],
          );
          if (duplicate.rowCount)
            throw Error(
              "This mobile number is already saved. Edit the existing member or use contact import to match their details.",
            );
        }
        const memberId = id();
        await db.query(
          "INSERT INTO members(id,household_id,name,age_group,accessibility) VALUES($1,$2,$3,$4,$5)",
          [memberId, h.id, member.name, member.age_group, member.accessibility],
        );
        if (mobile)
          await db.query(
            "INSERT INTO member_phones(phone,display,member_id) VALUES($1,$2,$3)",
            [mobile, member.phone, memberId],
          );
        const expected = expectedAfterAdding(h.expected, count.n, count.n + 1);
        await db.query(
          "UPDATE households SET expected=$2,version=version+1,status=CASE WHEN status IN ('Confirmed','Modified After Confirmation') THEN 'Modified After Confirmation' ELSE status END WHERE id=$1",
          [h.id, expected],
        );
        await db.query(
          "INSERT INTO alerts(id,household_id,body) SELECT $1,$2,'Family member added by admin. Review allocated rooms.' WHERE EXISTS(SELECT 1 FROM allocations WHERE household_id=$2 AND status<>'Cancelled')",
          [id(), h.id],
        );
        await audit(
          h.id,
          `Family member added: ${member.name}. Expected guests: ${expected}.`,
        );
        result = { ok: true, memberId, expected, version: h.version + 1 };
      } else if (action === "member") {
        const {
          rows: [h],
        } = await db.query(
          "SELECT * FROM households WHERE id=$1 AND NOT archived FOR UPDATE",
          [b.id],
        );
        if (!h) throw Error("Household unavailable.");
        if (!text(b.name)) throw Error("Member name is required.");
        const {
          rows: [n],
        } = await db.query(
          "SELECT count(*)::int AS count FROM members WHERE household_id=$1",
          [b.id],
        );
        if (!b.memberId && n.count >= h.expected + h.additional)
          throw Error("Household member allowance reached.");
        if (
          !["Yes", "No", "Maybe"].includes(b.attendance) ||
          !["Infant", "Child", "Teen", "Adult", "Senior"].includes(b.age_group)
        )
          throw Error("Invalid member details.");
        if (b.memberId)
          await db.query(
            "UPDATE members SET name=$3,attendance=$4,age_group=$5,accessibility=$6 WHERE id=$1 AND household_id=$2",
            [
              b.memberId,
              b.id,
              text(b.name),
              b.attendance,
              b.age_group,
              text(b.accessibility || ""),
            ],
          );
        else
          await db.query(
            "INSERT INTO members(id,household_id,name,attendance,age_group,accessibility) VALUES($1,$2,$3,$4,$5,$6)",
            [
              id(),
              b.id,
              text(b.name),
              b.attendance,
              b.age_group,
              text(b.accessibility || ""),
            ],
          );
        await db.query(
          "UPDATE households SET version=version+1,status=CASE WHEN status IN ('Confirmed','Modified After Confirmation') THEN 'Modified After Confirmation' WHEN EXISTS(SELECT 1 FROM members WHERE household_id=$1 AND attendance='Yes') THEN 'Confirmed' ELSE status END WHERE id=$1",
          [b.id],
        );
        await db.query(
          "INSERT INTO alerts(id,household_id,body) SELECT $1,$2,'Member details changed by admin. Review allocated rooms.' WHERE EXISTS(SELECT 1 FROM allocations WHERE household_id=$2 AND status<>'Cancelled')",
          [id(), b.id],
        );
        await audit(b.id, "Family member saved");
      } else if (action === "location") {
        await db.query(
          "INSERT INTO locations(id,household_id,kind,city,area,state,address) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id(),
            b.id,
            "Secondary",
            text(b.city),
            text(b.area || ""),
            text(b.state || ""),
            text(b.address || "", 1000),
          ],
        );
        await audit(b.id, "Secondary location added");
      } else if (action === "delivery") {
        if (
          ![
            "Not Planned",
            "Planned",
            "Assigned",
            "Invitation Given",
            "Unable to Reach",
            "Digital Only",
          ].includes(b.delivery)
        )
          throw Error("Invalid delivery status.");
        await db.query(
          "UPDATE households SET delivery=$2,assignee=$3,visit_date=$4,visited_date=CASE WHEN $2='Invitation Given' THEN CURRENT_DATE ELSE visited_date END,sent_at=CASE WHEN $5 THEN now() ELSE sent_at END WHERE id=$1",
          [
            b.id,
            b.delivery,
            text(b.assignee || ""),
            b.visit_date || null,
            Boolean(b.sent),
          ],
        );
        await audit(b.id, `Invitation delivery: ${b.delivery}`);
      } else if (action === "archive") {
        await db.query(
          "UPDATE households SET archived=true,version=version+1 WHERE id=$1",
          [b.id],
        );
        await audit(b.id, "Household archived; invitation disabled");
      } else if (action === "room") {
        let pid = b.property;
        if (!pid) {
          const locationName = text(b.propertyName);
          if (!locationName || !text(b.name))
            throw Error("Stay location and room number are required.");
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended(lower($1),0))",
            [locationName],
          );
          const {
            rows: [existing],
          } = await db.query(
            "SELECT id FROM properties WHERE lower(trim(name))=lower($1) ORDER BY id LIMIT 1",
            [locationName],
          );
          pid = existing?.id;
          if (!pid) {
            pid = id();
            await db.query(
              "INSERT INTO properties(id,name,address,contact,instructions) VALUES($1,$2,$3,$4,$5)",
              [
                pid,
                text(b.propertyName),
                text(b.address || "", 1000),
                text(b.contact || ""),
                text(b.instructions || "", 2000),
              ],
            );
          }
        }
        const {
          rows: [duplicate],
        } = await db.query(
          "SELECT id FROM rooms WHERE property_id=$1 AND lower(trim(name))=lower($2)",
          [pid, text(b.name)],
        );
        if (duplicate)
          throw Error("This room already exists at this stay location.");
        await db.query(
          "INSERT INTO rooms(id,property_id,name,capacity) VALUES($1,$2,$3,$4)",
          [id(), pid, text(b.name), number(b.capacity, 1)],
        );
        await audit(null, "Room inventory added");
      } else if (action === "allocate") {
        let roomId = b.room;
        if (!roomId) {
          const locationName = text(b.location),
            roomNumber = text(b.roomNumber);
          if (!locationName || !roomNumber)
            throw Error("Stay location and room number are required.");
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended(lower($1),0))",
            [locationName],
          );
          let {
            rows: [property],
          } = await db.query(
            "SELECT id FROM properties WHERE lower(trim(name))=lower($1) ORDER BY id LIMIT 1",
            [locationName],
          );
          if (!property) {
            property = { id: id() };
            await db.query("INSERT INTO properties(id,name) VALUES($1,$2)", [
              property.id,
              locationName,
            ]);
          }
          const {
            rows: [existing],
          } = await db.query(
            "SELECT id FROM rooms WHERE property_id=$1 AND lower(trim(name))=lower($2)",
            [property.id, roomNumber],
          );
          roomId = existing?.id;
          if (!roomId) {
            roomId = id();
            await db.query(
              "INSERT INTO rooms(id,property_id,name,capacity) VALUES($1,$2,$3,$4)",
              [roomId, property.id, roomNumber, number(b.people, 1)],
            );
          }
        }
        const {
          rows: [room],
        } = await db.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
          roomId,
        ]);
        if (!room || number(b.people, 1) > room.capacity)
          throw Error("Room capacity exceeded.");
        await db.query(
          "INSERT INTO allocations(id,household_id,room_id,people,check_in,check_out) VALUES($1,$2,$3,$4,$5,$6)",
          [id(), b.id, roomId, number(b.people, 1), b.check_in, b.check_out],
        );
        await audit(b.id, "Accommodation allocated (unpublished)");
      } else if (action === "publishAllocation") {
        const {
          rows: [r],
        } = await db.query(
          "UPDATE allocations SET published=true WHERE id=$1 AND status<>'Cancelled' RETURNING *",
          [b.id],
        );
        if (!r) throw Error("Allocation unavailable.");
        await db.query(
          "INSERT INTO notifications(id,household_id,type,body,published_at) VALUES($1,$2,'Accommodation',$3,now())",
          [
            id(),
            r.household_id,
            "Accommodation has been arranged. See your published stay details below.",
          ],
        );
        await audit(r.household_id, "Accommodation published");
      } else if (action === "cancelAllocation") {
        const {
          rows: [r],
        } = await db.query(
          "UPDATE allocations SET status='Cancelled',published=false WHERE id=$1 RETURNING *",
          [b.id],
        );
        await db.query(
          "INSERT INTO notifications(id,household_id,type,body,published_at) VALUES($1,$2,'Accommodation',$3,now())",
          [
            id(),
            r.household_id,
            "Your room assignment has been cancelled. Please contact the wedding hosts for updated arrangements.",
          ],
        );
        await audit(r.household_id, "Accommodation cancelled");
      } else if (action === "notify") {
        if (
          ![
            "General",
            "RSVP",
            "Accommodation",
            "Travel",
            "Transport",
            "Event Update",
            "Reminder",
          ].includes(b.type)
        )
          throw Error("Invalid notification type.");
        await db.query(
          "INSERT INTO notifications(id,household_id,type,body,published_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END)",
          [id(), b.id, b.type, text(b.body, 4000), Boolean(b.publish)],
        );
        await audit(
          b.id,
          b.publish ? "Guest update published" : "Guest update drafted",
        );
      } else if (action === "publishNotification") {
        const {
          rows: [n],
        } = await db.query(
          "UPDATE notifications SET published_at=coalesce(published_at,now()) WHERE id=$1 RETURNING household_id",
          [b.id],
        );
        await audit(n.household_id, "Guest update published");
      } else if (action === "trip") {
        const tid = id();
        await db.query(
          "INSERT INTO trips(id,name,date,assignee) VALUES($1,$2,$3,$4)",
          [tid, text(b.name), b.date || null, text(b.assignee)],
        );
        if (!Array.isArray(b.locations) || !b.locations.length)
          throw Error("Select at least one household location.");
        for (const lid of b.locations) {
          await db.query(
            "INSERT INTO stops(id,trip_id,household_id,location_id) SELECT $1,$2,household_id,id FROM locations WHERE id=$3",
            [id(), tid, lid],
          );
        }
        await audit(null, "Invitation trip created");
      } else if (action === "stop") {
        if (
          ![
            "Pending",
            "Visited",
            "Invitation Given",
            "Skipped",
            "Reschedule",
          ].includes(b.status)
        )
          throw Error("Invalid stop status.");
        const {
          rows: [s],
        } = await db.query(
          "UPDATE stops SET status=$2 WHERE id=$1 RETURNING *",
          [b.id, b.status],
        );
        if (b.status === "Invitation Given")
          await db.query(
            "UPDATE households SET delivery='Invitation Given',visited_date=CURRENT_DATE WHERE id=$1",
            [s.household_id],
          );
        await db.query(
          "UPDATE trips SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM stops WHERE trip_id=$1 AND status IN ('Pending','Reschedule')) THEN 'Completed' ELSE 'In Progress' END WHERE id=$1",
          [s.trip_id],
        );
        await audit(s.household_id, `Trip stop: ${b.status}`);
      } else if (action === "resolve") {
        await db.query("UPDATE alerts SET resolved=true WHERE id=$1", [b.id]);
        await audit(null, "Allocation change alert reviewed");
      } else if (action === "wedding") {
        await db.query(
          "UPDATE wedding SET bride=$1,groom=$2,date=$3,venue=$4,contact=$5 WHERE id=1",
          [
            text(b.bride),
            text(b.groom),
            b.date || null,
            text(b.venue),
            text(b.contact),
          ],
        );
        await audit(null, "Wedding details updated");
      } else if (action === "event") {
        await db.query(
          "INSERT INTO events(id,name,starts,ends,location,description) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id(),
            text(b.name),
            b.starts || null,
            b.ends || null,
            text(b.location),
            text(b.description || "", 2000),
          ],
        );
        await audit(null, "Wedding event added");
      } else throw Error("Unknown action.");
    });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error & { code?: string; constraint?: string };
    const message =
      err.code === "23505" &&
      [
        "dress_categories_name_unique",
        "dress_classes_name_unique",
        "dress_sizes_name_unique",
      ].includes(err.constraint || "")
        ? "This dress option already exists. Choose it from the dropdown."
        : err.code === "23505" && err.constraint === "households_mobile_unique"
          ? "This mobile number is already used by another household. Mobile numbers must be unique, even when contact names differ."
          : err.code === "23P01"
            ? "This room is already allocated for overlapping dates."
            : err.code
              ? "The change could not be saved. Check required fields and dates."
              : err.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
