"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Action, Field, Form, Select } from "./ui";
import ContactImport from "./contact-import";
import DatabaseTransfer from "./database-transfer";
import Dress from "./dress";
import RemainingFamilyMembers from "./remaining-family-members";
import AddFamilyMember from "./add-family-member";
import ExportAllData from "./export-all-data";
import Celebrations from "./celebrations";
type Row = Record<string, any>;
const delivery = [
  "Not Planned",
  "Planned",
  "Assigned",
  "Invitation Given",
  "Unable to Reach",
  "Digital Only",
];
export default function Admin({ data: d }: { data: any }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        )
      )
        router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  const [tab, setTab] = useState("Overview"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [city, setCity] = useState(""),
    [mode, setMode] = useState(""),
    [stay, setStay] = useState(""),
    [category, setCategory] = useState(""),
    [tag, setTag] = useState(""),
    [deliveryFilter, setDeliveryFilter] = useState(""),
    [arrival, setArrival] = useState(""),
    [before, setBefore] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [adding, setAdding] = useState(false),
    [importing, setImporting] = useState(false),
    [tripLocations, setTripLocations] = useState<string[]>([]);
  const selected: Row | null =
    d.households.find((h: Row) => h.id === selectedId) || null;
  const setSelected = (household: Row | null) =>
    setSelectedId(household?.id || null);
  const householdMembers = (h: Row) =>
    d.members.filter((m: Row) => m.household_id === h.id);
  const count = (h: Row) =>
    householdMembers(h).filter((m: Row) => m.attendance === "Yes").length;
  const locs = (h: Row) =>
    d.locations.filter((l: Row) => l.household_id === h.id);
  const allocations = (h: Row) =>
    d.allocations.filter(
      (a: Row) => a.household_id === h.id && a.status !== "Cancelled",
    );
  const pendingStay = (h: Row) =>
    h.stay.required === "Yes" &&
    allocations(h).reduce((n: number, a: Row) => n + a.people, 0) <
      h.stay.people;
  const people = d.households
    .flatMap(householdMembers)
    .filter((m: Row) => m.attendance === "Yes");
  const filtered = d.households.filter(
    (h: Row) =>
      (!search ||
        [h.name, h.contact, h.mobile, ...h.tags]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!status ||
        (status === "Attending" ? count(h) > 0 : h.status === status)) &&
      (!city || locs(h).some((l: Row) => l.city === city)) &&
      (!mode ||
        h.travel.mode === mode ||
        householdMembers(h).some((m: Row) => m.travel?.mode === mode)) &&
      (!stay ||
        (stay === "Pending allocation"
          ? pendingStay(h)
          : stay === "Allocated"
            ? allocations(h).length
            : h.stay.required === stay)) &&
      (!category || h.category === category) &&
      (!tag || h.tags.includes(tag)) &&
      (!deliveryFilter ||
        (deliveryFilter === "Not sent"
          ? !h.sent_at
          : h.delivery === deliveryFilter)) &&
      (!arrival || h.travel.arrival?.slice(0, 10) === arrival) &&
      (!before || h.travel.arrival?.slice(11, 16) < before),
  );
  function drill(type: string, value: string) {
    setStatus("");
    setStay("");
    setMode("");
    setCity("");
    setDeliveryFilter("");
    setSearch("");
    setCategory("");
    setTag("");
    setArrival("");
    setBefore("");
    if (type === "status") setStatus(value);
    if (type === "stay") setStay(value);
    if (type === "delivery") setDeliveryFilter(value);
    if (type === "city") setCity(value);
    if (type === "mode") setMode(value);
    setTab("Households");
  }
  function filter(
    label: string,
    value: string,
    set: (s: string) => void,
    options: string[],
  ) {
    return (
      <label>
        {label}
        <select value={value} onChange={(e) => set(e.target.value)}>
          <option value="">All</option>
          {[...new Set(options)].filter(Boolean).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
    );
  }
  function table(rows: Row[]) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Household</th>
              <th>Location</th>
              <th>RSVP</th>
              <th>Attending</th>
              <th>Invitation</th>
              <th>Stay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} onClick={() => setSelected(h)}>
                <td>
                  <button className="text-button">{h.name}</button>
                  <small>
                    {h.category || "Uncategorized"} ·{" "}
                    {h.mobile ? `•••• ${h.mobile.slice(-4)}` : "No contact"}
                  </small>
                </td>
                <td>
                  {locs(h)
                    .map((l: Row) => `${l.city}${l.area ? " · " + l.area : ""}`)
                    .join(" / ") || "—"}
                </td>
                <td>
                  <span
                    className={`badge ${h.status === "Confirmed" ? "green" : ""}`}
                  >
                    {h.status}
                  </span>
                </td>
                <td>
                  {count(h)} <small>of {h.expected} expected</small>
                </td>
                <td>{h.delivery}</td>
                <td>
                  {pendingStay(h)
                    ? "Pending allocation"
                    : allocations(h).length
                      ? "Allocated"
                      : h.stay.required === "Yes"
                        ? "Requested"
                        : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <h3>No households found</h3>
            <p>Add your first household or adjust the filters.</p>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/">
          H <i>&</i> R<span>THE WEDDING WORKSPACE</span>
        </a>
        <p className="nav-label">PLAN THE CELEBRATION</p>
        <nav>
          {[
            "Overview",
            "Households",
            "Dress",
            "Travel",
            "Accommodation",
            "Invitation trips",
            "Updates",
            "Settings",
          ].map((t, i) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              <span>{["◈", "♧", "◇", "↗", "⌂", "⌁", "✉", "⚙"][i]}</span>
              {t}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="badge">PLANNING TOGETHER</span>
          <p>
            {d.wedding.bride} & {d.wedding.groom}
          </p>
          <small>
            {d.wedding.date
              ? new Date(d.wedding.date).toLocaleDateString("en-IN")
              : "Wedding date · TBD"}
          </small>
          <Action action="logout">Sign out</Action>
        </div>
      </aside>
      <main className="admin-main">
        <header className="topbar">
          <span>
            Our wedding / <strong>{tab}</strong>
          </span>
          <a href="/" target="_blank">
            View wedding page ↗
          </a>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">EVERY DETAIL, A LITTLE CLOSER</p>
              <h1>
                {tab === "Overview" ? "A beautiful day starts here." : tab}
              </h1>
              <p>
                {tab === "Overview"
                  ? "Your people, their plans, and everything coming together."
                  : "Keep the little details in one thoughtful place."}
              </p>
            </div>
            <div className="actions">
              <ExportAllData />
              <button className="secondary" onClick={() => setImporting(true)}>
                Import phone contacts
              </button>
              <button onClick={() => setAdding(true)}>+ Add household</button>
            </div>
          </div>
          {tab === "Overview" && (
            <>
              <div className="stats">
                {[
                  ["Invited families", d.households.length, "", ""],
                  ["Confirmed attendees", people.length, "status", "Attending"],
                  [
                    "Awaiting a response",
                    d.households.filter(
                      (h: Row) => h.status === "Not Responded",
                    ).length,
                    "status",
                    "Not Responded",
                  ],
                  [
                    "Stay requests pending",
                    d.households.filter(pendingStay).length,
                    "stay",
                    "Pending allocation",
                  ],
                ].map(([label, n, type, value]) => (
                  <button
                    className="stat"
                    key={label}
                    onClick={() => drill(String(type), String(value))}
                  >
                    <span>{label}</span>
                    <strong>{n}</strong>
                    <small>View households ↗</small>
                  </button>
                ))}
              </div>
              <div className="overview-grid">
                <section className="paper">
                  <div className="section-title">
                    <h2>The RSVP picture</h2>
                    <span className="badge">LIVE TOTALS</span>
                  </div>
                  {[
                    "Confirmed",
                    "Not Responded",
                    "Maybe",
                    "Declined",
                    "Modified After Confirmation",
                  ].map((s, i) => {
                    const n = d.households.filter(
                      (h: Row) => h.status === s,
                    ).length;
                    return (
                      <button
                        className="progress-row"
                        key={s}
                        onClick={() => drill("status", s)}
                      >
                        <span>{s}</span>
                        <div className="track">
                          <div
                            style={{
                              width: `${d.households.length ? (n / d.households.length) * 100 : 0}%`,
                              background: [
                                "#536650",
                                "#d6b57f",
                                "#bb9377",
                                "#b8b3a8",
                                "#a16a51",
                              ][i],
                            }}
                          />
                        </div>
                        <strong>{n}</strong>
                      </button>
                    );
                  })}
                  <p className="muted">
                    {d.households.reduce(
                      (n: number, h: Row) => n + h.expected,
                      0,
                    )}{" "}
                    estimated invitees ·{" "}
                    {
                      d.households.filter(
                        (h: Row) => h.status !== "Not Responded",
                      ).length
                    }{" "}
                    families responded
                  </p>
                  <div className="demographics">
                    {["Adult", "Child", "Teen", "Infant", "Senior"].map(
                      (age) => (
                        <div key={age}>
                          <strong>
                            {
                              people.filter((m: Row) => m.age_group === age)
                                .length
                            }
                          </strong>
                          <small>{age}</small>
                        </div>
                      ),
                    )}
                  </div>
                </section>
                <section className="paper olive">
                  <p className="eyebrow">A LITTLE CARE GOES A LONG WAY</p>
                  <h2>
                    Make room for
                    <br />
                    your favourite people.
                  </h2>
                  <p>
                    {
                      d.households.filter((h: Row) => h.stay.required === "Yes")
                        .length
                    }{" "}
                    families have requested a place to stay.
                  </p>
                  <button
                    className="light"
                    onClick={() => setTab("Accommodation")}
                  >
                    Plan accommodation ↗
                  </button>
                </section>
              </div>
              <section className="paper">
                <h2>
                  Needs your attention{" "}
                  <span className="badge">{d.alerts.length}</span>
                </h2>
                {d.alerts.length ? (
                  d.alerts.map((a: Row) => (
                    <div className="alert" key={a.id}>
                      <div>
                        <strong>
                          {
                            d.households.find(
                              (h: Row) => h.id === a.household_id,
                            )?.name
                          }
                        </strong>
                        <p>{a.body}</p>
                      </div>
                      <Action action="resolve" data={{ id: a.id }}>
                        Mark reviewed
                      </Action>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    You’re all caught up. Changes affecting room allocations
                    will appear here.
                  </p>
                )}
              </section>
              <div className="overview-grid">
                <section className="paper">
                  <h2>Coming from near & far</h2>
                  {[
                    ...new Set<string>(d.locations.map((l: Row) => l.city)),
                  ].map((c) => (
                    <button
                      className="list-row"
                      key={c}
                      onClick={() => drill("city", c)}
                    >
                      <span>{c || "City TBD"}</span>
                      <strong>
                        {
                          d.households.filter((h: Row) =>
                            locs(h).some((l: Row) => l.city === c),
                          ).length
                        }{" "}
                        families ↗
                      </strong>
                    </button>
                  ))}
                </section>
                <section className="paper">
                  <h2>Invitation progress</h2>
                  <button
                    className="list-row"
                    onClick={() => drill("delivery", "Not sent")}
                  >
                    Not sent{" "}
                    <strong>
                      {d.households.filter((h: Row) => !h.sent_at).length} ↗
                    </strong>
                  </button>
                  {delivery.map((s) => (
                    <button
                      className="list-row"
                      key={s}
                      onClick={() => drill("delivery", s)}
                    >
                      {s}
                      <strong>
                        {
                          d.households.filter((h: Row) => h.delivery === s)
                            .length
                        }{" "}
                        ↗
                      </strong>
                    </button>
                  ))}
                </section>
              </div>
            </>
          )}
          {(tab === "Households" || tab === "Travel") && (
            <>
              <section className="paper">
                <div className="section-title">
                  <h2>{filtered.length} households</h2>
                  <a className="button secondary" href="/api">
                    Export household summary · CSV ↓
                  </a>
                </div>
                <div className="filters">
                  <label>
                    Search
                    <input
                      placeholder="Name, contact or tag…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {filter("RSVP", status, setStatus, [
                    "Attending",
                    "Not Responded",
                    "Maybe",
                    "Confirmed",
                    "Declined",
                    "Modified After Confirmation",
                  ])}
                  {filter(
                    "City",
                    city,
                    setCity,
                    d.locations.map((l: Row) => l.city),
                  )}
                  {filter("Travel", mode, setMode, [
                    "Car",
                    "Train",
                    "Bus",
                    "Flight",
                    "Other",
                    "Not decided",
                  ])}
                  {filter("Stay", stay, setStay, [
                    "Yes",
                    "No",
                    "Not decided",
                    "Allocated",
                    "Pending allocation",
                  ])}
                  {filter(
                    "Category",
                    category,
                    setCategory,
                    d.households.map((h: Row) => h.category),
                  )}
                  {filter(
                    "Tag",
                    tag,
                    setTag,
                    d.households.flatMap((h: Row) => h.tags),
                  )}
                  {filter("Invitation", deliveryFilter, setDeliveryFilter, [
                    "Not sent",
                    ...delivery,
                  ])}
                  <label>
                    Arrival date
                    <input
                      type="date"
                      value={arrival}
                      onChange={(e) => setArrival(e.target.value)}
                    />
                  </label>
                  <label>
                    Arrival before
                    <input
                      type="time"
                      value={before}
                      onChange={(e) => setBefore(e.target.value)}
                    />
                  </label>
                </div>
              </section>
              {tab === "Travel" && (
                <div className="stats">
                  {["Car", "Train", "Bus", "Flight", "Not decided"].map((m) => (
                    <button className="stat" key={m} onClick={() => setMode(m)}>
                      <span>{m}</span>
                      <strong>
                        {
                          people.filter(
                            (p: Row) =>
                              (p.travel?.mode ||
                                d.households.find(
                                  (h: Row) => h.id === p.household_id,
                                )?.travel.mode ||
                                "Not decided") === m,
                          ).length
                        }
                      </strong>
                      <small>attending guests</small>
                    </button>
                  ))}
                </div>
              )}
              {table(filtered)}
            </>
          )}
          {tab === "Accommodation" && (
            <>
              <div className="overview-grid">
                <section className="paper">
                  <h2>Room inventory</h2>
                  {d.rooms.map((r: Row) => (
                    <div className="list-row" key={r.id}>
                      <span>
                        {r.property_name} · Room {r.name}
                      </span>
                      <strong>{r.capacity} guests</strong>
                    </div>
                  ))}
                  <details>
                    <summary>+ Add a stay location and room</summary>
                    <Form action="room">
                      <Field
                        name="propertyName"
                        label="Stay location (marriage venue, lodge, etc.)"
                        required
                      />
                      <Field name="address" label="Address" />
                      <Field
                        name="contact"
                        label="Location contact (optional)"
                      />
                      <Field
                        name="instructions"
                        label="Check-in instructions"
                      />
                      <Field name="name" label="Room number" required />
                      <Field
                        name="capacity"
                        label="Capacity"
                        type="number"
                        value="2"
                        required
                      />
                    </Form>
                  </details>
                </section>
                <section className="paper">
                  <h2>Allocate a room</h2>
                  <Form action="allocate">
                    <label>
                      Household
                      <select name="id" required>
                        {d.households.map((h: Row) => (
                          <option value={h.id} key={h.id}>
                            {h.name} · {h.stay.people || 0} requested
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Stay location
                      <input
                        name="location"
                        placeholder="Marriage venue rooms or ABC Lodge"
                        required
                        maxLength={200}
                        list="stay-locations"
                      />
                      <datalist id="stay-locations">
                        {[
                          ...new Set<string>(
                            d.rooms.map((r: Row) => r.property_name),
                          ),
                        ].map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Room number
                      <input
                        name="roomNumber"
                        placeholder="101, A-2, Ground floor…"
                        required
                        maxLength={200}
                      />
                    </label>
                    <Field
                      name="people"
                      label="Guests assigned"
                      type="number"
                      value="1"
                      required
                    />
                    <div className="form-grid">
                      <Field
                        name="check_in"
                        label="Check-in"
                        type="date"
                        required
                      />
                      <Field
                        name="check_out"
                        label="Check-out"
                        type="date"
                        required
                      />
                    </div>
                    <p className="muted">
                      Enter the venue or lodge name and room number. New rooms
                      are added with capacity equal to the guests assigned.
                      Existing room capacity still applies. Assignments are
                      private until you publish them. Overlapping bookings are
                      blocked.
                    </p>
                  </Form>
                </section>
              </div>
              <section className="paper">
                <h2>Assignments</h2>
                {d.allocations.map((a: Row) => (
                  <div className="list-row" key={a.id}>
                    <div>
                      <strong>
                        {d.households.find((h: Row) => h.id === a.household_id)
                          ?.name || "Archived household"}
                      </strong>
                      <p>
                        {
                          d.rooms.find((r: Row) => r.id === a.room_id)
                            ?.property_name
                        }{" "}
                        / {d.rooms.find((r: Row) => r.id === a.room_id)?.name} ·{" "}
                        {a.people} guests
                      </p>
                      <small>
                        {a.check_in.slice(0, 10)} → {a.check_out.slice(0, 10)} ·{" "}
                        {a.status} · {a.published ? "Published" : "Private"}
                      </small>
                    </div>
                    {a.status !== "Cancelled" && (
                      <div>
                        {!a.published && (
                          <Action
                            action="publishAllocation"
                            data={{ id: a.id }}
                          >
                            Publish to guest
                          </Action>
                        )}
                        <Action
                          action="cancelAllocation"
                          data={{ id: a.id }}
                          confirm
                        >
                          Cancel
                        </Action>
                      </div>
                    )}
                  </div>
                ))}
              </section>
              {table(
                d.households.filter((h: Row) => h.stay.required === "Yes"),
              )}
            </>
          )}
          {tab === "Invitation trips" && (
            <>
              <section className="paper">
                <h2>Plan a visit, bring a little joy.</h2>
                <p>
                  Select one primary or secondary location per household. Group
                  by city and area.
                </p>
                <Form action="trip" extra={{ locations: tripLocations }}>
                  <div className="form-grid">
                    <Field name="name" label="Trip name" required />
                    <Field name="date" label="Visit date" type="date" />
                    <Field
                      name="assignee"
                      label="Assigned family members"
                      required
                    />
                  </div>
                  <div className="location-list">
                    {[...d.locations]
                      .sort((a: Row, b: Row) =>
                        (a.city + a.area).localeCompare(b.city + b.area),
                      )
                      .filter((l: Row) =>
                        d.households.some((h: Row) => h.id === l.household_id),
                      )
                      .map((l: Row) => (
                        <label className="check" key={l.id}>
                          <input
                            type="checkbox"
                            checked={tripLocations.includes(l.id)}
                            onChange={(e) =>
                              setTripLocations(
                                e.target.checked
                                  ? [
                                      ...tripLocations.filter(
                                        (id) =>
                                          d.locations.find(
                                            (x: Row) => x.id === id,
                                          )?.household_id !== l.household_id,
                                      ),
                                      l.id,
                                    ]
                                  : tripLocations.filter((id) => id !== l.id),
                              )
                            }
                          />
                          {l.city} / {l.area || "Area TBD"} ·{" "}
                          {
                            d.households.find(
                              (h: Row) => h.id === l.household_id,
                            )?.name
                          }{" "}
                          ({l.kind})
                        </label>
                      ))}
                  </div>
                </Form>
              </section>
              {d.trips.map((t: Row) => (
                <section className="paper" key={t.id}>
                  <span className="badge">{t.status}</span>
                  <h2>{t.name}</h2>
                  <p>
                    {t.date?.slice(0, 10) || "Date TBD"} · {t.assignee}
                  </p>
                  {d.stops
                    .filter((s: Row) => s.trip_id === t.id)
                    .map((s: Row) => (
                      <Form key={s.id} action="stop" extra={{ id: s.id }}>
                        <div className="list-row">
                          <strong>
                            {
                              d.households.find(
                                (h: Row) => h.id === s.household_id,
                              )?.name
                            }
                          </strong>
                          <span>
                            {
                              d.locations.find(
                                (l: Row) => l.id === s.location_id,
                              )?.address
                            }
                          </span>
                          <Select
                            name="status"
                            label="Stop status"
                            value={s.status}
                            options={[
                              "Pending",
                              "Visited",
                              "Invitation Given",
                              "Skipped",
                              "Reschedule",
                            ]}
                          />
                        </div>
                      </Form>
                    ))}
                </section>
              ))}
            </>
          )}
          {tab === "Updates" && (
            <>
              <section className="paper">
                <h2>A thoughtful note for your guests</h2>
                <Form action="notify">
                  <label>
                    Household
                    <select name="id">
                      {d.households.map((h: Row) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Select
                    name="type"
                    label="Type"
                    options={[
                      "General",
                      "RSVP",
                      "Accommodation",
                      "Travel",
                      "Transport",
                      "Event Update",
                      "Reminder",
                    ]}
                  />
                  <label>
                    Message
                    <textarea name="body" required maxLength={4000} />
                  </label>
                  <label className="check">
                    <input type="checkbox" name="publish" value="yes" />
                    Publish immediately in the guest portal
                  </label>
                  <p className="muted">
                    In-platform updates only. These do not send SMS, email or
                    WhatsApp messages.
                  </p>
                </Form>
              </section>
              <section className="paper">
                <h2>Update history</h2>
                {d.notifications.map((n: Row) => (
                  <article key={n.id}>
                    <span className="badge">
                      {n.type} ·{" "}
                      {n.viewed_at
                        ? "Viewed"
                        : n.published_at
                          ? "Published"
                          : "Draft"}
                    </span>
                    <h3>
                      {
                        d.households.find((h: Row) => h.id === n.household_id)
                          ?.name
                      }
                    </h3>
                    <p>{n.body}</p>
                    {!n.published_at && (
                      <Action action="publishNotification" data={{ id: n.id }}>
                        Publish
                      </Action>
                    )}
                    <button
                      className="secondary"
                      onClick={() => navigator.clipboard.writeText(n.body)}
                    >
                      Copy WhatsApp message
                    </button>
                  </article>
                ))}
              </section>
            </>
          )}
          {tab === "Dress" && (
            <Dress
              households={d.households}
              members={d.members}
              assignments={d.memberDress}
              categories={d.dressCategories}
              classes={d.dressClasses}
              sizes={d.dressSizes}
            />
          )}
          {tab === "Settings" && (
            <div className="overview-grid">
              <DatabaseTransfer />
              <section className="paper">
                <h2>Your celebration</h2>
                <Form action="wedding">
                  <Field
                    label="Bride"
                    name="bride"
                    value={d.wedding.bride}
                    required
                  />
                  <Field
                    label="Groom"
                    name="groom"
                    value={d.wedding.groom}
                    required
                  />
                  <Field
                    label="Wedding date (optional)"
                    name="date"
                    type="date"
                    value={d.wedding.date?.slice(0, 10)}
                  />
                  <Field label="Venue" name="venue" value={d.wedding.venue} />
                  <Field
                    label="Guest contact information"
                    name="contact"
                    value={d.wedding.contact}
                  />
                </Form>
              </section>
              <section className="paper">
                <h2>Add an event</h2>
                <Form action="event">
                  <Field name="name" label="Event name" required />
                  <Field
                    name="starts"
                    label="Starts (optional)"
                    type="datetime-local"
                  />
                  <Field
                    name="ends"
                    label="Ends (optional)"
                    type="datetime-local"
                  />
                  <Field name="location" label="Location" />
                  <Field name="description" label="Description" />
                </Form>
                <Celebrations events={d.events} />
                {d.events.map((e: Row) => (
                  <p key={e.id}>
                    {e.name} · {e.event_date?.slice(0, 10) || e.starts || "TBD"}
                  </p>
                ))}
              </section>
            </div>
          )}
          <footer>
            Made for the moments that bring everyone together.{" "}
            <span>H & R</span>
          </footer>
        </div>
      </main>
      {importing && (
        <ContactImport
          onClose={() => {
            setImporting(false);
            router.refresh();
          }}
        />
      )}
      {adding && (
        <div className="modal-backdrop">
          <section className="modal">
            <button
              className="close"
              onClick={() => {
                setAdding(false);
                location.reload();
              }}
              aria-label="Close"
            >
              ×
            </button>
            <p className="eyebrow">MAKE THEM PART OF YOUR DAY</p>
            <h2>Add a household</h2>
            <Form action="createHousehold">
              <div className="form-grid">
                <Field name="name" label="Invitation display name" required />
                <Field name="contact" label="Primary contact" required />
                <Field
                  name="mobile"
                  label="Household mobile"
                  type="tel"
                  required
                />
                <Field name="email" label="Email (optional)" type="email" />
                <Field
                  name="expected"
                  label="Expected guests"
                  type="number"
                  value="1"
                  required
                />
                <Field
                  name="additional"
                  label="Additional guests allowed"
                  type="number"
                  value="0"
                />
                <Field name="category" label="Category" />
                <Field name="tags" label="Tags (comma separated)" />
                <Field name="city" label="City" required />
                <Field name="area" label="Area" />
                <Field name="state" label="State" />
                <Field name="address" label="Address (optional)" />
              </div>
              <p className="muted">
                Save and copy the private invitation link. It is shown only when
                generated.
              </p>
            </Form>
          </section>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop">
          <section className="modal profile">
            <button
              className="close"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              ×
            </button>
            <p className="eyebrow">HOUSEHOLD PROFILE</p>
            <h2>{selected.name}</h2>
            <span className="badge">{selected.status}</span>
            <p>
              {selected.contact} · {selected.mobile} · {selected.email}
            </p>
            <p>
              {selected.opened_at ? "Invitation opened" : "Not yet opened"} ·{" "}
              {selected.sent_at ? "Marked sent" : "Not marked sent"}
            </p>
            <details>
              <summary>Edit contact, allowance, tags & internal notes</summary>
              <Form action="editHousehold" extra={{ id: selected.id }}>
                {[
                  "name",
                  "contact",
                  "mobile",
                  "category",
                  "expected",
                  "additional",
                ].map((k) => (
                  <Field
                    key={k}
                    name={k}
                    label={
                      k === "expected"
                        ? "Expected guests (can be fewer than members)"
                        : k
                    }
                    value={selected[k]}
                    required
                  />
                ))}
                <Field
                  name="tags"
                  label="Tags"
                  value={selected.tags.join(", ")}
                />
                <label>
                  Internal notes
                  <textarea name="notes" defaultValue={selected.notes} />
                </label>
              </Form>
            </details>
            <details>
              <summary>Generate a new private invitation link</summary>
              <p>This revokes any previous link for this household.</p>
              <Form action="rotateLink" extra={{ id: selected.id }} />
            </details>
            <h3>Family members · {count(selected)} attending</h3>
            <AddFamilyMember
              key={selected.id}
              householdId={selected.id}
              householdName={selected.name}
              version={selected.version}
              expected={selected.expected}
              registered={householdMembers(selected).length}
            />
            <RemainingFamilyMembers
              key={`${selected.id}-${selected.expected}-${householdMembers(selected).length}`}
              householdId={selected.id}
              expected={selected.expected}
              registered={householdMembers(selected).length}
            />
            {householdMembers(selected).map((m: Row) => (
              <p key={m.id}>
                {m.name} · {m.age_group} · {m.attendance}
                {m.accessibility && ` · ${m.accessibility}`}
                {m.phones?.length > 0 && <small>{m.phones.join(" · ")}</small>}
              </p>
            ))}
            <details>
              <summary>Edit existing family members</summary>
              {householdMembers(selected).map((m: Row) => (
                <Form
                  key={m.id || "new"}
                  action="member"
                  extra={{ id: selected.id, memberId: m.id }}
                >
                  <h3>{m.id ? "Edit member" : "Add member"}</h3>
                  <Field name="name" label="Name" value={m.name} required />
                  <Select
                    name="attendance"
                    label="Attendance"
                    value={m.attendance}
                    options={["Yes", "No", "Maybe"]}
                  />
                  <Select
                    name="age_group"
                    label="Age group"
                    value={m.age_group}
                    options={["Infant", "Child", "Teen", "Adult", "Senior"]}
                  />
                  <Field
                    name="accessibility"
                    label="Accessibility needs"
                    value={m.accessibility}
                  />
                </Form>
              ))}
            </details>
            <h3>Travel & stay request</h3>
            <p>
              {selected.travel.mode || "Not decided"} ·{" "}
              {selected.travel.origin || "Origin TBD"} · Arrival{" "}
              {selected.travel.arrival || "TBD"} at{" "}
              {selected.travel.point || "TBD"}
            </p>
            <p>
              Departure {selected.travel.departure || "TBD"} ·{" "}
              {selected.travel.departurePoint}
            </p>
            <p>{selected.travel.notes}</p>
            <p>
              Stay: {selected.stay.required || "Not decided"} ·{" "}
              {selected.stay.people || 0} guests · {selected.stay.arrival} →{" "}
              {selected.stay.departure}
            </p>
            <p>{selected.stay.notes}</p>
            <h3>Locations</h3>
            {locs(selected).map((l: Row) => (
              <p key={l.id}>
                {l.kind}: {l.city} / {l.area} / {l.state} · {l.address}
              </p>
            ))}
            <details>
              <summary>Add secondary location</summary>
              <Form action="location" extra={{ id: selected.id }}>
                {["city", "area", "state", "address"].map((k) => (
                  <Field name={k} label={k} key={k} />
                ))}
              </Form>
            </details>
            <h3>Invitation delivery</h3>
            <Form action="delivery" extra={{ id: selected.id }}>
              <Select
                name="delivery"
                label="Status"
                options={delivery}
                value={selected.delivery}
              />
              <Field
                name="assignee"
                label="Assigned to"
                value={selected.assignee}
              />
              <Field
                name="visit_date"
                label="Planned visit"
                type="date"
                value={selected.visit_date?.slice(0, 10)}
              />
              <label className="check">
                <input type="checkbox" name="sent" value="yes" />
                Mark invitation sent
              </label>
            </Form>
            <h3>Accommodation</h3>
            {allocations(selected).map((a: Row) => (
              <p key={a.id}>
                {d.rooms.find((r: Row) => r.id === a.room_id)?.property_name} ·{" "}
                {a.people} guests · {a.published ? "Published" : "Private"}
              </p>
            ))}
            <h3>Updates</h3>
            {d.notifications
              .filter((n: Row) => n.household_id === selected.id)
              .map((n: Row) => (
                <p key={n.id}>
                  {n.type}: {n.body} · {n.published_at ? "Published" : "Draft"}
                </p>
              ))}
            <h3>Activity timeline</h3>
            {d.activity
              .filter((a: Row) => a.household_id === selected.id)
              .map((a: Row) => (
                <div className="timeline" key={a.id}>
                  <small>
                    {new Date(a.created_at).toLocaleString("en-IN")} · {a.actor}
                  </small>
                  <p>{a.body}</p>
                </div>
              ))}
            <Action action="archive" data={{ id: selected.id }} confirm>
              Archive household
            </Action>
          </section>
        </div>
      )}
    </div>
  );
}
