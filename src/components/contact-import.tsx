"use client";
import { useEffect, useRef, useState } from "react";
import {
  parseVcard,
  phoneKey,
  householdImportSchema,
  resizeImportMembers,
  matchSavedContact,
  type ContactHousehold,
  type ImportedContact,
  type HouseholdImport,
} from "@/lib/contacts";
import { csvCell, expectedAfterAdding } from "@/lib/domain";
import { api } from "./ui";

type Result = {
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
};
export default function ContactImport({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [contacts, setContacts] = useState<ImportedContact[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [groups, setGroups] = useState<HouseholdImport[]>([]),
    [search, setSearch] = useState(""),
    [step, setStep] = useState<"upload" | "map" | "review" | "done">("upload"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<Result[]>([]);
  const [existing, setExisting] = useState<ContactHousehold[]>([]);
  const [destination, setDestination] = useState("");
  const [hideSaved, setHideSaved] = useState(true);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  function close() {
    if (busy) return;
    if (
      step !== "done" &&
      groups.length &&
      !window.confirm("Discard these unsaved household groups?")
    )
      return;
    onClose();
  }
  function update(id: string, values: Partial<HouseholdImport>) {
    setGroups(groups.map((g) => (g.id === id ? { ...g, ...values } : g)));
  }
  const contactIds = new Set(contacts.map((c) => c.id));
  const used = new Set(
    groups.flatMap((g) =>
      g.members.filter((m) => contactIds.has(m.id)).map((m) => m.id),
    ),
  );
  const available = contacts.filter(
    (c) =>
      !used.has(c.id) &&
      (!hideSaved || !fullySaved(c)) &&
      `${c.name} ${c.phones.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function fullySaved(c: ImportedContact) {
    const matches = matchSavedContact(c, existing);
    return (
      matches.length === 1 &&
      matches[0].members.length === 1 &&
      c.phones.every((p) =>
        matches[0].members[0].phones.some(
          (saved) => phoneKey(saved) === phoneKey(p),
        ),
      )
    );
  }
  function groupSelected() {
    const chosen = contacts.filter(
      (c) => selected.includes(c.id) && !used.has(c.id),
    );
    if (!chosen.length) return;
    if (chosen.length > 100 || groups.length >= 50) {
      setError(
        "Use up to 100 members per household and 50 households per save.",
      );
      return;
    }
    const primary = chosen.find((c) => c.phones.length) || chosen[0];
    const target = existing.find((h) => h.id === destination);
    if (target && groups.some((g) => g.targetHouseholdId === target.id)) {
      setError(
        "This household is already mapped. Remove its draft and select all the contacts you want to add together.",
      );
      return;
    }
    if (
      chosen.some((c) =>
        matchSavedContact(c, existing).some(
          (match) => match.household.id !== target?.id,
        ),
      )
    ) {
      setError(
        "Some selected numbers already belong to a household. Choose that existing household, or leave those contacts out.",
      );
      return;
    }
    setGroups([
      ...groups,
      {
        id: crypto.randomUUID(),
        targetHouseholdId: target?.id,
        targetVersion: target?.version,
        name: target?.name || `${primary.name} & Family`,
        primaryId: primary.id,
        mobile: target?.mobile || primary.phones[0] || "",
        expected: target ? Math.min(target.expected, 100) : chosen.length,
        additional: 0,
        category: "",
        city: "",
        area: "",
        members: chosen.map((c) => {
          const matches = matchSavedContact(c, existing).flatMap(
            (match) => match.members,
          );
          const member = matches.length === 1 ? matches[0] : undefined;
          return {
            id: c.id,
            name: c.name,
            age_group: (member?.age_group ||
              "Adult") as HouseholdImport["members"][number]["age_group"],
            phones: c.phones,
            existingMemberId: member?.id,
            updateDetails: false,
          };
        }),
      },
    ]);
    setSelected([]);
    setError("");
  }
  function download() {
    const body = [
      ["Household", "Private invitation link"].map(csvCell).join(","),
      ...results
        .filter((r) => r.link)
        .map((r) => [r.name, location.origin + r.link].map(csvCell).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "private-household-invitations.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog
      ref={dialog}
      className="contact-import"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="import-title"
    >
      <button
        type="button"
        className="close"
        aria-label="Close contact import"
        disabled={busy}
        onClick={close}
      >
        ×
      </button>
      <p className="eyebrow">YOUR PEOPLE, GROUPED YOUR WAY</p>
      <h2 id="import-title">Import contacts into households</h2>
      <div className="steps">
        <span className={step === "upload" ? "active" : ""}>
          1 · Contacts file
        </span>
        <span className={step === "map" ? "active" : ""}>
          2 · Group households
        </span>
        <span className={step === "review" || step === "done" ? "active" : ""}>
          3 · Review & save
        </span>
      </div>
      {step === "upload" && (
        <>
          <p>
            Export contacts from your phone’s Contacts app as a{" "}
            <strong>.vcf / vCard</strong> file, then choose it here. You can
            select only the people you intend to invite.
          </p>
          <label>
            Mobile contacts export
            <input
              type="file"
              accept=".vcf,text/vcard,text/x-vcard"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  if (!/\.vcf$/i.test(file.name))
                    throw Error("Choose a .vcf contacts export.");
                  if (file.size > 10 * 1024 * 1024)
                    throw Error("Choose a file smaller than 10 MB.");
                  const parsed = parseVcard(await file.text());
                  const saved = await api("contactImportContext", {});
                  setExisting(saved.households);
                  setContacts(parsed.contacts);
                  setWarnings(parsed.warnings);
                  setStep("map");
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
          <p className="muted">
            The file is read in your browser. Only the household names, mapped
            member names, age groups and phone numbers, and planning details you
            review are saved. Photos, notes, emails and unused contacts are not
            imported.
          </p>
        </>
      )}
      {step === "map" && (
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <p>
            {contacts.length} contacts loaded · {groups.length} households
            mapped · {contacts.length - used.size} not grouped
          </p>
          {warnings.map((w) => (
            <p className="muted" key={w}>
              {w}
            </p>
          ))}
          <div className="contact-mapping">
            <section>
              <h3>Select contacts to club together</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={hideSaved}
                  onChange={(e) => {
                    setHideSaved(e.target.checked);
                    setSelected([]);
                  }}
                />
                Hide contacts whose numbers are already saved (
                {contacts.filter(fullySaved).length})
              </label>
              <p className="muted">
                Matching mobile numbers identify saved members even when names
                differ. Show saved contacts to link new numbers or explicitly
                update their names. For older members without saved numbers,
                choose the existing member manually.
              </p>
              <label>
                Search contacts
                <input
                  value={search}
                  placeholder="Name or phone number"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="contact-list">
                {available.map((c) => (
                  <label className="contact-choice" key={c.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, c.id]
                            : selected.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <span>
                      <strong>{c.name}</strong>
                      <small>{c.phones.join(" · ") || "No phone number"}</small>
                      {matchSavedContact(c, existing).map((match) => (
                        <small key={match.household.id}>
                          Already in {match.household.name}
                          {match.household.archived ? " (archived)" : ""}
                          {match.members.length
                            ? ` — ${match.members.map((m) => m.name).join(", ")}`
                            : " — match to an existing member"}
                        </small>
                      ))}
                    </span>
                  </label>
                ))}
                {!available.length && <p>No ungrouped contacts match.</p>}
              </div>
              <label>
                Add selected contacts to
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Create a new household</option>
                  {existing
                    .filter((h) => !h.archived)
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} — {h.mobile}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!selected.length}
                onClick={groupSelected}
              >
                {destination
                  ? "Add selected to existing household"
                  : `Group ${selected.length || ""} selected as a household`}
              </button>
              <p className="muted">
                Select one person for an individual invitation. Unselected
                contacts are left out. To regroup, remove the draft household
                and select its contacts again.
              </p>
            </section>
            <section>
              <h3>Household mapping</h3>
              {!groups.length && (
                <p>
                  Select related contacts on the left, then create a household.
                </p>
              )}
              {groups.map((g) => {
                const target = existing.find(
                  (h) => h.id === g.targetHouseholdId,
                );
                const duplicate = existing.find(
                  (h) =>
                    h.id !== g.targetHouseholdId &&
                    phoneKey(h.mobile) === phoneKey(g.mobile) &&
                    phoneKey(g.mobile),
                );
                const shared = groups.some(
                  (h) =>
                    h.id !== g.id &&
                    phoneKey(h.mobile) === phoneKey(g.mobile) &&
                    phoneKey(g.mobile),
                );
                const primary = contacts.find((c) => c.id === g.primaryId);
                return (
                  <article className="mapped-household" key={g.id}>
                    {target && (
                      <>
                        <h3>Add to {target.name}</h3>
                        <p>
                          {target.members.length} saved members:{" "}
                          {target.members.map((m) => m.name).join(", ") ||
                            "None yet"}
                          .
                        </p>
                        <p>
                          After import:{" "}
                          {target.members.length +
                            g.members.filter((m) => !m.existingMemberId)
                              .length}{" "}
                          members; expected guests will be{" "}
                          {expectedAfterAdding(
                            target.expected,
                            target.members.length,
                            target.members.length +
                              g.members.filter((m) => !m.existingMemberId)
                                .length,
                          )}
                          . Existing RSVP, dress and room details stay attached
                          to their members.
                        </p>
                      </>
                    )}
                    {!target && (
                      <>
                        <label>
                          Household / invitation name
                          <input
                            maxLength={200}
                            value={g.name}
                            onChange={(e) =>
                              update(g.id, { name: e.target.value })
                            }
                          />
                        </label>
                        <div className="form-grid">
                          <label>
                            Primary contact
                            <select
                              value={g.primaryId}
                              onChange={(e) => {
                                const c = contacts.find(
                                  (c) => c.id === e.target.value,
                                );
                                update(g.id, {
                                  primaryId: e.target.value,
                                  mobile: c?.phones[0] || "",
                                });
                              }}
                            >
                              {g.members
                                .filter((m) => contactIds.has(m.id))
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Primary phone number
                            {primary?.phones.length ? (
                              <select
                                value={g.mobile}
                                onChange={(e) =>
                                  update(g.id, { mobile: e.target.value })
                                }
                              >
                                {primary.phones.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                <input
                                  type="tel"
                                  maxLength={200}
                                  value={g.mobile}
                                  placeholder="Enter phone number"
                                  onChange={(e) =>
                                    update(g.id, { mobile: e.target.value })
                                  }
                                />
                                <small>
                                  No phone numbers saved for this contact. Enter
                                  one manually or choose another primary
                                  contact.
                                </small>
                              </>
                            )}
                          </label>
                        </div>
                      </>
                    )}
                    {(duplicate || shared) && (
                      <p className="feedback">
                        This number is also used by{" "}
                        {duplicate?.name || "another mapped household"}. Review
                        and cannot be saved again. Choose a different number or
                        remove this duplicate household.
                      </p>
                    )}
                    <h3>Family members</h3>
                    <p className="muted">
                      Enter a name and age group for each expected guest. Family
                      members without phone contacts do not need a mobile
                      number.
                    </p>
                    {g.members.map((m, index) => (
                      <div key={m.id}>
                        {target && (
                          <label>
                            Match {m.name} to
                            <select
                              value={m.existingMemberId || ""}
                              onChange={(e) =>
                                update(g.id, {
                                  members: g.members.map((x) =>
                                    x.id === m.id
                                      ? {
                                          ...x,
                                          existingMemberId:
                                            e.target.value || undefined,
                                          updateDetails: false,
                                          age_group: (target.members.find(
                                            (saved) =>
                                              saved.id === e.target.value,
                                          )?.age_group ||
                                            x.age_group) as typeof x.age_group,
                                        }
                                      : x,
                                  ),
                                })
                              }
                            >
                              <option value="">
                                Add as a new family member
                              </option>
                              {target.members.map((saved) => (
                                <option key={saved.id} value={saved.id}>
                                  {saved.name}
                                  {saved.phones.length
                                    ? ` — ${saved.phones.join(", ")}`
                                    : " — no saved phone"}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {m.phones?.length ? (
                          <p className="muted">
                            Numbers to link: {m.phones.join(", ")}
                          </p>
                        ) : (
                          <p className="muted">
                            No phone number; check the member mapping to avoid
                            adding the same person twice.
                          </p>
                        )}
                        {m.existingMemberId && (
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!m.updateDetails}
                              onChange={(e) =>
                                update(g.id, {
                                  members: g.members.map((x) =>
                                    x.id === m.id
                                      ? {
                                          ...x,
                                          updateDetails: e.target.checked,
                                        }
                                      : x,
                                  ),
                                })
                              }
                            />
                            Update this saved member’s name and age group using
                            the details below
                          </label>
                        )}
                        <div className="form-grid">
                          <label>
                            {contactIds.has(m.id)
                              ? "Member name"
                              : `Additional family member ${index + 1} name`}
                            <input
                              value={m.name}
                              disabled={
                                !!m.existingMemberId && !m.updateDetails
                              }
                              maxLength={200}
                              required
                              onChange={(e) =>
                                update(g.id, {
                                  members: g.members.map((x) =>
                                    x.id === m.id
                                      ? { ...x, name: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Age group
                            <select
                              value={m.age_group}
                              disabled={
                                !!m.existingMemberId && !m.updateDetails
                              }
                              onChange={(e) =>
                                update(g.id, {
                                  members: g.members.map((x) =>
                                    x.id === m.id
                                      ? {
                                          ...x,
                                          age_group: e.target
                                            .value as typeof m.age_group,
                                        }
                                      : x,
                                  ),
                                })
                              }
                            >
                              {[
                                "Infant",
                                "Child",
                                "Teen",
                                "Adult",
                                "Senior",
                              ].map((a) => (
                                <option key={a}>{a}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                    {!target && (
                      <>
                        <div className="form-grid">
                          <label>
                            Expected guests
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={g.expected}
                              onChange={(e) => {
                                const expected = Number(e.target.value);
                                update(g.id, {
                                  expected,
                                  members: resizeImportMembers(
                                    g.members,
                                    expected,
                                    contactIds,
                                    () => crypto.randomUUID(),
                                  ),
                                });
                              }}
                            />
                          </label>
                          <label>
                            Additional guests allowed
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={g.additional}
                              onChange={(e) =>
                                update(g.id, {
                                  additional: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          {(["category", "city", "area"] as const).map((k) => (
                            <label key={k}>
                              {k[0].toUpperCase() + k.slice(1)} (optional)
                              <input
                                maxLength={200}
                                value={g[k]}
                                onChange={(e) =>
                                  update(g.id, { [k]: e.target.value })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <p className="muted">
                          Expected guests can be fewer than mapped contacts. All
                          named members stay in the household; attendance is
                          recorded separately. Increasing the expected count
                          adds fields for the remaining family members above.
                          Complete their names and age groups before reviewing.
                          Additional guests allowed is optional capacity and
                          does not require names now.
                        </p>
                      </>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setGroups(groups.filter((x) => x.id !== g.id))
                      }
                    >
                      Remove draft household
                    </button>
                  </article>
                );
              })}
            </section>
          </div>
          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                if (
                  groups.length &&
                  !window.confirm(
                    "Discard these groups and choose another file?",
                  )
                )
                  return;
                setGroups([]);
                setSelected([]);
                setStep("upload");
                setError("");
              }}
            >
              Choose another file
            </button>
            <button
              type="button"
              disabled={!groups.length || busy}
              onClick={async () => {
                const duplicate = groups.find((g) =>
                  existing.some(
                    (h) =>
                      h.id !== g.targetHouseholdId &&
                      phoneKey(h.mobile) === phoneKey(g.mobile),
                  ),
                );
                if (duplicate) {
                  setError(
                    `The primary number for ${duplicate.name} is already used by an existing household. Mobile numbers must be unique.`,
                  );
                  return;
                }
                const valid = householdImportSchema.safeParse({ groups });
                if (!valid.success) {
                  setError(valid.error.issues.map((i) => i.message).join(" "));
                  return;
                }
                setError("");
                setBusy(true);
                try {
                  const preview = await api("previewContactImport", { groups });
                  setResults(preview.households);
                  setStep("review");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Checking household changes..."
                : `Review ${groups.length} households →`}
            </button>
          </div>
        </fieldset>
      )}
      {step === "review" && (
        <>
          <p>
            {groups.filter((g) => !g.targetHouseholdId).length} new households;{" "}
            {groups.filter((g) => g.targetHouseholdId).length} existing
            households. {results.reduce((n, r) => n + (r.added || 0), 0)}{" "}
            members added, {results.reduce((n, r) => n + (r.updated || 0), 0)}{" "}
            updated, {results.reduce((n, r) => n + (r.duplicates || 0), 0)}{" "}
            existing members kept.{" "}
            {results.reduce((n, r) => n + (r.phonesAdded || 0), 0)} new phone
            numbers linked. {contacts.length - used.size} unused contacts will
            not be saved.
          </p>
          <p>
            New members start with unconfirmed attendance. Saved RSVP and dress
            details are preserved. No invitation or message is sent.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Household</th>
                  <th>Primary contact</th>
                  <th>Members</th>
                  <th>Expected / extra</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      {g.name}
                      <small>
                        {g.targetHouseholdId
                          ? "Add to existing household"
                          : "Create household"}
                      </small>
                    </td>
                    <td>
                      {g.targetHouseholdId
                        ? existing.find((h) => h.id === g.targetHouseholdId)
                            ?.contact
                        : g.members.find((m) => m.id === g.primaryId)?.name}
                      <small>{g.mobile}</small>
                    </td>
                    <td>
                      {g.members
                        .map((m) =>
                          m.existingMemberId && !m.updateDetails
                            ? `Keep ${existing.find((h) => h.id === g.targetHouseholdId)?.members.find((saved) => saved.id === m.existingMemberId)?.name}; link numbers`
                            : `${m.existingMemberId ? "Update" : "Add"} ${m.name} (${m.age_group})`,
                        )
                        .join(", ")}
                    </td>
                    <td>
                      {results.find(
                        (r) => r.id === (g.targetHouseholdId || g.id),
                      )?.expected || g.expected}{" "}
                      / +
                      {g.targetHouseholdId
                        ? existing.find((h) => h.id === g.targetHouseholdId)
                            ?.additional
                        : g.additional}
                    </td>
                    <td>
                      {[g.city, g.area].filter(Boolean).join(" / ") || "TBD"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setStep("map");
                setError("");
              }}
            >
              Back to mapping
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await api("importHouseholds", { groups });
                  setResults(r.households);
                  setStep("done");
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving households…" : "Save reviewed household changes"}
            </button>
          </div>
        </>
      )}
      {step === "done" && (
        <>
          <h3>Your households are ready.</h3>
          <p>
            {results.filter((r) => !r.skipped && !r.merged).length} created.{" "}
            {results.filter((r) => r.merged).length} existing households
            processed. {results.filter((r) => r.skipped).length} already saved
            and skipped.
          </p>
          <p>
            Save these private invitation links before closing. You can generate
            a new link later from each household’s profile.
          </p>
          {results.filter((r) => r.link).length > 0 && (
            <button type="button" onClick={download}>
              Download private invitation links
            </button>
          )}
          {results.map((r) => (
            <div className="list-row" key={r.id}>
              <strong>{r.name}</strong>
              {r.link ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        location.origin + r.link,
                      );
                      setError(`Link copied for ${r.name}.`);
                    } catch {
                      setError(
                        "Could not copy. Use Download private invitation links.",
                      );
                    }
                  }}
                >
                  Copy invitation link
                </button>
              ) : (
                <span>
                  {r.merged
                    ? `${r.added || 0} members added, ${r.updated || 0} updated, ${r.duplicates || 0} kept. Existing invitation link still works.`
                    : "Already saved — use the household profile to generate a link."}
                </span>
              )}
            </div>
          ))}
          <div className="actions">
            <button type="button" onClick={close}>
              Done
            </button>
          </div>
        </>
      )}
      <p className="feedback" role="status">
        {error}
      </p>
    </dialog>
  );
}
