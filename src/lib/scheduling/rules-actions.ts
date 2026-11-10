"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ min_staff_per_day: z.number().int().min(1).max(50).nullable() });
export type RulesInput = z.infer<typeof schema>;
export type RulesResult = { ok: true } | { ok: false; error: "forbidden" | "invalid_input" | "unknown" };

/** Admin only (enforced in SQL, which also audits the change). null switches a rule off. */
export async function saveRules(input: unknown): Promise<RulesResult> {
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_scheduling_rules", { p_rules: p.data });
  if (error) return { ok: false, error: error.message.includes("forbidden") ? "forbidden" : error.message.includes("invalid_input") ? "invalid_input" : "unknown" };
  revalidatePath("/", "layout");
  return { ok: true };
}
