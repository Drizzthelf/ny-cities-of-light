-- Wording tweak to the anonymous raffle-drawn announcement from
-- 20260902000001: "who won" read as if the announcement would reveal a
-- name if you checked, when the Completed Raffles page is just as
-- anonymous (see CompletedRaffleScreen.tsx) -- it only ever tells you
-- whether *you* won, never who did.
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
    'A winner has been drawn for "' || prize_title || '"! Check the Completed Raffles page to see if you won.'
  );

  return picked;
end;
$$;

revoke all on function public.draw_raffle_winner(uuid) from public;
grant execute on function public.draw_raffle_winner(uuid) to authenticated;
