import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
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
import { useTheme } from '../context/ThemeContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { type ColorScheme } from '../theme';

type Venue = {
  location_name: string;
  address: string;
  eventTitles: string[];
};

function openMaps(address: string) {
  const q = encodeURIComponent(address);
  const googleMaps = () =>
    Linking.openURL(`comgooglemaps://?q=${q}`).catch(() =>
      Linking.openURL(`https://maps.google.com/maps?q=${q}`)
    );

  if (Platform.OS === 'ios') {
    Alert.alert('Open in Maps', undefined, [
      { text: 'Apple Maps', onPress: () => Linking.openURL(`maps:0,0?q=${q}`) },
      { text: 'Google Maps', onPress: googleMaps },
      { text: 'Cancel', style: 'cancel' },
    ]);
  } else {
    googleMaps();
  }
}

export function NavigateScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    // See HomeScreen.tsx's double-points-windows effect for why this guard
    // exists — a fast unmount/remount can hand back an already-subscribed
    // channel of the same topic, and calling .on() on it throws.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:navigate-events')
      .forEach((c) => supabase.removeChannel(c));
    const channel = supabase
      .channel('navigate-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <>
      <ScreenHeader title="Venues" variant="banner" />
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={venues}
        keyExtractor={(item) => item.location_name}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
    </>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 40 },
    empty: { textAlign: 'center', marginTop: 40, color: colors.textFaint },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — more
    // readable for a venue list people are scanning for directions.
    venueName: { fontSize: 18, fontWeight: '700', color: colors.text },
    address: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
    tag: {
      backgroundColor: colors.borderLight,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    tagText: { fontSize: 12, color: colors.textMuted, maxWidth: 180 },
    mapsButton: {
      marginTop: 14,
      // panelDark, not colors.text — this button is deliberately black in
      // both modes, not "page text color" that happens to be black in
      // light mode.
      backgroundColor: colors.panelDark,
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: 'center',
    },
    mapsButtonText: { color: colors.textOnDark, fontWeight: '600', fontSize: 14 },
  });
}
