/**
 * LOCAL DEVELOPMENT CONVENIENCE: let people sign in with just a name ("marco") instead of "marco@horti.test".
 * It only works when LOGIN_ID_DOMAIN is set AND the Supabase address is a private/local one, so it can never be
 * switched on by accident against a hosted project. Real emails always keep working.
 */

/** localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, or a bare local host name */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname;
    if (h === "localhost" || h.endsWith(".localhost")) return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  } catch {
    return false;
  }
}

/** The domain to append, or null when the short-name login is off. */
export function loginIdDomain(env: Record<string, string | undefined> = process.env): string | null {
  const domain = env.LOGIN_ID_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  // the address the app SERVER talks to decides: a local database reached from a phone through a tunnel is still local
  return isLocalSupabaseUrl(env.SUPABASE_SERVER_URL || env.NEXT_PUBLIC_SUPABASE_URL) ? domain : null;
}

/** "Marco" -> "marco@horti.test" when enabled; anything containing "@" is left alone. */
export function resolveLoginId(input: string, domain: string | null): string {
  const id = input.trim();
  if (!domain || id === "" || id.includes("@") || !/^[\p{L}\p{N}._-]+$/u.test(id)) return id;
  return `${id.toLowerCase()}@${domain}`;
}
