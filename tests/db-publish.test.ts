import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const WEEK = "2026-12-14"; // no availability request: shifts save without warnings
const addShift = (emp: string, day: string, s: string, e: string, id: string | null = null) =>
  as(ids.stefano, () => q<{ r: { id: string } }>(`select public.save_shift($1, $2, $3, $4, $5, 'Bar', 'internal note', false, '') as r`, [id, emp, day, s, e])).then((r) => r[0].r.id);
const publish = (uid: string, week = WEEK) => as(uid, () => q<{ r: { version: number; republished: boolean; shifts: number } }>(`select public.publish_schedule($1) as r`, [week])).then((r) => r[0].r);

let marcoShift: string;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

describe("publishing", () => {
  it("refuses to publish a week with no schedule or no shifts, and refuses employees", async () => {
    await failsWith(() => publish(ids.stefano), /schedule_not_found/);
    marcoShift = await addShift(ids.marco, "2026-12-14", "10:00", "16:00");
    await addShift(ids.giulia, "2026-12-15", "18:00", "01:00");
    await failsWith(() => publish(ids.marco), /forbidden/);
  });

  it("publishes atomically: version 1, snapshot without internal notes, audit and notifications", async () => {
    const r = await publish(ids.stefano);
    expect(r).toMatchObject({ version: 1, republished: false, shifts: 2 });
    const [s] = await q<{ status: string; has_unpublished_changes: boolean; published_by: string }>(`select status, has_unpublished_changes, published_by from public.weekly_schedules where week_start = $1`, [WEEK]);
    expect(s).toMatchObject({ status: "published", has_unpublished_changes: false, published_by: ids.stefano });
    const [v] = await q<{ snapshot: { shifts: Record<string, unknown>[] } }>(`select snapshot from public.schedule_versions where version = 1`);
    expect(v.snapshot.shifts).toHaveLength(2);
    expect(JSON.stringify(v.snapshot)).not.toContain("internal note");
    expect(await q(`select 1 from public.audit_logs where action = 'schedule.published'`)).toHaveLength(1);
    const emp = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'schedule_published'`);
    expect(emp.map((n) => n.user_id).sort()).toEqual([ids.giulia, ids.marco].sort());
    const adm = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'schedule_publish_confirmed'`);
    expect(adm.map((n) => n.user_id).sort()).toEqual([ids.stefano, ids.tessa].sort());
  });

  it("prevents duplicate publication", async () => {
    await failsWith(() => publish(ids.tessa), /nothing_to_publish/);
    expect(await q(`select 1 from public.notifications where type = 'schedule_published'`)).toHaveLength(2);
  });

  it("lets employees read the official schedule but never drafts or live shifts", async () => {
    const pub = await as(ids.marco, () => q<{ week_start: string; version: number }>(`select week_start::text, version from public.published_schedules`));
    expect(pub).toEqual([{ week_start: WEEK, version: 1 }]);
    expect(await as(ids.marco, () => q(`select 1 from public.shifts`))).toHaveLength(0);
  });

  it("does not silently change the published schedule when shifts are edited", async () => {
    await addShift(ids.marco, "2026-12-14", "11:00", "17:00", marcoShift);
    const [pub] = await as(ids.giulia, () => q<{ snapshot: { shifts: { starts_at: string }[] } }>(`select snapshot from public.published_schedules`));
    expect(pub.snapshot.shifts.map((s) => s.starts_at)).toContain("2026-12-14T09:00:00+00:00");
    expect(pub.snapshot.shifts.map((s) => s.starts_at)).not.toContain("2026-12-14T10:00:00+00:00");
    const [w] = await q<{ has_unpublished_changes: boolean }>(`select has_unpublished_changes from public.weekly_schedules where week_start = $1`, [WEEK]);
    expect(w.has_unpublished_changes).toBe(true);
  });

  it("requires explicit republication and keeps version history", async () => {
    const r = await publish(ids.tessa);
    expect(r).toMatchObject({ version: 2, republished: true });
    expect(await q(`select 1 from public.audit_logs where action = 'schedule.republished'`)).toHaveLength(1);
    expect(await q(`select 1 from public.notifications where type = 'schedule_updated'`)).toHaveLength(2);
    const versions = await q<{ version: number; published_by: string }>(`select version, published_by from public.schedule_versions order by version`);
    expect(versions).toEqual([{ version: 1, published_by: ids.stefano }, { version: 2, published_by: ids.tessa }]);
    const [pub] = await as(ids.marco, () => q<{ version: number }>(`select version from public.published_schedules`));
    expect(pub.version).toBe(2);
  });

  it("keeps history immutable and unwritable by employees", async () => {
    await failsWith(() => q(`update public.schedule_versions set snapshot = '{}' where version = 1`), /append-only/);
    await failsWith(() => q(`delete from public.schedule_versions`), /append-only/);
    await failsWith(() => as(ids.marco, () => q(`insert into public.schedule_versions (schedule_id, version, snapshot, published_by) select id, 9, '{}', $1 from public.weekly_schedules limit 1`, [ids.marco])), /row-level security|permission denied/);
    const r = await as(ids.marco, () => db.query(`update public.weekly_schedules set status = 'draft'`));
    expect(r.affectedRows).toBe(0); // RLS: employees cannot write schedules
    const [s] = await q<{ status: string }>(`select status from public.weekly_schedules`);
    expect(s.status).toBe("published");
  });
});
