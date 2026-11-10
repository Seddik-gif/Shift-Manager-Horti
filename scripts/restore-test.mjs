// Proves that a backup can be restored: loads it into a TEMPORARY database, counts the key tables, then deletes it.
// Your real database is never touched.
//
//   RESTORE_ADMIN_URL="postgresql://postgres:***@localhost:5432/postgres" node scripts/restore-test.mjs [backup.dump]
//
// RESTORE_ADMIN_URL must point at a scratch PostgreSQL server where you may create databases
// (a local install or `docker run postgres`), NOT at the live Supabase project. Without a file it uses the newest backup.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { KEY_TABLES, judgeRestore, maskUrl, safeDbName, sortBackups, splitUrl, tempDbName, withDatabase } from "./lib/backup-utils.mjs";

const adminUrl = process.env.RESTORE_ADMIN_URL;
const dir = path.resolve(process.env.BACKUP_DIR ?? "backups");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
function run(cmd, args, password) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, PGPASSWORD: password } });
  if (r.error) fail(r.error.code === "ENOENT" ? `${cmd} was not found. Install the PostgreSQL client tools and try again.` : r.error.message);
  return r;
}

if (!adminUrl) fail("Set RESTORE_ADMIN_URL to a scratch PostgreSQL server (never the live database).");
let admin;
try { admin = splitUrl(adminUrl); } catch (e) { fail(e.message); }
if (/supabase\.(co|com)/.test(adminUrl) || process.env.DATABASE_URL === adminUrl) fail("RESTORE_ADMIN_URL looks like the live database. Use a separate scratch server.");

const file = process.argv[2] ? path.resolve(process.argv[2]) : (() => {
  const newest = sortBackups(readdirSync(dir).filter(Boolean))[0];
  return newest ? path.join(dir, newest) : null;
})();
if (!file) fail(`No backup given and none found in ${dir}. Run scripts/backup.mjs first.`);

const dbName = safeDbName(process.env.RESTORE_DB_NAME ?? tempDbName());
const tempUrl = splitUrl(withDatabase(adminUrl, dbName)).url;
const psql = (url, sql) => run("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", url, "--command", sql], admin.password);

console.log(`Restoring ${file}\n  into temporary database "${dbName}" on ${maskUrl(adminUrl)}`);
let exitCode = 1;
try {
  const created = psql(admin.url, `create database ${dbName}`);
  if (created.status !== 0) fail(`Could not create the scratch database:\n${created.stderr}`);

  // what a Supabase database expects to exist; harmless on a plain server
  const prep = psql(tempUrl, `
    create extension if not exists btree_gist; create extension if not exists pgcrypto;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;`);
  if (prep.status !== 0) fail(`Could not prepare the scratch database:\n${prep.stderr}`);

  const restore = run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", tempUrl, file], admin.password);
  const errors = restore.stderr.split("\n").filter((l) => /error:/i.test(l));
  if (errors.length) console.log(`  ${errors.length} message(s) while restoring (often harmless Supabase-specific objects):\n    ${errors.slice(0, 5).join("\n    ")}`);

  const counts = KEY_TABLES.map((table) => {
    const r = psql(tempUrl, `select count(*) from public.${table}`);
    return { table, rows: r.status === 0 ? Number(r.stdout.trim()) : null };
  });
  const verdict = judgeRestore(counts, errors.length);
  console.log("\n  table               rows");
  for (const c of counts) console.log(`  ${c.table.padEnd(18)} ${c.rows === null ? "MISSING" : c.rows}`);
  if (verdict.ok) {
    console.log("\n✓ Restore test passed: the backup restores and the data is there.");
    exitCode = 0;
  } else {
    console.error(`\n✗ Restore test FAILED: ${verdict.problems.join("; ")}`);
  }
} finally {
  const dropped = psql(admin.url, `drop database if exists ${dbName} with (force)`);
  console.log(dropped.status === 0 ? `  temporary database "${dbName}" removed` : `  ! could not remove "${dbName}": remove it by hand`);
}
process.exit(exitCode);
