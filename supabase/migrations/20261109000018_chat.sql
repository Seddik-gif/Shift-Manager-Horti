-- Chat. Three kinds of thread, names always visible:
--   global    everyone (one thread)
--   location  the admins and the staff assigned to that bar (one thread per location)
--   direct    exactly two people
-- Optional setting "location_broadcast": in location threads employees may only REPLY to a message, not start a topic.
-- Messages (and notification logs) older than 90 days are purged. Schedules and the audit log are never touched.

insert into public.app_settings (key, value) values ('chat_options', '{"location_broadcast": false}')
  on conflict (key) do nothing;

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('global', 'location', 'direct')),
  location_id uuid references public.locations (id),
  user_a uuid references public.profiles (id) on delete cascade,
  user_b uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((kind = 'location') = (location_id is not null)),
  check ((kind = 'direct') = (user_a is not null and user_b is not null)),
  check (user_a is null or user_a < user_b)
);
create unique index chat_one_global on public.chat_threads (kind) where kind = 'global';
create unique index chat_one_per_location on public.chat_threads (location_id) where kind = 'location';
create unique index chat_one_per_pair on public.chat_threads (user_a, user_b) where kind = 'direct';

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  reply_to uuid references public.chat_messages (id) on delete set null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at desc);
create index chat_messages_age_idx on public.chat_messages (created_at);

create table public.chat_thread_prefs (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  notify text not null default 'all' check (notify in ('all', 'mentions', 'none')),
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);

-- ───────────── access ─────────────
create or replace function public.can_access_thread(p_thread uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_threads t
      join public.profiles p on p.id = p_user and p.is_active
     where t.id = p_thread and (
       t.kind = 'global'
       or (t.kind = 'location'
           and exists (select 1 from public.locations l where l.id = t.location_id and l.is_active)
           and (p.role = 'admin' or exists (select 1 from public.employee_locations el where el.location_id = t.location_id and el.employee_id = p.id)))
       or (t.kind = 'direct' and p_user in (t.user_a, t.user_b))));
$$;

create or replace function public.thread_member_ids(p_thread uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
   where p.is_active and public.can_access_thread(p_thread, p.id);
$$;
revoke all on function public.thread_member_ids(uuid) from public, anon, authenticated;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_thread_prefs enable row level security;
create policy chat_threads_select on public.chat_threads for select to authenticated using (public.can_access_thread(id));
create policy chat_messages_select on public.chat_messages for select to authenticated using (public.can_access_thread(thread_id));
create policy chat_prefs_select on public.chat_thread_prefs for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.chat_threads, public.chat_messages, public.chat_thread_prefs from authenticated, anon;
alter publication supabase_realtime add table public.chat_messages;

-- ───────────── threads ─────────────
create or replace function public.ensure_chat_threads() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chat_threads (kind) select 'global' where not exists (select 1 from public.chat_threads where kind = 'global');
  insert into public.chat_threads (kind, location_id)
    select 'location', l.id from public.locations l
     where not exists (select 1 from public.chat_threads t where t.kind = 'location' and t.location_id = l.id);
end $$;
revoke all on function public.ensure_chat_threads() from public, anon, authenticated;

create or replace function public.open_direct_thread(p_other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v_a uuid; v_b uuid; v_id uuid;
begin
  if not public.is_active_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_other is null or p_other = v_me or not exists (select 1 from public.profiles where id = p_other and is_active) then
    raise exception 'invalid_input';
  end if;
  v_a := least(v_me, p_other); v_b := greatest(v_me, p_other);
  select id into v_id from public.chat_threads where kind = 'direct' and user_a = v_a and user_b = v_b;
  if v_id is null then
    insert into public.chat_threads (kind, user_a, user_b) values ('direct', v_a, v_b)
      on conflict (user_a, user_b) where kind = 'direct' do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.chat_threads where kind = 'direct' and user_a = v_a and user_b = v_b; end if;
  end if;
  return v_id;
end $$;

-- Everything the inbox needs in one call: my threads, last message, unread count, notification mode.
create or replace function public.chat_overview()
returns table (thread_id uuid, kind text, location_id uuid, title text, last_body text, last_sender text, last_at timestamptz, unread integer, notify text)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if not public.is_active_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.ensure_chat_threads();
  return query
    select t.id, t.kind, t.location_id,
           case t.kind when 'location' then l.name
                       when 'direct' then trim(o.first_name || ' ' || o.last_name) end,
           m.body, trim(s.first_name || ' ' || s.last_name), m.created_at,
           (select count(*)::integer from public.chat_messages x
             where x.thread_id = t.id and x.sender_id <> v_me and x.created_at > coalesce(pr.last_read_at, '-infinity'::timestamptz)),
           coalesce(pr.notify, 'all')
      from public.chat_threads t
      left join public.locations l on l.id = t.location_id
      left join public.profiles o on o.id = case when t.user_a = v_me then t.user_b else t.user_a end and t.kind = 'direct'
      left join public.chat_thread_prefs pr on pr.thread_id = t.id and pr.user_id = v_me
      left join lateral (select * from public.chat_messages z where z.thread_id = t.id order by z.created_at desc limit 1) m on true
      left join public.profiles s on s.id = m.sender_id
     where public.can_access_thread(t.id)
     order by (t.kind = 'global') desc, m.created_at desc nulls last, l.name nulls last;
end $$;

create or replace function public.chat_people() returns table (id uuid, name text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, trim(p.first_name || ' ' || p.last_name), p.role::text from public.profiles p
   where p.is_active and p.id <> auth.uid() and public.is_active_user() order by p.first_name, p.last_name;
$$;

create or replace function public.chat_members(p_thread uuid) returns table (id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_thread(p_thread) then return; end if;
  return query select p.id, trim(p.first_name || ' ' || p.last_name) from public.profiles p
    where p.id = any (public.thread_member_ids(p_thread)) order by p.first_name, p.last_name;
end $$;

-- ───────────── messages ─────────────
create or replace function public.send_chat_message(p_thread uuid, p_body text, p_reply_to uuid, p_mentions uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_t public.chat_threads; v_role public.user_role; v_id uuid; v_broadcast boolean;
  v_members uuid[]; v_mentions uuid[]; v_name text; v_preview text;
begin
  if not public.can_access_thread(p_thread) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'invalid_input'; end if;
  select * into v_t from public.chat_threads where id = p_thread;
  select role into v_role from public.profiles where id = v_me;

  select coalesce((value ->> 'location_broadcast')::boolean, false) into v_broadcast from public.app_settings where key = 'chat_options';
  if v_t.kind = 'location' and coalesce(v_broadcast, false) and v_role = 'employee' and p_reply_to is null then
    raise exception 'broadcast_only';
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages where id = p_reply_to and thread_id = p_thread) then
    raise exception 'invalid_input';
  end if;

  v_members := public.thread_member_ids(p_thread);
  select coalesce(array_agg(distinct m), '{}') into v_mentions from unnest(coalesce(p_mentions, '{}')) m where m = any (v_members) and m <> v_me;

  insert into public.chat_messages (thread_id, sender_id, body, reply_to, mentions)
  values (p_thread, v_me, trim(p_body), p_reply_to, v_mentions) returning id into v_id;

  -- the sender has read everything up to now
  insert into public.chat_thread_prefs (thread_id, user_id, last_read_at) values (p_thread, v_me, now())
    on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  v_name := public.person_name(v_me);
  v_preview := left(trim(p_body), 90);
  -- mentions notify everyone not muted; plain messages notify "all" people once per thread until they read it
  insert into public.notifications (user_id, type, params, link)
  select u, case when u = any (v_mentions) then 'chat_mention' else 'chat_message' end,
         jsonb_build_object('thread_id', p_thread, 'employee_name', v_name, 'preview', v_preview, 'kind', v_t.kind),
         '/chat?thread=' || p_thread
    from unnest(v_members) u
    left join public.chat_thread_prefs pr on pr.thread_id = p_thread and pr.user_id = u
   where u <> v_me
     and coalesce(pr.notify, 'all') <> 'none'
     and (u = any (v_mentions)
          or (coalesce(pr.notify, 'all') = 'all'
              and not exists (select 1 from public.notifications n
                               where n.user_id = u and n.type = 'chat_message' and n.read_at is null and n.params ->> 'thread_id' = p_thread::text)));
  return v_id;
end $$;

create or replace function public.mark_chat_read(p_thread uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_access_thread(p_thread) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.chat_thread_prefs (thread_id, user_id, last_read_at) values (p_thread, auth.uid(), now())
    on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and type in ('chat_message', 'chat_mention') and params ->> 'thread_id' = p_thread::text;
end $$;

create or replace function public.set_chat_notify(p_thread uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_mode not in ('all', 'mentions', 'none') then raise exception 'invalid_input'; end if;
  if not public.can_access_thread(p_thread) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.chat_thread_prefs (thread_id, user_id, notify) values (p_thread, auth.uid(), p_mode)
    on conflict (thread_id, user_id) do update set notify = excluded.notify;
end $$;

create or replace function public.delete_chat_message(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chat_messages where id = p_id and (sender_id = auth.uid() or public.is_admin());
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.save_chat_options(p_location_broadcast boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_location_broadcast is null then raise exception 'invalid_input'; end if;
  insert into public.app_settings (key, value) values ('chat_options', jsonb_build_object('location_broadcast', p_location_broadcast))
    on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'settings.chat_options_changed', 'app_settings', 'chat_options', jsonb_build_object('location_broadcast', p_location_broadcast));
end $$;

-- ───────────── 90-day purge ─────────────
-- Chat messages and notification logs only. Published schedules, shifts and the audit log are never touched.
create or replace function public.run_chat_purge(p_days integer default 90) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cut timestamptz := now() - make_interval(days => greatest(p_days, 1)); v_msgs integer; v_notes integer; v_res jsonb;
begin
  delete from public.chat_messages where created_at < v_cut;
  get diagnostics v_msgs = row_count;
  delete from public.notifications where created_at < v_cut; -- their delivery logs go with them
  get diagnostics v_notes = row_count;
  v_res := jsonb_build_object('last_run', now(), 'messages', v_msgs, 'notifications', v_notes, 'days', p_days);
  insert into public.app_settings (key, value) values ('chat_purge', v_res)
    on conflict (key) do update set value = excluded.value;
  return v_res;
end $$;
revoke all on function public.run_chat_purge(integer) from public, anon, authenticated;

-- The admin's "Clean now" button.
create or replace function public.purge_chat_now() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_res := public.run_chat_purge(90);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), 'chat.purged', 'chat_messages', 'manual', v_res);
  return v_res;
end $$;

-- ───────────── grants ─────────────
revoke all on function public.open_direct_thread(uuid) from public, anon;
revoke all on function public.chat_overview() from public, anon;
revoke all on function public.chat_people() from public, anon;
revoke all on function public.chat_members(uuid) from public, anon;
revoke all on function public.send_chat_message(uuid, text, uuid, uuid[]) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.set_chat_notify(uuid, text) from public, anon;
revoke all on function public.delete_chat_message(uuid) from public, anon;
revoke all on function public.save_chat_options(boolean) from public, anon;
revoke all on function public.purge_chat_now() from public, anon;
grant execute on function public.open_direct_thread(uuid) to authenticated;
grant execute on function public.chat_overview() to authenticated;
grant execute on function public.chat_people() to authenticated;
grant execute on function public.chat_members(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid, uuid[]) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.set_chat_notify(uuid, text) to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;
grant execute on function public.save_chat_options(boolean) to authenticated;
grant execute on function public.purge_chat_now() to authenticated;
