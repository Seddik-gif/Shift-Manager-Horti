# Security notes

Security lives in the database: every table has Row Level Security, every multi-step write is one `SECURITY DEFINER`
SQL function that re-checks who is calling, and the server code never trusts the browser. This file records what was
reviewed in the hardening pass, what was fixed, and what is left for you.

## Review method

1. The migrations were applied to a **real Supabase Postgres** (local stack) and the schema was audited with SQL
   (queries below). The same checks now run on every `npm test` in `tests/db-security.test.ts`, so a future table or
   function that forgets a grant or a policy fails the test instead of shipping.
2. The app code was searched for dangerous sinks, secret exposure, open redirects and unauthenticated service-role use.
3. Both roles (admin and employee) were used in a browser against the real stack.

## Findings fixed (migration `…0019_hardening.sql`, plus app changes)

| Finding | Why it mattered | Fix |
|---|---|---|
| Chat access check accepted any user id | any signed-in person could ask "is X in this private chat?" | check answers only for the caller; the 2-argument form is internal |
| Tables made after migration 1 kept Supabase's default grants (anon could `TRUNCATE`, signed-in users `TRUNCATE/REFERENCES/TRIGGER`) | RLS does not cover `TRUNCATE`; defence in depth | all revoked; default privileges changed so new tables start closed |
| Helper and trigger functions executable by `anon`/everyone | needless API surface | revoked; trigger functions closed to everyone but the database |
| `btree_gist` installed in `public` | ~80 extension functions exposed as API endpoints | moved to the `extensions` schema |
| Views could be written to by `authenticated` | latent risk if a view ever became updatable | write privileges revoked |
| Push keys readable through the API | a device's keys let anyone push to it | column privileges removed: only the server reads them (found by a test, not by eye) |
| Cron secret compared with `!==` | timing side channel | constant-time digest comparison |
| No browser security headers | clickjacking, MIME sniffing, referrer leaks | `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP, `base-uri`/`form-action`/`object-src` |

## Checked and fine

* No `dangerouslySetInnerHTML`, `innerHTML`, `eval` anywhere in `src/`.
* Service-role client is used only in: invitations (after an admin check), the cron job (after the secret), push and
  email dispatch (server-only modules). The only `NEXT_PUBLIC_` values are the Supabase URL/anon key, the site URL and the VAPID *public* key.
* No open redirects: the auth callback redirects to fixed paths on its own origin; the `?loc=` link only sets a cookie that is
  re-validated against what RLS lets the person see.
* Push links are same-origin paths only (`//host` and absolute URLs are rejected, tested).
* The desktop shell: the hosted page has **no** access to the shell's commands; the database address lives in the
  Windows Credential Manager and is never sent to a page.
* Employees can only *ask* (requests, swaps, absences); only functions that check `is_admin()` change the schedule.

## Accepted risks / for you to decide

* **Views run with their owner's rights** (`team_shifts`, `team_directory`, `published_schedules`) so employees can see the
  shared calendar without reading the shifts table. Each view filters by `is_active_user()` and by the person's locations. They are intentional.
* **`log_audit` is callable by any admin** with any text, so an admin could add a misleading entry. They cannot impersonate
  another person (the actor is always the caller) or edit/delete entries (the table is append-only).
* **No content-security-policy for scripts.** Next.js needs a nonce-based policy to allow its inline scripts; the non-script
  directives are set. Add a nonce CSP if you want the strictest setting.
* **Brute-force protection** for sign-in is Supabase Auth's rate limiting. Check the limits in the project's Auth settings.
* **Sign-ups must be disabled** in Supabase Auth (the app has no public registration). Do this on the hosted project.
* **Service-role key**: keep it in the hosting environment only. Never in the Windows program, the repository or `NEXT_PUBLIC_*`.

## The audit queries

Run in the SQL editor of a real project (they return no rows when everything is closed):

```sql
-- tables without RLS
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
-- anything anonymous can touch
select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
-- security-definer functions without a pinned search_path
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
-- our functions callable by anon
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
```

## Before going live (checklist)

- [ ] Supabase Auth: sign-ups **off**; Site URL and redirect URLs set to the real domain; invite/recovery email templates installed.
- [ ] Environment variables set on the host (service-role key server-only), `CRON_SECRET` long and random.
- [ ] `node scripts/generate-vapid.mjs` keys set if you want push; Resend key if you want email.
- [ ] Run the audit queries above on the hosted project; run `npm run backup` and `npm run restore:test` once.
- [ ] Try the whole weekly cycle with two real accounts (admin + employee) on a phone.
