-- Raffle system: points convert to raffle tickets on a curve that starts
-- easy and gradually steepens, users assign tickets to specific prizes,
-- admins manage prizes and draw winners, winners get a private in-app
-- notification (not a general messaging feature — that was intentionally
-- removed; this is a single-purpose "you won" notice scoped to one row).

-- ============================================================================
-- points -> tickets curve
-- ============================================================================
-- Tickets 1-10 cost a flat 10 points each (matches the base per-scan point
-- value, so "10 points = 1 ticket" is an easy mental model early on).
-- Ticket k beyond 10 costs 10 + (k-10)*2 points, i.e. the marginal cost
-- ramps up by 2 points per ticket — "ever so slightly harder", not
-- punishing. Closed-form: for k>10, cost(k) = 10 + (k-10)*2, and the sum
-- of an arithmetic series gives the cumulative points needed for N
-- tickets as 100 + (N-10)*(N+1). Inverting that (solving the quadratic
-- for N given total points P) is what the sqrt expression below does.
-- These constants are the whole tuning surface for the curve — change
-- them here if the pacing needs adjusting later.
create or replace function public.points_to_tickets(p_points integer)
returns integer
language plpgsql
immutable
as $$
declare
  x numeric;
begin
  if p_points is null or p_points <= 0 then
    return 0;
  end if;
  if p_points < 100 then
    return p_points / 10; -- integer division = floor
  end if;
  x := floor((-11 + sqrt(121 + 4 * (p_points - 100))) / 2);
  return 10 + x::integer;
end;
$$;

-- ============================================================================
-- raffle_prizes  (admin manages, everyone reads — transparency about who
-- won matters for a raffle to feel fair)
-- ============================================================================
create table if not exists public.raffle_prizes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  created_at timestamptz not null default now(),
  drawn_at timestamptz,
  winner_id uuid references public.profiles(id) on delete set null,
  -- Flips to true once the winner has seen the private "you won" notice —
  -- see RaffleWinListener.tsx / ack_raffle_win below. Reset to false by
  -- draw_raffle_winner each time a new winner is picked.
  winner_seen boolean not null default false
);

alter table public.raffle_prizes enable row level security;

drop policy if exists "raffle_prizes_select_all" on public.raffle_prizes;
create policy "raffle_prizes_select_all"
  on public.raffle_prizes for select
  to authenticated
  using (true);

drop policy if exists "raffle_prizes_insert_admin" on public.raffle_prizes;
create policy "raffle_prizes_insert_admin"
  on public.raffle_prizes for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "raffle_prizes_update_admin" on public.raffle_prizes;
create policy "raffle_prizes_update_admin"
  on public.raffle_prizes for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "raffle_prizes_delete_admin" on public.raffle_prizes;
create policy "raffle_prizes_delete_admin"
  on public.raffle_prizes for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Winner drawing and the win-ack both go through security-definer RPCs
-- below rather than broader RLS update policies — an RLS policy scoped
-- only by row (e.g. "auth.uid() = winner_id") can't restrict which
-- *columns* change, so a winner could otherwise rewrite the prize's
-- title or even re-point winner_id at themselves for a different prize.

-- ============================================================================
-- raffle_entries  (how many tickets a user has committed to a given prize)
-- ============================================================================
create table if not exists public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  prize_id uuid not null references public.raffle_prizes(id) on delete cascade,
  tickets integer not null check (tickets > 0),
  created_at timestamptz not null default now(),
  unique (user_id, prize_id)
);

create index if not exists raffle_entries_prize_idx on public.raffle_entries(prize_id);

alter table public.raffle_entries enable row level security;

-- Only your own allocations — not visible to other attendees, not even in
-- aggregate per-user (raffle_prize_stats below exposes prize-level totals
-- only, no per-user breakdown).
drop policy if exists "raffle_entries_select_self" on public.raffle_entries;
create policy "raffle_entries_select_self"
  on public.raffle_entries for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policies — assign_raffle_tickets is the only
-- path, so the "can't exceed your earned ticket total" check can never be
-- bypassed by a direct client call.

grant select on public.raffle_entries to authenticated;

-- Prize-level totals only (no per-user data) so the app can show "142
-- tickets in this prize's pool" without revealing who assigned what.
create or replace view public.raffle_prize_stats as
select
  prize_id,
  coalesce(sum(tickets), 0) as total_tickets,
  count(distinct user_id) as entrant_count
from public.raffle_entries
group by prize_id;

grant select on public.raffle_prize_stats to authenticated;

-- ============================================================================
-- assign_raffle_tickets — sets (not adds to) the caller's ticket
-- allocation for one prize, validated against their total earned tickets
-- minus what they've already committed elsewhere.
-- ============================================================================
create or replace function public.assign_raffle_tickets(p_prize_id uuid, p_tickets integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_points integer;
  my_total_tickets integer;
  assigned_elsewhere integer;
  prize_drawn timestamptz;
begin
  if p_tickets < 0 then
    raise exception 'Ticket count cannot be negative';
  end if;

  select drawn_at into prize_drawn from public.raffle_prizes where id = p_prize_id;
  if not found then
    raise exception 'Prize not found';
  end if;
  if prize_drawn is not null then
    raise exception 'This prize has already been drawn — entries are closed';
  end if;

  select coalesce(points, 0) into my_points from public.leaderboard where id = auth.uid();
  my_total_tickets := public.points_to_tickets(coalesce(my_points, 0));

  select coalesce(sum(tickets), 0) into assigned_elsewhere
  from public.raffle_entries
  where user_id = auth.uid() and prize_id <> p_prize_id;

  if assigned_elsewhere + p_tickets > my_total_tickets then
    raise exception 'Not enough tickets — you have % available', greatest(my_total_tickets - assigned_elsewhere, 0);
  end if;

  if p_tickets = 0 then
    delete from public.raffle_entries where user_id = auth.uid() and prize_id = p_prize_id;
  else
    insert into public.raffle_entries (user_id, prize_id, tickets)
    values (auth.uid(), p_prize_id, p_tickets)
    on conflict (user_id, prize_id) do update set tickets = excluded.tickets;
  end if;
end;
$$;

revoke all on function public.assign_raffle_tickets(uuid, integer) from public;
grant execute on function public.assign_raffle_tickets(uuid, integer) to authenticated;

-- ============================================================================
-- draw_raffle_winner — admin only. Weighted random pick (more tickets =
-- higher chance) via the standard "smallest -ln(random())/weight wins"
-- trick, which samples correctly proportional to weight without having to
-- expand each ticket into its own row.
-- ============================================================================
create or replace function public.draw_raffle_winner(p_prize_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  picked uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from public.raffle_prizes where id = p_prize_id and drawn_at is not null) then
    raise exception 'This prize has already been drawn';
  end if;

  select user_id into picked
  from public.raffle_entries
  where prize_id = p_prize_id
  order by -ln(random()) / tickets asc
  limit 1;

  if picked is null then
    raise exception 'No tickets have been assigned to this prize yet';
  end if;

  update public.raffle_prizes
  set winner_id = picked, drawn_at = now(), winner_seen = false
  where id = p_prize_id;

  return picked;
end;
$$;

revoke all on function public.draw_raffle_winner(uuid) from public;
grant execute on function public.draw_raffle_winner(uuid) to authenticated;

-- ============================================================================
-- ack_raffle_win — the winner marks their own private win notice as seen.
-- Scoped to exactly this one column via the RPC body, not a general
-- update policy (see comment above raffle_entries).
-- ============================================================================
create or replace function public.ack_raffle_win(p_prize_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.raffle_prizes
  set winner_seen = true
  where id = p_prize_id and winner_id = auth.uid();
end;
$$;

revoke all on function public.ack_raffle_win(uuid) from public;
grant execute on function public.ack_raffle_win(uuid) to authenticated;

-- ============================================================================
-- storage bucket for prize photos — same admin-only-write pattern as
-- event-photos (20260823000005_event_images.sql)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('raffle-prizes', 'raffle-prizes', true)
on conflict (id) do nothing;

drop policy if exists "raffle_prizes_photos_select_public" on storage.objects;
create policy "raffle_prizes_photos_select_public"
  on storage.objects for select
  using (bucket_id = 'raffle-prizes');

drop policy if exists "raffle_prizes_photos_insert_admin" on storage.objects;
create policy "raffle_prizes_photos_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'raffle-prizes'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "raffle_prizes_photos_update_admin" on storage.objects;
create policy "raffle_prizes_photos_update_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'raffle-prizes'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "raffle_prizes_photos_delete_admin" on storage.objects;
create policy "raffle_prizes_photos_delete_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'raffle-prizes'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
