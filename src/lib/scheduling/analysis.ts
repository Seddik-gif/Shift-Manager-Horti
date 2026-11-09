import { isCovered } from "@/lib/availability/logic";
import { hoursBetween, overlaps, romeDay, weekDays } from "@/lib/time/rome";

export interface ShiftIn {
  id: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
  override: boolean;
}

export interface SchedulingRules {
  /** warn when a single shift is longer than this many hours (null = off) */
  longShiftHours: number | null;
  /** warn when an employee's weekly total exceeds this (null = off). An operational preference, not a legal limit. */
  weeklyHoursWarning: number | null;
}

export type Warning =
  | { type: "overlap"; employeeId: string; shiftId: string }
  | { type: "outside_availability"; employeeId: string; shiftId: string }
  | { type: "no_submission"; employeeId: string; shiftId: string }
  | { type: "overridden"; employeeId: string; shiftId: string }
  | { type: "long_shift"; employeeId: string; shiftId: string; hours: number }
  | { type: "weekly_hours"; employeeId: string; hours: number }
  | { type: "no_shifts"; employeeId: string };

export interface WeekAnalysis {
  hoursByEmployee: Record<string, number>;
  hoursByDay: Record<string, number>;
  shiftsByEmployee: Record<string, number>;
  shiftCount: number;
  warnings: Warning[];
}

interface Input {
  weekStart: string;
  shifts: ShiftIn[];
  employeeIds: string[];
  /** submitted availability windows (may include adjacent weeks, for overnight spill-over) */
  windows: { employeeId: string; startsAt: Date; endsAt: Date }[];
  /** employees who submitted for this week (only meaningful when requestExists) */
  submittedEmployeeIds: Set<string>;
  requestExists: boolean;
  rules: SchedulingRules;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Pure scheduling analysis for one week: hours, counts and warnings. Mirrors the SQL rules. */
export function analyzeWeek(input: Input): WeekAnalysis {
  const { shifts, employeeIds, windows, submittedEmployeeIds, requestExists, rules } = input;
  const days = new Set(weekDays(input.weekStart));
  const hoursByEmployee: Record<string, number> = {};
  const hoursByDay: Record<string, number> = Object.fromEntries([...days].map((d) => [d, 0]));
  const shiftsByEmployee: Record<string, number> = {};
  const warnings: Warning[] = [];

  for (const s of shifts) {
    const h = hoursBetween(s.startsAt, s.endsAt);
    hoursByEmployee[s.employeeId] = (hoursByEmployee[s.employeeId] ?? 0) + h;
    shiftsByEmployee[s.employeeId] = (shiftsByEmployee[s.employeeId] ?? 0) + 1;
    const day = romeDay(s.startsAt);
    if (day in hoursByDay) hoursByDay[day] += h;

    if (rules.longShiftHours !== null && h > rules.longShiftHours) {
      warnings.push({ type: "long_shift", employeeId: s.employeeId, shiftId: s.id, hours: round(h) });
    }
    if (requestExists) {
      if (!submittedEmployeeIds.has(s.employeeId)) {
        warnings.push({ type: s.override ? "overridden" : "no_submission", employeeId: s.employeeId, shiftId: s.id });
      } else {
        const mine = windows.filter((w) => w.employeeId === s.employeeId);
        if (!isCovered(s.startsAt, s.endsAt, mine)) {
          warnings.push({ type: s.override ? "overridden" : "outside_availability", employeeId: s.employeeId, shiftId: s.id });
        }
      }
    }
  }

  for (let i = 0; i < shifts.length; i++)
    for (let j = i + 1; j < shifts.length; j++)
      if (shifts[i].employeeId === shifts[j].employeeId && overlaps(shifts[i].startsAt, shifts[i].endsAt, shifts[j].startsAt, shifts[j].endsAt)) {
        warnings.push({ type: "overlap", employeeId: shifts[i].employeeId, shiftId: shifts[i].id });
        warnings.push({ type: "overlap", employeeId: shifts[j].employeeId, shiftId: shifts[j].id });
      }

  for (const id of employeeIds) {
    if (!shiftsByEmployee[id]) warnings.push({ type: "no_shifts", employeeId: id });
    const total = hoursByEmployee[id];
    if (rules.weeklyHoursWarning !== null && total !== undefined && total > rules.weeklyHoursWarning) {
      warnings.push({ type: "weekly_hours", employeeId: id, hours: round(total) });
    }
  }

  for (const k of Object.keys(hoursByEmployee)) hoursByEmployee[k] = round(hoursByEmployee[k]);
  for (const k of Object.keys(hoursByDay)) hoursByDay[k] = round(hoursByDay[k]);
  return { hoursByEmployee, hoursByDay, shiftsByEmployee, shiftCount: shifts.length, warnings };
}

export function parseRules(value: unknown): SchedulingRules {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);
  return { longShiftHours: num(v.long_shift_warning_hours), weeklyHoursWarning: num(v.weekly_hours_warning) };
}
