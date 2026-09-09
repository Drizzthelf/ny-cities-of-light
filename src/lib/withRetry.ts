type Retryable<T> = { data: T; error: { message?: string } | null };

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
};

// Retry only on network/transport failures — never on RLS denials, duplicate
// key conflicts, or validation errors, which retrying would just repeat.
// Exported for src/components/OutboxFlusher.tsx, which needs the same
// distinction: a queued request that gets a real (non-transient) answer
// from the server, success or failure, is done; one that never reached the
// server at all should stay queued for the next attempt.
export function isTransient(error: { message?: string } | null): boolean {
  const message = error?.message ?? '';
  return /network|fetch|timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A fully offline device doesn't always make a Supabase call fail fast —
// sometimes the underlying fetch just hangs with no native-level timeout,
// which defeats withRetry too (it can't retry a call that never resolves
// or rejects). Races the call against a plain timer so a caller always
// gets an answer within `ms`, even if the loser promise keeps running
// unseen in the background. Same technique ScannerScreen.tsx uses inline
// for handleSendRequest; exported here for AuthContext.tsx's startup
// session/profile load, which hit the identical "hangs forever" failure.
export function withTimeout<T>(fn: () => PromiseLike<T>, ms: number): Promise<T | 'timeout'> {
  const timedOut = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms));
  return Promise.race([Promise.resolve(fn()), timedOut]);
}

// Wraps a Supabase call with bounded exponential backoff + jitter, so a
// burst of simultaneous scan-insert/check-in/profile-fetch calls at event
// start degrades gracefully instead of surfacing a raw network error on the
// first hiccup. See docs/production-launch-plan.md §4.
export async function withRetry<T>(
  // Supabase's query builder is PromiseLike (thenable), not a true Promise —
  // accept that wider type so `withRetry(() => supabase.from(...)...)` works
  // without an intermediate `await`/cast at every call site.
  fn: () => PromiseLike<Retryable<T>>,
  { attempts = 3, baseDelayMs = 300 }: RetryOptions = {}
): Promise<Retryable<T>> {
  let last: Retryable<T>;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
    } catch (err) {
      last = { data: null as T, error: { message: err instanceof Error ? err.message : String(err) } };
    }
    if (!last.error || !isTransient(last.error) || i === attempts - 1) {
      return last;
    }
    await sleep(baseDelayMs * 2 ** i + Math.random() * baseDelayMs);
  }
  // Unreachable (loop always returns on its last iteration), but keeps TS happy.
  return last!;
}
