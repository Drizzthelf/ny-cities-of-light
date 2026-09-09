// Polled every 5 minutes by the notify-double-points-start pg_cron job
// (see supabase/migrations/20260831000000_push_notifications.sql), not
// client-callable in any normal flow. Looks for windows that started
// recently and haven't been announced yet, pushes to every registered
// device, then marks the window notified so the next poll skips it —
// without that guard this would re-blast the same window every 5 minutes
// until it ends.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendExpoPush } from '../_shared/expoPush.ts';

Deno.serve(async () => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    const { data: windows, error: windowsError } = await admin
      .from('double_points_windows')
      .select('id, end_time')
      .is('start_notified_at', null)
      .lte('start_time', now.toISOString())
      .gt('start_time', tenMinAgo.toISOString());

    if (windowsError) {
      return new Response(JSON.stringify({ error: windowsError.message }), { status: 500 });
    }
    if (!windows?.length) {
      return new Response(JSON.stringify({ skipped: 'no windows' }), { status: 200 });
    }

    const { data: tokens, error: tokensError } = await admin.from('push_tokens').select('token');
    if (tokensError) {
      return new Response(JSON.stringify({ error: tokensError.message }), { status: 500 });
    }

    for (const w of windows) {
      if (tokens?.length) {
        const endClock = new Date(w.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await sendExpoPush(
          tokens.map((t) => ({
            to: t.token,
            title: '🔥 Double points are live!',
            body: `Scan someone's QR code before ${endClock} to earn double points.`,
            data: { type: 'double_points_start', window_id: w.id },
          }))
        );
      }
      await admin
        .from('double_points_windows')
        .update({ start_notified_at: now.toISOString() })
        .eq('id', w.id);
    }

    return new Response(
      JSON.stringify({ success: true, windows: windows.length, tokens: tokens?.length ?? 0 }),
      { status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500 }
    );
  }
});
