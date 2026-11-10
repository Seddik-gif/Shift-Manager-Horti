import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

const P256 = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const endpoint = (n: string) => `https://push.example.test/send/${n}`;
const save = (uid: string, ep: string, ua = "TestBrowser") =>
  as(uid, () => q(`select public.save_push_subscription($1, $2, $3, $4)`, [ep, P256, AUTH, ua]));

beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("registering devices", () => {
  it("stores a device for the signed-in person", async () => {
    await save(ids.marco, endpoint("m1"));
    const rows = await as(ids.marco, () => q<{ user_id: string }>(`select user_id from public.push_subscriptions`));
    expect(rows.map((r) => r.user_id)).toEqual([ids.marco]);
  });

  it("re-registering the same device is idempotent and clears its failure state", async () => {
    await q(`update public.push_subscriptions set failure_count = 3, disabled_at = now() where endpoint = $1`, [endpoint("m1")]);
    await save(ids.marco, endpoint("m1"), "NewUA");
    const [row] = await q<{ failure_count: number; disabled_at: string | null; user_agent: string }>(`select failure_count, disabled_at, user_agent from public.push_subscriptions where endpoint = $1`, [endpoint("m1")]);
    expect(row).toMatchObject({ failure_count: 0, disabled_at: null, user_agent: "NewUA" });
    expect(await q(`select 1 from public.push_subscriptions where endpoint = $1`, [endpoint("m1")])).toHaveLength(1);
  });

  it("moves a shared device to whoever signs in on it now", async () => {
    await save(ids.giulia, endpoint("shared"));
    await save(ids.marco, endpoint("shared"));
    const [row] = await q<{ user_id: string }>(`select user_id from public.push_subscriptions where endpoint = $1`, [endpoint("shared")]);
    expect(row.user_id).toBe(ids.marco);
  });

  it("rejects non-https endpoints and malformed keys", async () => {
    await failsWith(() => save(ids.marco, "http://push.example.test/x"), /invalid_input/);
    await failsWith(() => as(ids.marco, () => q(`select public.save_push_subscription($1, 'x', 'y', '')`, [endpoint("bad")])), /invalid_input/);
  });

  it("lets only the owner remove a device", async () => {
    await save(ids.giulia, endpoint("g1"));
    await as(ids.marco, () => q(`select public.delete_push_subscription($1)`, [endpoint("g1")]));
    expect(await q(`select 1 from public.push_subscriptions where endpoint = $1`, [endpoint("g1")])).toHaveLength(1);
    await as(ids.giulia, () => q(`select public.delete_push_subscription($1)`, [endpoint("g1")]));
    expect(await q(`select 1 from public.push_subscriptions where endpoint = $1`, [endpoint("g1")])).toHaveLength(0);
  });
});

describe("privacy", () => {
  it("keeps devices private to their owner (and admins), and never exposes the keys", async () => {
    await save(ids.giulia, endpoint("g2"));
    expect(await as(ids.giulia, () => q(`select endpoint from public.push_subscriptions where user_id = $1`, [ids.marco]))).toHaveLength(0);
    await failsWith(() => as(ids.giulia, () => q(`select p256dh from public.push_subscriptions`)), /permission denied/);
    await failsWith(() => as(ids.giulia, () => q(`select auth from public.push_subscriptions`)), /permission denied/);
    await failsWith(() => as(ids.giulia, () => q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x.test/1', $2, $3)`, [ids.giulia, P256, AUTH])), /permission denied/);
    await failsWith(() => as(ids.giulia, () => q(`update public.push_subscriptions set disabled_at = null`)), /permission denied/);
  });
});

describe("who will actually be notified (admin view)", () => {
  const coverage = (uid: string) => as(uid, () => q<{ user_id: string; state: string }>(`select * from public.push_coverage()`));

  it("is admin-only", async () => {
    await failsWith(() => coverage(ids.marco), /forbidden/);
  });

  it("separates working devices, switched-off devices and people who never enabled", async () => {
    await q(`delete from public.push_subscriptions`);
    await save(ids.marco, endpoint("cov-m"));
    await save(ids.giulia, endpoint("cov-g"));
    await q(`update public.push_subscriptions set disabled_at = now() where endpoint = $1`, [endpoint("cov-g")]);
    const state = Object.fromEntries((await coverage(ids.stefano)).map((r) => [r.user_id, r.state]));
    expect(state[ids.marco]).toBe("active");
    expect(state[ids.giulia]).toBe("disabled");
    // a second working device rescues Giulia
    await save(ids.giulia, endpoint("cov-g2"));
    expect(Object.fromEntries((await coverage(ids.stefano)).map((r) => [r.user_id, r.state]))[ids.giulia]).toBe("active");
  });

  it("can be limited to one location's staff", async () => {
    const lido = (await as(ids.stefano, () => q<{ v: string }>(`select public.save_location(null, 'Lido', '#12A594') as v`)))[0].v;
    await as(ids.stefano, () => q(`select public.set_employee_locations($1, $2::uuid[])`, [ids.marco, [lido]]));
    const rows = await as(ids.stefano, () => q<{ user_id: string }>(`select * from public.push_coverage($1)`, [lido]));
    expect(rows.map((r) => r.user_id)).toEqual([ids.marco]);
  });
});

describe("delivery bookkeeping", () => {
  it("allows one push and one email record per notification, and no duplicates", async () => {
    const [n] = await q<{ id: string }>(`insert into public.notifications (user_id, type, params) values ($1, 'swap_proposed', '{}') returning id`, [ids.marco]);
    await q(`insert into public.notification_deliveries (notification_id, channel, status) values ($1, 'push', 'sent')`, [n.id]);
    await q(`insert into public.notification_deliveries (notification_id, channel, status) values ($1, 'email', 'sent')`, [n.id]);
    await failsWith(() => q(`insert into public.notification_deliveries (notification_id, channel, status) values ($1, 'push', 'sent')`, [n.id]), /duplicate|unique/);
    await failsWith(() => q(`insert into public.notification_deliveries (notification_id, channel, status) values ($1, 'sms', 'sent')`, [n.id]), /check/);
  });
});
