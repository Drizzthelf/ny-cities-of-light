-- Lets admins schedule time windows (e.g. a "happy hour") during which
-- scanning another person's QR code awards double the usual 10 points.
-- Event check-ins are untouched — this is scoped to person-to-person
-- connections only, per user request ("scanning other peoples QR codes").
create table if not exists public.double_points_windows (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists double_points_windows_time_idx
  on public.double_points_windows (start_time, end_time);

alter table public.double_points_windows enable row level security;

-- Readable by everyone (authenticated) — the app needs this to show a
-- "double points active" banner to attendees, not just to admins.
drop policy if exists "double_points_windows_select_all" on public.double_points_windows;
create policy "double_points_windows_select_all"
  on public.double_points_windows for select
  to authenticated
  using (true);

drop policy if exists "double_points_windows_insert_admin" on public.double_points_windows;
create policy "double_points_windows_insert_admin"
  on public.double_points_windows for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "double_points_windows_update_admin" on public.double_points_windows;
create policy "double_points_windows_update_admin"
  on public.double_points_windows for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "double_points_windows_delete_admin" on public.double_points_windows;
create policy "double_points_windows_delete_admin"
  on public.double_points_windows for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

grant select, insert, update, delete on public.double_points_windows to authenticated;
