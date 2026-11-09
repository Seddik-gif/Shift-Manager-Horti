import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/session";

const handleI18n = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  const response = handleI18n(request);
  return updateSession(request, response);
}

export const config = {
  // Skip API routes, Next internals, the auth confirm route and static files
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
