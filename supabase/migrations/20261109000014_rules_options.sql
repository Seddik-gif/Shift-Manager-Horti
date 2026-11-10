-- "Regole & Opzioni": admin-editable conflict rules.
--   rest_min_hours        minimum rest between two shifts of one person (any location). null = off. Default 11.
--   weekly_hours_warning  contract/weekly hours threshold, summed over all locations. null = off. Default 40.
--   long_shift_warning_hours  a single shift longer than this. null = off.
--   min_staff_per_day     minimum number of people planned per day at a location. null = off (default).
-- Overlap (double-booking) is never optional and is enforced by the database. These are warnings, not legal limits.

update public.app_settings
   set value = jsonb_build_object('rest_min_hours', 11, 'min_staff_per_day', null) || value
 where key = 'scheduling_rules';

update public.app_settings
   set value = jsonb_set(value, '{weekly_hours_warning}', '40'::jsonb)
 where key = 'scheduling_rules' and jsonb_typeof(value -> 'weekly_hours_warning') in ('null') ;

create or replace function public.save_scheduling_rules(p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_max constant jsonb := '{"rest_min_hours": 24, "weekly_hours_warning": 168, "long_shift_warning_hours": 24, "min_staff_per_day": 50}';
  v_new jsonb := '{}'::jsonb;
  v_val jsonb;
  v_cur jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'invalid_input'; end if;

  for v_key in select jsonb_object_keys(v_max) loop
    if not p_rules ? v_key then continue; end if;
    v_val := p_rules -> v_key;
    if jsonb_typeof(v_val) = 'null' then
      v_new := v_new || jsonb_build_object(v_key, null);
    elsif jsonb_typeof(v_val) = 'number' and (v_val #>> '{}')::numeric > 0 and (v_val #>> '{}')::numeric <= (v_max ->> v_key)::numeric then
      v_new := v_new || jsonb_build_object(v_key, v_val);
    else
      raise exception 'invalid_input';
    end if;
  end loop;

  select value into v_cur from public.app_settings where key = 'scheduling_rules' for update;
  v_cur := coalesce(v_cur, '{}'::jsonb) || v_new;
  insert into public.app_settings (key, value) values ('scheduling_rules', v_cur)
    on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'settings.rules_changed', 'app_settings', 'scheduling_rules', v_new);
  return v_cur;
end $$;

revoke all on function public.save_scheduling_rules(jsonb) from public, anon;
grant execute on function public.save_scheduling_rules(jsonb) to authenticated;
