"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSoon } from "@/lib/notifications/dispatch";

const KNOWN = ["forbidden", "invalid_input", "broadcast_only", "not_found"] as const;
export type ChatError = (typeof KNOWN)[number] | "unknown";
export type ChatResult<T = object> = ({ ok: true } & T) | { ok: false; error: ChatError };

const fail = (m?: string): { ok: false; error: ChatError } => ({ ok: false, error: KNOWN.find((k) => m?.includes(k)) ?? "unknown" });
const id = z.uuid();

/** Post a message. Only people who can open the thread can write in it (enforced in SQL). */
export async function sendChatMessage(threadId: string, body: string, replyTo: string | null, mentions: string[]): Promise<ChatResult> {
  const text = body.trim();
  if (!id.safeParse(threadId).success || text.length < 1 || text.length > 2000 || (replyTo !== null && !id.safeParse(replyTo).success)
      || !z.array(z.uuid()).max(50).safeParse(mentions).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_chat_message", { p_thread: threadId, p_body: text, p_reply_to: replyTo, p_mentions: mentions });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  emailSoon(); // push first, then email
  return { ok: true };
}

export async function markChatRead(threadId: string): Promise<ChatResult> {
  if (!id.safeParse(threadId).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_chat_read", { p_thread: threadId });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setChatNotify(threadId: string, mode: "all" | "mentions" | "none"): Promise<ChatResult> {
  if (!id.safeParse(threadId).success || !["all", "mentions", "none"].includes(mode)) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_chat_notify", { p_thread: threadId, p_mode: mode });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Start (or reopen) a private chat with one person. */
export async function openDirectChat(otherId: string): Promise<ChatResult<{ threadId: string }>> {
  if (!id.safeParse(otherId).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_direct_thread", { p_other: otherId });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, threadId: data as string };
}

export async function deleteChatMessage(messageId: string): Promise<ChatResult> {
  if (!id.safeParse(messageId).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_chat_message", { p_id: messageId });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Admin only (enforced in SQL). */
export async function saveChatOptions(locationBroadcast: boolean): Promise<ChatResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_chat_options", { p_location_broadcast: locationBroadcast });
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Admin only: the "Clean now" button. */
export async function purgeChatNow(): Promise<ChatResult<{ messages: number; notifications: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purge_chat_now");
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  const r = data as { messages: number; notifications: number };
  return { ok: true, messages: r.messages, notifications: r.notifications };
}
