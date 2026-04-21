import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Event } from '../types/database';

type Section = { title: string; data: Event[] };

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateKey(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function ScheduleScreen() {
  const [sections, setSections] = useState<Section[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('start_time', { ascending: true });

    const grouped: Record<string, Event[]> = {};
    for (const event of (data ?? []) as Event[]) {
      const day = dateKey(event.start_time);
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(event);
    }
    setSections(Object.entries(grouped).map(([title, data]) => ({ title, data })));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={<Text style={styles.empty}>No events scheduled yet.</Text>}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.timeCol}>
            <Text style={styles.timeStart}>{formatTime(item.start_time)}</Text>
            <Text style={styles.timeEnd}>{formatTime(item.end_time)}</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.location}>{item.location_name}</Text>
            {item.description ? (
              <Text style={styles.desc} numberOfLines={3}>{item.description}</Text>
            ) : null}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingBottom: 32 },
  empty: { textAlign: 'center', marginTop: 60, color: '#777', fontSize: 15 },
  sectionHeader: {
    backgroundColor: '#eef2ff',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  timeCol: { width: 62, marginRight: 12, alignItems: 'flex-end' },
  timeStart: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  timeEnd: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  cardBody: { flex: 1 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  location: { fontSize: 12, color: '#2563eb', marginTop: 3 },
  desc: { fontSize: 13, color: '#64748b', marginTop: 5, lineHeight: 18 },
});
