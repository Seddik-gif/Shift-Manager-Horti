-- Horti Magici – core schema (Phase 1)
-- Timezone policy: every instant is stored as timestamptz (UTC). "Calendar days" are
-- Europe/Rome dates. Overnight intervals are represented by ends_at on the following day.

create extension if not exists btree_gist;

-- ───────────────────────── Enums ─────────────────────────
create type public.user_role as enum ('admin', 'employee');
create type public.request_status as enum ('draft', 'open', 'closed');
create type public.submission_status as enum ('draft', 'submitted');
create type public.schedule_status as enum ('draft', 'published');

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── profiles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null default '',
  email text not null,
  phone text,
  job_position text,
  color text not null default '#234A49' check (color ~* '^#[0-9a-f]{6}$'),
  is_active boolean not null default true,
  role public.user_role not null default 'employee',
  preferred_language text not null default 'it' check (preferred_language in ('it', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_active_idx on public.profiles (is_active, role);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Role helpers. SECURITY DEFINER so policies on profiles can call them without recursion.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_active
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- A profile is created automatically when Supabase Auth creates a user (invitation).
-- The role is ALWAYS 'employee' here: metadata supplied by a client is never trusted.
-- Admins are promoted only through scripts/provision-admin.mjs (service role).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, first_name, last_name, email, phone, job_position, color, preferred_language)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'job_position', ''),
    case when new.raw_user_meta_data ->> 'color' ~* '^#[0-9a-f]{6}$'
         then new.raw_user_meta_data ->> 'color' else '#234A49' end,
    case when new.raw_user_meta_data ->> 'preferred_language' = 'en' then 'en' else 'it' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Employees may only change their own phone and language. Everything else is admin-only.
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new; -- service role / admin
  end if;
  if new.id <> old.id
     or new.role <> old.role
     or new.is_active <> old.is_active
     or new.email <> old.email
     or new.first_name <> old.first_name
     or new.last_name <> old.last_name
     or new.job_position is distinct from old.job_position
     or new.color <> old.color
     or new.created_at <> old.created_at then
    raise exception 'Only administrators can change these profile fields' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Safe colleague directory for employees (no email / phone).
create view public.team_directory as
  select id, first_name, last_name, job_position, color, is_active
  from public.profiles
  where public.is_active_user();
grant select on public.team_directory to authenticated;

-- ───────────────────────── availability ─────────────────────────
create table public.availability_requests (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1), -- Monday
  deadline timestamptz not null,
  message text,
  status public.request_status not null default 'draft',
  created_by uuid not null references public.profiles (id),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger availability_requests_updated_at before update on public.availability_requests
  for each row execute function public.set_updated_at();

create table public.availability_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.availability_requests (id) on delete cascade,
  employee_id uuid not null references public.profiles (id),
  status public.submission_status not null default 'draft',
  notes text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, employee_id)
);
create index availability_submissions_employee_idx on public.availability_submissions (employee_id);
create trigger availability_submissions_updated_at before update on public.availability_submissions
  for each row execute function public.set_updated_at();

-- One row per day an employee has answered for (explicit "unavailable" is a real answer).
create table public.availability_days (
  submission_id uuid not null references public.availability_submissions (id) on delete cascade,
  day date not null,
  is_available boolean not null,
  note text,
  primary key (submission_id, day)
);

-- Custom intervals. ends_at may fall on the next calendar day (overnight).
create table public.availability_time_windows (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  day date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  foreign key (submission_id, day) references public.availability_days (submission_id, day) on delete cascade,
  -- no overlapping intervals for the same submission
  exclude using gist (submission_id with =, tstzrange(starts_at, ends_at) with &&)
);
create index availability_windows_submission_idx on public.availability_time_windows (submission_id);

-- ───────────────────────── schedules & shifts ─────────────────────────
create table public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1),
  status public.schedule_status not null default 'draft',
  current_version integer not null default 0,
  has_unpublished_changes boolean not null default false,
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger weekly_schedules_updated_at before update on public.weekly_schedules
  for each row execute function public.set_updated_at();

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.weekly_schedules (id) on delete cascade,
  employee_id uuid not null references public.profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  job_position text,
  notes text,
  availability_override boolean not null default false,
  override_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  -- an employee can never hold two overlapping shifts, even across weeks
  exclude using gist (employee_id with =, tstzrange(starts_at, ends_at) with &&)
);
create index shifts_schedule_idx on public.shifts (schedule_id);
create index shifts_employee_time_idx on public.shifts (employee_id, starts_at);
create trigger shifts_updated_at before update on public.shifts
  for each row execute function public.set_updated_at();

-- Immutable snapshot of what employees see. Editing shifts never changes a published version.
create table public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.weekly_schedules (id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  published_by uuid not null references public.profiles (id),
  published_at timestamptz not null default now(),
  unique (schedule_id, version)
);

-- ───────────────────────── notifications ─────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  params jsonb not null default '{}'::jsonb, -- rendered in the viewer's language at read time
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('email')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_message_id text,
  error text,
  attempted_at timestamptz,
  delivered_at timestamptz, -- set ONLY when the provider has confirmed
  unique (notification_id, channel)
);

-- ───────────────────────── audit & settings ─────────────────────────
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value) values
  ('timezone', '"Europe/Rome"'),
  ('week_starts_on', '1'),
  -- Warning thresholds are operational preferences, NOT legal limits. Legal rules stay
  -- disabled until someone has verified them for Horti Magici's contract type.
  ('scheduling_rules', '{"long_shift_warning_hours": 10, "weekly_hours_warning": null, "legal_limits_enabled": false}');

-- Audit entries can be appended but never edited or removed.
create or replace function public.audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- Admin-callable helper so server actions can log under the caller's identity.
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id text, p_changes jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_changes, '{}'::jsonb));
end $$;
revoke all on function public.log_audit(text, text, text, jsonb) from public, anon;
grant execute on function public.log_audit(text, text, text, jsonb) to authenticated;

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.profiles enable row level security;
alter table public.availability_requests enable row level security;
alter table public.availability_submissions enable row level security;
alter table public.availability_days enable row level security;
alter table public.availability_time_windows enable row level security;
alter table public.weekly_schedules enable row level security;
alter table public.shifts enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

-- profiles: own row or admin reads; admin writes; employee may update own row (trigger limits columns)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- availability_requests: active users see non-draft requests; admins manage
create policy requests_select on public.availability_requests for select to authenticated
  using (public.is_admin() or (public.is_active_user() and status <> 'draft'));
create policy requests_admin_write on public.availability_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- availability_submissions: employee owns their row, only while the request is open
create policy submissions_select on public.availability_submissions for select to authenticated
  using (public.is_admin() or employee_id = auth.uid());
create policy submissions_employee_insert on public.availability_submissions for insert to authenticated
  with check (
    employee_id = auth.uid() and public.is_active_user()
    and exists (select 1 from public.availability_requests r where r.id = request_id and r.status = 'open')
  );
create policy submissions_employee_update on public.availability_submissions for update to authenticated
  using (
    employee_id = auth.uid() and public.is_active_user()
    and exists (select 1 from public.availability_requests r where r.id = request_id and r.status = 'open')
  )
  with check (employee_id = auth.uid());
create policy submissions_admin_all on public.availability_submissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- days & windows follow the submission's ownership
create policy days_select on public.availability_days for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.availability_submissions s where s.id = submission_id and s.employee_id = auth.uid()));
create policy days_employee_write on public.availability_days for all to authenticated
  using (exists (
    select 1 from public.availability_submissions s
    join public.availability_requests r on r.id = s.request_id
    where s.id = submission_id and s.employee_id = auth.uid() and r.status = 'open' and public.is_active_user()))
  with check (exists (
    select 1 from public.availability_submissions s
    join public.availability_requests r on r.id = s.request_id
    where s.id = submission_id and s.employee_id = auth.uid() and r.status = 'open' and public.is_active_user()));
create policy days_admin_all on public.availability_days for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy windows_select on public.availability_time_windows for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.availability_submissions s where s.id = submission_id and s.employee_id = auth.uid()));
create policy windows_employee_write on public.availability_time_windows for all to authenticated
  using (exists (
    select 1 from public.availability_submissions s
    join public.availability_requests r on r.id = s.request_id
    where s.id = submission_id and s.employee_id = auth.uid() and r.status = 'open' and public.is_active_user()))
  with check (exists (
    select 1 from public.availability_submissions s
    join public.availability_requests r on r.id = s.request_id
    where s.id = submission_id and s.employee_id = auth.uid() and r.status = 'open' and public.is_active_user()));
create policy windows_admin_all on public.availability_time_windows for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- schedules & shifts: admin only. Employees read published snapshots (schedule_versions) instead,
-- so draft shifts and unpublished edits to a published week are never visible to them.
create policy schedules_select on public.weekly_schedules for select to authenticated
  using (public.is_admin() or (public.is_active_user() and status = 'published'));
create policy schedules_admin_write on public.weekly_schedules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy shifts_admin_all on public.shifts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy versions_select on public.schedule_versions for select to authenticated
  using (public.is_active_user());
-- versions are written only by the publish function (Phase 5, SECURITY DEFINER) – no insert policy.

-- notifications: users read and mark their own; creation happens server-side only
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy deliveries_admin_select on public.notification_deliveries for select to authenticated
  using (public.is_admin());

create policy audit_admin_select on public.audit_logs for select to authenticated
  using (public.is_admin());

create policy settings_admin_all on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Realtime: notifications, submissions and shifts stream to subscribed clients (RLS still applies).
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.availability_submissions;
alter publication supabase_realtime add table public.availability_requests;

-- Nothing is exposed to anonymous visitors.
revoke all on all tables in schema public from anon;
