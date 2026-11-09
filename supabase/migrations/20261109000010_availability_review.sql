-- Availability must be CONFIRMED by an admin. A submission is "pending" until an admin confirms it
-- or asks for changes; any resubmission by the employee puts it back to "pending".

alter table public.availability_submissions
  add column review_status text not null default 'pending' check (review_status in ('pending', 'confirmed', 'changes_requested')),
  add column reviewed_by uuid references public.profiles (id),
  add column reviewed_at timestamptz,
  add column review_note text;

-- Employees can no longer write status / review fields directly through the API (only through the
-- SECURITY DEFINER functions, which run as the table owner).
create or replace function public.protect_submission_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.status is distinct from old.status or new.submitted_at is distinct from old.submitted_at
       or new.review_status is distinct from old.review_status or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note
       or new.employee_id <> old.employee_id or new.request_id <> old.request_id then
      raise exception 'Only the application can change these fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger availability_submissions_protect before update on public.availability_submissions
  for each row execute function public.protect_submission_fields();

drop policy submissions_employee_insert on public.availability_submissions;
create policy submissions_employee_insert on public.availability_submissions for insert to authenticated
  with check (
    employee_id = auth.uid() and public.is_active_user() and status = 'draft' and review_status = 'pending'
    and exists (select 1 from public.availability_requests r where r.id = request_id and r.status = 'open')
  );

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
         submitted_at = case when p_submit then now() else submitted_at end,
         -- every (re)submission goes back to "waiting for an admin"
         review_status = case when p_submit then 'pending' else review_status end,
         reviewed_by = case when p_submit then null else reviewed_by end,
         reviewed_at = case when p_submit then null else reviewed_at end,
         review_note = case when p_submit then null else review_note end
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

create or replace function public.review_availability(p_submission uuid, p_confirm boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.availability_submissions; v_week date;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_s from public.availability_submissions where id = p_submission for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status <> 'submitted' then raise exception 'not_submitted'; end if;
  if not p_confirm and coalesce(trim(p_note), '') = '' then raise exception 'note_required'; end if;
  select week_start into v_week from public.availability_requests where id = v_s.request_id;

  update public.availability_submissions
     set review_status = case when p_confirm then 'confirmed' else 'changes_requested' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_submission;

  perform public.notify_users(array[v_s.employee_id],
    case when p_confirm then 'availability_review_confirmed' else 'availability_changes_requested' end,
    jsonb_build_object('week_start', v_week, 'note', nullif(trim(p_note), ''), 'request_id', v_s.request_id),
    '/employee/availability/' || v_s.request_id, 'rev:' || case when p_confirm then 'c' else 'x' end || ':' || p_submission || ':' || extract(epoch from now())::bigint);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), case when p_confirm then 'availability.confirmed' else 'availability.changes_requested' end,
          'availability_submission', p_submission::text, jsonb_build_object('employee_id', v_s.employee_id, 'week_start', v_week));
end $$;
revoke all on function public.review_availability(uuid, boolean, text) from public, anon;
grant execute on function public.review_availability(uuid, boolean, text) to authenticated;
