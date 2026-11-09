import { defineRouting } from "next-intl/routing";

export const locales = ["it", "en"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "it", // Italian is the default for everyone
  localePrefix: "as-needed",
  localeDetection: false, // never guess from the browser: Italian unless the user chooses otherwise
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
