-- Absence / ferie requests. Global (a person is absent everywhere, not per bar).
-- Employees ask, an admin decides. An approved absence shows on the planning grid and must be
-- acknowledged (and is audited) before anyone is scheduled on those days.

create table public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('ferie', 'assenza')),
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 120),
  -- one person cannot hold two live absences on the same day
  exclude using gist (employee_id with =, daterange(start_date, end_date, '[]') with &&)
    where (status in ('pending', 'approved'))
);
create index absence_requests_status_idx on public.absence_requests (status, created_at desc);
create index absence_requests_employee_idx on public.absence_requests (employee_id, start_date);

alter table public.absence_requests enable row level security;
create policy absences_select on public.absence_requests for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.absence_requests from authenticated, anon;
alter publication supabase_realtime add table public.absence_requests;

-- Is any day touched by [p_start, p_end) (Rome calendar days) covered by an approved absence?
create or replace function public.on_approved_absence(p_employee uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.absence_requests a
     where a.employee_id = p_employee and a.status = 'approved'
       and a.start_date <= ((p_end - interval '1 second') at time zone 'Europe/Rome')::date
       and a.end_date >= (p_start at time zone 'Europe/Rome')::date);
$$;
revoke all on function public.on_approved_absence(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.request_absence(p_kind text, p_start date, p_end date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'employee' and is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('ferie', 'assenza') or p_start is null or p_end is null or length(coalesce(p_reason, '')) > 300 then
    raise exception 'invalid_input';
  end if;
  begin
    insert into public.absence_requests (employee_id, kind, start_date, end_date, reason)
    values (v_uid, p_kind, p_start, p_end, nullif(trim(p_reason), '')) returning id into v_id;
  exception
    when check_violation then raise exception 'invalid_input';
    when exclusion_violation then raise exception 'absence_overlap';
  end;
  perform public.notify_users(public.active_user_ids('admin'), 'absence_requested',
    jsonb_build_object('employee_name', public.person_name(v_uid), 'kind', p_kind, 'start_date', p_start, 'end_date', p_end),
    '/admin/requests', 'absrcv:' || v_id);
  return v_id;
end $$;

create or replace function public.withdraw_absence(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.absence_requests set status = 'cancelled', decided_at = now()
   where id = p_id and employee_id = auth.uid()
     and (status = 'pending' or (status = 'approved' and start_date > (now() at time zone 'Europe/Rome')::date));
  if not found then raise exception 'not_found'; end if;
end $$;

-- Admin decision. On approval, reports how many already-planned shifts fall inside the absence so the
-- admin can fix them (nothing is deleted automatically).
create or replace function public.decide_absence(p_id uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.absence_requests; v_conflicts integer := 0;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_a from public.absence_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_a.status <> 'pending' then raise exception 'already_decided'; end if;

  update public.absence_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;

  if p_approve then
    select count(*) into v_conflicts from public.shifts s
     where s.employee_id = v_a.employee_id
       and s.starts_at < ((v_a.end_date + 1)::timestamp at time zone 'Europe/Rome')
       and s.ends_at > (v_a.start_date::timestamp at time zone 'Europe/Rome');
  end if;

  perform public.notify_users(array[v_a.employee_id],
    case when p_approve then 'absence_approved' else 'absence_rejected' end,
    jsonb_build_object('kind', v_a.kind, 'start_date', v_a.start_date, 'end_date', v_a.end_date, 'note', nullif(trim(p_note), '')),
    '/employee/absences', null);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), case when p_approve then 'absence.approved' else 'absence.rejected' end, 'absence_request', p_id::text,
          jsonb_build_object('employee_id', v_a.employee_id, 'kind', v_a.kind, 'start_date', v_a.start_date,
                             'end_date', v_a.end_date, 'conflicting_shifts', v_conflicts));
  return jsonb_build_object('ok', true, 'conflicts', v_conflicts);
end $$;

revoke all on function public.request_absence(text, date, date, text) from public, anon;
revoke all on function public.withdraw_absence(uuid) from public, anon;
revoke all on function public.decide_absence(uuid, boolean, text) from public, anon;
grant execute on function public.request_absence(text, date, date, text) to authenticated;
grant execute on function public.withdraw_absence(uuid) to authenticated;
grant execute on function public.decide_absence(uuid, boolean, text) to authenticated;

-- ───────────── save_shift: approved absences must be acknowledged ─────────────
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
  -- an approved absence outranks availability: it must be acknowledged too, and is audited
  if public.on_approved_absence(p_employee, v_starts, v_ends) then v_avail := 'absence'; end if;
  if v_avail in ('outside', 'no_submission', 'absence') and not coalesce(p_override, false) then
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
              v_avail in ('outside', 'no_submission', 'absence'), nullif(trim(p_override_reason), ''), auth.uid())
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
             availability_override = v_avail in ('outside', 'no_submission', 'absence'),
             override_reason = case when v_avail in ('outside', 'no_submission', 'absence') then nullif(trim(p_override_reason), '') end
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

  if v_avail in ('outside', 'no_submission', 'absence') then
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
