"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Snapshot } from "@/lib/scheduling/snapshot";
import { buildWeeklyMessage } from "./message";

type Step = "copied" | "opened" | "confirmed";
export type ShareResult<T = object> = ({ ok: true } & T) | { ok: false; error: "forbidden" | "not_published" | "not_found" | "already_confirmed" | "invalid_input" | "unknown" };

const KNOWN = ["forbidden", "not_published", "not_found", "already_confirmed", "invalid_input"] as const;
const fail = (m?: string): { ok: false; error: (typeof KNOWN)[number] | "unknown" } => ({ ok: false, error: KNOWN.find((k) => m?.includes(k)) ?? "unknown" });

/**
 * Builds the message from the published snapshot and records that it was prepared.
 * Nothing is ever sent to WhatsApp from here: the admin copies and pastes it manually.
 */
export async function prepareShare(weekStart: string, locale: "it" | "en"): Promise<ShareResult<{ id: string; message: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || (locale !== "it" && locale !== "en")) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data: pub } = await supabase.from("published_schedules").select("snapshot").eq("week_start", weekStart).maybeSingle<{ snapshot: Snapshot }>();
  if (!pub) return { ok: false, error: "not_published" };
  const message = buildWeeklyMessage(pub.snapshot, locale);
  const { data, error } = await supabase.rpc("prepare_whatsapp_share", { p_week_start: weekStart, p_locale: locale, p_message: message });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, id: data as string, message };
}

export async function markShareStep(id: string, step: Step): Promise<ShareResult> {
  if (!["copied", "opened", "confirmed"].includes(step)) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_whatsapp_step", { p_id: id, p_step: step });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}
