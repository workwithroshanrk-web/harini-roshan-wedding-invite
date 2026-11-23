// Run against an isolated test database and running local app. Never production.
import assert from "node:assert/strict";
import pg from "pg";
const origin = process.env.APP_URL || "http://localhost:3000";
if (!process.env.DATABASE_URL?.includes("wedding_test"))
  throw Error("Integration tests require a wedding_test database.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let cookie = "";
let checks = 0;
async function call(action, data = {}, authenticated = true) {
  const r = await fetch(origin + "/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(authenticated ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ action, ...data }),
  });
  if (action === "login" && r.ok)
    cookie = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, ...(await r.json()) };
}
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log("PASS", message);
}
try {
  ok(
    (await call("createHousehold", {}, false)).status === 400,
    "anonymous admin writes rejected",
  );
  ok(
    (await fetch(origin + "/api")).status === 401,
    "anonymous exports rejected",
  );
  ok(
    (
      await call("login", {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
    ).ok,
    "admin login",
  );
  const created = await call("createHousehold", {
    name: "Integration family",
    contact: "Test Guest",
    mobile: "0000000000",
    expected: 2,
    additional: 0,
    city: "Bengaluru",
    area: "Whitefield",
    category: "Test",
  });
  ok(created.link, "household and private link created");
  const adminPage = await fetch(origin + "/admin", {
    headers: { Cookie: cookie },
  });
  ok(
    adminPage.ok &&
      (await adminPage.text()).includes("A beautiful day starts here."),
    "authenticated dashboard renders",
  );
  const token = created.link.split("/").pop();
  const {
    rows: [h],
  } = await db.query(
    "SELECT * FROM households WHERE name='Integration family' ORDER BY id DESC LIMIT 1",
  );
  const travel = {
    required: "Yes",
    origin: "Bengaluru",
    mode: "Train",
    arrival: "2027-01-01T08:00",
    departure: "2027-01-03T09:00",
    point: "Station",
    departurePoint: "Station",
    reference: "",
    notes: "",
  };
  let response = {
    version: 0,
    response: "Confirmed",
    members: [
      {
        name: "Test Guest",
        attendance: "Yes",
        age_group: "Adult",
        accessibility: "",
      },
      {
        name: "Child",
        attendance: "Yes",
        age_group: "Child",
        accessibility: "",
      },
    ],
    travel,
    stay: {
      required: "Yes",
      people: 2,
      arrival: "2027-01-01",
      departure: "2027-01-03",
      notes: "",
    },
  };
  ok(
    (await call("rsvp", { token, data: response }, false)).ok,
    "guest RSVP saved without account",
  );
  ok(
    (await call("rsvp", { token, data: response }, false)).error?.includes(
      "elsewhere",
    ),
    "stale edit rejected",
  );
  ok(
    (await call("rsvp", { token: "x".repeat(43), data: response }, false))
      .error,
    "unknown token rejected",
  );
  ok(
    (
      await call("room", {
        propertyName: "Integration hotel",
        name: "101",
        capacity: 2,
      })
    ).ok,
    "room inventory created",
  );
  const {
    rows: [room],
  } = await db.query(
    "SELECT r.id FROM rooms r JOIN properties p ON p.id=r.property_id WHERE p.name='Integration hotel'",
  );
  const allocation = {
    id: h.id,
    location: "Integration hotel",
    roomNumber: "101",
    people: 2,
    check_in: "2027-01-01",
    check_out: "2027-01-03",
  };
  const booking = await Promise.all([
    call("allocate", {...allocation,location:"  INTEGRATION HOTEL  "}),
    call("allocate", allocation),
  ]);
  ok(
    booking.filter((x) => x.ok).length === 1 &&
      booking.some((x) => x.error?.includes("overlapping")),
    "concurrent overlapping room bookings blocked",
  );
  const {
    rows: [a],
  } = await db.query("SELECT id FROM allocations WHERE household_id=$1", [
    h.id,
  ]);
  ok((await call('room',{propertyName:'integration hotel',name:'101',capacity:2})).error?.includes('already exists'),'duplicate location and room rejected');
  let html = await (await fetch(origin + created.link)).text();
  ok(
    !html.includes("Integration hotel"),
    "unpublished allocation hidden from guest",
  );
  ok(
    (await call("publishAllocation", { id: a.id })).ok,
    "allocation published",
  );
  html = await (await fetch(origin + created.link)).text();
  ok(
    html.includes("Integration hotel"),
    "published allocation available to guest",
  );
  response = {
    ...response,
    version: 1,
    members: [
      response.members[0],
      { ...response.members[1], attendance: "No" },
    ],
    stay: { ...response.stay, people: 1 },
  };
  ok(
    (await call("rsvp", { token, data: response }, false)).ok,
    "guest can revise attendance",
  );
  const {
    rows: [alert],
  } = await db.query("SELECT * FROM alerts WHERE household_id=$1", [h.id]);
  ok(
    alert?.body.includes("2") && alert.body.includes("1"),
    "allocation change creates admin alert",
  );
  const {
    rows: [updated],
  } = await db.query("SELECT status FROM households WHERE id=$1", [h.id]);
  ok(
    updated.status === "Modified After Confirmation",
    "RSVP lifecycle tracks changes",
  );
  ok(
    (
      await call("notify", {
        id: h.id,
        type: "General",
        body: "Private test update",
        publish: true,
      })
    ).ok,
    "private guest update published",
  );
  ok(
    (await call("viewUpdates", { token }, false)).ok,
    "guest acknowledges updates",
  );
  const {
    rows: [notification],
  } = await db.query(
    "SELECT viewed_at FROM notifications WHERE household_id=$1 AND body='Private test update'",
    [h.id],
  );
  ok(notification.viewed_at, "view state persisted");
  const {
    rows: [loc],
  } = await db.query("SELECT id FROM locations WHERE household_id=$1", [h.id]);
  ok(
    (
      await call("trip", {
        name: "Integration trip",
        date: "2026-12-01",
        assignee: "Test coordinator",
        locations: [loc.id],
      })
    ).ok,
    "trip created from household location",
  );
  const {
    rows: [stop],
  } = await db.query("SELECT id FROM stops WHERE household_id=$1", [h.id]);
  ok(
    (await call("stop", { id: stop.id, status: "Invitation Given" })).ok,
    "trip stop updates delivery",
  );
  const csv = await fetch(origin + "/api", { headers: { Cookie: cookie } });
  ok(
    csv.ok && (await csv.text()).includes("Integration family"),
    "authenticated CSV export",
  );
  const rotated = await call("rotateLink", { id: h.id });
  ok(rotated.link && rotated.link !== created.link, "link can be rotated");
  ok(
    (await call("rsvp", { token, data: { ...response, version: 2 } }, false))
      .error,
    "old link revoked",
  );
  ok(
    (
      await fetch(origin + "/api", {
        method: "POST",
        headers: {
          Origin: "https://evil.invalid",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ action: "archive", id: h.id }),
      })
    ).status === 403,
    "cross-origin writes rejected",
  );
  ok((await call('allocate',{id:h.id,location:'Integration hotel',roomNumber:'Venue-A',people:1,check_in:'2027-02-01',check_out:'2027-02-02'})).ok,'new text room can be allocated without inventory setup');
  const {rows:[propertyCount]}=await db.query("SELECT count(*)::int AS count FROM properties WHERE lower(name)='integration hotel'");
  ok(propertyCount.count===1,'text locations reuse the existing property');
  console.log(`\n${checks} integration checks passed.`);
} finally {
  await db.query(
    "DELETE FROM stops WHERE household_id IN (SELECT id FROM households WHERE category='Test')",
  );
  await db.query("DELETE FROM trips WHERE name='Integration trip'");
  await db.query(
    "DELETE FROM allocations WHERE household_id IN (SELECT id FROM households WHERE category='Test')",
  );
  await db.query(
    "DELETE FROM alerts WHERE household_id IN (SELECT id FROM households WHERE category='Test')",
  );
  await db.query("DELETE FROM households WHERE category='Test'");
  await db.query(
    "DELETE FROM rooms WHERE property_id IN (SELECT id FROM properties WHERE name='Integration hotel')",
  );
  await db.query("DELETE FROM properties WHERE name='Integration hotel'");
  await db.end();
}
