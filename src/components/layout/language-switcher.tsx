"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";
import { savePreferredLanguage } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ signedIn = false }: { signedIn?: boolean }) {
  const t = useTranslations("languages");
  const label = useTranslations("common")("language");
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(next: Locale) {
    if (next === current) return;
    startTransition(async () => {
      if (signedIn) await savePreferredLanguage(next); // remembered in the user's profile
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-mist p-1" aria-busy={pending}>
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => change(l)}
          aria-pressed={l === current}
          lang={l}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
            l === current ? "bg-brand text-ivory" : "text-ink-soft hover:text-ink",
          )}
          title={t(l)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
