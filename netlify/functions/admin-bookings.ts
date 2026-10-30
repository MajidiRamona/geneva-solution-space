// /api/admin/bookings — the staff dashboard's API. Requires a Netlify Identity login.
//   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD&status=pending,approved&space=ground&q=text
//   POST { action: "approve", id, price_final?, message? }
//        { action: "decline", id, message }
//        { action: "cancel",  id, message? }
//        { action: "block",   space: "ground" | "all", start_date, start_time, end_date, end_time, note }
//        { action: "unblock", id }
//        { action: "preview", space, dates[] | (from, until, weekdays[]), start_time, end_time }  → each date, free or clashing
//        { action: "create",  space, dates[], start_time, end_time, kind, event, name?, email?, ... , notify? }
//        { action: "cancel_series", series_id }  → cancels the sessions of a series that haven't started yet
import type { Config } from "@netlify/functions";
import { staffUser } from "./_lib/auth";
import { clean, db, isEmail, json, LIVE, OVERLAP, newReference, type Booking, type Status } from "./_lib/db";
import { approved, cancelledByStaff, declined, sendAll, seriesConfirmed } from "./_lib/email";
import { addDays, daysBetween, isDate, isTime, space, SPACES, weekday, zoned } from "./_lib/rules";

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
    case "preview": return preview(b);
    case "create": return create(b, user.email);
    case "cancel_series": return cancelSeries(b, user.email);
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
  if (q.get("series")) query = query.eq("series_id", clean(q.get("series"), 40));
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

// ---------------------------------------------------------------------------
// Staff-made bookings, one-off or weekly (e.g. a class every Thursday for a semester)
// ---------------------------------------------------------------------------

const KINDS = ["class", "event", "meeting", "other"];
const MAX_SESSIONS = 120;

/** The dates of a request: an explicit list, or every chosen weekday between two dates. */
function datesOf(b: Record<string, unknown>): string[] | string {
  if (Array.isArray(b.dates)) {
    const list = [...new Set(b.dates.filter(isDate))].sort();
    if (!list.length) return "Please choose at least one date.";
    return list.length > MAX_SESSIONS ? `At most ${MAX_SESSIONS} sessions at once.` : list;
  }
  const { from, until } = b;
  const days = Array.isArray(b.weekdays) ? b.weekdays.map(String) : [];
  if (!isDate(from) || !isDate(until)) return "Please give a start and end date.";
  if (until < from) return "The end date must be after the start date.";
  if (daysBetween(from, until) > 400) return "A series can run for at most about a year.";
  if (!days.length) return "Please choose at least one weekday.";
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) if (days.includes(weekday(d))) out.push(d);
  if (!out.length) return "None of the chosen weekdays fall between those dates.";
  return out.length > MAX_SESSIONS ? `That makes ${out.length} sessions; at most ${MAX_SESSIONS} at once.` : out;
}

function sessionTimes(b: Record<string, unknown>) {
  const { start_time, end_time } = b;
  if (!isTime(start_time) || !isTime(end_time) || end_time <= start_time) return null;
  return { start: start_time, end: end_time };
}

/** Each date with whatever live booking is already in the way (if any). */
async function check(spaceKey: string, dates: string[], t: { start: string; end: string }) {
  const first = zoned(dates[0], t.start), last = zoned(dates[dates.length - 1], t.end);
  const { data, error } = await db().from("bookings").select("starts_at, ends_at, status, event, admin_note, reference")
    .eq("space", spaceKey).in("status", LIVE).lt("starts_at", last.toISOString()).gt("ends_at", first.toISOString());
  if (error) throw error;
  return dates.map((date) => {
    const a = zoned(date, t.start).getTime(), z = zoned(date, t.end).getTime();
    const hit = (data ?? []).find((r) => Date.parse(r.starts_at) < z && Date.parse(r.ends_at) > a);
    return { date, weekday: weekday(date), clash: hit ? { reference: hit.reference, status: hit.status, label: hit.status === "blocked" ? hit.admin_note || "Blocked" : hit.event } : null };
  });
}

async function preview(b: Record<string, unknown>) {
  const s = space(b.space); if (!s) return json({ error: "Please choose a space." }, 422);
  const t = sessionTimes(b); if (!t) return json({ error: "Please give a start and end time (end after start)." }, 422);
  const dates = datesOf(b); if (typeof dates === "string") return json({ error: dates }, 422);
  try { return json({ sessions: await check(s.key, dates, t) }); }
  catch (e) { console.error(e); return json({ error: "Could not check availability." }, 500); }
}

async function create(b: Record<string, unknown>, by: string) {
  const s = space(b.space); if (!s) return json({ error: "Please choose a space." }, 422);
  const t = sessionTimes(b); if (!t) return json({ error: "Please give a start and end time (end after start)." }, 422);
  const dates = datesOf(b); if (typeof dates === "string") return json({ error: dates }, 422);
  const event = clean(b.event, 160); if (!event) return json({ error: "Please give the class or event a name." }, 422);
  const email = clean(b.email, 200).toLowerCase();
  if (email && !isEmail(email)) return json({ error: "That email address doesn't look right." }, 422);
  const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : "event";
  const participants = Number(b.participants);
  const price = b.price === undefined || b.price === "" || b.price === null ? null : Number(b.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return json({ error: "The price must be a number." }, 422);

  const series = dates.length > 1 ? newReference("SER-") : null, now = new Date().toISOString();
  const rows = dates.map((date) => ({
    reference: newReference(), space: s.key, starts_at: zoned(date, t.start).toISOString(), ends_at: zoned(date, t.end).toISOString(),
    status: "approved", kind, series_id: series, event, name: clean(b.name, 120) || null, email: email || null,
    phone: clean(b.phone, 40) || null, organization: clean(b.organization, 160) || null,
    participants: Number.isInteger(participants) && participants > 0 ? participants : null,
    plan: clean(b.plan, 4000) || null, admin_note: clean(b.note, 2000) || null,
    price_estimate: price, price_final: price, decided_by: by, decided_at: now,
  }));
  // One statement, so the whole series is saved or none of it is.
  const { data, error } = await db().from("bookings").insert(rows).select();
  if (error?.code === OVERLAP) return json({ error: "Another booking was made for one of these dates in the meantime. Check the dates again." }, 409);
  if (error?.code === "PGRST204" || error?.code === "42703") return json({ error: "The database needs a small update first (the kind and series_id columns). See supabase/schema.sql." }, 500);
  if (error) { console.error(error); return json({ error: "Could not save the booking." }, 500); }

  const saved = (data as Booking[]).sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  if (b.notify === true && email) await sendAll([seriesConfirmed(saved)]);
  return json({ bookings: saved, series_id: series }, 201);
}

async function cancelSeries(b: Record<string, unknown>, by: string) {
  const id = clean(b.series_id, 40); if (!id) return json({ error: "Missing series." }, 400);
  const { data, error } = await db().from("bookings")
    .update({ status: "cancelled", decided_by: by, decided_at: new Date().toISOString(), admin_note: clean(b.message, 2000) || "Series cancelled" })
    .eq("series_id", id).in("status", ["approved", "pending"]).gt("starts_at", new Date().toISOString()).select("id");
  if (error) { console.error(error); return json({ error: "Could not cancel the series." }, 500); }
  return json({ cancelled: (data ?? []).length });
}

export const config: Config = { path: "/api/admin/bookings" };
