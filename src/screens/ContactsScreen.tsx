import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from '../components/Avatar';
import { ReportModal } from '../components/ReportModal';
import { ScreenHeader } from '../components/ScreenHeader';
import type { Profile, SocialPlatform } from '../types/database';
import { type ColorScheme } from '../theme';

type Row = Profile & { scanned_at: string; scan_count: number };
type ViewMode = 'all' | 'favorites';

const SOCIAL_ICONS: Record<SocialPlatform, keyof typeof Ionicons.glyphMap> = {
  instagram: 'logo-instagram',
  facebook: 'logo-facebook',
  twitter: 'logo-twitter',
  tiktok: 'logo-tiktok',
};

// Bronze/silver/gold for the 1st/2nd/3rd time you've scanned this person —
// up to 3 scans per pair now that a re-scan on a later day is allowed.
const SCAN_MEDALS = ['🥉', '🥈', '🥇'];

export function ContactsScreen() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [rows, setRows] = useState<Row[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reporting, setReporting] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    const [{ data: scanData }, { data: favData }] = await Promise.all([
      supabase
        .from('scans')
        .select('created_at, scanned:profiles!scans_scanned_id_fkey(*, profile_socials(*))')
        .eq('scanner_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase.from('favorites').select('contact_id').eq('user_id', session.user.id),
    ]);
    // One scans row per scan event now (up to 3 per contact, one per day
    // scanned), not one per contact — collapse to one Row per contact,
    // counting events and keeping the most recent scanned_at.
    const byContact = new Map<string, Row>();
    for (const r of (scanData ?? []) as any[]) {
      const scanned = r.scanned as Profile;
      const existing = byContact.get(scanned.id);
      if (existing) {
        existing.scan_count += 1;
        if (r.created_at > existing.scanned_at) existing.scanned_at = r.created_at;
      } else {
        byContact.set(scanned.id, { ...scanned, scanned_at: r.created_at, scan_count: 1 });
      }
    }
    const mapped = [...byContact.values()].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
    setRows(mapped);
    setFavoriteIds(new Set((favData ?? []).map((f: any) => f.contact_id as string)));
  }, [session?.user]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Not shown to the favorited person or anyone else — enforced server-side
  // by favorites' RLS (only the favoriter's own rows are ever selectable),
  // not just by this screen not surfacing it. See
  // supabase/migrations/20260825000000_favorites.sql.
  async function toggleFavorite(contactId: string) {
    if (!session?.user) return;
    const isFav = favoriteIds.has(contactId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
    const { error } = isFav
      ? await supabase.from('favorites').delete().eq('user_id', session.user.id).eq('contact_id', contactId)
      : await supabase.from('favorites').insert({ user_id: session.user.id, contact_id: contactId });
    if (error) {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(contactId);
        else next.delete(contactId);
        return next;
      });
      Alert.alert('Could not update favorite', error.message);
    }
  }

  const modeRows = viewMode === 'favorites' ? rows.filter((r) => favoriteIds.has(r.id)) : rows;
  const query = search.trim().toLowerCase();
  const visibleRows = query
    ? modeRows.filter(
        (r) =>
          r.first_name.toLowerCase().includes(query) ||
          r.profile_socials.some((s) => s.handle.toLowerCase().includes(query))
      )
    : modeRows;

  return (
    <>
      <ScreenHeader title="My Contacts" backLabel="QR Meetup" variant="banner" />

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, viewMode === 'all' && styles.tabActive]}
          onPress={() => setViewMode('all')}
        >
          <Text style={[styles.tabText, viewMode === 'all' && styles.tabTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, viewMode === 'favorites' && styles.tabActive]}
          onPress={() => setViewMode('favorites')}
        >
          <Text style={[styles.tabText, viewMode === 'favorites' && styles.tabTextActive]}>★ Favorites</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name or handle"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <FlatList
        style={styles.container}
        contentContainerStyle={visibleRows.length === 0 ? styles.empty : styles.list}
        data={visibleRows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {query
              ? `No contacts match "${search}".`
              : viewMode === 'favorites'
                ? 'No favorites yet. Tap the star on a contact to add them here.'
                : "No contacts yet. Scan someone's QR code!"}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setSelected(item)} activeOpacity={0.7}>
            <Avatar photoUrl={item.photo_url} name={item.first_name} size={56} />
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {SCAN_MEDALS[Math.min(item.scan_count, 3) - 1]} {item.first_name}
              </Text>
              {item.profile_socials.length > 0 ? (
                <Text style={styles.meta}>{item.profile_socials.map((s) => s.handle).join(' · ')}</Text>
              ) : null}
            </View>
            <TouchableOpacity style={styles.starButton} onPress={() => toggleFavorite(item.id)}>
              <Text style={styles.starButtonText}>{favoriteIds.has(item.id) ? '★' : '☆'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.detailBackdrop} activeOpacity={1} onPress={() => setSelected(null)}>
          <TouchableOpacity style={styles.detailCard} activeOpacity={1} onPress={() => {}}>
            <Avatar photoUrl={selected?.photo_url} name={selected?.first_name} size={300} />
            <Text style={styles.detailName}>{selected?.first_name}</Text>

            {selected && (
              <TouchableOpacity style={styles.detailFavoriteButton} onPress={() => toggleFavorite(selected.id)}>
                <Text style={styles.detailFavoriteText}>
                  {favoriteIds.has(selected.id) ? '★ Favorited' : '☆ Add to favorites'}
                </Text>
              </TouchableOpacity>
            )}

            {selected && selected.profile_socials.length > 0 ? (
              <View style={styles.socialsBox}>
                {selected.profile_socials.map((s) => (
                  <View key={s.id} style={styles.socialRow}>
                    <Ionicons name={SOCIAL_ICONS[s.platform]} size={18} color={colors.text} />
                    <Text style={styles.socialHandle}>{s.handle}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.detailHint}>No social handles added.</Text>
            )}

            {selected && (
              <TouchableOpacity style={styles.detailReportButton} onPress={() => setReporting(selected)}>
                <Text style={styles.detailReportText}>Report</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.detailCloseButton} onPress={() => setSelected(null)}>
              <Text style={styles.detailCloseText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Rendered inside this same Modal, on top of the enlarged-profile
            card, rather than as its own separate Modal — this way the
            profile view stays open behind it, and closing the report
            popup (at any stage: cancel, submitted, or already-reported)
            just lands back on the still-open profile view underneath. */}
        <ReportModal
          variant="overlay"
          visible={!!reporting}
          reportedId={reporting?.id ?? null}
          reportedName={reporting?.first_name}
          onClose={() => setReporting(null)}
        />
      </Modal>
    </>
  );
}

function getStyles(colors: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    tabBar: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
    tab: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.borderLight,
    },
    tabActive: { backgroundColor: colors.primary },
    tabText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    tabTextActive: { color: '#fff' },
    searchInput: {
      marginHorizontal: 16,
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    list: { padding: 16 },
    empty: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    emptyText: { color: colors.textFaint, fontSize: 15, textAlign: 'center' },
    row: {
      flexDirection: 'row',
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      marginBottom: 10,
      alignItems: 'center',
    },
    rowText: { flex: 1, marginLeft: 12 },
    name: { fontSize: 16, fontWeight: '600', color: colors.text },
    meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    starButton: { paddingHorizontal: 8, paddingVertical: 4 },
    starButtonText: { fontSize: 22, color: colors.highlightText },
    detailBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    detailCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 20,
      alignItems: 'center',
    },
    // Plain bold sans, not fonts.title (PlayfairDisplay italic) — matches
    // the name treatment on the Profile screen, which switched away from
    // the italic serif for readability.
    detailName: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 16 },
    detailFavoriteButton: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 14 },
    detailFavoriteText: { color: colors.highlightText, fontSize: 14, fontWeight: '600' },
    detailHint: { color: colors.textFaint, marginTop: 14, fontSize: 13 },
    socialsBox: {
      marginTop: 16,
      alignSelf: 'stretch',
      backgroundColor: colors.primaryTint,
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 20,
      gap: 10,
    },
    socialRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    socialHandle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    detailReportButton: { marginTop: 14, paddingVertical: 4 },
    detailReportText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    detailCloseButton: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 32 },
    detailCloseText: { color: colors.textFaint, fontSize: 14, fontWeight: '600' },
  });
}
