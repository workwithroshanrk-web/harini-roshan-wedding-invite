import { notFound } from "next/navigation";
import { household } from "@/lib/security";
import { query } from "@/lib/db";
import Guest from "@/components/guest";
import { householdCapacity } from "@/lib/domain";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let h;
  try {
    h = await household(token);
  } catch {
    notFound();
  }
  const [members, events, notifications, allocations, wedding] =
    await Promise.all([
      query(
        "SELECT id,name,attendance,age_group,accessibility,travel FROM members WHERE household_id=$1",
        [h.id],
      ),
      query(
        "SELECT to_jsonb(e) AS event FROM events e ORDER BY starts NULLS LAST",
      ).then((rows) => rows.map((row) => row.event)),
      query(
        "SELECT id,type,body,published_at FROM notifications WHERE household_id=$1 AND published_at IS NOT NULL ORDER BY published_at DESC",
        [h.id],
      ),
      query(
        "SELECT a.check_in,a.check_out,a.people,r.name AS room,p.name AS property,p.address,p.contact,p.instructions FROM allocations a JOIN rooms r ON r.id=a.room_id JOIN properties p ON p.id=r.property_id WHERE a.household_id=$1 AND a.published AND a.status<>'Cancelled'",
        [h.id],
      ),
      query("SELECT * FROM wedding"),
    ]);
  await query(
    "WITH opened AS (UPDATE households SET opened_at=now() WHERE id=$1 AND opened_at IS NULL RETURNING id) INSERT INTO activity(id,household_id,actor,body) SELECT gen_random_uuid(),id,'Guest','Invitation opened' FROM opened",
    [h.id],
  );
  return (
    <Guest
      token={token}
      data={JSON.parse(
        JSON.stringify({
          name: h.name,
          version: h.version,
          capacity: householdCapacity(h.expected, h.additional, members.length),
          status: h.status,
          travel: h.travel,
          stay: h.stay,
          members,
          events,
          notifications,
          allocations,
          wedding: wedding[0],
        }),
      )}
    />
  );
}
