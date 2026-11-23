"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./ui";
type Option = { id: string; name: string };
type Household = {
  id: string;
  name: string;
  mobile: string;
  dress_category_id: string | null;
};
type Member = {
  id: string;
  household_id: string;
  name: string;
  age_group: string;
};
type Assignment = {
  member_id: string;
  category_id: string | null;
  class_id: string | null;
  size_id: string | null;
};
type Lists = { categories: Option[]; classes: Option[]; sizes: Option[] };
function AddOption({
  label,
  action,
  options,
}: {
  label: string;
  action: string;
  options: Option[];
}) {
  const router = useRouter();
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="paper">
      <h2>{label}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            await api(action, { name });
            setName("");
            setMessage("Option added.");
            router.refresh();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          New {label.toLowerCase()}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            disabled={busy}
          />
        </label>
        <button disabled={busy || !name.trim()}>Add option</button>
        <p className="feedback" role="status">
          {message}
        </p>
      </form>
      <p className="muted">
        {options.map((o) => o.name).join(" · ") || "No options added yet."}
      </p>
    </section>
  );
}
function MemberRow({
  member,
  household,
  assignment,
  categories,
  classes,
  sizes,
}: Lists & { member: Member; household: Household; assignment?: Assignment }) {
  const router = useRouter();
  const initial = {
    categoryId: assignment?.category_id || "",
    classId: assignment?.class_id || "",
    sizeId: assignment?.size_id || "",
  };
  const [values, setValues] = useState(initial),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!dirty) setValues(initial);
  }, [assignment?.category_id, assignment?.class_id, assignment?.size_id]);
  return (
    <tr>
      <td>
        {household.name}
        <small>{household.mobile}</small>
      </td>
      <td>
        {member.name}
        <small>{member.age_group}</small>
      </td>
      {(
        [
          ["categoryId", "Dress category", categories],
          ["classId", "Dress class", classes],
          ["sizeId", "Size category", sizes],
        ] as const
      ).map(([key, label, options]) => (
        <td key={key}>
          <select
            aria-label={`${label} for ${member.name} in ${household.name}`}
            value={values[key]}
            disabled={busy}
            onChange={(e) => {
              setValues({ ...values, [key]: e.target.value });
              setDirty(true);
              setMessage("");
            }}
          >
            <option value="">Not selected</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </td>
      ))}
      <td>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              await api("assignMemberDress", {
                householdId: household.id,
                memberId: member.id,
                ...values,
              });
              setDirty(false);
              setMessage("Saved");
              router.refresh();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <small role="status">
          {dirty ? message || "Unsaved changes" : message}
        </small>
      </td>
    </tr>
  );
}
export default function Dress({
  households,
  members,
  assignments,
  categories,
  classes,
  sizes,
}: Lists & {
  households: Household[];
  members: Member[];
  assignments: Assignment[];
}) {
  const [search, setSearch] = useState(""),
    [householdFilter, setHouseholdFilter] = useState(""),
    [status, setStatus] = useState("");
  const active = members.filter((m) =>
    households.some((h) => h.id === m.household_id),
  );
  const shown = active.filter((m) => {
    const h = households.find((h) => h.id === m.household_id)!;
    const a = assignments.find((a) => a.member_id === m.id);
    const complete = !!(a?.category_id && a.class_id && a.size_id);
    return (
      `${m.name} ${h.name} ${h.mobile}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!householdFilter || h.id === householdFilter) &&
      (!status ||
        (status === "unassigned"
          ? !a
          : status === "incomplete"
            ? !complete
            : complete))
    );
  });
  return (
    <>
      <p>
        Add your own dress categories, classes and sizes, then choose the
        options for each family member and save their row.
      </p>
      <div className="overview-grid">
        <AddOption
          label="Dress category"
          action="createDressCategory"
          options={categories}
        />
        <AddOption
          label="Dress class"
          action="createDressClass"
          options={classes}
        />
        <AddOption
          label="Size category"
          action="createDressSize"
          options={sizes}
        />
      </div>
      <section className="paper">
        <h2>Individual dress assignments</h2>
        <p>
          {
            active.filter((m) => {
              const a = assignments.find((a) => a.member_id === m.id);
              return a?.category_id && a.class_id && a.size_id;
            }).length
          }{" "}
          of {active.length} members have a dress category, class and size.
        </p>
        <div className="filters">
          <label>
            Search members or households
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Member, household or mobile"
            />
          </label>
          <label>
            Household
            <select
              value={householdFilter}
              onChange={(e) => setHouseholdFilter(e.target.value)}
            >
              <option value="">All households</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignment status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All members</option>
              <option value="unassigned">Unassigned</option>
              <option value="incomplete">Missing dress details</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Household</th>
                <th>Family member</th>
                <th>Dress category</th>
                <th>Dress class</th>
                <th>Size category</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  household={households.find((h) => h.id === m.household_id)!}
                  assignment={assignments.find((a) => a.member_id === m.id)}
                  categories={categories}
                  classes={classes}
                  sizes={sizes}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && (
          <p>
            {active.length
              ? "No members match these filters."
              : "Add family members to your households to assign dresses."}
          </p>
        )}
        {households
          .filter((h) => !active.some((m) => m.household_id === h.id))
          .map((h) => (
            <p key={h.id}>
              {h.name}: add family member details in Households to assign
              dresses.
            </p>
          ))}
        {households.some((h) => h.dress_category_id) && (
          <details>
            <summary>Previous household dress categories</summary>
            {households
              .filter((h) => h.dress_category_id)
              .map((h) => (
                <p key={h.id}>
                  {h.name}:{" "}
                  {categories.find((c) => c.id === h.dress_category_id)?.name}.
                  Choose individual options above for each member.
                </p>
              ))}
          </details>
        )}
      </section>
    </>
  );
}
