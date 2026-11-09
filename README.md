# Horti Magici – Staff scheduling

Bilingual (IT default / EN) staff management and shift scheduling PWA for Horti Magici.
Next.js (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Realtime) · next-intl.

> **Status: Phases 1–6 of 7 complete** (… publishing, manual WhatsApp sharing).
> Final hardening (security review, responsive pass, deployment checks) is not done yet.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

### Credentials required (none are included)

| Variable | Where to get it | Needed for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | everything |
| `SUPABASE_SERVICE_ROLE_KEY` | same page. **Server-only, never `NEXT_PUBLIC_`** | invitations, admin provisioning |
| `NEXT_PUBLIC_SITE_URL` | your deployed URL | invitation links |
| `RESEND_API_KEY`, `EMAIL_FROM` | resend.com (optional) | email notifications |
| `CRON_SECRET` | any long random string | deadline reminders + email retry job |

Without Supabase credentials the app runs and shows a "not configured" notice on the login page.

### Database

1. Create a Supabase project.
2. Apply `supabase/migrations/*.sql` (`supabase db push`, or paste into the SQL editor).
   The migrations are tested against PGlite (a real Postgres engine) with Supabase stubs, but **not yet against an actual Supabase project**.
3. Auth → Settings: **disable "Allow new users to sign up"** (no public registration).
4. Auth → Email Templates → *Invite user* / *Reset password*: link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (use `type=recovery` for reset).
5. Provision the two administrators (invitation email, they choose their own password):

```bash
node --env-file=.env.local scripts/provision-admin.mjs <stefano-email> Stefano
node --env-file=.env.local scripts/provision-admin.mjs <tessa-email> Tessa
```

### Notifications and email

In-app notifications (bell, unread counter, Realtime) need no extra setup. Email is sent through Resend only when
`RESEND_API_KEY` and `EMAIL_FROM` are set. A delivery is recorded as `sent` when Resend accepts it and returns an id;
`delivered_at` stays empty because acceptance is not proof of delivery (a Resend webhook would be needed for that).
`vercel.json` runs `/api/cron/maintenance` daily (deadline reminders + retrying unsent emails); Vercel Hobby only
allows daily cron jobs, so use a Pro plan or `pg_cron` for hourly runs. Emails are also sent right after each action.

## Scripts

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`

`tests/db.test.ts` applies every migration to an in-process PostgreSQL (PGlite) and tests constraints, RLS and the SQL functions.

## Architecture notes

- **Security is in the database**: RLS on every table; `is_admin()` helper; a trigger stops employees
  changing role/active/email/name; employees never read `shifts` or drafts – they read immutable
  `schedule_versions` snapshots written at publication.
- **Time**: instants are `timestamptz`; calendar days are Europe/Rome (`src/lib/time/rome.ts`).
  Overnight intervals end on the next day; DB exclusion constraints forbid overlapping shifts/intervals.
- **Roles**: `src/lib/auth/guards.ts` (server) re-checks the role from the DB on every protected page.
- **i18n**: `messages/it.json` / `en.json`, tested for key parity. Language is stored in `profiles.preferred_language`.
- UI primitives in `src/components/ui` follow shadcn/ui conventions (hand-written; the shadcn CLI was not run).

- **Shifts**: all writes go through `save_shift` / `delete_shift` (SQL, transactional). Availability mismatches must be acknowledged and are audited; overlaps are blocked by a DB constraint. FullCalendar v6 runs in UTC mode on Rome wall-clock strings so browser timezone never shifts shifts.

- **Publishing**: `publish_schedule` (SQL) locks the week, writes an immutable `schedule_versions` snapshot (no internal notes), audits, and notifies; employees read only the `published_schedules` view.

- **WhatsApp**: manual copy/open/confirm flow only; see `docs/whatsapp-api-feasibility.md` for why the official Groups API cannot reach the existing group.

## Known gaps

- The admin notification "schedule ready for publication" is not implemented (no clear trigger defined yet).

- Shift week view/summary uses `app_settings.scheduling_rules` (long-shift and weekly-hours thresholds are operational warnings, off or 10h by default; no legal limits are encoded).
- Drag/resize, the shift dialog and the month/week UI were checked visually with sample data only; they have not been exercised end-to-end against a live database.

- The logo file `public/brand/horti-magici-logo.png` was not in the repository; a text wordmark is shown until it is added.
- No PWA icons / service worker yet (manifest only).
- Row types in `src/types/database.ts` are hand-written; generate them once a project is linked.
- Auth flows, Realtime subscriptions, the notification bell and the email sender are untested against a live Supabase/Resend project.
- Submissions are not blocked after the deadline passes; only the admin closing the request stops edits.

## Deploy (Vercel)

Import the repo, set the environment variables above, deploy. Set Supabase Auth *Site URL* and redirect URLs to the Vercel domain.

## Local testing (no cloud account needed)

Requires Docker. Uses ports 54420–54429 so it does not clash with another local Supabase project.

```bash
npx supabase start -x studio,imgproxy,vector,edge-runtime,logflare,supavisor   # applies supabase/migrations
# write .env.local from `npx supabase status -o env` (API_URL, ANON_KEY, SERVICE_ROLE_KEY) + NEXT_PUBLIC_SITE_URL=http://localhost:3100
node --env-file=.env.local scripts/seed-local.mjs    # 2 admins + 3 employees; passwords go to .local-test-accounts.json
npm run dev -- -p 3100
```
Emails (invitations) arrive in the local mailbox at http://127.0.0.1:54424. Stop with `npx supabase stop`.

### Live calendar (admin and employees)

Admins edit the calendar (`shifts`); employees see the same calendar read-only through the `team_shifts` view, kept live by
Realtime on `schedule_pulse` / `open_shifts` / `shift_requests`. Only admins can create, move, resize or delete shifts.
Employees can only *ask*: request an open shift or offer a time; an admin approves (which creates the real shift) or declines.
If you add tables to the Realtime publication on a local stack, restart it once: `docker restart supabase_realtime_horti-magici`.
To keep two logins side by side in one browser, use `http://localhost:3100` for one and `http://127.0.0.1:3100` for the other
(`allowedDevOrigins` in `next.config.ts` makes the second one work in dev).
