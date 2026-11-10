import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { NavLinks } from "@/components/layout/nav-links";
import { MobileNav, type NavEntry } from "@/components/layout/mobile-nav";
import { LocationSwitcher } from "@/components/layout/location-switcher";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { getLocationContext } from "@/lib/locations/active";
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
  const { locations, active } = await getLocationContext();
  const admin = profile.role === "admin";

  // every destination, in desktop order
  const all: NavEntry[] = admin
    ? [
        { href: "/admin", label: t("nav.dashboard") },
        { href: "/admin/employees", label: t("nav.employees") },
        { href: "/admin/availability", label: t("nav.availability") },
        { href: "/admin/schedule", label: t("nav.schedule") },
        { href: "/admin/overview", label: t("nav.overview") },
        { href: "/admin/reports", label: t("nav.reports") },
        { href: "/admin/requests", label: t("nav.requests") },
        { href: "/chat", label: t("nav.chat") },
        { href: "/admin/locations", label: t("nav.locations") },
        { href: "/admin/settings", label: t("nav.settings") },
      ]
    : [
        { href: "/employee", label: t("nav.dashboard") },
        { href: "/employee/schedule", label: t("nav.teamSchedule") },
        { href: "/employee/absences", label: t("nav.absences") },
        { href: "/employee/swaps", label: t("nav.swaps") },
        { href: "/chat", label: t("nav.chat") },
      ];
  // phone: four things within thumb reach, the rest behind "Menu"
  const primaryHrefs = admin ? ["/admin", "/admin/schedule", "/admin/requests", "/chat"] : ["/employee", "/employee/schedule", "/employee/swaps", "/chat"];
  const primary = primaryHrefs.map((h) => all.find((x) => x.href === h)!);
  const more = all.filter((x) => !primaryHrefs.includes(x.href));

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-ivory print:hidden">{t("common.skipToContent")}</a>
      <header className="sticky top-0 z-20 border-b border-brand/10 bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur print:hidden" style={active ? { borderTop: `4px solid ${active.color}` } : undefined}>
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-4 py-1.5 md:min-h-16 md:py-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Logo size={32} className="hidden tracking-[0.18em] sm:flex md:hidden lg:flex" />
            {active && <LocationSwitcher locations={locations} activeId={active.id} />}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-sm text-ink-soft md:inline">
              {profile.first_name} · {t(`roles.${profile.role}`)}
            </span>
            <NotificationBell userId={profile.id} />
            {/* language and sign out live in the Menu tab on phones */}
            <div className="hidden items-center gap-2 md:flex md:gap-3">
              <LanguageSwitcher signedIn />
              <form action={signOut.bind(null, locale)}>
                <Button type="submit" variant="ghost" size="sm">
                  {t("common.signOut")}
                </Button>
              </form>
            </div>
          </div>
        </div>
        <div className="mx-auto hidden max-w-7xl px-4 pb-2 md:block">
          <NavLinks items={all} />
        </div>
      </header>
      <PwaProvider />
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 outline-none md:py-8 print:max-w-none print:p-0">{children}</main>
      <MobileNav
        primary={primary}
        more={more}
        userLabel={`${profile.first_name} · ${t(`roles.${profile.role}`)}`}
        signOut={signOut.bind(null, locale)}
      />
    </div>
  );
}
