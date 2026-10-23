// Booking rules, prices and Geneva-time helpers.
// Spaces, hours and prices come from content/pages/reservations.json (edited in the CMS),
// bundled into the functions at deploy time, so a CMS change takes effect on the next deploy.
import page from "../../../content/pages/reservations.json";
import site from "../../../content/site.json";

export const TZ = "Europe/Zurich";
export const SLOT_MINUTES = 60;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Space = {
  key: string; label: string; capacity: number; open: string; close: string;
  open_days: string[]; min_hours: number; rate_hour: number; rate_day: number;
};

export const SITE = site as { name: string; email: string; address: string[] };
export const SPACES = (page.spaces as unknown as Space[]);
export const BOOKING = page.booking as {
  min_notice_hours: number; max_advance_days: number; first_time_discount_percent: number;
  staff_email?: string; confirmation_note?: string;
};
export const LOCATION = SITE.address.join(", ");
export const STAFF_EMAIL = process.env.STAFF_EMAIL || BOOKING.staff_email || SITE.email;
export const SITE_URL = (process.env.URL || "https://genevasolutionspace.org").replace(/\/$/, "");

export function space(key: unknown): Space | undefined {
  return SPACES.find((s) => s.key === key);
}

// ---------------------------------------------------------------------------
// Time: everything the visitor sees is Geneva local time; the database stores UTC.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
export const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
export const isTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v) && (v < "24:00" || v === "24:00");
export const minutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
});

/** Geneva wall-clock parts of a UTC instant. */
export function local(d: Date) {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday, second: +p.second };
}

function offsetMs(d: Date) {
  const l = local(d);
  const asUtc = Date.UTC(+l.date.slice(0, 4), +l.date.slice(5, 7) - 1, +l.date.slice(8, 10), +l.time.slice(0, 2), +l.time.slice(3, 5), l.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** UTC instant of a Geneva date + time ("24:00" means midnight at the end of that day). */
export function zoned(date: string, time: string): Date {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
  let t = guess - offsetMs(new Date(guess));
  t = guess - offsetMs(new Date(t)); // second pass settles daylight-saving changes
  return new Date(t);
}

export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekday = (date: string) => WEEKDAYS[new Date(date + "T12:00:00Z").getUTCDay()];
export const isOpenDay = (s: Space, date: string) => s.open_days.includes(weekday(date));

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}

// ---------------------------------------------------------------------------
// Prices (assets/js/booking.js mirrors this for the live estimate)
// ---------------------------------------------------------------------------

export function quote(s: Space, opts: { fullDay: boolean; days: number; hours: number; firstTime: boolean }) {
  const base = opts.fullDay ? opts.days * s.rate_day : Math.min(opts.hours * s.rate_hour, s.rate_day);
  const oneDay = opts.fullDay ? s.rate_day : base;
  const discount = opts.firstTime ? Math.round(oneDay * BOOKING.first_time_discount_percent / 100) : 0;
  return { base, discount, total: base - discount };
}

// ---------------------------------------------------------------------------
// Turning a request into a checked time range
// ---------------------------------------------------------------------------

export type Range = { starts: Date; ends: Date; fullDay: boolean; days: number; hours: number };

/** Validates the time part of a request against the space's rules. Returns a range or an error message. */
export function resolveRange(s: Space, b: Record<string, unknown>, now = new Date()): Range | string {
  if (!isDate(b.date)) return "Please choose a date.";
  const fullDay = b.full_day === true;
  let range: Range;
  if (fullDay) {
    const endDate = b.end_date == null || b.end_date === "" ? b.date : b.end_date;
    if (!isDate(endDate) || endDate < b.date) return "The end date must be on or after the start date.";
    const span = daysBetween(b.date, endDate) + 1;
    if (span > 31) return "For bookings longer than a month, please contact us directly.";
    if (!isOpenDay(s, b.date) || !isOpenDay(s, endDate)) return `${s.label} is closed on that day.`;
    let days = 0;
    for (let i = 0; i < span; i++) if (isOpenDay(s, addDays(b.date, i))) days++;
    range = { starts: zoned(b.date, s.open), ends: zoned(endDate, s.close), fullDay, days, hours: 0 };
  } else {
    if (!isTime(b.start) || !isTime(b.end)) return "Please choose a start and end time.";
    const from = minutes(b.start), to = minutes(b.end);
    if (from % SLOT_MINUTES || to % SLOT_MINUTES) return "Bookings start and end on the hour.";
    if (from < minutes(s.open) || to > minutes(s.close)) return `${s.label} is open ${s.open}–${s.close}.`;
    if (to <= from) return "The end time must be after the start time.";
    const hours = (to - from) / 60;
    if (hours < s.min_hours) return `The minimum booking is ${s.min_hours} hour${s.min_hours > 1 ? "s" : ""}.`;
    if (!isOpenDay(s, b.date)) return `${s.label} is closed on that day.`;
    range = { starts: zoned(b.date, b.start), ends: zoned(b.date, b.end), fullDay, days: 1, hours };
  }
  if (range.starts.getTime() < now.getTime() + BOOKING.min_notice_hours * 3600000)
    return `Requests need at least ${BOOKING.min_notice_hours} hours' notice. For anything sooner, please email ${SITE.email}.`;
  if (daysBetween(local(now).date, b.date as string) > BOOKING.max_advance_days)
    return `Bookings open ${BOOKING.max_advance_days} days ahead.`;
  return range;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "Tuesday 13 October 2026, 09:00–17:00" or "Monday 12 October 2026 – Friday 16 October 2026, full days" */
export function when(starts: Date | string, ends: Date | string, fullDay: boolean) {
  const a = new Date(starts), b = new Date(ends);
  const last = new Date(b.getTime() - 1); // so an end at midnight belongs to the day before
  const la = local(a), lb = local(last);
  const endTime = local(b).time === "00:00" ? "24:00" : local(b).time;
  if (fullDay) return la.date === lb.date ? `${dayFmt.format(a)}, full day` : `${dayFmt.format(a)} – ${dayFmt.format(last)}, full days`;
  if (la.date === lb.date) return `${dayFmt.format(a)}, ${la.time}–${endTime}`;
  return `${dayFmt.format(a)} ${la.time} – ${dayFmt.format(last)} ${endTime}`;
}

export const chf = (n: number | string | null | undefined) =>
  n == null ? "—" : "CHF " + Number(n).toLocaleString("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
