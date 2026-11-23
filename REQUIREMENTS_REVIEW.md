# PRD review — 23 September 2026

The second attachment is text-identical to the original v0.1 PRD. This is a source-code review, not a new visual or end-to-end certification. The earlier passing tests cover selected workflows, not full PRD compliance.

## Email clarification

Sections 3.1 and 4.2 explicitly allow account-free guest access and an optional household email. The implementation follows this: email/password for admin login, private invitation tokens for guests, optional email on the admin household creation form. No guest email is needed to RSVP. If email should exist only for admins, removing the optional household field would be a deliberate change to the PRD.

## Findings to fix first

1. **RSVP response and change status are conflated (sections 6–7).** `src/app/api/route.ts` stores `Modified After Confirmation` instead of the actual subsequent response. A confirmed family that declines is consequently absent from the Declined filter, and `src/components/guest.tsx` initializes that response as Confirmed on reopening. Store the current response independently from the change/review flag. Also compare previous and submitted values: an unchanged resubmission currently raises a change alert.
2. **Stay coverage ignores dates (sections 9–10, 18).** `pendingStay` in `src/components/admin.tsx` sums people across all active allocations, including unrelated or non-overlapping dates. A family needing two beds for two nights can appear covered by two one-person bookings on different nights. Calculate coverage across every requested night; keep partial coverage pending.
3. **Room inventory UI duplicates properties (section 10).** The API accepts an existing property ID, but the form only offers a property name and always creates a new property. Entering room 101 twice under the same displayed hotel name creates different properties, bypassing the intended room uniqueness and conflict protection. Provide an existing-property selector and a distinct create-property operation.
4. **Travel drill-down differs from its totals (sections 8, 18–19).** Travel totals use attending members and their overrides, while filtering also includes non-attending members and household modes overridden by all members. Arrival filters inspect household travel only. Use the same effective member-travel records for counts, filters and the household profile; show individual overrides to planners.
5. **Notification viewed status is too broad (sections 11, 22).** Opening Updates marks every published notification viewed, including newer records not present in the loaded page. Delivered and viewed timestamps are set together, and view actions do not appear in the activity timeline. Acknowledge only displayed notification IDs and define separate delivery/view semantics.
6. **Member identities are replaced on each RSVP (section 23).** The save operation deletes all members and inserts new IDs. The reserved event RSVP table cascades deletes from members, so future event responses would be lost on a household edit. Preserve member IDs and validate their household ownership.

## Coverage by PRD section

| Sections | Current coverage | Remaining work |
| --- | --- | --- |
| 1–2: Vision, household model | Core household/member model implemented | Resolve correctness findings above before relying on operations totals |
| 3: Roles | Account-free guest links, authenticated multiple admins | Additional permissions are future work; role column alone does not enforce differentiated permissions |
| 4: Wedding and household data | Basic wedding, contacts, categories, allowances, tags | Wedding status/configuration absent; household email cannot be edited in the profile |
| 5: Members | Name, attendance, age band, accessibility | Suggested optional relationship, member notes, phone and gender fields absent; none should become required |
| 6–7: RSVP and changes | Wizard, server validation, member-derived headcount, edit versions, room alerts | Separate actual response from review status; suppress unchanged-save alerts; dashboard polls every 15 seconds rather than updating immediately |
| 8: Travel | Household travel plus member overrides stored | Consistent effective-travel filtering and profile visibility |
| 9–10: Accommodation | Requests separate from allocations; date conflict constraint; publish/cancel | Date-aware demand coverage, reusable inventory UI, Planning/Confirmed workflow, inventory editing |
| 11–12: Notifications | Private updates, drafts/publication, message copying | Accurate delivery/view semantics, view audit entries, generic future channel adapter |
| 13: Distribution | Delivery states, assignee, planned/actual date storage | Actual visit date is automatically today rather than manually editable; visit notes use generic household notes |
| 14–16: Geography and trips | Structured primary/secondary locations, selectable stops, trip statuses | Location editing, full City → Area grouping/counts, explicit trip lifecycle management |
| 17: Guest management | Create/edit/archive, links, members, notes, filters, basic CSV | Existing raw links cannot be re-copied after creation without rotation; CSV contains only basic household fields |
| 18–19: Dashboard and filters | Basic metrics and combined filters | State/area and age-band drill-down, complete sent/allocation/trip metrics, consistent travel filtering |
| 20: Tags | Free-form stored tags and filtering | Dedicated tag/category management optional; currently configured through household text fields |
| 21: Consolidated profile | Core household details and history | Individual travel overrides, full room details, editing email/locations and allocation actions remain incomplete |
| 22: Activity timeline | Many mutations and first invitation open recorded | Guest update views absent; a global 500-entry cap can truncate a family's complete history |
| 23: Events | Multiple events, nullable schedule, future event RSVP table | Stable member IDs, event editing/deletion, consistent timezone handling and end-time presentation |
| 24: Analytics | Database-derived operations counts separate from public Vercel Analytics | Response-rate and notification-engagement summaries incomplete |
| 25: Security | Hashed random tokens, sessions, admin checks, origin validation, rate limits, audit records | Existing tests are not a comprehensive security review; per-role enforcement remains deferred |
| 26: Privacy | Purpose text, optional guest email, household-only required phone, export/archive | Hard deletion and retention tooling deferred as allowed by the PRD |
| 27: Mobile | Responsive CSS and staged RSVP | Browser/mobile/accessibility verification outstanding; no intermediate draft save |
| 28: Deployment | Next.js and persistent PostgreSQL; setup documented | Production database, deployment and deployment smoke test outstanding |
| 29: MVP | Most named workflows have an initial implementation | Findings above mean the MVP is not yet fully compliant or ready for acceptance |
| 30–31: Phase 2 / exclusions | Advanced features intentionally absent | Messaging integrations, imports, transport allocation, maps, photos and other Phase 2 features should remain deferred |
| 32–33: Workflows / success criteria | All six workflows partly represented | Fix response, travel and accommodation correctness so operational answers are dependable |

## Recommended implementation order

1. Separate RSVP response/change lifecycle and retain stable member IDs.
2. Fix property/room identity and date-aware accommodation coverage.
3. Unify travel calculations, filtering and member override presentation.
4. Correct notification acknowledgements and complete audit events.
5. Finish location editing, geographic grouping, metrics and exports.
6. Perform visual/mobile acceptance and production deployment verification.

No application behavior was changed during this review.
