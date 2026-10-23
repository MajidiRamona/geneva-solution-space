// Staff sign-in: the same Netlify Identity accounts used for the site editor at /admin/.
// The dashboard sends the logged-in user's token; we check it with the site's Identity service.

export type Staff = { email: string; name: string };

export async function staffUser(req: Request): Promise<Staff | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  // On localhost (netlify dev) Identity lives on the deployed site, so ask that one.
  const here = new URL(req.url);
  const origin = /^(localhost|127\.0\.0\.1)$/.test(here.hostname) && process.env.URL ? process.env.URL : here.origin;
  const res = await fetch(`${origin}/.netlify/identity/user`, { headers: { authorization: auth } }).catch((e) => { console.error("identity check failed", e); return null; });
  if (!res?.ok) return null;
  const user = (await res.json()) as { email?: string; user_metadata?: { full_name?: string } };
  if (!user.email) return null;

  // Optional extra lock: only these addresses may manage bookings (comma-separated).
  const allow = (process.env.BOOKING_ADMINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(user.email.toLowerCase())) return null;
  return { email: user.email, name: user.user_metadata?.full_name || user.email };
}
