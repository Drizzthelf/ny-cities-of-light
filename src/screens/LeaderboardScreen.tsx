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

export function LeaderboardScreen() {
  const { session } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('leaderboard')
      .select('*')
      .limit(100);
    setRows((data ?? []) as LeaderboardRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      ListEmptyComponent={<Text style={styles.empty}>No scans yet.</Text>}
      renderItem={({ item, index }) => {
        const isMe = session?.user?.id === item.id;
        return (
          <View style={[styles.row, isMe && styles.rowMe]}>
            <Text style={styles.rank}>{index + 1}</Text>
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
            <Text style={[styles.name, isMe && { fontWeight: '700' }]} numberOfLines={1}>
              {item.full_name}
              {isMe ? ' (you)' : ''}
            </Text>
            <Text style={styles.count}>{item.scan_count}</Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16 },
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
  rank: { width: 28, fontSize: 15, color: '#666', fontWeight: '600' },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  name: { flex: 1, fontSize: 15 },
  count: { fontSize: 16, fontWeight: '700', color: '#2563eb' },
});
