import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { prefetchAll } from '../lib/prefetch';

// Renders nothing. Runs once per sign-in, right after the profile becomes
// available, so every cached page (Home/Schedule/Contacts/Requests/
// Updates) has at least one snapshot on disk even if the user never
// navigates to it this session -- without this, a tab nobody's opened
// yet has nothing cached, so going offline before ever visiting it shows
// a blank screen instead of a "showing saved data from X ago" one.
export function InitialDataPrefetcher() {
  const { profile } = useAuth();
  const ranForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    if (ranForRef.current === profile.id) return;
    ranForRef.current = profile.id;
    prefetchAll(profile.id).catch(() => {
      // Best-effort -- each screen still fetches live on its own mount.
    });
  }, [profile]);

  return null;
}
