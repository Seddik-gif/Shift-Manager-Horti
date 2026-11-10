import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface CoverageDay {
  day: string;
  /** distinct people planned */
  people: number;
  /** total planned hours */
  hours: number;
  /** people on approved leave */
  away: number;
}

/**
 * Read-only month heat grid: the darker a day, the more people are planned. Every cell opens that week for editing.
 * Server-rendered and dependency-free. `min` (optional) outlines days that fall below the minimum staffing rule.
 */
export function CoverageGrid({ days, month, weekdays, labels, min }: {
  days: CoverageDay[];
  month: string; // yyyy-MM of the month being shown
  weekdays: string[]; // seven short names, Monday first
  labels: { people: (n: number) => string; hours: (h: number) => string; away: (n: number) => string; legendLow: string; legendHigh: string; under: string };
  min: number | null;
}) {
  const max = Math.max(1, ...days.map((d) => d.people));
  // five steps of the brand colour; 0 people stays plain so empty days stand out
  const shade = (n: number) => (n === 0 ? "bg-paper" : n / max > 0.75 ? "bg-brand text-ivory" : n / max > 0.5 ? "bg-brand/70 text-ivory" : n / max > 0.25 ? "bg-brand/40" : "bg-brand/20");

  return (
    <div className="space-y-3">
      <div role="grid" aria-label={month} className="overflow-hidden rounded-[var(--radius-card)] bg-mist/60 p-1.5 shadow-[var(--shadow-soft)] sm:p-3">
        <div role="row" className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium capitalize text-ink-soft sm:gap-1.5">
          {weekdays.map((w) => <span key={w} role="columnheader">{w}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {days.map((d) => {
            const inMonth = d.day.startsWith(month);
            const under = min !== null && inMonth && d.people < min;
            return (
              <Link
                key={d.day}
                role="gridcell"
                href={`/admin/schedule?view=week&date=${d.day}`}
                aria-label={`${d.day}: ${labels.people(d.people)}, ${labels.hours(d.hours)}${d.away ? `, ${labels.away(d.away)}` : ""}${under ? `, ${labels.under}` : ""}`}
                className={cn(
                  "flex min-h-16 flex-col justify-between rounded-lg p-1.5 text-left transition-transform hover:scale-[1.03] sm:min-h-24 sm:p-2",
                  shade(d.people), !inMonth && "opacity-40", under && "outline outline-2 -outline-offset-2 outline-amber-500",
                )}
              >
                <span className="text-sm font-medium tabular-nums">{Number(d.day.slice(8))}</span>
                <span className="text-[11px] leading-tight sm:text-xs">
                  <span className="block font-medium">{d.people > 0 ? labels.people(d.people) : "—"}</span>
                  {d.hours > 0 && <span className="hidden opacity-80 sm:block">{labels.hours(d.hours)}</span>}
                  {d.away > 0 && <span className="block opacity-90">🌴 {d.away}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft" aria-hidden>
        {labels.legendLow}
        {["bg-paper", "bg-brand/20", "bg-brand/40", "bg-brand/70", "bg-brand"].map((c) => <span key={c} className={cn("inline-block size-4 rounded border border-brand/10", c)} />)}
        {labels.legendHigh}
        {min !== null && <span className="ml-3 inline-flex items-center gap-1"><span className="inline-block size-4 rounded outline outline-2 -outline-offset-2 outline-amber-500" />{labels.under}</span>}
      </p>
    </div>
  );
}
