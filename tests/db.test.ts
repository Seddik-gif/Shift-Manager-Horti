// Runs the real migrations against an in-process PostgreSQL (PGlite) with minimal Supabase stubs
// (auth schema, roles). This validates the schema, constraints, RLS policies and SQL functions.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const WEEK = "2026-11-16";
const ids = {
  stefano: "00000000-0000-4000-8000-000000000001",
  tessa: "00000000-0000-4000-8000-000000000002",
  marco: "00000000-0000-4000-8000-000000000011",
  giulia: "00000000-0000-4000-8000-000000000012",
};

let db: PGlite;

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('app.uid', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('app.uid', '', false);`);
  }
}
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const failsWith = async (fn: () => Promise<unknown>, text: string | RegExp) => {
  await expect(fn()).rejects.toThrow(text);
};

function fullWeek(overrides: Record<string, unknown> = {}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10);
    return { day, available: false, note: "", windows: [] as { start: string; end: string }[], ...(overrides[day] as object) };
  });
  return JSON.stringify(days);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  for (const [id, email, first] of [
    [ids.stefano, "stefano@example.com", "Stefano"], [ids.tessa, "tessa@example.com", "Tessa"],
    [ids.marco, "marco@example.com", "Marco"], [ids.giulia, "giulia@example.com", "Giulia"],
  ]) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, JSON.stringify({ first_name: first, last_name: "Test", role: "admin" })]);
  }
  await db.query(`update public.profiles set role = 'admin' where id = any($1::uuid[])`, [[ids.stefano, ids.tessa]]);
}, 60_000);

afterAll(async () => db.close());

describe("schema & triggers", () => {
  it("creates profiles from auth users and never trusts a role in client metadata", async () => {
    const rows = await q<{ id: string; role: string }>(`select id, role from public.profiles order by email`);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.id === ids.marco)?.role).toBe("employee"); // metadata said "admin"
    expect(rows.find((r) => r.id === ids.stefano)?.role).toBe("admin"); // promoted explicitly
  });

  it("rejects overlapping shifts for one employee, even across overnight, but allows adjacent ones", async () => {
    const { rows } = await db.query<{ id: string }>(`insert into public.weekly_schedules (week_start) values ($1) returning id`, [WEEK]);
    const sid = rows[0].id;
    const ins = (s: string, e: string) => db.query(
      `insert into public.shifts (schedule_id, employee_id, starts_at, ends_at) values ($1, $2, $3, $4)`, [sid, ids.marco, s, e]);
    await ins("2026-11-16T17:00:00Z", "2026-11-17T00:00:00Z");
    await failsWith(() => ins("2026-11-16T23:00:00Z", "2026-11-17T03:00:00Z"), /conflicting key|exclusion/i);
    await ins("2026-11-17T00:00:00Z", "2026-11-17T05:00:00Z"); // back-to-back is fine
  });

  it("keeps the audit log append-only", async () => {
    await db.query(`insert into public.audit_logs (action, entity_type) values ('x', 'y')`);
    await failsWith(() => db.query(`delete from public.audit_logs`), /append-only/);
    await failsWith(() => db.query(`update public.audit_logs set action = 'z'`), /append-only/);
  });
});

describe("availability workflow", () => {
  let requestId: string;

  it("only admins can create requests; sending notifies every active employee once", async () => {
    await as(ids.marco, () => failsWith(() => q(`select public.create_availability_request($1, now() + interval '3 days', '', true)`, [WEEK]), /forbidden/));
    requestId = (await as(ids.stefano, () => q<{ create_availability_request: string }>(
      `select public.create_availability_request($1, now() + interval '3 days', 'Ciao', true)`, [WEEK])))[0].create_availability_request;
    const n = await q<{ user_id: string }>(`select user_id from public.notifications where type = 'availability_requested'`);
    expect(n.map((r) => r.user_id).sort()).toEqual([ids.giulia, ids.marco].sort());
    await as(ids.tessa, () => failsWith(() => q(`select public.create_availability_request($1, now(), '', false)`, [WEEK]), /request_exists/));
  });

  it("stores custom, overnight intervals as Europe/Rome instants and notifies BOTH admins", async () => {
    await as(ids.marco, () => q(`select public.save_availability($1, $2::jsonb, 'note', true)`, [requestId, fullWeek({
      [WEEK]: { available: true, windows: [{ start: "09:00", end: "14:30" }, { start: "18:00", end: "23:30" }] },
      "2026-11-20": { available: true, windows: [{ start: "17:00", end: "00:00" }] },
      "2026-11-21": { available: true, windows: [{ start: "18:00", end: "01:00" }] },
    })]));
    const w = await q<{ day: string; s: string; e: string }>(
      `select day::text, to_char(starts_at at time zone 'Europe/Rome', 'HH24:MI') s, to_char(ends_at at time zone 'Europe/Rome', 'HH24:MI') e,
              ends_at - starts_at as len from public.availability_time_windows order by starts_at`);
    expect(w.map((r) => `${r.day} ${r.s}-${r.e}`)).toEqual([
      "2026-11-16 09:00-14:30", "2026-11-16 18:00-23:30", "2026-11-20 17:00-00:00", "2026-11-21 18:00-01:00",
    ]);
    const over = await q<{ hrs: number }>(`select extract(epoch from ends_at - starts_at)/3600 as hrs from public.availability_time_windows where day = '2026-11-21'`);
    expect(Number(over[0].hrs)).toBe(7);
    const admins = await q<{ user_id: string; type: string }>(`select user_id, type from public.notifications where type like 'availability_submitted'`);
    expect(admins.map((a) => a.user_id).sort()).toEqual([ids.stefano, ids.tessa].sort());
    expect(await q(`select 1 from public.notifications where user_id = $1 and type = 'availability_confirmed'`, [ids.marco])).toHaveLength(1);
  });

  it("does not duplicate notifications for an identical re-submission, but flags real updates", async () => {
    const same = fullWeek({
      [WEEK]: { available: true, windows: [{ start: "09:00", end: "14:30" }, { start: "18:00", end: "23:30" }] },
      "2026-11-20": { available: true, windows: [{ start: "17:00", end: "00:00" }] },
      "2026-11-21": { available: true, windows: [{ start: "18:00", end: "01:00" }] },
    });
    await as(ids.marco, () => q(`select public.save_availability($1, $2::jsonb, 'note', true)`, [requestId, same]));
    expect(await q(`select 1 from public.notifications where type = 'availability_submitted'`)).toHaveLength(2);
    await as(ids.marco, () => q(`select public.save_availability($1, $2::jsonb, 'changed', true)`, [requestId, same]));
    expect(await q(`select 1 from public.notifications where type = 'availability_updated'`)).toHaveLength(2);
  });

  it("rejects overlaps, incomplete weeks and drafts after submission", async () => {
    const overlap = fullWeek({ [WEEK]: { available: true, windows: [{ start: "09:00", end: "14:00" }, { start: "13:00", end: "18:00" }] } });
    await as(ids.giulia, () => failsWith(() => q(`select public.save_availability($1, $2::jsonb, '', false)`, [requestId, overlap]), /overlap/));
    const cross = fullWeek({
      [WEEK]: { available: true, windows: [{ start: "18:00", end: "01:00" }] },
      "2026-11-17": { available: true, windows: [{ start: "00:30", end: "03:00" }] },
    });
    await as(ids.giulia, () => failsWith(() => q(`select public.save_availability($1, $2::jsonb, '', false)`, [requestId, cross]), /overlap/));
    await as(ids.giulia, () => failsWith(() => q(`select public.save_availability($1, '[]'::jsonb, '', true)`, [requestId]), /incomplete/));
    await as(ids.giulia, () => failsWith(() => q(`select public.save_availability($1, $2::jsonb, '', true)`, [requestId, fullWeek({ [WEEK]: { available: true, windows: [] } })]), /incomplete/));
    const outside = JSON.stringify([{ day: "2026-12-01", available: false, note: "", windows: [] }]);
    await as(ids.giulia, () => failsWith(() => q(`select public.save_availability($1, $2::jsonb, '', false)`, [requestId, outside]), /day_out_of_week/));
    await as(ids.marco, () => failsWith(() => q(`select public.save_availability($1, $2::jsonb, '', false)`, [requestId, fullWeek()]), /already_submitted/));
  });

  it("lets an employee save a draft, which stays a draft", async () => {
    await as(ids.giulia, () => q(`select public.save_availability($1, $2::jsonb, '', false)`, [requestId, fullWeek({ [WEEK]: { available: true, windows: [{ start: "10:00", end: "16:00" }] } })]));
    const r = await q<{ status: string }>(`select status from public.availability_submissions where employee_id = $1`, [ids.giulia]);
    expect(r[0].status).toBe("draft");
  });

  it("enforces privacy: employees see only their own submission; admins see all", async () => {
    expect(await as(ids.marco, () => q(`select employee_id from public.availability_submissions`))).toEqual([{ employee_id: ids.marco }]);
    expect(await as(ids.giulia, () => q(`select 1 from public.availability_time_windows w join public.availability_submissions s on s.id = w.submission_id where s.employee_id = $1`, [ids.marco]))).toHaveLength(0);
    expect((await as(ids.tessa, () => q(`select 1 from public.availability_submissions`))).length).toBe(2);
  });

  it("blocks direct writes that bypass the rules (RLS and column protection)", async () => {
    // employee cannot edit someone else's submission
    await as(ids.giulia, async () => {
      const r = await db.query(`update public.availability_submissions set notes = 'hacked' where employee_id = $1`, [ids.marco]);
      expect(r.affectedRows).toBe(0);
    });
    // employee cannot promote themselves or change protected fields
    await as(ids.marco, () => failsWith(() => q(`update public.profiles set role = 'admin' where id = $1`, [ids.marco]), /Only administrators/));
    await as(ids.marco, () => failsWith(() => q(`update public.profiles set first_name = 'X' where id = $1`, [ids.marco]), /Only administrators/));
    await as(ids.marco, async () => {
      const r = await db.query(`update public.profiles set phone = '+39 333 1' where id = $1`, [ids.marco]);
      expect(r.affectedRows).toBe(1); // phone is allowed
    });
    // employees cannot touch shifts, schedules, audit logs or settings
    const [{ id: scheduleId }] = await q<{ id: string }>(`select id from public.weekly_schedules limit 1`);
    await as(ids.marco, async () => {
      expect(await q(`select 1 from public.shifts`)).toHaveLength(0);
      expect(await q(`select 1 from public.audit_logs`)).toHaveLength(0);
      expect(await q<{ key: string }>(`select key from public.app_settings`)).toEqual([{ key: "shift_hours" }]); // only the public shift window
      await failsWith(() => q(`insert into public.shifts (schedule_id, employee_id, starts_at, ends_at) values ($1, $2, '2027-01-01T10:00:00Z', '2027-01-01T12:00:00Z')`, [scheduleId, ids.marco]), /row-level security/);
    });
    // admins can read audit logs
    expect((await as(ids.stefano, () => q(`select 1 from public.audit_logs`))).length).toBeGreaterThan(0);
  });

  it("lets users read and mark only their own notifications, and nothing else about them", async () => {
    await as(ids.marco, async () => {
      expect((await q<{ user_id: string }>(`select user_id from public.notifications`)).every((n) => n.user_id === ids.marco)).toBe(true);
      const r = await db.query(`update public.notifications set read_at = now() where user_id = $1`, [ids.marco]);
      expect(r.affectedRows).toBeGreaterThan(0);
      await failsWith(() => q(`update public.notifications set type = 'x' where user_id = $1`, [ids.marco]), /permission denied/);
      await failsWith(() => q(`insert into public.notifications (user_id, type) values ($1, 'fake')`, [ids.marco]), /permission denied|row-level security/);
    });
  });

  it("hides draft requests from employees", async () => {
    await as(ids.tessa, () => q(`select public.create_availability_request('2026-11-23', now() + interval '9 days', '', false)`));
    expect(await as(ids.marco, () => q(`select 1 from public.availability_requests where status = 'draft'`))).toHaveLength(0);
    expect((await as(ids.tessa, () => q(`select 1 from public.availability_requests where status = 'draft'`))).length).toBe(1);
  });

  it("closing a request stops edits and is admin-only", async () => {
    await as(ids.marco, () => failsWith(() => q(`select public.close_availability_request($1)`, [requestId]), /forbidden/));
    await as(ids.stefano, () => q(`select public.close_availability_request($1)`, [requestId]));
    await as(ids.marco, () => failsWith(() => q(`select public.save_availability($1, $2::jsonb, '', true)`, [requestId, fullWeek()]), /request_not_open/));
    expect(await q(`select 1 from public.audit_logs where action = 'availability_request.closed'`)).toHaveLength(1);
  });

  it("creates deadline reminders once, only for employees who have not submitted", async () => {
    await as(ids.stefano, () => q(`select public.create_availability_request('2026-11-30', now() + interval '10 hours', '', true)`));
    await db.query(`reset role`);
    expect((await q<{ run_availability_reminders: number }>(`select public.run_availability_reminders()`))[0].run_availability_reminders).toBe(2);
    await q(`select public.run_availability_reminders()`);
    expect(await q(`select 1 from public.notifications where type = 'availability_deadline'`)).toHaveLength(2);
    expect(await q(`select 1 from public.notifications where type = 'availability_missing'`)).toHaveLength(2);
    await as(ids.marco, () => failsWith(() => q(`select public.run_availability_reminders()`), /permission denied/));
  });
});
