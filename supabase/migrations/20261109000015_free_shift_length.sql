-- Shift length is up to the admins and employees: the rest-time, weekly-hours and long-shift warnings are removed.
-- Only "minimum staff per day" (off by default) remains as an optional rule. Overlapping shifts stay blocked by the
-- exclusion constraint; the 24 h ceiling on a single shift and the 07:00-02:00 planning window are unchanged.

update public.app_settings
   set value = value - 'rest_min_hours' - 'weekly_hours_warning' - 'long_shift_warning_hours'
 where key = 'scheduling_rules';

create or replace function public.save_scheduling_rules(p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := '{}'::jsonb;
  v_val jsonb;
  v_cur jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'invalid_input'; end if;

  if p_rules ? 'min_staff_per_day' then
    v_val := p_rules -> 'min_staff_per_day';
    if jsonb_typeof(v_val) = 'null' then
      v_new := jsonb_build_object('min_staff_per_day', null);
    elsif jsonb_typeof(v_val) = 'number' and (v_val #>> '{}')::numeric between 1 and 50 and (v_val #>> '{}')::numeric = trunc((v_val #>> '{}')::numeric) then
      v_new := jsonb_build_object('min_staff_per_day', v_val);
    else
      raise exception 'invalid_input';
    end if;
  end if;

  select value into v_cur from public.app_settings where key = 'scheduling_rules' for update;
  v_cur := coalesce(v_cur, '{}'::jsonb) || v_new;
  insert into public.app_settings (key, value) values ('scheduling_rules', v_cur)
    on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'settings.rules_changed', 'app_settings', 'scheduling_rules', v_new);
  return v_cur;
end $$;

-- save_shift without the long-shift warning
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

  return jsonb_build_object('ok', true, 'id', v_id, 'warnings', v_warnings);
end $$;
