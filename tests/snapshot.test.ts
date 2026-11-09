import { describe, expect, it } from "vitest";
import { diffSnapshots, groupByDay, hoursByEmployee, type SnapshotShift } from "@/lib/scheduling/snapshot";
import { renderNotification } from "@/lib/notifications/render";
import { weekDays } from "@/lib/time/rome";

const sh = (id: string, emp: string, name: string, start: string, end: string): SnapshotShift => ({
  shift_id: id, employee_id: emp, employee_name: name, color: "#234A49", position: null, starts_at: start, ends_at: end,
});
const WEEK = "2026-11-16";

describe("published snapshots", () => {
  const shifts = [
    sh("1", "m", "Marco", "2026-11-16T08:00:00Z", "2026-11-16T14:00:00Z"),
    sh("2", "l", "Luca", "2026-11-16T14:00:00Z", "2026-11-16T22:00:00Z"),
    sh("3", "m", "Marco", "2026-11-17T17:00:00Z", "2026-11-18T00:00:00Z"), // 18:00–01:00 Rome, starts on Tuesday
  ];

  it("groups shifts by Rome day, sorted by start time, with all seven days present", () => {
    const g = groupByDay(shifts, weekDays(WEEK));
    expect(Object.keys(g)).toHaveLength(7);
    expect(g["2026-11-16"].map((s) => s.employee_name)).toEqual(["Marco", "Luca"]);
    expect(g["2026-11-17"].map((s) => s.shift_id)).toEqual(["3"]);
    expect(g["2026-11-18"]).toEqual([]);
  });

  it("totals real hours per employee", () => {
    expect(hoursByEmployee(shifts)).toEqual([{ id: "l", name: "Luca", hours: 8 }, { id: "m", name: "Marco", hours: 13 }]);
  });

  it("describes what changed between versions", () => {
    const next = [shifts[0], sh("2", "l", "Luca", "2026-11-16T15:00:00Z", "2026-11-16T22:00:00Z"), sh("4", "g", "Giulia", "2026-11-19T08:00:00Z", "2026-11-19T12:00:00Z")];
    expect(diffSnapshots(shifts, next)).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(diffSnapshots(shifts, shifts)).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("renders publication notifications in both languages", () => {
    const p = { week_start: WEEK, version: 2 };
    expect(renderNotification("it", "schedule_updated", p).body).toContain("16–22 novembre");
    expect(renderNotification("it", "schedule_updated", p).body).toContain("versione 2");
    expect(renderNotification("en", "schedule_published", p).title).toBe("Schedule published");
    expect(renderNotification("en", "schedule_publish_confirmed", p).body).toContain("version 2");
  });
});
