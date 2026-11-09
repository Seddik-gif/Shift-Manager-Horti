/** Allowed shift window: earliest start and latest end (the latter on the NEXT day when it is past midnight). */
export interface ShiftHours { open: string; close: string }
export const DEFAULT_SHIFT_HOURS: ShiftHours = { open: "07:00", close: "02:00" };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const minToTime = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function parseShiftHours(value: unknown): ShiftHours {
  const v = (value ?? {}) as Record<string, unknown>;
  const open = typeof v.earliest_start === "string" && TIME_RE.test(v.earliest_start) ? v.earliest_start : DEFAULT_SHIFT_HOURS.open;
  const close = typeof v.latest_end === "string" && TIME_RE.test(v.latest_end) ? v.latest_end : DEFAULT_SHIFT_HOURS.close;
  return { open, close };
}

/** Minutes since the start day's midnight. An end that is not after the start means the next day. */
export function shiftSpan(start: string, end: string): { startMin: number; endMin: number } {
  const s = toMin(start);
  const e = toMin(end);
  return { startMin: s, endMin: e <= s ? e + 1440 : e };
}

/** The timeline axis, in minutes since the start day's midnight (e.g. 420 → 1560 for 07:00 → 02:00). */
export function axisOf(h: ShiftHours): { startMin: number; endMin: number; span: number } {
  const startMin = toMin(h.open);
  const endMin = 1440 + toMin(h.close);
  return { startMin, endMin, span: endMin - startMin };
}

export function isWithinHours(start: string, end: string, h: ShiftHours): boolean {
  if (start === end) return false;
  const a = axisOf(h);
  const { startMin, endMin } = shiftSpan(start, end);
  return startMin >= a.startMin && endMin <= a.endMin;
}

export interface Laned<T> { item: T; lane: number }

/**
 * Stack overlapping items into lanes so people working at the same time sit one above the other.
 * Items that merely touch (one ends when the next starts) share a lane.
 */
export function assignLanes<T extends { startMin: number; endMin: number }>(items: T[]): { placed: Laned<T>[]; laneCount: number } {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = [];
  const placed: Laned<T>[] = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else laneEnds[lane] = item.endMin;
    placed.push({ item, lane });
  }
  return { placed, laneCount: Math.max(1, laneEnds.length) };
}

/** Snap minutes to a step (default 15). */
export const snap = (min: number, step = 15) => Math.round(min / step) * step;
