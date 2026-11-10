"use server";

import { z } from "zod";
import { getSessionProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { sendTestPush } from "./send";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(10).max(100) }),
});
export type PushActionResult = { ok: true } | { ok: false; error: "invalid_input" | "forbidden" | "unknown" };

/** Store this device's push subscription for the signed-in person. */
export async function savePushSubscription(subscription: unknown, userAgent: string): Promise<PushActionResult> {
  const p = subscriptionSchema.safeParse(subscription);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: p.data.endpoint, p_p256dh: p.data.keys.p256dh, p_auth: p.data.keys.auth, p_user_agent: userAgent.slice(0, 300),
  });
  if (error) return { ok: false, error: error.message.includes("forbidden") ? "forbidden" : error.message.includes("invalid_input") ? "invalid_input" : "unknown" };
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<PushActionResult> {
  if (!z.url().safeParse(endpoint).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  return error ? { ok: false, error: "unknown" } : { ok: true };
}

/** "Send me a test": confirms that this person's devices really receive pushes. */
export async function sendMyTestPush(): Promise<{ ok: boolean; configured: boolean; devices: number; delivered: number }> {
  const me = await getSessionProfile();
  if (!me?.is_active) return { ok: false, configured: true, devices: 0, delivered: 0 };
  return sendTestPush(me.id, me.preferred_language);
}
