-- redraw_raffle_winner — admin only, for a winner who never comes forward
-- to claim their prize. Forfeits the departing winner's ticket entry for
-- this prize (not just excluding it from this one pick) so a later
-- redraw of the same prize can't land back on them either, and so their
-- tickets free up for them to assign to a different prize instead — same
-- "delete = refund" behavior confirm_delete's prize-deletion path already
-- relies on.
create or replace function public.redraw_raffle_winner(p_prize_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_winner uuid;
  picked uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Not authorized';
  end if;

  select winner_id into previous_winner
  from public.raffle_prizes
  where id = p_prize_id;

  if not found then
    raise exception 'Prize not found';
  end if;
  if previous_winner is null then
    raise exception 'This prize has not been drawn yet';
  end if;

  delete from public.raffle_entries
  where prize_id = p_prize_id and user_id = previous_winner;

  select user_id into picked
  from public.raffle_entries
  where prize_id = p_prize_id
  order by -ln(random()) / tickets asc
  limit 1;

  if picked is null then
    raise exception 'No other entrants have tickets assigned to this prize';
  end if;

  -- raffle_winner_notify (20260831000000) fires on any winner_id change,
  -- redraw included, so the new winner gets the same private push + in-app
  -- "you won" notice the original draw would have given them.
  update public.raffle_prizes
  set winner_id = picked, drawn_at = now(), winner_seen = false
  where id = p_prize_id;

  return picked;
end;
$$;

revoke all on function public.redraw_raffle_winner(uuid) from public;
grant execute on function public.redraw_raffle_winner(uuid) to authenticated;
