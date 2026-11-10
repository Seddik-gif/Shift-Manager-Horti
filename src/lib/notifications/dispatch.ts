import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPush } from "@/lib/push/send";
import { renderNotification } from "./render";

export type DispatchSummary =
  | { status: "not_configured" }
  | { status: "done"; attempted: number; sent: number; failed: number };

interface Row {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: string | null;
  profiles: { email: string; preferred_language: "it" | "en"; is_active: boolean } | null;
}

/**
 * Emails recent notifications through Resend, once each.
 * A delivery row is claimed BEFORE sending (unique per notification+channel), so concurrent runs
 * cannot send twice. `status = 'sent'` means the provider ACCEPTED the message and returned an id;
 * `delivered_at` stays null because acceptance is not proof of delivery (a Resend webhook would set it).
 */
export async function dispatchEmails(): Promise<DispatchSummary> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { status: "not_configured" };

  const admin = createAdminClient();
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const { data: recent } = await admin
    .from("notifications")
    .select("id, type, params, link, profiles!inner(email, preferred_language, is_active)")
    .gte("created_at", since)
    .order("created_at")
    .limit(200)
    .returns<Row[]>();
  const ids = (recent ?? []).map((n) => n.id);
  const { data: done } = ids.length
    ? await admin.from("notification_deliveries").select("notification_id").in("notification_id", ids)
    : { data: [] as { notification_id: string }[] };
  const already = new Set((done ?? []).map((d) => d.notification_id));
  const candidates = (recent ?? []).filter((n) => !already.has(n.id)).slice(0, 100);

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  let sent = 0, failed = 0, attempted = 0;

  for (const n of candidates ?? []) {
    if (!n.profiles?.is_active) continue;
    const claim = await admin
      .from("notification_deliveries")
      .insert({ notification_id: n.id, channel: "email", status: "pending", attempted_at: new Date().toISOString() })
      .select("id")
      .single();
    if (claim.error) continue; // another run already claimed it
    attempted++;

    const locale = n.profiles.preferred_language;
    const { title, body } = renderNotification(locale, n.type, n.params);
    const url = n.link ? `${site}${locale === "it" ? "" : "/en"}${n.link}` : site;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: n.profiles.email, subject: `Horti Magici · ${title}`,
          text: `${title}\n\n${body}\n\n${url}`,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok && json.id) {
        sent++;
        await admin.from("notification_deliveries").update({ status: "sent", provider_message_id: json.id }).eq("id", claim.data.id);
      } else {
        failed++;
        await admin.from("notification_deliveries").update({ status: "failed", error: json.message ?? `HTTP ${res.status}` }).eq("id", claim.data.id);
      }
    } catch (e) {
      failed++;
      await admin.from("notification_deliveries").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", claim.data.id);
    }
  }
  return { status: "done", attempted, sent, failed };
}

/**
 * Deliver new notifications right after the response: push first (it is time-sensitive), then email.
 * The name is historical. Each channel is isolated, so a failure in one never affects the user action or the other
 * channel; the cron job retries email.
 */
export function emailSoon() {
  after(async () => {
    try {
      await dispatchPush();
    } catch {
      /* push is best-effort */
    }
    try {
      await dispatchEmails();
    } catch {
      /* the cron job retries */
    }
  });
}
