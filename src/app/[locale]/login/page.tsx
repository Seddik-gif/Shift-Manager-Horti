import { getTranslations, setRequestLocale } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Locale } from "@/i18n/routing";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params }: PageProps<"/[locale]/login">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("login");
  const configured = isSupabaseConfigured();

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size={72} />
        </div>
        <div className="rounded-[var(--radius-card)] bg-paper p-8 shadow-[var(--shadow-soft)]">
          <h1 className="font-display text-3xl font-medium text-brand">{t("title")}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t("subtitle")}</p>
          {configured ? (
            <LoginForm locale={locale} />
          ) : (
            <p role="status" className="mt-6 rounded-xl bg-brand-soft p-4 text-sm text-brand">
              {t("notConfigured")}
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-ink-soft">{t("invitationOnly")}</p>
      </div>
    </main>
  );
}
