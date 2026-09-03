-- Posts a public Updates announcement naming the winner and prize whenever
-- an admin draws a raffle winner, alongside the existing private "you won"
-- notice (RaffleWinListener) — the private popup only reaches the winner if
-- they have the app open right then, so this gives everyone else (and the
-- winner later) a durable, visible record of who won what. admin_id is left
-- null on purpose (not auth.uid(), the drawing admin) — this is a
-- system-generated post, not authored by whichever specific admin happened
-- to tap "Draw winner", and the client renders a null admin_id as "— Admin"
-- (see AnnouncementsScreen.tsx).
create or replace function public.draw_raffle_winner(p_prize_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  picked uuid;
  picked_name text;
  prize_title text;
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
  where id = p_prize_id
  returning title into prize_title;

  select first_name into picked_name from public.profiles where id = picked;

  insert into public.announcements (admin_id, title, body)
  values (
    null,
    '🎉 Raffle winner: ' || prize_title,
    coalesce(picked_name, 'A lucky attendee') || ' just won "' || prize_title || '"! Congratulations!'
  );

  return picked;
end;
$$;

revoke all on function public.draw_raffle_winner(uuid) from public;
grant execute on function public.draw_raffle_winner(uuid) to authenticated;
