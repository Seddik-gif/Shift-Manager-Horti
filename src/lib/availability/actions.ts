"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { romeInstant } from "@/lib/time/rome";
import { emailSoon } from "@/lib/notifications/dispatch";
import { validateWeek } from "./logic";

const KNOWN = [
  "forbidden", "request_exists", "request_not_open", "request_not_draft", "overlap", "incomplete",
  "already_submitted", "day_out_of_week", "duplicate_day", "invalid_input", "not_submitted", "note_required", "not_found",
] as const;
export type AvailabilityError = (typeof KNOWN)[number] | "unknown";
export type AvailabilityResult = { ok: true; id?: string } | { ok: false; error: AvailabilityError };

function toError(message: string | undefined): AvailabilityResult {
  const hit = KNOWN.find((k) => message?.includes(k));
  return { ok: false, error: hit ?? "unknown" };
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const daysSchema = z
  .array(
    z.object({
      day: z.string().regex(dayRe),
      available: z.boolean().nullable(),
      note: z.string().max(300),
      windows: z.array(z.object({ start: z.string().regex(timeRe), end: z.string().regex(timeRe) })).max(8),
    }),
  )
  .length(7);

const requestSchema = z.object({
  weekStart: z.string().regex(dayRe),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), // Rome wall-clock from <input type="datetime-local">
  message: z.string().max(500),
  send: z.boolean(),
});

/** Admin-only (enforced inside the SQL function): create a draft or open request. */
export async function createRequest(input: unknown): Promise<AvailabilityResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_availability_request", {
    p_week_start: v.weekStart,
    p_deadline: romeInstant(v.deadline.slice(0, 10), v.deadline.slice(11, 16)).toISOString(),
    p_message: v.message,
    p_send: v.send,
  });
  if (error) return toError(error.message);
  revalidatePath("/", "layout");
  if (v.send) emailSoon();
  return { ok: true, id: data as string };
}

export async function sendRequest(id: string): Promise<AvailabilityResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_availability_request", { p_id: id });
  if (error) return toError(error.message);
  revalidatePath("/", "layout");
  emailSoon();
  return { ok: true, id };
}

export async function closeRequest(id: string): Promise<AvailabilityResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_availability_request", { p_id: id });
  if (error) return toError(error.message);
  revalidatePath("/", "layout");
  return { ok: true, id };
}

/** Employee-only (enforced inside the SQL function): own availability, only while the request is open. */
export async function saveAvailability(
  requestId: string,
  days: unknown,
  notes: string,
  submit: boolean,
): Promise<AvailabilityResult> {
  const parsed = daysSchema.safeParse(days);
  if (!parsed.success || notes.length > 500) return { ok: false, error: "invalid_input" };
  // same rules as the database, checked first for a faster answer
  const issues = validateWeek(parsed.data, submit);
  if (Object.keys(issues).length > 0) {
    const overlap = Object.values(issues).some((l) => l.includes("overlap"));
    return { ok: false, error: overlap ? "overlap" : "incomplete" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_availability", {
    p_request_id: requestId,
    p_days: parsed.data,
    p_notes: notes,
    p_submit: submit,
  });
  if (error) return toError(error.message);
  revalidatePath("/", "layout");
  if (submit) emailSoon();
  return { ok: true, id: data as string };
}

/** Admin only (enforced in SQL): confirm what the employee submitted, or ask for changes (note required). */
export async function reviewAvailability(submissionId: string, confirm: boolean, note: string): Promise<AvailabilityResult> {
  if (!z.uuid().safeParse(submissionId).success || note.length > 300) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_availability", { p_submission: submissionId, p_confirm: confirm, p_note: note });
  if (error) return toError(error.message);
  revalidatePath("/", "layout");
  emailSoon();
  return { ok: true };
}
