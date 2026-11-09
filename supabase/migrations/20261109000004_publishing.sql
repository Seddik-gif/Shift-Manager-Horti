-- Phase 5: publishing. Employees only ever read immutable snapshots in schedule_versions;
-- editing shifts never changes what they see until an admin explicitly (re)publishes.

-- Versions are history: never edited, never deleted.
create or replace function public.schedule_versions_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'schedule_versions is append-only';
end $$;
create trigger schedule_versions_no_change before update or delete on public.schedule_versions
  for each row execute function public.schedule_versions_immutable();

-- The official schedule per week = the latest published version. Visible to any active user.
-- Internal shift notes are deliberately not part of the snapshot.
create view public.published_schedules as
  select s.week_start, v.version, v.snapshot, v.published_at, v.published_by
  from public.weekly_schedules s
  join public.schedule_versions v on v.schedule_id = s.id and v.version = s.current_version
  where s.status = 'published' and public.is_active_user();
grant select on public.published_schedules to authenticated;

create or replace function public.publish_schedule(p_week_start date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.weekly_schedules;
  v_snapshot jsonb;
  v_count int;
  v_version int;
  v_republish boolean;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if extract(isodow from p_week_start) <> 1 then raise exception 'invalid_input'; end if;

  -- lock the row: two simultaneous clicks cannot both publish
  select * into v_s from public.weekly_schedules where week_start = p_week_start for update;
  if not found then raise exception 'schedule_not_found'; end if;
  if v_s.status = 'published' and not v_s.has_unpublished_changes then raise exception 'nothing_to_publish'; end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'shift_id', s.id, 'employee_id', s.employee_id,
           'employee_name', trim(p.first_name || ' ' || p.last_name), 'color', p.color,
           'position', s.job_position, 'starts_at', s.starts_at, 'ends_at', s.ends_at
         ) order by s.starts_at, p.first_name), '[]'::jsonb)
    into v_count, v_snapshot
    from public.shifts s join public.profiles p on p.id = s.employee_id
   where s.schedule_id = v_s.id;
  if v_count = 0 then raise exception 'empty_schedule'; end if;

  v_republish := v_s.status = 'published';
  v_version := v_s.current_version + 1;

  insert into public.schedule_versions (schedule_id, version, snapshot, published_by)
  values (v_s.id, v_version, jsonb_build_object('week_start', p_week_start, 'shifts', v_snapshot), auth.uid());

  update public.weekly_schedules
     set status = 'published', current_version = v_version, has_unpublished_changes = false,
         published_at = now(), published_by = auth.uid()
   where id = v_s.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), case when v_republish then 'schedule.republished' else 'schedule.published' end,
          'weekly_schedule', v_s.id::text,
          jsonb_build_object('week_start', p_week_start, 'version', v_version, 'shifts', v_count));

  perform public.notify_users(public.active_user_ids('employee'),
    case when v_republish then 'schedule_updated' else 'schedule_published' end,
    jsonb_build_object('week_start', p_week_start, 'version', v_version),
    '/employee/schedule?date=' || p_week_start, 'pub:' || v_s.id || ':' || v_version);
  perform public.notify_users(public.active_user_ids('admin'), 'schedule_publish_confirmed',
    jsonb_build_object('week_start', p_week_start, 'version', v_version, 'republished', v_republish),
    '/admin/schedule/versions?date=' || p_week_start, 'pubconf:' || v_s.id || ':' || v_version);

  return jsonb_build_object('version', v_version, 'republished', v_republish, 'shifts', v_count);
end $$;

revoke all on function public.publish_schedule(date) from public, anon;
grant execute on function public.publish_schedule(date) to authenticated;
