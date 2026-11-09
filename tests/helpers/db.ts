// Shared in-process PostgreSQL (PGlite) with minimal Supabase stubs; applies the real migrations.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

export const ids = {
  stefano: "00000000-0000-4000-8000-000000000001",
  tessa: "00000000-0000-4000-8000-000000000002",
  marco: "00000000-0000-4000-8000-000000000011",
  giulia: "00000000-0000-4000-8000-000000000012",
};

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } });
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
  const dir = path.join(__dirname, "..", "..", "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  for (const [id, email, first] of [
    [ids.stefano, "stefano@example.com", "Stefano"], [ids.tessa, "tessa@example.com", "Tessa"],
    [ids.marco, "marco@example.com", "Marco"], [ids.giulia, "giulia@example.com", "Giulia"],
  ]) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, JSON.stringify({ first_name: first, last_name: "Test" })]);
  }
  await db.query(`update public.profiles set role = 'admin' where id = any($1::uuid[])`, [[ids.stefano, ids.tessa]]);
  return db;
}

/** Runs `fn` as an authenticated user (RLS applies), then restores the superuser. */
export async function asUser<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('app.uid', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('app.uid', '', false);`);
  }
}
