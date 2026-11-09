import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchEmails } from "@/lib/notifications/dispatch";

/**
 * Scheduled job (see vercel.json): creates deadline reminders, then emails new notifications.
 * Protected by CRON_SECRET – Vercel sends it as "Authorization: Bearer <secret>".
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: reminded, error } = await admin.rpc("run_availability_reminders");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const email = await dispatchEmails();
  return NextResponse.json({ reminded, email });
}
