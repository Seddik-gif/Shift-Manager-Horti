import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";
import { routing } from "@/i18n/routing";

/** Remove a leading /en (or other non-default locale) prefix from a pathname. */
export function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue;
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

const PUBLIC_PATHS = ["/login", "/set-password"];

/**
 * Refreshes the auth session cookies and redirects anonymous visitors to the login page.
 * Role checks are NOT done here – they are enforced by the DB (RLS) and server guards.
 */
export async function updateSession(request: NextRequest, response: NextResponse) {
  const env = getSupabaseEnv();
  if (!env) return response; // not configured yet: pages render the setup notice

  const supabase = createServerClient(env.url, env.anonKey, {
    cookieOptions: { name: "sb-horti-auth" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = stripLocale(request.nextUrl.pathname);
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const isEnglish = request.nextUrl.pathname.startsWith("/en");
    const url = request.nextUrl.clone();
    url.pathname = isEnglish ? "/en/login" : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
