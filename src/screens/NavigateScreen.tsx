import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Venue = {
  location_name: string;
  address: string;
  eventTitles: string[];
};

function openMaps(address: string) {
  const q = encodeURIComponent(address);
  const url = Platform.OS === 'ios' ? `maps:0,0?q=${q}` : `geo:0,0?q=${q}`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://maps.google.com/maps?q=${q}`)
  );
}

export function NavigateScreen() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('title, location_name, address')
      .order('start_time', { ascending: true });

    const map: Record<string, Venue> = {};
    for (const e of (data ?? []) as { title: string; location_name: string; address: string }[]) {
      if (!map[e.location_name]) {
        map[e.location_name] = { location_name: e.location_name, address: e.address, eventTitles: [] };
      }
      if (!map[e.location_name].eventTitles.includes(e.title)) {
        map[e.location_name].eventTitles.push(e.title);
      }
    }
    setVenues(Object.values(map));
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
      contentContainerStyle={styles.content}
      data={venues}
      keyExtractor={(item) => item.location_name}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={<Text style={styles.header}>Conference Venues</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No venues yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.venueName}>{item.location_name}</Text>
          <Text style={styles.address}>{item.address}</Text>
          <View style={styles.tags}>
            {item.eventTitles.slice(0, 3).map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText} numberOfLines={1}>{t}</Text>
              </View>
            ))}
            {item.eventTitles.length > 3 && (
              <View style={styles.tag}>
                <Text style={styles.tagText}>+{item.eventTitles.length - 3} more</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.mapsButton} onPress={() => openMaps(item.address)}>
            <Text style={styles.mapsButtonText}>Open in Maps</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  header: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  empty: { textAlign: 'center', marginTop: 40, color: '#777' },
  card: {
    backgroundColor: '#f8faff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  venueName: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  address: { fontSize: 13, color: '#64748b', marginTop: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  tag: {
    backgroundColor: '#dbeafe',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, color: '#2563eb', maxWidth: 180 },
  mapsButton: {
    marginTop: 14,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  mapsButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
