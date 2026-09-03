import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import type { Announcement } from '../types/database';
import { fonts, type ColorScheme } from '../theme';
import { useTheme } from '../context/ThemeContext';

type Row = Announcement & { admin: { first_name: string } | null };

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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*, admin:profiles!announcements_admin_id_fkey(first_name)')
      .order('created_at', { ascending: false });
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    load();
    // See HomeScreen.tsx's double-points-windows effect for why this guard
    // exists — a fast unmount/remount (e.g. rapid tab switching) can hand
    // back an already-subscribed channel of the same topic, and calling
    // .on() on it throws.
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:announcements-feed')
      .forEach((c) => supabase.removeChannel(c));
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
        <View style={[styles.header, { paddingTop: top + -2 }]}>
          <Text style={styles.headerTitle}>Updates</Text>
          <Text style={styles.headerQuote}>
            "We have this hope as an anchor for the soul, firm and secure."
          </Text>
          <Text style={styles.headerCitation}>— Hebrews 6:19</Text>
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
          {/* Falls back to "Admin" for system-generated posts (e.g. a raffle
              winner announcement) that have no admin_id, rather than hiding
              the author line entirely. */}
          <Text style={styles.cardAuthor}>— {item.admin?.first_name ?? 'Admin'}</Text>
        </View>
      )}
    />
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: 40 },
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
    emptyBox: { padding: 40, alignItems: 'center' },
    emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
    emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center', lineHeight: 20 },
    card: {
      marginHorizontal: 16,
      marginTop: 14,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginRight: 10 },
    cardTime: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
    cardBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
    cardAuthor: { fontSize: 12, color: colors.textMuted, marginTop: 10, fontStyle: 'italic' },
  });
}
