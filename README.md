# Harini & Roshan — Wedding workspace

Mobile-first invitations and household-based wedding operations, built with Next.js App Router, React, and PostgreSQL. Real database persistence; no browser storage or filesystem database. Wedding details may remain TBD.

## Run locally

Requires Node.js 22.16+ and PostgreSQL 16+ with the `btree_gist` extension available.

1. `npm ci`
2. Copy `.env.example` to `.env`; set your database URL, application origin, admin email and a unique password of at least 16 characters.
3. `npm run db:setup` — creates tables and provisions the named admin. Run again with another email to add another admin. Reusing an email resets that admin's password.
4. `npm run dev` — checks and applies the Dress schema before starting Next.js.
5. Open `http://localhost:3000/admin`. Create a household and copy its generated invitation link.

Invitation tokens are hashed in the database. The raw link is returned only when created or rotated. Save it when shown. Rotation immediately revokes the old link. A link is a bearer credential; share it only with the intended household.

For an existing database, run `node --env-file=.env scripts/enforce-mobile-uniqueness.mjs` to add mobile uniqueness without resetting admin passwords. If saved households already share a number, the migration stops so they can be reviewed manually.

## Included workflows

- Public and private invitations show Poo Vaikum Function (20 January 2027, Thai 6, 6–8:30 PM), Engagement (17 April 2027, Chithirai 4, 6 PM), and Marriage (18 April 2027, Chithirai 5, 9 AM). Engagement and marriage are at Divyaguru Mahal, Peraiyur. Each function has its own countdown to the exact start time in India. The year 2027 uses the next upcoming dates.

Run `npm run db:celebrations` to save these details to an existing database. Startup prepares event date fields without overwriting saved schedules. Hosted deployments should run `node --experimental-strip-types scripts/setup-celebrations.mjs --production` against their database, or import a full/Events backup after preparing the schema. Details are defined in `src/lib/celebrations.ts`; event dates, Tamil dates and time labels are included in backups, and older exports import with empty values for these fields.

- Phone contacts import: read a `.vcf` file locally, select contacts, create a household or add them to an existing household, review the changes, then save. Every imported member's numbers are retained for duplicate detection across future VCF files, even when names change. Saved names change only when explicitly selected. New members remain unconfirmed. Unselected contacts, email addresses, photos and notes are not uploaded. Mobile numbers remain unique and country codes are not guessed. Repeated or concurrent saves cannot add a second copy of the same reviewed batch.

- Public invitation, editable wedding details, optional event dates and venues.
- Private guest RSVP wizard with member attendance, age bands, individual travel overrides, accommodation requests, review and later edits.
- Admin authentication with scrypt password hashes, opaque database sessions, HTTP-only cookies and database-backed rate limiting.
- Household creation/edit/archive, family members, configurable category/tag text, primary and secondary structured locations, internal notes and activity history.
- Member-derived headcount, combined household filters, travel summaries, CSV export and invitation opened/sent status.
- Property/room inventory, date-bound allocations, publication and cancellation; database exclusion constraint blocks overlapping bookings, including concurrent writes.
- Private notification drafts/publication/view state, manual WhatsApp text copying (no proactive messages sent).
- Location-based invitation trips, assigned people, visit status and delivery tracking.
- Optimistic RSVP versions prevent lost updates. Changes with existing room assignments raise review alerts.
- Vercel Analytics runs only on the public page; private invitation paths are excluded.

## Verification

`npm test` runs domain tests. `npm run build` includes TypeScript checks.

`node --env-file=.env tests/integration.mjs` tests real HTTP/database workflows against a running application. It refuses database URLs without `wedding_test`. Use an isolated database: it creates and removes synthetic records in the `Test` category. The checked-in repository contains no production credentials or real guest records.

## Vercel deployment

Connect this repository to Vercel, select Next.js, and supply `DATABASE_URL` and `APP_URL` (the exact HTTPS origin). Use a managed PostgreSQL connection string with TLS and connection pooling. Run `npm run db:setup` against that database from a trusted local environment, with the initial admin credentials set locally. Provision the database before deployment; do not run schema setup automatically on requests. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are only needed by setup, not by the deployed app. Keep database secrets server-side. Database state survives deploys.

## Scope and remaining product work

This is an initial implementation of the PRD's core workflows, not a claim that every requirement is production-complete. Additional admin roles are represented in the schema but V1 grants all admins the same permissions. Event-level RSVP has a relational table reserved for future UI. Transport allocation, messaging providers, CSV/Excel imports, maps, advanced analytics, retention/deletion tooling, event editing/deletion, detailed notification adapters and pagination are not implemented. Categories and tags are configured by entering values on household records. Stay demand and allocation are intentionally separate; a planner must assess requests before assigning rooms.

## Dress planning

Open the **Dress** tab and dynamically add your own **Dress category**, **Dress class**, and **Size category** options. Each named household member has a separate row with three dropdowns; choose their options and click **Save**. Members of the same household can have different dresses and sizes. Partial details can be saved, and choosing **Not selected** for all fields clears that member's assignment.

Search by member, household or mobile, filter by household, and review **Unassigned**, **Missing dress details** or **Complete** members. Add missing family member names in Households to include them in dress planning. Previous household categories remain visible for reference, while individual choices are assigned separately. Member identities and dress assignments are preserved when RSVP details or names change; removing a member removes their assignment.

`npm run dev` and `npm start` automatically apply and verify the Dress schema before starting the app. The migration reads the same environment files as Next.js, including `.env.local`; startup stops if it cannot prepare the tables. To repair a running installation, use `npm run db:dress`. For production environment files use `node scripts/setup-dress.mjs --production`. Hosted serverless deployments must run that migration against their destination database before deployment because they do not run `npm start`. This adds the dress tables without changing existing households or admin passwords. New database setup includes them automatically. Dress categories, classes, sizes and individual assignments are included in JSON backups; older backups restore with empty new dress tables.

`node --env-file=.env tests/dress-migration.integration.mjs` verifies migration of an older database missing the individual Dress tables, repeatability, and preservation of existing records.

`node --env-file=.env tests/dress.integration.mjs` verifies dynamic option validation, individual assignment, member ownership, authorization, persistence, clearing, and preservation during RSVP edits. The backup integration suite verifies the dress records survive transfer.

## Moving local work to the hosted app

1. In the local app, sign in and open **Export data** in the admin header (also available in Settings). Choose **Full data** or **Selective data** and tick the sections you want.
2. Connect the Vercel app to a hosted PostgreSQL database, set its `DATABASE_URL` and `APP_URL`, and run database setup once to provision the schema and destination admin. Use the same app version on both installations.
3. Sign in to the hosted app, open **Settings → Import & export wedding data**, and choose the downloaded JSON file. Choose how to handle existing records, click **Review import**, check the added/updated/skipped counts, then import the reviewed data.
4. Check your households and RSVPs. Previously saved private invitation paths keep their tokens; use the hosted site's origin instead of `localhost` when sharing them. Previously downloaded link CSV files still contain the old hostname.

The full JSON export includes every row and field in all 20 wedding data tables, regardless of current filters, archived state, or dashboard display limits. The household CSV is explicitly labelled as a summary. The backup includes: wedding details, households (including archived records), members and their saved phone numbers, locations, events and event RSVPs, properties, rooms, allocations, notifications, activity, alerts, trips, stops, dress categories, dress classes, sizes, previous household dress choices and individual member dress assignments. IDs, invitation token hashes, dates, JSON fields and mobile uniqueness are preserved. Destination admin accounts/passwords stay in place; login sessions and rate-limit counters are excluded.

Selective exports offer Households & family members, Dress, Accommodation, Events & event RSVPs, Invitation trips & visits, Notifications/activity/alerts, and Wedding settings. Required supporting records travel with the selected sections: for example, Dress includes the members and households referenced by its assignments. Unrelated sections are omitted.

Import detects full and selective files automatically, including older full backups. Choose **Restore full data into an empty workspace** for an initial full transfer (the default wedding-details row is allowed). For later transfers, use **Merge — keep existing records** to add missing records while keeping saved details, or **Merge — update matching records from this file** to apply changes within the selected sections. Matching uses persistent record IDs; names can change. Existing supporting records are preserved, records outside the file are untouched, and imports never delete records. Different IDs sharing a unique mobile, dress option or room are rejected and must be resolved before importing.

Preview validates database constraints without saving changes. Import rechecks the preview and saves everything in one transaction; if data changed since preview, review it again. Invalid references, duplicate mobiles, mismatched columns and room conflicts cannot leave a partial import. A merge is an explicit transfer, not automatic synchronization: review which copy should supply changes when both installations have been edited.

JSON export/upload is limited to 4 MB to fit [Vercel function payload limits](https://vercel.com/docs/functions/limitations). For larger databases, use the provider's PostgreSQL migration workflow or [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)/[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), with ownership and grants excluded for managed hosting. Backups contain private guest data and invitation token hashes: keep them private and outside Git.

Vercel runs the application; its data lives in the [connected hosted PostgreSQL provider](https://vercel.com/docs/postgres). Uploading a backup through Settings restores that database; it does not store data in Vercel's deployment filesystem.

`node --env-file=.env tests/backup.integration.mjs` verifies full and selective transfers across temporary isolated databases, preview rollback, keep/update modes, linked records, repeat imports, stale previews, concurrency, uniqueness and API access checks. It requires a `wedding_test` database URL with permission to create temporary test databases and the local app running. Temporary databases are removed afterward.

## Completing family member details

**Expected guests** can be fewer than the mapped family members: four contacts with two expected guests is valid. Reducing the estimate preserves all named members. The same rule applies to household edits and full/selective database imports. Existing members can always RSVP; guest additions remain bounded by the greater of the configured expected-plus-additional allowance and the number already recorded.

To add a forgotten member at any time, open the household and click **+ Add family member** under **Family members**. Enter their name, age group and optional mobile/accessibility details, then choose **Add to this household**. The expected guest count increases automatically when it previously covered all recorded members; an intentionally lower estimate is preserved. Attendance starts unconfirmed; the same invitation stays valid and the new member appears in Dress for individual assignment. Saved mobile numbers remain unique, and stale or repeated submissions cannot create another copy. The open household refreshes its member count and details after saving.

When grouping contacts for import, increasing **Expected guests** adds name and age-group fields for the other guests. For example, two selected contacts and four expected guests produces two additional family-member fields. All expected members need names before reviewing and saving; no phone numbers are required for these additional members. Optional **Additional guests allowed** remains capacity for later RSVP additions.

For an existing household with fewer named members than expected guests, open its details and use **Complete the remaining family members**. Enter each remaining guest's name, age group and optional accessibility needs, then save them together. Attendance stays unconfirmed. Saves are transactional, recorded in activity, invalidate stale RSVP versions, and cannot add the same completion batch twice.

## Importing mobile contacts

In the admin workspace, choose **Import phone contacts**. Select a `.vcf` export (up to 10 MB and 5,000 contact cards), search/select family members and choose **Group selected as a household**. A single selected contact can also form a household. Rename the household, choose its primary contact and number, check the member age groups, and set the expected count and fill in the generated fields for family members without phone contacts. Remove a draft group to regroup its contacts. Review before saving. Up to 50 new households / 500 named family members can be saved in one batch.

For a later VCF, open the same importer. **Hide contacts whose numbers are already saved** is on by default. Select the new contacts, choose the saved household under **Add selected contacts to**, and click **Add selected to existing household**. Each contact can add a new member or match an existing member. Known member numbers match automatically regardless of contact name; names alone never merge people. Show saved contacts to add another number or explicitly update a saved member's name and age group. For older imports without saved secondary numbers, manually choose the existing member once so future VCF files can recognize that number.

Review shows members added, updated, or kept, and new numbers linked. Expected guests increase for newly added members when the old expectation covered all saved members. A deliberately lower expected count stays unchanged. Existing RSVP, travel, room allocations, dress assignments and invitation links remain attached to their records; new members start unconfirmed and can receive dress assignments individually. Changed household versions reject stale or repeated saves. Numbers belonging to another household and contacts combining numbers from different saved members must be resolved before saving. Each batch is transactional, including its preview (which saves nothing).

Save or copy private invitation links for new households on the completion screen before closing it. Existing household links keep working. Nothing is sent automatically. Mapping drafts are held only in browser memory and disappear on page reload. Standard vCard names/phones, folded lines, grouped telephone properties and legacy quoted-printable names are supported. Format reference: [vCard specification](https://www.rfc-editor.org/info/rfc6350/).

Existing installations need `npm run db:contacts` once; `npm run dev` and `npm start` also run it automatically. Hosted serverless deployments must run `node scripts/setup-contacts.mjs --production` against the destination database before deployment. Migration links an older household's primary number only when its contact name matches exactly one saved member. Ambiguous names and lost secondary numbers need manual mapping. The migration preserves existing data and admin logins. Full exports, Households exports, and exported supporting members include saved phone numbers; older files without phone tracking still import.

`node --env-file=.env tests/contact-import.integration.mjs` verifies import authorization, mappings, preview rollback, mobile uniqueness across later files, explicit renames and legacy member matching, concurrent/repeated saves, guest access and RSVP/dress preservation. `node --env-file=.env tests/contact-migration.integration.mjs` verifies migration from the older schema and repeat startup. Both require an isolated `wedding_test` database.

Before a real launch, complete visual/mobile/accessibility review, confirm wedding content, configure a production database and backups, and perform deployment smoke tests. The in-app browser tool was unavailable during initial development; automated HTTP checks do not substitute for visual review.

Architecture references: [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication), [PostgreSQL range exclusion constraints](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT).
