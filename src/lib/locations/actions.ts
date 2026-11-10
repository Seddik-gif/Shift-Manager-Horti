"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LOCATION_COOKIE } from "./active";

const KNOWN = ["forbidden", "invalid_input", "name_taken", "last_location", "location_in_use", "not_found", "invalid_employee"] as const;
export type LocationError = (typeof KNOWN)[number] | "unknown";
export type LocationResult = { ok: true; id?: string } | { ok: false; error: LocationError };

const fail = (m?: string): { ok: false; error: LocationError } => ({ ok: false, error: KNOWN.find((k) => m?.includes(k)) ?? "unknown" });
const done = () => revalidatePath("/", "layout");

/** Remember which location the user is working in (validated against RLS when read). */
export async function setActiveLocation(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  (await cookies()).set(LOCATION_COOKIE, id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  done();
}

const saveSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

/** Admin only (enforced in SQL). */
export async function saveLocation(input: unknown): Promise<LocationResult> {
  const p = saveSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_location", { p_id: p.data.id, p_name: p.data.name, p_color: p.data.color });
  if (error) return fail(error.message);
  done();
  return { ok: true, id: data as string };
}

export async function setLocationActive(id: string, active: boolean): Promise<LocationResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_location_active", { p_id: id, p_active: active });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

export async function deleteLocation(id: string): Promise<LocationResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_location", { p_id: id });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}

export async function setEmployeeLocations(employeeId: string, locationIds: string[]): Promise<LocationResult> {
  if (!z.uuid().safeParse(employeeId).success || !z.array(z.uuid()).max(50).safeParse(locationIds).success) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_employee_locations", { p_employee: employeeId, p_locations: locationIds });
  if (error) return fail(error.message);
  done();
  return { ok: true };
}
