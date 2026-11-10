import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { analyzeWeek, type ShiftIn } from "@/lib/scheduling/analysis";
import { romeInstant } from "@/lib/time/rome";
import { asUser, createTestDb, ids } from "./helpers/db";

const sh = (id: string, emp: string, day: string, from: string, to: string): ShiftIn => ({
  id, employeeId: emp, startsAt: romeInstant(day, from), endsAt: romeInstant(day, to), override: false,
});
const base = { weekStart: "2030-07-01", employeeIds: ["a", "b"], windows: [], submittedEmployeeIds: new Set<string>(), requestExists: false };

describe("minimum staffing per day", () => {
  it("flags every day below the minimum, with the count", () => {
    const shifts = [sh("1", "a", "2030-07-01", "10:00", "14:00"), sh("2", "b", "2030-07-01", "10:00", "14:00"), sh("3", "a", "2030-07-02", "10:00", "14:00")];
    const w = analyzeWeek({ ...base, shifts, rules: { minStaffPerDay: 2 } }).warnings.filter((x) => x.type === "understaffed");
    expect(w).toHaveLength(6); // all days but Monday
    expect(w).toContainEqual({ type: "understaffed", employeeId: "", day: "2030-07-02", count: 1, min: 2 });
    expect(w.some((x) => x.type === "understaffed" && x.day === "2030-07-01")).toBe(false);
  });

  it("is off by default", () => {
    expect(analyzeWeek({ ...base, shifts: [], rules: {} }).warnings.some((w) => w.type === "understaffed")).toBe(false);
  });
});

describe("saving rules (database)", () => {
  let db: PGlite;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
  const save = (uid: string, rules: unknown) => asUser(db, uid, () => q<{ r: Record<string, unknown> }>(`select public.save_scheduling_rules($1::jsonb) as r`, [JSON.stringify(rules)]));
  beforeAll(async () => { db = await createTestDb(); }, 60_000);
  afterAll(async () => db.close());

  it("ships with no hour limits at all and staffing off", async () => {
    const v = (await q<{ value: Record<string, unknown> }>(`select value from public.app_settings where key = 'scheduling_rules'`))[0].value;
    expect(v).toMatchObject({ min_staff_per_day: null });
    for (const gone of ["rest_min_hours", "weekly_hours_warning", "long_shift_warning_hours"]) expect(v).not.toHaveProperty(gone);
  });

  it("lets admins change the rule and audits it", async () => {
    const r = (await save(ids.stefano, { min_staff_per_day: 2 }))[0].r;
    expect(r).toMatchObject({ min_staff_per_day: 2, legal_limits_enabled: false });
    expect(await q(`select 1 from public.audit_logs where action = 'settings.rules_changed'`)).toHaveLength(1);
  });

  it("rejects employees, invalid values and the removed rules", async () => {
    await expect(save(ids.marco, { min_staff_per_day: 2 })).rejects.toThrow(/forbidden/);
    await expect(save(ids.stefano, { min_staff_per_day: 0 })).rejects.toThrow(/invalid_input/);
    await expect(save(ids.stefano, { min_staff_per_day: 99 })).rejects.toThrow(/invalid_input/);
    await expect(save(ids.stefano, [])).rejects.toThrow(/invalid_input/);
    const r = (await save(ids.stefano, { rest_min_hours: 11, weekly_hours_warning: 40, evil: 1 }))[0].r;
    for (const k of ["rest_min_hours", "weekly_hours_warning", "evil"]) expect(r).not.toHaveProperty(k);
  });
});
