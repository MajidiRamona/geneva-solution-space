// GET /api/availability?space=ground&from=2026-10-01&to=2026-11-30
// Busy times for one space, as Geneva-local pieces per day. No names or details are exposed.
import type { Config } from "@netlify/functions";
import { db, json, LIVE } from "./_lib/db";
import { addDays, daysBetween, isDate, local, space, zoned } from "./_lib/rules";

export default async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const s = space(q.get("space"));
  const from = q.get("from"), to = q.get("to");
  if (!s || !isDate(from) || !isDate(to) || to < from || daysBetween(from, to) > 120)
    return json({ error: "Expected space, from and to (YYYY-MM-DD, at most 120 days apart)." }, 400);

  const rangeStart = zoned(from, "00:00"), rangeEnd = zoned(addDays(to, 1), "00:00");
  const { data, error } = await db().from("bookings").select("starts_at, ends_at")
    .eq("space", s.key).in("status", LIVE)
    .lt("starts_at", rangeEnd.toISOString()).gt("ends_at", rangeStart.toISOString());
  if (error) { console.error(error); return json({ error: "Availability is unavailable right now." }, 500); }

  // Split each booking into one piece per Geneva day, clipped to that day.
  const busy: { date: string; start: string; end: string }[] = [];
  for (const row of data) {
    let cur = new Date(Math.max(Date.parse(row.starts_at), rangeStart.getTime()));
    const end = new Date(Math.min(Date.parse(row.ends_at), rangeEnd.getTime()));
    while (cur < end) {
      const day = local(cur).date;
      const nextMidnight = zoned(addDays(day, 1), "00:00");
      const pieceEnd = end < nextMidnight ? end : nextMidnight;
      busy.push({ date: day, start: local(cur).time, end: pieceEnd.getTime() === nextMidnight.getTime() ? "24:00" : local(pieceEnd).time });
      cur = pieceEnd;
    }
  }
  return json({ space: s.key, now: new Date().toISOString(), busy }, 200, { "cache-control": "public, max-age=15" });
};

export const config: Config = { path: "/api/availability" };
