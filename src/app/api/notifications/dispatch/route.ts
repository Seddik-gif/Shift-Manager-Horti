import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchEmails } from "@/lib/notifications/dispatch";
import { dispatchPush } from "@/lib/push/send";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * "Send what is waiting now" for programs that are not the web app (the native Windows program): the database creates
 * the notifications, but pushing them to phones (and email) happens here. Administrators only, proven by the caller's own
 * Supabase access token in "Authorization: Bearer ...". Cookies are not accepted, so another website cannot trigger it.
 */
export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const env = getSupabaseEnv();
  if (!token || !env) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle<{ role: string; is_active: boolean }>();
  if (!profile?.is_active || profile.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const push = await dispatchPush().catch(() => ({ status: "error" as const }));
  const email = await dispatchEmails().catch(() => ({ status: "error" as const }));
  return NextResponse.json({ push, email });
}
