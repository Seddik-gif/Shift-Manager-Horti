"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSoon } from "@/lib/notifications/dispatch";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const shiftSchema = z.object({
  id: z.uuid().nullable(),
  employeeId: z.uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(timeRe),
  end: z.string().regex(timeRe),
  position: z.string().trim().max(60),
  notes: z.string().trim().max(500),
  override: z.boolean(),
  overrideNote: z.string().trim().max(300),
  locationId: z.uuid().optional(),
});
export type ShiftInput = z.infer<typeof shiftSchema>;

const KNOWN = ["forbidden", "invalid_input", "invalid_employee", "invalid_location", "employee_not_in_location", "overlap", "outside_hours", "not_found"] as const;
export type ShiftError = (typeof KNOWN)[number] | "unknown";
export type ShiftResult =
  | { ok: true; id: string; warnings: { type: string; hours?: number }[] }
  | { ok: false; error: ShiftError }
  /** the shift is outside submitted availability: ask the admin to acknowledge, then resend with override */
  | { ok: false; warning: "outside" | "no_submission" | "absence" };

const toError = (m?: string): { ok: false; error: ShiftError } => ({
  ok: false,
  error: KNOWN.find((k) => m?.includes(k)) ?? "unknown",
});

/** Admin-only (enforced in SQL): create or update/move a shift. */
export async function saveShift(input: unknown): Promise<ShiftResult> {
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_shift", {
    p_id: v.id, p_employee: v.employeeId, p_day: v.day, p_start: v.start, p_end: v.end,
    p_position: v.position, p_notes: v.notes, p_override: v.override, p_override_reason: v.overrideNote, p_location: v.locationId ?? null,
  });
  if (error) return toError(error.message);
  const res = data as { ok: boolean; id?: string; warning?: "outside" | "no_submission" | "absence"; warnings?: { type: string; hours?: number }[] };
  if (!res.ok) return { ok: false, warning: res.warning ?? "outside" };
  revalidatePath("/", "layout");
  return { ok: true, id: res.id as string, warnings: res.warnings ?? [] };
}

export async function deleteShift(id: string): Promise<{ ok: true } | { ok: false; error: ShiftError }> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_shift", { p_id: id });
  if (error) return toError(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Changes to shifts are collected, not announced one by one: this tells each affected employee once. */
export async function sendShiftUpdates(): Promise<{ ok: true; employees: number; changes: number } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_shift_updates");
  if (error) return { ok: false };
  const r = data as { employees: number; changes: number };
  revalidatePath("/", "layout");
  emailSoon(); // push first, then email
  return { ok: true, employees: r.employees, changes: r.changes };
}

/** Keeps the shifts as they are but tells nobody. */
export async function discardShiftNotices(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_shift_notices");
  if (error) return { ok: false };
  revalidatePath("/", "layout");
  return { ok: true };
}
