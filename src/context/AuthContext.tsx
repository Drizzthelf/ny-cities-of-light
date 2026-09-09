import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearAllCaches, readCache, writeCache } from '../lib/offlineCache';
import { clearAllQueues } from '../lib/offlineQueue';
import { withTimeout } from '../lib/withRetry';
import type { Profile } from '../types/database';

// Bounds how long startup/resume will wait on getSession + loadProfile
// before giving up and falling back to cache (or, for getSession, just
// clearing `loading` with whatever's already in state). Without this, a
// genuinely offline device could leave loading stuck true forever instead
// of landing on MainTabs with the last cached profile -- the same
// "hangs, doesn't just error" failure ScannerScreen.tsx's SEND_TIMEOUT_MS
// fixes for sending a request.
const AUTH_TIMEOUT_MS = 8 * 1000;

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  // Re-runs the same getSession + loadProfile sequence as the initial
  // mount — used by RootNavigator's "Attempting to connect" screen's Retry
  // button when startup is taking a while (see STARTUP_TIMEOUT_MS there).
  retryConnection: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  // Registration code verified on the pre-auth screen (see AuthFlow), carried
  // across the auth boundary so ProfileSetupScreen doesn't have to ask for it
  // again. Cleared once consumed. If a session exists but this is null (e.g.
  // the user verified OTP, then force-quit before finishing their profile),
  // ProfileSetupScreen falls back to asking for the code itself.
  pendingRegistrationCode: string | null;
  setPendingRegistrationCode: (code: string | null) => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRegistrationCode, setPendingRegistrationCode] = useState<string | null>(null);

  async function loadProfile(userId: string) {
    const result = await withTimeout(
      () => supabase.from('profiles').select('*, profile_socials(*)').eq('id', userId).maybeSingle(),
      AUTH_TIMEOUT_MS
    );
    if (result === 'timeout' || result.error) {
      // A network/server failure (including a fetch that never resolved at
      // all) looks identical to "no row found" here (both come back as
      // data: null) — without this branch, losing connectivity bounced a
      // fully set-up user straight to the create-profile screen, since
      // RootNavigator treats profile === null as "never finished
      // onboarding." Fall back to the last known-good profile instead; only
      // an actual successful "no such row" result (below) should ever be
      // treated as a genuinely new account.
      const cached = await readCache<Profile>('profile', userId);
      if (cached) setProfile(cached.data);
      return;
    }
    const { data } = result;
    setProfile((data as Profile | null) ?? null);
    if (data) writeCache<Profile>('profile', userId, data as Profile);
  }

  // Pulled out of the mount effect so it can also be called later by the
  // "Attempting to connect" screen's Retry button (RootNavigator.tsx),
  // not just once at startup.
  async function checkInitialSession() {
    setLoading(true);
    const result = await withTimeout(() => supabase.auth.getSession(), AUTH_TIMEOUT_MS);
    if (result === 'timeout') {
      // getSession() reads local storage and should resolve near-instantly
      // even offline, but nothing stops this from hanging the same way the
      // profile fetch below did -- bail rather than leave loading stuck.
      setLoading(false);
      return;
    }
    const { data } = result;
    setSession(data.session);
    if (data.session?.user) await loadProfile(data.session.user.id);
    setLoading(false);
  }

  useEffect(() => {
    checkInitialSession();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next?.user) {
        await loadProfile(next.user.id);
      } else {
        setProfile(null);
      }
    });

    // Supabase's own auto-refresh timer is throttled while the app is
    // backgrounded on iOS/Android. Without this, a session left backgrounded
    // over a multi-day conference can present a stale/expired token on
    // resume. Recommended pattern from Supabase's React Native guide.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id);
  }

  async function signOut() {
    // supabase-js only clears the *local* session after its network call
    // to revoke the session server-side succeeds -- offline, that call
    // fails (or hangs) and the local session is left untouched, silently
    // leaving the user signed in. Race it, and on failure/timeout force the
    // local sign-out ourselves: remove the same storage key gotrue-js would
    // have removed had the network call gone through, then update state
    // directly since the SIGNED_OUT event never fires in that case.
    const result = await withTimeout(() => supabase.auth.signOut(), AUTH_TIMEOUT_MS);
    if (result === 'timeout' || result.error) {
      const storageKey = (supabase.auth as unknown as { storageKey?: string }).storageKey;
      if (storageKey) await AsyncStorage.removeItem(storageKey);
      setSession(null);
      setProfile(null);
    }
    setPendingRegistrationCode(null);
    // So a different account signing in on this same device afterward can
    // never see this account's cached Home/Schedule/Contacts/Announcements
    // data, not even momentarily before a fresh fetch lands.
    await clearAllCaches();
    await clearAllQueues();
  }

  async function deleteAccount(): Promise<{ error: string | null }> {
    const { data, error } = await supabase.functions.invoke('delete-account');
    if (error) {
      return { error: error.message };
    }
    if (data?.error) {
      return { error: data.error };
    }
    // The Edge Function already deleted the underlying auth.users row —
    // this just clears the now-orphaned local session/token immediately
    // instead of waiting for it to fail naturally on the next API call.
    await supabase.auth.signOut();
    await clearAllCaches();
    await clearAllQueues();
    return { error: null };
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        refreshProfile,
        retryConnection: checkInitialSession,
        signOut,
        deleteAccount,
        pendingRegistrationCode,
        setPendingRegistrationCode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
