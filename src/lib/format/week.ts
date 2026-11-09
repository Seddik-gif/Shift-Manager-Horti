const fmt = (locale: string, opts: Intl.DateTimeFormatOptions, day: string) =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

const dayMonth = (locale: string, day: string) =>
  `${fmt(locale, { day: "numeric" }, day)} ${fmt(locale, { month: "long" }, day)}`;

/** "16–22 novembre" / "30 November – 6 December": day before month in both languages. */
export function weekRangeLabel(weekStart: string, locale: string): string {
  const end = new Date(`${weekStart}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const endDay = end.toISOString().slice(0, 10);
  if (weekStart.slice(0, 7) === endDay.slice(0, 7)) {
    return `${fmt(locale, { day: "numeric" }, weekStart)}–${dayMonth(locale, endDay)}`;
  }
  return `${dayMonth(locale, weekStart)} – ${dayMonth(locale, endDay)}`;
}

/** Weekday name + date for a yyyy-MM-dd day, e.g. "lunedì 16". */
export function dayLabel(day: string, locale: string, style: "long" | "short" = "long"): string {
  return fmt(locale, { weekday: style, day: "numeric" }, day);
}
