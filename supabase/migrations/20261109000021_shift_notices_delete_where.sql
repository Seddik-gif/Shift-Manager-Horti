-- Supabase's API role runs with a guard that refuses DELETE without WHERE (the test database does not): add it.
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
