-- Web Push. A subscription belongs to one browser/device of one person.
-- The server delivers each notification once per channel (notification_deliveries) and reports per device:
--   * the push service says the device is gone (404/410)  -> subscription deleted
--   * three failures in a row                              -> subscription disabled ("notifications off ⚠️")
-- A person counts as "notified" only when they hold at least one working (not disabled) subscription.

alter table public.notification_deliveries drop constraint notification_deliveries_channel_check;
alter table public.notification_deliveries add constraint notification_deliveries_channel_check check (channel in ('email', 'push'));

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 10 and 100),
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0,
  disabled_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where disabled_at is null;

alter table public.push_subscriptions enable row level security;
create policy push_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- The keys are secrets of the device: only the server (service role) may read them. A column-level REVOKE would
-- not work on top of the table-wide default grant, so take everything away and grant back the harmless columns.
revoke all on public.push_subscriptions from authenticated, anon;
grant select (id, user_id, endpoint, user_agent, created_at, last_success_at, last_failure_at, failure_count, disabled_at)
  on public.push_subscriptions to authenticated;

-- A device registers (or re-registers after a failure). If the same browser was used by someone else, it moves to the caller.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not public.is_active_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
    on conflict (endpoint) do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
          failure_count = 0, disabled_at = null, last_failure_at = null;
  exception when check_violation then raise exception 'invalid_input'; end;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Admin: who will actually receive pushes? (publish screen: "X notified · Y without notifications")
create or replace function public.push_coverage(p_location uuid default null)
returns table (user_id uuid, name text, state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select p.id, trim(p.first_name || ' ' || p.last_name),
           case when exists (select 1 from public.push_subscriptions s where s.user_id = p.id and s.disabled_at is null) then 'active'
                when exists (select 1 from public.push_subscriptions s where s.user_id = p.id) then 'disabled'
                else 'none' end
      from public.profiles p
     where p.role = 'employee' and p.is_active
       and (p_location is null or exists (select 1 from public.employee_locations el where el.employee_id = p.id and el.location_id = p_location))
     order by p.first_name, p.last_name;
end $$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.push_coverage(uuid) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_coverage(uuid) to authenticated;
