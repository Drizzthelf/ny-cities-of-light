import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from '../components/Avatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { readCache, writeCache } from '../lib/offlineCache';
import type { LeaderboardRow } from '../types/database';
import { type ColorScheme } from '../theme';

const MEDALS = ['🥇', '🥈', '🥉'];
const HOUR_MS = 60 * 60 * 1000;
// Same feed for every attendee (not personal data), so a fixed cache
// namespace is fine — no per-user scoping needed, same as
// Schedule/Announcements.
const CACHE_USER = 'shared';

export function LeaderboardScreen() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('leaderboard').select('*').limit(10);
    if (!data) return;
    const typed = data as LeaderboardRow[];
    setRows(typed);
    setUpdatedAt(Date.now());
    writeCache<LeaderboardRow[]>('leaderboard', CACHE_USER, typed);
  }, []);

  // Deliberately NOT refetched on focus or pull-to-refresh anymore, per
  // user decision — standings now update on a fixed hourly cadence and
  // stay static in between, regardless of how often someone looks at or
  // pulls on this screen. On mount, use the cached snapshot if it's still
  // within the hour (schedules the next tick for whenever that hour is
  // actually up); otherwise fetch immediately and start a fresh hourly
  // cycle from now.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      await load();
      if (!cancelled) timer = setTimeout(tick, HOUR_MS);
    }

    readCache<LeaderboardRow[]>('leaderboard', CACHE_USER).then((cached) => {
      if (cancelled) return;
      if (cached) {
        setRows(cached.data);
        setUpdatedAt(cached.savedAt);
      }
      const age = cached ? Date.now() - cached.savedAt : Infinity;
      if (age >= HOUR_MS) {
        tick();
      } else {
        timer = setTimeout(tick, HOUR_MS - age);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Leaderboard" variant="banner" />
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.legend}>
            <Text style={styles.legendText}>10 pts per contact (20 during 2x windows) · 50 pts per event</Text>
            <Text style={styles.legendHint}>
              Standings update about once an hour
              {updatedAt ? ` · last updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No scores yet.</Text>}
        renderItem={({ item, index }) => {
          const isMe = session?.user?.id === item.id;
          return (
            <View style={[styles.row, isMe && styles.rowMe]}>
              <Text style={styles.rank}>
                {index < 3 ? MEDALS[index] : ''}
              </Text>
              <Avatar photoUrl={item.photo_url} name={item.first_name} size={40} style={styles.avatar} />
              <View style={styles.nameBlock}>
                <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                  {item.first_name}{isMe ? ' (you)' : ''}
                </Text>
                <Text style={styles.breakdown}>
                  {item.scan_count} contacts · {item.event_count} events
                </Text>
              </View>
              <Text style={styles.points}>{item.points}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16 },
    legend: {
      backgroundColor: colors.primaryTint,
      borderRadius: 10,
      padding: 10,
      marginBottom: 14,
      alignItems: 'center',
    },
    legendText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    legendHint: { fontSize: 11, color: colors.textFaint, marginTop: 4 },
    empty: { textAlign: 'center', marginTop: 40, color: colors.textFaint },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginBottom: 8,
    },
    rowMe: { backgroundColor: colors.primaryTint },
    rank: { width: 32, fontSize: 18, textAlign: 'center', marginRight: 4 },
    avatar: { marginRight: 12 },
    nameBlock: { flex: 1 },
    name: { fontSize: 15, color: colors.text },
    nameMe: { fontWeight: '700' },
    breakdown: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
    points: { fontSize: 18, fontWeight: '700', color: colors.primary },
  });
}
