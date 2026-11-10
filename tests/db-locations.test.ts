import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const WEEK = "2030-05-06"; // a Monday
const DAY = "2030-05-07";
let centrale: string;
let lido: string;

beforeAll(async () => {
  db = await createTestDb();
  centrale = (await q<{ id: string }>(`select id from public.locations limit 1`))[0].id;
  lido = (await as(ids.stefano, () => q<{ save_location: string }>(`select public.save_location(null, 'Lido', '#12A594') as save_location`)))[0].save_location;
  await as(ids.stefano, () => q(`select public.set_employee_locations($1, $2::uuid[])`, [ids.marco, [centrale, lido]]));
  await as(ids.stefano, () => q(`select public.set_employee_locations($1, $2::uuid[])`, [ids.giulia, [centrale]]));
}, 60_000);
afterAll(async () => db.close());

const shift = (emp: string, start: string, end: string, loc: string | null, day = DAY) =>
  as(ids.stefano, () => q(`select public.save_shift(null, $1, $2, $3, $4, '', '', false, '', $5)`, [emp, day, start, end, loc]));

describe("managing locations", () => {
  it("starts with one default location and employees assigned to it", async () => {
    const rows = await q<{ n: string }>(`select count(*)::text as n from public.locations`);
    expect(Number(rows[0].n)).toBe(2); // default + Lido
  });

  it("only admins can create, archive, delete or assign", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.save_location(null, 'Evil', '#000000')`)), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select public.set_location_active($1, false)`, [lido])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select public.delete_location($1)`, [lido])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select public.set_employee_locations($1, '{}')`, [ids.marco])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`insert into public.locations (name) values ('x')`)), /permission denied/);
  });

  it("rejects duplicate names and bad colours", async () => {
    await failsWith(() => as(ids.stefano, () => q(`select public.save_location(null, ' lido ', '#112233')`)), /name_taken/);
    await failsWith(() => as(ids.stefano, () => q(`select public.save_location(null, 'Zed', 'red')`)), /invalid_input/);
  });

  it("never lets the last active location be archived or deleted", async () => {
    const extra = (await as(ids.stefano, () => q<{ v: string }>(`select public.save_location(null, 'Temp', '#123456') as v`)))[0].v;
    await as(ids.stefano, () => q(`select public.set_location_active($1, false)`, [extra]));
    await as(ids.stefano, () => q(`select public.set_location_active($1, true)`, [extra]));
    await as(ids.stefano, () => q(`select public.delete_location($1)`, [extra])); // unused: hard delete allowed
    expect(await q(`select 1 from public.locations where id = $1`, [extra])).toHaveLength(0);

    await as(ids.stefano, () => q(`select public.set_location_active($1, false)`, [lido]));
    await failsWith(() => as(ids.stefano, () => q(`select public.set_location_active($1, false)`, [centrale])), /last_location/);
    await as(ids.stefano, () => q(`select public.set_location_active($1, true)`, [lido]));
  });
});

describe("shifts per location", () => {
  it("creates a separate schedule per location for the same week", async () => {
    await shift(ids.marco, "10:00", "14:00", centrale);
    await shift(ids.giulia, "10:00", "14:00", centrale);
    await failsWith(() => shift(ids.marco, "12:00", "16:00", lido), /overlap/); // one person cannot be at two bars at once
    await shift(ids.marco, "15:00", "19:00", lido);
    const rows = await q<{ n: string }>(`select count(*)::text as n from public.weekly_schedules where week_start = $1`, [WEEK]);
    expect(Number(rows[0].n)).toBe(2);
  });

  it("refuses an employee who is not assigned to the location", async () => {
    await failsWith(() => shift(ids.giulia, "20:00", "23:00", lido), /employee_not_in_location/);
  });

  it("keeps an edited shift in its own location when none is given", async () => {
    const id = (await q<{ id: string }>(`select s.id from public.shifts s join public.weekly_schedules w on w.id = s.schedule_id
                                          where w.location_id = $1 and s.employee_id = $2`, [lido, ids.marco]))[0].id;
    await as(ids.stefano, () => q(`select public.save_shift($1, $2, $3, '16:00', '20:00', '', '', false, '')`, [id, ids.marco, DAY]));
    const loc = (await q<{ location_id: string }>(`select w.location_id from public.shifts s join public.weekly_schedules w on w.id = s.schedule_id where s.id = $1`, [id]))[0];
    expect(loc.location_id).toBe(lido);
  });

  it("rejects archived or unknown locations", async () => {
    await failsWith(() => shift(ids.marco, "08:00", "09:00", "00000000-0000-4000-8000-0000000000ff", "2030-05-08"), /invalid_location/);
  });
});

describe("visibility and publishing", () => {
  it("publishes each location independently and scopes what employees can read", async () => {
    await as(ids.stefano, () => q(`select public.publish_schedule($1, $2)`, [WEEK, lido]));
    const giulia = await as(ids.giulia, () => q(`select * from public.published_schedules`));
    expect(giulia).toHaveLength(0); // Giulia is not assigned to Lido
    const marco = await as(ids.marco, () => q<{ location_id: string }>(`select location_id from public.published_schedules`));
    expect(marco.map((r) => r.location_id)).toEqual([lido]);

    await as(ids.stefano, () => q(`select public.publish_schedule($1, $2)`, [WEEK, centrale]));
    expect(await as(ids.marco, () => q(`select 1 from public.published_schedules`))).toHaveLength(2);
    expect(await as(ids.giulia, () => q(`select 1 from public.published_schedules`))).toHaveLength(1);
  });

  it("employees see only their locations' live shifts and snapshots", async () => {
    const seen = await as(ids.giulia, () => q<{ location_id: string }>(`select distinct location_id from public.team_shifts`));
    expect(seen.map((r) => r.location_id)).toEqual([centrale]);
    expect(await as(ids.giulia, () => q(`select 1 from public.schedule_versions v join public.weekly_schedules s on s.id = v.schedule_id where s.location_id = $1`, [lido]))).toHaveLength(0);
  });

  it("notifies only the staff of the published location", async () => {
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'schedule_published' and params ->> 'location_id' = $1`, [lido]);
    expect(n.map((r) => r.user_id)).toEqual([ids.marco]);
  });

  it("open shifts belong to a location and only its staff can see and claim them", async () => {
    const open = (await as(ids.stefano, () => q<{ id: string }>(`select public.create_open_shift('2030-05-09', '10:00', '14:00', '', '', 1, $1) as id`, [lido])))[0].id;
    expect(await as(ids.giulia, () => q(`select 1 from public.open_shifts where id = $1`, [open]))).toHaveLength(0);
    await failsWith(() => as(ids.giulia, () => q(`select public.request_open_shift($1, '')`, [open])), /not_open|forbidden/);
    const req = (await as(ids.marco, () => q<{ id: string }>(`select public.request_open_shift($1, '') as id`, [open])))[0].id;
    await as(ids.stefano, () => q(`select public.decide_shift_request($1, true, '')`, [req]));
    const loc = await q<{ location_id: string }>(`select w.location_id from public.shift_requests r join public.shifts s on s.id = r.shift_id
                                                    join public.weekly_schedules w on w.id = s.schedule_id where r.id = $1`, [req]);
    expect(loc[0].location_id).toBe(lido);
  });
});

describe("archive vs delete", () => {
  it("refuses to delete a location with history but allows archiving it", async () => {
    await failsWith(() => as(ids.stefano, () => q(`select public.delete_location($1)`, [lido])), /location_in_use/);
    await as(ids.stefano, () => q(`select public.set_location_active($1, false)`, [lido]));
    expect(await as(ids.marco, () => q(`select 1 from public.published_schedules`))).toHaveLength(1); // archived bar disappears for staff
    await failsWith(() => shift(ids.marco, "10:00", "12:00", lido, "2030-05-10"), /invalid_location/);
  });
});
