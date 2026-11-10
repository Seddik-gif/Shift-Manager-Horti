-- Shift swaps: an employee hands one of their upcoming shifts to a colleague.
--   pending  (waiting for the colleague)  ->  review (colleague accepted, waiting for an admin)  ->  approved
--   or rejected / cancelled at any step. If the "admin approval" option is off, the colleague's yes completes it.
-- Nothing changes on the calendar until the swap is approved; the move is one transactional update.

insert into public.app_settings (key, value) values ('swap_options', '{"admin_approval": true}')
  on conflict (key) do nothing;

create table public.shift_swaps (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  proposer uuid not null references public.profiles (id),
  recipient uuid not null references public.profiles (id),
  note text,
  status text not null default 'pending' check (status in ('pending', 'review', 'approved', 'rejected', 'cancelled')),
  responded_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (proposer <> recipient)
);
create unique index shift_swaps_one_active on public.shift_swaps (shift_id) where status in ('pending', 'review');
create index shift_swaps_recipient_idx on public.shift_swaps (recipient, status);
create index shift_swaps_proposer_idx on public.shift_swaps (proposer, status);

alter table public.shift_swaps enable row level security;
create policy swaps_select on public.shift_swaps for select to authenticated
  using (proposer = auth.uid() or recipient = auth.uid() or public.is_admin());
revoke insert, update, delete on public.shift_swaps from authenticated, anon;
alter publication supabase_realtime add table public.shift_swaps;

-- A changed or reassigned shift invalidates any swap still waiting on it.
create or replace function public.shifts_cancel_swaps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.shift_swaps set status = 'cancelled', decided_at = now(), decision_note = 'shift changed'
   where shift_id = new.id and status in ('pending', 'review');
  return null;
end $$;
create trigger shifts_cancel_swaps after update on public.shifts
  for each row when (old.employee_id is distinct from new.employee_id
                     or old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
  execute function public.shifts_cancel_swaps();

-- ───────────── who can take this shift? ─────────────
-- Colleagues at the shift's location who are free then and not on approved leave. Only the shift's owner may ask.
create or replace function public.swap_candidates(p_shift uuid)
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
declare v public.shifts; v_loc uuid;
begin
  select s.* into v from public.shifts s where s.id = p_shift and s.employee_id = auth.uid();
  if not found then return; end if;
  select w.location_id into v_loc from public.weekly_schedules w where w.id = v.schedule_id;
  return query
    select p.id, trim(p.first_name || ' ' || p.last_name)
      from public.profiles p
      join public.employee_locations el on el.employee_id = p.id and el.location_id = v_loc
     where p.is_active and p.role = 'employee' and p.id <> v.employee_id
       and not exists (select 1 from public.shifts o where o.employee_id = p.id and tstzrange(o.starts_at, o.ends_at) && tstzrange(v.starts_at, v.ends_at))
       and not public.on_approved_absence(p.id, v.starts_at, v.ends_at)
     order by p.first_name, p.last_name;
end $$;

-- ───────────── the move itself ─────────────
create or replace function public.execute_swap(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.shift_swaps; v_shift public.shifts; v_loc uuid; v_avail text;
begin
  select * into v_s from public.shift_swaps where id = p_id for update;
  select * into v_shift from public.shifts where id = v_s.shift_id for update;
  if not found or v_shift.employee_id <> v_s.proposer then raise exception 'swap_stale'; end if;
  if v_shift.starts_at <= now() then raise exception 'in_the_past'; end if;
  select w.location_id into v_loc from public.weekly_schedules w where w.id = v_shift.schedule_id;
  if not exists (select 1 from public.profiles p join public.employee_locations el on el.employee_id = p.id and el.location_id = v_loc
                  where p.id = v_s.recipient and p.is_active and p.role = 'employee') then
    raise exception 'recipient_unavailable';
  end if;
  if public.on_approved_absence(v_s.recipient, v_shift.starts_at, v_shift.ends_at) then raise exception 'recipient_absent'; end if;

  update public.shift_swaps set status = 'approved' where id = p_id; -- first, so the cancel-trigger leaves it alone
  v_avail := public.availability_status(v_s.recipient, v_shift.starts_at, v_shift.ends_at);
  perform set_config('app.quiet_shift_notify', '1', true);
  begin
    update public.shifts
       set employee_id = v_s.recipient,
           availability_override = v_avail in ('outside', 'no_submission'),
           override_reason = case when v_avail in ('outside', 'no_submission') then 'approved shift swap' end
     where id = v_shift.id;
  exception when exclusion_violation then
    perform set_config('app.quiet_shift_notify', '', true);
    raise exception 'recipient_busy';
  end;
  perform set_config('app.quiet_shift_notify', '', true);
  perform public.touch_schedule(v_shift.schedule_id);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'shift.swapped', 'shift', v_shift.id::text,
          jsonb_build_object('from', v_s.proposer, 'to', v_s.recipient, 'swap_id', p_id,
                             'starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at));
  perform public.notify_users(array[v_s.proposer, v_s.recipient], 'swap_approved',
    jsonb_build_object('employee_name', public.person_name(v_s.proposer), 'other_name', public.person_name(v_s.recipient),
                       'starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at),
    '/employee/schedule?loc=' || v_loc, 'swap:' || p_id || ':approved');
end $$;
revoke all on function public.execute_swap(uuid) from public, anon, authenticated;

-- ───────────── employee steps ─────────────
create or replace function public.propose_swap(p_shift uuid, p_recipient uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.shifts; v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'employee' and is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'invalid_input'; end if;
  select * into v from public.shifts where id = p_shift and employee_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if v.starts_at <= now() then raise exception 'in_the_past'; end if;
  if not exists (select 1 from public.swap_candidates(p_shift) c where c.id = p_recipient) then raise exception 'recipient_unavailable'; end if;
  begin
    insert into public.shift_swaps (shift_id, proposer, recipient, note)
    values (p_shift, v_uid, p_recipient, nullif(trim(p_note), '')) returning id into v_id;
  exception when unique_violation then raise exception 'swap_exists'; end;
  perform public.notify_users(array[p_recipient], 'swap_proposed',
    jsonb_build_object('employee_name', public.person_name(v_uid), 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'note', nullif(trim(p_note), '')),
    '/employee/swaps', 'swap:' || v_id || ':proposed');
  return v_id;
end $$;

create or replace function public.respond_swap(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s public.shift_swaps; v public.shifts; v_needs boolean; v_params jsonb;
begin
  select * into v_s from public.shift_swaps where id = p_id and recipient = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status <> 'pending' then raise exception 'already_decided'; end if;
  select * into v from public.shifts where id = v_s.shift_id;
  if not found then raise exception 'swap_stale'; end if;
  v_params := jsonb_build_object('employee_name', public.person_name(v_s.proposer), 'other_name', public.person_name(v_uid),
                                 'starts_at', v.starts_at, 'ends_at', v.ends_at);

  if not p_accept then
    update public.shift_swaps set status = 'rejected', responded_at = now() where id = p_id;
    perform public.notify_users(array[v_s.proposer], 'swap_declined', v_params, '/employee/swaps', 'swap:' || p_id || ':declined');
    return 'rejected';
  end if;

  select coalesce((value ->> 'admin_approval')::boolean, true) into v_needs from public.app_settings where key = 'swap_options';
  v_needs := coalesce(v_needs, true);
  update public.shift_swaps set responded_at = now(), status = 'review' where id = p_id;
  if v_needs then
    perform public.notify_users(array[v_s.proposer], 'swap_accepted', v_params, '/employee/swaps', 'swap:' || p_id || ':accepted');
    perform public.notify_users(public.active_user_ids('admin'), 'swap_review', v_params, '/admin/requests', 'swap:' || p_id || ':review');
    return 'review';
  end if;
  perform public.execute_swap(p_id); -- no admin step: the colleague's yes completes it
  update public.shift_swaps set decided_at = now(), decision_note = 'auto-approved' where id = p_id;
  return 'approved';
end $$;

create or replace function public.withdraw_swap(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.shift_swaps set status = 'cancelled', decided_at = now()
   where id = p_id and proposer = auth.uid() and status in ('pending', 'review');
  if not found then raise exception 'not_found'; end if;
end $$;

-- ───────────── admin ─────────────
create or replace function public.decide_swap(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.shift_swaps; v public.shifts;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_s from public.shift_swaps where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status <> 'review' then raise exception 'already_decided'; end if;

  if p_approve then
    perform public.execute_swap(p_id);
    update public.shift_swaps set decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
  else
    select * into v from public.shifts where id = v_s.shift_id;
    update public.shift_swaps set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
    perform public.notify_users(array[v_s.proposer, v_s.recipient], 'swap_rejected',
      jsonb_build_object('employee_name', public.person_name(v_s.proposer), 'other_name', public.person_name(v_s.recipient),
                         'starts_at', v.starts_at, 'ends_at', v.ends_at, 'note', nullif(trim(p_note), '')),
      '/employee/swaps', 'swap:' || p_id || ':rejected');
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
    values (auth.uid(), 'swap.rejected', 'shift_swap', p_id::text, jsonb_build_object('shift_id', v_s.shift_id));
  end if;
end $$;

create or replace function public.save_swap_options(p_admin_approval boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_admin_approval is null then raise exception 'invalid_input'; end if;
  insert into public.app_settings (key, value) values ('swap_options', jsonb_build_object('admin_approval', p_admin_approval))
    on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'settings.swap_options_changed', 'app_settings', 'swap_options', jsonb_build_object('admin_approval', p_admin_approval));
end $$;

revoke all on function public.swap_candidates(uuid) from public, anon;
revoke all on function public.propose_swap(uuid, uuid, text) from public, anon;
revoke all on function public.respond_swap(uuid, boolean) from public, anon;
revoke all on function public.withdraw_swap(uuid) from public, anon;
revoke all on function public.decide_swap(uuid, boolean, text) from public, anon;
revoke all on function public.save_swap_options(boolean) from public, anon;
grant execute on function public.swap_candidates(uuid) to authenticated;
grant execute on function public.propose_swap(uuid, uuid, text) to authenticated;
grant execute on function public.respond_swap(uuid, boolean) to authenticated;
grant execute on function public.withdraw_swap(uuid) to authenticated;
grant execute on function public.decide_swap(uuid, boolean, text) to authenticated;
grant execute on function public.save_swap_options(boolean) to authenticated;
