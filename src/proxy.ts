import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/session";

const handleI18n = createMiddleware(routing);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function proxy(request: NextRequest) {
  // Links from notifications carry `?loc=<location>`: remember it, then drop it from the URL.
  const loc = request.nextUrl.searchParams.get("loc");
  if (loc && UUID.test(loc)) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("loc");
    const redirect = NextResponse.redirect(url);
    redirect.cookies.set("hm_loc", loc, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    return redirect;
  }
  const response = handleI18n(request);
  return updateSession(request, response);
}

export const config = {
  // Skip API routes, Next internals, the auth confirm route and static files
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
