-- QR Meetup schema
-- Run this in the Supabase SQL editor after creating a new project.

-- ============================================================================
-- profiles
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  background text,
  hometown text,
  photo_url text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone signed in can read all profiles (needed so the scanner can display the
-- scanned person's info). Field-level hiding is not needed for this event app.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  to authenticated
  using (true);

-- Users insert their own row during first-time setup.
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Users update only their own row; admins update any row.
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Only admins can delete profiles.
drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================================
-- scans  (who scanned whom)
-- ============================================================================
create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  scanner_id uuid not null references public.profiles(id) on delete cascade,
  scanned_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (scanner_id, scanned_id),
  check (scanner_id <> scanned_id)
);

create index if not exists scans_scanner_idx on public.scans(scanner_id);
create index if not exists scans_scanned_idx on public.scans(scanned_id);

alter table public.scans enable row level security;

-- All authenticated users can read scans (leaderboard needs aggregate counts).
drop policy if exists "scans_select_all" on public.scans;
create policy "scans_select_all"
  on public.scans for select
  to authenticated
  using (true);

-- Users insert scans where they are the scanner.
drop policy if exists "scans_insert_self" on public.scans;
create policy "scans_insert_self"
  on public.scans for insert
  to authenticated
  with check (auth.uid() = scanner_id);

-- Only admins can delete scans (used for reset).
drop policy if exists "scans_delete_admin" on public.scans;
create policy "scans_delete_admin"
  on public.scans for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================================
-- leaderboard view
-- ============================================================================
create or replace view public.leaderboard as
select
  p.id,
  p.full_name,
  p.photo_url,
  coalesce(count(s.id), 0) as scan_count
from public.profiles p
left join public.scans s on s.scanner_id = p.id
group by p.id, p.full_name, p.photo_url
order by scan_count desc, p.full_name asc;

-- ============================================================================
-- admin reset RPC (wipes all scans; keeps profiles)
-- ============================================================================
create or replace function public.admin_reset_scans()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  delete from public.scans;
end;
$$;

revoke all on function public.admin_reset_scans() from public;
grant execute on function public.admin_reset_scans() to authenticated;

-- ============================================================================
-- storage bucket for profile photos
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

-- Anyone authenticated can upload to their own folder; bucket is public-read.
drop policy if exists "photos_insert_self" on storage.objects;
create policy "photos_insert_self"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photos_update_self" on storage.objects;
create policy "photos_update_self"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photos_select_public" on storage.objects;
create policy "photos_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'profile-photos');
