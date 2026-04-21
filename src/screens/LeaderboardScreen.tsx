import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { LeaderboardRow } from '../types/database';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardScreen() {
  const { session } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('leaderboard').select('*').limit(100);
    setRows((data ?? []) as LeaderboardRow[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={styles.legend}>
          <Text style={styles.legendText}>10 pts per contact · 30 pts per event</Text>
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
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
            <View style={styles.nameBlock}>
              <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                {item.full_name}{isMe ? ' (you)' : ''}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16 },
  legend: {
    backgroundColor: '#f0f4ff',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    alignItems: 'center',
  },
  legendText: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#777' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    marginBottom: 8,
  },
  rowMe: { backgroundColor: '#e0ecff' },
  rank: { width: 32, fontSize: 18, textAlign: 'center', marginRight: 4 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  nameBlock: { flex: 1 },
  name: { fontSize: 15, color: '#1e293b' },
  nameMe: { fontWeight: '700' },
  breakdown: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  points: { fontSize: 18, fontWeight: '700', color: '#2563eb' },
});
