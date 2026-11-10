"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSoon } from "@/lib/notifications/dispatch";

const KNOWN = ["forbidden", "invalid_input", "absence_overlap", "not_found", "already_decided"] as const;
export type AbsenceError = (typeof KNOWN)[number] | "unknown";
export type AbsenceResult<T = object> = ({ ok: true } & T) | { ok: false; error: AbsenceError };

const fail = (m?: string): { ok: false; error: AbsenceError } => ({ ok: false, error: KNOWN.find((k) => m?.includes(k)) ?? "unknown" });
const done = () => {
  revalidatePath("/", "layout");
  emailSoon();
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestSchema = z.object({
  kind: z.enum(["ferie", "assenza"]),
  start: day,
  end: day,
  reason: z.string().trim().max(300),
});

/** Employee asks for time off. Nothing changes until an admin approves. */
export async function requestAbsence(input: unknown): Promise<AbsenceResult<{ id: string }>> {
  const p = requestSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_absence", {
    p_kind: p.data.kind, p_start: p.data.start, p_end: p.data.end, p_reason: p.data.reason,
  });
  if (error) return fail(error.message);
  done();
  return { ok: true, id: data as string };
}

export async function withdrawAbsence(id: string): Promise<AbsenceResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_absence", { p_id: id });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

/** Admin only (enforced in SQL). On approval, reports planned shifts that fall inside the absence. */
export async function decideAbsence(id: string, approve: boolean, note: string): Promise<AbsenceResult<{ conflicts: number }>> {
  if (!z.uuid().safeParse(id).success || note.length > 300) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_absence", { p_id: id, p_approve: approve, p_note: note });
  if (error) return fail(error.message);
  done();
  return { ok: true, conflicts: (data as { conflicts: number }).conflicts };
}
