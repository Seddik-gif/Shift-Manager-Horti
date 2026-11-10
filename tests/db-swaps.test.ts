import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
// shifts must be in the future; pick a Rome day well ahead
const D1 = day(20), D2 = day(21), D3 = day(22);

const mk = async (emp: string, d: string, s = "10:00", e = "14:00") => {
  const r = await as(ids.stefano, () => q<{ r: { id: string } }>(`select public.save_shift(null, $1, $2, $3, $4, '', '', true, 'test') as r`, [emp, d, s, e]));
  return r[0].r.id;
};
const owner = async (shift: string) => (await q<{ employee_id: string }>(`select employee_id from public.shifts where id = $1`, [shift]))[0].employee_id;
const propose = (uid: string, shift: string, to: string, note = "") =>
  as(uid, () => q<{ id: string }>(`select public.propose_swap($1, $2, $3) as id`, [shift, to, note]));
const respond = (uid: string, id: string, yes: boolean) => as(uid, () => q<{ r: string }>(`select public.respond_swap($1, $2) as r`, [id, yes]));
const decide = (id: string, yes: boolean, note = "") => as(ids.stefano, () => q(`select public.decide_swap($1, $2, $3)`, [id, yes, note]));
const status = async (id: string) => (await q<{ status: string }>(`select status from public.shift_swaps where id = $1`, [id]))[0].status;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

describe("proposing a swap", () => {
  it("lists only free colleagues at the shift's location, and only to the shift's owner", async () => {
    const s = await mk(ids.marco, D1);
    await mk(ids.giulia, D1, "12:00", "16:00"); // Giulia is busy then
    expect(await as(ids.marco, () => q(`select * from public.swap_candidates($1)`, [s]))).toHaveLength(0);
    expect(await as(ids.giulia, () => q(`select * from public.swap_candidates($1)`, [s]))).toHaveLength(0); // not her shift
    const free = await mk(ids.marco, D2);
    const list = await as(ids.marco, () => q<{ id: string }>(`select * from public.swap_candidates($1)`, [free]));
    expect(list.map((c) => c.id)).toEqual([ids.giulia]);
  });

  it("creates a pending swap and tells the colleague", async () => {
    const s = await mk(ids.marco, D3);
    const id = (await propose(ids.marco, s, ids.giulia, "cena"))[0].id;
    expect(await status(id)).toBe("pending");
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'swap_proposed'`);
    expect(n.map((r) => r.user_id)).toEqual([ids.giulia]);
    await failsWith(() => propose(ids.marco, s, ids.giulia), /swap_exists/);
  });

  it("refuses other people's shifts, yourself, admins and past shifts", async () => {
    const s = await mk(ids.marco, day(30));
    await failsWith(() => propose(ids.giulia, s, ids.marco), /not_found/);
    await failsWith(() => propose(ids.marco, s, ids.marco), /recipient_unavailable/);
    await failsWith(() => propose(ids.marco, s, ids.tessa), /recipient_unavailable/);
    await failsWith(() => propose(ids.stefano, s, ids.giulia), /forbidden/);
  });

  it("is private: only the two people and admins can read it", async () => {
    const rows = await as(ids.marco, () => q(`select 1 from public.shift_swaps`));
    expect(rows.length).toBeGreaterThan(0);
    await failsWith(() => as(ids.marco, () => q(`insert into public.shift_swaps (shift_id, proposer, recipient) select id, employee_id, $1 from public.shifts limit 1`, [ids.giulia])), /permission denied/);
  });
});

describe("full cycle with admin approval", () => {
  let shift: string, swap: string;
  beforeAll(async () => {
    shift = await mk(ids.marco, day(40));
    swap = (await propose(ids.marco, shift, ids.giulia))[0].id;
  });

  it("only the colleague can respond; yes moves it to review and alerts the admins", async () => {
    await failsWith(() => respond(ids.marco, swap, true), /not_found/);
    expect((await respond(ids.giulia, swap, true))[0].r).toBe("review");
    expect(await owner(shift)).toBe(ids.marco); // nothing moved yet
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'swap_review'`);
    expect(n.map((r) => r.user_id).sort()).toEqual([ids.stefano, ids.tessa].sort());
    await failsWith(() => respond(ids.giulia, swap, true), /already_decided/);
  });

  it("only an admin approves; approval moves the shift, audits it and tells both people", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.decide_swap($1, true, '')`, [swap])), /forbidden/);
    await decide(swap, true);
    expect(await status(swap)).toBe("approved");
    expect(await owner(shift)).toBe(ids.giulia);
    expect(await q(`select 1 from public.audit_logs where action = 'shift.swapped'`)).toHaveLength(1);
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'swap_approved'`);
    expect(n.map((r) => r.user_id).sort()).toEqual([ids.giulia, ids.marco].sort());
    // the generic "shift assigned" noise is suppressed for the swap itself
    expect(await q(`select 1 from public.notifications where type in ('shift_assigned','shift_removed') and params ->> 'starts_at' = (select starts_at::text from public.shifts where id = $1)`, [shift])).toHaveLength(0);
  });

  it("flags a published week as changed", async () => {
    const s = await mk(ids.marco, day(50));
    await as(ids.stefano, () => q(`select public.publish_schedule(public.monday_of($1::date), null)`, [day(50)]));
    const id = (await propose(ids.marco, s, ids.giulia))[0].id;
    await respond(ids.giulia, id, true);
    await decide(id, true);
    const row = await q<{ has_unpublished_changes: boolean }>(`select w.has_unpublished_changes from public.shifts s join public.weekly_schedules w on w.id = s.schedule_id where s.id = $1`, [s]);
    expect(row[0].has_unpublished_changes).toBe(true);
  });
});

describe("declining, rejecting, withdrawing", () => {
  it("a colleague's no ends it and tells the proposer", async () => {
    const s = await mk(ids.marco, day(60));
    const id = (await propose(ids.marco, s, ids.giulia))[0].id;
    expect((await respond(ids.giulia, id, false))[0].r).toBe("rejected");
    expect(await owner(s)).toBe(ids.marco);
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'swap_declined'`);
    expect(n.map((r) => r.user_id)).toContain(ids.marco);
    // the shift can be offered again afterwards
    await propose(ids.marco, s, ids.giulia);
  });

  it("an admin rejection leaves the shift alone and tells both", async () => {
    const s = await mk(ids.marco, day(61));
    const id = (await propose(ids.marco, s, ids.giulia))[0].id;
    await failsWith(() => decide(id, true), /already_decided/); // still pending the colleague, not reviewable
    await respond(ids.giulia, id, true);
    await decide(id, false, "serve Marco");
    expect(await status(id)).toBe("rejected");
    expect(await owner(s)).toBe(ids.marco);
  });

  it("the proposer can withdraw until it is settled", async () => {
    const s = await mk(ids.marco, day(62));
    const id = (await propose(ids.marco, s, ids.giulia))[0].id;
    await failsWith(() => as(ids.giulia, () => q(`select public.withdraw_swap($1)`, [id])), /not_found/);
    await as(ids.marco, () => q(`select public.withdraw_swap($1)`, [id]));
    expect(await status(id)).toBe("cancelled");
    await failsWith(() => respond(ids.giulia, id, true), /already_decided/);
  });
});

describe("staying safe when things change", () => {
  it("cancels a waiting swap when an admin moves or reassigns the shift", async () => {
    const s = await mk(ids.marco, day(70));
    const id = (await propose(ids.marco, s, ids.giulia))[0].id;
    await as(ids.stefano, () => q(`select public.save_shift($1, $2, $3, '15:00', '19:00', '', '', true, 'x')`, [s, ids.marco, day(70)]));
    expect(await status(id)).toBe("cancelled");
  });

  it("re-checks at approval time: busy or absent colleague blocks the move", async () => {
    const s = await mk(ids.marco, day(71));
    const id = (await propose(ids.marco, s, ids.giulia))[0].id;
    await respond(ids.giulia, id, true);
    await mk(ids.giulia, day(71), "11:00", "13:00"); // Giulia becomes busy meanwhile
    await failsWith(() => decide(id, true), /recipient_busy/);
    expect(await owner(s)).toBe(ids.marco);
    expect(await status(id)).toBe("review"); // rolled back, still reviewable

    const s2 = await mk(ids.marco, day(72));
    const id2 = (await propose(ids.marco, s2, ids.giulia))[0].id;
    await respond(ids.giulia, id2, true);
    const abs = (await as(ids.giulia, () => q<{ id: string }>(`select public.request_absence('ferie', $1, $1, '') as id`, [day(72)])))[0].id;
    await as(ids.stefano, () => q(`select public.decide_absence($1, true, '')`, [abs]));
    await failsWith(() => decide(id2, true), /recipient_absent/);
  });

  it("an employee who is not assigned to the location cannot receive the shift", async () => {
    const lido = (await as(ids.stefano, () => q<{ v: string }>(`select public.save_location(null, 'Lido', '#12A594') as v`)))[0].v;
    await as(ids.stefano, () => q(`select public.set_employee_locations($1, $2::uuid[])`, [ids.marco, [lido]]));
    const s = await as(ids.stefano, () => q<{ r: { id: string } }>(`select public.save_shift(null, $1, $2, '10:00', '14:00', '', '', true, 'x', $3) as r`, [ids.marco, day(80), lido]));
    await failsWith(() => propose(ids.marco, s[0].r.id, ids.giulia), /recipient_unavailable/);
  });
});

describe("without the admin step", () => {
  it("the colleague's yes completes the swap immediately", async () => {
    await as(ids.stefano, () => q(`select public.save_swap_options(false)`));
    const home = (await q<{ id: string }>(`select id from public.locations where name = 'Horti Magici'`))[0].id;
    await as(ids.stefano, () => q(`select public.set_employee_locations($1, $2::uuid[])`, [ids.marco, [home]])); // back from Lido
    const s = await mk(ids.giulia, day(90));
    const id = (await propose(ids.giulia, s, ids.marco))[0].id;
    expect((await respond(ids.marco, id, true))[0].r).toBe("approved");
    expect(await owner(s)).toBe(ids.marco);
    expect(await status(id)).toBe("approved");
  });

  it("only admins can change the option", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.save_swap_options(true)`)), /forbidden/);
    await as(ids.stefano, () => q(`select public.save_swap_options(true)`));
  });
});
