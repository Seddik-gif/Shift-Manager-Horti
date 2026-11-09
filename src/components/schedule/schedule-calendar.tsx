"use client";

import { useMemo, useState, useTransition } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import itLocale from "@fullcalendar/core/locales/it";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { textOn } from "@/lib/color";
import { dayLabel } from "@/lib/format/week";
import { deleteShift, saveShift } from "@/lib/scheduling/actions";
import { cancelOpenShift, requestOpenShift } from "@/lib/scheduling/requests-actions";
import type { ShiftHours } from "@/lib/scheduling/shift-hours";
import { weekDays } from "@/lib/time/rome";
import { cn } from "@/lib/utils";
import { OfferDialog } from "./offer-dialog";
import { ShiftDialog, type EmployeeOption, type ShiftDraft } from "./shift-dialog";
import { WeekTimeline, type Placement } from "./week-timeline";

export interface CalEvent {
  id: string;
  start: string; // Rome wall-clock, shown as-is (no browser-timezone shifts)
  end: string;
  employeeId: string;
  name: string;
  color: string;
  position: string;
  notes: string;
  /** set for an open (unassigned) shift: `id` is the open shift's id and `slots` the places still free */
  open?: { slots: number };
}

interface Props {
  /** admins manage the calendar; employees see exactly the same calendar, read-only */
  mode: "admin" | "employee";
  view: "week" | "month";
  date: string;
  events: CalEvent[];
  employees: EmployeeOption[];
  dayCounts: Record<string, number>;
  hours: ShiftHours;
  meId?: string;
}

// With timeZone "UTC" FullCalendar hands back Dates whose UTC fields are the Rome wall-clock.
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const timeOf = (d: Date) => d.toISOString().slice(11, 16);

export function ScheduleCalendar({ mode, view, date, events, employees, dayCounts, hours, meId }: Props) {
  const t = useTranslations("schedule");
  const locale = useLocale();
  const router = useRouter();
  const admin = mode === "admin";
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ShiftDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => events.filter((e) => e.open || !hidden.has(e.employeeId)), [events, hidden]);
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const monthEvents = useMemo<EventInput[]>(
    () =>
      visible.map((e) => ({
        id: e.id, start: e.start, end: e.end,
        backgroundColor: e.open ? "#ffffff" : e.color, borderColor: e.open ? "#234A49" : e.color, textColor: e.open ? "#234A49" : textOn(e.color),
        editable: admin && !e.open,
        extendedProps: { name: e.open ? t("openShift") : e.name },
      })),
    [visible, admin, t],
  );
  const firstEmployee = employees.find((e) => e.active);
  const errText = (e: string) => t(`errors.${e as "unknown"}`);

  function openNew(day: string, start = "09:00", end = "17:00") {
    if (!admin || !firstEmployee) return;
    setDraft({ id: null, employeeId: firstEmployee.id, day, start, end, position: firstEmployee.position, notes: "" });
  }

  const draftOf = (ev: CalEvent, p?: Placement): ShiftDraft => ({
    id: ev.id, employeeId: ev.employeeId, day: p?.day ?? ev.start.slice(0, 10), start: p?.start ?? ev.start.slice(11, 16), end: p?.end ?? ev.end.slice(11, 16),
    position: ev.position, notes: ev.notes,
  });

  /** Moves/resizes save straight away; an availability mismatch hands over to the dialog to be acknowledged. */
  async function persist(ev: CalEvent, p: Placement, revert?: () => void) {
    setBanner(null);
    const base = draftOf(ev, p);
    const res = await saveShift({ ...base, override: false, overrideNote: "" });
    if (res.ok) return router.refresh();
    revert?.();
    if ("warning" in res) setDraft({ ...base, warning: res.warning });
    else setBanner({ kind: "error", text: errText(res.error) });
  }

  async function monthDrop(info: EventDropArg) {
    const e = info.event;
    const orig = events.find((x) => x.id === e.id);
    if (!e.start || !e.end || !orig || orig.open) return info.revert();
    await persist(orig, { day: dayOf(e.start), start: timeOf(e.start), end: timeOf(e.end) }, info.revert);
  }

  function removeSelected() {
    if (!selected) return;
    const open = !!selected.open;
    if (!window.confirm(open ? t("confirmCancelOpen") : t("confirmDelete"))) return;
    setBanner(null);
    startTransition(async () => {
      const res = open ? await cancelOpenShift(selected.id) : await deleteShift(selected.id);
      if (!res.ok) return setBanner({ kind: "error", text: errText(res.error) });
      setSelectedId(null);
      router.refresh();
    });
  }

  function requestSelected() {
    if (!selected?.open) return;
    setBanner(null);
    startTransition(async () => {
      const res = await requestOpenShift(selected.id, note);
      if (!res.ok) return setBanner({ kind: "error", text: errText(res.error) });
      setBanner({ kind: "ok", text: t("requestSent") });
      setSelectedId(null);
      setNote("");
      router.refresh();
    });
  }

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selDay = selected ? selected.start.slice(0, 10) : "";
  const selTime = selected ? `${selected.start.slice(11, 16)}–${selected.end.slice(11, 16)}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("filter")} className="flex flex-wrap gap-2">
          {employees.filter((e) => e.active || events.some((x) => x.employeeId === e.id)).map((e) => {
            const off = hidden.has(e.id);
            return (
              <button key={e.id} type="button" aria-pressed={!off} onClick={() => toggle(e.id)}
                className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 ring-brand/15", off ? "bg-mist text-ink-soft line-through" : "bg-paper")}>
                <span className="size-3 rounded-full" style={{ backgroundColor: e.color, opacity: off ? 0.3 : 1 }} aria-hidden />
                {e.name}
              </button>
            );
          })}
        </div>
        {!admin && <Button onClick={() => setOfferOpen(true)}>{t("offerCta")}</Button>}
      </div>

      {banner && (
        <p role={banner.kind === "error" ? "alert" : "status"} className={cn("rounded-xl p-3 text-sm", banner.kind === "error" ? "bg-red-50 text-danger" : "bg-brand-soft text-brand")}>{banner.text}</p>
      )}

      {/* action bar for the selected shift */}
      {selected && view === "week" && (
        <div role="region" aria-label={t("selectedShift")} className="sticky top-28 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-card)] bg-ink px-4 py-3 text-ivory shadow-[var(--shadow-soft)]">
          <span className="font-medium">{selected.open ? t("openShift") : selected.name}</span>
          <span className="text-sm capitalize opacity-80">{dayLabel(selDay, locale)} · <span className="tabular-nums">{selTime}</span>{selected.position ? ` · ${selected.position}` : ""}</span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {admin && !selected.open && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDraft(draftOf(selected))}>{t("editShift")}</Button>
                <Button size="sm" variant="secondary" className="text-danger" onClick={removeSelected} disabled={pending}>{t("delete")}</Button>
              </>
            )}
            {admin && selected.open && <Button size="sm" variant="secondary" className="text-danger" onClick={removeSelected} disabled={pending}>{t("cancelOpen")}</Button>}
            {!admin && selected.open && (
              <>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("requestNote")} aria-label={t("requestNote")}
                  className="h-9 w-48 rounded-full bg-white px-3 text-sm text-ink" />
                <Button size="sm" variant="secondary" onClick={requestSelected} disabled={pending}>{t("requestShift")}</Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="text-ivory hover:text-ink" onClick={() => setSelectedId(null)}>{t("close")}</Button>
          </span>
        </div>
      )}

      {view === "week" ? (
        <>
          <WeekTimeline
            days={weekDays(date)}
            events={visible}
            hours={hours}
            readOnly={!admin}
            meId={meId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={(p) => openNew(p.day, p.start, p.end)}
            onEdit={(ev) => setDraft(draftOf(ev))}
            onMove={(ev, p) => void persist(ev, p)}
          />
          <p className="text-xs text-ink-soft">{admin ? t("timelineHint", { open: hours.open, close: hours.close }) : t("employeeHint", { open: hours.open, close: hours.close })}</p>
        </>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] bg-paper p-2 shadow-[var(--shadow-soft)] sm:p-4">
          <FullCalendar
            key={date}
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            initialDate={date}
            timeZone="UTC"
            locales={[itLocale]}
            locale={locale}
            firstDay={1}
            headerToolbar={false}
            height="auto"
            eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            dayMaxEvents={4}
            editable={admin}
            eventDurationEditable={false}
            events={monthEvents}
            dateClick={(i) => openNew(dayOf(i.date))}
            eventClick={(i) => {
              const ev = events.find((x) => x.id === i.event.id);
              if (ev && admin && !ev.open) setDraft(draftOf(ev));
            }}
            eventDrop={monthDrop}
            dayCellContent={(arg) => (
              <div className="flex w-full items-center justify-between gap-1">
                <span role="link" tabIndex={0} title={t("openWeek")} className="cursor-pointer font-medium underline-offset-2 hover:underline"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`${admin ? "/admin" : "/employee"}/schedule?view=week&date=${dayOf(arg.date)}`); }}
                  onKeyDown={(e) => { if (e.key === "Enter") router.push(`${admin ? "/admin" : "/employee"}/schedule?view=week&date=${dayOf(arg.date)}`); }}>
                  {arg.dayNumberText}
                </span>
                {dayCounts[dayOf(arg.date)] ? (
                  <span className="whitespace-nowrap rounded-full bg-brand-soft px-2 text-[11px] text-brand">{t("count", { count: dayCounts[dayOf(arg.date)] })}</span>
                ) : null}
              </div>
            )}
            eventContent={(arg) => (
              <div className="overflow-hidden px-1 py-0.5 text-[12px] leading-tight">
                <span className="font-semibold">{arg.event.extendedProps.name as string}</span> <span>{arg.timeText}</span>
              </div>
            )}
          />
        </div>
      )}

      {admin && (
        <ShiftDialog
          draft={draft}
          employees={employees}
          hours={hours}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); setSelectedId(null); router.refresh(); }}
        />
      )}
      {!admin && (
        <OfferDialog open={offerOpen} defaultDay={date} hours={hours} onClose={() => setOfferOpen(false)}
          onSent={() => { setOfferOpen(false); setBanner({ kind: "ok", text: t("offerSent") }); router.refresh(); }} />
      )}
    </div>
  );
}
