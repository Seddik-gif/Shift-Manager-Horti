import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Profile } from "@/types/database";
import type { Locale } from "@/i18n/routing";

const PROFILE_COLUMNS =
  "id, first_name, last_name, email, phone, job_position, color, is_active, role, preferred_language, created_at";

/** The signed-in user's profile, or null. Verified with Supabase (getUser), not just the cookie. */
export const getSessionProfile = cache(async (): Promise<Profile | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle<Profile>();
  return data ?? null;
});

/** Any active, signed-in user. Deactivated accounts are sent back to login. */
export async function requireProfile(locale: Locale): Promise<Profile> {
  const profile = await getSessionProfile();
  if (!profile || !profile.is_active) redirect({ href: "/login", locale });
  return profile as Profile;
}

/** Administrators only. Employees are redirected to their own area. */
export async function requireAdmin(locale: Locale): Promise<Profile> {
  const profile = await requireProfile(locale);
  if (profile.role !== "admin") redirect({ href: "/employee", locale });
  return profile;
}

/** Employees only. Administrators are redirected to the admin area. */
export async function requireEmployee(locale: Locale): Promise<Profile> {
  const profile = await requireProfile(locale);
  if (profile.role !== "employee") redirect({ href: "/admin", locale });
  return profile;
}

export function homeFor(profile: Pick<Profile, "role">): "/admin" | "/employee" {
  return profile.role === "admin" ? "/admin" : "/employee";
}
