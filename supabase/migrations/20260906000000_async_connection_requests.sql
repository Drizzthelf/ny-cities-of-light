-- Moves connection requests from "must be accepted live within 2 minutes"
-- to "sits in a Requests tab (ContactsScreen.tsx) until acted on, for up to
-- a day" — per user decision: farming isn't a concern here, and this is
-- what actually makes the QR-scan flow tolerant of unreliable venue wifi
-- (the live 2-minute accept required both people online at once; an async
-- request lets each side act whenever they have connectivity). The live
-- "wants to connect" popup (IncomingConnectionRequestListener.tsx) and the
-- "waiting for them to accept" spinner (ScannerScreen.tsx) still exist as a
-- bonus for the case where both people happen to be online right now — see
-- those files' updated comments — but neither is required anymore.

-- Same body as 20260903000100_repeat_scans.sql, only the stale-pending-
-- request clear window changes from 2 minutes to 1 day, matching the new
-- accept window below.
create or replace function public.request_connection(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  prior_count int;
  today_et date;
begin
  if p_target_id = auth.uid() then
    raise exception 'Cannot connect with yourself';
  end if;

  today_et := (now() at time zone 'America/New_York')::date;

  select count(*) into prior_count
  from public.scans where scanner_id = auth.uid() and scanned_id = p_target_id;

  if prior_count >= 3 then
    raise exception 'You have already scanned this person the maximum 3 times';
  end if;

  if exists (
    select 1 from public.scans
    where scanner_id = auth.uid() and scanned_id = p_target_id and scan_date = today_et
  ) then
    raise exception 'You already scanned this person today — try again tomorrow';
  end if;

  -- Clear my own stale pending request to this same target first, so a
  -- retry after the window closes isn't blocked by the partial unique index.
  update public.connection_requests
  set status = 'expired', responded_at = now()
  where requester_id = auth.uid()
    and target_id = p_target_id
    and status = 'pending'
    and created_at < now() - interval '1 day';

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

-- Same body as 20260823000003_expiry_return_value.sql, only the expiry
-- check changes from 2 minutes to 1 day.
create or replace function public.respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns text
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
  if req.created_at < now() - interval '1 day' then
    update public.connection_requests set status = 'expired', responded_at = now() where id = p_request_id;
    return 'expired';
  end if;

  if p_accept then
    perform public.record_mutual_scan(req.requester_id);
    update public.connection_requests set status = 'accepted', responded_at = now() where id = p_request_id;
    return 'accepted';
  else
    update public.connection_requests set status = 'declined', responded_at = now() where id = p_request_id;
    return 'declined';
  end if;
end;
$$;

revoke all on function public.respond_to_connection_request(uuid, boolean) from public;
grant execute on function public.respond_to_connection_request(uuid, boolean) to authenticated;

-- Sweeps stale pending requests to 'expired' on a schedule, rather than
-- only lazily on the next thing that happens to touch that row (a
-- requester retry, or the target finally responding). At a 2-minute window
-- that laziness didn't matter — everything happened in one live session
-- anyway. At a day-long window, a request nobody ever acts on would
-- otherwise sit showing as "Pending" in the requester's Sent list forever.
-- Named schedule so re-running this migration reschedules rather than
-- duplicating the job — same pattern as notify-double-points-start in
-- 20260831000000_push_notifications.sql.
select cron.schedule(
  'expire-stale-connection-requests',
  '*/15 * * * *',
  $$
  update public.connection_requests
  set status = 'expired', responded_at = now()
  where status = 'pending' and created_at < now() - interval '1 day';
  $$
);

-- Push notification when a new request comes in — additive on top of the
-- live in-app popup (IncomingConnectionRequestListener.tsx), which only
-- fires for someone who already has the app open at that exact moment.
-- Without this, someone not currently in the app would have no signal that
-- a request is waiting until they happen to open the Requests tab. Same
-- pattern as notify_raffle_winner in 20260831000000_push_notifications.sql
-- — reads the service_role key from Vault, no-ops if it hasn't been set up
-- yet rather than erroring (so request_connection itself never fails
-- because of this).
create or replace function public.notify_connection_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  if v_secret is not null then
    perform net.http_post(
      url := 'https://oggrlanwgmmdnvjltqel.functions.supabase.co/notify-connection-request',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('request_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists connection_request_notify on public.connection_requests;
create trigger connection_request_notify
  after insert on public.connection_requests
  for each row execute function public.notify_connection_request();
