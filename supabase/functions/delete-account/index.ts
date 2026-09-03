// Self-service account deletion (Apple Guideline 5.1.1(v) / Play Console
// Data Safety both require in-app deletion, not just a support email).
//
// A regular client can never delete its own auth.users row — only the
// Admin API can, and that needs the service_role key, which must never
// reach the app. So this runs server-side: verify the caller's own JWT,
// then use service_role internally to delete exactly that caller's user.
//
// SECURITY: the target id always comes from the verified JWT (`user.id`),
// never from the request body — otherwise any authenticated user could
// pass someone else's id and delete their account instead of their own.
//
// public.profiles.id references auth.users(id) on delete cascade, and
// every child table (scans, event_checkins, service_requests,
// profile_socials) cascades from profiles — see
// docs/production-launch-plan.md §5. Deleting the auth.users row here is
// enough to remove all of it.

import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Scoped to the caller's own JWT — used only to find out who they are.
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id, false);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
