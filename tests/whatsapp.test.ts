import { describe, expect, it } from "vitest";
import { buildWeeklyMessage } from "@/lib/whatsapp/message";
import type { Snapshot, SnapshotShift } from "@/lib/scheduling/snapshot";

const sh = (id: string, emp: string, name: string, start: string, end: string): SnapshotShift => ({
  shift_id: id, employee_id: emp, employee_name: name, color: "#000", position: "Bar", starts_at: start, ends_at: end,
});
// Nov 2026: Rome is UTC+1
const snap: Snapshot = {
  week_start: "2026-11-16",
  shifts: [
    sh("1", "m", "Marco Rossi", "2026-11-16T08:00:00Z", "2026-11-16T14:00:00Z"), // 09:00–15:00
    sh("2", "l", "Luca Verdi", "2026-11-16T14:00:00Z", "2026-11-16T22:00:00Z"), // 15:00–23:00
    sh("3", "g", "Giulia Bianchi", "2026-11-17T09:00:00Z", "2026-11-17T15:00:00Z"), // 10:00–16:00
    sh("4", "m", "Marco Rossi", "2026-11-17T16:00:00Z", "2026-11-17T22:00:00Z"), // 17:00–23:00
    sh("5", "l", "Luca Verdi", "2026-11-20T17:00:00Z", "2026-11-21T00:00:00Z"), // 18:00–01:00
  ],
};

describe("WhatsApp weekly message", () => {
  const msgEn = buildWeeklyMessage(snap, "en");
  const msgIt = buildWeeklyMessage(snap, "it");

  it("starts with the header and the correct date range", () => {
    expect(msgEn.split("\n").slice(0, 3)).toEqual(["HORTI MAGICI", "WEEKLY STAFF SCHEDULE", "16–22 NOVEMBER"]);
    expect(msgIt.split("\n").slice(0, 3)).toEqual(["HORTI MAGICI", "PROGRAMMA SETTIMANALE STAFF", "16–22 NOVEMBRE"]);
  });

  it("lists all seven days in order, Monday first, in the chosen language", () => {
    const days = msgEn.split("\n").filter((l) => /^[A-Z]+DAY$/.test(l));
    expect(days).toEqual(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
    expect(msgIt.split("\n").filter((l) => /^[A-ZÌ]+DÌ$|^DOMENICA$|^SABATO$/.test(l))).toEqual(["LUNEDÌ", "MARTEDÌ", "MERCOLEDÌ", "GIOVEDÌ", "VENERDÌ", "SABATO", "DOMENICA"]);
  });

  it("shows each shift as 'HH:mm–HH:mm | Name' in Rome time, sorted by start", () => {
    expect(msgEn).toContain("MONDAY\n09:00–15:00 | Marco\n15:00–23:00 | Luca\n");
    expect(msgEn).toContain("TUESDAY\n10:00–16:00 | Giulia\n17:00–23:00 | Marco\n");
  });

  it("handles overnight shifts and shows days without shifts", () => {
    expect(msgEn).toContain("FRIDAY\n18:00–01:00 | Luca");
    expect(msgEn).toContain("WEDNESDAY\n—\n");
  });

  it("appends total hours per employee", () => {
    expect(msgEn).toContain("TOTAL HOURS\nGiulia: 6h\nLuca: 15h\nMarco: 12h");
    expect(msgIt).toContain("ORE TOTALI");
  });

  it("disambiguates employees who share a first name", () => {
    const m = buildWeeklyMessage({ week_start: "2026-11-16", shifts: [
      sh("1", "a", "Marco Rossi", "2026-11-16T08:00:00Z", "2026-11-16T12:00:00Z"),
      sh("2", "b", "Marco Bianchi", "2026-11-17T08:00:00Z", "2026-11-17T12:00:00Z"),
    ] }, "en");
    expect(m).toContain("| Marco R.");
    expect(m).toContain("| Marco B.");
  });

  it("formats a week that spans two months", () => {
    expect(buildWeeklyMessage({ week_start: "2026-11-30", shifts: [] }, "en").split("\n")[2]).toBe("30 NOVEMBER – 6 DECEMBER");
  });
});
