import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchEmails } from "@/lib/notifications/dispatch";
import { dispatchPush } from "@/lib/push/send";

/**
 * Scheduled job (see vercel.json): creates deadline reminders, then emails new notifications.
 * Protected by CRON_SECRET – Vercel sends it as "Authorization: Bearer <secret>".
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // compare digests in constant time so the secret cannot be guessed from response timing
  const digest = (v: string) => createHash("sha256").update(v).digest();
  if (!secret || !timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: reminded, error } = await admin.rpc("run_availability_reminders");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: purged } = await admin.rpc("run_chat_purge");
  const push = await dispatchPush().catch(() => ({ status: "error" as const }));
  const email = await dispatchEmails();
  return NextResponse.json({ reminded, purged, push, email });
}
