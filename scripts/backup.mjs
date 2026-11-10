// Backs up the database with pg_dump, keeps the newest N copies and (optionally) copies one offsite with rclone.
//
//   DATABASE_URL="postgresql://postgres:***@db.<ref>.supabase.co:5432/postgres" node scripts/backup.mjs
//   node scripts/backup.mjs --remote      # also copy to HORTI_RCLONE_REMOTE (e.g. "r2:horti-backups")
//
// Needs the PostgreSQL client tools (pg_dump, pg_restore) on PATH. See docs/BACKUP.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { backupFileName, maskUrl, selectToDelete, splitUrl } from "./lib/backup-utils.mjs";

const url = process.env.DATABASE_URL;
const dir = path.resolve(process.env.BACKUP_DIR ?? "backups");
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const schemas = (process.env.BACKUP_SCHEMAS ?? "public,auth").split(",").map((s) => s.trim()).filter(Boolean);
const remote = process.argv.includes("--remote") ? process.env.HORTI_RCLONE_REMOTE : undefined;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.error) fail(r.error.code === "ENOENT" ? `${cmd} was not found. Install the PostgreSQL client tools and try again.` : r.error.message);
  return r;
}

if (!url) fail("Set DATABASE_URL to the database connection string (Supabase → Project Settings → Database).");
if (process.argv.includes("--remote") && !remote) fail("--remote needs HORTI_RCLONE_REMOTE (an rclone remote such as r2:horti-backups).");
let conn;
try { conn = splitUrl(url); } catch (e) { fail(e.message); }

mkdirSync(dir, { recursive: true });
const file = path.join(dir, backupFileName());
console.log(`Backing up ${maskUrl(url)}\n  schemas: ${schemas.join(", ")}\n  to: ${file}`);

const dump = run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", ...schemas.flatMap((s) => ["--schema", s]), "--file", file, "--dbname", conn.url], { PGPASSWORD: conn.password });
if (dump.status !== 0) {
  if (existsSync(file)) rmSync(file); // never leave a half-written backup that looks real
  fail(`pg_dump failed:\n${dump.stderr}`);
}

// a backup nobody has opened is not a backup: make sure pg_restore can read it
const list = run("pg_restore", ["--list", file]);
const size = statSync(file).size;
if (list.status !== 0 || size < 1024) {
  rmSync(file);
  fail(`The backup file is not readable (${size} bytes). It was removed.\n${list.stderr}`);
}
console.log(`✓ Backup written (${(size / 1024).toFixed(0)} KB, ${list.stdout.split("\n").filter((l) => l && !l.startsWith(";")).length} objects)`);

for (const old of selectToDelete(readdirSync(dir), keep)) {
  rmSync(path.join(dir, old));
  console.log(`  removed old backup ${old}`);
}

if (remote) {
  const copy = run("rclone", ["copy", file, remote, "--immutable"]);
  if (copy.status !== 0) fail(`Local backup is safe, but the offsite copy to ${remote} failed:\n${copy.stderr}`);
  console.log(`✓ Copied to ${remote}`);
}

console.log(`\nNext step: prove it restores →  node scripts/restore-test.mjs "${file}"`);
