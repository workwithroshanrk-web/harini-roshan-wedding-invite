"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./ui";
export default function RemainingFamilyMembers({
  householdId,
  expected,
  registered,
}: {
  householdId: string;
  expected: number;
  registered: number;
}) {
  const router = useRouter();
  const missing = Math.max(0, expected - registered);
  const [members, setMembers] = useState(() =>
    Array.from({ length: missing }, () => ({
      name: "",
      age_group: "Adult",
      accessibility: "",
    })),
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (!missing) return null;
  return (
    <section className="paper">
      <h3>
        Complete the remaining {missing} family member{missing === 1 ? "" : "s"}
      </h3>
      <p>
        {registered} members recorded out of {expected} expected guests. Add
        details for the remaining {missing}; no phone numbers are required.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            await api("completeFamilyMembers", { id: householdId, members });
            router.refresh();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {members.map((m, index) => (
          <fieldset key={index} disabled={busy}>
            <legend>Family member {registered + index + 1}</legend>
            <div className="form-grid">
              <label>
                Name
                <input
                  value={m.name}
                  required
                  maxLength={200}
                  onChange={(e) =>
                    setMembers(
                      members.map((member, i) =>
                        i === index
                          ? { ...member, name: e.target.value }
                          : member,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Age group
                <select
                  value={m.age_group}
                  onChange={(e) =>
                    setMembers(
                      members.map((member, i) =>
                        i === index
                          ? { ...member, age_group: e.target.value }
                          : member,
                      ),
                    )
                  }
                >
                  {["Infant", "Child", "Teen", "Adult", "Senior"].map((age) => (
                    <option key={age}>{age}</option>
                  ))}
                </select>
              </label>
              <label>
                Accessibility needs (optional)
                <input
                  value={m.accessibility}
                  maxLength={200}
                  onChange={(e) =>
                    setMembers(
                      members.map((member, i) =>
                        i === index
                          ? { ...member, accessibility: e.target.value }
                          : member,
                      ),
                    )
                  }
                />
              </label>
            </div>
          </fieldset>
        ))}
        <p className="muted">
          Attendance remains unconfirmed until the family responds.
        </p>
        <p className="feedback" role="status">
          {message}
        </p>
        <button disabled={busy}>
          {busy ? "Saving..." : `Save ${missing} remaining family members`}
        </button>
      </form>
    </section>
  );
}
