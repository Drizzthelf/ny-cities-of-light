-- Real fix, superseding the flawed 20260823000002 attempt: nesting the
-- expiry update in its own begin/exception/end does NOT protect it from a
-- later exception caught further up the call stack — releasing an inner
-- savepoint only merges its effects into the enclosing (still-pending,
-- still-rollback-able) scope, it doesn't durably commit them. The only
-- statements safe from a later RAISE's rollback are ones with nothing
-- raised afterward in the same call.
--
-- So: stop trying to update-then-raise for the expiry case. Change the
-- return type from void to text, reporting the outcome
-- ('accepted' | 'declined' | 'expired') as a normal return value instead of
-- an exception — the expiry branch's UPDATE now has no subsequent RAISE in
-- the same call to be undone by. Genuine authorization/not-found errors
-- still raise real exceptions, since those cases have nothing that needs
-- to persist alongside them — nothing lost by keeping those as exceptions.
--
-- Return type changes require DROP + CREATE, not CREATE OR REPLACE.
drop function if exists public.respond_to_connection_request(uuid, boolean);

create function public.respond_to_connection_request(p_request_id uuid, p_accept boolean)
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
  if req.created_at < now() - interval '2 minutes' then
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
