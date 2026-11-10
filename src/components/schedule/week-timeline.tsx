"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { dayLabel } from "@/lib/format/week";
import { textOn } from "@/lib/color";
import { assignLanes, axisOf, minToTime, snap, toMin, type ShiftHours } from "@/lib/scheduling/shift-hours";
import { cn } from "@/lib/utils";
import type { CalEvent } from "./schedule-calendar";

const LANE_H = 44; // px per lane
const PAD = 8;
const MIN_LEN = 30; // shortest bar when resizing (minutes)

export interface Placement { day: string; start: string; end: string }

interface Props {
  days: string[];
  events: CalEvent[];
  hours: ShiftHours;
  /** employees see the same calendar but cannot create, move or resize anything */
  readOnly?: boolean;
  /** admin only: people on approved leave per day */
  absentByDay?: Record<string, { name: string; kind: "ferie" | "assenza" }[]>;
  /** highlights this person's shifts */
  meId?: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: (p: Placement) => void;
  onEdit: (e: CalEvent) => void;
  onMove: (e: CalEvent, p: Placement) => void;
}

interface Item { ev: CalEvent; day: string; startMin: number; endMin: number }
type Mode = "move" | "resize-end" | "resize-start";
interface Drag { id: string; mode: Mode; dayIdx: number; startMin: number; endMin: number; moved: boolean }

/** wall-clock "yyyy-MM-ddTHH:mm:ss" → minutes since the start day's midnight (overnight ends exceed 1440) */
function toItem(ev: CalEvent): Item {
  const day = ev.start.slice(0, 10);
  const startMin = toMin(ev.start.slice(11, 16));
  const dur = (Date.parse(`${ev.end}Z`) - Date.parse(`${ev.start}Z`)) / 60000;
  return { ev, day, startMin, endMin: startMin + dur };
}

/**
 * Horizontal week view: one row per day, time runs left → right (07:00 → 02:00 next day).
 * People working at the same time are stacked in lanes inside the day's row.
 * Admins: click a shift to select it, drag to move, drag either edge to expand, or use the action bar.
 */
export function WeekTimeline({ days, events, hours, readOnly, absentByDay, meId, selectedId, onSelect, onNew, onEdit, onMove }: Props) {
  const t = useTranslations("schedule");
  const locale = useLocale();
  const axis = axisOf(hours);
  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const origin = useRef<{ x: number; startMin: number; endMin: number; width: number } | null>(null);
  const justDragged = useRef(false);

  const items = useMemo(() => events.map(toItem), [events]);
  const rows = useMemo(
    () =>
      days.map((day) => {
        const list = items.filter((i) => i.day === day);
        const { placed, laneCount } = assignLanes(list);
        return { day, placed, laneCount, people: new Set(list.filter((i) => !i.ev.open).map((i) => i.ev.employeeId)).size };
      }),
    [days, items],
  );

  const hourMarks = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.ceil(axis.startMin / 60) * 60; m <= axis.endMin; m += 60) out.push(m);
    return out;
  }, [axis.startMin, axis.endMin]);

  const pct = (min: number) => ((min - axis.startMin) / axis.span) * 100;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const editable = (i: Item) => !readOnly && !i.ev.open;

  function rowAt(clientY: number, fallback: number) {
    const idx = trackRefs.current.findIndex((el) => {
      const r = el?.getBoundingClientRect();
      return r && clientY >= r.top && clientY <= r.bottom;
    });
    return idx === -1 ? fallback : idx;
  }

  function begin(e: React.PointerEvent, item: Item, dayIdx: number, mode: Mode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!editable(item)) return; // read-only and open shifts: handled as a plain click on release
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const width = trackRefs.current[dayIdx]?.getBoundingClientRect().width ?? 1;
    origin.current = { x: e.clientX, startMin: item.startMin, endMin: item.endMin, width };
    const d: Drag = { id: item.ev.id, mode, dayIdx, startMin: item.startMin, endMin: item.endMin, moved: false };
    dragRef.current = d;
    setDrag(d);
  }

  function move(e: React.PointerEvent, item: Item, dayIdx: number) {
    const o = origin.current;
    const cur = dragRef.current;
    if (!o || !cur || cur.id !== item.ev.id) return;
    const dMin = ((e.clientX - o.x) / o.width) * axis.span;
    let next: Drag;
    if (cur.mode === "move") {
      const len = o.endMin - o.startMin;
      const start = clamp(snap(o.startMin + dMin), axis.startMin, axis.endMin - len);
      next = { ...cur, startMin: start, endMin: start + len, dayIdx: rowAt(e.clientY, dayIdx) };
    } else if (cur.mode === "resize-end") {
      next = { ...cur, endMin: clamp(snap(o.endMin + dMin), o.startMin + MIN_LEN, axis.endMin) };
    } else {
      next = { ...cur, startMin: clamp(snap(o.startMin + dMin), axis.startMin, o.endMin - MIN_LEN) };
    }
    next.moved = cur.moved || Math.abs(e.clientX - o.x) > 4 || next.dayIdx !== dayIdx;
    dragRef.current = next;
    setDrag(next);
  }

  function end(item: Item, dayIdx: number) {
    const d = dragRef.current;
    dragRef.current = null;
    origin.current = null;
    setDrag(null);
    if (!d || d.id !== item.ev.id || !d.moved) return; // a plain click is handled by onClick
    justDragged.current = true; // swallow the click that follows a drag
    setTimeout(() => { justDragged.current = false; }, 0);
    const changed = d.startMin !== item.startMin || d.endMin !== item.endMin || d.dayIdx !== dayIdx;
    onSelect(item.ev.id);
    if (changed) onMove(item.ev, { day: days[d.dayIdx], start: minToTime(d.startMin), end: minToTime(d.endMin) });
  }

  /** keyboard: arrows nudge by 15 min, Shift+arrows change the end */
  function key(e: React.KeyboardEvent, item: Item, dayIdx: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return onSelect(selectedId === item.ev.id ? null : item.ev.id);
    }
    if (e.key === "Escape") return onSelect(null);
    if (!editable(item) || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 15 : -15;
    const start = e.shiftKey ? item.startMin : clamp(item.startMin + dir, axis.startMin, axis.endMin - (item.endMin - item.startMin));
    const endMin = e.shiftKey ? clamp(item.endMin + dir, item.startMin + MIN_LEN, axis.endMin) : start + (item.endMin - item.startMin);
    onMove(item.ev, { day: days[dayIdx], start: minToTime(start), end: minToTime(endMin) });
  }

  function clickTrack(e: React.MouseEvent<HTMLDivElement>, day: string) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.grid) return;
    if (selectedId) return onSelect(null);
    if (readOnly) return;
    const r = e.currentTarget.getBoundingClientRect();
    const min = clamp(snap(axis.startMin + ((e.clientX - r.left) / r.width) * axis.span, 30), axis.startMin, axis.endMin - 60);
    onNew({ day, start: minToTime(min), end: minToTime(Math.min(min + 240, axis.endMin)) });
  }

  const dragItem = drag ? items.find((i) => i.ev.id === drag.id) : undefined;

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] bg-paper shadow-[var(--shadow-soft)]">
      <div className="min-w-[1000px] sm:min-w-[1100px]">
        {/* hour scale */}
        <div className="sticky top-0 z-30 grid grid-cols-[5.5rem_1fr] border-b border-brand/10 bg-paper sm:grid-cols-[9rem_1fr]">
          <div className="sticky left-0 z-20 bg-paper px-2 py-3 text-xs font-medium uppercase tracking-wide text-ink-soft sm:px-4">{t("days")}</div>
          <div className="relative h-10">
            {hourMarks.map((m) => (
              <span key={m} className={cn("absolute top-0 flex h-full items-center text-xs tabular-nums text-ink-soft", m === axis.endMin ? "-translate-x-full pr-1" : "-translate-x-1/2")} style={{ left: `${pct(m)}%` }}>
                {minToTime(m)}
                {m === 1440 && <sup className="ml-0.5 text-[9px] text-brand">+1</sup>}
              </span>
            ))}
          </div>
        </div>

        {rows.map((row, idx) => {
          const weekend = idx >= 5;
          const height = PAD * 2 + row.laneCount * LANE_H;
          return (
            <div key={row.day} className={cn("grid grid-cols-[5.5rem_1fr] border-b border-brand/10 last:border-b-0 sm:grid-cols-[9rem_1fr]", weekend && "bg-brand-soft/25")}>
              <div className="sticky left-0 z-10 flex flex-col justify-center border-r border-brand/10 bg-paper px-2 py-2 sm:px-4">
                <span className="font-display text-base capitalize leading-tight text-brand sm:text-lg">{dayLabel(row.day, locale)}</span>
                <span className="text-xs text-ink-soft">{row.people > 0 ? t("count", { count: row.people }) : t("nobody")}</span>
                {(absentByDay?.[row.day] ?? []).map((a) => (
                  <span key={a.name + a.kind} className="mt-0.5 block rounded bg-amber-100 px-1.5 text-xs text-amber-900" title={t(`absent.${a.kind}`)}>
                    {t("absent.label", { name: a.name, kind: t(`absent.${a.kind}`) })}
                  </span>
                ))}
              </div>
              <div
                ref={(el) => { trackRefs.current[idx] = el; }}
                data-grid="1"
                onClick={(e) => clickTrack(e, row.day)}
                className={cn("relative", readOnly ? "cursor-default" : "cursor-cell")}
                style={{ height }}
                aria-label={readOnly ? undefined : t("addOnDay", { day: dayLabel(row.day, locale) })}
              >
                {hourMarks.map((m) => (
                  <div key={m} data-grid="1" className={cn("absolute inset-y-0 w-px", m === 1440 ? "bg-brand/40" : "bg-brand/10")} style={{ left: `${pct(m)}%` }} />
                ))}

                {row.placed.map(({ item, lane }) => (
                  <Bar key={item.ev.id} item={item} top={PAD + lane * LANE_H} left={pct(item.startMin)} width={pct(item.endMin) - pct(item.startMin)}
                    dim={drag?.id === item.ev.id} selected={selectedId === item.ev.id} mine={!!meId && item.ev.employeeId === meId} editable={editable(item)}
                    onDown={(e, mode) => begin(e, item, idx, mode)} onMoveP={(e) => move(e, item, idx)} onUp={() => end(item, idx)} onKey={(e) => key(e, item, idx)}
                    onDouble={() => editable(item) && onEdit(item.ev)}
                    onClick={() => { if (!justDragged.current) onSelect(selectedId === item.ev.id ? null : item.ev.id); }} />
                ))}

                {drag && dragItem && drag.dayIdx === idx && (
                  <Bar item={{ ...dragItem, startMin: drag.startMin, endMin: drag.endMin }} top={PAD} left={pct(drag.startMin)} width={pct(drag.endMin) - pct(drag.startMin)} dragging editable
                    onDown={() => {}} onMoveP={() => {}} onUp={() => {}} onKey={() => {}} onDouble={() => {}} onClick={() => {}} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bar({ item, top, left, width, dragging, dim, selected, mine, editable, onDown, onMoveP, onUp, onKey, onDouble, onClick }: {
  item: Item; top: number; left: number; width: number; dragging?: boolean; dim?: boolean; selected?: boolean; mine?: boolean; editable: boolean;
  onDown: (e: React.PointerEvent, mode: Mode) => void;
  onMoveP: (e: React.PointerEvent) => void;
  onUp: () => void;
  onKey: (e: React.KeyboardEvent) => void;
  onDouble: () => void;
  onClick: () => void;
}) {
  const t = useTranslations("schedule");
  const { ev } = item;
  const isOpen = !!ev.open;
  const label = `${minToTime(item.startMin)}–${minToTime(item.endMin)}`;
  const handle = "absolute inset-y-0 z-10 w-3 touch-none bg-black/15 opacity-0 hover:bg-black/30 group-hover:opacity-100";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${isOpen ? t("openShift") : ev.name} ${label}${ev.position ? ` ${ev.position}` : ""}`}
      onPointerDown={(e) => onDown(e, "move")}
      onPointerMove={onMoveP}
      onPointerUp={onUp}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={onDouble}
      onKeyDown={onKey}
      className={cn(
        "group absolute flex touch-none select-none flex-col justify-center overflow-hidden rounded-lg px-3 text-left shadow-sm",
        isOpen ? "border-2 border-dashed border-brand bg-paper/90" : "ring-1 ring-black/10",
        dragging ? "pointer-events-none z-20 opacity-90 shadow-lg" : editable ? "cursor-grab hover:brightness-110" : "cursor-pointer",
        selected && "z-20 ring-2 ring-ink ring-offset-1",
        mine && !selected && "ring-2 ring-white ring-offset-1 ring-offset-ink/60",
        dim && "opacity-30",
      )}
      style={{ top, left: `${left}%`, width: `${width}%`, height: LANE_H - 6, ...(isOpen ? { color: "#234A49" } : { backgroundColor: ev.color, color: textOn(ev.color) }) }}
    >
      <span className="truncate text-[13px] font-semibold leading-tight">{isOpen ? t("openShift") : ev.name}</span>
      <span className="truncate text-[11px] leading-tight tabular-nums opacity-90">
        {label}
        {isOpen && ev.open ? ` · ${t("openSlots", { count: ev.open.slots })}` : ev.position && width > 9 ? ` · ${ev.position}` : ""}
      </span>
      {editable && !dragging && (
        <>
          <span aria-hidden onPointerDown={(e) => onDown(e, "resize-start")} className={cn(handle, "left-0 cursor-w-resize", selected && "opacity-100")} />
          <span aria-hidden onPointerDown={(e) => onDown(e, "resize-end")} className={cn(handle, "right-0 cursor-e-resize", selected && "opacity-100")} />
        </>
      )}
    </div>
  );
}
