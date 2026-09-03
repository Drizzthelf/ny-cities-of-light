-- Replaces the fixed instagram column with a flexible list of social
-- handles per profile, each tagged with a platform, so a user can add
-- zero, one, or several (one per platform) instead of a single fixed slot.

-- leaderboard depends on the instagram column, so it must be dropped first
-- and is recreated (without that column) at the bottom of this file.
drop view if exists public.leaderboard;

alter table public.profiles
  drop column if exists instagram;

create table if not exists public.profile_socials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'twitter', 'tiktok')),
  handle text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, platform)
);

create index if not exists profile_socials_profile_idx on public.profile_socials(profile_id);

alter table public.profile_socials enable row level security;

-- Same broad-read rationale as profiles_select_all: scanner/leaderboard/
-- contacts need to display other people's handles.
drop policy if exists "profile_socials_select_all" on public.profile_socials;
create policy "profile_socials_select_all"
  on public.profile_socials for select
  to authenticated
  using (true);

drop policy if exists "profile_socials_insert_self_or_admin" on public.profile_socials;
create policy "profile_socials_insert_self_or_admin"
  on public.profile_socials for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "profile_socials_update_self_or_admin" on public.profile_socials;
create policy "profile_socials_update_self_or_admin"
  on public.profile_socials for update
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "profile_socials_delete_self_or_admin" on public.profile_socials;
create policy "profile_socials_delete_self_or_admin"
  on public.profile_socials for delete
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- New tables created via the CLI don't inherit default GRANTs — see
-- 20260817000000_grant_authenticated_table_access.sql.
grant select, insert, update, delete on public.profile_socials to authenticated;

-- Rebuild the leaderboard view without the dropped instagram column.
create view public.leaderboard as
select
  p.id,
  p.first_name,
  p.photo_url,
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
