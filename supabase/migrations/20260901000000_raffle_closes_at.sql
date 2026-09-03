-- Lets an admin set a per-prize deadline. Nullable — a prize with no
-- closes_at stays open (as every prize does today) until an admin draws
-- it; setting one adds a hard cutoff enforced here, not just hidden in
-- the UI.
alter table public.raffle_prizes add column if not exists closes_at timestamptz;

-- assign_raffle_tickets is the only path that ever writes raffle_entries
-- (no broad insert/update/delete policy exists on that table — see
-- 20260826000000_raffle.sql), so this one check is the actual guarantee,
-- not just a client-side restriction the app could bypass.
create or replace function public.assign_raffle_tickets(p_prize_id uuid, p_tickets integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  my_points integer;
  my_total_tickets integer;
  assigned_elsewhere integer;
  prize_drawn timestamptz;
  prize_closes timestamptz;
begin
  if p_tickets < 0 then
    raise exception 'Ticket count cannot be negative';
  end if;

  select drawn_at, closes_at into prize_drawn, prize_closes from public.raffle_prizes where id = p_prize_id;
  if not found then
    raise exception 'Prize not found';
  end if;
  if prize_drawn is not null then
    raise exception 'This prize has already been drawn — entries are closed';
  end if;
  if prize_closes is not null and prize_closes <= now() then
    raise exception 'Entries for this prize closed at %', prize_closes;
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
$function$;
