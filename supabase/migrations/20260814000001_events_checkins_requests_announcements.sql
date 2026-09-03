-- Designs the four tables the app code already references but that were
-- confirmed (2026-07-21, via `supabase db pull`) not to exist yet:
-- events, event_checkins, service_requests, announcements.
-- See docs/production-launch-plan.md §0, §1, §2, §8 (suggested sequencing
-- #1 — this is the top-priority schema/RLS gap before the rest of the
-- security review in §3 can be verified).

-- ============================================================================
-- events  (conference schedule; admins manage, everyone reads)
-- ============================================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  location_name text not null,
  address text not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists events_start_time_idx on public.events(start_time);

alter table public.events enable row level security;

drop policy if exists "events_select_all" on public.events;
create policy "events_select_all"
  on public.events for select
  to authenticated
  using (true);

drop policy if exists "events_insert_admin" on public.events;
create policy "events_insert_admin"
  on public.events for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "events_update_admin" on public.events;
create policy "events_update_admin"
  on public.events for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "events_delete_admin" on public.events;
create policy "events_delete_admin"
  on public.events for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================================
-- event_checkins  (who checked in to which event, via the event's QR code)
-- ============================================================================
create table if not exists public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create index if not exists event_checkins_user_idx on public.event_checkins(user_id);
create index if not exists event_checkins_event_idx on public.event_checkins(event_id);

alter table public.event_checkins enable row level security;

-- Broad read, same rationale as scans_select_all: the leaderboard needs
-- aggregate event counts across all users.
drop policy if exists "event_checkins_select_all" on public.event_checkins;
create policy "event_checkins_select_all"
  on public.event_checkins for select
  to authenticated
  using (true);

drop policy if exists "event_checkins_insert_self" on public.event_checkins;
create policy "event_checkins_insert_self"
  on public.event_checkins for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "event_checkins_delete_admin" on public.event_checkins;
create policy "event_checkins_delete_admin"
  on public.event_checkins for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================================
-- service_requests  ("ask the organizers" messages — NOT broadly readable,
-- per docs/production-launch-plan.md §2: only the submitting user and
-- admins may select a given row.)
-- ============================================================================
create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  admin_reply text,
  replied_at timestamptz,
  replied_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists service_requests_user_idx on public.service_requests(user_id);

alter table public.service_requests enable row level security;

drop policy if exists "service_requests_select_self_or_admin" on public.service_requests;
create policy "service_requests_select_self_or_admin"
  on public.service_requests for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "service_requests_insert_self" on public.service_requests;
create policy "service_requests_insert_self"
  on public.service_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Admins reply by updating admin_reply/replied_at/replied_by (AdminScreen.tsx
-- MessagesSection); users never update their own request after submitting.
drop policy if exists "service_requests_update_admin" on public.service_requests;
create policy "service_requests_update_admin"
  on public.service_requests for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================================
-- announcements  (admin feed post; everyone reads)
-- ============================================================================
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_created_at_idx on public.announcements(created_at desc);

alter table public.announcements enable row level security;

drop policy if exists "announcements_select_all" on public.announcements;
create policy "announcements_select_all"
  on public.announcements for select
  to authenticated
  using (true);

drop policy if exists "announcements_insert_admin" on public.announcements;
create policy "announcements_insert_admin"
  on public.announcements for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "announcements_delete_admin" on public.announcements;
create policy "announcements_delete_admin"
  on public.announcements for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================================
-- leaderboard view — rebuilt for first_name/instagram (see the companion
-- profile rename migration) plus event_count/points, which LeaderboardRow
-- (src/types/database.ts) already expects.
--
-- Uses two pre-aggregated subqueries rather than a single 3-way join: joining
-- scans and event_checkins directly off profiles would fan out (each scan
-- row paired with each check-in row), inflating both counts.
-- ============================================================================
-- Plain `create or replace view` can't rename an existing output column
-- (the live view still exposes the pre-rename "full_name" label even though
-- the underlying column is now first_name) — drop and recreate instead.
drop view if exists public.leaderboard;
create view public.leaderboard as
select
  p.id,
  p.first_name,
  p.photo_url,
  p.instagram,
  coalesce(s.scan_count, 0) as scan_count,
  coalesce(c.event_count, 0) as event_count,
  coalesce(s.scan_count, 0) * 10 + coalesce(c.event_count, 0) * 30 as points
from public.profiles p
left join (
  select scanner_id, count(*) as scan_count
  from public.scans
  group by scanner_id
) s on s.scanner_id = p.id
left join (
  select user_id, count(*) as event_count
  from public.event_checkins
  group by user_id
) c on c.user_id = p.id
order by points desc, p.first_name asc;

-- ============================================================================
-- realtime — scans was already live-subscribed from HomeScreen.tsx but
-- (per `grep`) never actually added to the publication; events/event_checkins/
-- announcements need it for ScheduleScreen/NavigateScreen/HomeScreen/
-- AnnouncementsScreen's postgres_changes subscriptions to fire. Guarded so
-- re-running `db push` doesn't error on tables already in the publication.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['scans', 'events', 'event_checkins', 'announcements'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
