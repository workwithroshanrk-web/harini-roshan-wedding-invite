import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import pg from "pg";
if (!process.env.DATABASE_URL?.includes("wedding_test"))
  throw Error("Use an isolated wedding_test database.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const origin = process.env.APP_URL || "http://localhost:3000";
let cookie = "",
  checks = 0;
const householdId = randomUUID(),
  categoryName = `Dress test ${randomUUID()}`;
const categoryIds = [];
const guestToken = randomBytes(32).toString("base64url");
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
try {
  ok(
    (await post("createDressCategory", { name: categoryName }, false)).error,
    "anonymous category creation blocked",
  );
  ok(
    (await post("assignDress", { id: householdId, categoryId: "" }, false))
      .error,
    "anonymous dress assignment blocked",
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
  ok(
    (await post("createDressCategory", { name: " " })).error,
    "blank category rejected",
  );
  ok(
    (await post("createDressCategory", { name: categoryName })).ok,
    "chosen dress category created",
  );
  categoryIds.push(
    (
      await db.query("SELECT id FROM dress_categories WHERE name=$1", [
        categoryName,
      ])
    ).rows[0].id,
  );
  ok(
    (
      await post("createDressCategory", {
        name: ` ${categoryName.toUpperCase()} `,
      })
    ).error?.includes("already exists"),
    "duplicate category rejected regardless of case or spacing",
  );
  await db.query(
    "INSERT INTO households(id,token_hash,name,contact,mobile,expected) VALUES($1,$2,'Dress test family','Test contact',$3,2)",
    [
      householdId,
      createHash("sha256").update(guestToken).digest("hex"),
      String(Date.now()),
    ],
  );
  ok(
    (
      await db.query("SELECT * FROM household_dress WHERE household_id=$1", [
        householdId,
      ])
    ).rowCount === 0,
    "new households start unassigned",
  );
  ok(
    (await post("assignDress", { id: householdId, categoryId: categoryIds[0] }))
      .ok,
    "dress category assigned to household",
  );
  ok(
    (
      await db.query(
        "SELECT category_id FROM household_dress WHERE household_id=$1",
        [householdId],
      )
    ).rows[0].category_id === categoryIds[0],
    "assignment persisted in PostgreSQL",
  );
  ok(
    (await post("assignDress", { id: householdId, categoryId: randomUUID() }))
      .error,
    "nonexistent category rejected",
  );
  ok(
    (
      await db.query(
        "SELECT category_id FROM household_dress WHERE household_id=$1",
        [householdId],
      )
    ).rows[0].category_id === categoryIds[0],
    "invalid reassignment preserves saved category",
  );
  ok(
    (
      await post("assignDress", {
        id: randomUUID(),
        categoryId: categoryIds[0],
      })
    ).error,
    "nonexistent household rejected",
  );
  ok(
    (await post("createDressCategory", { name: categoryName + " second" })).ok,
    "second dress category created",
  );
  categoryIds.push(
    (
      await db.query("SELECT id FROM dress_categories WHERE name=$1", [
        categoryName + " second",
      ])
    ).rows[0].id,
  );
  ok(
    (await post("assignDress", { id: householdId, categoryId: categoryIds[1] }))
      .ok,
    "category can be changed",
  );
  ok(
    (
      await db.query(
        "SELECT category_id FROM household_dress WHERE household_id=$1",
        [householdId],
      )
    ).rows[0].category_id === categoryIds[1],
    "one category per household after reassignment",
  );
  const page = await fetch(origin + "/admin", { headers: { Cookie: cookie } });
  const html = await page.text();
  ok(
    page.ok && html.includes("Dress") && html.includes(categoryName),
    "admin page includes Dress tab and saved categories",
  );
  ok(
    (await post("assignDress", { id: householdId, categoryId: "" })).ok,
    "assignment can be cleared",
  );
  ok(
    (
      await db.query("SELECT * FROM household_dress WHERE household_id=$1", [
        householdId,
      ])
    ).rowCount === 0,
    "cleared household returns to unassigned",
  );
  ok(
    (
      await db.query(
        "SELECT * FROM activity WHERE household_id=$1 AND body LIKE 'Dress category%'",
        [householdId],
      )
    ).rowCount === 3,
    "assignment changes recorded in household activity",
  );
  const memberOne = randomUUID(),
    memberTwo = randomUUID();
  await db.query(
    "INSERT INTO members(id,household_id,name) VALUES($1,$3,'First member'),($2,$3,'Second member')",
    [memberOne, memberTwo, householdId],
  );
  for (const [action, table] of [
    ["createDressClass", "dress_classes"],
    ["createDressSize", "dress_sizes"],
  ]) {
    ok(
      (await post(action, { name: categoryName })).ok,
      `dynamic ${table} option added`,
    );
    ok(
      (
        await post(action, { name: ` ${categoryName.toUpperCase()} ` })
      ).error?.includes("already exists"),
      `duplicate ${table} option blocked`,
    );
    ok(
      (await post(action, { name: " " })).error,
      `blank ${table} option blocked`,
    );
  }
  const classId = (
    await db.query("SELECT id FROM dress_classes WHERE name=$1", [categoryName])
  ).rows[0].id;
  const sizeId = (
    await db.query("SELECT id FROM dress_sizes WHERE name=$1", [categoryName])
  ).rows[0].id;
  const assignment = {
    householdId,
    memberId: memberOne,
    categoryId: categoryIds[0],
    classId,
    sizeId,
  };
  ok(
    (await post("assignMemberDress", assignment, false)).error,
    "anonymous individual assignment blocked",
  );
  ok(
    (await post("assignMemberDress", assignment)).ok,
    "individual member category, class and size saved",
  );
  ok(
    (
      await post("assignMemberDress", {
        ...assignment,
        memberId: memberTwo,
        categoryId: categoryIds[1],
        sizeId: "",
      })
    ).ok,
    "second member has independent dress options",
  );
  const stored = (
    await db.query(
      "SELECT * FROM member_dress WHERE member_id=ANY($1::uuid[])",
      [[memberOne, memberTwo]],
    )
  ).rows;
  ok(
    stored.length === 2 &&
      stored.find((r) => r.member_id === memberOne).size_id === sizeId &&
      stored.find((r) => r.member_id === memberTwo).size_id === null,
    "individual choices persist independently",
  );
  ok(
    (await post("assignMemberDress", { ...assignment, memberId: randomUUID() }))
      .error,
    "member outside household rejected",
  );
  for (const key of ["categoryId", "classId", "sizeId"])
    ok(
      (await post("assignMemberDress", { ...assignment, [key]: randomUUID() }))
        .error,
      `invalid ${key} rejected`,
    );
  const data = {
    version: 0,
    response: "Maybe",
    members: [
      {
        id: memberOne,
        name: "Renamed first member",
        attendance: "Maybe",
        age_group: "Adult",
        accessibility: "",
      },
      {
        id: memberTwo,
        name: "Second member",
        attendance: "Maybe",
        age_group: "Child",
        accessibility: "",
      },
    ],
    travel: {
      required: "Not decided",
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
  const revised = await post("rsvp", { token: guestToken, data }, false);
  ok(
    revised.ok && revised.members[0].id === memberOne,
    "RSVP preserves stable member identities during renaming",
  );
  ok(
    (
      await db.query(
        "SELECT * FROM member_dress WHERE member_id=ANY($1::uuid[])",
        [[memberOne, memberTwo]],
      )
    ).rowCount === 2,
    "RSVP edits preserve individual dress assignments",
  );
  ok(
    (
      await post(
        "rsvp",
        {
          token: guestToken,
          data: {
            ...data,
            version: 1,
            members: [data.members[0], data.members[0]],
          },
        },
        false,
      )
    ).error,
    "duplicate RSVP member identities rejected",
  );
  ok(
    (
      await post(
        "rsvp",
        {
          token: guestToken,
          data: {
            ...data,
            version: 1,
            members: [{ ...data.members[0], id: randomUUID() }],
          },
        },
        false,
      )
    ).error,
    "foreign RSVP member identity rejected",
  );
  ok(
    (
      await post("assignMemberDress", {
        ...assignment,
        categoryId: "",
        classId: "",
        sizeId: "",
      })
    ).ok,
    "individual dress details can be cleared",
  );
  ok(
    (
      await db.query("SELECT * FROM member_dress WHERE member_id=$1", [
        memberOne,
      ])
    ).rowCount === 0 &&
      (
        await db.query("SELECT * FROM member_dress WHERE member_id=$1", [
          memberTwo,
        ])
      ).rowCount === 1,
    "clearing one member leaves other member unchanged",
  );
  console.log(`${checks} dress integration checks passed.`);
} finally {
  await db.query("DELETE FROM households WHERE id=$1", [householdId]);
  await db.query("DELETE FROM dress_classes WHERE name=$1", [categoryName]);
  await db.query("DELETE FROM dress_sizes WHERE name=$1", [categoryName]);
  await db.query("DELETE FROM dress_categories WHERE name=ANY($1::text[])", [
    [categoryName, categoryName + " second"],
  ]);
  await db.query(
    "DELETE FROM activity WHERE household_id IS NULL AND body=ANY($1::text[])",
    [
      [
        `Dress category created: ${categoryName}`,
        `Dress category created: ${categoryName} second`,
        `Dress class created: ${categoryName}`,
        `Dress size created: ${categoryName}`,
      ],
    ],
  );
  if (cookie)
    await db.query("DELETE FROM sessions WHERE token=$1", [
      createHash("sha256")
        .update(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)))
        .digest("hex"),
    ]);
  await db.end();
}
