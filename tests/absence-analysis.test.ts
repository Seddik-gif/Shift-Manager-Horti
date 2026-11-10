import { describe, expect, it } from "vitest";
import { analyzeWeek } from "@/lib/scheduling/analysis";
import { romeInstant } from "@/lib/time/rome";

const base = {
  weekStart: "2030-07-01",
  employeeIds: ["m", "g"],
  windows: [],
  submittedEmployeeIds: new Set<string>(),
  requestExists: false,
  rules: {},
};
const shift = (id: string, employeeId: string, day: string, from: string, to: string, override = false) => ({
  id, employeeId, startsAt: romeInstant(day, from), endsAt: romeInstant(day, to), override,
});

describe("absences in the weekly analysis", () => {
  const absences = [{ employeeId: "m", startDate: "2030-07-02", endDate: "2030-07-03" }];

  it("flags a shift on an absence day, and only for that person", () => {
    const res = analyzeWeek({
      ...base, absences,
      shifts: [shift("s1", "m", "2030-07-02", "10:00", "14:00"), shift("s2", "g", "2030-07-02", "10:00", "14:00"), shift("s3", "m", "2030-07-04", "10:00", "14:00")],
    });
    expect(res.warnings.filter((w) => w.type === "on_absence")).toEqual([{ type: "on_absence", employeeId: "m", shiftId: "s1" }]);
  });

  it("an acknowledged shift is reported as overridden instead", () => {
    const res = analyzeWeek({ ...base, absences, shifts: [shift("s1", "m", "2030-07-02", "10:00", "14:00", true)] });
    expect(res.warnings.some((w) => w.type === "on_absence")).toBe(false);
    expect(res.warnings.some((w) => w.type === "overridden")).toBe(true);
  });

  it("catches a late shift whose tail runs into the first absence day", () => {
    const night = { id: "n", employeeId: "m", startsAt: romeInstant("2030-07-01", "20:00"), endsAt: romeInstant("2030-07-02", "01:00"), override: false };
    expect(analyzeWeek({ ...base, absences, shifts: [night] }).warnings.some((w) => w.type === "on_absence")).toBe(true);
  });

  it("behaves exactly as before when no absences are given", () => {
    expect(analyzeWeek({ ...base, shifts: [shift("s1", "m", "2030-07-02", "10:00", "14:00")] }).warnings.some((w) => w.type === "on_absence")).toBe(false);
  });
});
