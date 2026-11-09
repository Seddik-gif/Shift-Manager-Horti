import { describe, expect, it } from "vitest";
import { completionPercent, emptyWeek, isCovered, validateWeek, type DayInput } from "@/lib/availability/logic";
import { weekRangeLabel } from "@/lib/format/week";
import { intervalInstants, formatWindow } from "@/lib/time/rome";
import { NOTIFICATION_TYPES, renderNotification } from "@/lib/notifications/render";
import it_ from "../messages/it.json";
import en from "../messages/en.json";

const WEEK = "2026-11-16";
const week = (patch: Record<string, Partial<DayInput>> = {}): DayInput[] =>
  emptyWeek(WEEK).map((d) => ({ ...d, available: false, ...patch[d.day] }));

describe("availability validation", () => {
  it("accepts the example week with several intervals per day", () => {
    const days = week({
      "2026-11-16": { available: true, windows: [{ start: "09:00", end: "14:30" }, { start: "18:00", end: "23:30" }] },
      "2026-11-20": { available: true, windows: [{ start: "09:00", end: "13:00" }, { start: "17:00", end: "00:00" }] },
    });
    expect(validateWeek(days, true)).toEqual({});
  });

  it("rejects overlapping intervals on the same day", () => {
    const days = week({ "2026-11-16": { available: true, windows: [{ start: "09:00", end: "14:00" }, { start: "13:00", end: "18:00" }] } });
    expect(validateWeek(days, false)["2026-11-16"]).toContain("overlap");
  });

  it("allows back-to-back intervals", () => {
    const days = week({ "2026-11-16": { available: true, windows: [{ start: "09:00", end: "14:00" }, { start: "14:00", end: "18:00" }] } });
    expect(validateWeek(days, true)).toEqual({});
  });

  it("detects overlap between an overnight interval and the next day", () => {
    const days = week({
      "2026-11-16": { available: true, windows: [{ start: "18:00", end: "01:00" }] },
      "2026-11-17": { available: true, windows: [{ start: "00:30", end: "03:00" }] },
    });
    const issues = validateWeek(days, false);
    expect(issues["2026-11-16"]).toContain("overlap");
    expect(issues["2026-11-17"]).toContain("overlap");
  });

  it("accepts an overnight interval followed by a later start on the next day", () => {
    const days = week({
      "2026-11-16": { available: true, windows: [{ start: "18:00", end: "01:00" }] },
      "2026-11-17": { available: true, windows: [{ start: "10:00", end: "16:00" }] },
    });
    expect(validateWeek(days, true)).toEqual({});
  });

  it("rejects identical start and end", () => {
    const days = week({ "2026-11-16": { available: true, windows: [{ start: "09:00", end: "09:00" }] } });
    expect(validateWeek(days, false)["2026-11-16"]).toContain("sameTime");
  });

  it("requires every day answered and available days to have intervals before submitting", () => {
    expect(Object.keys(validateWeek(emptyWeek(WEEK), true))).toHaveLength(7);
    expect(validateWeek(emptyWeek(WEEK), false)).toEqual({}); // drafts may be partial
    const days = week({ "2026-11-18": { available: true, windows: [] } });
    expect(validateWeek(days, true)["2026-11-18"]).toContain("noWindows");
  });
});

describe("availability helpers", () => {
  it("treats touching windows as one when checking coverage", () => {
    const a = intervalInstants("2026-11-16", "09:00", "14:00");
    const b = intervalInstants("2026-11-16", "14:00", "18:00");
    const shift = intervalInstants("2026-11-16", "12:00", "16:00");
    expect(isCovered(shift.startsAt, shift.endsAt, [a, b])).toBe(true);
    const outside = intervalInstants("2026-11-16", "17:00", "20:00");
    expect(isCovered(outside.startsAt, outside.endsAt, [a, b])).toBe(false);
  });

  it("computes completion percentage safely", () => {
    expect(completionPercent(3, 4)).toBe(75);
    expect(completionPercent(0, 0)).toBe(0);
  });

  it("formats an overnight window in Rome time", () => {
    const w = intervalInstants("2026-11-16", "18:00", "01:00");
    expect(formatWindow(w.startsAt, w.endsAt)).toBe("18:00–01:00");
  });

  it("labels week ranges per language", () => {
    expect(weekRangeLabel("2026-11-16", "it")).toBe("16–22 novembre");
    expect(weekRangeLabel("2026-11-16", "en")).toBe("16–22 November");
    expect(weekRangeLabel("2026-11-30", "en")).toBe("30 November – 6 December");
  });
});

describe("notification rendering", () => {
  it("every notification type has a title and body in both languages", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(it_.notifications.types).toHaveProperty(type);
      expect(en.notifications.types).toHaveProperty(type);
    }
  });

  it("renders in the reader's language with real values", () => {
    const params = { week_start: WEEK, employee_name: "Marco Rossi", count: 2, deadline: "2026-11-13T19:00:00Z" };
    const it = renderNotification("it", "availability_submitted", params);
    const e = renderNotification("en", "availability_submitted", params);
    expect(it.body).toContain("Marco Rossi");
    expect(it.body).toContain("16–22 novembre");
    expect(e.body).toContain("16–22 November");
    expect(renderNotification("en", "availability_missing", params).body).toContain("2 employees have");
    expect(renderNotification("it", "availability_requested", params).body).toContain("20:00"); // 19:00Z = 20:00 Rome
  });
});
