// Booking emails, sent through Resend (https://resend.com).
// Without RESEND_API_KEY (e.g. local testing) emails are printed to the log instead of sent.
import { esc, type Booking } from "./db";
import { calendar } from "./ics";
import { BOOKING, chf, SITE, SITE_URL, space, STAFF_EMAIL, when } from "./rules";

const FROM = process.env.MAIL_FROM || `${SITE.name} <bookings@genevasolutionspace.org>`;

type Mail = { to: string; subject: string; html: string; replyTo?: string; ics?: string };

async function send(m: Mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log(`[email not sent: no RESEND_API_KEY] to=${m.to} subject=${m.subject}`); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [m.to], subject: m.subject, html: m.html, reply_to: m.replyTo || SITE.email,
      attachments: m.ics ? [{ filename: "booking.ics", content: Buffer.from(m.ics).toString("base64") }] : undefined,
    }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text());
}

/** Sends several emails; a failed email never fails the booking itself. */
export async function sendAll(mails: Mail[]) {
  const results = await Promise.allSettled(mails.map(send));
  for (const r of results) if (r.status === "rejected") console.error("email failed", r.reason);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function layout(heading: string, intro: string, rows: [string, string][], after = "") {
  const table = rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #E6E1D6;color:#5C6270;font-size:14px;width:38%;vertical-align:top">${esc(k)}</td>` +
    `<td style="padding:10px 0;border-bottom:1px solid #E6E1D6;color:#0E1526;font-size:15px;vertical-align:top">${v}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#F5F2EB;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0E1526">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EB;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid #E6E1D6;border-radius:6px">
<tr><td style="padding:28px 32px 0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#5C6270">${esc(SITE.name)}</td></tr>
<tr><td style="padding:12px 32px 0"><h1 style="margin:0;font-size:24px;line-height:1.25;letter-spacing:-.02em">${heading}</h1></td></tr>
<tr><td style="padding:14px 32px 8px;font-size:16px;line-height:1.6;color:#3B4250">${intro}</td></tr>
<tr><td style="padding:8px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${table}</table></td></tr>
${after ? `<tr><td style="padding:16px 32px 0;font-size:15px;line-height:1.6;color:#3B4250">${after}</td></tr>` : ""}
<tr><td style="padding:28px 32px 32px;font-size:13px;line-height:1.6;color:#8A93A6">${esc(SITE.address.join(" · "))}<br><a href="mailto:${esc(SITE.email)}" style="color:#3563E9">${esc(SITE.email)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0E1526;color:#F5F2EB;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px">${esc(label)}</a>`;

const para = (s: string) => esc(s).replace(/\n/g, "<br>");

function details(b: Booking): [string, string][] {
  return [
    ["Reference", `<strong>${esc(b.reference)}</strong>`],
    ["Space", esc(space(b.space)?.label ?? b.space)],
    ["When", esc(when(b.starts_at, b.ends_at, b.full_day))],
    ["Event", esc(b.event)],
    ["Participants", esc(b.participants)],
  ];
}

const cancelUrl = (b: Booking) => `${SITE_URL}/api/cancel?ref=${encodeURIComponent(b.reference)}&token=${b.cancel_token}`;
const adminUrl = (b: Booking) => `${SITE_URL}/admin/bookings/#${encodeURIComponent(b.reference)}`;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function requestReceived(b: Booking): Mail {
  return {
    to: b.email!, subject: `Booking request received – ${b.reference}`,
    html: layout(
      "We've received your request",
      `Hello ${esc(b.name)},<br>thank you for your request. ${esc(BOOKING.confirmation_note || "The time is held for you while we review it.")} We'll confirm the booking and the final price by email.`,
      [...details(b), ["Estimated price", esc(chf(b.price_estimate)) + (b.first_time ? " <span style=\"color:#5C6270\">(first-time discount applied)</span>" : "")]],
      `Plans changed? ${button(cancelUrl(b), "Withdraw this request")}`,
    ),
  };
}

export function staffNewRequest(b: Booking): Mail {
  return {
    to: STAFF_EMAIL, replyTo: b.email!, subject: `New booking request: ${space(b.space)?.label} · ${when(b.starts_at, b.ends_at, b.full_day)}`,
    html: layout(
      "New booking request",
      `${esc(b.name)}${b.organization ? ` (${esc(b.organization)})` : ""} has asked to book the space. Reply to this email to write to them directly.`,
      [
        ...details(b),
        ["Name", esc(b.name)], ["Email", `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`], ["Phone", esc(b.phone)],
        ["Organization", esc(b.organization)], ["First booking", b.first_time ? "Yes" : "No"],
        ["Estimated price", esc(chf(b.price_estimate))], ["Plans", para(b.plan ?? "")],
      ],
      button(adminUrl(b), "Review in the dashboard"),
    ),
  };
}

export function approved(b: Booking): Mail {
  const label = space(b.space)?.label ?? b.space;
  return {
    to: b.email!, subject: `Booking confirmed – ${label}, ${when(b.starts_at, b.ends_at, b.full_day)}`,
    ics: calendar([{ uid: b.id, start: b.starts_at, end: b.ends_at, summary: `${b.event} · ${label}`, description: `Booking ${b.reference}` }]),
    html: layout(
      "Your booking is confirmed",
      `Hello ${esc(b.name)},<br>good news: your booking is confirmed. A calendar invite is attached.`,
      [...details(b), ["Price", `<strong>${esc(chf(b.price_final ?? b.price_estimate))}</strong> <span style="color:#5C6270">· invoiced separately</span>`]],
      (b.admin_note ? `<p style="margin:0 0 16px">${para(b.admin_note)}</p>` : "") +
        `Please read the <a href="${SITE_URL}/code-of-conduct/" style="color:#3563E9">house rules</a> before your event. If your plans change, you can <a href="${esc(cancelUrl(b))}" style="color:#3563E9">cancel the booking here</a>.`,
    ),
  };
}

export function declined(b: Booking): Mail {
  return {
    to: b.email!, subject: `About your booking request – ${b.reference}`,
    html: layout(
      "We can't confirm this request",
      `Hello ${esc(b.name)},<br>unfortunately we're unable to confirm your request.`,
      details(b),
      (b.admin_note ? `<p style="margin:0 0 16px">${para(b.admin_note)}</p>` : "") +
        `You're welcome to <a href="${SITE_URL}/reservations/" style="color:#3563E9">choose another time</a> or reply to this email.`,
    ),
  };
}

export function cancelledByStaff(b: Booking): Mail {
  return {
    to: b.email!, subject: `Booking cancelled – ${b.reference}`,
    html: layout(
      "Your booking has been cancelled",
      `Hello ${esc(b.name)},<br>the booking below has been cancelled. Please reply to this email if you have any questions.`,
      details(b),
      b.admin_note ? para(b.admin_note) : "",
    ),
  };
}

export function withdrawnNotice(b: Booking): Mail[] {
  return [
    {
      to: b.email!, subject: `Booking withdrawn – ${b.reference}`,
      html: layout("Your booking has been withdrawn", `Hello ${esc(b.name)},<br>as requested, we've released the time below.`, details(b),
        `Need another date? <a href="${SITE_URL}/reservations/" style="color:#3563E9">Book again</a>.`),
    },
    {
      to: STAFF_EMAIL, subject: `Withdrawn by requester: ${b.reference}`,
      html: layout("A booking was withdrawn", `${esc(b.name)} withdrew their ${esc(b.status)} booking. The time is free again.`, details(b)),
    },
  ];
}
