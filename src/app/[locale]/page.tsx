import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile, homeFor } from "@/lib/auth/guards";

/** Entry point: send each person to the area that matches their role. */
// Depends on the signed-in user, so never prerender.
export const dynamic = "force-dynamic";

export default async function RootPage({ params }: PageProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await getSessionProfile();
  if (!profile || !profile.is_active) redirect({ href: "/login", locale });
  redirect({ href: homeFor(profile!), locale });
}

