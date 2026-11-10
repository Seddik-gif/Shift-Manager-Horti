import { describe, expect, it } from "vitest";
import { shiftHours, summarizeHours } from "@/lib/reports/hours";
import { buildIcs, escapeText, foldLine } from "@/lib/calendar/ics";

const people = [{ id: "m", name: "Marco Rossi" }, { id: "g", name: "Giulia Bianchi" }, { id: "x", name: "Zero Shifts" }];
const places = [{ id: "lido", name: "Lido" }, { id: "porto", name: "Porto" }];
const sh = (id: string, emp: string, loc: string, s: string, e: string) => ({ id, employeeId: emp, locationId: loc, startsAt: s, endsAt: e, position: "" });

describe("hour report", () => {
  it("measures a shift in hours, including over midnight and half hours", () => {
    expect(shiftHours("2030-03-12T17:00:00Z", "2030-03-12T21:30:00Z")).toBe(4.5);
    expect(shiftHours("2030-03-12T21:00:00Z", "2030-03-13T01:00:00Z")).toBe(4);
  });

  it("adds hours per person and per bar, lists people with no shifts, and totals everything", () => {
    const r = summarizeHours([
      sh("1", "m", "lido", "2030-03-12T10:00:00Z", "2030-03-12T14:00:00Z"),
      sh("2", "m", "porto", "2030-03-13T10:00:00Z", "2030-03-13T12:30:00Z"),
      sh("3", "g", "lido", "2030-03-12T16:00:00Z", "2030-03-12T20:00:00Z"),
    ], people, places);
    expect(r.rows.map((x) => x.name)).toEqual(["Giulia Bianchi", "Marco Rossi", "Zero Shifts"]);
    const marco = r.rows.find((x) => x.employeeId === "m")!;
    expect(marco).toMatchObject({ shifts: 2, hours: 6.5, byLocation: { lido: 4, porto: 2.5 } });
    expect(r.rows.find((x) => x.employeeId === "x")).toMatchObject({ shifts: 0, hours: 0 });
    expect(r.totals).toEqual({ shifts: 3, hours: 10.5, byLocation: { lido: 8, porto: 2.5 } });
  });

  it("ignores shifts of people who are not in the list", () => {
    const r = summarizeHours([sh("1", "ghost", "lido", "2030-03-12T10:00:00Z", "2030-03-12T14:00:00Z")], people, places);
    expect(r.totals.shifts).toBe(0);
  });
});

describe("calendar file (.ics)", () => {
  it("escapes the characters that have a meaning in iCalendar", () => {
    expect(escapeText("Bar; Lido, sera\nnuovo \\ ok")).toBe("Bar\\; Lido\\, sera\\nnuovo \\\\ ok");
  });

  it("folds long lines at 75 bytes without splitting a character", () => {
    const folded = foldLine("SUMMARY:" + "è".repeat(60));
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "è".repeat(60));
  });

  it("writes a valid calendar with stable ids and UTC times", () => {
    const ics = buildIcs([{ uid: "shift-1@horti-magici", start: new Date("2030-03-12T17:00:00Z"), end: new Date("2030-03-13T01:00:00Z"), summary: "Horti Magici – Lido", location: "Lido", description: "Ruolo: Bar" }], "Turni", new Date("2030-01-01T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:shift-1@horti-magici");
    expect(ics).toContain("DTSTART:20300312T170000Z");
    expect(ics).toContain("DTEND:20300313T010000Z");
    expect(ics).toContain("LOCATION:Lido");
    expect(ics).not.toMatch(/[^\r]\n/); // every line break is CRLF
  });

  it("an empty list is still a valid calendar", () => {
    expect(buildIcs([], "Turni")).toContain("BEGIN:VCALENDAR");
  });
});
