-- Security hardening, found by auditing the schema on a real Supabase Postgres:
--  1. The chat access check could be asked about OTHER people (membership leak). It now only answers for the caller.
--  2. Tables created after the first migration kept Supabase's default grants (anon could TRUNCATE, etc.).
--  3. Helper and trigger functions were executable by anon / everyone.
--  4. btree_gist lived in `public`, exposing ~80 functions as RPC endpoints.
-- Row level security stays the main wall; this removes everything that does not need to be reachable at all.

-- ───────────── 4. extension out of the API schema ─────────────
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter extension btree_gist set schema extensions;

-- ───────────── 1. chat: the access check answers only for the caller ─────────────
drop policy chat_threads_select on public.chat_threads;
drop policy chat_messages_select on public.chat_messages;
alter function public.can_access_thread(uuid, uuid) rename to thread_can_access;

create or replace function public.can_access_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.thread_can_access(p_thread, auth.uid());
$$;

create or replace function public.thread_member_ids(p_thread uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
   where p.is_active and public.thread_can_access(p_thread, p.id);
$$;

create policy chat_threads_select on public.chat_threads for select to authenticated using (public.can_access_thread(id));
create policy chat_messages_select on public.chat_messages for select to authenticated using (public.can_access_thread(thread_id));

-- ───────────── 3. functions: nothing is callable unless it was meant to be ─────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    -- trigger functions are fired by the database, never called by a person
    if f.is_trigger then execute format('revoke execute on function %s from authenticated', f.sig); end if;
  end loop;
end $$;

revoke all on function public.thread_can_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.thread_member_ids(uuid) from public, anon, authenticated;
revoke all on function public.can_access_thread(uuid) from public, anon;
grant execute on function public.can_access_thread(uuid) to authenticated;

-- ───────────── 2. tables and views ─────────────
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- views are read-only for everybody
revoke insert, update, delete on public.team_shifts, public.team_directory, public.published_schedules from authenticated;

-- what is created from now on starts closed (our migrations grant explicitly)
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
