// Pure helpers for scripts/backup.mjs and scripts/restore-test.mjs (no I/O, so they are unit-tested).

const NAME_RE = /^horti-(\d{8})-(\d{4})\.dump$/;

/** horti-20261109-2314.dump (UTC), sortable by name. */
export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `horti-${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}.dump`;
}

export const isBackupName = (name) => NAME_RE.test(name);

/** Newest first. Ignores anything that is not one of our backup files. */
export function sortBackups(files) {
  return files.filter(isBackupName).sort().reverse();
}

/** Which backups to delete so that only the newest `keep` remain. Never returns a file we did not create. */
export function selectToDelete(files, keep) {
  const n = Math.max(1, Math.floor(keep));
  return sortBackups(files).slice(n);
}

/** A connection string that is safe to print: the password is hidden. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "(invalid connection string)";
  }
}

/**
 * Splits a postgres URL into one without the password and the password itself, so the password goes to the
 * child process through PGPASSWORD instead of the command line (command lines are visible to other users).
 */
export function splitUrl(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("The connection string must start with postgres:// or postgresql://");
  const password = decodeURIComponent(u.password);
  u.password = "";
  return { url: u.toString(), password };
}

/** The same server, another database. */
export function withDatabase(url, database) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Database names are put into SQL, so only plain lowercase identifiers are accepted. */
export function safeDbName(name) {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
  return name;
}

export function tempDbName(date = new Date()) {
  return safeDbName(`horti_restore_${date.getTime().toString(36)}`);
}

/** Tables whose row counts prove that a restore really brought the data back. */
export const KEY_TABLES = ["profiles", "locations", "weekly_schedules", "shifts", "schedule_versions", "audit_logs"];

/** Turns `[{table, rows}]` into a verdict: the restore is good when the key tables exist and the people are there. */
export function judgeRestore(counts, errorCount) {
  const by = Object.fromEntries(counts.map((c) => [c.table, c.rows]));
  const missing = KEY_TABLES.filter((t) => by[t] === undefined || by[t] === null);
  const problems = [];
  if (missing.length) problems.push(`missing tables: ${missing.join(", ")}`);
  if (!missing.includes("profiles") && by.profiles === 0) problems.push("no profiles were restored");
  return { ok: problems.length === 0, problems, errorCount };
}
