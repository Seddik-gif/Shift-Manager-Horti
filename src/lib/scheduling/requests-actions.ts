"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSoon } from "@/lib/notifications/dispatch";

const KNOWN = [
  "forbidden", "invalid_input", "outside_hours", "not_found", "not_open", "overlap", "already_requested",
  "already_decided", "in_the_past", "invalid_location",
] as const;
export type RequestError = (typeof KNOWN)[number] | "unknown";
export type RequestResult = { ok: true; id?: string } | { ok: false; error: RequestError };

const fail = (m?: string): { ok: false; error: RequestError } => ({ ok: false, error: KNOWN.find((k) => m?.includes(k)) ?? "unknown" });
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const done = () => {
  revalidatePath("/", "layout");
  emailSoon();
};

const openSchema = z.object({
  day: z.string().regex(dayRe), start: z.string().regex(timeRe), end: z.string().regex(timeRe),
  position: z.string().trim().max(60), note: z.string().trim().max(300), slots: z.number().int().min(1).max(20), locationId: z.uuid().optional(),
});

/** Admin only (enforced in SQL). */
export async function createOpenShift(input: unknown): Promise<RequestResult> {
  const p = openSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_open_shift", {
    p_day: p.data.day, p_start: p.data.start, p_end: p.data.end, p_position: p.data.position, p_note: p.data.note, p_slots: p.data.slots, p_location: p.data.locationId ?? null,
  });
  if (error) return fail(error.message);
  done();
  return { ok: true, id: data as string };
}

/** Admin only. */
export async function cancelOpenShift(id: string): Promise<RequestResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_open_shift", { p_id: id });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

/** Employee asks to take an open shift. Nothing is assigned until an admin approves. */
export async function requestOpenShift(openId: string, note: string): Promise<RequestResult> {
  if (!z.uuid().safeParse(openId).success || note.length > 300) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_open_shift", { p_open: openId, p_note: note });
  if (error) return fail(error.message);
  done();
  return { ok: true, id: data as string };
}

const offerSchema = z.object({ day: z.string().regex(dayRe), start: z.string().regex(timeRe), end: z.string().regex(timeRe), note: z.string().trim().max(300), locationId: z.uuid().optional() });

/** Employee offers to work a time. Nothing is assigned until an admin approves. */
export async function offerShift(input: unknown): Promise<RequestResult> {
  const p = offerSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_shift", { p_day: p.data.day, p_start: p.data.start, p_end: p.data.end, p_note: p.data.note, p_location: p.data.locationId ?? null });
  if (error) return fail(error.message);
  done();
  return { ok: true, id: data as string };
}

export async function withdrawRequest(id: string): Promise<RequestResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_shift_request", { p_id: id });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

/** Admin only: approving creates the real shift. */
export async function decideRequest(id: string, approve: boolean, note: string): Promise<RequestResult> {
  if (!z.uuid().safeParse(id).success || note.length > 300) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_shift_request", { p_id: id, p_approve: approve, p_note: note });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}
