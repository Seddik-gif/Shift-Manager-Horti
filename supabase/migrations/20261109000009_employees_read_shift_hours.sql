-- Employees need the allowed shift window (07:00–02:00) to draw the same calendar as admins.
create policy settings_shift_hours_read on public.app_settings for select to authenticated
  using (key = 'shift_hours' and public.is_active_user());
