-- open_shifts.slots now means 'places still free' so employees can see how many are left.

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
      -- `slots` is the number of places still free; the last approval fills the shift
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
          'starts_at', v_r.starts_at, 'ends_at', v_r.ends_at, 'shift_id', v_shift));
  return jsonb_build_object('ok', true, 'shift_id', v_shift);
end $$;
