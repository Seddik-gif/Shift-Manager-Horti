-- The API (PostgREST) can only embed availability_time_windows inside availability_submissions when there is a
-- DIRECT foreign key between them. Until now the only link ran through availability_days, so queries such as
--   availability_submissions?select=*,availability_time_windows(*)
--   availability_time_windows?select=*,availability_submissions!inner(*)
-- failed and the admin overview, the employee's saved form and the availability checks came back empty.
alter table public.availability_time_windows
  add constraint availability_windows_submission_fk
  foreign key (submission_id) references public.availability_submissions (id) on delete cascade;

notify pgrst, 'reload schema';
