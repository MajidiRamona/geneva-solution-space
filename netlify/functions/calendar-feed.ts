// GET /api/calendar.ics?token=… — subscribe in Outlook, Google or Apple Calendar to see every booking.
// The token is the ICS_FEED_TOKEN environment variable; anyone with the full link can read the feed.
import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { db, type Booking } from "./_lib/db";
import { calendar } from "./_lib/ics";
import { SITE_URL, space } from "./_lib/rules";

export default async (req: Request) => {
  const secret = process.env.ICS_FEED_TOKEN || "";
  const token = new URL(req.url).searchParams.get("token") || "";
  if (secret.length < 16 || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret)))
    return new Response("Not found", { status: 404 });

  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data, error } = await db().from("bookings").select("*").in("status", ["pending", "approved", "blocked"]).gte("ends_at", since).order("starts_at");
  if (error) { console.error(error); return new Response("Unavailable", { status: 500 }); }

  const events = (data as Booking[]).map((b) => {
    const label = space(b.space)?.label ?? b.space;
    const summary = b.status === "blocked" ? `${label} · ${b.admin_note || "Blocked"}`
      : `${b.status === "pending" ? "[Pending] " : ""}${label} · ${b.event}${b.organization ? " (" + b.organization + ")" : ""}`;
    const description = b.status === "blocked" ? `Blocked by ${b.decided_by ?? "staff"}`
      : `${b.reference}\n${b.name} <${b.email}>${b.phone ? "\n" + b.phone : ""}\n${b.participants} participants\n\n${b.plan ?? ""}`;
    return { uid: b.id, start: b.starts_at, end: b.ends_at, summary, description, status: b.status === "pending" ? "TENTATIVE" as const : "CONFIRMED" as const, url: `${SITE_URL}/admin/bookings/#${b.reference}` };
  });
  return new Response(calendar(events), { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/calendar.ics" };
