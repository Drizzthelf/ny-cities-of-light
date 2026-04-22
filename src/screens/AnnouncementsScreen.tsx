import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import type { Announcement } from '../types/database';

type Row = Announcement & { admin: { full_name: string } | null };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function AnnouncementsScreen() {
  const { top } = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*, admin:profiles!announcements_admin_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('announcements-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={[styles.header, { paddingTop: top + 16 }]}>
          <Text style={styles.headerTitle}>Updates</Text>
          <Text style={styles.headerSub}>Cities of Light Conference · New York City</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No announcements yet</Text>
          <Text style={styles.emptySub}>Check back here for important updates from the team.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
          </View>
          <Text style={styles.cardBody}>{item.body}</Text>
          {item.admin?.full_name && (
            <Text style={styles.cardAuthor}>— {item.admin.full_name}</Text>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingBottom: 40 },
  header: {
    backgroundColor: '#1e3a8a',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: '#93c5fd', marginTop: 4 },
  emptyBox: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#334155', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: '#f8faff',
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2563eb',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', flex: 1, marginRight: 10 },
  cardTime: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  cardBody: { fontSize: 14, color: '#334155', lineHeight: 21 },
  cardAuthor: { fontSize: 12, color: '#64748b', marginTop: 10, fontStyle: 'italic' },
});
