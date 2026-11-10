import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, romeInstant } from "@/lib/time/rome";
import { summarizeHours, type HoursReport, type ReportPerson, type ReportPlace, type ReportShift } from "./hours";

export interface LoadedReport {
  shifts: ReportShift[];
  people: ReportPerson[];
  places: ReportPlace[];
  summary: HoursReport;
}

interface ShiftRow { id: string; employee_id: string; starts_at: string; ends_at: string; job_position: string | null; weekly_schedules: { location_id: string } }

const PAGE = 1000; // the API returns at most 1000 rows per request

/**
 * Shifts that START between the two Rome days (inclusive), for one place or all of them. Runs as the signed-in user,
 * so only an admin gets anything back (row level security).
 */
export async function loadReport(supabase: SupabaseClient, from: string, to: string, locationId: string | null): Promise<LoadedReport> {
  const lo = romeInstant(from, "00:00").toISOString();
  const hi = romeInstant(addDays(to, 1), "00:00").toISOString();

  const [{ data: peopleRows }, { data: placeRows }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name").eq("role", "employee").eq("is_active", true).returns<{ id: string; first_name: string; last_name: string }[]>(),
    supabase.from("locations").select("id, name, sort_order").order("sort_order").returns<{ id: string; name: string }[]>(),
  ]);

  const shifts: ReportShift[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase.from("shifts")
      .select("id, employee_id, starts_at, ends_at, job_position, weekly_schedules!inner(location_id)")
      .gte("starts_at", lo).lt("starts_at", hi).order("starts_at").order("id").range(offset, offset + PAGE - 1);
    if (locationId) q = q.eq("weekly_schedules.location_id", locationId);
    const { data } = await q.returns<ShiftRow[]>();
    for (const s of data ?? []) {
      shifts.push({ id: s.id, employeeId: s.employee_id, locationId: s.weekly_schedules.location_id, startsAt: s.starts_at, endsAt: s.ends_at, position: s.job_position ?? "" });
    }
    if (!data || data.length < PAGE) break;
  }

  const people = (peopleRows ?? []).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim() }));
  const allPlaces = placeRows ?? [];
  const places = locationId ? allPlaces.filter((l) => l.id === locationId) : allPlaces;
  return { shifts, people, places, summary: summarizeHours(shifts, people, places) };
}
