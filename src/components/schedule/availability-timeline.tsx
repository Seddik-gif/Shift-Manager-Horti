import { getLocale, getTranslations } from "next-intl/server";
import { dayLabel } from "@/lib/format/week";
import { axisOf, DEFAULT_SHIFT_HOURS, minToTime, toMin } from "@/lib/scheduling/shift-hours";
import { romeTime } from "@/lib/time/rome";

export interface AvailabilityDay {
  day: string;
  /** null = not answered */
  available: boolean | null;
  note: string;
  windows: { startsAt: Date; endsAt: Date }[];
}

/**
 * What an employee said, drawn on the same horizontal 07:00 → 02:00 time axis as the shift calendar,
 * so an admin can see at a glance who can work when.
 */
export async function AvailabilityTimeline({ days }: { days: AvailabilityDay[] }) {
  const locale = await getLocale();
  const t = await getTranslations("availability");
  const axis = axisOf(DEFAULT_SHIFT_HOURS);
  const pct = (min: number) => `${((Math.min(axis.endMin, Math.max(axis.startMin, min)) - axis.startMin) / axis.span) * 100}%`;
  const marks: number[] = [];
  for (let m = Math.ceil(axis.startMin / 60) * 60; m <= axis.endMin; m += 60) marks.push(m);

  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-brand/10">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[7.5rem_1fr] border-b border-brand/10 bg-paper">
          <div />
          <div className="relative h-8">
            {marks.map((m) => (
              <span key={m} className="absolute top-0 flex h-full items-center text-[11px] tabular-nums text-ink-soft"
                style={{ left: pct(m), transform: m === axis.endMin ? "translateX(-100%)" : "translateX(-50%)" }}>
                {m % 120 === 0 || m === axis.endMin ? minToTime(m) : ""}
              </span>
            ))}
          </div>
        </div>
        {days.map((d, i) => (
          <div key={d.day} className={`grid grid-cols-[7.5rem_1fr] border-b border-brand/10 last:border-b-0 ${i >= 5 ? "bg-brand-soft/25" : "bg-paper"}`}>
            <div className="px-3 py-2.5">
              <p className="font-display text-base capitalize leading-tight text-brand">{dayLabel(d.day, locale)}</p>
              {d.note && <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">{d.note}</p>}
            </div>
            <div className="relative h-12">
              {marks.map((m) => <div key={m} className="absolute inset-y-0 w-px bg-brand/10" style={{ left: pct(m) }} />)}
              {d.available === null && <span className="absolute inset-0 flex items-center px-3 text-xs text-ink-soft">—</span>}
              {d.available === false && (
                <span className="absolute inset-y-2 left-2 right-2 flex items-center justify-center rounded-lg bg-mist text-xs text-ink-soft">{t("unavailable")}</span>
              )}
              {d.available && d.windows.map((w, k) => {
                const startMin = toMin(romeTime(w.startsAt));
                const endMin = startMin + (w.endsAt.getTime() - w.startsAt.getTime()) / 60000;
                const left = pct(startMin);
                const width = `calc(${pct(endMin)} - ${left})`;
                return (
                  <span key={k} className="absolute inset-y-2 flex items-center overflow-hidden rounded-lg bg-brand px-2 text-[12px] font-medium tabular-nums text-ivory shadow-sm"
                    style={{ left, width }}>
                    {minToTime(startMin)}–{minToTime(endMin)}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
