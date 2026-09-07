import AsyncStorage from '@react-native-async-storage/async-storage';

// Outbox for connection requests that couldn't be sent live (see
// ScannerScreen.tsx's 10-second race in handleSendRequest) — persisted so a
// scan made while offline survives an app restart and still gets sent once
// the device reconnects. Namespaced per user, like offlineCache.ts, and
// cleared on sign-out for the same reason (see clearAllQueues below and
// AuthContext.tsx).
const PREFIX = 'outbox:connection-requests:';

export type QueuedRequest = { targetId: string; targetName: string; queuedAt: number };

async function readQueue(userId: string): Promise<QueuedRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(userId: string, queue: QueuedRequest[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${PREFIX}${userId}`, JSON.stringify(queue));
  } catch {
    // Best-effort — a queue write failing shouldn't surface anywhere in the UI.
  }
}

// Returns false without changing anything if this target is already
// queued — the caller (ScannerScreen) uses that to show "already queued"
// instead of silently creating a second entry when the same person is
// scanned twice while offline.
export async function enqueueRequest(userId: string, targetId: string, targetName: string): Promise<boolean> {
  const queue = await readQueue(userId);
  if (queue.some((q) => q.targetId === targetId)) return false;
  queue.push({ targetId, targetName, queuedAt: Date.now() });
  await writeQueue(userId, queue);
  return true;
}

export async function isQueued(userId: string, targetId: string): Promise<boolean> {
  const queue = await readQueue(userId);
  return queue.some((q) => q.targetId === targetId);
}

export async function listQueue(userId: string): Promise<QueuedRequest[]> {
  return readQueue(userId);
}

export async function removeFromQueue(userId: string, targetId: string): Promise<void> {
  const queue = await readQueue(userId);
  await writeQueue(userId, queue.filter((q) => q.targetId !== targetId));
}

// Called on sign-out / account deletion, alongside clearAllCaches() —
// otherwise a different account signing in on the same device could end up
// flushing a stranger's still-queued requests under their own session.
export async function clearAllQueues(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const queueKeys = keys.filter((k) => k.startsWith(PREFIX));
    if (queueKeys.length) await AsyncStorage.multiRemove(queueKeys);
  } catch {
    // Best-effort.
  }
}
