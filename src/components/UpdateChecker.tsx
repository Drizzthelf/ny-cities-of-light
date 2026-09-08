import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

// Renders nothing. Without this, expo-updates' default behavior is to
// silently download a newer OTA update in the background on launch, but
// keep running the bundle that was already cached — the new one only
// takes effect on the *next* cold launch. That means a single force-quit
// + reopen never shows a just-published fix, which reads as "the update
// didn't work" during testing. This checks for and applies a new update
// immediately instead, on mount and every foreground, so one relaunch is
// enough.
export function UpdateChecker() {
  useEffect(() => {
    checkAndApply();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndApply();
    });
    return () => sub.remove();
  }, []);

  return null;
}

async function checkAndApply() {
  // No update server in local dev (Metro serves JS directly) — calling
  // these there just throws.
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // Best-effort — offline, update server unreachable, etc. The app
    // keeps running on whatever bundle it already has either way.
  }
}
