-- Live calendar for everyone + open shifts + employee requests (always confirmed by an admin).
-- Only administrators can create, change or remove shifts. Employees can only ASK (take an open shift,
-- or offer to work a time); a request becomes a real shift only when an admin approves it.

-- ───────────── live employee view of the calendar ─────────────
-- Employees read this view (names, colours, times, position) – never notes or override details.
create view public.team_shifts as
  select s.id, s.employee_id, trim(p.first_name || ' ' || p.last_name) as employee_name, p.color,
         s.job_position, s.starts_at, s.ends_at
  from public.shifts s
  join public.profiles p on p.id = s.employee_id
  where public.is_active_user();
grant select on public.team_shifts to authenticated;

-- Realtime cannot stream a view, and employees may not read the shifts table, so every change to a
-- shift bumps a per-week "pulse" row that employees are allowed to subscribe to.
create table public.schedule_pulse (
  week_start date primary key,
  changed_at timestamptz not null default now()
);
alter table public.schedule_pulse enable row level security;
create policy pulse_select on public.schedule_pulse for select to authenticated using (public.is_active_user());
revoke insert, update, delete on public.schedule_pulse from authenticated, anon;

create or replace function public.bump_pulse(p_week date) returns void
language sql security definer set search_path = '' as $$
  insert into public.schedule_pulse (week_start) values (p_week)
  on conflict (week_start) do update set changed_at = now();
$$;
revoke all on function public.bump_pulse(date) from public, anon, authenticated;

-- Pulse + notify the person whose shift was created / changed / removed.
create or replace function public.shifts_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_week date;
  v_quiet boolean := coalesce(current_setting('app.quiet_shift_notify', true), '') = '1';
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select week_start into v_week from public.weekly_schedules where id = new.schedule_id;
    perform public.bump_pulse(v_week);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select week_start into v_week from public.weekly_schedules where id = old.schedule_id;
    perform public.bump_pulse(v_week);
  end if;

  if not v_quiet then
    if tg_op = 'INSERT' then
      perform public.notify_users(array[new.employee_id], 'shift_assigned',
        jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at), '/employee/schedule?date=' || v_week, null);
    elsif tg_op = 'DELETE' then
      perform public.notify_users(array[old.employee_id], 'shift_removed',
        jsonb_build_object('starts_at', old.starts_at, 'ends_at', old.ends_at), '/employee/schedule?date=' || v_week, null);
    elsif old.employee_id <> new.employee_id then
      perform public.notify_users(array[old.employee_id], 'shift_removed',
        jsonb_build_object('starts_at', old.starts_at, 'ends_at', old.ends_at), '/employee/schedule?date=' || v_week, null);
      perform public.notify_users(array[new.employee_id], 'shift_assigned',
        jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at), '/employee/schedule?date=' || v_week, null);
    elsif old.starts_at <> new.starts_at or old.ends_at <> new.ends_at then
      perform public.notify_users(array[new.employee_id], 'shift_changed',
        jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at,
                           'old_starts_at', old.starts_at, 'old_ends_at', old.ends_at),
        '/employee/schedule?date=' || v_week, null);
    end if;
  end if;
  return null;
end $$;
create trigger shifts_after_change after insert or update or delete on public.shifts
  for each row execute function public.shifts_after_change();

-- ───────────── open shifts (posted by admins) ─────────────
create table public.open_shifts (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  job_position text,
  note text,
  slots integer not null default 1 check (slots between 1 and 20),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index open_shifts_time_idx on public.open_shifts (starts_at) where status = 'open';
alter table public.open_shifts enable row level security;
create policy open_shifts_select on public.open_shifts for select to authenticated
  using (public.is_admin() or (public.is_active_user() and status = 'open'));
revoke insert, update, delete on public.open_shifts from authenticated, anon;

-- ───────────── requests from employees ─────────────
create table public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('take', 'offer')),
  open_shift_id uuid references public.open_shifts (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  shift_id uuid references public.shifts (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'take') = (open_shift_id is not null))
);
create unique index shift_requests_one_take on public.shift_requests (employee_id, open_shift_id)
  where status = 'pending' and open_shift_id is not null;
create unique index shift_requests_one_offer on public.shift_requests (employee_id, starts_at, ends_at)
  where status = 'pending' and kind = 'offer';
create index shift_requests_status_idx on public.shift_requests (status, created_at desc);
alter table public.shift_requests enable row level security;
create policy requests_select_own on public.shift_requests for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.shift_requests from authenticated, anon;

alter publication supabase_realtime add table public.schedule_pulse, public.open_shifts, public.shift_requests;

-- ───────────── helpers ─────────────
create or replace function public.shift_window(p_day date, p_start time, p_end time)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_cfg jsonb; v_open time := '07:00'; v_close time := '02:00';
begin
  if p_day is null or p_start is null or p_end is null or p_start = p_end then raise exception 'invalid_input'; end if;
  select value into v_cfg from public.app_settings where key = 'shift_hours';
  if v_cfg is not null then
    v_open := coalesce((v_cfg ->> 'earliest_start')::time, v_open);
    v_close := coalesce((v_cfg ->> 'latest_end')::time, v_close);
  end if;
  if p_start < v_open or (p_end <= p_start and p_end > v_close) then raise exception 'outside_hours'; end if;
  return query select (p_day + p_start) at time zone 'Europe/Rome',
    (case when p_end > p_start then p_day + p_end else (p_day + 1) + p_end end) at time zone 'Europe/Rome';
end $$;
revoke all on function public.shift_window(date, time, time) from public, anon, authenticated;

create or replace function public.person_name(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select trim(first_name || ' ' || last_name) from public.profiles where id = p_id;
$$;
revoke all on function public.person_name(uuid) from public, anon, authenticated;

-- ───────────── admin: open shifts ─────────────
create or replace function public.create_open_shift(
  p_day date, p_start time, p_end time, p_position text, p_note text, p_slots integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_w record; v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_w from public.shift_window(p_day, p_start, p_end);
  begin
    insert into public.open_shifts (starts_at, ends_at, job_position, note, slots, created_by)
    values (v_w.starts_at, v_w.ends_at, nullif(trim(p_position), ''), nullif(trim(p_note), ''), coalesce(p_slots, 1), auth.uid())
    returning id into v_id;
  exception when check_violation then raise exception 'invalid_input'; end;
  perform public.bump_pulse(public.monday_of(p_day));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'open_shift.created', 'open_shift', v_id::text,
          jsonb_build_object('starts_at', v_w.starts_at, 'ends_at', v_w.ends_at, 'slots', coalesce(p_slots, 1)));
  perform public.notify_users(public.active_user_ids('employee'), 'open_shift_posted',
    jsonb_build_object('starts_at', v_w.starts_at, 'ends_at', v_w.ends_at, 'open_shift_id', v_id),
    '/employee/schedule?date=' || p_day, 'open:' || v_id);
  return v_id;
end $$;

create or replace function public.cancel_open_shift(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_o public.open_shifts; r record;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.open_shifts set status = 'cancelled' where id = p_id and status = 'open' returning * into v_o;
  if not found then raise exception 'not_found'; end if;
  for r in update public.shift_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
                  decision_note = 'open shift cancelled'
            where open_shift_id = p_id and status = 'pending' returning employee_id, starts_at, ends_at loop
    perform public.notify_users(array[r.employee_id], 'shift_request_rejected',
      jsonb_build_object('starts_at', r.starts_at, 'ends_at', r.ends_at), '/employee/schedule', null);
  end loop;
  perform public.bump_pulse(public.monday_of((v_o.starts_at at time zone 'Europe/Rome')::date));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'open_shift.cancelled', 'open_shift', p_id::text, '{}');
end $$;

-- ───────────── employee: ask, never assign ─────────────
create or replace function public.request_open_shift(p_open uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_o public.open_shifts; v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'employee' and is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_o from public.open_shifts where id = p_open and status = 'open' for update;
  if not found then raise exception 'not_open'; end if;
  if exists (select 1 from public.shifts where employee_id = v_uid and tstzrange(starts_at, ends_at) && tstzrange(v_o.starts_at, v_o.ends_at)) then
    raise exception 'overlap';
  end if;
  begin
    insert into public.shift_requests (employee_id, kind, open_shift_id, starts_at, ends_at, note)
    values (v_uid, 'take', p_open, v_o.starts_at, v_o.ends_at, nullif(trim(p_note), '')) returning id into v_id;
  exception when unique_violation then raise exception 'already_requested'; end;
  perform public.notify_users(public.active_user_ids('admin'), 'shift_request_received',
    jsonb_build_object('employee_name', public.person_name(v_uid), 'starts_at', v_o.starts_at, 'ends_at', v_o.ends_at, 'kind', 'take'),
    '/admin/requests', 'reqrcv:' || v_id);
  return v_id;
end $$;

create or replace function public.offer_shift(p_day date, p_start time, p_end time, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_w record; v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'employee' and is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_w from public.shift_window(p_day, p_start, p_end);
  if v_w.starts_at < now() then raise exception 'in_the_past'; end if;
  if exists (select 1 from public.shifts where employee_id = v_uid and tstzrange(starts_at, ends_at) && tstzrange(v_w.starts_at, v_w.ends_at)) then
    raise exception 'overlap';
  end if;
  begin
    insert into public.shift_requests (employee_id, kind, starts_at, ends_at, note)
    values (v_uid, 'offer', v_w.starts_at, v_w.ends_at, nullif(trim(p_note), '')) returning id into v_id;
  exception when unique_violation then raise exception 'already_requested'; end;
  perform public.notify_users(public.active_user_ids('admin'), 'shift_request_received',
    jsonb_build_object('employee_name', public.person_name(v_uid), 'starts_at', v_w.starts_at, 'ends_at', v_w.ends_at, 'kind', 'offer'),
    '/admin/requests', 'reqrcv:' || v_id);
  return v_id;
end $$;

create or replace function public.withdraw_shift_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.shift_requests set status = 'cancelled', decided_at = now()
   where id = p_id and employee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'not_found'; end if;
end $$;

-- ───────────── admin: confirm or refuse ─────────────
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
    -- the decision notification below replaces the generic "shift assigned" one
    perform set_config('app.quiet_shift_notify', '1', true);
    -- the employee asked for exactly this time, so an availability mismatch is acknowledged by the approval
    v_res := public.save_shift(null, v_r.employee_id,
      (v_r.starts_at at time zone 'Europe/Rome')::date, (v_r.starts_at at time zone 'Europe/Rome')::time,
      (v_r.ends_at at time zone 'Europe/Rome')::time, v_o.job_position, null, true, 'approved employee request');
    perform set_config('app.quiet_shift_notify', '', true);
    v_shift := (v_res ->> 'id')::uuid;

    update public.shift_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(trim(p_note), ''), shift_id = v_shift where id = p_id;

    if v_o.id is not null then
      select count(*) into v_taken from public.shift_requests where open_shift_id = v_o.id and status = 'approved';
      if v_taken >= v_o.slots then
        update public.open_shifts set status = 'filled' where id = v_o.id;
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
          'starts_at', v_r.starts_at, 'ends_at', v_r.ends_at, 'shift_id', v_shift));
  return jsonb_build_object('ok', true, 'shift_id', v_shift);
end $$;

revoke all on function public.create_open_shift(date, time, time, text, text, integer) from public, anon;
revoke all on function public.cancel_open_shift(uuid) from public, anon;
revoke all on function public.request_open_shift(uuid, text) from public, anon;
revoke all on function public.offer_shift(date, time, time, text) from public, anon;
revoke all on function public.withdraw_shift_request(uuid) from public, anon;
revoke all on function public.decide_shift_request(uuid, boolean, text) from public, anon;
grant execute on function public.create_open_shift(date, time, time, text, text, integer) to authenticated;
grant execute on function public.cancel_open_shift(uuid) to authenticated;
grant execute on function public.request_open_shift(uuid, text) to authenticated;
grant execute on function public.offer_shift(date, time, time, text) to authenticated;
grant execute on function public.withdraw_shift_request(uuid) to authenticated;
grant execute on function public.decide_shift_request(uuid, boolean, text) to authenticated;
