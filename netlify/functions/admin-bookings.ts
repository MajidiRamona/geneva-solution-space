// /api/admin/bookings — the staff dashboard's API. Requires a Netlify Identity login.
//   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD&status=pending,approved&space=ground&q=text
//   POST { action: "approve", id, price_final?, message? }
//        { action: "decline", id, message }
//        { action: "cancel",  id, message? }
//        { action: "block",   space: "ground" | "all", start_date, start_time, end_date, end_time, note }
//        { action: "unblock", id }
import type { Config } from "@netlify/functions";
import { staffUser } from "./_lib/auth";
import { clean, db, json, LIVE, OVERLAP, newReference, type Booking, type Status } from "./_lib/db";
import { approved, cancelledByStaff, declined, sendAll } from "./_lib/email";
import { addDays, isDate, isTime, space, SPACES, zoned } from "./_lib/rules";

const STATUSES: Status[] = ["pending", "approved", "declined", "cancelled", "blocked"];

export default async (req: Request) => {
  const user = await staffUser(req);
  if (!user) return json({ error: "Please log in." }, 401);
  if (req.method === "GET") return list(new URL(req.url).searchParams);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  switch (b.action) {
    case "approve": return decide(b, "pending", "approved", user.email);
    case "decline": return decide(b, "pending", "declined", user.email);
    case "cancel": return decide(b, ["pending", "approved"], "cancelled", user.email);
    case "block": return block(b, user.email);
    case "unblock": return decide(b, "blocked", "cancelled", user.email);
  }
  return json({ error: "Unknown action." }, 400);
};

async function list(q: URLSearchParams) {
  let query = db().from("bookings").select("*").order("starts_at", { ascending: true }).limit(2000);
  const from = q.get("from"), to = q.get("to");
  if (isDate(from)) query = query.gte("ends_at", zoned(from, "00:00").toISOString());
  if (isDate(to)) query = query.lt("starts_at", zoned(addDays(to, 1), "00:00").toISOString());
  const statuses = (q.get("status") || "").split(",").filter((s): s is Status => STATUSES.includes(s as Status));
  if (statuses.length) query = query.in("status", statuses);
  if (space(q.get("space"))) query = query.eq("space", q.get("space"));
  const text = clean(q.get("q"), 80).replace(/[%,()]/g, " ");
  if (text) query = query.or(["reference", "name", "email", "organization", "event"].map((c) => `${c}.ilike.%${text}%`).join(","));
  const { data, error } = await query;
  if (error) { console.error(error); return json({ error: "Could not load bookings." }, 500); }
  return json({ bookings: data, spaces: SPACES.map(({ key, label }) => ({ key, label })) });
}

async function decide(b: Record<string, unknown>, from: Status | Status[], to: Status, by: string) {
  if (typeof b.id !== "string") return json({ error: "Missing booking id." }, 400);
  const message = clean(b.message, 2000);
  if (to === "declined" && !message) return json({ error: "Please add a short message for the requester." }, 422);
  const patch: Partial<Booking> = { status: to, decided_at: new Date().toISOString(), decided_by: by };
  if (message) patch.admin_note = message;
  if (to === "approved" && b.price_final !== undefined && b.price_final !== "") {
    const p = Number(b.price_final);
    if (!Number.isFinite(p) || p < 0) return json({ error: "The price must be a number." }, 422);
    patch.price_final = p;
  }
  // Only change it if it is still in the expected state, so two staff can't act on it twice.
  const { data, error } = await db().from("bookings").update(patch).eq("id", b.id)
    .in("status", Array.isArray(from) ? from : [from]).select().maybeSingle();
  if (error) { console.error(error); return json({ error: "Could not update the booking." }, 500); }
  if (!data) return json({ error: "This booking has already been handled. Refresh to see its current state." }, 409);

  const booking = data as Booking;
  if (booking.email) {
    if (to === "approved") await sendAll([approved(booking)]);
    if (to === "declined") await sendAll([declined(booking)]);
    if (to === "cancelled" && b.notify !== false) await sendAll([cancelledByStaff(booking)]);
  }
  return json({ booking });
}

async function block(b: Record<string, unknown>, by: string) {
  const { start_date, start_time, end_date, end_time } = b;
  if (!isDate(start_date) || !isDate(end_date) || !isTime(start_time) || !isTime(end_time)) return json({ error: "Please give a start and end date and time." }, 422);
  const starts = zoned(start_date, start_time), ends = zoned(end_date, end_time);
  if (ends <= starts) return json({ error: "The end must be after the start." }, 422);
  const keys = b.space === "all" ? SPACES.map((s) => s.key) : space(b.space) ? [b.space as string] : [];
  if (!keys.length) return json({ error: "Please choose a space." }, 422);

  const note = clean(b.note, 200) || "Blocked";
  const rows = keys.map((key) => ({
    reference: newReference(), space: key, starts_at: starts.toISOString(), ends_at: ends.toISOString(),
    status: "blocked", admin_note: note, decided_by: by, decided_at: new Date().toISOString(),
  }));
  const { data, error } = await db().from("bookings").insert(rows).select();
  if (error?.code === OVERLAP) {
    const { data: clash } = await db().from("bookings").select("reference, name, event, status").in("space", keys).in("status", LIVE)
      .lt("starts_at", ends.toISOString()).gt("ends_at", starts.toISOString()).limit(5);
    const list = (clash ?? []).map((c) => `${c.reference} (${c.status}${c.event ? ", " + c.event : ""})`).join("; ");
    return json({ error: `That time overlaps existing bookings: ${list}. Decline or cancel them first.` }, 409);
  }
  if (error) { console.error(error); return json({ error: "Could not block that time." }, 500); }
  return json({ bookings: data }, 201);
}

export const config: Config = { path: "/api/admin/bookings" };
