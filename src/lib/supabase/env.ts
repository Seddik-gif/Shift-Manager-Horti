/** Public Supabase settings. Returns null when credentials have not been provided yet. */
export function getSupabaseEnv() {
  // SUPABASE_SERVER_URL (server-only, optional): a direct address for the app server, e.g. when the browser reaches
  // Supabase through a tunnel but the server runs next to it. Not exposed to the browser.
  const url = process.env.SUPABASE_SERVER_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}
