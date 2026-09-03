-- Replaces the old "10pts flat for 10 tickets, then +2pts/ticket" curve
-- with a tiered one: the first 5 tickets cost 28 points each, the next 5
-- cost 35 each, the next 5 cost 42 each, and so on — each block of 5
-- tickets costs 7 more points per ticket than the block before it.
-- Tier t (0-based) covers tickets 5t+1..5t+5 at a cost of (28 + 7*t) points
-- each. Cumulative points to complete full_tiers whole tiers plus a
-- `remainder` of tickets into the next tier:
--   140*full_tiers + 35*full_tiers*(full_tiers-1)/2 + remainder*(28+7*full_tiers)
-- (140 = 5*28 is one full tier's base cost, 35 = 5*7 is how much a whole
-- tier's cost grows per tier.) points_for_ticket below is exactly that,
-- with full_tiers = n/5 and remainder = n%5. points_to_tickets is the
-- inverse, computed tier-by-tier (a handful of iterations at most for any
-- realistic point total, simpler and less error-prone here than deriving a
-- closed-form inverse per tier).
create or replace function public.points_to_tickets(p_points integer)
returns integer
language plpgsql
immutable
as $$
declare
  remaining integer;
  tier integer := 0;
  tier_cost integer;
  tickets_in_tier integer;
  total_tickets integer := 0;
begin
  if p_points is null or p_points <= 0 then
    return 0;
  end if;
  remaining := p_points;
  loop
    tier_cost := 28 + 7 * tier;
    exit when remaining < tier_cost;
    tickets_in_tier := least(5, remaining / tier_cost);
    total_tickets := total_tickets + tickets_in_tier;
    remaining := remaining - tickets_in_tier * tier_cost;
    exit when tickets_in_tier < 5;
    tier := tier + 1;
  end loop;
  return total_tickets;
end;
$$;

-- Companion to points_to_tickets, going the other direction: cumulative
-- points needed to REACH N tickets. Same constants as points_to_tickets
-- above — keep them in sync if tuned.
create or replace function public.points_for_ticket(n integer)
returns integer
language sql
immutable
as $$
  select case
    when n <= 0 then 0
    else 140 * (n / 5) + 35 * (n / 5) * ((n / 5) - 1) / 2 + (n % 5) * (28 + 7 * (n / 5))
  end;
$$;
