import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/layout/app-shell";
import { requireProfile } from "@/lib/auth/guards";
import type { Locale } from "@/i18n/routing";

// Depends on the signed-in user, so never prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await requireProfile(locale);
  return (
    <AppShell profile={profile} locale={locale}>
      {children}
    </AppShell>
  );
}

