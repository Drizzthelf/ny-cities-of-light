import { supabase } from './supabase';
import { writeCache } from './offlineCache';
import type { Announcement, ConnectionRequest, Event, LeaderboardRow, Profile } from '../types/database';

// Proactively loads and caches each cached page's data once at startup
// (see InitialDataPrefetcher.tsx), independent of whether the user has
// actually visited that tab yet — otherwise a tab nobody's opened this
// session has nothing cached at all, so going offline before ever
// visiting it shows a blank/empty screen instead of a "showing saved data
// from X ago" snapshot. Deliberately mirrors each screen's own load()
// query + transform + writeCache exactly (same cache key, same shape) —
// duplicated rather than shared, so this can't accidentally change what a
// screen renders while mounted; it only ever primes the cache a screen
// reads from before its own live fetch lands. Excludes Admin and Raffle on
// purpose, same reasoning as offlineCache.ts: stale data there is more
// likely to mislead than help. Leaderboard IS included -- it's a top-10,
// non-personal, hourly-cadence snapshot already cached by LeaderboardScreen
// itself, same low-risk shape as the other four.

const CACHE_SHARED = 'shared';

type HomeCounts = { scanCount: number; checkinCount: number; points: number };

async function prefetchHome(userId: string) {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('scan_count, event_count, points')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return;
  await writeCache<HomeCounts>('home-counts', userId, {
    scanCount: data.scan_count,
    checkinCount: data.event_count,
    points: data.points,
  });
}

type Section = { title: string; data: Event[] };

function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

async function prefetchSchedule() {
  const { data, error } = await supabase.from('events').select('*').order('start_time', { ascending: true });
  if (error || !data) return;
  const grouped: Record<string, Event[]> = {};
  for (const event of data as Event[]) {
    const day = dateKey(event.start_time);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(event);
  }
  const sections = Object.entries(grouped).map(([title, data]) => ({ title, data }));
  await writeCache<Section[]>('schedule-events', CACHE_SHARED, sections);
}

type ContactRow = Profile & { scanned_at: string; scan_count: number; last_scan_date: string };
type ContactsCache = { rows: ContactRow[]; favoriteIds: string[] };

async function prefetchContacts(userId: string) {
  const [{ data: scanData, error: scanError }, { data: favData }] = await Promise.all([
    supabase
      .from('scans')
      .select('created_at, scan_date, scanned:profiles!scans_scanned_id_fkey(*, profile_socials(*))')
      .eq('scanner_id', userId)
      .order('created_at', { ascending: false }),
    supabase.from('favorites').select('contact_id').eq('user_id', userId),
  ]);
  if (scanError || !scanData) return;

  const byContact = new Map<string, ContactRow>();
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
  const rows = [...byContact.values()].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
  const favoriteIds = (favData ?? []).map((f: any) => f.contact_id as string);
  await writeCache<ContactsCache>('contacts', userId, { rows, favoriteIds });
}

type SentRow = ConnectionRequest & { target: Profile };
type ReceivedRow = ConnectionRequest & { requester: Profile };
type RequestsCache = { sent: SentRow[]; received: ReceivedRow[] };

async function prefetchConnectionRequests(userId: string) {
  const [{ data: sent, error: sentError }, { data: received, error: receivedError }] = await Promise.all([
    supabase
      .from('connection_requests')
      .select('*, target:profiles!connection_requests_target_id_fkey(*, profile_socials(*))')
      .eq('requester_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('connection_requests')
      .select('*, requester:profiles!connection_requests_requester_id_fkey(*, profile_socials(*))')
      .eq('target_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ]);
  if (sentError || receivedError || !sent || !received) return;
  await writeCache<RequestsCache>('connection-requests', userId, {
    sent: sent as SentRow[],
    received: received as ReceivedRow[],
  });
}

type AnnouncementRow = Announcement & { admin: { first_name: string } | null };

async function prefetchAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, admin:profiles!announcements_admin_id_fkey(first_name)')
    .order('created_at', { ascending: false });
  if (error || !data) return;
  await writeCache<AnnouncementRow[]>('announcements-feed', CACHE_SHARED, data as AnnouncementRow[]);
}

async function prefetchLeaderboard() {
  const { data, error } = await supabase.from('leaderboard').select('*').limit(10);
  if (error || !data) return;
  await writeCache<LeaderboardRow[]>('leaderboard', CACHE_SHARED, data as LeaderboardRow[]);
}

export async function prefetchAll(userId: string): Promise<void> {
  await Promise.all([
    prefetchHome(userId),
    prefetchSchedule(),
    prefetchContacts(userId),
    prefetchConnectionRequests(userId),
    prefetchAnnouncements(),
    prefetchLeaderboard(),
  ]);
}
