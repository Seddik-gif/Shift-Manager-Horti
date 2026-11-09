import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);
const WEEK = "2026-12-14";
let shareId: string;

beforeAll(async () => {
  db = await createTestDb();
  await as(ids.stefano, () => q(`select public.save_shift(null, $1, '2026-12-14', '10:00', '16:00', 'Bar', '', false, '')`, [ids.marco]));
}, 60_000);
afterAll(async () => db.close());

describe("manual WhatsApp share tracking", () => {
  it("cannot prepare a message before the schedule is published", async () => {
    await failsWith(() => as(ids.stefano, () => q(`select public.prepare_whatsapp_share($1, 'it', 'x')`, [WEEK])), /not_published/);
    await as(ids.stefano, () => q(`select public.publish_schedule($1)`, [WEEK]));
  });

  it("is admin-only and employees cannot read it", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.prepare_whatsapp_share($1, 'it', 'x')`, [WEEK])), /forbidden/);
    shareId = (await as(ids.tessa, () => q<{ id: string }>(`select public.prepare_whatsapp_share($1, 'en', 'HORTI MAGICI') as id`, [WEEK])))[0].id;
    expect(await as(ids.marco, () => q(`select 1 from public.whatsapp_shares`))).toHaveLength(0);
    expect(await as(ids.stefano, () => q(`select 1 from public.whatsapp_shares`))).toHaveLength(1);
    await failsWith(() => as(ids.marco, () => q(`select public.mark_whatsapp_step($1, 'confirmed')`, [shareId])), /forbidden/);
  });

  it("records copied, opened and the manual confirmation with who and when", async () => {
    await as(ids.stefano, () => q(`select public.mark_whatsapp_step($1, 'copied')`, [shareId]));
    await as(ids.stefano, () => q(`select public.mark_whatsapp_step($1, 'opened')`, [shareId]));
    expect((await q<{ confirmed_sent_at: string | null }>(`select confirmed_sent_at from public.whatsapp_shares`))[0].confirmed_sent_at).toBeNull();
    await as(ids.tessa, () => q(`select public.mark_whatsapp_step($1, 'confirmed')`, [shareId]));
    const [r] = await q<{ copied_by: string; confirmed_by: string; confirmed_sent_at: string; version: number }>(`select copied_by, confirmed_by, confirmed_sent_at, version from public.whatsapp_shares`);
    expect(r).toMatchObject({ copied_by: ids.stefano, confirmed_by: ids.tessa, version: 1 });
    expect(r.confirmed_sent_at).toBeTruthy();
    const [log] = await q<{ actor_id: string; changes: { manual: boolean } }>(`select actor_id, changes from public.audit_logs where action = 'whatsapp.share_confirmed'`);
    expect(log.actor_id).toBe(ids.tessa);
    expect(log.changes.manual).toBe(true);
  });

  it("cannot be confirmed twice or written to directly", async () => {
    await failsWith(() => as(ids.stefano, () => q(`select public.mark_whatsapp_step($1, 'confirmed')`, [shareId])), /already_confirmed/);
    await failsWith(() => as(ids.stefano, () => q(`update public.whatsapp_shares set confirmed_sent_at = null`)), /permission denied/);
  });
});
