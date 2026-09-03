// Thin wrapper around Expo's push API, shared by notify-raffle-win and
// notify-double-points. Fire-and-forget by design: push is a best-effort
// channel on top of the in-app notification paths, so a delivery failure
// here should never surface as an error to whatever triggered it (a
// raffle draw, a cron tick).

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo's documented per-request limit

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  const valid = messages.filter((m) => m.to.startsWith('ExponentPushToken['));
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch {
      // Best-effort — a batch failing shouldn't block the rest or bubble up.
    }
  }
}
