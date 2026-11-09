import { describe, expect, it } from "vitest";
import { addDays, hoursBetween, intervalInstants, mondayOf, overlaps, weekDays } from "@/lib/time/rome";

describe("Europe/Rome time helpers", () => {
  it("finds the Monday of any day in the week", () => {
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the previous Monday
    expect(mondayOf("2026-11-18")).toBe("2026-11-16");
  });

  it("lists seven days starting Monday", () => {
    const days = weekDays("2026-11-16");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-11-16");
    expect(days[6]).toBe("2026-11-22");
  });

  it("handles month and year rollovers", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("keeps a same-day interval on one day", () => {
    const i = intervalInstants("2026-11-16", "09:00", "14:30");
    expect(i.overnight).toBe(false);
    expect(hoursBetween(i.startsAt, i.endsAt)).toBe(5.5);
  });

  it("moves an overnight end to the next day", () => {
    const i = intervalInstants("2026-11-16", "18:00", "01:00");
    expect(i.overnight).toBe(true);
    expect(hoursBetween(i.startsAt, i.endsAt)).toBe(7);
  });

  it("treats 17:00–00:00 as ending at the next midnight", () => {
    const i = intervalInstants("2026-11-20", "17:00", "00:00");
    expect(i.overnight).toBe(true);
    expect(hoursBetween(i.startsAt, i.endsAt)).toBe(7);
  });

  it("rejects identical start and end, and malformed times", () => {
    expect(() => intervalInstants("2026-11-16", "09:00", "09:00")).toThrow();
    expect(() => intervalInstants("2026-11-16", "9:00", "10:00")).toThrow();
    expect(() => intervalInstants("2026-11-16", "09:00", "24:00")).toThrow();
  });

  it("counts real elapsed hours across the October DST change (clocks go back)", () => {
    // 24→25 Oct 2026: 02:00–03:00 happens twice, the night is 25 hours long
    const i = intervalInstants("2026-10-24", "22:00", "06:00");
    expect(hoursBetween(i.startsAt, i.endsAt)).toBe(9);
  });

  it("counts real elapsed hours across the March DST change (clocks go forward)", () => {
    // 28→29 Mar 2026: 02:00–03:00 does not exist, the night is 23 hours long
    const i = intervalInstants("2026-03-28", "22:00", "06:00");
    expect(hoursBetween(i.startsAt, i.endsAt)).toBe(7);
  });

  it("detects overlaps but allows back-to-back intervals", () => {
    const a = intervalInstants("2026-11-16", "09:00", "15:00");
    const b = intervalInstants("2026-11-16", "15:00", "23:00");
    const c = intervalInstants("2026-11-16", "14:00", "16:00");
    expect(overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt)).toBe(false);
    expect(overlaps(a.startsAt, a.endsAt, c.startsAt, c.endsAt)).toBe(true);
  });
});
