import { redirect } from "next/navigation";
import { admin } from "@/lib/security";
import { dashboard } from "@/lib/data";
import Admin from "@/components/admin";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await admin())) redirect("/login");
  return <Admin data={await dashboard()} />;
}
