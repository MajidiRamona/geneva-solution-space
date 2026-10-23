// POST /api/book — a visitor requests a time. It is saved as "pending" (which holds the time)
// until staff approve or decline it in /admin/bookings/.
import type { Config } from "@netlify/functions";
import { clean, db, DUPLICATE, isEmail, json, newReference, OVERLAP, type Booking } from "./_lib/db";
import { requestReceived, sendAll, staffNewRequest } from "./_lib/email";
import { quote, resolveRange, space } from "./_lib/rules";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  // Bots: the hidden field is filled in, or the form was sent faster than a person could.
  if (clean(b.website) || (typeof b.elapsed === "number" && b.elapsed < 3000)) return json({ ok: true, reference: "GSS-000000" });

  const s = space(b.space);
  if (!s) return json({ error: "Please choose a space." }, 400);
  const range = resolveRange(s, b);
  if (typeof range === "string") return json({ error: range, field: "time" }, 422);

  const name = clean(b.name, 120), email = clean(b.email, 200).toLowerCase(), event = clean(b.event, 160);
  const plan = clean(b.plan, 4000), participants = Number(b.participants);
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Please enter your name.";
  if (!isEmail(email)) errors.email = "Please enter a valid email address.";
  if (!event) errors.event = "Please give your event a name.";
  if (!Number.isInteger(participants) || participants < 1) errors.participants = "Please enter the number of participants.";
  else if (participants > s.capacity) errors.participants = `${s.label} holds up to ${s.capacity} people.`;
  if (plan.length < 10) errors.plan = "Please tell us a little about what you're planning.";
  if (b.rules !== true) errors.rules = "Please accept the house rules.";
  if (Object.keys(errors).length) return json({ error: "Please check the highlighted fields.", errors }, 422);

  const firstTime = b.first_time === true;
  const price = quote(s, { fullDay: range.fullDay, days: range.days, hours: range.hours, firstTime });
  const row = {
    space: s.key, starts_at: range.starts.toISOString(), ends_at: range.ends.toISOString(), full_day: range.fullDay,
    status: "pending", name, email, event, plan, participants, first_time: firstTime,
    phone: clean(b.phone, 40) || null, organization: clean(b.organization, 160) || null, price_estimate: price.total,
  };

  // The database refuses overlapping times (see supabase/schema.sql), so two people can't grab the same slot.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db().from("bookings").insert({ ...row, reference: newReference() }).select().single();
    if (!error) {
      const booking = data as Booking;
      await sendAll([requestReceived(booking), staffNewRequest(booking)]);
      return json({ ok: true, reference: booking.reference, price, starts_at: booking.starts_at, ends_at: booking.ends_at }, 201);
    }
    if (error.code === OVERLAP)
      return json({ error: "Sorry, someone has just requested part of this time. Here are the nearest free times.", field: "time", taken: true }, 409);
    if (error.code !== DUPLICATE) { console.error(error); break; } // DUPLICATE: reference clash, try a new one
  }
  return json({ error: "We couldn't save your request. Please try again, or email us." }, 500);
};

export const config: Config = { path: "/api/book" };
