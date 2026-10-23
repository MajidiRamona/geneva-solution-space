// Minimal iCalendar (RFC 5545) output for email invites and the staff calendar feed.
import { LOCATION, SITE } from "./rules";

export type IcsEvent = {
  uid: string; start: Date | string; end: Date | string; summary: string;
  description?: string; status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED"; url?: string; location?: string;
};

const stamp = (d: Date | string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const textValue = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);

// Lines longer than 75 octets are folded with CRLF + space.
function fold(line: string) {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 74) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function calendar(events: IcsEvent[], name = SITE.name + " bookings") {
  const now = stamp(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Geneva Solution Space//Bookings//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${textValue(name)}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@genevasolutionspace.org`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${textValue(e.summary)}`,
      `LOCATION:${textValue(e.location ?? LOCATION)}`,
      `STATUS:${e.status ?? "CONFIRMED"}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${textValue(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
