"use server";

import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { loginIdDomain, resolveLoginId } from "@/lib/auth/login-id";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { loginSchema, setPasswordSchema } from "@/lib/validation/auth";
import { homeFor } from "./guards";
import type { Profile } from "@/types/database";

export interface FormState {
  /** i18n key under "errors" */
  error?: string;
  /** field -> i18n key under "validation" */
  fieldErrors?: Record<string, string>;
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

export async function signIn(locale: Locale, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return { error: "notConfigured" };
  const rawId = formData.get("email");
  const parsed = loginSchema.safeParse({
    email: typeof rawId === "string" ? resolveLoginId(rawId, loginIdDomain()) : rawId,
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "invalidCredentials" };

  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, preferred_language")
    .eq("id", userData.user?.id ?? "")
    .maybeSingle<Pick<Profile, "role" | "is_active" | "preferred_language">>();

  if (!profile) {
    await supabase.auth.signOut();
    return { error: "noProfile" };
  }
  if (!profile.is_active) {
    await supabase.auth.signOut();
    return { error: "inactive" };
  }
  // Land in the user's saved language, not the one the login page happened to be in.
  redirect({ href: homeFor(profile), locale: isLocale(profile.preferred_language) ? profile.preferred_language : locale });
  return {};
}

export async function signOut(locale: Locale) {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect({ href: "/login", locale });
}

export async function setPassword(locale: Locale, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return { error: "notConfigured" };
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "invalidCredentials" };
  redirect({ href: "/", locale });
  return {};
}

/** Stores the language in the signed-in user's profile (RLS: own row only). */
export async function savePreferredLanguage(language: Locale) {
  if (!isSupabaseConfigured() || !isLocale(language)) return;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("profiles").update({ preferred_language: language }).eq("id", data.user.id);
}
