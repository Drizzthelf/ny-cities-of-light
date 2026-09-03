-- The leaderboard view never got a table-level grant for authenticated —
-- RLS/policies on the underlying tables don't substitute for the view
-- itself needing its own SELECT grant (same class of bug as the
-- raffle_prizes and record_mutual_scan grant fixes earlier). Confirmed via
-- direct impersonation: `select points from leaderboard where id = ...`
-- as postgres works, the identical query as `authenticated` returns
-- "permission denied for view leaderboard". HomeScreen, LeaderboardScreen,
-- and RaffleScreen all read this view.
grant select on public.leaderboard to authenticated;
