import { getTranslations, setRequestLocale } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import type { Locale } from "@/i18n/routing";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage({ params, searchParams }: PageProps<"/[locale]/set-password">) {
  const { locale } = (await params) as { locale: Locale };
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("setPassword");

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
          {error ? (
            <p role="alert" className="mt-6 text-sm text-danger">{t("linkInvalid")}</p>
          ) : (
            <SetPasswordForm locale={locale} />
          )}
        </div>
      </div>
    </main>
  );
}
