import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { NavLinks } from "@/components/layout/nav-links";
import { signOut } from "@/lib/auth/actions";
import type { Locale } from "@/i18n/routing";
import type { Profile } from "@/types/database";

export async function AppShell({
  profile,
  locale,
  children,
}: {
  profile: Profile;
  locale: Locale;
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-brand/10 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
          <Logo size={36} className="tracking-[0.08em] sm:tracking-[0.18em]" />
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-sm text-ink-soft sm:inline">
              {profile.first_name} · {t(`roles.${profile.role}`)}
            </span>
            <NotificationBell userId={profile.id} />
            <LanguageSwitcher signedIn />
            <form action={signOut.bind(null, locale)}>
              <Button type="submit" variant="ghost" size="sm">
                {t("common.signOut")}
              </Button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-2">
          <NavLinks
            items={
              profile.role === "admin"
                ? [
                    { href: "/admin", label: t("nav.dashboard") },
                    { href: "/admin/employees", label: t("nav.employees") },
                    { href: "/admin/availability", label: t("nav.availability") },
                    { href: "/admin/schedule", label: t("nav.schedule") },
                    { href: "/admin/requests", label: t("nav.requests") },
                  ]
                : [
                    { href: "/employee", label: t("nav.dashboard") },
                    { href: "/employee/schedule", label: t("nav.teamSchedule") },
                  ]
            }
          />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
