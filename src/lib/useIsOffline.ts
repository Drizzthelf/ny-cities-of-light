import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

// Real device connectivity, via the OS — distinct from the app's various
// "that one fetch failed" fallbacks elsewhere (offlineCache.ts,
// offlineQueue.ts), which only ever notice a problem after already trying
// and failing a specific request. This is for a persistent, always-visible
// "you're offline" indicator (see OfflineBanner.tsx), so it needs to reflect
// the OS's own connectivity state directly, not infer it after the fact.
export function useIsOffline(): boolean {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is `null` while NetInfo is still figuring it
      // out (briefly, on every change) — only a confirmed `false` counts,
      // on either field, so the banner doesn't flicker on/off during that
      // brief unknown window.
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return unsubscribe;
  }, []);

  return isOffline;
}
