"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { dayLabel } from "@/lib/format/week";
import { textOn } from "@/lib/color";
import { cn } from "@/lib/utils";
import type { CalEvent } from "./schedule-calendar";

/**
 * Phone version of the week: one card per day listing who works when, instead of a 19-hour horizontal timeline
 * that only shows five hours of the day at once. Tap a shift to select it (the same action bar as the timeline).
 */
export function WeekAgenda({ days, events, admin, meId, selectedId, absentByDay, today, onSelect, onNew }: {
  days: string[];
  events: CalEvent[];
  admin: boolean;
  meId?: string;
  selectedId: string | null;
  absentByDay?: Record<string, { name: string; kind: "ferie" | "assenza" }[]>;
  /** Rome date of today, to highlight it */
  today: string;
  onSelect: (id: string | null) => void;
  onNew: (day: string) => void;
}) {
  const t = useTranslations("schedule");
  const locale = useLocale();
  const hm = (iso: string) => iso.slice(11, 16);

  return (
    <ol className="space-y-3" aria-label={t("agenda")}>
      {days.map((day) => {
        const list = events.filter((e) => e.start.startsWith(day)).sort((a, b) => a.start.localeCompare(b.start));
        const people = new Set(list.filter((e) => !e.open).map((e) => e.employeeId)).size;
        const away = absentByDay?.[day] ?? [];
        const isToday = day === today;
        return (
          <li key={day} className={cn("rounded-[var(--radius-card)] bg-paper p-3 shadow-[var(--shadow-soft)]", isToday && "ring-2 ring-brand/40")}>
            <div className="flex items-center justify-between gap-2 px-1">
              <div>
                <h3 className="font-display text-xl capitalize leading-tight text-brand">{dayLabel(day, locale)}{isToday && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 align-middle font-sans text-[10px] font-semibold uppercase tracking-wide text-ivory">{t("todayBadge")}</span>}</h3>
                <p className="text-xs text-ink-soft">{people > 0 ? t("count", { count: people }) : t("nobody")}</p>
              </div>
              {admin && (
                <button type="button" onClick={() => onNew(day)} aria-label={t("addOnDay", { day: dayLabel(day, locale) })}
                  className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand active:bg-brand active:text-ivory">
                  <Plus className="size-5" aria-hidden />
                </button>
              )}
            </div>

            {away.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1.5 px-1">
                {away.map((a) => <span key={a.name + a.kind} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t("absent.label", { name: a.name, kind: t(`absent.${a.kind}`) })}</span>)}
              </p>
            )}

            {list.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {list.map((e) => {
                  const mine = !!meId && e.employeeId === meId;
                  const next = e.end.slice(0, 10) !== e.start.slice(0, 10);
                  const selected = e.id === selectedId;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(selected ? null : e.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-shadow",
                          e.open ? "border-2 border-dashed border-brand/50 bg-white text-brand" : "",
                          selected && "ring-2 ring-ink",
                          mine && !e.open && "ring-2 ring-offset-1 ring-brand",
                        )}
                        style={e.open ? undefined : { backgroundColor: e.color, color: textOn(e.color) }}
                      >
                        <span className="w-[4.6rem] shrink-0 text-sm font-semibold tabular-nums leading-tight">
                          {hm(e.start)}
                          <span className="block text-xs font-normal opacity-80">{hm(e.end)}{next ? " ☾" : ""}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{e.open ? t("openShift") : mine ? `${e.name} · ${t("you")}` : e.name}</span>
                          {(e.position || e.open) && (
                            <span className="block truncate text-xs opacity-80">{e.open ? t("openSlots", { count: e.open.slots }) : e.position}{e.open && e.position ? ` · ${e.position}` : ""}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
