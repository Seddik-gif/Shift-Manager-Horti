import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

// far in the future so "in the past" never triggers; no availability request exists for these weeks
const D1 = "2030-03-12";
const D2 = "2030-03-13";

let openId: string;
let takeId: string;
let offerId: string;

beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("only admins manage shifts", () => {
  it("employees cannot create, change or delete shifts or open shifts directly or via functions", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.save_shift(null, $1, $2, '10:00', '14:00', '', '', false, '')`, [ids.marco, D1])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select public.create_open_shift($1, '10:00', '14:00', '', '', 1)`, [D1])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select public.decide_shift_request(gen_random_uuid(), true, '')`)), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`insert into public.open_shifts (starts_at, ends_at, created_by) values (now(), now() + interval '1 hour', $1)`, [ids.marco])), /permission denied/);
    await failsWith(() => as(ids.marco, () => q(`insert into public.shift_requests (employee_id, kind, starts_at, ends_at, status) values ($1, 'offer', now(), now() + interval '1 hour', 'approved')`, [ids.marco])), /permission denied/);
  });
});

describe("live calendar for employees", () => {
  it("shows the same shifts to employees at once (names, colours, times) without private details", async () => {
    await as(ids.stefano, () => q(`select public.save_shift(null, $1, $2, '10:00', '18:00', 'Bar', 'PRIVATE NOTE', false, '')`, [ids.giulia, D1]));
    const rows = await as(ids.marco, () => q<Record<string, unknown>>(`select * from public.team_shifts`));
    expect(rows).toHaveLength(1);
    expect(rows[0].employee_name).toBe("Giulia Test");
    expect(Object.keys(rows[0])).not.toContain("notes");
    expect(await as(ids.marco, () => q(`select 1 from public.shifts`))).toHaveLength(0); // base table stays admin-only
  });

  it("bumps the week pulse and collects shift changes instead of notifying (see db-shift-notices.test.ts)", async () => {
    expect(await q(`select 1 from public.schedule_pulse`)).toHaveLength(1);
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'shift_assigned'`, [ids.giulia])).toHaveLength(0);
    expect(await q(`select kind from public.pending_shift_notices where employee_id = $1`, [ids.giulia])).toEqual([{ kind: "assigned" }]);
    const [{ id }] = await q<{ id: string }>(`select id from public.shifts`);
    await as(ids.stefano, () => q(`select public.save_shift($1, $2, $3, '11:00', '19:00', 'Bar', '', false, '')`, [id, ids.giulia, D1]));
    await as(ids.stefano, () => q(`select public.delete_shift($1)`, [id])); // never announced, so nothing is left to announce
    expect(await q(`select 1 from public.pending_shift_notices`)).toHaveLength(0);
    expect(await as(ids.marco, () => q(`select 1 from public.team_shifts`))).toHaveLength(0);
  });
});

describe("open shifts and requests (admin confirms)", () => {
  it("an admin posts an open shift; every employee is told and can see it", async () => {
    openId = (await as(ids.stefano, () => q<{ id: string }>(`select public.create_open_shift($1, '18:00', '02:00', 'Bar', 'Saturday rush', 1) as id`, [D1])))[0].id;
    expect(await q(`select 1 from public.notifications where type = 'open_shift_posted'`)).toHaveLength(2);
    expect(await as(ids.marco, () => q(`select 1 from public.open_shifts`))).toHaveLength(1);
    await failsWith(() => as(ids.stefano, () => q(`select public.create_open_shift($1, '05:00', '10:00', '', '', 1)`, [D1])), /outside_hours/);
  });

  it("an employee can request it, but that does not create a shift; admins are notified", async () => {
    takeId = (await as(ids.marco, () => q<{ id: string }>(`select public.request_open_shift($1, 'I can do it') as id`, [openId])))[0].id;
    expect(await q(`select 1 from public.shifts`)).toHaveLength(0);
    expect((await q(`select 1 from public.notifications where type = 'shift_request_received'`)).length).toBe(2);
    await failsWith(() => as(ids.marco, () => q(`select public.request_open_shift($1, '')`, [openId])), /already_requested/);
    // employees only see their own requests
    expect(await as(ids.giulia, () => q(`select 1 from public.shift_requests`))).toHaveLength(0);
    expect(await as(ids.marco, () => q(`select 1 from public.shift_requests`))).toHaveLength(1);
  });

  it("an employee can also offer a time, which waits for an admin", async () => {
    offerId = (await as(ids.giulia, () => q<{ id: string }>(`select public.offer_shift($1, '12:00', '20:00', 'free that day') as id`, [D2])))[0].id;
    await failsWith(() => as(ids.giulia, () => q(`select public.offer_shift($1, '12:00', '20:00', '')`, [D2])), /already_requested/);
    await failsWith(() => as(ids.giulia, () => q(`select public.offer_shift($1, '03:00', '06:00', '')`, [D2])), /outside_hours/);
    await failsWith(() => as(ids.giulia, () => q(`select public.offer_shift('2020-01-01', '10:00', '12:00', '')`)), /in_the_past/);
    expect(await q(`select 1 from public.shifts`)).toHaveLength(0);
  });

  it("approving creates the real shift, fills the open shift and tells the employee", async () => {
    await as(ids.tessa, () => q(`select public.decide_shift_request($1, true, 'welcome')`, [takeId]));
    const [s] = await q<{ employee_id: string; len: number }>(`select employee_id, extract(epoch from ends_at - starts_at)/3600 as len from public.shifts`);
    expect(s.employee_id).toBe(ids.marco);
    expect(Number(s.len)).toBe(8);
    expect((await q<{ status: string }>(`select status from public.open_shifts`))[0].status).toBe("filled");
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'shift_request_approved'`, [ids.marco])).toHaveLength(1);
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'shift_assigned'`, [ids.marco])).toHaveLength(0); // quiet: the approval message replaces it
    expect(await as(ids.giulia, () => q(`select 1 from public.open_shifts`))).toHaveLength(0); // no longer open
    expect(await q(`select 1 from public.audit_logs where action = 'shift_request.approved'`)).toHaveLength(1);
    await failsWith(() => as(ids.stefano, () => q(`select public.decide_shift_request($1, true, '')`, [takeId])), /already_decided/);
  });

  it("an admin can refuse an offer, and the employee is told", async () => {
    await as(ids.stefano, () => q(`select public.decide_shift_request($1, false, 'enough staff')`, [offerId]));
    expect((await q<{ status: string; decision_note: string }>(`select status, decision_note from public.shift_requests where id = $1`, [offerId]))[0]).toEqual({ status: "rejected", decision_note: "enough staff" });
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'shift_request_rejected'`, [ids.giulia])).toHaveLength(1);
  });

  it("approving an offer creates a shift; overlaps with an existing shift are blocked", async () => {
    const o2 = (await as(ids.giulia, () => q<{ id: string }>(`select public.offer_shift($1, '12:00', '20:00', '') as id`, [D2])))[0].id;
    await as(ids.stefano, () => q(`select public.decide_shift_request($1, true, '')`, [o2]));
    expect(await q(`select 1 from public.shifts where employee_id = $1`, [ids.giulia])).toHaveLength(1);
    await failsWith(() => as(ids.giulia, () => q(`select public.offer_shift($1, '15:00', '22:00', '')`, [D2])), /overlap/);
  });

  it("employees can withdraw their own pending request, and cancelling an open shift rejects pending takes", async () => {
    const open2 = (await as(ids.stefano, () => q<{ id: string }>(`select public.create_open_shift('2030-03-14', '10:00', '16:00', '', '', 2) as id`)))[0].id;
    const r1 = (await as(ids.giulia, () => q<{ id: string }>(`select public.request_open_shift($1, '') as id`, [open2])))[0].id;
    await as(ids.giulia, () => q(`select public.withdraw_shift_request($1)`, [r1]));
    expect((await q<{ status: string }>(`select status from public.shift_requests where id = $1`, [r1]))[0].status).toBe("cancelled");
    await failsWith(() => as(ids.marco, () => q(`select public.withdraw_shift_request($1)`, [r1])), /not_found/);

    await as(ids.marco, () => q(`select public.request_open_shift($1, '')`, [open2]));
    await as(ids.stefano, () => q(`select public.cancel_open_shift($1)`, [open2]));
    expect(await q(`select 1 from public.shift_requests where open_shift_id = $1 and status = 'rejected'`, [open2])).toHaveLength(1);
  });
});
