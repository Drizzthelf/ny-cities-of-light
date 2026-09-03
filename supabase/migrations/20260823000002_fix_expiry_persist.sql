-- Fixes a real bug caught by rls-smoke-test.sql: respond_to_connection_request's
-- expiry branch did `update ... set status = 'expired'` immediately followed
-- by `raise exception`. In PL/pgSQL, an exception caught by the CALLER (not
-- internally) rolls back everything since the caller's nearest savepoint —
-- including that update, even though it ran moments before. The safety
-- property still held (an expired request could never be accepted), but the
-- row silently stayed 'pending' in the database forever instead of actually
-- recording 'expired'.
--
-- Standard PL/pgSQL fix: wrap the update in its own nested
-- begin/exception/end block. That block's mere presence creates an internal
-- savepoint; when it exits normally (the update succeeds), that savepoint is
-- released relative to the outer scope — so the update survives the RAISE
-- that follows it, which only unwinds back to the *caller's* savepoint.
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
    begin
      update public.connection_requests set status = 'expired', responded_at = now() where id = p_request_id;
    exception
      when others then
        raise;
    end;
    raise exception 'This request expired — ask them to scan again';
  end if;

  if p_accept then
    perform public.record_mutual_scan(req.requester_id);
    update public.connection_requests set status = 'accepted', responded_at = now() where id = p_request_id;
  else
    update public.connection_requests set status = 'declined', responded_at = now() where id = p_request_id;
  end if;
end;
$$;
