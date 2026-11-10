import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

/**
 * A standing audit of the whole schema. When someone adds a table or function later and forgets a grant or a policy,
 * this fails and says exactly what to fix. (Run against a real Supabase Postgres with the same queries in docs/SECURITY.md.)
 */
let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

const ours = `not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

describe("tables", () => {
  it("every table in public has row level security switched on", async () => {
    const rows = await q<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("the anonymous role can touch nothing", async () => {
    const rows = await q<{ table_name: string; privilege_type: string }>(`select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`);
    expect(rows).toEqual([]);
  });

  it("signed-in users cannot truncate tables or add triggers, and views are read-only", async () => {
    const bad = await q<{ table_name: string; privilege_type: string }>(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`);
    expect(bad).toEqual([]);
    const views = await q<{ table_name: string; privilege_type: string }>(`select g.table_name, g.privilege_type from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name and c.relkind = 'v' join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where g.table_schema = 'public' and g.grantee in ('authenticated', 'anon') and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')`);
    expect(views).toEqual([]);
  });

  it("secrets are not readable even by their owner: push keys", async () => {
    await expect(asUser(db, ids.marco, () => q(`select p256dh, auth from public.push_subscriptions`))).rejects.toThrow(/permission denied/);
  });
});

describe("functions", () => {
  it("every SECURITY DEFINER function pins its search_path (no hijacking through a shadowing schema)", async () => {
    const rows = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and ${ours} and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows.map((r) => r.sig)).toEqual([]);
  });

  it("nothing in public is callable by the anonymous role", async () => {
    const rows = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and ${ours} and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows.map((r) => r.sig)).toEqual([]);
  });

  it("trigger functions and internal helpers are not callable by signed-in users", async () => {
    const triggers = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')`);
    expect(triggers.map((r) => r.sig)).toEqual([]);
    const internal = ["notify_users", "active_user_ids", "person_name", "bump_pulse", "execute_swap", "thread_member_ids", "thread_can_access", "ensure_chat_threads",
      "run_chat_purge", "shift_window", "touch_schedule", "availability_status", "on_approved_absence", "default_location_id", "location_employee_ids", "run_availability_reminders"];
    const exposed = await q<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1::text[]) and has_function_privilege('authenticated', p.oid, 'execute')`, [internal]);
    expect(exposed.map((r) => r.sig)).toEqual([]);
  });

  it("the chat access check cannot be used to learn who is in someone else's conversation", async () => {
    const [{ n }] = await q<{ n: number }>(`select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'can_access_thread' and p.pronargs <> 1`);
    expect(n).toBe(0);
  });

  it("extensions do not sit in the API schema", async () => {
    const rows = await q<{ extname: string }>(`select e.extname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public'`);
    expect(rows.map((r) => r.extname)).toEqual([]);
  });
});

describe("behaviour that depends on the hardening still works", () => {
  it("overlapping shifts are still refused (the exclusion constraint survived the extension move)", async () => {
    const save = (a: string, b: string) => asUser(db, ids.stefano, () => q(`select public.save_shift(null, $1, '2031-03-04', $2, $3, '', '', true, 'x')`, [ids.marco, a, b]));
    await save("10:00", "14:00");
    await expect(save("12:00", "16:00")).rejects.toThrow(/overlap/);
  });

  it("employees still read their own location's chat through the policies", async () => {
    const o = await asUser(db, ids.marco, () => q<{ kind: string }>(`select kind from public.chat_overview()`));
    expect(o.map((r) => r.kind)).toContain("global");
  });
});
