import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { withRetry, isTransient } from '../lib/withRetry';
import { useAuth } from '../context/AuthContext';
import { listQueue, removeFromQueue } from '../lib/offlineQueue';

// Renders nothing — mounted alongside the other global listeners in
// RootNavigator. Drains the connection-request outbox (see
// src/lib/offlineQueue.ts) on mount and on every foreground, same trigger
// PushNotificationRegistrar already uses, so no new dependency (e.g.
// NetInfo) is needed to detect "might be back online now."
//
// Per design: a queued request either gets sent (removed on success) or
// gets a definitive non-network answer from the server (removed as a
// silent failure — already-pending, already-connected, max-scans-reached,
// target deleted, whatever) — it never retries forever. Only a genuine
// network failure (still offline) leaves it queued for the next attempt.
export function OutboxFlusher() {
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile) return;
    const userId = profile.id;

    async function flush() {
      const queue = await listQueue(userId);
      for (const item of queue) {
        const { error } = await withRetry(() =>
          supabase.rpc('request_connection', { p_target_id: item.targetId })
        );
        if (!error || !isTransient(error)) {
          await removeFromQueue(userId, item.targetId);
        }
        // else: still unreachable — leave it queued for the next flush.
      }
    }

    flush();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    return () => sub.remove();
  }, [profile?.id]);

  return null;
}
