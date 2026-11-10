import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

type SaveResult = { ok: boolean; id?: string; warning?: string; warnings?: { type: string }[] };
const save = (uid: string, a: { id?: string | null; emp: string; day: string; s: string; e: string; override?: boolean; note?: string }) =>
  as(uid, () =>
    q<{ r: SaveResult }>(`select public.save_shift($1, $2, $3, $4, $5, 'Bar', '', $6, $7) as r`, [a.id ?? null, a.emp, a.day, a.s, a.e, a.override ?? false, a.note ?? ""]),
  ).then((rows) => rows[0].r);

const week = (overrides: Record<string, unknown>) =>
  JSON.stringify(Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10);
    return { day, available: false, note: "", windows: [], ...(overrides[day] as object) };
  }));

let shiftId: string;

beforeAll(async () => {
  db = await createTestDb();
  // Week of 16 Nov is requested; Marco submitted, Giulia did not. 7 Dec has no request at all.
  const [{ id }] = await as(ids.stefano, () => q<{ id: string }>(`select public.create_availability_request('2026-11-16', now() + interval '3 days', '', true) as id`));
  await as(ids.marco, () => q(`select public.save_availability($1, $2::jsonb, '', true)`, [id, week({
    "2026-11-16": { available: true, windows: [{ start: "09:00", end: "14:30" }, { start: "18:00", end: "23:30" }] },
    "2026-11-20": { available: true, windows: [{ start: "17:00", end: "00:00" }] },
    "2026-11-21": { available: true, windows: [{ start: "18:00", end: "01:00" }] },
  })]));
}, 60_000);
afterAll(async () => db.close());

describe("shift management", () => {
  it("only admins can manage shifts", async () => {
    await failsWith(() => save(ids.marco, { emp: ids.marco, day: "2026-11-20", s: "17:00", e: "23:00" }), /forbidden/);
  });

  it("creates a shift inside the submitted availability (overnight end allowed) without a warning", async () => {
    const r = await save(ids.stefano, { emp: ids.marco, day: "2026-11-20", s: "17:00", e: "00:00" });
    expect(r.ok).toBe(true);
    shiftId = r.id as string;
    const [row] = await q<{ len: number; status: string }>(
      `select extract(epoch from ends_at - starts_at)/3600 as len, w.status from public.shifts s join public.weekly_schedules w on w.id = s.schedule_id where s.id = $1`, [shiftId]);
    expect(Number(row.len)).toBe(7);
    expect(row.status).toBe("draft");
  });

  it("requires an acknowledgement when a shift is outside availability, and audits the override", async () => {
    expect(await save(ids.stefano, { emp: ids.marco, day: "2026-11-18", s: "10:00", e: "14:00" })).toEqual({ ok: false, warning: "outside" });
    expect(await q(`select 1 from public.shifts where starts_at = '2026-11-18T09:00:00Z'`)).toHaveLength(0);
    expect((await save(ids.stefano, { emp: ids.marco, day: "2026-11-18", s: "10:00", e: "14:00", override: true, note: "covering" })).ok).toBe(true);
    const [log] = await q<{ changes: { reason: string; note: string } }>(`select changes from public.audit_logs where action = 'shift.availability_override'`);
    expect(log.changes).toMatchObject({ reason: "outside", note: "covering" });
  });

  it("warns when the employee has not submitted for a requested week, but not when no request exists", async () => {
    expect(await save(ids.stefano, { emp: ids.giulia, day: "2026-11-17", s: "10:00", e: "14:00" })).toEqual({ ok: false, warning: "no_submission" });
    const free = await save(ids.stefano, { emp: ids.giulia, day: "2026-12-09", s: "10:00", e: "22:00" });
    expect(free.ok).toBe(true);
    expect(free.warnings ?? []).toEqual([]); // shift length is not limited
  });

  it("accepts a shift covered by the submitted window", async () => {
    const r = await save(ids.stefano, { emp: ids.marco, day: "2026-11-16", s: "10:00", e: "14:00" });
    expect(r.ok).toBe(true);
  });

  it("prevents overlapping shifts for the same employee", async () => {
    await failsWith(() => save(ids.stefano, { emp: ids.marco, day: "2026-11-20", s: "22:00", e: "02:00", override: true }), /overlap/);
  });

  it("moves a shift and records before/after in the audit log", async () => {
    expect((await save(ids.tessa, { id: shiftId, emp: ids.marco, day: "2026-11-21", s: "18:00", e: "01:00" })).ok).toBe(true);
    const [log] = await q<{ changes: { from: { starts_at: string }; to: { starts_at: string } } }>(`select changes from public.audit_logs where action = 'shift.updated' and entity_id = $1`, [shiftId]);
    expect(log.changes.from.starts_at).not.toEqual(log.changes.to.starts_at);
  });

  it("flags a published week as modified (once), notifies both admins, and leaves employees' view alone", async () => {
    await db.query(`update public.weekly_schedules set status = 'published', current_version = 1 where week_start = '2026-11-16'`);
    await save(ids.stefano, { id: shiftId, emp: ids.marco, day: "2026-11-21", s: "19:00", e: "01:00" });
    await save(ids.stefano, { id: shiftId, emp: ids.marco, day: "2026-11-21", s: "18:00", e: "01:00" });
    const [w] = await q<{ has_unpublished_changes: boolean }>(`select has_unpublished_changes from public.weekly_schedules where week_start = '2026-11-16'`);
    expect(w.has_unpublished_changes).toBe(true);
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'schedule_modified'`);
    expect(n.map((x) => x.user_id).sort()).toEqual([ids.stefano, ids.tessa].sort());
    expect(await as(ids.marco, () => q(`select 1 from public.shifts`))).toHaveLength(0);
  });

  it("deletes shifts (admin only) with an audit entry", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.delete_shift($1)`, [shiftId])), /forbidden/);
    await as(ids.stefano, () => q(`select public.delete_shift($1)`, [shiftId]));
    expect(await q(`select 1 from public.shifts where id = $1`, [shiftId])).toHaveLength(0);
    expect(await q(`select 1 from public.audit_logs where action = 'shift.deleted' and entity_id = $1`, [shiftId])).toHaveLength(1);
  });
});
