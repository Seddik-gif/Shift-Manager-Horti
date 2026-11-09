-- Shift hours: the earliest a shift may start is 07:00 and the latest it may end is 02:00 the next day.
-- Configurable in app_settings ('shift_hours'); enforced here, in the single function all shift writes go through.
insert into public.app_settings (key, value) values ('shift_hours', '{"earliest_start": "07:00", "latest_end": "02:00"}')
  on conflict (key) do nothing;

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
  v_cfg jsonb;
  v_open time := '07:00';
  v_close time := '02:00';
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_day is null or p_start is null or p_end is null or p_start = p_end then raise exception 'invalid_input'; end if;
  if not exists (select 1 from public.profiles where id = p_employee and role = 'employee' and is_active) then
    raise exception 'invalid_employee';
  end if;

  -- Shifts must start at/after the opening time and, if they run past midnight, end by the closing time.
  select value into v_cfg from public.app_settings where key = 'shift_hours';
  if v_cfg is not null then
    v_open := coalesce((v_cfg ->> 'earliest_start')::time, v_open);
    v_close := coalesce((v_cfg ->> 'latest_end')::time, v_close);
  end if;
  if p_start < v_open or (p_end <= p_start and p_end > v_close) then raise exception 'outside_hours'; end if;

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
