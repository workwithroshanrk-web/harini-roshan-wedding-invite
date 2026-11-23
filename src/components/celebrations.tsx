"use client";
import { useEffect, useState } from "react";
import { celebrations, countdown, type Celebration } from "@/lib/celebrations";

export default function Celebrations({
  events = celebrations,
}: {
  events?: Celebration[];
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section
      className="celebrations"
      aria-label="Wedding events and countdowns"
    >
      <p className="eyebrow">THREE OCCASIONS, ONE BEAUTIFUL BEGINNING</p>
      <h2>Come celebrate with us</h2>
      <div className="celebration-grid">
        {[...events]
          .sort((a, b) =>
            (a.event_date || a.starts || "9999").localeCompare(
              b.event_date || b.starts || "9999",
            ),
          )
          .map((event) => {
            const date = event.event_date?.slice(0, 10) || event.starts;
            return (
              <article className="celebration-card" key={event.id}>
                <p className="eyebrow">
                  {event.tamil_date || "CELEBRATE WITH US"}
                </p>
                <h3>{event.name}</h3>
                <p>
                  {date
                    ? new Date(
                        date.length === 10 ? `${date}T12:00:00+05:30` : date,
                      ).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "Date to be announced"}
                </p>
                <p>
                  {event.time_label ||
                    (event.starts
                      ? new Date(event.starts).toLocaleTimeString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Time to be announced")}
                </p>
                <p className="quiet">
                  {event.location || "Venue to be announced"}
                </p>
                {event.description && <p>{event.description}</p>}
                <div
                  className="event-countdown"
                  role="timer"
                  aria-live="off"
                  aria-label={`${event.name} countdown`}
                >
                  <span>
                    {now === null
                      ? "Counting down to our celebration…"
                      : countdown(event, now)}
                  </span>
                </div>
                <small>
                  {event.starts
                    ? "Countdown in Indian Standard Time"
                    : "Counting down to the date · Indian Standard Time"}
                </small>
              </article>
            );
          })}
      </div>
    </section>
  );
}
