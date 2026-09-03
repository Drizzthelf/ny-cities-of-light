-- Follow-up to 20260902000000: the winner announcement was naming the
-- winner in a broadcast every attendee sees, which outs them publicly
-- before they've necessarily even seen their own private "you won" notice.
-- Keep the broadcast anonymous — just "a winner was drawn" — and let people
-- check the Completed Raffles page (which already shows "Winner: <name>"
-- per prize) if they want to know who.
create or replace function public.draw_raffle_winner(p_prize_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  picked uuid;
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

  insert into public.announcements (admin_id, title, body)
  values (
    null,
    '🎉 Raffle drawn: ' || prize_title,
    'A winner has been drawn for "' || prize_title || '"! Check the Completed Raffles page to see who won.'
  );

  return picked;
end;
$$;

revoke all on function public.draw_raffle_winner(uuid) from public;
grant execute on function public.draw_raffle_winner(uuid) to authenticated;
