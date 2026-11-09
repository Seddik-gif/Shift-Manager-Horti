import { getLocale, getTranslations } from "next-intl/server";
import { dayLabel } from "@/lib/format/week";
import { groupByDay, type SnapshotShift } from "@/lib/scheduling/snapshot";
import { formatWindow, weekDays } from "@/lib/time/rome";
import { cn } from "@/lib/utils";

/** A week's shifts grouped by day (Monday first). Used for review, history and the employee view. */
export async function ScheduleList({ weekStart, shifts, meId }: { weekStart: string; shifts: SnapshotShift[]; meId?: string }) {
  const locale = await getLocale();
  const t = await getTranslations("publish");
  const days = weekDays(weekStart);
  const grouped = groupByDay(shifts, days);

  return (
    <ol className="divide-y divide-brand/10 overflow-hidden rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
      {days.map((d) => (
        <li key={d} className="grid gap-2 px-5 py-4 sm:grid-cols-[9rem_1fr]">
          <h3 className="font-display text-xl capitalize text-brand">{dayLabel(d, locale)}</h3>
          {grouped[d].length === 0 ? (
            <p className="text-sm text-ink-soft">{t("noShiftsDay")}</p>
          ) : (
            <ul className="space-y-1.5">
              {grouped[d].map((s) => (
                <li key={s.shift_id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl px-3 py-1.5", meId === s.employee_id && "bg-brand-soft")}>
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                  <span className="tabular-nums font-medium">{formatWindow(new Date(s.starts_at), new Date(s.ends_at))}</span>
                  <span>{s.employee_name}{meId === s.employee_id ? ` (${t("you")})` : ""}</span>
                  {s.position && <span className="text-sm text-ink-soft">{s.position}</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
