"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { employeeSchema, employeeUpdateSchema } from "@/lib/validation/employee";

export type EmployeeResult =
  | { ok: true; id: string }
  | { ok: false; error: "forbidden" | "invalid" | "emailTaken" | "inviteNotConfigured" | "inviteFailed" | "saveFailed" | "notFound" };

/** Server-side authorisation: the caller must be an active administrator (checked in the DB). */
async function adminOnly() {
  const profile = await getSessionProfile();
  return profile && profile.is_active && profile.role === "admin" ? profile : null;
}

export async function createEmployee(input: unknown): Promise<EmployeeResult> {
  if (!(await adminOnly())) return { ok: false, error: "forbidden" };
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "inviteNotConfigured" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, {
    data: {
      first_name: v.firstName,
      last_name: v.lastName,
      phone: v.phone,
      job_position: v.jobPosition,
      color: v.color,
      preferred_language: v.preferredLanguage,
    },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/confirm`,
  });
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return { ok: false, error: taken ? "emailTaken" : "inviteFailed" };
  }

  const supabase = await createClient();
  await supabase.rpc("log_audit", {
    p_action: "employee.created",
    p_entity_type: "profile",
    p_entity_id: data.user.id,
    p_changes: { email: v.email, first_name: v.firstName, last_name: v.lastName },
  });
  revalidatePath("/", "layout");
  return { ok: true, id: data.user.id };
}

export async function updateEmployee(id: string, input: unknown): Promise<EmployeeResult> {
  if (!(await adminOnly())) return { ok: false, error: "forbidden" };
  const parsed = employeeUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("profiles")
    .select("first_name, last_name, phone, job_position, color, preferred_language")
    .eq("id", id)
    .eq("role", "employee")
    .maybeSingle();
  if (!before) return { ok: false, error: "notFound" };

  const next = {
    first_name: v.firstName,
    last_name: v.lastName,
    phone: v.phone || null,
    job_position: v.jobPosition || null,
    color: v.color,
    preferred_language: v.preferredLanguage,
  };
  const { error } = await supabase.from("profiles").update(next).eq("id", id).eq("role", "employee");
  if (error) return { ok: false, error: "saveFailed" };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(next)) {
    const from = (before as Record<string, unknown>)[k];
    if (from !== to) changes[k] = { from, to };
  }
  if (Object.keys(changes).length > 0) {
    await supabase.rpc("log_audit", {
      p_action: "employee.updated",
      p_entity_type: "profile",
      p_entity_id: id,
      p_changes: changes,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, id };
}

/** Deactivation keeps every historical record; the person simply can no longer sign in. */
export async function setEmployeeActive(id: string, active: boolean): Promise<EmployeeResult> {
  if (!(await adminOnly())) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", id)
    .eq("role", "employee")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "saveFailed" };
  if (!data) return { ok: false, error: "notFound" };

  await supabase.rpc("log_audit", {
    p_action: active ? "employee.reactivated" : "employee.deactivated",
    p_entity_type: "profile",
    p_entity_id: id,
    p_changes: { is_active: active },
  });
  revalidatePath("/", "layout");
  return { ok: true, id };
}
