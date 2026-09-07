// Invoked by the connection_request_notify trigger (see
// supabase/migrations/20260906000000_async_connection_requests.sql) the
// moment a new connection_requests row is inserted — not client-callable
// in any normal flow. Push is additive: the in-app
// IncomingConnectionRequestListener popup and the Requests tab
// (ContactsScreen.tsx) are still the authoritative "you have a request"
// flow, this just nudges someone who isn't currently in the app — which
// matters a lot more now that requests stay acceptable for a day instead
// of requiring both people online at once.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendExpoPush } from '../_shared/expoPush.ts';

Deno.serve(async (req) => {
  try {
    const { request_id } = await req.json();
    if (!request_id) {
      return new Response(JSON.stringify({ error: 'Missing request_id' }), { status: 400 });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: request } = await admin
      .from('connection_requests')
      .select('target_id, requester:profiles!connection_requests_requester_id_fkey(first_name)')
      .eq('id', request_id)
      .maybeSingle();

    if (!request?.target_id) {
      return new Response(JSON.stringify({ skipped: 'request not found' }), { status: 200 });
    }

    const { data: tokens } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', request.target_id);

    if (!tokens?.length) {
      return new Response(JSON.stringify({ skipped: 'no tokens' }), { status: 200 });
    }

    const requesterName = (request as any).requester?.first_name ?? 'Someone';

    await sendExpoPush(
      tokens.map((t) => ({
        to: t.token,
        title: 'New connection request',
        body: `${requesterName} wants to connect — open the app to respond.`,
        data: { type: 'connection_request', request_id },
      }))
    );

    return new Response(JSON.stringify({ success: true, notified: tokens.length }), { status: 200 });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500 }
    );
  }
});
