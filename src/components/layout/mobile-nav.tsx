"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, CalendarDays, FileSpreadsheet, LayoutGrid, CalendarOff, Home, Inbox, LayoutDashboard, MapPin, Menu, MessageCircle, Settings, UserPlus, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type NavHref =
  | "/admin" | "/admin/overview" | "/admin/reports" | "/admin/employees" | "/admin/availability" | "/admin/schedule" | "/admin/requests" | "/admin/locations" | "/admin/settings"
  | "/employee" | "/employee/schedule" | "/employee/absences" | "/employee/swaps" | "/chat";

const ICONS: Record<NavHref, React.ComponentType<{ className?: string }>> = {
  "/admin": LayoutDashboard,
  "/admin/overview": LayoutGrid,
  "/admin/reports": FileSpreadsheet,
  "/admin/employees": Users,
  "/admin/availability": UserPlus,
  "/admin/schedule": CalendarDays,
  "/admin/requests": Inbox,
  "/admin/locations": MapPin,
  "/admin/settings": Settings,
  "/employee": Home,
  "/employee/schedule": CalendarDays,
  "/employee/absences": CalendarOff,
  "/employee/swaps": ArrowLeftRight,
  "/chat": MessageCircle,
};

export interface NavEntry { href: NavHref; label: string }

const isActive = (pathname: string, href: string) => href === pathname || (href !== "/admin" && href !== "/employee" && pathname.startsWith(href));

/**
 * Phone navigation: four main places in a bottom tab bar (thumb reach) and a "Menu" tab that opens a sheet with
 * everything else, the language and sign out. Hidden from the `md` breakpoint up, where the top bar has it all.
 */
export function MobileNav({ primary, more, userLabel, signOut }: {
  primary: NavEntry[];
  more: NavEntry[];
  userLabel: string;
  /** a server action, already bound to the current language */
  signOut: () => Promise<void>;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const [lastPath, setLastPath] = useState(pathname);

  // open / close the native dialog (focus trap and Escape for free)
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  // going somewhere closes the menu (state adjusted while rendering, as React recommends)
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  const moreActive = more.some((m) => isActive(pathname, m.href));

  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight transition-colors";
  return (
    <>
      <nav aria-label={t("main")} className="fixed inset-x-0 bottom-0 z-30 border-t border-brand/10 bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        <ul className="mx-auto flex max-w-xl">
          {primary.map((item) => {
            const Icon = ICONS[item.href];
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="flex flex-1">
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn(tab, active ? "text-brand" : "text-ink-soft")}>
                  <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-brand-soft")}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={cn(tab, moreActive ? "text-brand" : "text-ink-soft")}>
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", moreActive && "bg-brand-soft")}>
                <Menu className="size-5" aria-hidden />
              </span>
              <span>{t("menu")}</span>
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={sheet}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === sheet.current) setOpen(false); }}
        aria-label={t("menu")}
        className="m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/40 md:hidden"
      >
        <div className="space-y-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-2xl text-brand">{userLabel}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label={tc("close")} className="grid size-11 place-items-center rounded-full bg-mist text-ink-soft">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {more.length > 0 && (
            <ul className="divide-y divide-brand/10 overflow-hidden rounded-2xl bg-mist/50">
              {more.map((item) => {
                const Icon = ICONS[item.href];
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}
                      className={cn("flex min-h-14 items-center gap-3 px-4 text-base", isActive(pathname, item.href) ? "font-semibold text-brand" : "text-ink")}>
                      <Icon className="size-5 text-brand" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-mist/50 px-4 py-3">
            <span className="text-base">{tc("language")}</span>
            <LanguageSwitcher signedIn />
          </div>

          <form action={signOut}>
            <button type="submit" className="h-12 w-full rounded-full border border-brand/25 text-base font-medium text-brand hover:bg-brand-soft">{tc("signOut")}</button>
          </form>
        </div>
      </dialog>
    </>
  );
}
