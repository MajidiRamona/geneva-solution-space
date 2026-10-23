// /api/cancel?ref=GSS-XXXXXX&token=… — the "withdraw" link in booking emails.
// GET shows a confirmation page (so link previewers in mail apps can't cancel anything); POST cancels.
import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { db, esc, type Booking } from "./_lib/db";
import { sendAll, withdrawnNotice } from "./_lib/email";
import { SITE, space, when } from "./_lib/rules";

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | ${esc(SITE.name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap">
<link rel="stylesheet" href="/styles.css"></head><body>
<main class="container bk-standalone"><a class="back" href="/">← ${esc(SITE.name)}</a><div class="form">${body}</div></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const ref = q.get("ref") ?? "", token = q.get("token") ?? "";
  const { data } = await db().from("bookings").select("*").eq("reference", ref).maybeSingle();
  const b = data as Booking | null;
  if (!b || !same(b.cancel_token, token)) return page("Link not valid", `<h1>This link isn't valid</h1><p>Please email <a class="accent" href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a> and we'll help.</p>`, 404);

  const summary = `<dl class="bk-dl"><div><dt>Reference</dt><dd>${esc(b.reference)}</dd></div><div><dt>Space</dt><dd>${esc(space(b.space)?.label ?? b.space)}</dd></div><div><dt>When</dt><dd>${esc(when(b.starts_at, b.ends_at, b.full_day))}</dd></div><div><dt>Event</dt><dd>${esc(b.event)}</dd></div></dl>`;
  const live = b.status === "pending" || b.status === "approved";
  if (!live) return page("Already closed", `<p class="eyebrow">Booking ${esc(b.reference)}</p><h1>This booking is no longer active</h1><p>Its status is <strong>${esc(b.status)}</strong>, so there's nothing to withdraw.</p>${summary}`);
  if (Date.parse(b.starts_at) < Date.now()) return page("Already started", `<h1>This booking has already started</h1><p>Please email <a class="accent" href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>.</p>${summary}`);

  if (req.method === "POST") {
    const { data: done } = await db().from("bookings").update({ status: "cancelled", decided_at: new Date().toISOString(), decided_by: "requester" })
      .eq("id", b.id).in("status", ["pending", "approved"]).select().maybeSingle();
    if (done) await sendAll(withdrawnNotice({ ...(done as Booking), status: b.status }));
    return page("Withdrawn", `<p class="eyebrow">Booking ${esc(b.reference)}</p><h1>Done. The time has been released.</h1><p>We've sent you a confirmation email.</p>${summary}<a class="btn btn-solid" href="/reservations/">Make a new booking</a>`);
  }
  return page("Withdraw booking", `<p class="eyebrow">Booking ${esc(b.reference)}</p><h1>Withdraw this ${b.status === "approved" ? "booking" : "request"}?</h1>${summary}
<form method="POST"><button class="btn btn-solid" type="submit">Yes, withdraw it</button></form><p class="form-intro">Changed your mind? Just close this page.</p>`);
};

export const config: Config = { path: "/api/cancel" };
