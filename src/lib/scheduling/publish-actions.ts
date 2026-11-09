"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emailSoon } from "@/lib/notifications/dispatch";

const KNOWN = ["forbidden", "schedule_not_found", "nothing_to_publish", "empty_schedule", "invalid_input"] as const;
export type PublishError = (typeof KNOWN)[number] | "unknown";
export type PublishResult =
  | { ok: true; version: number; republished: boolean }
  | { ok: false; error: PublishError };

/** Admin-only (enforced in SQL). One transaction: version, snapshot, audit, notifications. */
export async function publishSchedule(weekStart: string): Promise<PublishResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_schedule", { p_week_start: weekStart });
  if (error) return { ok: false, error: KNOWN.find((k) => error.message.includes(k)) ?? "unknown" };
  revalidatePath("/", "layout");
  emailSoon(); // email problems can never affect publication
  const r = data as { version: number; republished: boolean };
  return { ok: true, version: r.version, republished: r.republished };
}
