import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from '../components/Avatar';
import { ScreenHeader } from '../components/ScreenHeader';
import type { LeaderboardRow } from '../types/database';
import { type ColorScheme } from '../theme';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardScreen() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('leaderboard').select('*').limit(100);
    setRows((data ?? []) as LeaderboardRow[]);
  }, []);

  // No realtime subscription here on purpose — unlike HomeScreen's own-scan
  // count, rankings are relative to everyone, so there's no per-user filter
  // that would avoid broadcasting every attendee's scan to every client with
  // this tab open. Reloading on focus (instead) is the cheap middle ground:
  // fresh data whenever the user actually looks at this screen, with zero
  // realtime cost. See docs/production-launch-plan.md §4.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Leaderboard" variant="banner" />
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.legend}>
            <Text style={styles.legendText}>10 pts per contact (20 during 2x windows) · 50 pts per event</Text>
            <Text style={styles.legendHint}>
              Standings aren't live — pull down to refresh for the latest.
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No scores yet.</Text>}
        renderItem={({ item, index }) => {
          const isMe = session?.user?.id === item.id;
          return (
            <View style={[styles.row, isMe && styles.rowMe]}>
              <Text style={styles.rank}>
                {index < 3 ? MEDALS[index] : `${index + 1}`}
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
