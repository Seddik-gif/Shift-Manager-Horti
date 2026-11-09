import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const week = () => JSON.stringify(Array.from({ length: 7 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 10, 23 + i)).toISOString().slice(0, 10), available: i === 0, note: "",
  windows: i === 0 ? [{ start: "10:00", end: "18:00" }] : [],
})));

let requestId: string;
let subId: string;

beforeAll(async () => {
  db = await createTestDb();
  requestId = (await as(ids.stefano, () => q<{ id: string }>(`select public.create_availability_request('2026-11-23', now() + interval '3 days', '', true) as id`)))[0].id;
  subId = (await as(ids.marco, () => q<{ id: string }>(`select public.save_availability($1, $2::jsonb, '', true) as id`, [requestId, week()])))[0].id;
}, 60_000);
afterAll(async () => db.close());

const reviewOf = async (id = subId) =>
  (await q<{ review_status: string; reviewed_by: string | null; review_note: string | null }>(`select review_status, reviewed_by, review_note from public.availability_submissions where id = $1`, [id]))[0];

describe("admin confirmation of availability", () => {
  it("a new submission waits for an admin (pending)", async () => {
    expect((await reviewOf()).review_status).toBe("pending");
  });

  it("employees cannot confirm anything themselves, by function or by direct update", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.review_availability($1, true, '')`, [subId])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`update public.availability_submissions set review_status = 'confirmed' where id = $1`, [subId])), /Only the application/);
    await failsWith(() => as(ids.marco, () => q(`update public.availability_submissions set status = 'draft' where id = $1`, [subId])), /Only the application/);
    await failsWith(() => as(ids.giulia, () => q(`insert into public.availability_submissions (request_id, employee_id, status) values ($1, $2, 'submitted')`, [requestId, ids.giulia])), /row-level security/);
  });

  it("an admin can request changes (a note is required) and the employee is told", async () => {
    await failsWith(() => as(ids.stefano, () => q(`select public.review_availability($1, false, '')`, [subId])), /note_required/);
    await as(ids.stefano, () => q(`select public.review_availability($1, false, 'Please add Saturday')`, [subId]));
    expect(await reviewOf()).toEqual({ review_status: "changes_requested", reviewed_by: ids.stefano, review_note: "Please add Saturday" });
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'availability_changes_requested'`, [ids.marco])).toHaveLength(1);
  });

  it("resubmitting puts it back to pending; then an admin confirms", async () => {
    await as(ids.marco, () => q(`select public.save_availability($1, $2::jsonb, 'fixed', true)`, [requestId, week()]));
    expect((await reviewOf()).review_status).toBe("pending");
    await as(ids.tessa, () => q(`select public.review_availability($1, true, '')`, [subId]));
    expect(await reviewOf()).toMatchObject({ review_status: "confirmed", reviewed_by: ids.tessa });
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'availability_review_confirmed'`, [ids.marco])).toHaveLength(1);
    expect(await q(`select 1 from public.audit_logs where action = 'availability.confirmed'`)).toHaveLength(1);
  });

  it("editing a confirmed submission makes it pending again", async () => {
    await as(ids.marco, () => q(`select public.save_availability($1, $2::jsonb, 'changed my mind', true)`, [requestId, week()]));
    expect((await reviewOf()).review_status).toBe("pending");
  });

  it("drafts cannot be reviewed", async () => {
    const draft = (await as(ids.giulia, () => q<{ id: string }>(`select public.save_availability($1, $2::jsonb, '', false) as id`, [requestId, week()])))[0].id;
    await failsWith(() => as(ids.stefano, () => q(`select public.review_availability($1, true, '')`, [draft])), /not_submitted/);
  });
});
