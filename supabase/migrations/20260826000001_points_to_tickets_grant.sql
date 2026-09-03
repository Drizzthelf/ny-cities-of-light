-- Explicit grant rather than relying on default PUBLIC execute privilege —
-- the client needs to call this directly (not just have it used internally
-- by assign_raffle_tickets) to show "X points to your next ticket" live as
-- the user types/considers, without duplicating the curve formula in TS.
grant execute on function public.points_to_tickets(integer) to authenticated;
