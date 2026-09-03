-- Push notification support for two cases: raffle win alerts and
-- double-points window start alerts. Push is additive on top of the
-- existing in-app channels (RaffleWinListener's modal, HomeScreen's
-- banner) — those stay the reliable source of truth since push delivery
-- isn't guaranteed, especially over conference-venue wifi/cell.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Self-serve only. A token is written and read by its own owner; nobody
-- else (not even an admin) gets a select policy here — the only party
-- that ever needs to read across users is the edge functions below,
-- which use the service_role key and bypass RLS entirely.
drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own"
  on public.push_tokens for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "push_tokens_insert_own" on public.push_tokens;
create policy "push_tokens_insert_own"
  on public.push_tokens for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_update_own" on public.push_tokens;
create policy "push_tokens_update_own"
  on public.push_tokens for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_delete_own" on public.push_tokens;
create policy "push_tokens_delete_own"
  on public.push_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.push_tokens to authenticated;

-- Idempotency guard so the double-points cron poll (every 5 min, see
-- below) doesn't re-push the same window repeatedly before it ends.
alter table public.double_points_windows
  add column if not exists start_notified_at timestamptz;

-- pg_net lets Postgres itself fire the HTTP call to the edge function,
-- so the raffle-win push fires from the database the moment
-- draw_raffle_winner commits — not from the admin's client, which could
-- disconnect right after calling the RPC.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The edge functions are protected by Supabase's default JWT gateway
-- check (verify_jwt = true, see supabase/config.toml) — a valid signed
-- project JWT is required, and the service_role key qualifies. That key
-- must never be committed to git, so it isn't embedded here. Instead it's
-- read from Supabase Vault at call time; if it hasn't been configured yet
-- both the trigger and the cron job below no-op instead of erroring, so
-- drawing a raffle winner / scheduling a double-points window still work
-- with push simply not firing until the one-time setup step is done:
--   select vault.create_secret('<service_role key from Project Settings > API>', 'service_role_key');
-- run once, by hand, in the SQL editor — never through a migration file.
create or replace function public.notify_raffle_winner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if new.winner_id is not null and new.winner_id is distinct from old.winner_id then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;

    if v_secret is not null then
      perform net.http_post(
        url := 'https://oggrlanwgmmdnvjltqel.functions.supabase.co/notify-raffle-win',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object('prize_id', new.id)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists raffle_winner_notify on public.raffle_prizes;
create trigger raffle_winner_notify
  after update on public.raffle_prizes
  for each row execute function public.notify_raffle_winner();

-- Polls every 5 minutes for windows that started recently and haven't
-- been announced yet. Named schedule so re-running this migration
-- reschedules rather than duplicating the job.
select cron.schedule(
  'notify-double-points-start',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://oggrlanwgmmdnvjltqel.functions.supabase.co/notify-double-points',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    )
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'service_role_key');
  $$
);
