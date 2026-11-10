import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const request = (uid: string, kind: string, from: string, to: string, reason = "") =>
  as(uid, () => q<{ id: string }>(`select public.request_absence($1, $2, $3, $4) as id`, [kind, from, to, reason]));
const decide = (id: string, approve: boolean, note = "") =>
  as(ids.stefano, () => q<{ r: { ok: boolean; conflicts: number } }>(`select public.decide_absence($1, $2, $3) as r`, [id, approve, note]));
const shift = (emp: string, day: string, start = "10:00", end = "14:00", override = false) =>
  as(ids.stefano, () => q<{ r: { ok: boolean; warning?: string } }>(`select public.save_shift(null, $1, $2, $3, $4, '', '', $5, 'ack') as r`, [emp, day, start, end, override]));

beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("requesting an absence", () => {
  it("lets an employee ask and tells the admins", async () => {
    const id = (await request(ids.marco, "ferie", "2030-07-01", "2030-07-05", "mare"))[0].id;
    const row = (await as(ids.marco, () => q<{ status: string }>(`select status from public.absence_requests where id = $1`, [id])))[0];
    expect(row.status).toBe("pending");
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'absence_requested'`);
    expect(n.map((r) => r.user_id).sort()).toEqual([ids.stefano, ids.tessa].sort());
  });

  it("keeps requests private between employees but visible to admins", async () => {
    expect(await as(ids.giulia, () => q(`select 1 from public.absence_requests`))).toHaveLength(0);
    expect((await as(ids.stefano, () => q(`select 1 from public.absence_requests`))).length).toBeGreaterThan(0);
  });

  it("validates input and refuses overlapping live absences", async () => {
    await failsWith(() => request(ids.marco, "holiday", "2030-08-01", "2030-08-02"), /invalid_input/);
    await failsWith(() => request(ids.marco, "ferie", "2030-08-05", "2030-08-01"), /invalid_input/);
    await failsWith(() => request(ids.marco, "ferie", "2030-01-01", "2030-12-31"), /invalid_input/);
    await failsWith(() => request(ids.marco, "ferie", "2030-07-04", "2030-07-08"), /absence_overlap/);
    await failsWith(() => request(ids.stefano, "ferie", "2030-09-01", "2030-09-02"), /forbidden/);
  });

  it("blocks direct writes and lets employees withdraw only their own pending requests", async () => {
    await failsWith(() => as(ids.marco, () => q(`insert into public.absence_requests (employee_id, kind, start_date, end_date, status) values ($1, 'ferie', '2030-10-01', '2030-10-02', 'approved')`, [ids.marco])), /permission denied/);
    const id = (await request(ids.giulia, "assenza", "2030-10-10", "2030-10-10"))[0].id;
    await failsWith(() => as(ids.marco, () => q(`select public.withdraw_absence($1)`, [id])), /not_found/);
    await as(ids.giulia, () => q(`select public.withdraw_absence($1)`, [id]));
    // a withdrawn request frees the days again
    await request(ids.giulia, "assenza", "2030-10-10", "2030-10-10");
  });
});

describe("deciding", () => {
  it("only admins decide, once", async () => {
    const id = (await q<{ id: string }>(`select id from public.absence_requests where employee_id = $1 and status = 'pending' and kind = 'ferie'`, [ids.marco]))[0].id;
    await failsWith(() => as(ids.marco, () => q(`select public.decide_absence($1, true, '')`, [id])), /forbidden/);
    const res = (await decide(id, true, "buone ferie"))[0].r;
    expect(res).toEqual({ ok: true, conflicts: 0 });
    await failsWith(() => decide(id, false), /already_decided/);
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'absence_approved'`);
    expect(n.map((r) => r.user_id)).toEqual([ids.marco]);
  });

  it("reports shifts already planned inside a newly approved absence, without deleting them", async () => {
    await shift(ids.giulia, "2030-11-05");
    const id = (await request(ids.giulia, "assenza", "2030-11-04", "2030-11-06"))[0].id;
    expect((await decide(id, true))[0].r.conflicts).toBe(1);
    expect(await q(`select 1 from public.shifts where employee_id = $1 and starts_at::date >= '2030-11-04'`, [ids.giulia])).toHaveLength(1);
  });

  it("a rejected request has no effect on planning", async () => {
    const id = (await request(ids.giulia, "ferie", "2030-12-02", "2030-12-04"))[0].id;
    await decide(id, false, "periodo pieno");
    expect((await shift(ids.giulia, "2030-12-03"))[0].r.ok).toBe(true);
  });
});

describe("planning around an approved absence", () => {
  it("asks for acknowledgement, then allows and audits the override", async () => {
    const first = (await shift(ids.marco, "2030-07-03"))[0].r;
    expect(first).toMatchObject({ ok: false, warning: "absence" });
    const forced = (await shift(ids.marco, "2030-07-03", "10:00", "14:00", true))[0].r;
    expect(forced.ok).toBe(true);
    const audit = await q(`select 1 from public.audit_logs where action = 'shift.availability_override' and changes ->> 'reason' = 'absence'`);
    expect(audit).toHaveLength(1);
  });

  it("covers the overnight tail: a late shift ending after midnight into the absence day", async () => {
    const r = (await shift(ids.marco, "2030-06-30", "20:00", "01:00"))[0].r; // ends 1 Jul, absence starts 1 Jul
    expect(r).toMatchObject({ ok: false, warning: "absence" });
  });

  it("does not interfere with days outside the absence", async () => {
    expect((await shift(ids.marco, "2030-07-06"))[0].r.ok).toBe(true);
  });

  it("a cancelled future absence stops blocking", async () => {
    const id = (await q<{ id: string }>(`select id from public.absence_requests where employee_id = $1 and status = 'approved' and kind = 'ferie'`, [ids.marco]))[0].id;
    await as(ids.marco, () => q(`select public.withdraw_absence($1)`, [id]));
    expect((await shift(ids.marco, "2030-07-02"))[0].r.ok).toBe(true);
  });
});
