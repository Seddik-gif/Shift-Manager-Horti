import { describe, expect, it } from "vitest";
import { analyzeWeek, parseRules, type ShiftIn } from "@/lib/scheduling/analysis";
import { intervalInstants } from "@/lib/time/rome";

const WEEK = "2026-11-16";
const shift = (id: string, emp: string, day: string, s: string, e: string, override = false): ShiftIn => {
  const i = intervalInstants(day, s, e);
  return { id, employeeId: emp, startsAt: i.startsAt, endsAt: i.endsAt, override };
};
const win = (emp: string, day: string, s: string, e: string) => {
  const i = intervalInstants(day, s, e);
  return { employeeId: emp, startsAt: i.startsAt, endsAt: i.endsAt };
};
const base = { weekStart: WEEK, employeeIds: ["a", "b"], windows: [], submittedEmployeeIds: new Set<string>(), requestExists: false, rules: { longShiftHours: 10, weeklyHoursWarning: null } };

describe("week analysis", () => {
  it("totals hours per employee and per day, including overnight and split shifts", () => {
    const r = analyzeWeek({ ...base, shifts: [
      shift("1", "a", "2026-11-16", "09:00", "15:00"), shift("2", "a", "2026-11-16", "18:00", "23:00"),
      shift("3", "b", "2026-11-20", "18:00", "01:00"),
    ] });
    expect(r.hoursByEmployee).toEqual({ a: 11, b: 7 });
    expect(r.hoursByDay["2026-11-16"]).toBe(11);
    expect(r.hoursByDay["2026-11-20"]).toBe(7); // overnight counted on the day it starts
    expect(r.shiftCount).toBe(3);
    expect(r.shiftsByEmployee).toEqual({ a: 2, b: 1 });
  });

  it("flags employees with no shifts and very long shifts, using the configurable threshold", () => {
    const shifts = [shift("1", "a", "2026-11-16", "10:00", "22:00")];
    const r = analyzeWeek({ ...base, shifts });
    expect(r.warnings).toContainEqual({ type: "no_shifts", employeeId: "b" });
    expect(r.warnings).toContainEqual({ type: "long_shift", employeeId: "a", shiftId: "1", hours: 12 });
    expect(analyzeWeek({ ...base, rules: { longShiftHours: null, weeklyHoursWarning: null }, shifts }).warnings.some((w) => w.type === "long_shift")).toBe(false);
  });

  it("only warns about weekly hours when a threshold is configured", () => {
    const shifts = [shift("1", "a", "2026-11-16", "09:00", "17:00"), shift("2", "a", "2026-11-17", "09:00", "17:00")];
    expect(analyzeWeek({ ...base, shifts }).warnings.some((w) => w.type === "weekly_hours")).toBe(false);
    expect(analyzeWeek({ ...base, shifts, rules: { longShiftHours: 10, weeklyHoursWarning: 12 } }).warnings).toContainEqual({ type: "weekly_hours", employeeId: "a", hours: 16 });
  });

  it("compares shifts with submitted availability, including chained windows and overrides", () => {
    const windows = [win("a", "2026-11-16", "09:00", "14:00"), win("a", "2026-11-16", "14:00", "18:00")];
    const common = { ...base, requestExists: true, submittedEmployeeIds: new Set(["a"]), windows };
    expect(analyzeWeek({ ...common, shifts: [shift("1", "a", "2026-11-16", "12:00", "16:00")] }).warnings.some((w) => w.type === "outside_availability")).toBe(false);
    const out = analyzeWeek({ ...common, shifts: [shift("2", "a", "2026-11-16", "17:00", "20:00")] });
    expect(out.warnings).toContainEqual({ type: "outside_availability", employeeId: "a", shiftId: "2" });
    const over = analyzeWeek({ ...common, shifts: [shift("2", "a", "2026-11-16", "17:00", "20:00", true)] });
    expect(over.warnings).toContainEqual({ type: "overridden", employeeId: "a", shiftId: "2" });
  });

  it("flags employees who did not submit, only when a request exists", () => {
    const shifts = [shift("1", "b", "2026-11-16", "10:00", "14:00")];
    expect(analyzeWeek({ ...base, shifts }).warnings.some((w) => w.type === "no_submission")).toBe(false);
    expect(analyzeWeek({ ...base, requestExists: true, shifts }).warnings).toContainEqual({ type: "no_submission", employeeId: "b", shiftId: "1" });
  });

  it("detects overlapping shifts defensively", () => {
    const r = analyzeWeek({ ...base, shifts: [shift("1", "a", "2026-11-16", "09:00", "14:00"), shift("2", "a", "2026-11-16", "13:00", "18:00")] });
    expect(r.warnings.filter((w) => w.type === "overlap")).toHaveLength(2);
  });

  it("parses rules safely", () => {
    expect(parseRules({ long_shift_warning_hours: 10, weekly_hours_warning: null })).toEqual({ longShiftHours: 10, weeklyHoursWarning: null });
    expect(parseRules(null)).toEqual({ longShiftHours: null, weeklyHoursWarning: null });
    expect(parseRules({ long_shift_warning_hours: -3 }).longShiftHours).toBeNull();
  });
});
