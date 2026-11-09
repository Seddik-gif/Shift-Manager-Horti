import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeWeek, parseRules, type ShiftIn, type WeekAnalysis } from "./analysis";
import { addDays, romeInstant } from "@/lib/time/rome";

export interface WeekEmployee { id: string; first_name: string; last_name: string; color: string; job_position: string | null; is_active: boolean }
export interface WeekShift {
  id: string; employee_id: string; starts_at: string; ends_at: string;
  job_position: string | null; notes: string | null; availability_override: boolean;
}
export type ScheduleStatus = "none" | "draft" | "published" | "publishedChanges";

export interface WeekData {
  employees: WeekEmployee[];
  shifts: WeekShift[];
  analysis: WeekAnalysis;
  status: ScheduleStatus;
  version: number;
  error: boolean;
}

/** Loads one week (shifts, availability, rules) as the signed-in admin and analyses it. */
export async function loadWeek(supabase: SupabaseClient, weekStart: string): Promise<WeekData> {
  const start = romeInstant(weekStart, "00:00").toISOString();
  const end = romeInstant(addDays(weekStart, 7), "00:00").toISOString();

  const [emps, shifts, sched, req, rules] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, color, job_position, is_active").eq("role", "employee").order("first_name").returns<WeekEmployee[]>(),
    supabase.from("shifts")
      .select("id, employee_id, starts_at, ends_at, job_position, notes, availability_override")
      .gte("starts_at", start).lt("starts_at", end).order("starts_at").returns<WeekShift[]>(),
    supabase.from("weekly_schedules").select("status, current_version, has_unpublished_changes").eq("week_start", weekStart)
      .maybeSingle<{ status: "draft" | "published"; current_version: number; has_unpublished_changes: boolean }>(),
    supabase.from("availability_requests").select("id").eq("week_start", weekStart).neq("status", "draft").maybeSingle<{ id: string }>(),
    supabase.from("app_settings").select("value").eq("key", "scheduling_rules").maybeSingle<{ value: unknown }>(),
  ]);

  const [submitted, wins] = await Promise.all([
    req.data
      ? supabase.from("availability_submissions").select("employee_id").eq("request_id", req.data.id).eq("status", "submitted").returns<{ employee_id: string }[]>()
      : Promise.resolve({ data: [] as { employee_id: string }[] }),
    supabase.from("availability_time_windows")
      .select("starts_at, ends_at, availability_submissions!inner(employee_id, status)")
      .eq("availability_submissions.status", "submitted")
      .gte("ends_at", romeInstant(addDays(weekStart, -1), "00:00").toISOString())
      .lt("starts_at", romeInstant(addDays(weekStart, 8), "00:00").toISOString())
      .returns<{ starts_at: string; ends_at: string; availability_submissions: { employee_id: string } }[]>(),
  ]);

  const employees = emps.data ?? [];
  const list = shifts.data ?? [];
  const shiftsIn: ShiftIn[] = list.map((s) => ({
    id: s.id, employeeId: s.employee_id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), override: s.availability_override,
  }));
  const analysis = analyzeWeek({
    weekStart, shifts: shiftsIn, employeeIds: employees.filter((e) => e.is_active).map((e) => e.id),
    windows: (wins.data ?? []).map((w) => ({ employeeId: w.availability_submissions.employee_id, startsAt: new Date(w.starts_at), endsAt: new Date(w.ends_at) })),
    submittedEmployeeIds: new Set((submitted.data ?? []).map((s) => s.employee_id)),
    requestExists: !!req.data,
    rules: parseRules((rules.data as { value: unknown } | null)?.value),
  });

  const s = sched.data;
  const status: ScheduleStatus = !s ? "none" : s.status === "published" ? (s.has_unpublished_changes ? "publishedChanges" : "published") : "draft";
  return { employees, shifts: list, analysis, status, version: s?.current_version ?? 0, error: !!shifts.error };
}
