// Invoked by the raffle_winner_notify trigger (see
// supabase/migrations/20260831000000_push_notifications.sql) the moment
// draw_raffle_winner sets a winner — not client-callable in any normal
// flow. Push is additive: the in-app RaffleWinListener modal +
// ack_raffle_win are still the authoritative "you won" flow, this just
// nudges someone who isn't currently in the app.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendExpoPush } from '../_shared/expoPush.ts';

Deno.serve(async (req) => {
  try {
    const { prize_id } = await req.json();
    if (!prize_id) {
      return new Response(JSON.stringify({ error: 'Missing prize_id' }), { status: 400 });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: prize, error: prizeError } = await admin
      .from('raffle_prizes')
      .select('title, winner_id')
      .eq('id', prize_id)
      .maybeSingle();

    if (prizeError) {
      return new Response(JSON.stringify({ error: prizeError.message }), { status: 500 });
    }
    if (!prize?.winner_id) {
      return new Response(JSON.stringify({ skipped: 'no winner' }), { status: 200 });
    }

    const { data: tokens, error: tokensError } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', prize.winner_id);

    if (tokensError) {
      return new Response(JSON.stringify({ error: tokensError.message }), { status: 500 });
    }
    if (!tokens?.length) {
      return new Response(JSON.stringify({ skipped: 'no tokens' }), { status: 200 });
    }

    await sendExpoPush(
      tokens.map((t) => ({
        to: t.token,
        title: '🎉 You won!',
        body: `You won ${prize.title} in the raffle — open the app to claim it.`,
        data: { type: 'raffle_win', prize_id },
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
