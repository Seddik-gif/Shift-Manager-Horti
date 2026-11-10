import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const D1 = day(30), D2 = day(31);

const save = async (id: string | null, emp: string, d: string, s: string, e: string) =>
  (await as(ids.stefano, () => q<{ r: { id: string } }>(`select public.save_shift($1, $2, $3, $4, $5, '', '', true, 'test') as r`, [id, emp, d, s, e])))[0].r.id;
const pending = (emp: string) => q<{ kind: string }>(`select kind from public.pending_shift_notices where employee_id = $1 order by kind`, [emp]);
const shiftNotices = (emp?: string) => q(`select 1 from public.notifications where type = 'shifts_updated' ${emp ? "and user_id = $1" : ""}`, emp ? [emp] : []);

beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("shift changes are held back until the admin confirms", () => {
  it("creating, moving and deleting a shift tells nobody", async () => {
    const id = await save(null, ids.giulia, D1, "10:00", "14:00");
    expect(await pending(ids.giulia)).toEqual([{ kind: "assigned" }]);
    await save(id, ids.giulia, D1, "11:00", "15:00");
    expect(await pending(ids.giulia)).toEqual([{ kind: "assigned" }]); // still one notice, with the new times
    await as(ids.stefano, () => q(`select public.delete_shift($1)`, [id]));
    expect(await q(`select 1 from public.pending_shift_notices`)).toHaveLength(0); // created and deleted before anyone knew
    expect(await q(`select 1 from public.notifications where type in ('shift_assigned','shift_changed','shift_removed','shifts_updated')`)).toHaveLength(0);
  });

  it("moving a shift away and back leaves nothing to announce; removing one the employee knew about is announced", async () => {
    const id = await save(null, ids.giulia, D1, "10:00", "14:00");
    await as(ids.stefano, () => q(`select public.send_shift_updates()`)); // employee now knows this shift
    await save(id, ids.giulia, D1, "12:00", "16:00");
    expect(await pending(ids.giulia)).toEqual([{ kind: "changed" }]);
    await save(id, ids.giulia, D1, "10:00", "14:00");
    expect(await pending(ids.giulia)).toEqual([]);
    await as(ids.stefano, () => q(`select public.delete_shift($1)`, [id]));
    expect(await pending(ids.giulia)).toEqual([{ kind: "removed" }]);
    await as(ids.stefano, () => q(`select public.discard_shift_notices()`));
  });

  it("sends ONE message per employee, and only an admin can send", async () => {
    await save(null, ids.giulia, D2, "10:00", "14:00");
    await save(null, ids.giulia, D2, "16:00", "20:00");
    await save(null, ids.marco, D2, "16:00", "20:00");
    const before = (await shiftNotices(ids.giulia)).length;
    await failsWith(() => as(ids.giulia, () => q(`select public.send_shift_updates()`)), /forbidden/);
    const sent = await as(ids.stefano, () => q<{ r: { employees: number; changes: number } }>(`select public.send_shift_updates() as r`));
    expect(sent[0].r).toEqual({ employees: 2, changes: 3 });
    expect(await shiftNotices(ids.giulia)).toHaveLength(before + 1);
    const [n] = await q<{ params: Record<string, number> }>(`select params from public.notifications where user_id = $1 and type = 'shifts_updated' order by created_at desc limit 1`, [ids.giulia]);
    expect(n.params).toMatchObject({ count: 2, assigned: 2, changed: 0, removed: 0 });
    expect(await q(`select 1 from public.pending_shift_notices`)).toHaveLength(0);
  });

  it("an admin can keep changes quiet, and employees cannot read or clear the waiting list", async () => {
    const before = (await shiftNotices(ids.marco)).length;
    await save(null, ids.marco, day(33), "10:00", "14:00");
    await failsWith(() => as(ids.marco, () => q(`select public.discard_shift_notices()`)), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select * from public.pending_shift_notices`)), /permission denied/);
    await as(ids.stefano, () => q(`select public.discard_shift_notices()`));
    await as(ids.stefano, () => q(`select public.send_shift_updates()`));
    expect(await shiftNotices(ids.marco)).toHaveLength(before);
  });
});
