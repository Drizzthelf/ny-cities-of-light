-- Replaces instant one-tap "add to contacts" with a mutual accept/decline
-- flow, per user decision: scanning someone no longer instantly credits
-- both people (20260820000000_mutual_scans.sql) — it now sends a live
-- request that the OTHER person must accept while both are actively in the
-- app at the same time. Two deliberate anti-abuse properties:
--   1. No push notifications — the target only sees the request if they
--      already have the app open right now. This is intentional: it
--      requires both people to genuinely be together in the moment, not
--      just async-approving something later.
--   2. Requests expire after 2 minutes if unanswered. Without this, someone
--      could print their own QR on a poster and have people "connect" with
--      it whenever the poster owner happens to open the app later — no
--      longer a real-time, in-person moment at all. A poster can never
--      hold a request open, since nobody is there to keep it alive.
-- Lock is per-pair, not global: A having a pending request to B doesn't
-- block C from also sending B a request at the same time — a popular
-- person getting scanned by several people in quick succession still works
-- normally.

create table if not exists public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> target_id)
);

-- Only one PENDING request per (requester, target) pair at a time — this is
-- the per-pair lock. A partial index (not a plain unique constraint) so a
-- new request can be created again later once the old one resolves
-- (accepted/declined/expired) — a decline or timeout doesn't permanently
-- block that pair from trying again.
create unique index if not exists connection_requests_pending_pair_idx
  on public.connection_requests (requester_id, target_id)
  where status = 'pending';

create index if not exists connection_requests_target_idx on public.connection_requests(target_id);
create index if not exists connection_requests_requester_idx on public.connection_requests(requester_id);

alter table public.connection_requests enable row level security;

-- Both participants need to read their own row's live status — the
-- requester to see "waiting..." flip to accepted/declined, the target to
-- receive the incoming-request popup via realtime.
drop policy if exists "connection_requests_select_participant" on public.connection_requests;
create policy "connection_requests_select_participant"
  on public.connection_requests for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = target_id);

-- No insert/update policies at all — every write goes through the two
-- security-definer functions below, so the 2-minute expiry and "only the
-- target may accept/decline" rules can't be bypassed by a direct client call.

create or replace function public.request_connection(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  already_connected boolean;
begin
  if p_target_id = auth.uid() then
    raise exception 'Cannot connect with yourself';
  end if;

  select exists(
    select 1 from public.scans where scanner_id = auth.uid() and scanned_id = p_target_id
  ) into already_connected;
  if already_connected then
    raise exception 'Already connected';
  end if;

  -- Clear my own stale pending request to this same target first, so a
  -- retry after a timeout isn't blocked by the partial unique index.
  update public.connection_requests
  set status = 'expired', responded_at = now()
  where requester_id = auth.uid()
    and target_id = p_target_id
    and status = 'pending'
    and created_at < now() - interval '2 minutes';

  begin
    insert into public.connection_requests (requester_id, target_id)
    values (auth.uid(), p_target_id)
    returning id into new_id;
  exception
    when unique_violation then
      raise exception 'You already have a pending request to this person — wait for them to respond.';
  end;

  return new_id;
end;
$$;

revoke all on function public.request_connection(uuid) from public;
grant execute on function public.request_connection(uuid) to authenticated;

create or replace function public.respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
begin
  select * into req from public.connection_requests where id = p_request_id for update;

  if req is null then
    raise exception 'Request not found';
  end if;
  if req.target_id <> auth.uid() then
    raise exception 'Not authorized to respond to this request';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been resolved';
  end if;
  if req.created_at < now() - interval '2 minutes' then
    update public.connection_requests set status = 'expired', responded_at = now() where id = p_request_id;
    raise exception 'This request expired — ask them to scan again';
  end if;

  if p_accept then
    -- record_mutual_scan uses auth.uid() as one side of the pair — here
    -- that's the target (the person accepting), which is exactly right:
    -- it credits both the requester and the accepter regardless of which
    -- one physically held the camera to scan.
    perform public.record_mutual_scan(req.requester_id);
    update public.connection_requests set status = 'accepted', responded_at = now() where id = p_request_id;
  else
    update public.connection_requests set status = 'declined', responded_at = now() where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.respond_to_connection_request(uuid, boolean) from public;
grant execute on function public.respond_to_connection_request(uuid, boolean) to authenticated;

-- record_mutual_scan should no longer be callable directly by a client —
-- otherwise a modified client could bypass the whole request/accept flow
-- and unilaterally credit itself + a stranger without consent, exactly the
-- abuse this feature exists to prevent. Calling it from inside
-- respond_to_connection_request still works: that function is itself
-- security definer (owned by postgres), so the internal call executes with
-- the function owner's privileges, not the original client's grants.
revoke execute on function public.record_mutual_scan(uuid) from authenticated;

grant select on public.connection_requests to authenticated;

-- Needed for the target's live "X wants to connect" popup (INSERT) and the
-- requester's live "waiting..." resolution (UPDATE) — see supabase_realtime
-- guard pattern from 20260814000001.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'connection_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.connection_requests';
  end if;
end $$;
