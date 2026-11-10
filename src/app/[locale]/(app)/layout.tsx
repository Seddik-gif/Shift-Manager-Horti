import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { DesktopAdminOnly } from "@/components/layout/desktop-admin-only";
import { AppShell } from "@/components/layout/app-shell";
import { requireProfile } from "@/lib/auth/guards";
import { isDesktopClient } from "@/lib/desktop";
import type { Locale } from "@/i18n/routing";

// Depends on the signed-in user, so never prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await requireProfile(locale);
  // the Windows desktop app is for admins: anyone else is pointed to the phone app
  if (profile.role !== "admin" && isDesktopClient((await headers()).get("user-agent"))) return <DesktopAdminOnly locale={locale} />;
  return (
    <AppShell profile={profile} locale={locale}>
      {children}
    </AppShell>
  );
}

