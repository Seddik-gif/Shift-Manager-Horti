"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { saveAvailability } from "@/lib/availability/actions";
import { validateWeek, type DayInput, type DayIssue } from "@/lib/availability/logic";
import { dayLabel } from "@/lib/format/week";
import { Button } from "@/components/ui/button";
import { TimeSelect } from "@/components/ui/time-select";
import { cn } from "@/lib/utils";

interface Props {
  requestId: string;
  initialDays: DayInput[];
  initialNotes: string;
  alreadySubmitted: boolean;
}

function nextWindow(prevEnd?: string) {
  if (!prevEnd) return { start: "09:00", end: "17:00" };
  const h = Number(prevEnd.slice(0, 2));
  return { start: prevEnd, end: h >= 22 ? "00:00" : `${String(h + 2).padStart(2, "0")}:${prevEnd.slice(3)}` };
}

export function AvailabilityForm({ requestId, initialDays, initialNotes, alreadySubmitted }: Props) {
  const t = useTranslations("availability");
  const te = useTranslations("availability.errors");
  const locale = useLocale();
  const [days, setDays] = useState<DayInput[]>(initialDays);
  const [notes, setNotes] = useState(initialNotes);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<"draft" | "submitted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  const issues = useMemo(() => validateWeek(days, true), [days]);
  const overlapOnly = useMemo(() => validateWeek(days, false), [days]);
  const answered = days.filter((d) => d.available !== null).length;

  const update = (i: number, patch: Partial<DayInput>) => {
    setResult(null);
    setDays((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  function submit(final: boolean) {
    setError(null);
    setResult(null);
    if (final) setShowIssues(true);
    const problems = final ? issues : overlapOnly;
    if (Object.keys(problems).length > 0) return setError(final ? "incomplete" : "overlap");
    startTransition(async () => {
      const res = await saveAvailability(requestId, days, notes, final);
      if (!res.ok) return setError(res.error);
      setResult(final ? "submitted" : "draft");
    });
  }

  const issueText = (list: DayIssue[] | undefined) => list?.map((x) => t(`issues.${x}`)).join(" · ");

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft" aria-live="polite">{t("progress", { done: answered, total: 7 })}</p>

      {days.map((d, i) => {
        const dayIssues = (showIssues ? issues : overlapOnly)[d.day];
        return (
          <fieldset key={d.day} className={cn("rounded-[var(--radius-card)] bg-paper p-4 shadow-[var(--shadow-soft)]", dayIssues && "ring-2 ring-danger/50")}>
            <legend className="sr-only">{dayLabel(d.day, locale)}</legend>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-display text-2xl capitalize text-brand">{dayLabel(d.day, locale)}</h3>
              <div role="group" aria-label={dayLabel(d.day, locale)} className="grid grid-cols-2 rounded-full bg-mist p-1 sm:inline-flex">
                {([true, false] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    aria-pressed={d.available === v}
                    onClick={() => update(i, { available: v, windows: v && d.windows.length === 0 ? [nextWindow()] : d.windows })}
                    className={cn("whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium", d.available === v ? (v ? "bg-brand text-ivory" : "bg-ink-soft text-ivory") : "text-ink-soft")}
                  >
                    {v ? t("available") : t("unavailable")}
                  </button>
                ))}
              </div>
            </div>

            {d.available && (
              <div className="mt-4 space-y-3">
                {d.windows.map((w, wi) => {
                  const overnight = w.end <= w.start && w.end !== w.start;
                  return (
                    <div key={wi} className="flex flex-wrap items-center gap-2">
                      <TimeSelect label={t("from")} value={w.start} invalid={w.start === w.end}
                        onChange={(v) => update(i, { windows: d.windows.map((x, k) => (k === wi ? { ...x, start: v } : x)) })} />
                      <span aria-hidden>–</span>
                      <TimeSelect label={t("to")} value={w.end} invalid={w.start === w.end}
                        onChange={(v) => update(i, { windows: d.windows.map((x, k) => (k === wi ? { ...x, end: v } : x)) })} />
                      {overnight && <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">{t("nextDay")}</span>}
                      <button type="button" aria-label={t("removeInterval")} className="ml-auto grid size-10 place-items-center rounded-full text-ink-soft hover:bg-mist"
                        onClick={() => update(i, { windows: d.windows.filter((_, k) => k !== wi), available: d.windows.length === 1 ? true : d.available })}>
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  );
                })}
                <Button type="button" variant="outline" size="sm" disabled={d.windows.length >= 8}
                  onClick={() => update(i, { windows: [...d.windows, nextWindow(d.windows.at(-1)?.end)] })}>
                  <Plus className="size-4" aria-hidden /> {t("addInterval")}
                </Button>
              </div>
            )}

            {d.available !== null && (
              <input
                type="text" maxLength={300} value={d.note} onChange={(e) => update(i, { note: e.target.value })}
                placeholder={t("dayNote")} aria-label={`${t("dayNote")} – ${dayLabel(d.day, locale)}`}
                className="mt-4 h-11 w-full rounded-xl border border-brand/15 bg-white px-3 text-sm"
              />
            )}
            {dayIssues && <p role="alert" className="mt-3 text-sm text-danger">{issueText(dayIssues)}</p>}
          </fieldset>
        );
      })}

      <div className="rounded-[var(--radius-card)] bg-paper p-4 shadow-[var(--shadow-soft)]">
        <label htmlFor="notes" className="mb-1.5 block text-sm font-medium">{t("weekNote")}</label>
        <textarea id="notes" rows={3} maxLength={500} value={notes} onChange={(e) => { setNotes(e.target.value); setResult(null); }}
          className="w-full rounded-xl border border-brand/15 bg-white p-3 text-sm" />
      </div>

      {error && <p role="alert" className="text-sm text-danger">{te(error as "unknown")}</p>}
      {result === "submitted" && <p role="status" className="rounded-xl bg-brand-soft p-4 text-brand">{t("submittedConfirm")}</p>}
      {result === "draft" && <p role="status" className="text-sm text-brand">{t("draftSaved")}</p>}

      <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-brand/10 bg-ivory/95 px-4 py-3 backdrop-blur">
        {!alreadySubmitted && (
          <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => submit(false)}>{t("saveDraft")}</Button>
        )}
        <Button type="button" size="lg" className="flex-1" disabled={pending} onClick={() => submit(true)}>
          {alreadySubmitted ? t("update") : t("submit")}
        </Button>
      </div>
    </div>
  );
}
