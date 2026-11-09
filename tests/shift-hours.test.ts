import { describe, expect, it } from "vitest";
import { assignLanes, axisOf, DEFAULT_SHIFT_HOURS, isWithinHours, minToTime, parseShiftHours, shiftSpan, snap } from "@/lib/scheduling/shift-hours";

const H = DEFAULT_SHIFT_HOURS;

describe("shift hours (07:00 → 02:00 next day)", () => {
  it("covers a 19-hour axis", () => {
    expect(axisOf(H)).toEqual({ startMin: 420, endMin: 1560, span: 1140 });
  });

  it("accepts shifts inside the window, including ones that cross midnight up to 02:00", () => {
    expect(isWithinHours("07:00", "15:00", H)).toBe(true);
    expect(isWithinHours("18:00", "23:30", H)).toBe(true);
    expect(isWithinHours("18:00", "02:00", H)).toBe(true);
    expect(isWithinHours("22:00", "00:00", H)).toBe(true);
    expect(isWithinHours("07:00", "02:00", H)).toBe(true); // the full 19 hours
  });

  it("rejects shifts that start before 07:00 or end after 02:00", () => {
    expect(isWithinHours("06:30", "12:00", H)).toBe(false);
    expect(isWithinHours("00:30", "05:00", H)).toBe(false);
    expect(isWithinHours("20:00", "02:30", H)).toBe(false);
    expect(isWithinHours("20:00", "05:00", H)).toBe(false);
    expect(isWithinHours("10:00", "10:00", H)).toBe(false);
  });

  it("reads custom hours from settings and falls back safely", () => {
    expect(parseShiftHours({ earliest_start: "08:30", latest_end: "01:00" })).toEqual({ open: "08:30", close: "01:00" });
    expect(parseShiftHours(null)).toEqual(H);
    expect(parseShiftHours({ earliest_start: "7am" })).toEqual(H);
  });

  it("converts spans and minutes", () => {
    expect(shiftSpan("18:00", "01:00")).toEqual({ startMin: 1080, endMin: 1500 });
    expect(shiftSpan("09:00", "15:00")).toEqual({ startMin: 540, endMin: 900 });
    expect(minToTime(1500)).toBe("01:00");
    expect(minToTime(420)).toBe("07:00");
    expect(snap(433)).toBe(435);
  });
});

describe("lanes for simultaneous shifts", () => {
  const s = (id: string, a: number, b: number) => ({ id, startMin: a, endMin: b });

  it("puts people working at the same time in different lanes", () => {
    const { placed, laneCount } = assignLanes([s("a", 540, 900), s("b", 600, 960), s("c", 660, 720)]);
    expect(laneCount).toBe(3);
    expect(new Set(placed.map((p) => p.lane)).size).toBe(3);
  });

  it("reuses a lane for back-to-back shifts", () => {
    const { placed, laneCount } = assignLanes([s("a", 540, 900), s("b", 900, 1380)]);
    expect(laneCount).toBe(1);
    expect(placed.map((p) => p.lane)).toEqual([0, 0]);
  });

  it("is stable and compact: a gap lets a later shift drop back to lane 0", () => {
    const { placed } = assignLanes([s("a", 540, 700), s("b", 600, 800), s("c", 720, 900)]);
    expect(placed.find((p) => p.item.id === "c")?.lane).toBe(0);
  });

  it("returns one lane for an empty day", () => {
    expect(assignLanes([]).laneCount).toBe(1);
  });
});
