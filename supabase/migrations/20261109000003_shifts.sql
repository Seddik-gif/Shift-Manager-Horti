-- Phase 4: shift management. All shift writes go through these functions so that the schedule row,
-- the audit log, override tracking and notifications always succeed or fail together.

create or replace function public.monday_of(p_day date) returns date
language sql immutable as $$ select p_day - (extract(isodow from p_day)::int - 1) $$;

-- Is [p_start, p_end) fully covered by the employee's SUBMITTED availability?
--   'no_request'    no availability request exists for that week (nothing to compare against)
--   'no_submission' a request exists but the employee has not submitted
--   'ok' / 'outside'
-- Touching windows are chained, so 09:00–14:00 + 14:00–18:00 covers 12:00–16:00.
create or replace function public.availability_status(p_employee uuid, p_start timestamptz, p_end timestamptz)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := public.monday_of((p_start at time zone 'Europe/Rome')::date);
  v_req uuid;
  v_covered timestamptz := p_start;
  w record;
begin
  select id into v_req from public.availability_requests where week_start = v_week and status <> 'draft';
  if v_req is null then return 'no_request'; end if;
  if not exists (select 1 from public.availability_submissions
                  where request_id = v_req and employee_id = p_employee and status = 'submitted') then
    return 'no_submission';
  end if;
  for w in
    select tw.starts_at, tw.ends_at
      from public.availability_time_windows tw
      join public.availability_submissions s on s.id = tw.submission_id
     where s.employee_id = p_employee and s.status = 'submitted'
       and tw.starts_at < p_end and tw.ends_at > p_start
     order by tw.starts_at
  loop
    if w.starts_at <= v_covered then v_covered := greatest(v_covered, w.ends_at); end if;
  end loop;
  return case when v_covered >= p_end then 'ok' else 'outside' end;
end $$;

-- Editing a published week never changes what employees see (they read schedule_versions),
-- but it must be flagged so the change is explicitly republished, and admins are told.
create or replace function public.touch_schedule(p_schedule uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.weekly_schedules;
begin
  select * into v_s from public.weekly_schedules where id = p_schedule;
  if v_s.status = 'published' then
    update public.weekly_schedules set has_unpublished_changes = true where id = p_schedule;
    perform public.notify_users(public.active_user_ids('admin'), 'schedule_modified',
      jsonb_build_object('week_start', v_s.week_start, 'schedule_id', v_s.id),
      '/admin/schedule?date=' || v_s.week_start, 'sched-mod:' || v_s.id || ':' || v_s.current_version);
  end if;
end $$;

create or replace function public.save_shift(
  p_id uuid, p_employee uuid, p_day date, p_start time, p_end time,
  p_position text, p_notes text, p_override boolean, p_override_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_starts timestamptz;
  v_ends timestamptz;
  v_week date;
  v_sched public.weekly_schedules;
  v_old public.shifts;
  v_id uuid;
  v_avail text;
  v_hours numeric;
  v_long numeric;
  v_warnings jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_day is null or p_start is null or p_end is null or p_start = p_end then raise exception 'invalid_input'; end if;
  if not exists (select 1 from public.profiles where id = p_employee and role = 'employee' and is_active) then
    raise exception 'invalid_employee';
  end if;

  v_starts := (p_day + p_start) at time zone 'Europe/Rome';
  v_ends := (case when p_end > p_start then p_day + p_end else (p_day + 1) + p_end end) at time zone 'Europe/Rome';

  -- Availability mismatch must be acknowledged explicitly; the override is audited.
  v_avail := public.availability_status(p_employee, v_starts, v_ends);
  if v_avail in ('outside', 'no_submission') and not coalesce(p_override, false) then
    return jsonb_build_object('ok', false, 'warning', v_avail);
  end if;

  v_week := public.monday_of(p_day);
  insert into public.weekly_schedules (week_start, created_by) values (v_week, auth.uid())
    on conflict (week_start) do nothing;
  select * into v_sched from public.weekly_schedules where week_start = v_week;

  begin
    if p_id is null then
      insert into public.shifts (schedule_id, employee_id, starts_at, ends_at, job_position, notes,
                                 availability_override, override_reason, created_by)
      values (v_sched.id, p_employee, v_starts, v_ends, nullif(trim(p_position), ''), nullif(trim(p_notes), ''),
              v_avail in ('outside', 'no_submission'), nullif(trim(p_override_reason), ''), auth.uid())
      returning id into v_id;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
      values (auth.uid(), 'shift.created', 'shift', v_id::text,
              jsonb_build_object('employee_id', p_employee, 'starts_at', v_starts, 'ends_at', v_ends));
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
        'to',   jsonb_build_object('employee_id', p_employee, 'starts_at', v_starts, 'ends_at', v_ends)));
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

create or replace function public.delete_shift(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.shifts;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.shifts where id = p_id returning * into v_s;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'shift.deleted', 'shift', p_id::text,
          jsonb_build_object('employee_id', v_s.employee_id, 'starts_at', v_s.starts_at, 'ends_at', v_s.ends_at));
  perform public.touch_schedule(v_s.schedule_id);
end $$;

revoke all on function public.availability_status(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.touch_schedule(uuid) from public, anon, authenticated;
revoke all on function public.save_shift(uuid, uuid, date, time, time, text, text, boolean, text) from public, anon;
revoke all on function public.delete_shift(uuid) from public, anon;
grant execute on function public.save_shift(uuid, uuid, date, time, time, text, text, boolean, text) to authenticated;
grant execute on function public.delete_shift(uuid) to authenticated;
