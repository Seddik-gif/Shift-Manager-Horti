-- Shift changes made by an admin no longer notify the employee one by one. They are collected here (net of the
-- admin's own back-and-forth) and sent as ONE message per employee when the admin presses "Notify the team".

create table public.pending_shift_notices (
  shift_id uuid not null,                       -- no foreign key: the shift may already be deleted
  employee_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('assigned', 'changed', 'removed')),
  starts_at timestamptz not null,               -- the shift as it is now (for 'removed': as it was)
  ends_at timestamptz not null,
  old_starts_at timestamptz,                    -- 'changed' only: as the employee last knew it
  old_ends_at timestamptz,
  week_start date not null,
  created_at timestamptz not null default now(),
  primary key (shift_id, employee_id)
);
alter table public.pending_shift_notices enable row level security;
revoke all on public.pending_shift_notices from anon, authenticated;

-- ── staging helpers (internal) ──
create or replace function public.stage_shift_assigned(p_shift uuid, p_emp uuid, p_s timestamptz, p_e timestamptz, p_week date)
returns void language sql security definer set search_path = '' as $$
  insert into public.pending_shift_notices (shift_id, employee_id, kind, starts_at, ends_at, week_start)
  values (p_shift, p_emp, 'assigned', p_s, p_e, p_week)
  on conflict (shift_id, employee_id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, week_start = excluded.week_start;
$$;

create or replace function public.stage_shift_changed(p_shift uuid, p_emp uuid, p_old_s timestamptz, p_old_e timestamptz, p_s timestamptz, p_e timestamptz, p_week date)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.pending_shift_notices;
begin
  select * into v from public.pending_shift_notices where shift_id = p_shift and employee_id = p_emp;
  if not found then
    insert into public.pending_shift_notices (shift_id, employee_id, kind, starts_at, ends_at, old_starts_at, old_ends_at, week_start)
    values (p_shift, p_emp, 'changed', p_s, p_e, p_old_s, p_old_e, p_week);
  elsif v.kind = 'assigned' then
    update public.pending_shift_notices set starts_at = p_s, ends_at = p_e, week_start = p_week where shift_id = p_shift and employee_id = p_emp;
  elsif v.old_starts_at = p_s and v.old_ends_at = p_e then
    delete from public.pending_shift_notices where shift_id = p_shift and employee_id = p_emp; -- moved back: nothing to tell
  else
    update public.pending_shift_notices set starts_at = p_s, ends_at = p_e, week_start = p_week where shift_id = p_shift and employee_id = p_emp;
  end if;
end $$;

create or replace function public.stage_shift_removed(p_shift uuid, p_emp uuid, p_s timestamptz, p_e timestamptz, p_week date)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.pending_shift_notices;
begin
  select * into v from public.pending_shift_notices where shift_id = p_shift and employee_id = p_emp;
  if not found then
    insert into public.pending_shift_notices (shift_id, employee_id, kind, starts_at, ends_at, week_start) values (p_shift, p_emp, 'removed', p_s, p_e, p_week);
  elsif v.kind = 'assigned' then
    delete from public.pending_shift_notices where shift_id = p_shift and employee_id = p_emp; -- created and deleted before anyone was told
  else
    update public.pending_shift_notices set kind = 'removed', starts_at = coalesce(v.old_starts_at, v.starts_at), ends_at = coalesce(v.old_ends_at, v.ends_at),
      old_starts_at = null, old_ends_at = null where shift_id = p_shift and employee_id = p_emp;
  end if;
end $$;
revoke all on function public.stage_shift_assigned(uuid, uuid, timestamptz, timestamptz, date) from public, anon, authenticated;
revoke all on function public.stage_shift_changed(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, date) from public, anon, authenticated;
revoke all on function public.stage_shift_removed(uuid, uuid, timestamptz, timestamptz, date) from public, anon, authenticated;

-- ── the trigger now stages instead of notifying ──
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
      perform public.stage_shift_assigned(new.id, new.employee_id, new.starts_at, new.ends_at, v_week);
    elsif tg_op = 'DELETE' then
      perform public.stage_shift_removed(old.id, old.employee_id, old.starts_at, old.ends_at, v_week);
    elsif old.employee_id <> new.employee_id then
      perform public.stage_shift_removed(old.id, old.employee_id, old.starts_at, old.ends_at, v_week);
      perform public.stage_shift_assigned(new.id, new.employee_id, new.starts_at, new.ends_at, v_week);
    elsif old.starts_at <> new.starts_at or old.ends_at <> new.ends_at then
      perform public.stage_shift_changed(new.id, new.employee_id, old.starts_at, old.ends_at, new.starts_at, new.ends_at, v_week);
    end if;
  end if;
  return null;
end $$;

-- ── admin: what is waiting, send it, or throw it away ──
create or replace function public.pending_shift_notice_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select jsonb_build_object('employees', count(distinct employee_id), 'changes', count(*)) from public.pending_shift_notices);
end $$;

create or replace function public.send_shift_updates() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_emps int := 0; v_changes int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in
    select n.employee_id,
           count(*) as total,
           count(*) filter (where n.kind = 'assigned') as assigned,
           count(*) filter (where n.kind = 'changed') as changed,
           count(*) filter (where n.kind = 'removed') as removed,
           min(n.week_start) as first_week
    from public.pending_shift_notices n join public.profiles p on p.id = n.employee_id and p.is_active
    group by n.employee_id
  loop
    perform public.notify_users(array[r.employee_id], 'shifts_updated',
      jsonb_build_object('count', r.total, 'assigned', r.assigned, 'changed', r.changed, 'removed', r.removed),
      '/employee/schedule?date=' || r.first_week, null);
    v_emps := v_emps + 1; v_changes := v_changes + r.total;
  end loop;
  delete from public.pending_shift_notices where true; -- Supabase refuses a DELETE without WHERE
  return jsonb_build_object('employees', v_emps, 'changes', v_changes);
end $$;

create or replace function public.discard_shift_notices() returns integer
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.pending_shift_notices where true;
  get diagnostics v = row_count;
  return v;
end $$;

revoke all on function public.pending_shift_notice_summary() from public, anon;
revoke all on function public.send_shift_updates() from public, anon;
revoke all on function public.discard_shift_notices() from public, anon;
grant execute on function public.pending_shift_notice_summary() to authenticated;
grant execute on function public.send_shift_updates() to authenticated;
grant execute on function public.discard_shift_notices() to authenticated;
