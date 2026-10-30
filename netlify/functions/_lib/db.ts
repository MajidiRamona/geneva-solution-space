// Database access (Supabase, service key — server side only) and small HTTP helpers.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

export type Status = "pending" | "approved" | "declined" | "cancelled" | "blocked";
export const LIVE: Status[] = ["pending", "approved", "blocked"]; // statuses that occupy the space

export type Booking = {
  id: string; reference: string; space: string; starts_at: string; ends_at: string; full_day: boolean;
  status: Status; name: string | null; email: string | null; phone: string | null; organization: string | null;
  event: string | null; participants: number | null; plan: string | null; first_time: boolean;
  price_estimate: number | null; price_final: number | null; admin_note: string | null; cancel_token: string;
  created_at: string; decided_at: string | null; decided_by: string | null;
  kind: string | null; series_id: string | null; // class / event / meeting / other; shared by the sessions of a series
};

let client: SupabaseClient | undefined;
export function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return (client ??= createClient(url, key, { auth: { persistSession: false } }));
}

/** Postgres error codes we turn into friendly answers. */
export const OVERLAP = "23P01"; // exclusion constraint: the time is already taken
export const DUPLICATE = "23505"; // unique constraint

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
export function newReference(prefix = "GSS-") {
  let s = prefix;
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

export function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
