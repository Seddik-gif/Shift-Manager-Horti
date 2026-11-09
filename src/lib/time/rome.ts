import { TZDate } from "@date-fns/tz";

/** The scheduling timezone. Every calendar day in the product is a Europe/Rome day. */
export const TZ = "Europe/Rome";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDay(day: string) {
  if (!DAY_RE.test(day)) throw new Error(`Invalid day: ${day}`);
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

/** Add whole calendar days to a yyyy-MM-dd string (timezone independent). */
export function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The UTC instant of a Europe/Rome wall-clock time on a given day. DST-safe. */
export function romeInstant(day: string, time: string): Date {
  if (!TIME_RE.test(time)) throw new Error(`Invalid time: ${time}`);
  const { y, m, d } = parseDay(day);
  const [h, min] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, h, min, 0, TZ).getTime());
}

/** Monday (yyyy-MM-dd) of the ISO week containing `day`. */
export function mondayOf(day: string): string {
  const { y, m, d } = parseDay(day);
  const isoDow = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; // Mon=1
  return addDays(day, -(isoDow - 1));
}

/** The seven yyyy-MM-dd days of the week starting at `weekStart` (a Monday). */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export interface IntervalInstants {
  startsAt: Date;
  endsAt: Date;
  /** true when the interval crosses midnight (e.g. 18:00–01:00 or 17:00–00:00) */
  overnight: boolean;
}

/**
 * Convert a start/end wall-clock pair on `day` into UTC instants.
 * An end time that is not after the start time means "the next day" (18:00–01:00, 17:00–00:00).
 * Identical start and end is rejected.
 */
export function intervalInstants(day: string, start: string, end: string): IntervalInstants {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new Error("Invalid time");
  if (start === end) throw new Error("Start and end must differ");
  const overnight = end < start;
  const endDay = overnight || end === "00:00" ? addDays(day, 1) : day;
  return {
    startsAt: romeInstant(day, start),
    endsAt: romeInstant(endDay, end),
    overnight: endDay !== day,
  };
}

/** Real elapsed hours (correct across the DST changes of late March / late October). */
export function hoursBetween(startsAt: Date, endsAt: Date): number {
  return (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
}

/** True when two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Today's date in Europe/Rome as yyyy-MM-dd. */
export function todayInRome(now: Date = new Date()): string {
  // the en-CA locale formats dates as yyyy-MM-dd
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** HH:mm (24-hour) of an instant in Europe/Rome. */
export function romeTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** yyyy-MM-dd of an instant in Europe/Rome. */
export function romeDay(date: Date): string {
  return todayInRome(date);
}

/** "09:00–14:30" label for an interval. */
export function formatWindow(startsAt: Date, endsAt: Date): string {
  return `${romeTime(startsAt)}–${romeTime(endsAt)}`;
}

/** Rome wall-clock of an instant as "yyyy-MM-ddTHH:mm:ss" (no offset) – what the calendar displays. */
export function romeWallClock(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(date).replace(" ", "T");
}

/** Current time in ms. Isolated so server components can read the clock without tripping purity lint. */
export function nowMs(): number {
  return Date.now();
}
