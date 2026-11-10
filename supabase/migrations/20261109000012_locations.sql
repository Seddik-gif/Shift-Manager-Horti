-- Locations (bars). One shared pool of employees; an employee can work at several locations.
--  * Availability stays GLOBAL: it describes the person, not the bar.
--  * Schedules, shifts, open shifts, requests and publications are PER LOCATION.
--  * The "no overlapping shifts per employee" exclusion constraint is unchanged, so nobody can be at
--    two bars at once.
--  * A location with history is archived, never deleted (immutable publish snapshots depend on it).
--  * Functions keep working without a location argument: null means "the default (first active) location".

-- ───────────── tables ─────────────
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null default '#F5A524' check (color ~* '^#[0-9a-f]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index locations_name_key on public.locations (lower(trim(name)));

create table public.employee_locations (
  employee_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  primary key (employee_id, location_id)
);
create index employee_locations_location_idx on public.employee_locations (location_id);

insert into public.locations (name, color, sort_order) values ('Horti Magici', '#F5A524', 0);

insert into public.employee_locations (employee_id, location_id)
  select p.id, l.id from public.profiles p cross join public.locations l where p.role = 'employee';

-- ───────────── helpers ─────────────
create or replace function public.default_location_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.locations where is_active order by sort_order, created_at limit 1;
$$;
revoke all on function public.default_location_id() from public, anon, authenticated;

-- Locations the caller may see: admins every active location (plus archived ones for history); employees their own active ones.
create or replace function public.my_location_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.locations l
   where public.is_admin()
      or (l.is_active and exists (select 1 from public.employee_locations el
                                   where el.location_id = l.id and el.employee_id = auth.uid()));
$$;
revoke all on function public.my_location_ids() from public, anon;
grant execute on function public.my_location_ids() to authenticated;

create or replace function public.location_employee_ids(p_location uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
   join public.employee_locations el on el.employee_id = p.id and el.location_id = p_location
   where p.is_active and p.role = 'employee';
$$;
revoke all on function public.location_employee_ids(uuid) from public, anon, authenticated;

-- A newly created employee starts at the default location (admins can change it on the employee page).
create or replace function public.profiles_assign_default_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'employee' then
    insert into public.employee_locations (employee_id, location_id)
    select new.id, public.default_location_id() where public.default_location_id() is not null
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger profiles_assign_default_location after insert on public.profiles
  for each row execute function public.profiles_assign_default_location();

-- ───────────── columns ─────────────
alter table public.weekly_schedules add column location_id uuid references public.locations (id);
update public.weekly_schedules set location_id = (select id from public.locations order by sort_order limit 1);
alter table public.weekly_schedules alter column location_id set not null;
alter table public.weekly_schedules drop constraint weekly_schedules_week_start_key;
alter table public.weekly_schedules add constraint weekly_schedules_location_week_key unique (location_id, week_start);

alter table public.open_shifts add column location_id uuid references public.locations (id);
update public.open_shifts set location_id = (select id from public.locations order by sort_order limit 1);
alter table public.open_shifts alter column location_id set not null;
create index open_shifts_location_idx on public.open_shifts (location_id, starts_at) where status = 'open';

alter table public.shift_requests add column location_id uuid references public.locations (id);
update public.shift_requests set location_id = (select id from public.locations order by sort_order limit 1);
alter table public.shift_requests alter column location_id set not null;

-- direct inserts (tests, tooling) fall back to the default location
alter table public.weekly_schedules alter column location_id set default public.default_location_id();
alter table public.open_shifts alter column location_id set default public.default_location_id();
alter table public.shift_requests alter column location_id set default public.default_location_id();

-- ───────────── RLS ─────────────
alter table public.locations enable row level security;
alter table public.employee_locations enable row level security;
create policy locations_select on public.locations for select to authenticated
  using (id in (select public.my_location_ids()));
create policy employee_locations_select on public.employee_locations for select to authenticated
  using (public.is_admin() or employee_id = auth.uid());
revoke insert, update, delete on public.locations, public.employee_locations from authenticated, anon;

drop policy schedules_select on public.weekly_schedules;
create policy schedules_select on public.weekly_schedules for select to authenticated
  using (public.is_admin() or (public.is_active_user() and status = 'published' and location_id in (select public.my_location_ids())));

drop policy versions_select on public.schedule_versions;
create policy versions_select on public.schedule_versions for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.weekly_schedules s
     where s.id = schedule_id and s.location_id in (select public.my_location_ids())));

drop policy open_shifts_select on public.open_shifts;
create policy open_shifts_select on public.open_shifts for select to authenticated
  using (public.is_admin() or (public.is_active_user() and status = 'open' and location_id in (select public.my_location_ids())));

-- ───────────── views (new column appended at the end) ─────────────
create or replace view public.team_shifts as
  select s.id, s.employee_id, trim(p.first_name || ' ' || p.last_name) as employee_name, p.color,
         s.job_position, s.starts_at, s.ends_at, w.location_id
  from public.shifts s
  join public.weekly_schedules w on w.id = s.schedule_id
  join public.profiles p on p.id = s.employee_id
  where public.is_active_user() and w.location_id in (select public.my_location_ids());

create or replace view public.published_schedules as
  select s.week_start, v.version, v.snapshot, v.published_at, v.published_by, s.location_id
  from public.weekly_schedules s
  join public.schedule_versions v on v.schedule_id = s.id and v.version = s.current_version
  where s.status = 'published' and public.is_active_user() and s.location_id in (select public.my_location_ids());

-- ───────────── location management (admin) ─────────────
create or replace function public.save_location(p_id uuid, p_name text, p_color text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' or p_color !~* '^#[0-9a-f]{6}$' then raise exception 'invalid_input'; end if;
  begin
    if p_id is null then
      insert into public.locations (name, color, sort_order)
      values (trim(p_name), lower(p_color), coalesce((select max(sort_order) + 1 from public.locations), 0))
      returning id into v_id;
      -- a new bar starts with no staff assigned; admins pick who works there
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
      values (auth.uid(), 'location.created', 'location', v_id::text, jsonb_build_object('name', trim(p_name)));
    else
      update public.locations set name = trim(p_name), color = lower(p_color) where id = p_id returning id into v_id;
      if not found then raise exception 'not_found'; end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
      values (auth.uid(), 'location.updated', 'location', v_id::text, jsonb_build_object('name', trim(p_name), 'color', lower(p_color)));
    end if;
  exception when unique_violation then raise exception 'name_taken'; end;
  return v_id;
end $$;

create or replace function public.set_location_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not p_active and not exists (select 1 from public.locations where is_active and id <> p_id) then
    raise exception 'last_location';
  end if;
  update public.locations set is_active = p_active where id = p_id;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), case when p_active then 'location.restored' else 'location.archived' end, 'location', p_id::text, '{}');
end $$;

create or replace function public.delete_location(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from public.weekly_schedules where location_id = p_id)
     or exists (select 1 from public.open_shifts where location_id = p_id)
     or exists (select 1 from public.shift_requests where location_id = p_id) then
    raise exception 'location_in_use';
  end if;
  if not exists (select 1 from public.locations where is_active and id <> p_id) then raise exception 'last_location'; end if;
  delete from public.locations where id = p_id;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'location.deleted', 'location', p_id::text, '{}');
end $$;

create or replace function public.set_employee_locations(p_employee uuid, p_locations uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_employee and role = 'employee') then raise exception 'invalid_employee'; end if;
  if exists (select 1 from unnest(coalesce(p_locations, '{}')) l where not exists (select 1 from public.locations where id = l)) then
    raise exception 'invalid_input';
  end if;
  delete from public.employee_locations where employee_id = p_employee and location_id <> all (coalesce(p_locations, '{}'));
  insert into public.employee_locations (employee_id, location_id)
    select p_employee, l from unnest(coalesce(p_locations, '{}')) l on conflict do nothing;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'employee.locations_changed', 'profile', p_employee::text, jsonb_build_object('locations', p_locations));
end $$;

-- ───────────── schedule functions, now location-aware ─────────────
create or replace function public.touch_schedule(p_schedule uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.weekly_schedules;
begin
  select * into v_s from public.weekly_schedules where id = p_schedule;
  if v_s.status = 'published' then
    update public.weekly_schedules set has_unpublished_changes = true where id = p_schedule;
    perform public.notify_users(public.active_user_ids('admin'), 'schedule_modified',
      jsonb_build_object('week_start', v_s.week_start, 'schedule_id', v_s.id, 'location_id', v_s.location_id),
      '/admin/schedule?date=' || v_s.week_start || '&loc=' || v_s.location_id, 'sched-mod:' || v_s.id || ':' || v_s.current_version);
  end if;
end $$;

drop function public.save_shift(uuid, uuid, date, time, time, text, text, boolean, text);
create or replace function public.save_shift(
  p_id uuid, p_employee uuid, p_day date, p_start time, p_end time,
  p_position text, p_notes text, p_override boolean, p_override_reason text,
  p_location uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_starts timestamptz;
  v_ends timestamptz;
  v_week date;
  v_loc uuid := p_location;
  v_sched public.weekly_schedules;
  v_old public.shifts;
  v_id uuid;
  v_avail text;
  v_hours numeric;
  v_long numeric;
  v_warnings jsonb := '[]'::jsonb;
  v_cfg jsonb;
  v_open time := '07:00';
  v_close time := '02:00';
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_day is null or p_start is null or p_end is null or p_start = p_end then raise exception 'invalid_input'; end if;
  if not exists (select 1 from public.profiles where id = p_employee and role = 'employee' and is_active) then
    raise exception 'invalid_employee';
  end if;

  -- editing without a location keeps the shift where it is; creating without one uses the default location
  if v_loc is null and p_id is not null then
    select w.location_id into v_loc from public.shifts s join public.weekly_schedules w on w.id = s.schedule_id where s.id = p_id;
  end if;
  v_loc := coalesce(v_loc, public.default_location_id());
  if not exists (select 1 from public.locations where id = v_loc and is_active) then raise exception 'invalid_location'; end if;
  if not exists (select 1 from public.employee_locations where employee_id = p_employee and location_id = v_loc) then
    raise exception 'employee_not_in_location';
  end if;

  select value into v_cfg from public.app_settings where key = 'shift_hours';
  if v_cfg is not null then
    v_open := coalesce((v_cfg ->> 'earliest_start')::time, v_open);
    v_close := coalesce((v_cfg ->> 'latest_end')::time, v_close);
  end if;
  if p_start < v_open or (p_end <= p_start and p_end > v_close) then raise exception 'outside_hours'; end if;

  v_starts := (p_day + p_start) at time zone 'Europe/Rome';
  v_ends := (case when p_end > p_start then p_day + p_end else (p_day + 1) + p_end end) at time zone 'Europe/Rome';

  v_avail := public.availability_status(p_employee, v_starts, v_ends);
  if v_avail in ('outside', 'no_submission') and not coalesce(p_override, false) then
    return jsonb_build_object('ok', false, 'warning', v_avail);
  end if;

  v_week := public.monday_of(p_day);
  insert into public.weekly_schedules (location_id, week_start, created_by) values (v_loc, v_week, auth.uid())
    on conflict (location_id, week_start) do nothing;
  select * into v_sched from public.weekly_schedules where location_id = v_loc and week_start = v_week;

  begin
    if p_id is null then
      insert into public.shifts (schedule_id, employee_id, starts_at, ends_at, job_position, notes,
                                 availability_override, override_reason, created_by)
      values (v_sched.id, p_employee, v_starts, v_ends, nullif(trim(p_position), ''), nullif(trim(p_notes), ''),
              v_avail in ('outside', 'no_submission'), nullif(trim(p_override_reason), ''), auth.uid())
      returning id into v_id;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
      values (auth.uid(), 'shift.created', 'shift', v_id::text,
              jsonb_build_object('employee_id', p_employee, 'starts_at', v_starts, 'ends_at', v_ends, 'location_id', v_loc));
    else
      select * into v_old from public.shifts where id = p_id for update;
      if not found then raise exception 'not_found'; end if;
      update public.shifts
         set schedule_id = v_sched.id, employee_id = p_employee, starts_at = v_starts, ends_at = v_ends,
             job_position = nullif(trim(p_position), ''), notes = nullif(trim(p_notes), ''),
             availability_override = v_avail in ('outside', 'no_submission'),
             override_reason = case when v_avail in ('outside', 'no_submission') then nullif(trim(p_override_reason), '') end
       where id = p_id;
      v_id := p_id;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
      values (auth.uid(), 'shift.updated', 'shift', v_id::text, jsonb_build_object(
        'from', jsonb_build_object('employee_id', v_old.employee_id, 'starts_at', v_old.starts_at, 'ends_at', v_old.ends_at),
        'to',   jsonb_build_object('employee_id', p_employee, 'starts_at', v_starts, 'ends_at', v_ends, 'location_id', v_loc)));
      if v_old.schedule_id <> v_sched.id then perform public.touch_schedule(v_old.schedule_id); end if;
    end if;
  exception when exclusion_violation then
    raise exception 'overlap';
  end;

  if v_avail in ('outside', 'no_submission') then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
    values (auth.uid(), 'shift.availability_override', 'shift', v_id::text,
            jsonb_build_object('employee_id', p_employee, 'reason', v_avail,
                               'note', nullif(trim(p_override_reason), ''), 'starts_at', v_starts, 'ends_at', v_ends));
  end if;

  perform public.touch_schedule(v_sched.id);

  v_hours := extract(epoch from (v_ends - v_starts)) / 3600;
  select (value ->> 'long_shift_warning_hours')::numeric into v_long from public.app_settings where key = 'scheduling_rules';
  if v_long is not null and v_hours > v_long then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type', 'long_shift', 'hours', v_hours));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'warnings', v_warnings);
end $$;

drop function public.publish_schedule(date);
create or replace function public.publish_schedule(p_week_start date, p_location uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.weekly_schedules;
  v_snapshot jsonb;
  v_count int;
  v_version int;
  v_republish boolean;
  v_loc uuid := coalesce(p_location, public.default_location_id());
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if extract(isodow from p_week_start) <> 1 then raise exception 'invalid_input'; end if;

  select * into v_s from public.weekly_schedules where location_id = v_loc and week_start = p_week_start for update;
  if not found then raise exception 'schedule_not_found'; end if;
  if v_s.status = 'published' and not v_s.has_unpublished_changes then raise exception 'nothing_to_publish'; end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'shift_id', s.id, 'employee_id', s.employee_id,
           'employee_name', trim(p.first_name || ' ' || p.last_name), 'color', p.color,
           'position', s.job_position, 'starts_at', s.starts_at, 'ends_at', s.ends_at
         ) order by s.starts_at, p.first_name), '[]'::jsonb)
    into v_count, v_snapshot
    from public.shifts s join public.profiles p on p.id = s.employee_id
   where s.schedule_id = v_s.id;
  if v_count = 0 then raise exception 'empty_schedule'; end if;

  v_republish := v_s.status = 'published';
  v_version := v_s.current_version + 1;

  insert into public.schedule_versions (schedule_id, version, snapshot, published_by)
  values (v_s.id, v_version, jsonb_build_object('week_start', p_week_start, 'location_id', v_loc, 'shifts', v_snapshot), auth.uid());

  update public.weekly_schedules
     set status = 'published', current_version = v_version, has_unpublished_changes = false,
         published_at = now(), published_by = auth.uid()
   where id = v_s.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), case when v_republish then 'schedule.republished' else 'schedule.published' end,
          'weekly_schedule', v_s.id::text,
          jsonb_build_object('week_start', p_week_start, 'version', v_version, 'shifts', v_count, 'location_id', v_loc));

  perform public.notify_users(public.location_employee_ids(v_loc),
    case when v_republish then 'schedule_updated' else 'schedule_published' end,
    jsonb_build_object('week_start', p_week_start, 'version', v_version, 'location_id', v_loc),
    '/employee/schedule?date=' || p_week_start || '&loc=' || v_loc, 'pub:' || v_s.id || ':' || v_version);
  perform public.notify_users(public.active_user_ids('admin'), 'schedule_publish_confirmed',
    jsonb_build_object('week_start', p_week_start, 'version', v_version, 'republished', v_republish, 'location_id', v_loc),
    '/admin/schedule/versions?date=' || p_week_start || '&loc=' || v_loc, 'pubconf:' || v_s.id || ':' || v_version);

  return jsonb_build_object('version', v_version, 'republished', v_republish, 'shifts', v_count);
end $$;

drop function public.prepare_whatsapp_share(date, text, text);
create or replace function public.prepare_whatsapp_share(p_week_start date, p_locale text, p_message text, p_location uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_s public.weekly_schedules; v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_locale not in ('it', 'en') or coalesce(trim(p_message), '') = '' then raise exception 'invalid_input'; end if;
  select * into v_s from public.weekly_schedules
   where week_start = p_week_start and status = 'published' and location_id = coalesce(p_location, public.default_location_id());
  if not found then raise exception 'not_published'; end if;
  insert into public.whatsapp_shares (schedule_id, version, locale, message, prepared_by)
  values (v_s.id, v_s.current_version, p_locale, p_message, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- ───────────── open shifts and requests, location-aware ─────────────
drop function public.create_open_shift(date, time, time, text, text, integer);
create or replace function public.create_open_shift(
  p_day date, p_start time, p_end time, p_position text, p_note text, p_slots integer, p_location uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_w record; v_id uuid; v_loc uuid := coalesce(p_location, public.default_location_id());
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.locations where id = v_loc and is_active) then raise exception 'invalid_location'; end if;
  select * into v_w from public.shift_window(p_day, p_start, p_end);
  begin
    insert into public.open_shifts (location_id, starts_at, ends_at, job_position, note, slots, created_by)
    values (v_loc, v_w.starts_at, v_w.ends_at, nullif(trim(p_position), ''), nullif(trim(p_note), ''), coalesce(p_slots, 1), auth.uid())
    returning id into v_id;
  exception when check_violation then raise exception 'invalid_input'; end;
  perform public.bump_pulse(public.monday_of(p_day));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'open_shift.created', 'open_shift', v_id::text,
          jsonb_build_object('starts_at', v_w.starts_at, 'ends_at', v_w.ends_at, 'slots', coalesce(p_slots, 1), 'location_id', v_loc));
  perform public.notify_users(public.location_employee_ids(v_loc), 'open_shift_posted',
    jsonb_build_object('starts_at', v_w.starts_at, 'ends_at', v_w.ends_at, 'open_shift_id', v_id, 'location_id', v_loc),
    '/employee/schedule?date=' || p_day || '&loc=' || v_loc, 'open:' || v_id);
  return v_id;
end $$;

create or replace function public.request_open_shift(p_open uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_o public.open_shifts; v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'employee' and is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_o from public.open_shifts where id = p_open and status = 'open' for update;
  if not found then raise exception 'not_open'; end if;
  if not exists (select 1 from public.employee_locations where employee_id = v_uid and location_id = v_o.location_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.shifts where employee_id = v_uid and tstzrange(starts_at, ends_at) && tstzrange(v_o.starts_at, v_o.ends_at)) then
    raise exception 'overlap';
  end if;
  begin
    insert into public.shift_requests (employee_id, kind, open_shift_id, location_id, starts_at, ends_at, note)
    values (v_uid, 'take', p_open, v_o.location_id, v_o.starts_at, v_o.ends_at, nullif(trim(p_note), '')) returning id into v_id;
  exception when unique_violation then raise exception 'already_requested'; end;
  perform public.notify_users(public.active_user_ids('admin'), 'shift_request_received',
    jsonb_build_object('employee_name', public.person_name(v_uid), 'starts_at', v_o.starts_at, 'ends_at', v_o.ends_at, 'kind', 'take'),
    '/admin/requests', 'reqrcv:' || v_id);
  return v_id;
end $$;

drop function public.offer_shift(date, time, time, text);
create or replace function public.offer_shift(p_day date, p_start time, p_end time, p_note text, p_location uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_w record; v_id uuid; v_loc uuid := coalesce(p_location, public.default_location_id());
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'employee' and is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employee_locations el join public.locations l on l.id = el.location_id
                  where el.employee_id = v_uid and el.location_id = v_loc and l.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_w from public.shift_window(p_day, p_start, p_end);
  if v_w.starts_at < now() then raise exception 'in_the_past'; end if;
  if exists (select 1 from public.shifts where employee_id = v_uid and tstzrange(starts_at, ends_at) && tstzrange(v_w.starts_at, v_w.ends_at)) then
    raise exception 'overlap';
  end if;
  begin
    insert into public.shift_requests (employee_id, kind, location_id, starts_at, ends_at, note)
    values (v_uid, 'offer', v_loc, v_w.starts_at, v_w.ends_at, nullif(trim(p_note), '')) returning id into v_id;
  exception when unique_violation then raise exception 'already_requested'; end;
  perform public.notify_users(public.active_user_ids('admin'), 'shift_request_received',
    jsonb_build_object('employee_name', public.person_name(v_uid), 'starts_at', v_w.starts_at, 'ends_at', v_w.ends_at, 'kind', 'offer'),
    '/admin/requests', 'reqrcv:' || v_id);
  return v_id;
end $$;

create or replace function public.decide_shift_request(p_id uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.shift_requests;
  v_o public.open_shifts;
  v_res jsonb;
  v_shift uuid;
  v_taken integer;
  r record;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_r from public.shift_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_r.status <> 'pending' then raise exception 'already_decided'; end if;

  if p_approve then
    if v_r.open_shift_id is not null then
      select * into v_o from public.open_shifts where id = v_r.open_shift_id for update;
      if v_o.status <> 'open' then raise exception 'not_open'; end if;
    end if;
    perform set_config('app.quiet_shift_notify', '1', true);
    v_res := public.save_shift(null, v_r.employee_id,
      (v_r.starts_at at time zone 'Europe/Rome')::date, (v_r.starts_at at time zone 'Europe/Rome')::time,
      (v_r.ends_at at time zone 'Europe/Rome')::time, v_o.job_position, null, true, 'approved employee request',
      v_r.location_id);
    perform set_config('app.quiet_shift_notify', '', true);
    v_shift := (v_res ->> 'id')::uuid;

    update public.shift_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(trim(p_note), ''), shift_id = v_shift where id = p_id;

    if v_o.id is not null then
      v_taken := v_o.slots - 1;
      update public.open_shifts set slots = greatest(v_taken, 1), status = case when v_taken <= 0 then 'filled' else status end where id = v_o.id;
      if v_taken <= 0 then
        for r in update public.shift_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
                        decision_note = 'shift filled'
                  where open_shift_id = v_o.id and status = 'pending' returning employee_id, starts_at, ends_at loop
          perform public.notify_users(array[r.employee_id], 'shift_request_rejected',
            jsonb_build_object('starts_at', r.starts_at, 'ends_at', r.ends_at), '/employee/schedule', null);
        end loop;
      end if;
    end if;
    perform public.notify_users(array[v_r.employee_id], 'shift_request_approved',
      jsonb_build_object('starts_at', v_r.starts_at, 'ends_at', v_r.ends_at), '/employee/schedule', null);
  else
    update public.shift_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(trim(p_note), '') where id = p_id;
    perform public.notify_users(array[v_r.employee_id], 'shift_request_rejected',
      jsonb_build_object('starts_at', v_r.starts_at, 'ends_at', v_r.ends_at), '/employee/schedule', null);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), case when p_approve then 'shift_request.approved' else 'shift_request.rejected' end,
          'shift_request', p_id::text, jsonb_build_object('employee_id', v_r.employee_id, 'kind', v_r.kind,
          'starts_at', v_r.starts_at, 'ends_at', v_r.ends_at, 'shift_id', v_shift, 'location_id', v_r.location_id));
  return jsonb_build_object('ok', true, 'shift_id', v_shift);
end $$;

-- ───────────── grants ─────────────
revoke all on function public.save_shift(uuid, uuid, date, time, time, text, text, boolean, text, uuid) from public, anon;
revoke all on function public.publish_schedule(date, uuid) from public, anon;
revoke all on function public.prepare_whatsapp_share(date, text, text, uuid) from public, anon;
revoke all on function public.create_open_shift(date, time, time, text, text, integer, uuid) from public, anon;
revoke all on function public.offer_shift(date, time, time, text, uuid) from public, anon;
revoke all on function public.save_location(uuid, text, text) from public, anon;
revoke all on function public.set_location_active(uuid, boolean) from public, anon;
revoke all on function public.delete_location(uuid) from public, anon;
revoke all on function public.set_employee_locations(uuid, uuid[]) from public, anon;
grant execute on function public.save_shift(uuid, uuid, date, time, time, text, text, boolean, text, uuid) to authenticated;
grant execute on function public.publish_schedule(date, uuid) to authenticated;
grant execute on function public.prepare_whatsapp_share(date, text, text, uuid) to authenticated;
grant execute on function public.create_open_shift(date, time, time, text, text, integer, uuid) to authenticated;
grant execute on function public.offer_shift(date, time, time, text, uuid) to authenticated;
grant execute on function public.save_location(uuid, text, text) to authenticated;
grant execute on function public.set_location_active(uuid, boolean) to authenticated;
grant execute on function public.delete_location(uuid) to authenticated;
grant execute on function public.set_employee_locations(uuid, uuid[]) to authenticated;

alter publication supabase_realtime add table public.locations;
