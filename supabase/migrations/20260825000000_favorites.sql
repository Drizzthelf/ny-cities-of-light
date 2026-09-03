-- Lets a user privately star people in their own contact list. Privacy is
-- enforced at the RLS layer, not just hidden in the UI: there is no select
-- policy granting anyone but the favoriter's own row access — not the
-- favorited person, not other users, not even a broad "read everything"
-- policy like scans has. Whether you've been favorited by someone is simply
-- not queryable by anyone but them.
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id),
  check (user_id <> contact_id)
);

create index if not exists favorites_user_idx on public.favorites(user_id);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_self" on public.favorites;
create policy "favorites_select_self"
  on public.favorites for select
  to authenticated
  using (auth.uid() = user_id);

-- Can only favorite someone who's an actual contact (a mutual scan already
-- happened) — not an arbitrary profile id, which a direct API call could
-- otherwise try regardless of what the app UI offers.
drop policy if exists "favorites_insert_self_contacts_only" on public.favorites;
create policy "favorites_insert_self_contacts_only"
  on public.favorites for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.scans s
      where s.scanner_id = auth.uid() and s.scanned_id = contact_id
    )
  );

drop policy if exists "favorites_delete_self" on public.favorites;
create policy "favorites_delete_self"
  on public.favorites for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.favorites to authenticated;
