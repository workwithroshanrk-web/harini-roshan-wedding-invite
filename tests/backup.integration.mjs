import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
if (process.argv[2] === "worker") {
  const {
    exportBackup,
    restoreBackup,
  } = require("../.tools/backup-test/database-backup.js");
  const { pool } = require("../.tools/backup-test/db.js");
  const {
    selectExport,
    transferSchema,
  } = require("../.tools/backup-test/data-transfer.js");
  const {
    previewImport,
    importBackup,
  } = require("../.tools/backup-test/import-backup.js");
  try {
    if (process.argv[3] === "export")
      console.log(JSON.stringify(await exportBackup()));
    else {
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      const backup = JSON.parse(input);
      if (["selective-empty", "restore-reviewed"].includes(process.argv[3])) {
        const selective = process.argv[3] === "selective-empty";
        const file = selective
          ? selectExport(backup, ["dress", "accommodation"])
          : backup;
        const mode = selective ? "keep" : "restore";
        const preview = await previewImport(file, mode);
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM households"))
            .rows[0].n,
          0,
        );
        await importBackup(file, mode, preview.token);
        const actual = await exportBackup();
        const sorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
        for (const [table, rows] of Object.entries(file.tables)) {
          assert.deepEqual(
            sorted(actual.tables[table]),
            sorted(rows),
            `fresh import preserves ${table}`,
          );
        }
        if (selective) {
          assert.equal(actual.tables.wedding[0].bride, "Harini");
          assert.equal(actual.tables.activity.length, 0);
          const repeat = await previewImport(file, "update");
          assert.equal(repeat.added, 0);
          assert.equal(repeat.updated, 0);
        }
        console.log(
          `PASS ${selective ? "selective sections and dependencies" : "reviewed full restore"} into a fresh database`,
        );
      } else {
        const fullPreview = await previewImport(backup, "restore");
        assert.ok(fullPreview.added > 0);
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM households"))
            .rows[0].n,
          0,
        );
        await assert.rejects(
          restoreBackup({ ...backup, version: 99 }),
          /valid wedding/,
        );
        const columns = structuredClone(backup);
        columns.tables.households[0].unknown = "bad";
        await assert.rejects(restoreBackup(columns), /columns/);
        const broken = structuredClone(backup);
        broken.tables.allocations[0].room_id = randomUUID();
        await assert.rejects(restoreBackup(broken));
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM households"))
            .rows[0].n,
          0,
        );
        assert.equal(
          (await pool.query("SELECT bride FROM wedding")).rows[0].bride,
          "Harini",
        );
        const duplicates = structuredClone(backup);
        duplicates.tables.households.push({
          ...duplicates.tables.households[0],
          id: randomUUID(),
          token_hash: randomUUID(),
          name: "Renamed duplicate",
        });
        await assert.rejects(restoreBackup(duplicates));
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM households"))
            .rows[0].n,
          0,
        );
        const attempts = await Promise.allSettled([
          restoreBackup(backup),
          restoreBackup(backup),
        ]);
        assert.equal(
          attempts.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(attempts.filter((r) => r.status === "rejected").length, 1);
        await assert.rejects(restoreBackup(backup), /empty wedding workspace/);
        const restored = await exportBackup();
        for (const table of Object.keys(backup.tables)) {
          const sorted = (rows) => rows.map((r) => JSON.stringify(r)).sort();
          assert.deepEqual(
            sorted(restored.tables[table]),
            sorted(backup.tables[table]),
            table,
          );
        }
        assert.equal(
          (await pool.query("SELECT email FROM admins")).rows[0].email,
          "destination@example.invalid",
        );
        console.log(
          "PASS full database round trip, dates/JSON/arrays, invitation tokens, archived records, invalid-backup rollback, mobile uniqueness, concurrent restore, repeat-restore refusal and destination admin preservation",
        );
        assert.throws(() => selectExport(backup, []));
        assert.throws(() => selectExport(backup, ["unknown"]));
        const dress = selectExport(backup, ["dress"]);
        assert.equal(dress.version, 2);
        assert.equal(Object.hasOwn(dress.tables, "wedding"), false);
        assert.equal(Object.hasOwn(dress.tables, "rooms"), false);
        assert.equal(dress.tables.households.length, 1);
        assert.equal(dress.tables.members.length, 1);
        const accommodation = selectExport(backup, ["accommodation"]);
        assert.equal(accommodation.tables.rooms.length, 1);
        assert.equal(accommodation.tables.households.length, 1);
        assert.equal(Object.hasOwn(accommodation.tables, "members"), false);
        const combined = selectExport(backup, [
          "households",
          "dress",
          "accommodation",
        ]);
        assert.equal(combined.tables.households.length, 1);
        assert.equal(Object.hasOwn(combined.tables, "activity"), false);
        assert.equal(
          transferSchema.safeParse({
            ...dress,
            tables: { ...dress.tables, admins: [] },
          }).success,
          false,
        );
        assert.equal(
          transferSchema.safeParse({
            ...dress,
            tables: { ...dress.tables, member_dress: undefined },
          }).success,
          false,
        );
        const incoming = structuredClone(dress);
        const newSize = randomUUID();
        incoming.tables.dress_sizes.push({
          id: newSize,
          name: "New imported size",
        });
        incoming.tables.member_dress[0].size_id = newSize;
        incoming.tables.households[0].name =
          "Supporting household must stay unchanged";
        const before = await exportBackup();
        const keep = await previewImport(incoming, "keep");
        assert.equal(keep.added, 1);
        assert.equal(keep.updated, 0);
        assert.deepEqual(
          (await exportBackup()).tables,
          before.tables,
          "preview never saves data",
        );
        await importBackup(incoming, "keep", keep.token);
        assert.equal(
          (await pool.query("SELECT size_id FROM member_dress")).rows[0]
            .size_id,
          backup.tables.member_dress[0].size_id,
        );
        const update = await previewImport(incoming, "update");
        assert.equal(update.updated, 1);
        await importBackup(incoming, "update", update.token);
        assert.equal(
          (await pool.query("SELECT size_id FROM member_dress")).rows[0]
            .size_id,
          newSize,
        );
        assert.equal(
          (await pool.query("SELECT name FROM households")).rows[0].name,
          backup.tables.households[0].name,
        );
        assert.deepEqual(
          (await exportBackup()).tables.allocations,
          before.tables.allocations,
        );
        const repeated = await previewImport(incoming, "update");
        assert.equal(repeated.added, 0);
        assert.equal(repeated.updated, 0);
        await importBackup(incoming, "update", repeated.token);
        const reassignedPhone = selectExport(await exportBackup(), [
          "households",
        ]);
        reassignedPhone.tables.member_phones[0].member_id = randomUUID();
        await assert.rejects(
          previewImport(reassignedPhone, "update"),
          /different saved member/,
        );
        const stale = await previewImport(incoming, "update");
        await pool.query(
          "UPDATE dress_classes SET name='Changed after preview'",
        );
        await assert.rejects(
          importBackup(incoming, "update", stale.token),
          /changed since your preview/,
        );
        const missingReference = structuredClone(dress);
        missingReference.tables.member_dress[0].member_id = randomUUID();
        await assert.rejects(
          previewImport(missingReference, "update"),
          /missing a required/,
        );
        const duplicateMobile = selectExport(backup, ["households"]);
        duplicateMobile.tables.households[0].id = randomUUID();
        duplicateMobile.tables.households[0].token_hash = randomUUID();
        await assert.rejects(
          previewImport(duplicateMobile, "keep"),
          /unique value/,
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM households"))
            .rows[0].n,
          1,
        );
        await assert.rejects(
          previewImport(dress, "restore"),
          /Selective files/,
        );
        const householdUpdate = selectExport(await exportBackup(), [
          "households",
        ]);
        householdUpdate.tables.households[0].name = "Renamed same mobile";
        const householdPreview = await previewImport(householdUpdate, "update");
        assert.equal(householdPreview.updated, 1);
        await importBackup(householdUpdate, "update", householdPreview.token);
        assert.equal(
          (await pool.query("SELECT name FROM households")).rows[0].name,
          "Renamed same mobile",
        );
        assert.equal(
          (await previewImport(householdUpdate, "update")).updated,
          0,
        );
        const overCapacity = selectExport(await exportBackup(), ["dress"]);
        for (let i = 0; i < 2; i++)
          overCapacity.tables.members.push({
            ...overCapacity.tables.members[0],
            id: randomUUID(),
          });
        const lowerExpected = await previewImport(overCapacity, "update");
        assert.equal(lowerExpected.added, 2);
        await importBackup(overCapacity, "update", lowerExpected.token);
        assert.equal(
          (await pool.query("SELECT expected FROM households")).rows[0]
            .expected,
          backup.tables.households[0].expected,
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM members")).rows[0].n,
          backup.tables.members.length + 2,
        );
        console.log(
          "PASS selective section dependencies, combined sections, preview rollback, keep/update modes, protected supporting records, repeat import, stale preview, missing references and duplicate-mobile conflicts",
        );
      }
    }
  } finally {
    await pool.end();
  }
} else {
  if (!process.env.DATABASE_URL?.includes("wedding_test"))
    throw Error("Use an isolated wedding_test database.");
  const directory = new URL("../.tools/backup-test/", import.meta.url);
  await mkdir(new URL("node_modules/server-only/", directory), {
    recursive: true,
  });
  // Next supplies this compile-time marker; the plain Node test harness needs an empty marker.
  await writeFile(
    new URL("node_modules/server-only/index.js", directory),
    "module.exports = {};\n",
  );
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/database-backup.ts",
      "src/lib/import-backup.ts",
      "--outDir",
      ".tools/backup-test",
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { stdio: "pipe" },
  );
  const control = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await control.connect();
  const suffix = randomBytes(6).toString("hex");
  const names = [
    `wedding_test_backup_source_${suffix}`,
    `wedding_test_backup_target_${suffix}`,
    `wedding_test_backup_selective_${suffix}`,
    `wedding_test_backup_reviewed_${suffix}`,
  ];
  const created = [];
  const connections = [];
  const urlFor = (name) => {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${name}`;
    return url.toString();
  };
  try {
    const schema = await readFile(
      new URL("../db/schema.sql", import.meta.url),
      "utf8",
    );
    for (const name of names) {
      await control.query(`CREATE DATABASE "${name}"`);
      created.push(name);
      const db = new pg.Client({ connectionString: urlFor(name) });
      await db.connect();
      connections.push(db);
      await db.query(schema);
    }
    const [source, target] = connections;
    await target.query(
      "INSERT INTO admins(id,email,password) VALUES($1,'destination@example.invalid','existing-password-hash')",
      [randomUUID()],
    );
    const h = randomUUID(),
      m = randomUUID(),
      e = randomUUID(),
      p = randomUUID(),
      r = randomUUID(),
      trip = randomUUID(),
      loc = randomUUID();
    const tokenHash = createHash("sha256")
      .update("preserved-private-invitation-token")
      .digest("hex");
    await source.query(
      "UPDATE wedding SET bride='Backup Bride',date='2027-01-01',venue='Restored venue'",
    );
    await source.query(
      "INSERT INTO households(id,token_hash,name,contact,mobile,expected,tags,travel,stay,archived,opened_at) VALUES($1,$2,'Backup family','Original name','+91 99999 12345',2,ARRAY['Family','Test'],$3,$4,true,now())",
      [
        h,
        tokenHash,
        JSON.stringify({ mode: "Train", arrival: "2027-01-01T08:00" }),
        JSON.stringify({ required: "Yes", people: 2 }),
      ],
    );
    await source.query(
      "INSERT INTO members(id,household_id,name,attendance) VALUES($1,$2,'Backup member','Yes')",
      [m, h],
    );
    await source.query(
      "INSERT INTO members(id,household_id,name) VALUES($1,$2,'Another mapped member')",
      [randomUUID(), h],
    );
    await source.query("UPDATE households SET expected=1 WHERE id=$1", [h]);
    await source.query(
      "INSERT INTO member_phones(phone,display,member_id) VALUES('919999912345','+91 99999 12345',$1)",
      [m],
    );
    await source.query(
      "INSERT INTO locations(id,household_id,kind,city) VALUES($1,$2,'Primary','Madurai')",
      [loc, h],
    );
    await source.query(
      "INSERT INTO events(id,name,starts) VALUES($1,'Wedding','2027-01-01T08:00:00+05:30')",
      [e],
    );
    await source.query(
      "INSERT INTO event_rsvps(event_id,member_id,attendance) VALUES($1,$2,'Yes')",
      [e, m],
    );
    await source.query(
      "INSERT INTO properties(id,name) VALUES($1,'Backup hotel')",
      [p],
    );
    await source.query(
      "INSERT INTO rooms(id,property_id,name,capacity) VALUES($1,$2,'101',3)",
      [r, p],
    );
    await source.query(
      "INSERT INTO allocations(id,household_id,room_id,people,check_in,check_out,published) VALUES($1,$2,$3,2,'2027-01-01','2027-01-03',true)",
      [randomUUID(), h, r],
    );
    await source.query(
      "INSERT INTO notifications(id,household_id,type,body,published_at) VALUES($1,$2,'General','Private update',now())",
      [randomUUID(), h],
    );
    await source.query(
      "INSERT INTO activity(id,household_id,actor,body) VALUES($1,$2,'Admin','Backup activity')",
      [randomUUID(), h],
    );
    await source.query(
      "INSERT INTO alerts(id,household_id,body,resolved) VALUES($1,$2,'Review stay',true)",
      [randomUUID(), h],
    );
    await source.query(
      "INSERT INTO trips(id,name,date,assignee) VALUES($1,'Invitation trip','2026-12-01','Planner')",
      [trip],
    );
    await source.query(
      "INSERT INTO stops(id,trip_id,household_id,location_id) VALUES($1,$2,$3,$4)",
      [randomUUID(), trip, h, loc],
    );
    const dressCategory = randomUUID();
    await source.query(
      "INSERT INTO dress_categories(id,name) VALUES($1,'Test dress category')",
      [dressCategory],
    );
    await source.query(
      "INSERT INTO household_dress(household_id,category_id) VALUES($1,$2)",
      [h, dressCategory],
    );
    const dressClass = randomUUID(),
      dressSize = randomUUID();
    await source.query(
      "INSERT INTO dress_classes(id,name) VALUES($1,'Formal')",
      [dressClass],
    );
    await source.query(
      "INSERT INTO dress_sizes(id,name) VALUES($1,'Custom size')",
      [dressSize],
    );
    await source.query(
      "INSERT INTO member_dress(member_id,category_id,class_id,size_id) VALUES($1,$2,$3,$4)",
      [m, dressCategory, dressClass, dressSize],
    );
    // The dashboard only shows the latest 500 activity records; a full export must include all of them.
    await source.query(
      "INSERT INTO activity(id,household_id,actor,body) SELECT gen_random_uuid(),$1,'Test','Historical activity ' || n FROM generate_series(1,501) n",
      [h],
    );
    const worker = (name, action, input) =>
      execFileSync(
        process.execPath,
        ["tests/backup.integration.mjs", "worker", action],
        {
          env: { ...process.env, DATABASE_URL: urlFor(name) },
          input,
          encoding: "utf8",
        },
      );
    const backup = worker(names[0], "export");
    const fullExport = JSON.parse(backup);
    const { rows: sourceTables } = await source.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT IN ('admins','sessions','rate_limits')",
    );
    assert.deepEqual(
      Object.keys(fullExport.tables).sort(),
      sourceTables.map((t) => t.table_name).sort(),
    );
    for (const table of Object.keys(fullExport.tables)) {
      const { rows: sourceRows } = await source.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t`,
      );
      const normalized = (rows) => rows.map((r) => JSON.stringify(r)).sort();
      assert.deepEqual(
        normalized(fullExport.tables[table]),
        normalized(sourceRows.map((r) => r.row)),
        `all fields and rows exported from ${table}`,
      );
    }
    assert.equal(fullExport.tables.activity.length, 502);
    console.log(
      "PASS full export includes all database tables, fields and rows, including archived households and activity beyond the dashboard limit",
    );
    assert.ok(!Object.hasOwn(JSON.parse(backup).tables, "admins"));
    console.log(worker(names[1], "restore", backup).trim());
    console.log(worker(names[2], "selective-empty", backup).trim());
    console.log(worker(names[3], "restore-reviewed", backup).trim());
    const origin = process.env.APP_URL || "http://localhost:3000";
    assert.equal((await fetch(origin + "/api/backup")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/backup", {
          method: "POST",
          headers: { Origin: origin },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(origin + "/api/backup", {
          method: "POST",
          headers: { Origin: "https://wrong.example.invalid" },
          body: "{}",
        })
      ).status,
      403,
    );
    console.log(
      "PASS backup API blocks anonymous export/restore and invalid origins",
    );
    const login = await fetch(origin + "/api", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "login",
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      }),
    });
    assert.ok(login.ok, "admin login");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    try {
      const adminPage = await fetch(origin + "/admin", {
        headers: { Cookie: cookie },
      });
      assert.equal(adminPage.status, 200);
      assert.ok((await adminPage.text()).includes("Export data"));
      const response = await fetch(origin + "/api/backup", {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.ok(
        response.headers.get("content-disposition").includes("attachment"),
      );
      const exported = await response.json();
      assert.equal(exported.format, "wedding-workspace-backup");
      assert.equal(Object.keys(exported.tables).length, 20);
      assert.equal(Object.hasOwn(exported.tables, "admins"), false);
      const selectiveResponse = await fetch(
        origin + "/api/backup?sections=dress,accommodation",
        { headers: { Cookie: cookie } },
      );
      assert.equal(selectiveResponse.status, 200);
      const selective = await selectiveResponse.json();
      assert.equal(selective.version, 2);
      assert.deepEqual(selective.sections, ["dress", "accommodation"]);
      assert.equal(Object.hasOwn(selective.tables, "wedding"), false);
      const review = await fetch(
        origin + "/api/backup?action=preview&mode=keep",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(selective),
        },
      );
      assert.equal(review.status, 200);
      assert.ok((await review.json()).preview.token);
      assert.equal(
        (
          await fetch(origin + "/api/backup?sections=unknown", {
            headers: { Cookie: cookie },
          })
        ).status,
        400,
      );
      const invalid = await fetch(origin + "/api/backup", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...exported, version: 99 }),
      });
      assert.equal(invalid.status, 400);
      const oversized = await fetch(origin + "/api/backup", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: " ".repeat(4 * 1024 * 1024 + 1),
      });
      assert.equal(oversized.status, 413);
      console.log(
        "PASS authenticated download, private response headers, excluded logins, invalid version and upload limit",
      );
    } finally {
      const sessionToken = decodeURIComponent(
        cookie.slice(cookie.indexOf("=") + 1),
      );
      await control.query("DELETE FROM sessions WHERE token=$1", [
        createHash("sha256").update(sessionToken).digest("hex"),
      ]);
    }
  } finally {
    for (const db of connections) await db.end();
    for (const name of created) await control.query(`DROP DATABASE "${name}"`);
    await control.end();
  }
}
