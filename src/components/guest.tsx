"use client";
import { useState } from "react";
import { api } from "./ui";
import Celebrations from "./celebrations";
import { celebrationDetails, weddingFunctions } from "@/lib/celebrations";
const blankTravel = {
  required: "Not decided",
  origin: "",
  mode: "Not decided",
  arrival: "",
  departure: "",
  point: "",
  departurePoint: "",
  reference: "",
  notes: "",
};
export default function Guest({
  data: d,
  token,
}: {
  data: any;
  token: string;
}) {
  const [step, setStep] = useState(0),
    [response, setResponse] = useState(
      d.status === "Declined"
        ? "Declined"
        : d.status === "Maybe"
          ? "Maybe"
          : "Confirmed",
    ),
    [members, setMembers] = useState<any[]>(d.members),
    [travel, setTravel] = useState({ ...blankTravel, ...d.travel }),
    [stay, setStay] = useState({
      required: "Not decided",
      people: 0,
      arrival: "",
      departure: "",
      notes: "",
      ...d.stay,
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(d.version),
    [updates, setUpdates] = useState(false);
  const count =
    response === "Confirmed"
      ? members.filter((m) => m.attendance === "Yes").length
      : 0;
  const update = (i: number, k: string, v: any) =>
    setMembers(members.map((m, j) => (i === j ? { ...m, [k]: v } : m)));
  function travelFields(t: any, set: (v: any) => void) {
    return (
      <div className="form-grid">
        <label>
          Travelling to the wedding?
          <select
            value={t.required}
            onChange={(e) => set({ ...t, required: e.target.value })}
          >
            {["Not decided", "Yes", "No"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Travel mode
          <select
            value={t.mode}
            onChange={(e) => set({ ...t, mode: e.target.value })}
          >
            {["Not decided", "Car", "Bus", "Train", "Flight", "Other"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </label>
        {[
          ["origin", "Origin city", "text"],
          ["arrival", "Arrival", "datetime-local"],
          ["point", "Arrival point", "text"],
          ["departure", "Departure", "datetime-local"],
          ["departurePoint", "Departure point", "text"],
          ["reference", "Booking reference (optional)", "text"],
          ["notes", "Travel notes", "text"],
        ].map(([k, l, type]) => (
          <label key={k}>
            {l}
            <input
              type={type}
              value={t[k]}
              onChange={(e) => set({ ...t, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
    );
  }
  return (
    <main className="guest">
      <header className="guest-header">
        <a href="/">
          H <i>&</i> R
        </a>
        <button
          className="secondary"
          onClick={async () => {
            setUpdates(!updates);
            try {
              await api("viewUpdates", { token });
            } catch {
              setMessage("Could not mark updates as viewed.");
            }
          }}
        >
          Your updates · {d.notifications.length}
        </button>
      </header>
      <section className="guest-hero">
        <p className="eyebrow">
          A SPECIAL INVITATION FOR {d.name.toUpperCase()}
        </p>
        <h1>
          {d.wedding.bride} <i>&</i> {d.wedding.groom}
        </h1>
        <p className="lead">Joy is sweeter when shared with you.</p>
        <p>
          {d.wedding.date
            ? new Date(d.wedding.date).toLocaleDateString("en-IN", {
                dateStyle: "long",
                timeZone: "Asia/Kolkata",
              })
            : "Date to be announced"}{" "}
          · {d.wedding.venue || "Venue to be announced"}
        </p>
        <Celebrations events={celebrationDetails(d.events)} />
        {d.events
          .filter(
            (e: any) =>
              !weddingFunctions.some(
                (event) =>
                  event.id === e.id ||
                  event.name.toLowerCase() === e.name.trim().toLowerCase(),
              ),
          )
          .map((e: any) => (
            <article className="event" key={e.id}>
              <h3>{e.name}</h3>
              <p>
                {e.starts
                  ? new Date(e.starts).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })
                  : "Date & time TBD"}{" "}
                · {e.location || "Venue TBD"}
              </p>
              <p>{e.description}</p>
            </article>
          ))}
      </section>
      {updates && (
        <section className="paper">
          <h2>Updates for your family</h2>
          {!d.notifications.length && (
            <p>Nothing new just yet. Check back closer to the celebration.</p>
          )}
          {d.notifications.map((n: any) => (
            <article key={n.id}>
              <span className="badge">{n.type}</span>
              <p>{n.body}</p>
            </article>
          ))}
          {d.allocations.map((a: any, i: number) => (
            <article key={i}>
              <h3>
                {a.property} · Room {a.room}
              </h3>
              <p>{a.address}</p>
              <p>
                {a.check_in.slice(0, 10)} → {a.check_out.slice(0, 10)} ·{" "}
                {a.people} guests
              </p>
              <p>
                {a.contact} · {a.instructions}
              </p>
            </article>
          ))}
        </section>
      )}
      <section className="paper rsvp">
        <p className="eyebrow">LET’S PLAN YOUR VISIT</p>
        <h2>{step === 5 ? "You’re all set." : "Will you join us?"}</h2>
        <p>
          These details help us plan attendance, travel and accommodation. Only
          the wedding planning team can see your response.
        </p>
        <div className="steps">
          {["RSVP", "Family", "Travel", "Stay", "Review"].map((s, i) => (
            <span className={step === i ? "active" : ""} key={s}>
              {i + 1} · {s}
            </span>
          ))}
        </div>
        {step === 0 && (
          <div className="choices">
            {[
              ["Confirmed", "Joyfully attending"],
              ["Declined", "Unable to attend"],
              ["Maybe", "Not confirmed yet"],
            ].map(([v, l]) => (
              <button
                className={response === v ? "selected" : "secondary"}
                key={v}
                onClick={() => setResponse(v)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {step === 1 && (
          <>
            <p>
              Up to {d.capacity} family members. {count} attending.
            </p>
            {members.map((m, i) => (
              <article className="member" key={i}>
                <div className="form-grid">
                  <label>
                    Name
                    <input
                      value={m.name}
                      onChange={(e) => update(i, "name", e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Attendance
                    <select
                      value={m.attendance}
                      onChange={(e) => update(i, "attendance", e.target.value)}
                    >
                      {["Yes", "No", "Maybe"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Age group
                    <select
                      value={m.age_group}
                      onChange={(e) => update(i, "age_group", e.target.value)}
                    >
                      {["Infant", "Child", "Teen", "Adult", "Senior"].map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Accessibility needs (optional)
                    <input
                      value={m.accessibility}
                      onChange={(e) =>
                        update(i, "accessibility", e.target.value)
                      }
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(m.travel?.mode)}
                    onChange={(e) =>
                      update(
                        i,
                        "travel",
                        e.target.checked ? { ...blankTravel } : {},
                      )
                    }
                  />
                  Travels separately from the household
                </label>
                {m.travel?.mode &&
                  travelFields(m.travel, (v) => update(i, "travel", v))}
                {members.length > 1 && (
                  <button
                    className="secondary"
                    onClick={() =>
                      setMembers(members.filter((_, j) => j !== i))
                    }
                  >
                    Remove member
                  </button>
                )}
              </article>
            ))}
            {members.length < d.capacity && (
              <button
                className="secondary"
                onClick={() =>
                  setMembers([
                    ...members,
                    {
                      name: "",
                      attendance: "Yes",
                      age_group: "Adult",
                      accessibility: "",
                      travel: {},
                    },
                  ])
                }
              >
                + Add family member
              </button>
            )}
          </>
        )}
        {step === 2 && travelFields(travel, setTravel)}
        {step === 3 && (
          <>
            <label>
              Do you need accommodation?
              <select
                value={stay.required}
                onChange={(e) => setStay({ ...stay, required: e.target.value })}
              >
                {["Not decided", "Yes", "No"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <p>A stay request is separate from a confirmed room assignment.</p>
            {stay.required === "Yes" && (
              <div className="form-grid">
                <label>
                  Guests requiring stay
                  <input
                    type="number"
                    min="1"
                    max={count}
                    value={stay.people}
                    onChange={(e) =>
                      setStay({ ...stay, people: Number(e.target.value) })
                    }
                  />
                </label>
                {[
                  ["arrival", "Check-in"],
                  ["departure", "Check-out"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      type="date"
                      value={stay[k]}
                      onChange={(e) =>
                        setStay({ ...stay, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Special requirements
                  <input
                    value={stay.notes}
                    onChange={(e) =>
                      setStay({ ...stay, notes: e.target.value })
                    }
                  />
                </label>
              </div>
            )}
          </>
        )}
        {step === 4 && (
          <div className="review">
            <h3>
              {response} · {count} attending
            </h3>
            {members.map((m, i) => (
              <p key={i}>
                {m.name} · {m.age_group} ·{" "}
                {response === "Confirmed"
                  ? m.attendance
                  : response === "Declined"
                    ? "No"
                    : "Maybe"}
              </p>
            ))}
            <p>
              Travel: {travel.mode} from {travel.origin || "TBD"}
            </p>
            <p>
              Accommodation: {stay.required}
              {stay.required === "Yes" ? ` · ${stay.people} guests` : ""}
            </p>
            <p>
              You can return using this private link to update your response.
              Please keep it within your household.
            </p>
          </div>
        )}
        <p role="status" className="feedback">
          {message}
        </p>
        <div className="actions">
          {step > 0 && step < 5 && (
            <button
              className="secondary"
              onClick={() =>
                setStep(step === 4 && response !== "Confirmed" ? 0 : step - 1)
              }
            >
              Back
            </button>
          )}
          {step < 4 && (
            <button
              onClick={() => {
                setMessage("");
                if (step === 1 && members.some((m) => !m.name.trim())) {
                  setMessage("Please enter a name for each member.");
                  return;
                }
                setStep(step === 0 && response !== "Confirmed" ? 4 : step + 1);
              }}
            >
              Continue →
            </button>
          )}
          {step === 4 && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const normalized = members.map(({ travel: t, ...m }) => ({
                    ...m,
                    ...(t?.mode ? { travel: t } : {}),
                  }));
                  const r = await api("rsvp", {
                    token,
                    data: {
                      version,
                      response,
                      members: normalized,
                      travel,
                      stay:
                        response === "Confirmed"
                          ? stay
                          : { ...stay, required: "No", people: 0 },
                    },
                  });
                  setVersion(version + 1);
                  setMembers(r.members);
                  setMessage(r.message);
                  setStep(5);
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Submitting…" : "Send my response"}
            </button>
          )}
          {step === 5 && (
            <button
              onClick={() => {
                setStep(0);
                setMessage("");
              }}
            >
              Edit response
            </button>
          )}
        </div>
      </section>
      <footer>
        With love, {d.wedding.bride} & {d.wedding.groom}
        <p>{d.wedding.contact}</p>
      </footer>
    </main>
  );
}
