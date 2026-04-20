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
import type { Profile } from '../types/database';

type Row = Profile & { scanned_at: string };

export function ContactsScreen() {
  const { session } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from('scans')
      .select('created_at, scanned:profiles!scans_scanned_id_fkey(*)')
      .eq('scanner_id', session.user.id)
      .order('created_at', { ascending: false });
    const mapped: Row[] = (data ?? []).map((r: any) => ({
      ...(r.scanned as Profile),
      scanned_at: r.created_at,
    }));
    setRows(mapped);
  }, [session?.user]);

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
      contentContainerStyle={rows.length === 0 ? styles.empty : styles.list}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <Text style={styles.emptyText}>No contacts yet. Scan someone's QR code!</Text>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          {item.photo_url ? (
            <Image source={{ uri: item.photo_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]} />
          )}
          <View style={styles.rowText}>
            <Text style={styles.name}>{item.full_name}</Text>
            {item.hometown ? <Text style={styles.meta}>from {item.hometown}</Text> : null}
            {item.background ? (
              <Text style={styles.background} numberOfLines={2}>
                {item.background}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { padding: 16 },
  empty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: '#777', fontSize: 15, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8f8f8',
    marginBottom: 10,
    alignItems: 'center',
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  rowText: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 13, marginTop: 2 },
  background: { color: '#333', fontSize: 13, marginTop: 4 },
});
