# Backup and restore

The data that matters (people, schedules, versions, requests, audit log) lives in the Supabase Postgres database.
Supabase keeps its own daily backups on paid plans; this gives you a copy **you** hold, and a way to prove it works.

## What you need once

* PostgreSQL client tools on the PC that runs the backup (`pg_dump`, `pg_restore`, `psql`). On Windows install
  "PostgreSQL" and tick *Command Line Tools*; make sure they are on `PATH`.
* The database connection string: Supabase → Project Settings → Database → *Connection string* (URI, direct connection).
* Optional, for an offsite copy: [rclone](https://rclone.org/) configured with a remote (Cloudflare R2, Google Drive, …).

## Take a backup

```bash
DATABASE_URL="postgresql://postgres:YOUR-PASSWORD@db.YOUR-REF.supabase.co:5432/postgres" node scripts/backup.mjs
```

It writes `backups/horti-YYYYMMDD-HHMM.dump` (UTC time), checks that the file can be read back, and deletes all but the
newest 14 (`BACKUP_KEEP`). A failed run never leaves a half-written file behind. The password is passed to `pg_dump`
through the environment, not on the command line.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | – (required) | what to back up |
| `BACKUP_DIR` | `backups` | where files go |
| `BACKUP_KEEP` | `14` | how many to keep |
| `BACKUP_SCHEMAS` | `public,auth` | schemas to dump (`auth` holds the logins) |
| `HORTI_RCLONE_REMOTE` | – | used with `--remote` for the offsite copy |

### Nightly local + weekly offsite

* **Nightly:** schedule `node scripts/backup.mjs` every night (Windows Task Scheduler → *Create Basic Task* → daily →
  start a program `node` with argument `scripts/backup.mjs`, start in this folder, with `DATABASE_URL` set as an
  environment variable of the task).
* **Weekly offsite:** a second task, weekly, running `node scripts/backup.mjs --remote`
  (with `HORTI_RCLONE_REMOTE=r2:horti-backups`). The copy is uploaded with `--immutable`, so an offsite file is never overwritten.

## Prove that a backup restores

A backup you have never restored is a hope, not a backup. Do this after the first backup and then every month:

```bash
RESTORE_ADMIN_URL="postgresql://postgres:PASSWORD@localhost:5432/postgres" node scripts/restore-test.mjs
```

`RESTORE_ADMIN_URL` is a **scratch** PostgreSQL server (a local install, or
`docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:17`). The script refuses addresses that look like the live
Supabase project. It then:

1. creates a temporary database,
2. restores the newest backup (or the file you pass) into it,
3. counts the rows of the key tables (`profiles`, `locations`, `weekly_schedules`, `shifts`, `schedule_versions`, `audit_logs`),
4. deletes the temporary database and prints **✓ passed** or **✗ FAILED** with the reason (exit code 0 / 1).

A few messages about Supabase-specific objects (extensions, roles, policies that need Supabase's own schemas) are
normal on a plain server; the verdict only depends on the key tables and the people being there.

## Restoring for real (disaster recovery)

1. Create a fresh Supabase project (or empty database).
2. Apply `supabase/migrations/*.sql` first (so extensions, roles and realtime publications exist).
3. Restore the data: `pg_restore --data-only --no-owner --disable-triggers --dbname "<new connection string>" backups/<file>.dump`
4. Point the app's environment variables (`NEXT_PUBLIC_SUPABASE_URL`, keys) at the new project and redeploy.

## Honest limits

* The scripts have been unit-tested for their logic (file names, retention, password handling, verdict), but
  **have not been run against a real database yet**. Do the first backup and restore test yourself and read the output.
* Uploaded files are not part of this app (there are none), so the database dump is the whole backup.
* Chat messages and notification logs are deleted after 90 days by design, so older backups contain what existed then.
