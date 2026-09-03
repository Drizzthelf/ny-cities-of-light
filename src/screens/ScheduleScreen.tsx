import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { EventRow } from '../components/EventRow';
import { EventDetailModal } from '../components/EventDetailModal';
import type { Event } from '../types/database';
import { fonts, type ColorScheme } from '../theme';

type Section = { title: string; data: Event[] };

function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

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

export function ScheduleScreen() {
  const navigation = useNavigation<any>();
  const { top } = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [sections, setSections] = useState<Section[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    // See HomeScreen.tsx's double-points-windows effect for why this guard
    // exists — a fast unmount/remount can hand back an already-subscribed
    // channel of the same topic, and calling .on() on it throws.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:schedule-events')
      .forEach((c) => supabase.removeChannel(c));
    const channel = supabase
      .channel('schedule-events')
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
      <SectionList
        style={styles.container}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No events scheduled yet.</Text>}
        ListHeaderComponent={
          <>
            <View style={[styles.header, { paddingTop: top - 2 }]}>
              <Text style={styles.headerTitle}>Schedule</Text>
              <Text style={styles.headerQuote}>
                "To every thing there is a season, and a time to every purpose under the heaven."
              </Text>
              <Text style={styles.headerCitation}>— Ecclesiastes 3:1</Text>
            </View>
            <TouchableOpacity style={styles.venuesButton} onPress={() => navigation.navigate('Venues')}>
              <Text style={styles.venuesButtonText}>View all venues</Text>
              <Text style={styles.venuesButtonArrow}>›</Text>
            </TouchableOpacity>
          </>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <EventRow
            event={item}
            onOpenMaps={() => openMaps(item.address)}
            onPress={() => setSelectedEvent(item)}
          />
        )}
      />
      <EventDetailModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onOpenMaps={selectedEvent ? () => openMaps(selectedEvent.address) : undefined}
      />
    </>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: 32 },
    empty: { textAlign: 'center', marginTop: 60, color: colors.textFaint, fontSize: 15 },
    header: {
      // panelDark, not colors.text — this header is deliberately black in
      // both modes, not "page text color" that happens to be black in
      // light mode.
      backgroundColor: colors.panelDark,
      paddingHorizontal: 20,
      paddingBottom: 14,
    },
    headerTitle: { fontSize: 30, fontFamily: fonts.title, color: colors.textOnDark },
    headerQuote: { fontSize: 13, color: '#c7c2b4', marginTop: 6, fontStyle: 'italic', lineHeight: 18 },
    headerCitation: { fontSize: 12, color: '#9a9689', marginTop: 4 },
    venuesButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: 16,
      marginTop: 14,
      marginBottom: 4,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      // panelDark, not colors.text — same reasoning as `header` above.
      backgroundColor: colors.panelDark,
      borderWidth: 1,
      borderColor: colors.panelDark,
    },
    venuesButtonText: { color: colors.textOnDark, fontWeight: '600', fontSize: 15 },
    venuesButtonArrow: { fontSize: 20, color: colors.textOnDark },
    sectionHeader: {
      backgroundColor: colors.primaryTint,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
  });
}
