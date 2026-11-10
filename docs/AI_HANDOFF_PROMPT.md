# Prompt for Ox Alpha – explain the Horti Magici app and its code

> How to use: paste everything below the line into Ox Alpha, and give it the code
> (repository: https://github.com/Seddik-gif/horti-magici – private, so attach the files, a zip, or grant access).
> The most important files to attach if you cannot give the whole repo are listed in section 9.

---

## ROLE

You are a senior full-stack engineer and technical writer. I am handing you a finished (but still evolving)
web application. Read the code I give you and the context below, then **explain the whole project to me as if
you were onboarding a new developer who must be able to maintain and extend it tomorrow**.
Do not invent features. If something in the code contradicts this brief, trust the code and tell me.
If you cannot see a file, say so instead of guessing.

## 1. WHAT THE APP IS

**HORTI MAGICI – staff management and shift scheduling** for a bar in Italy (timezone Europe/Rome, week starts Monday).
Two administrators (Stefano, Tessa – identical rights) manage a team of employees. It is a bilingual
(Italian default, English) responsive web app / PWA: admins mostly on computers, employees on phones.

Workflow:
1. Admins create employees (invitation by email; no public sign-up).
2. Admins open a weekly **availability request**; employees get a notification.
3. Employees enter availability: per day Available/Unavailable, any number of custom time intervals,
   overnight allowed (e.g. 18:00–01:00), optional notes. Saved as draft, then submitted.
4. The submission is **pending until an admin confirms it** (or asks for changes with a note).
5. Admins plan shifts on a **horizontal calendar** (07:00 → 02:00 next day). Employees see the **same calendar,
   read-only and live**.
6. Employees can only *ask*: take an admin-posted **open shift**, or **offer** a time to work. An admin approves
   (creating the real shift) or declines. **Only admins can create/move/resize/delete shifts.**
7. Admins review and publish a week (immutable versioned snapshot), then copy a generated message to the existing
   WhatsApp staff group **manually** (the app never sends WhatsApp messages).
8. Notifications: bell + counter + pop-up toasts with a chime, realtime, optional email through Resend.

## 2. TECH STACK

Next.js 16 (App Router, `proxy.ts` instead of middleware, Turbopack) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 (brand tokens in `src/app/globals.css`) · hand-written shadcn-style UI primitives ·
Supabase (PostgreSQL, Auth, Realtime) via `@supabase/ssr` · next-intl (it default, en) · Zod · React Hook Form ·
date-fns / `@date-fns/tz` · FullCalendar **v6** (month view only) · Vitest + PGlite (real Postgres engine in tests) ·
Vercel (cron in `vercel.json`) · Resend (optional email).

## 3. ARCHITECTURE IN ONE PARAGRAPH

Security lives **in the database**: Row Level Security on every table, `SECURITY DEFINER` SQL functions for every
multi-step write (so each is one transaction that also writes the audit log and notifications), triggers that
protect columns, exclusion constraints that forbid overlapping shifts/intervals. Server components load data with the
signed-in user's Supabase client (RLS applies); server actions are thin wrappers that validate with Zod and call
`supabase.rpc(...)`. The service-role key is used only for invitations/provisioning and the cron job. Role checks on
pages use `src/lib/auth/guards.ts` (re-reads the role from the DB). Times are stored as `timestamptz`; calendar days
are Europe/Rome; overnight intervals end on the next day. Notifications are stored language-neutral
(type + params) and rendered in the reader's language.

## 4. DATABASE (supabase/migrations, applied in order)

| # | File | What it adds |
|---|------|--------------|
| 1 | `…01_core_schema.sql` | enums, `profiles` (+role/active/colour/lang), `availability_requests/submissions/days/time_windows`, `weekly_schedules`, `shifts` (GIST exclusion: no overlap per employee), `schedule_versions`, `notifications`, `notification_deliveries`, `audit_logs` (append-only), `app_settings`; helpers `is_admin()`, `is_active_user()`, new-user trigger (role always `employee`), column-protection trigger, `team_directory` view, all RLS policies, realtime publication |
| 2 | `…02_availability_functions.sql` | `notify_users` (dedupe), `create/send/close_availability_request`, `save_availability` (validates week, converts Rome times, notifies both admins), `run_availability_reminders` (cron) |
| 3 | `…03_shifts.sql` | `monday_of`, `availability_status` (chains touching windows), `touch_schedule`, `save_shift` (availability mismatch needs acknowledgement, audited override), `delete_shift` |
| 4 | `…04_publishing.sql` | `schedule_versions` immutable, `published_schedules` view, `publish_schedule` (row lock, snapshot without notes, audit, notifications) |
| 5 | `…05_whatsapp_shares.sql` | `whatsapp_shares` + `prepare_whatsapp_share`, `mark_whatsapp_step` (copied / opened / manually confirmed) |
| 6 | `…06_shift_hours.sql` | shift window setting (07:00–02:00) enforced inside `save_shift` |
| 7 | `…07_live_calendar_requests.sql` | `team_shifts` view (employee-safe), `schedule_pulse` + trigger (realtime for employees), shift notification trigger, `open_shifts`, `shift_requests`, functions `create/cancel_open_shift`, `request_open_shift`, `offer_shift`, `withdraw_shift_request`, `decide_shift_request` |
| 8 | `…08_open_shift_slots_left.sql` | `slots` = places still free |
| 9 | `…09_employees_read_shift_hours.sql` | employees may read the shift-hours setting |
| 10 | `…10_availability_review.sql` | `review_status` (pending/confirmed/changes_requested), `review_availability`, trigger blocking employees from writing status/review fields directly |
| 11 | `…11_windows_fk_to_submissions.sql` | direct FK so the API can embed time windows (see "Lessons" below) |

## 5. FEATURES → WHERE THE CODE IS

- **Auth / roles / i18n**: `src/proxy.ts`, `src/lib/supabase/*`, `src/lib/auth/*`, `src/i18n/*`, `messages/it.json|en.json`,
  `src/app/[locale]/login`, `set-password`, `src/app/auth/confirm/route.ts`, `scripts/provision-admin.mjs`.
- **Employees** (admin): `src/app/[locale]/(app)/admin/employees/*`, `src/lib/employees/*`, `src/lib/validation/employee.ts`.
- **Availability**: admin `…/admin/availability/*` (list, create, overview with horizontal timeline
  `src/components/schedule/availability-timeline.tsx`, confirm/request-changes `review-panel.tsx`);
  employee `…/employee/availability/[id]/*`; logic `src/lib/availability/{logic,actions}.ts`.
- **Shift calendar**: `src/components/schedule/{schedule-calendar,week-timeline,shift-dialog,offer-dialog}.tsx`,
  pure logic `src/lib/scheduling/{shift-hours,analysis,snapshot,load-week}.ts`, actions `actions.ts`, `requests-actions.ts`,
  `publish-actions.ts`. Admin page `…/admin/schedule/*` (week, month, review, versions), employee page `…/employee/schedule`.
- **Requests inbox** (admin): `…/admin/requests/*`.
- **Notifications**: bell + pop-ups + sound `src/components/layout/notification-bell.tsx`, `src/lib/notifications/{render,ingest,sound,dispatch}.ts`,
  realtime helper `src/lib/supabase/realtime.ts`, page refresher `realtime-refresh.tsx`, cron `src/app/api/cron/maintenance/route.ts`.
- **WhatsApp (manual)**: `src/lib/whatsapp/{message,actions}.ts`, panel `…/admin/schedule/versions/whatsapp-panel.tsx`,
  feasibility study `docs/whatsapp-api-feasibility.md`.

## 6. KEY DESIGN DECISIONS (explain the *why*)

1. Draft vs published exists for notifying/sharing, but employees see the **live** calendar (decision made with the owner).
2. Employees can never write shifts; every employee action is a *request* decided by an admin.
3. Overnight handling: end time ≤ start means "next day"; allowed shift window 07:00 → 02:00 (configurable in `app_settings.shift_hours`).
4. Availability mismatch must be acknowledged and is audited; warning thresholds are configurable and **no legal limits are hard-coded**.
5. WhatsApp: the official Groups API cannot attach an existing group (invite-only, max 8 members, OBA required) – so manual copy/paste, with
   "confirmed sent" being only the admin's own statement.
6. Email is "sent" only when Resend returns an id; `delivered_at` stays empty (acceptance ≠ delivery).
7. FullCalendar runs in UTC mode on Rome wall-clock strings so the browser's timezone never shifts shifts; the week view is a custom horizontal
   timeline (assignLanes stacks simultaneous shifts).
8. Notification delivery = realtime push **plus** catch-up on reconnect/visibility/15 s poll; unique channel names (React Strict Mode safe).

## 7. TESTING (126 tests, `npm test`)

Pure unit tests (Rome time/DST, availability validation, scheduling analysis, snapshots, WhatsApp message, i18n key parity, notification rendering/ingest)
and **database tests that run every migration on PGlite** with Supabase stubs: constraints, RLS, privacy (employees can't read others' availability or live
shifts), publishing/versioning, requests, review, shift hours, and a schema test that checks the foreign keys the API embeds rely on.
Also `npm run typecheck`, `npm run lint`, `npm run build`. (Do not run `build` while `dev` is running – they share `.next`.)

## 8. RUN IT LOCALLY (no cloud account)

Docker → `npx supabase start -x studio,imgproxy,vector,edge-runtime,logflare,supavisor` (ports 54420–54429) → write `.env.local` from
`npx supabase status -o env` → `node --env-file=.env.local scripts/seed-local.mjs` (2 admins + 3 employees, passwords go to `.local-test-accounts.json`) →
`npm run dev -- -p 3100`. Invitation emails appear at http://127.0.0.1:54424. Two logins side by side: `localhost:3100` and `127.0.0.1:3100`.

## 9. IF YOU CAN READ ONLY SOME FILES, READ THESE

`README.md`, `supabase/migrations/*.sql`, `src/lib/auth/guards.ts`, `src/proxy.ts`, `src/lib/scheduling/*.ts`, `src/lib/availability/*.ts`,
`src/components/schedule/week-timeline.tsx`, `src/components/schedule/schedule-calendar.tsx`, `src/components/layout/notification-bell.tsx`,
`src/lib/supabase/realtime.ts`, `tests/db-*.test.ts`, `messages/it.json`.

## 10. LESSONS / BUGS FOUND WHILE TESTING (be honest about these in your explanation)

- A missing direct foreign key made API embeds of time windows fail silently (admin overview and employee form looked empty) – fixed by migration 11 and guarded by `tests/schema-relations.test.ts`.
- Realtime subscriptions reused channel names, so in development (Strict Mode) events could be lost; fixed with unique topics, reconnect handling and polling fallback.
- Local Realtime needs a restart after schema changes; PostgREST may need `notify pgrst, 'reload schema'`.
- Next.js dev + production build share `.next` and corrupt each other.

## 11. KNOWN GAPS (not done / not verified)

Phase 7 (final hardening: full security review, accessibility audit, responsive polish, deployment rehearsal) is **not done**.
Nothing has run against a real hosted Supabase project or real Resend account yet. The notification **sound** has not been verified by ear.
No PWA icons/service worker (manifest only); the brand logo file `public/brand/horti-magici-logo.png` was never supplied (text wordmark used).
"Schedule ready for publication" admin notification is not implemented. Availability submissions are not blocked after the deadline.
Row types in `src/types/database.ts` are hand-written.

## 12. WHAT I WANT FROM YOU (output format)

1. **Executive summary** (10 lines): what the product does and its architecture.
2. **System diagram in text** (components, data flow for: submit availability → admin confirm → plan shifts → employee sees live → publish → WhatsApp message).
3. **Module-by-module walkthrough**: for each area in section 5 explain responsibilities, the main functions, and quote the important code with line-level
   commentary (keep quotes short). Include the SQL functions and RLS policies, explaining exactly what each one prevents.
4. **Security analysis**: what stops an employee from (a) reading others' availability, (b) editing shifts, (c) confirming their own availability, (d) publishing, (e) escalating role. Point to the exact policy/trigger/function. List any weakness you find.
5. **Time handling explained**: overnight intervals, DST days, why wall-clock strings are used in the calendar.
6. **Realtime/notification pipeline** end to end, including failure modes and the fallback.
7. **Testing strategy** and what it does *not* cover.
8. **Risks and recommended next steps**, ordered by priority, including the Phase 7 checklist and anything you would change before production.
9. **Glossary** of the domain terms (open shift, request, offer, pulse, snapshot, version…).
10. End with **questions** you would ask the owner.

Write clearly for a developer who has never seen the project. Use headings, tables where helpful, and short code excerpts. Do not pad.
