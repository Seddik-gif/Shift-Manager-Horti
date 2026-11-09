-- Phase 6: manual WhatsApp sharing. The app NEVER sends WhatsApp messages. It prepares the text,
-- records that an admin copied it / opened WhatsApp Web, and records the admin's own statement
-- that they sent it. "confirmed_sent_at" is a manual confirmation, not proof of delivery.

create table public.whatsapp_shares (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.weekly_schedules (id),
  version integer not null,
  locale text not null check (locale in ('it', 'en')),
  message text not null,
  prepared_by uuid not null references public.profiles (id),
  prepared_at timestamptz not null default now(),
  copied_at timestamptz,
  copied_by uuid references public.profiles (id),
  opened_at timestamptz,
  confirmed_sent_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  foreign key (schedule_id, version) references public.schedule_versions (schedule_id, version)
);
create index whatsapp_shares_schedule_idx on public.whatsapp_shares (schedule_id, version, prepared_at desc);

alter table public.whatsapp_shares enable row level security;
create policy whatsapp_admin_select on public.whatsapp_shares for select to authenticated using (public.is_admin());
-- writes only through the functions below
revoke insert, update, delete on public.whatsapp_shares from authenticated, anon;

create or replace function public.prepare_whatsapp_share(p_week_start date, p_locale text, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_s public.weekly_schedules; v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_locale not in ('it', 'en') or coalesce(trim(p_message), '') = '' then raise exception 'invalid_input'; end if;
  select * into v_s from public.weekly_schedules where week_start = p_week_start and status = 'published';
  if not found then raise exception 'not_published'; end if;
  insert into public.whatsapp_shares (schedule_id, version, locale, message, prepared_by)
  values (v_s.id, v_s.current_version, p_locale, p_message, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.mark_whatsapp_step(p_id uuid, p_step text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.whatsapp_shares;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_row from public.whatsapp_shares where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  if p_step = 'copied' then
    update public.whatsapp_shares set copied_at = now(), copied_by = auth.uid() where id = p_id;
  elsif p_step = 'opened' then
    update public.whatsapp_shares set opened_at = now() where id = p_id;
  elsif p_step = 'confirmed' then
    if v_row.confirmed_sent_at is not null then raise exception 'already_confirmed'; end if;
    update public.whatsapp_shares set confirmed_sent_at = now(), confirmed_by = auth.uid() where id = p_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
    values (auth.uid(), 'whatsapp.share_confirmed', 'weekly_schedule', v_row.schedule_id::text,
            jsonb_build_object('version', v_row.version, 'locale', v_row.locale, 'share_id', p_id, 'manual', true));
  else
    raise exception 'invalid_input';
  end if;
end $$;

revoke all on function public.prepare_whatsapp_share(date, text, text) from public, anon;
revoke all on function public.mark_whatsapp_step(uuid, text) from public, anon;
grant execute on function public.prepare_whatsapp_share(date, text, text) to authenticated;
grant execute on function public.mark_whatsapp_step(uuid, text) to authenticated;
