import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { CachedDataBanner } from '../components/CachedDataBanner';
import { ReportModal } from '../components/ReportModal';
import { ScreenHeader } from '../components/ScreenHeader';
import { readCache, writeCache } from '../lib/offlineCache';
import type { ConnectionRequest, Profile, SocialPlatform } from '../types/database';
import { type ColorScheme } from '../theme';

type Row = Profile & { scanned_at: string; scan_count: number; last_scan_date: string };
type ViewMode = 'all' | 'favorites' | 'requests';
type ContactsCache = { rows: Row[]; favoriteIds: string[] };
type SentRow = ConnectionRequest & { target: Profile };
type ReceivedRow = ConnectionRequest & { requester: Profile };
type RequestsCache = { sent: SentRow[]; received: ReceivedRow[] };

const STATUS_LABELS: Record<ConnectionRequest['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

// "Today" per the conference's own clock (America/New_York), matching
// scans.scan_date's day boundary — see
// supabase/migrations/20260903000100_repeat_scans.sql. en-CA formats as
// YYYY-MM-DD, the same shape Postgres returns for a `date` column, so the
// two compare directly as strings.
function todayEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const SOCIAL_ICONS: Record<SocialPlatform, keyof typeof Ionicons.glyphMap> = {
  instagram: 'logo-instagram',
  facebook: 'logo-facebook',
  twitter: 'logo-twitter',
  tiktok: 'logo-tiktok',
};

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
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null);
  const freshRef = useRef(false);
  // Timestamp of the last data we actually know is good — from either a
  // successful live load or the on-mount cache read. Lets a *failed*
  // pull-to-refresh show "showing saved data from Xm ago" instead of
  // silently doing nothing and looking like the refresh worked.
  const lastGoodAtRef = useRef<number | null>(null);

  const [sentRequests, setSentRequests] = useState<SentRow[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<ReceivedRow[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [requestsCacheSavedAt, setRequestsCacheSavedAt] = useState<number | null>(null);
  const requestsFreshRef = useRef(false);
  const requestsLastGoodAtRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    const [{ data: scanData, error: scanError }, { data: favData }] = await Promise.all([
      supabase
        .from('scans')
        .select('created_at, scan_date, scanned:profiles!scans_scanned_id_fkey(*, profile_socials(*))')
        .eq('scanner_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase.from('favorites').select('contact_id').eq('user_id', session.user.id),
    ]);
    // On failure, leave whatever's already on screen (fresh or cached)
    // instead of clearing the contacts list out to empty — but still
    // surface that it didn't refresh, via the last-known-good timestamp.
    if (scanError || !scanData) {
      setCacheSavedAt(lastGoodAtRef.current);
      return;
    }

    // One scans row per scan event now (up to 3 per contact, one per day
    // scanned), not one per contact — collapse to one Row per contact,
    // counting events and keeping the most recent scanned_at/scan_date.
    const byContact = new Map<string, Row>();
    for (const r of scanData as any[]) {
      const scanned = r.scanned as Profile;
      const existing = byContact.get(scanned.id);
      if (existing) {
        existing.scan_count += 1;
        if (r.created_at > existing.scanned_at) existing.scanned_at = r.created_at;
        if (r.scan_date > existing.last_scan_date) existing.last_scan_date = r.scan_date;
      } else {
        byContact.set(scanned.id, {
          ...scanned,
          scanned_at: r.created_at,
          scan_count: 1,
          last_scan_date: r.scan_date,
        });
      }
    }
    const mapped = [...byContact.values()].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
    const favIds = new Set((favData ?? []).map((f: any) => f.contact_id as string));
    freshRef.current = true;
    lastGoodAtRef.current = Date.now();
    setCacheSavedAt(null);
    setRows(mapped);
    setFavoriteIds(favIds);
    writeCache<ContactsCache>('contacts', session.user.id, { rows: mapped, favoriteIds: [...favIds] });
  }, [session?.user]);

  useEffect(() => {
    if (!session?.user) return;
    freshRef.current = false;
    let cancelled = false;
    readCache<ContactsCache>('contacts', session.user.id).then((cached) => {
      if (cancelled || !cached || freshRef.current) return;
      setRows(cached.data.rows);
      setFavoriteIds(new Set(cached.data.favoriteIds));
      setCacheSavedAt(cached.savedAt);
      lastGoodAtRef.current = cached.savedAt;
    });
    return () => { cancelled = true; };
  }, [session?.user]);

  useEffect(() => {
    load();
  }, [load]);

  // Sent: every request I've made, any status, newest first — a running
  // history. Received: only 'pending' ones — the "requests" enum has no
  // path back out of pending except accepted/declined/expired, so a
  // resolved one dropping out of this list once acted on is expected, not
  // a bug.
  const loadRequests = useCallback(async () => {
    if (!session?.user) return;
    const [{ data: sent, error: sentError }, { data: received, error: receivedError }] = await Promise.all([
      supabase
        .from('connection_requests')
        .select('*, target:profiles!connection_requests_target_id_fkey(*, profile_socials(*))')
        .eq('requester_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('connection_requests')
        .select('*, requester:profiles!connection_requests_requester_id_fkey(*, profile_socials(*))')
        .eq('target_id', session.user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ]);
    if (sentError || receivedError || !sent || !received) {
      setRequestsCacheSavedAt(requestsLastGoodAtRef.current);
      return;
    }
    requestsFreshRef.current = true;
    requestsLastGoodAtRef.current = Date.now();
    setRequestsCacheSavedAt(null);
    setSentRequests(sent as SentRow[]);
    setReceivedRequests(received as ReceivedRow[]);
    writeCache<RequestsCache>('connection-requests', session.user.id, {
      sent: sent as SentRow[],
      received: received as ReceivedRow[],
    });
  }, [session?.user]);

  useEffect(() => {
    if (!session?.user) return;
    requestsFreshRef.current = false;
    let cancelled = false;
    readCache<RequestsCache>('connection-requests', session.user.id).then((cached) => {
      if (cancelled || !cached || requestsFreshRef.current) return;
      setSentRequests(cached.data.sent);
      setReceivedRequests(cached.data.received);
      setRequestsCacheSavedAt(cached.savedAt);
      requestsLastGoodAtRef.current = cached.savedAt;
    });
    return () => { cancelled = true; };
  }, [session?.user]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Live-updates the Received list the moment a new request arrives, or an
  // existing one resolves some other way (e.g. it expired via the
  // pg_cron sweep) — without this, a request sent while this tab is open
  // wouldn't show up until the next manual refresh.
  useEffect(() => {
    if (!session?.user) return;
    supabase
      .getChannels()
      .filter((c) => c.topic === 'realtime:my-connection-requests')
      .forEach((c) => supabase.removeChannel(c));
    const channel = supabase
      .channel('my-connection-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connection_requests', filter: `target_id=eq.${session.user.id}` },
        loadRequests
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connection_requests', filter: `requester_id=eq.${session.user.id}` },
        loadRequests
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user, loadRequests]);

  async function respondToRequest(requestId: string, accept: boolean) {
    setRespondingId(requestId);
    const { data, error } = await supabase.rpc('respond_to_connection_request', {
      p_request_id: requestId,
      p_accept: accept,
    });
    setRespondingId(null);
    if (error) {
      Alert.alert(accept ? 'Could not accept' : 'Could not decline', error.message);
      return;
    }
    if (accept && data === 'expired') {
      Alert.alert('Request expired', 'This request expired before you responded.');
    }
    await loadRequests();
    if (accept) await load();
  }

  async function onRefresh() {
    setRefreshing(true);
    if (viewMode === 'requests') await loadRequests();
    else await load();
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

  function showScanInfo(item: Row) {
    const scannedToday = item.last_scan_date === todayEasternDate();
    Alert.alert(
      item.first_name,
      `You've scanned ${item.first_name} ${item.scan_count} time${item.scan_count === 1 ? '' : 's'}.\n` +
        (scannedToday
          ? `You have scanned ${item.first_name} today.`
          : `You have not scanned ${item.first_name} today.`)
    );
  }

  const favoritesCount = rows.filter((r) => favoriteIds.has(r.id)).length;

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
          <Text style={[styles.tabText, viewMode === 'all' && styles.tabTextActive]}>All ({rows.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, viewMode === 'favorites' && styles.tabActive]}
          onPress={() => setViewMode('favorites')}
        >
          <Text style={[styles.tabText, viewMode === 'favorites' && styles.tabTextActive]}>★ Favorites ({favoritesCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, viewMode === 'requests' && styles.tabActive]}
          onPress={() => setViewMode('requests')}
        >
          <Text style={[styles.tabText, viewMode === 'requests' && styles.tabTextActive]}>Requests ({receivedRequests.length})</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'requests' ? (
        <CachedDataBanner savedAt={requestsCacheSavedAt} />
      ) : (
        <CachedDataBanner savedAt={cacheSavedAt} />
      )}

      {viewMode !== 'requests' && (
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or handle"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}

      {viewMode === 'requests' ? (
        <FlatList
          style={styles.container}
          contentContainerStyle={styles.list}
          data={receivedRequests}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            receivedRequests.length > 0 ? (
              <Text style={styles.requestsSectionTitle}>Needs your response</Text>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No pending requests need your response right now.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.requestRow}>
              <Avatar photoUrl={item.requester.photo_url} name={item.requester.first_name} size={48} />
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.requester.first_name}</Text>
                <Text style={styles.requestMeta}>wants to connect</Text>
              </View>
              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={[styles.requestBtn, styles.requestBtnDecline]}
                  onPress={() => respondToRequest(item.id, false)}
                  disabled={respondingId === item.id}
                >
                  <Text style={styles.requestBtnDeclineText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.requestBtn, styles.requestBtnAccept]}
                  onPress={() => respondToRequest(item.id, true)}
                  disabled={respondingId === item.id}
                >
                  <Text style={styles.requestBtnAcceptText}>
                    {respondingId === item.id ? '...' : 'Accept'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListFooterComponent={
            <>
              <Text style={styles.requestsSectionTitle}>Sent by you</Text>
              {sentRequests.length === 0 ? (
                <Text style={styles.emptyText}>You haven't sent any connection requests yet.</Text>
              ) : (
                sentRequests.map((item) => (
                  <View key={item.id} style={styles.requestRow}>
                    <Avatar photoUrl={item.target.photo_url} name={item.target.first_name} size={48} />
                    <View style={styles.rowText}>
                      <Text style={styles.name}>{item.target.first_name}</Text>
                      <Text style={styles.requestMeta}>{new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                    </View>
                    <Text style={[styles.statusBadge, styles[`statusBadge_${item.status}`]]}>
                      {STATUS_LABELS[item.status]}
                    </Text>
                  </View>
                ))
              )}
            </>
          }
        />
      ) : (
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
              <Text style={styles.name}>{item.first_name}</Text>
              {item.profile_socials.length > 0 ? (
                <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
                  {item.profile_socials.map((s) => s.handle).join(' · ')}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity style={styles.scanCheckButton} onPress={() => showScanInfo(item)}>
              <Text style={styles.scanCountText}>{item.scan_count}</Text>
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={item.last_scan_date === todayEasternDate() ? colors.success : colors.textFaint}
              />
            </TouchableOpacity>
            <TouchableOpacity style={styles.starButton} onPress={() => toggleFavorite(item.id)}>
              <Text style={styles.starButtonText}>{favoriteIds.has(item.id) ? '★' : '☆'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
      )}

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
    scanCheckButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4 },
    scanCountText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    starButton: { paddingHorizontal: 8, paddingVertical: 4 },
    starButtonText: { fontSize: 22, color: colors.highlight },
    requestsSectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textFaint,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
      marginTop: 4,
    },
    requestRow: {
      flexDirection: 'row',
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      marginBottom: 10,
      alignItems: 'center',
    },
    requestMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    requestActions: { flexDirection: 'row', gap: 8 },
    requestBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
    requestBtnDecline: { backgroundColor: colors.borderLight },
    requestBtnDeclineText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    requestBtnAccept: { backgroundColor: colors.primary },
    requestBtnAcceptText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    statusBadge: { fontSize: 11, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20, overflow: 'hidden' },
    statusBadge_pending: { backgroundColor: colors.primaryTint, color: colors.primary },
    statusBadge_accepted: { backgroundColor: colors.successTint, color: colors.success },
    statusBadge_declined: { backgroundColor: colors.dangerTint, color: colors.danger },
    statusBadge_expired: { backgroundColor: colors.borderLight, color: colors.textFaint },
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
    detailFavoriteText: { color: colors.highlight, fontSize: 14, fontWeight: '600' },
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
