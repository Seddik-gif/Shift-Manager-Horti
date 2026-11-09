import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const save = (emp: string, day: string, s: string, e: string) =>
  asUser(db, ids.stefano, () => q<{ r: { ok: boolean; id?: string } }>(`select public.save_shift(null, $1, $2, $3, $4, 'Bar', '', false, '') as r`, [emp, day, s, e])).then((r) => r[0].r);

beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("shift hours: start from 07:00, end by 02:00 the next day", () => {
  it("accepts the whole allowed window", async () => {
    expect((await save(ids.marco, "2026-12-14", "07:00", "15:00")).ok).toBe(true);
    expect((await save(ids.marco, "2026-12-15", "22:00", "02:00")).ok).toBe(true); // ends at the limit
    expect((await save(ids.giulia, "2026-12-16", "07:00", "02:00")).ok).toBe(true); // full 19 hours
    expect((await save(ids.giulia, "2026-12-18", "18:00", "00:00")).ok).toBe(true);
  });

  it("rejects shifts starting before 07:00", async () => {
    await expect(save(ids.marco, "2026-12-17", "06:55", "12:00")).rejects.toThrow(/outside_hours/);
    await expect(save(ids.marco, "2026-12-17", "00:30", "05:00")).rejects.toThrow(/outside_hours/);
  });

  it("rejects shifts ending after 02:00 the next day", async () => {
    await expect(save(ids.marco, "2026-12-17", "20:00", "02:05")).rejects.toThrow(/outside_hours/);
    await expect(save(ids.marco, "2026-12-17", "20:00", "05:00")).rejects.toThrow(/outside_hours/);
  });

  it("lets two employees work at the same time", async () => {
    expect((await save(ids.marco, "2026-12-19", "10:00", "18:00")).ok).toBe(true);
    expect((await save(ids.giulia, "2026-12-19", "12:00", "20:00")).ok).toBe(true);
    expect(await q(`select 1 from public.shifts where starts_at = '2026-12-19T09:00:00Z' or starts_at = '2026-12-19T11:00:00Z'`)).toHaveLength(2);
  });

  it("reads the limits from app_settings, so they can be changed", async () => {
    await db.query(`update public.app_settings set value = '{"earliest_start":"09:00","latest_end":"01:00"}' where key = 'shift_hours'`);
    await expect(save(ids.marco, "2026-12-21", "08:00", "12:00")).rejects.toThrow(/outside_hours/);
    await expect(save(ids.marco, "2026-12-21", "20:00", "02:00")).rejects.toThrow(/outside_hours/);
    expect((await save(ids.marco, "2026-12-21", "09:00", "01:00")).ok).toBe(true);
  });
});
