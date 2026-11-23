"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api } from "./ui";
import { expectedAfterAdding } from "@/lib/domain";

export default function AddFamilyMember({
  householdId,
  householdName,
  version,
  expected,
  registered,
}: {
  householdId: string;
  householdName: string;
  version: number;
  expected: number;
  registered: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [refreshing, startRefresh] = useTransition();
  const [draftVersion, setDraftVersion] = useState(version);
  const [name, setName] = useState(""),
    [age, setAge] = useState("Adult"),
    [phone, setPhone] = useState(""),
    [accessibility, setAccessibility] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="paper">
      {!open ? (
        <button
          type="button"
          disabled={busy || refreshing}
          onClick={() => {
            setDraftVersion(version);
            setMessage("");
            setOpen(true);
          }}
        >
          + Add family member
        </button>
      ) : (
        <>
          <h3>Add family member to {householdName}</h3>
          <p>
            {registered} members saved. After adding this person, expected
            guests will be{" "}
            {expectedAfterAdding(expected, registered, registered + 1)}. A phone
            number is optional.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || refreshing) return;
              setBusy(true);
              setMessage("");
              try {
                const saved = await api("addFamilyMember", {
                  id: householdId,
                  version: draftVersion,
                  name,
                  age_group: age,
                  phone,
                  accessibility,
                });
                setMessage(
                  `${name.trim()} added to ${householdName}. Expected guests: ${saved.expected}.`,
                );
                setName("");
                setAge("Adult");
                setPhone("");
                setAccessibility("");
                setOpen(false);
                startRefresh(() => router.refresh());
              } catch (error) {
                setMessage((error as Error).message);
                startRefresh(() => router.refresh());
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy || refreshing}>
              <div className="form-grid">
                <label>
                  Member name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  Age group
                  <select value={age} onChange={(e) => setAge(e.target.value)}>
                    {["Infant", "Child", "Teen", "Adult", "Senior"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Mobile number (optional)
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <label>
                  Accessibility needs (optional)
                  <input
                    value={accessibility}
                    onChange={(e) => setAccessibility(e.target.value)}
                    maxLength={200}
                  />
                </label>
              </div>
              <p className="muted">
                Attendance starts unconfirmed. The new member will also appear
                in the Dress tab for individual assignment.
              </p>
              <div className="actions">
                <button type="submit">
                  {busy ? "Adding..." : "Add to this household"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
        </>
      )}
      <p className="feedback" role="status">
        {message}
      </p>
    </section>
  );
}
