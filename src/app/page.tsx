import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { query } from "@/lib/db";
import Celebrations from "@/components/celebrations";
import { celebrationDetails, weddingFunctions } from "@/lib/celebrations";
export const dynamic = "force-dynamic";
export default async function Home() {
  const w = process.env.DATABASE_URL
    ? (await query("SELECT * FROM wedding"))[0]
    : {
        bride: "Harini",
        groom: "Roshan",
        date: weddingFunctions[2].event_date,
        venue: weddingFunctions[2].location,
      };
  const functions = process.env.DATABASE_URL
    ? (
        await query(
          "SELECT to_jsonb(e) AS event FROM events e WHERE id=ANY($1::uuid[]) OR lower(trim(name))=ANY($2::text[])",
          [
            weddingFunctions.map((event) => event.id),
            weddingFunctions.map((event) => event.name.toLowerCase()),
          ],
        )
      ).map((row) => row.event)
    : [];
  return (
    <main className="invitation">
      <div className="monogram">
        H <span>&</span> R
      </div>
      <p className="eyebrow">WITH OUR FAMILIES, WITH ALL OUR LOVE</p>
      <h1 className="couple-names">
        <span>{w.bride}</span>
        <i>&</i>
        <span>{w.groom}</span>
      </h1>
      <div className="flourish">✧ ─── ✧ ─── ✧</div>
      <p className="lead">Two stories. One beautiful beginning.</p>
      <p>We can’t wait to celebrate with you.</p>
      <Celebrations events={celebrationDetails(functions)} />
      <section className="paper">
        <p className="eyebrow">THE CELEBRATION</p>
        <h2>
          {w.date
            ? new Date(w.date).toLocaleDateString("en-IN", {
                dateStyle: "long",
                timeZone: "Asia/Kolkata",
              })
            : "Good things are on their way"}
        </h2>
        <p>
          {w.date
            ? w.venue
            : "Our wedding date and venue will be announced soon."}
        </p>
        <p>
          Open your personal invitation link to RSVP,
          <br />
          share your travel plans, and see updates for your family.
        </p>
      </section>
      <Link className="quiet" href="/admin">
        Wedding planning · Admin sign in ↗
      </Link>
      <Analytics />
    </main>
  );
}
