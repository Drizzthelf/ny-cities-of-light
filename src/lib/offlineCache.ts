import AsyncStorage from '@react-native-async-storage/async-storage';

// Last-known-good snapshots for a handful of read-only screens (Home,
// Schedule, Contacts, Announcements), so losing wifi mid-conference shows
// "here's what we knew a few minutes ago" instead of a blank/error screen.
// Deliberately NOT used for: the Admin tab (a moderator acting on a stale
// report/user list is worse than an error), or Raffle/Leaderboard (a stale
// points/ticket total is more likely to actively mislead someone about
// their odds than help them). Writes (scanning, assigning tickets, etc.)
// always require a live connection regardless — this only ever affects
// what's shown while a fresh read is in flight or has failed.
//
// Namespaced per user id and wiped on sign-out (see AuthContext.tsx) so a
// different account signing in on the same device can never see a
// previous account's cached data, even momentarily.
const PREFIX = 'offline-cache:';

type CacheEnvelope<T> = { data: T; savedAt: number };

function isEnvelope<T>(v: unknown): v is CacheEnvelope<T> {
  return !!v && typeof v === 'object' && 'data' in (v as any) && 'savedAt' in (v as any);
}

export async function readCache<T>(key: string, userId: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${userId}:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Defensive: a shape mismatch (e.g. this screen's cached fields changed
    // in a later app version) should be treated as "no cache", never a
    // crash — this is a convenience layer, not a source of truth.
    return isEnvelope<T>(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, userId: string, data: T): Promise<void> {
  try {
    const envelope: CacheEnvelope<T> = { data, savedAt: Date.now() };
    await AsyncStorage.setItem(`${PREFIX}${userId}:${key}`, JSON.stringify(envelope));
  } catch {
    // Best-effort — a cache write failing shouldn't surface anywhere in the UI.
  }
}

// Called on sign-out / account deletion, not per-key — clearing everything
// is simpler to reason about than tracking exactly which keys a session
// touched, and the cost (one extra network fetch per screen after signing
// back in) is negligible.
export async function clearAllCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(PREFIX));
    if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
  } catch {
    // Best-effort.
  }
}
