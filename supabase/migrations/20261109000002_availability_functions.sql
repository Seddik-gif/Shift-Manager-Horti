-- Phase 3: availability workflow. All multi-step writes run inside one transaction (one function call).

-- Internal helper: inserts notifications, silently skipping duplicates (same user + dedupe_key).
create or replace function public.notify_users(
  p_user_ids uuid[], p_type text, p_params jsonb, p_link text, p_dedupe text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, params, link, dedupe_key)
  select u, p_type, p_params, p_link, p_dedupe
  from unnest(p_user_ids) as u
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
$$;
revoke all on function public.notify_users(uuid[], text, jsonb, text, text) from public, anon, authenticated;

create or replace function public.active_user_ids(p_role public.user_role) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role = p_role and is_active;
$$;
revoke all on function public.active_user_ids(public.user_role) from public, anon, authenticated;

-- ── Admin: create a request (draft, or open + notify everyone) ──
create or replace function public.create_availability_request(
  p_week_start date, p_deadline timestamptz, p_message text, p_send boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  begin
    insert into public.availability_requests (week_start, deadline, message, status, created_by, opened_at)
    values (p_week_start, p_deadline, nullif(trim(p_message), ''),
            case when p_send then 'open'::public.request_status else 'draft'::public.request_status end,
            auth.uid(), case when p_send then now() end)
    returning id into v_id;
  exception
    when unique_violation then raise exception 'request_exists';
    when check_violation then raise exception 'invalid_input';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'availability_request.created', 'availability_request', v_id::text,
          jsonb_build_object('week_start', p_week_start, 'deadline', p_deadline, 'sent', p_send));

  if p_send then
    perform public.notify_users(public.active_user_ids('employee'), 'availability_requested',
      jsonb_build_object('week_start', p_week_start, 'deadline', p_deadline, 'request_id', v_id),
      '/employee/availability/' || v_id, 'req-open:' || v_id);
  end if;
  return v_id;
end $$;

-- ── Admin: send a draft request ──
create or replace function public.send_availability_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_req public.availability_requests;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.availability_requests
     set status = 'open', opened_at = now()
   where id = p_id and status = 'draft'
   returning * into v_req;
  if not found then raise exception 'request_not_draft'; end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'availability_request.opened', 'availability_request', p_id::text, '{}');

  perform public.notify_users(public.active_user_ids('employee'), 'availability_requested',
    jsonb_build_object('week_start', v_req.week_start, 'deadline', v_req.deadline, 'request_id', p_id),
    '/employee/availability/' || p_id, 'req-open:' || p_id);
end $$;

-- ── Admin: close a request ──
create or replace function public.close_availability_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.availability_requests set status = 'closed', closed_at = now()
   where id = p_id and status = 'open';
  if not found then raise exception 'request_not_open'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'availability_request.closed', 'availability_request', p_id::text, '{}');
end $$;

-- ── Employee: save a draft or submit availability ──
-- p_days: [{ "day": "2026-11-16", "available": true, "note": "", "windows": [{"start":"09:00","end":"14:30"}] }, ...]
-- An end time that is not after the start means "next day" (18:00–01:00, 17:00–00:00).
create or replace function public.save_availability(
  p_request_id uuid, p_days jsonb, p_notes text, p_submit boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_req public.availability_requests;
  v_sub_id uuid;
  v_prev public.submission_status;
  v_name text;
  v_day jsonb; v_win jsonb;
  v_date date; v_start time; v_end time;
  v_count int := 0;
  v_hash text;
begin
  select first_name || ' ' || last_name into v_name
    from public.profiles where id = v_uid and role = 'employee' and is_active;
  if v_name is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_req from public.availability_requests where id = p_request_id and status = 'open';
  if not found then raise exception 'request_not_open'; end if;

  if jsonb_typeof(p_days) <> 'array' then raise exception 'invalid_input'; end if;

  insert into public.availability_submissions (request_id, employee_id)
  values (p_request_id, v_uid) on conflict (request_id, employee_id) do nothing;
  select id, status into v_sub_id, v_prev from public.availability_submissions
   where request_id = p_request_id and employee_id = v_uid for update;

  if v_prev = 'submitted' and not p_submit then raise exception 'already_submitted'; end if;

  begin
    delete from public.availability_days where submission_id = v_sub_id; -- cascades to windows
    for v_day in select * from jsonb_array_elements(p_days) loop
      v_date := (v_day ->> 'day')::date;
      if v_date < v_req.week_start or v_date > v_req.week_start + 6 then
        raise exception 'day_out_of_week';
      end if;
      insert into public.availability_days (submission_id, day, is_available, note)
      values (v_sub_id, v_date, (v_day ->> 'available')::boolean, nullif(trim(v_day ->> 'note'), ''));
      v_count := v_count + 1;

      if (v_day ->> 'available')::boolean then
        for v_win in select * from jsonb_array_elements(coalesce(v_day -> 'windows', '[]'::jsonb)) loop
          v_start := (v_win ->> 'start')::time;
          v_end := (v_win ->> 'end')::time;
          insert into public.availability_time_windows (submission_id, day, starts_at, ends_at)
          values (v_sub_id, v_date,
                  (v_date + v_start) at time zone 'Europe/Rome',
                  (case when v_end > v_start then v_date + v_end else (v_date + 1) + v_end end) at time zone 'Europe/Rome');
        end loop;
      end if;
    end loop;
  exception
    when exclusion_violation then raise exception 'overlap';
    when unique_violation then raise exception 'duplicate_day';
    when check_violation then raise exception 'invalid_input';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
         or null_value_not_allowed or not_null_violation then raise exception 'invalid_input';
  end;

  if p_submit then
    if v_count <> 7 then raise exception 'incomplete'; end if;
    if exists (
      select 1 from public.availability_days d
       where d.submission_id = v_sub_id and d.is_available
         and not exists (select 1 from public.availability_time_windows w
                          where w.submission_id = d.submission_id and w.day = d.day)
    ) then raise exception 'incomplete'; end if;
  end if;

  update public.availability_submissions
     set notes = nullif(trim(p_notes), ''),
         status = case when p_submit then 'submitted'::public.submission_status else status end,
         submitted_at = case when p_submit then now() else submitted_at end
   where id = v_sub_id;

  if p_submit then
    -- identical re-submissions do not notify twice
    v_hash := md5(p_days::text || coalesce(p_notes, ''));
    perform public.notify_users(public.active_user_ids('admin'),
      case when v_prev = 'submitted' then 'availability_updated' else 'availability_submitted' end,
      jsonb_build_object('employee_id', v_uid, 'employee_name', v_name,
                         'week_start', v_req.week_start, 'request_id', p_request_id),
      '/admin/availability/' || p_request_id || '?employee=' || v_uid,
      'avail:' || v_sub_id || ':' || v_hash);
    perform public.notify_users(array[v_uid], 'availability_confirmed',
      jsonb_build_object('week_start', v_req.week_start, 'request_id', p_request_id),
      '/employee/availability/' || p_request_id, 'conf:' || v_sub_id || ':' || v_hash);
  end if;
  return v_sub_id;
end $$;

-- ── Reminders (run on a schedule by /api/cron/maintenance with the service role) ──
create or replace function public.run_availability_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_req public.availability_requests;
  v_missing uuid[];
  v_total int := 0;
begin
  for v_req in
    select * from public.availability_requests
     where status = 'open' and deadline > now() and deadline <= now() + interval '24 hours'
  loop
    select coalesce(array_agg(p.id), '{}') into v_missing
      from public.profiles p
     where p.role = 'employee' and p.is_active
       and not exists (select 1 from public.availability_submissions s
                        where s.request_id = v_req.id and s.employee_id = p.id and s.status = 'submitted');
    if cardinality(v_missing) > 0 then
      perform public.notify_users(v_missing, 'availability_deadline',
        jsonb_build_object('week_start', v_req.week_start, 'deadline', v_req.deadline, 'request_id', v_req.id),
        '/employee/availability/' || v_req.id, 'deadline:' || v_req.id);
      perform public.notify_users(public.active_user_ids('admin'), 'availability_missing',
        jsonb_build_object('week_start', v_req.week_start, 'count', cardinality(v_missing), 'request_id', v_req.id),
        '/admin/availability/' || v_req.id, 'missing:' || v_req.id);
      v_total := v_total + cardinality(v_missing);
    end if;
  end loop;
  return v_total;
end $$;

revoke all on function public.create_availability_request(date, timestamptz, text, boolean) from public, anon;
revoke all on function public.send_availability_request(uuid) from public, anon;
revoke all on function public.close_availability_request(uuid) from public, anon;
revoke all on function public.save_availability(uuid, jsonb, text, boolean) from public, anon;
revoke all on function public.run_availability_reminders() from public, anon, authenticated;
grant execute on function public.create_availability_request(date, timestamptz, text, boolean) to authenticated;
grant execute on function public.send_availability_request(uuid) to authenticated;
grant execute on function public.close_availability_request(uuid) to authenticated;
grant execute on function public.save_availability(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.run_availability_reminders() to service_role;
