import "server-only";
import { cookies } from "next/headers";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { query } from "./db";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function verify(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function admin() {
  const t = (await cookies()).get("wedding_session")?.value;
  if (!t) return null;
  return (
    (
      await query(
        "SELECT a.id,a.email,a.role FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=$1 AND s.expires>now()",
        [hash(t)],
      )
    )[0] ?? null
  );
}
export async function requireAdmin() {
  const a = await admin();
  if (!a) throw Error("Please sign in.");
  return a;
}
export async function limit(key: string, max = 30) {
  const [r] = await query(
    `INSERT INTO rate_limits(key,count,expires) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<now() THEN 1 ELSE rate_limits.count+1 END, expires=CASE WHEN rate_limits.expires<now() THEN now()+interval '15 minutes' ELSE rate_limits.expires END RETURNING count`,
    [hash(key)],
  );
  if (r.count > max)
    throw Error("Too many attempts. Please try again in 15 minutes.");
}
export async function household(t: string) {
  if (!/^[\w-]{43}$/.test(t)) throw Error("Invitation unavailable.");
  const [h] = await query(
    "SELECT * FROM households WHERE token_hash=$1 AND NOT archived",
    [hash(t)],
  );
  if (!h) throw Error("Invitation unavailable.");
  return h;
}
