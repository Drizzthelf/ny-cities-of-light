-- Companion to points_to_tickets, going the other direction: cumulative
-- points needed to REACH N tickets. Lets the client show "X points until
-- your next ticket" as points_for_ticket(my_tickets + 1) - my_points,
-- without duplicating the curve formula in TS. Same constants as
-- points_to_tickets (20260826000000) — keep them in sync if tuned.
create or replace function public.points_for_ticket(n integer)
returns integer
language sql
immutable
as $$
  select case
    when n <= 0 then 0
    when n <= 10 then n * 10
    else 100 + (n - 10) * (n + 1)
  end;
$$;

grant execute on function public.points_for_ticket(integer) to authenticated;
