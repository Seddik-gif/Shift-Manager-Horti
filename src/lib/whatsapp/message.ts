import type { Snapshot, SnapshotShift } from "@/lib/scheduling/snapshot";
import { groupByDay, hoursByEmployee } from "@/lib/scheduling/snapshot";
import { formatWindow, weekDays } from "@/lib/time/rome";

type Locale = "it" | "en";

const TEXT = {
  it: { title: "PROGRAMMA SETTIMANALE STAFF", noShifts: "—", totals: "ORE TOTALI", hours: "h" },
  en: { title: "WEEKLY STAFF SCHEDULE", noShifts: "—", totals: "TOTAL HOURS", hours: "h" },
} as const;

const utc = (day: string, locale: Locale, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** "16–22 NOVEMBRE" or "30 NOVEMBRE – 6 DICEMBRE", upper-cased like the rest of the message. */
function rangeLabel(weekStart: string, locale: Locale): string {
  const days = weekDays(weekStart);
  const end = days[6];
  const dm = (d: string) => `${utc(d, locale, { day: "numeric" })} ${utc(d, locale, { month: "long" })}`;
  const label = weekStart.slice(0, 7) === end.slice(0, 7)
    ? `${utc(weekStart, locale, { day: "numeric" })}–${dm(end)}`
    : `${dm(weekStart)} – ${dm(end)}`;
  return label.toUpperCase();
}

/** First names, extended with the last initial only when two employees share a first name. */
function displayNames(shifts: SnapshotShift[]): Map<string, string> {
  const people = new Map<string, string>();
  for (const s of shifts) people.set(s.employee_id, s.employee_name);
  const first = (n: string) => n.split(" ")[0];
  const counts = new Map<string, number>();
  for (const n of people.values()) counts.set(first(n), (counts.get(first(n)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const [id, n] of people) {
    const rest = n.split(" ").slice(1).join(" ");
    out.set(id, (counts.get(first(n)) ?? 0) > 1 && rest ? `${first(n)} ${rest[0].toUpperCase()}.` : first(n));
  }
  return out;
}

/**
 * Plain-text weekly schedule for pasting into the staff WhatsApp group.
 * Built only from the PUBLISHED snapshot, so it always matches what employees see in the app.
 */
export function buildWeeklyMessage(snapshot: Snapshot, locale: Locale): string {
  const t = TEXT[locale];
  const days = weekDays(snapshot.week_start);
  const grouped = groupByDay(snapshot.shifts, days);
  const names = displayNames(snapshot.shifts);
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  const lines: string[] = ["HORTI MAGICI", t.title, rangeLabel(snapshot.week_start, locale), ""];
  for (const d of days) {
    lines.push(utc(d, locale, { weekday: "long" }).toUpperCase());
    if (grouped[d].length === 0) lines.push(t.noShifts);
    for (const s of grouped[d]) {
      lines.push(`${formatWindow(new Date(s.starts_at), new Date(s.ends_at))} | ${names.get(s.employee_id)}`);
    }
    lines.push("");
  }
  const totals = hoursByEmployee(snapshot.shifts);
  if (totals.length > 0) {
    lines.push(t.totals);
    for (const e of totals) lines.push(`${names.get(e.id)}: ${num.format(e.hours)}${t.hours}`);
  }
  return lines.join("\n").trimEnd();
}
