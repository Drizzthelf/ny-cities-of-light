import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

// Renders nothing. expo-updates' default behavior downloads a newer OTA
// update in the background on launch but keeps running the bundle that
// was already cached -- the new one only takes effect on the *next* cold
// launch, so a single force-quit + reopen never shows a just-published
// fix. This pre-fetches an available update in the background (mount +
// every foreground) so it's already sitting there ready, cutting that
// down to one relaunch in practice.
//
// Deliberately does NOT call Updates.reloadAsync() here. An earlier
// version did, to apply the update immediately instead of waiting for the
// next cold launch -- but force-reloading the entire native runtime this
// early (concurrent with AuthContext's own async session/profile
// startup) caused a hard crash on the very next relaunch, which
// expo-updates' own crash-recovery then silently reverted, making it look
// like updates simply weren't arriving. Fetching without reloading is the
// well-tested path; the swap itself goes through the normal cold-launch
// mechanism instead of a self-triggered mid-session reload.
export function UpdateChecker() {
  const inFlight = useRef(false);

  useEffect(() => {
    checkAndFetch();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndFetch();
    });
    return () => sub.remove();
  }, []);

  async function checkAndFetch() {
    // No update server in local dev (Metro serves JS directly) — calling
    // these there just throws. Also skip if a previous call is still
    // running, rather than overlapping two fetches.
    if (__DEV__ || !Updates.isEnabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (isAvailable) await Updates.fetchUpdateAsync();
    } catch {
      // Best-effort — offline, update server unreachable, etc. The app
      // keeps running on whatever bundle it already has either way.
    } finally {
      inFlight.current = false;
    }
  }

  return null;
}
