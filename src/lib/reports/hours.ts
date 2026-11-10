/** Pure hour-report maths, so the page, the Excel file and the tests all agree. */

export interface ReportShift { id: string; employeeId: string; locationId: string; startsAt: string; endsAt: string; position: string }
export interface ReportPerson { id: string; name: string }
export interface ReportPlace { id: string; name: string }

export interface PersonRow {
  employeeId: string;
  name: string;
  shifts: number;
  hours: number;
  /** hours per location id */
  byLocation: Record<string, number>;
}
export interface HoursReport {
  rows: PersonRow[];
  totals: { shifts: number; hours: number; byLocation: Record<string, number> };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Length of one shift in hours (2 decimals). */
export function shiftHours(startsAt: string, endsAt: string): number {
  return round2((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000);
}

/** One row per person (people with no shifts are listed with zeros), sorted by name, plus totals. */
export function summarizeHours(shifts: ReportShift[], people: ReportPerson[], places: ReportPlace[]): HoursReport {
  const rows = new Map<string, PersonRow>();
  for (const p of people) rows.set(p.id, { employeeId: p.id, name: p.name, shifts: 0, hours: 0, byLocation: Object.fromEntries(places.map((l) => [l.id, 0])) });
  for (const s of shifts) {
    const row = rows.get(s.employeeId);
    if (!row) continue; // someone no longer in the list: leave them out rather than guess a name
    const h = shiftHours(s.startsAt, s.endsAt);
    row.shifts += 1;
    row.hours = round2(row.hours + h);
    row.byLocation[s.locationId] = round2((row.byLocation[s.locationId] ?? 0) + h);
  }
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const byLocation = Object.fromEntries(places.map((l) => [l.id, round2(list.reduce((n, r) => n + (r.byLocation[l.id] ?? 0), 0))]));
  return { rows: list, totals: { shifts: list.reduce((n, r) => n + r.shifts, 0), hours: round2(list.reduce((n, r) => n + r.hours, 0)), byLocation } };
}
