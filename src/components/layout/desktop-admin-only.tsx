import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import type { Locale } from "@/i18n/routing";

/** Shown to a non-admin who signed in inside the Windows desktop app. */
export async function DesktopAdminOnly({ locale }: { locale: Locale }) {
  const t = await getTranslations("desktop");
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
      <div className="space-y-4 rounded-[var(--radius-card)] bg-paper p-8 shadow-[var(--shadow-soft)]">
        <Logo size={40} className="justify-center tracking-[0.18em]" />
        <h1 className="font-display text-3xl text-brand">{t("adminOnlyTitle")}</h1>
        <p className="text-ink-soft">{t("adminOnlyText")}</p>
        <form action={signOut.bind(null, locale)}>
          <Button type="submit">{t("signOut")}</Button>
        </form>
      </div>
    </main>
  );
}
