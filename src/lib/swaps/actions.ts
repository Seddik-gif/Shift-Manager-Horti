"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSoon } from "@/lib/notifications/dispatch";

const KNOWN = [
  "forbidden", "invalid_input", "not_found", "in_the_past", "recipient_unavailable", "swap_exists", "already_decided",
  "swap_stale", "recipient_busy", "recipient_absent",
] as const;
export type SwapError = (typeof KNOWN)[number] | "unknown";
export type SwapResult<T = object> = ({ ok: true } & T) | { ok: false; error: SwapError };

const fail = (m?: string): { ok: false; error: SwapError } => ({ ok: false, error: KNOWN.find((k) => m?.includes(k)) ?? "unknown" });
const done = () => {
  revalidatePath("/", "layout");
  emailSoon();
};
const id = z.uuid();

/** Colleagues who could take this shift (free then, same location, not on leave). Only the shift's owner gets a list. */
export async function swapCandidates(shiftId: string): Promise<SwapResult<{ candidates: { id: string; name: string }[] }>> {
  if (!id.safeParse(shiftId).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("swap_candidates", { p_shift: shiftId });
  if (error) return fail(error.message);
  return { ok: true, candidates: (data ?? []) as { id: string; name: string }[] };
}

export async function proposeSwap(shiftId: string, recipientId: string, note: string): Promise<SwapResult> {
  if (!id.safeParse(shiftId).success || !id.safeParse(recipientId).success || note.length > 300) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("propose_swap", { p_shift: shiftId, p_recipient: recipientId, p_note: note });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

/** The colleague answers. `outcome` tells whether it now waits for an admin or is already done. */
export async function respondSwap(swapId: string, accept: boolean): Promise<SwapResult<{ outcome: "rejected" | "review" | "approved" }>> {
  if (!id.safeParse(swapId).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_swap", { p_id: swapId, p_accept: accept });
  if (error) return fail(error.message);
  done();
  return { ok: true, outcome: data as "rejected" | "review" | "approved" };
}

export async function withdrawSwap(swapId: string): Promise<SwapResult> {
  if (!id.safeParse(swapId).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_swap", { p_id: swapId });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

/** Admin only (enforced in SQL). Approving moves the shift to the colleague. */
export async function decideSwap(swapId: string, approve: boolean, note: string): Promise<SwapResult> {
  if (!id.safeParse(swapId).success || note.length > 300) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_swap", { p_id: swapId, p_approve: approve, p_note: note });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

export async function saveSwapOptions(adminApproval: boolean): Promise<SwapResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_swap_options", { p_admin_approval: adminApproval });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}
