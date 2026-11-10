import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { afterAttempt, buildPushPayload, outcomeOf, type PushPayload } from "./policy";

export type PushSummary =
  | { status: "not_configured" }
  | { status: "done"; attempted: number; sent: number; failed: number };

interface SubRow { id: string; endpoint: string; p256dh: string; auth: string; failure_count: number }
interface NotifRow {
  id: string; user_id: string; type: string; params: Record<string, unknown>; link: string | null;
  profiles: { preferred_language: "it" | "en"; is_active: boolean } | null;
}

/** Push is only useful when it is fresh: older notifications stay in the bell and in email. */
const FRESH_MINUTES = 15;

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function configure() {
  setVapidDetails(process.env.VAPID_SUBJECT as string, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string, process.env.VAPID_PRIVATE_KEY as string);
}

/** Sends one payload to one device and updates that device's health. Returns true on success. */
async function sendTo(sub: SubRow, payload: PushPayload): Promise<boolean> {
  const admin = createAdminClient();
  try {
    await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24, timeout: 8000 });
    await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", sub.id);
    return true;
  } catch (e) {
    const verdict = afterAttempt(sub.failure_count, outcomeOf(e));
    if (verdict.action === "delete") await admin.from("push_subscriptions").delete().eq("id", sub.id);
    else await admin.from("push_subscriptions").update({
      failure_count: verdict.failureCount, last_failure_at: new Date().toISOString(),
      ...(verdict.action === "disable" ? { disabled_at: new Date().toISOString() } : {}),
    }).eq("id", sub.id);
    return false;
  }
}

/**
 * Pushes fresh, unread notifications to the devices of their recipients, once each.
 * The delivery row is claimed BEFORE sending (unique per notification+channel), so overlapping runs cannot double-send.
 * People without a working device are skipped without a delivery row: they still get the bell and the email.
 */
export async function dispatchPush(): Promise<PushSummary> {
  if (!pushConfigured()) return { status: "not_configured" };
  configure();
  const admin = createAdminClient();
  const since = new Date(Date.now() - FRESH_MINUTES * 60_000).toISOString();

  const { data: recent } = await admin
    .from("notifications")
    .select("id, user_id, type, params, link, profiles!inner(preferred_language, is_active)")
    .is("read_at", null).gte("created_at", since).order("created_at").limit(200)
    .returns<NotifRow[]>();
  if (!recent?.length) return { status: "done", attempted: 0, sent: 0, failed: 0 };

  const { data: done } = await admin.from("notification_deliveries").select("notification_id").eq("channel", "push").in("notification_id", recent.map((n) => n.id));
  const already = new Set((done ?? []).map((d) => d.notification_id));
  const todo = recent.filter((n) => !already.has(n.id) && n.profiles?.is_active);

  const userIds = [...new Set(todo.map((n) => n.user_id))];
  const { data: subs } = userIds.length
    ? await admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, failure_count").in("user_id", userIds).is("disabled_at", null).returns<(SubRow & { user_id: string })[]>()
    : { data: [] as (SubRow & { user_id: string })[] };
  const byUser = new Map<string, SubRow[]>();
  for (const s of subs ?? []) (byUser.get(s.user_id) ?? byUser.set(s.user_id, []).get(s.user_id)!).push(s);

  let attempted = 0, sent = 0, failed = 0;
  for (const n of todo) {
    const devices = byUser.get(n.user_id);
    if (!devices?.length) continue;
    const claim = await admin.from("notification_deliveries")
      .insert({ notification_id: n.id, channel: "push", status: "pending", attempted_at: new Date().toISOString() })
      .select("id").single();
    if (claim.error) continue; // another run already claimed it
    attempted++;
    const payload = buildPushPayload(n.profiles!.preferred_language, n.id, n.type, n.params, n.link);
    const results = await Promise.all(devices.map((d) => sendTo(d, payload)));
    const ok = results.some(Boolean);
    if (ok) sent++; else failed++;
    await admin.from("notification_deliveries").update({ status: ok ? "sent" : "failed", error: ok ? null : "all devices failed" }).eq("id", claim.data.id);
  }
  return { status: "done", attempted, sent, failed };
}

/** A test message to all of one person's devices (not stored as a notification). */
export async function sendTestPush(userId: string, locale: "it" | "en"): Promise<{ ok: boolean; devices: number; delivered: number; configured: boolean }> {
  if (!pushConfigured()) return { ok: false, devices: 0, delivered: 0, configured: false };
  configure();
  const admin = createAdminClient();
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, failure_count").eq("user_id", userId).is("disabled_at", null).returns<SubRow[]>();
  const payload: PushPayload = {
    title: "Horti Magici",
    body: locale === "it" ? "Le notifiche funzionano su questo dispositivo." : "Notifications work on this device.",
    url: locale === "it" ? "/" : "/en",
    tag: "hm-test",
  };
  const results = await Promise.all((subs ?? []).map((s) => sendTo(s, payload)));
  return { ok: results.some(Boolean), devices: results.length, delivered: results.filter(Boolean).length, configured: true };
}
