-- Report button + admin moderation queue, per
-- docs/production-launch-plan.md §3.6: "Add a report button on every
-- profile view... needs a reports table (reporter, reported user, reason,
-- timestamp) with admin-only read, plus an admin queue to act on it."
--
-- Deliberately admin-only read (unlike service_requests, which is also
-- readable by its own submitter) — a reporter doesn't need to see other
-- reports, and the plan is explicit that this queue itself is admin-only.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  check (reporter_id <> reported_id)
);

create index if not exists reports_reported_idx on public.reports(reported_id);
create index if not exists reports_unresolved_idx on public.reports(created_at) where resolved_at is null;

alter table public.reports enable row level security;

drop policy if exists "reports_select_admin" on public.reports;
create policy "reports_select_admin"
  on public.reports for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin"
  on public.reports for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

grant select, insert, update on public.reports to authenticated;
