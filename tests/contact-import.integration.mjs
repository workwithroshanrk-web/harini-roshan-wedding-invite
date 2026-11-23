import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
if (!process.env.DATABASE_URL?.includes("wedding_test"))
  throw Error("Use an isolated wedding_test database.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const origin = process.env.APP_URL || "http://localhost:3100";
let cookie = "";
let checks = 0;
const ids = [];
const dressId = randomUUID();
async function post(action, data = {}, auth = true) {
  const r = await fetch(origin + "/api", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(auth ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ action, ...data }),
  });
  if (action === "login" && r.ok)
    cookie = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, ...(await r.json()) };
}
function ok(value, label) {
  assert.ok(value, label);
  checks++;
  console.log("PASS", label);
}
function group(name, phone) {
  const id = randomUUID();
  ids.push(id);
  return {
    id,
    name,
    primaryId: id + "-a",
    mobile: phone,
    expected: 4,
    additional: 1,
    category: "Contact import test",
    city: "Madurai",
    area: "Anna Nagar",
    allowDuplicatePhone: false,
    members: [
      { id: id + "-a", name: "Primary " + name, age_group: "Adult" },
      { id: id + "-b", name: "Child " + name, age_group: "Child" },
      {
        id: id + "-c",
        name: "Family member without phone",
        age_group: "Adult",
      },
      {
        id: id + "-d",
        name: "Second member without phone",
        age_group: "Senior",
      },
    ],
  };
}
try {
  ok(
    (await post("importHouseholds", { groups: [] }, false)).error,
    "anonymous contact imports blocked",
  );
  ok(
    (
      await post("login", {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
    ).ok,
    "admin signed in",
  );
  const one = group("Import test family", "+910000001111"),
    two = group("Other test family", "+910000002222");
  one.members[1].phones = ["+91 00000 05555", "+91 00000 05556"];
  const saved = await post("importHouseholds", { groups: [one, two] });
  ok(
    saved.ok &&
      saved.households.length === 2 &&
      saved.households.every((h) => h.link),
    "reviewed groups created with private invitation links",
  );
  const {
    rows: [stored],
  } = await db.query(
    "SELECT h.status,h.expected,h.contact,count(m.id)::int AS members,count(m.id) FILTER(WHERE m.attendance='Yes')::int AS attending FROM households h JOIN members m ON m.household_id=h.id WHERE h.id=$1 GROUP BY h.id",
    [one.id],
  );
  ok(
    stored.status === "Not Responded" &&
      stored.expected === 4 &&
      stored.members === 4 &&
      stored.attending === 0,
    "two mapped contacts and two extra family members are stored without confirming attendance",
  );
  const again = await post("importHouseholds", { groups: [one, two] });
  ok(
    again.ok && again.households.every((h) => h.skipped),
    "retry does not create duplicate households",
  );
  const fresh = group("Rollback test", "+910000003333"),
    duplicate = group("Duplicate test", "+91 00000 01111");
  const blocked = await post("importHouseholds", {
    groups: [fresh, duplicate],
  });
  ok(
    blocked.error?.includes("already used"),
    "duplicate primary phone is blocked even with a different contact name",
  );
  const {
    rows: [none],
  } = await db.query(
    "SELECT count(*)::int AS count FROM households WHERE id=$1",
    [fresh.id],
  );
  ok(none.count === 0, "failed batch rolls back all households");
  const allowed = await post("importHouseholds", {
    groups: [{ ...duplicate, allowDuplicatePhone: true }],
  });
  ok(
    allowed.error?.includes("must be unique"),
    "legacy shared-phone override cannot bypass uniqueness",
  );
  const renamed = await post("editHousehold", {
    ...one,
    contact: "Renamed primary",
    category: "Contact import test",
    tags: "",
    notes: "",
  });
  ok(renamed.ok, "contact name can change while keeping its own mobile number");
  const conflictingEdit = await post("editHousehold", {
    ...two,
    mobile: "+91 00000 01111",
    contact: "Another name",
    tags: "",
    notes: "",
  });
  ok(
    conflictingEdit.error?.includes("must be unique"),
    "editing another household cannot reuse a mobile number",
  );
  const manualDuplicate = await post("createHousehold", {
    ...duplicate,
    contact: "Manual renamed contact",
    city: "Madurai",
  });
  ok(
    manualDuplicate.error?.includes("must be unique"),
    "manual household creation also enforces mobile uniqueness",
  );
  const concurrentA = group("Concurrent A", "+910000009999");
  const concurrentB = group("Concurrent B", "0091 00000 09999");
  const concurrent = await Promise.all([
    post("importHouseholds", { groups: [concurrentA] }),
    post("importHouseholds", { groups: [concurrentB] }),
  ]);
  ok(
    concurrent.filter((r) => r.ok).length === 1 &&
      concurrent.filter((r) => r.error).length === 1,
    "concurrent imports save a shared number only once",
  );
  const bad = group("Bad mapping", "+910000004444");
  bad.primaryId = "not-a-member";
  ok(
    (await post("importHouseholds", { groups: [bad] })).error,
    "server rejects invalid primary mapping",
  );
  const page = await fetch(origin + saved.households[0].link);
  const incomplete = group("Existing incomplete family", "+910000008888");
  await db.query(
    "INSERT INTO households(id,token_hash,name,contact,mobile,expected) VALUES($1,$2,$3,'Primary',$4,4)",
    [incomplete.id, randomUUID(), incomplete.name, incomplete.mobile],
  );
  for (const member of incomplete.members.slice(0, 2))
    await db.query(
      "INSERT INTO members(id,household_id,name,age_group) VALUES($1,$2,$3,$4)",
      [randomUUID(), incomplete.id, member.name, member.age_group],
    );
  const remaining = [
    { name: "Third guest", age_group: "Teen" },
    {
      name: "Fourth guest",
      age_group: "Senior",
      accessibility: "Step-free access",
    },
  ];
  ok(
    (
      await post(
        "completeFamilyMembers",
        { id: incomplete.id, members: remaining },
        false,
      )
    ).error,
    "anonymous family completion blocked",
  );
  ok(
    (
      await post("completeFamilyMembers", {
        id: incomplete.id,
        members: remaining.slice(0, 1),
      })
    ).error,
    "remaining guest count enforced",
  );
  ok(
    (
      await post("completeFamilyMembers", {
        id: incomplete.id,
        members: [{ ...remaining[0], name: " " }, remaining[1]],
      })
    ).error,
    "missing family member name rejected",
  );
  ok(
    (
      await post("completeFamilyMembers", {
        id: incomplete.id,
        members: remaining,
      })
    ).ok,
    "two existing contacts can be completed with two family members",
  );
  const { rows: completed } = await db.query(
    "SELECT name,age_group,attendance,accessibility FROM members WHERE household_id=$1",
    [incomplete.id],
  );
  ok(
    completed.length === 4 &&
      completed.every((m) => m.attendance === "Maybe") &&
      completed.some(
        (m) =>
          m.name === "Fourth guest" &&
          m.age_group === "Senior" &&
          m.accessibility === "Step-free access",
      ),
    "family details persist without confirming attendance",
  );
  ok(
    (
      await post("completeFamilyMembers", {
        id: incomplete.id,
        members: remaining,
      })
    ).error,
    "repeated completion cannot duplicate guests",
  );
  ok(
    (
      await db.query("SELECT version FROM households WHERE id=$1", [
        incomplete.id,
      ])
    ).rows[0].version === 1,
    "family completion invalidates stale RSVP versions",
  );
  const adminPage = await fetch(origin + "/admin", {
    headers: { Cookie: cookie },
  });
  ok(adminPage.ok, "admin dashboard renders after family completion");
  ok(
    page.ok && (await page.text()).includes("Import test family"),
    "imported household has a working private guest portal",
  );
  ok(
    (await post("contactImportContext", {}, false)).error,
    "saved contact lookup requires admin sign-in",
  );
  const context = await post("contactImportContext");
  const family = context.households.find((h) => h.id === one.id);
  const primary = family.members.find((m) => m.name === one.members[0].name);
  const child = family.members.find((m) => m.name === one.members[1].name);
  ok(
    child.phones.length === 2 && primary.phones.length === 1,
    "all mapped member numbers persist for later VCF imports",
  );
  await db.query("INSERT INTO dress_categories(id,name) VALUES($1,$2)", [
    dressId,
    `Import preservation ${dressId}`,
  ]);
  await db.query(
    "INSERT INTO member_dress(member_id,category_id) VALUES($1,$2)",
    [child.id, dressId],
  );
  await db.query(
    "UPDATE members SET attendance='Yes',accessibility='Keep access details' WHERE id=$1",
    [child.id],
  );
  const {
    rows: [before],
  } = await db.query(
    "SELECT token_hash,additional,version FROM households WHERE id=$1",
    [one.id],
  );
  const later = {
    ...group("Later upload", one.mobile),
    targetHouseholdId: one.id,
    targetVersion: family.version,
    members: [
      {
        id: "later-duplicate",
        name: "Different contact label",
        age_group: "Adult",
        phones: ["0091 00000 05555", "+91 00000 05557"],
      },
      {
        id: "later-new",
        name: "New family member from second VCF",
        age_group: "Teen",
        phones: ["+91 00000 06666"],
      },
    ],
  };
  ok(
    (await post("previewContactImport", { groups: [later] }, false)).error,
    "anonymous contact preview blocked",
  );
  const preview = await post("previewContactImport", { groups: [later] });
  assert.ok(preview.ok, preview.error);
  ok(
    preview.households[0].added === 1 &&
      preview.households[0].duplicates === 1 &&
      preview.households[0].phonesAdded === 2,
    "later-file preview detects renamed duplicate, new member and new numbers",
  );
  ok(
    (
      await db.query(
        "SELECT count(*)::int n FROM members WHERE household_id=$1",
        [one.id],
      )
    ).rows[0].n === 4 &&
      !(
        await db.query("SELECT 1 FROM member_phones WHERE phone='910000006666'")
      ).rowCount,
    "preview saves no members or phone numbers",
  );
  const merged = await post("importHouseholds", { groups: [later] });
  assert.ok(merged.ok, merged.error);
  const {
    rows: [after],
  } = await db.query(
    "SELECT token_hash,expected,additional,version FROM households WHERE id=$1",
    [one.id],
  );
  ok(
    merged.households[0].merged &&
      after.expected === 5 &&
      after.additional === before.additional &&
      after.version === before.version + 1 &&
      after.token_hash === before.token_hash,
    "new VCF appends to existing household, adjusts expected count and preserves its invitation",
  );
  const {
    rows: [kept],
  } = await db.query(
    "SELECT m.*,d.category_id FROM members m JOIN member_dress d ON d.member_id=m.id WHERE m.id=$1",
    [child.id],
  );
  ok(
    kept.name === child.name &&
      kept.attendance === "Yes" &&
      kept.accessibility === "Keep access details" &&
      kept.category_id === dressId,
    "duplicate import preserves member identity, name, RSVP and individual dress assignment",
  );
  ok(
    (await post("importHouseholds", { groups: [later] })).error?.includes(
      "changed since",
    ),
    "replaying the same saved batch cannot duplicate even phone-less members",
  );
  later.id = randomUUID();
  later.targetVersion = after.version;
  const repeated = await post("importHouseholds", { groups: [later] });
  ok(
    repeated.ok &&
      repeated.households[0].added === 0 &&
      repeated.households[0].duplicates === 2,
    "re-uploaded numbers are deduplicated across files despite different contact names",
  );
  const renamedMember = {
    ...later,
    id: randomUUID(),
    members: [
      {
        ...later.members[0],
        existingMemberId: child.id,
        updateDetails: true,
        name: "Updated child name",
        age_group: "Teen",
      },
    ],
  };
  const renamedResult = await post("importHouseholds", {
    groups: [renamedMember],
  });
  ok(
    renamedResult.ok && renamedResult.households[0].updated === 1,
    "explicit member-detail update changes name without adding a person",
  );
  const freshContext = await post("contactImportContext");
  const latest = freshContext.households.find((h) => h.id === one.id);
  const legacy = latest.members.find(
    (m) => m.name === "Family member without phone",
  );
  const manualMatch = {
    ...later,
    id: randomUUID(),
    targetVersion: latest.version,
    members: [
      {
        id: "legacy",
        name: "Different old contact label",
        age_group: "Adult",
        existingMemberId: legacy.id,
        phones: ["+91 00000 07777"],
      },
    ],
  };
  ok(
    (await post("importHouseholds", { groups: [manualMatch] })).ok,
    "legacy member without phone can be explicitly matched to a new VCF number",
  );
  const current = (await post("contactImportContext")).households.find(
    (h) => h.id === one.id,
  );
  const wrong = {
    ...later,
    id: randomUUID(),
    targetVersion: current.version,
    members: [
      {
        id: "wrong",
        name: "Wrong household",
        age_group: "Adult",
        phones: [two.mobile],
      },
    ],
  };
  ok(
    (await post("importHouseholds", { groups: [wrong] })).error?.includes(
      "another household",
    ),
    "a saved number cannot be moved into another household",
  );
  const secondaryDuplicate = group(
    "Duplicate secondary number",
    "0091 00000 05556",
  );
  ok(
    (
      await post("importHouseholds", { groups: [secondaryDuplicate] })
    ).error?.includes("already used"),
    "a secondary member phone cannot create a duplicate household",
  );
  const invalid = {
    ...wrong,
    members: [
      {
        id: "bad",
        name: "Bad mapping",
        age_group: "Adult",
        existingMemberId: randomUUID(),
        phones: [],
      },
    ],
  };
  ok(
    (await post("importHouseholds", { groups: [invalid] })).error,
    "foreign or unknown member IDs rejected",
  );
  const concurrency = {
    ...later,
    id: randomUUID(),
    targetVersion: current.version,
    members: [
      {
        id: "race",
        name: "Concurrent new family member",
        age_group: "Adult",
        phones: [],
      },
    ],
  };
  const races = await Promise.all([
    post("importHouseholds", { groups: [concurrency] }),
    post("importHouseholds", {
      groups: [{ ...concurrency, id: randomUUID() }],
    }),
  ]);
  ok(
    races.filter((r) => r.ok).length === 1 &&
      races.filter((r) => r.error).length === 1,
    "concurrent additions with stale versions cannot duplicate a phone-less guest",
  );
  const updatedPortal = await fetch(origin + saved.households[0].link);
  const html = await updatedPortal.text();
  ok(
    updatedPortal.ok &&
      html.includes("New family member from second VCF") &&
      html.includes(child.id),
    "existing guest link reflects added members and retains IDs for future RSVP saves",
  );
  const { rows: rsvpMembers } = await db.query(
    "SELECT id,name,attendance,age_group,accessibility FROM members WHERE household_id=$1",
    [one.id],
  );
  const rsvpVersion = (
    await db.query("SELECT version FROM households WHERE id=$1", [one.id])
  ).rows[0].version;
  const guestSave = await post(
    "rsvp",
    {
      token: saved.households[0].link.split("/").pop(),
      data: {
        version: rsvpVersion,
        response: "Confirmed",
        members: rsvpMembers,
        travel: {
          required: "No",
          origin: "",
          mode: "Not decided",
          arrival: "",
          departure: "",
          point: "",
          departurePoint: "",
          reference: "",
          notes: "",
        },
        stay: {
          required: "No",
          people: 0,
          arrival: "",
          departure: "",
          notes: "",
        },
      },
    },
    false,
  );
  assert.ok(guestSave.ok, guestSave.error);
  ok(
    (
      await db.query(
        "SELECT count(*)::int n FROM member_phones WHERE member_id=$1",
        [child.id],
      )
    ).rows[0].n === 3 &&
      (
        await db.query(
          "SELECT category_id FROM member_dress WHERE member_id=$1",
          [child.id],
        )
      ).rows[0].category_id === dressId,
    "later guest RSVP preserves saved contact numbers and dress assignments",
  );
  // A forgotten member can join a household even when its previous allowance is full.
  await db.query("UPDATE households SET additional=0 WHERE id=$1", [two.id]);
  const {
    rows: [full],
  } = await db.query(
    "SELECT version,expected,token_hash FROM households WHERE id=$1",
    [two.id],
  );
  const { rows: originalMembers } = await db.query(
    "SELECT id,name FROM members WHERE household_id=$1 ORDER BY id",
    [two.id],
  );
  const addition = {
    id: two.id,
    version: full.version,
    name: "Forgotten family member",
    age_group: "Child",
    phone: "+91 00000 08881",
    accessibility: "Step-free access",
  };
  ok(
    (await post("addFamilyMember", addition, false)).error,
    "anonymous manual family additions blocked",
  );
  ok(
    (await post("addFamilyMember", { ...addition, name: " " })).error,
    "manual family additions require a member name",
  );
  ok(
    (
      await post("addFamilyMember", { ...addition, phone: one.mobile })
    ).error?.includes("already saved"),
    "manual family additions cannot reuse a saved mobile",
  );
  ok(
    (
      await post("addFamilyMember", { ...addition, phone: two.mobile })
    ).error?.includes("already saved"),
    "household primary contact cannot be duplicated as a new member",
  );
  const manualAddition = await post("addFamilyMember", addition);
  assert.ok(manualAddition.ok, manualAddition.error);
  const {
    rows: [expanded],
  } = await db.query(
    "SELECT expected,additional,version,token_hash FROM households WHERE id=$1",
    [two.id],
  );
  ok(
    expanded.expected === 5 &&
      expanded.additional === 0 &&
      expanded.version === full.version + 1 &&
      expanded.token_hash === full.token_hash,
    "adding a forgotten member expands a full household and preserves its invitation",
  );
  const {
    rows: [manualMember],
  } = await db.query(
    "SELECT m.name,m.attendance,m.accessibility,p.phone FROM members m JOIN member_phones p ON p.member_id=m.id WHERE m.id=$1",
    [manualAddition.memberId],
  );
  ok(
    manualMember.attendance === "Maybe" &&
      manualMember.accessibility === "Step-free access" &&
      manualMember.phone === "910000008881",
    "manual member details persist with unconfirmed attendance and optional phone tracking",
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT id,name FROM members WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",
        [two.id, originalMembers.map((m) => m.id)],
      )
    ).rows,
    originalMembers,
  );
  ok(
    (await post("addFamilyMember", addition)).error?.includes("changed since"),
    "repeating a saved manual addition cannot duplicate the guest",
  );
  const extra = {
    ...addition,
    version: expanded.version,
    name: "Another forgotten member",
    phone: "",
  };
  const concurrentManual = await Promise.all([
    post("addFamilyMember", extra),
    post("addFamilyMember", extra),
  ]);
  ok(
    concurrentManual.filter((r) => r.ok).length === 1 &&
      concurrentManual.filter((r) => r.error).length === 1,
    "phone-less members can be added and concurrent clicks save only one guest",
  );
  const grownPortal = await fetch(origin + saved.households[1].link);
  ok(
    grownPortal.ok &&
      (await grownPortal.text()).includes("Another forgotten member"),
    "new members appear under the same existing invitation",
  );
  const lowerEstimate = {
    ...group("Lower expected family", "+910000007444"),
    expected: 2,
    additional: 0,
  };
  ok(
    (await post("previewContactImport", { groups: [lowerEstimate] })).ok,
    "preview accepts four mapped contacts with only two expected guests",
  );
  const lowerSaved = await post("importHouseholds", {
    groups: [lowerEstimate],
  });
  assert.ok(lowerSaved.ok, lowerSaved.error);
  const { rows: lowerMembers } = await db.query(
    "SELECT id,name,attendance,age_group,accessibility FROM members WHERE household_id=$1",
    [lowerEstimate.id],
  );
  ok(
    lowerMembers.length === 4 &&
      (
        await db.query("SELECT expected FROM households WHERE id=$1", [
          lowerEstimate.id,
        ])
      ).rows[0].expected === 2,
    "lower expected count is saved without discarding mapped members",
  );
  const lowerResponse = {
    version: 0,
    response: "Confirmed",
    members: lowerMembers.map((m, i) => ({
      ...m,
      attendance: i === 0 ? "Yes" : "No",
    })),
    travel: {
      required: "No",
      origin: "",
      mode: "Not decided",
      arrival: "",
      departure: "",
      point: "",
      departurePoint: "",
      reference: "",
      notes: "",
    },
    stay: { required: "No", people: 0, arrival: "", departure: "", notes: "" },
  };
  const lowerToken = lowerSaved.households[0].link.split("/").pop();
  const lowerRsvp = await post(
    "rsvp",
    { token: lowerToken, data: lowerResponse },
    false,
  );
  assert.ok(lowerRsvp.ok, lowerRsvp.error);
  ok(
    lowerRsvp.members.length === 4,
    "all mapped members can RSVP when the expected count is lower",
  );
  ok(
    (
      await post(
        "rsvp",
        {
          token: lowerToken,
          data: {
            ...lowerResponse,
            version: 1,
            members: [
              ...lowerResponse.members,
              {
                name: "Beyond invitation",
                attendance: "No",
                age_group: "Adult",
                accessibility: "",
              },
            ],
          },
        },
        false,
      )
    ).error?.includes("allows up to"),
    "lower expectations do not permit unlimited additional guest records",
  );
  ok(
    (
      await post("editHousehold", {
        ...lowerEstimate,
        contact: lowerEstimate.members[0].name,
        expected: 1,
        tags: "",
        notes: "",
      })
    ).ok,
    "saved household expectation can be lowered below its member count",
  );
  const lowerVersion = (
    await db.query("SELECT version FROM households WHERE id=$1", [
      lowerEstimate.id,
    ])
  ).rows[0].version;
  const lowerAdd = await post("addFamilyMember", {
    id: lowerEstimate.id,
    version: lowerVersion,
    name: "Forgotten lower estimate member",
    age_group: "Adult",
  });
  ok(
    lowerAdd.ok && lowerAdd.expected === 1,
    "manual additions preserve an intentionally lower expectation",
  );
  const laterLow = {
    ...group("More contacts", lowerEstimate.mobile),
    targetHouseholdId: lowerEstimate.id,
    targetVersion: lowerAdd.version,
    members: [
      {
        id: "lower-new",
        name: "New contact for lower estimate",
        age_group: "Adult",
        phones: ["+910000007445"],
      },
    ],
  };
  const laterLowResult = await post("importHouseholds", { groups: [laterLow] });
  ok(
    laterLowResult.ok && laterLowResult.households[0].expected === 1,
    "later VCF imports also preserve the chosen lower expectation",
  );
  console.log(`${checks} contact import integration checks passed.`);
} finally {
  await db.query("DELETE FROM households WHERE id=ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM dress_categories WHERE id=$1", [dressId]);
  if (cookie) await post("logout");
  await db.end();
}
