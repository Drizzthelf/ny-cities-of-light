import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearAllCaches, readCache, writeCache } from '../lib/offlineCache';
import { clearAllQueues } from '../lib/offlineQueue';
import type { Profile } from '../types/database';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
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
    const { data, error } = await supabase
      .from('profiles')
      .select('*, profile_socials(*)')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      // A network/server failure looks identical to "no row found" here
      // (both come back as data: null) — without this branch, losing
      // connectivity bounced a fully set-up user straight to the
      // create-profile screen, since RootNavigator treats profile === null
      // as "never finished onboarding." Fall back to the last known-good
      // profile instead; only an actual successful "no such row" result
      // (below) should ever be treated as a genuinely new account.
      const cached = await readCache<Profile>('profile', userId);
      if (cached) setProfile(cached.data);
      return;
    }
    setProfile((data as Profile | null) ?? null);
    if (data) writeCache<Profile>('profile', userId, data as Profile);
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });

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
      mounted = false;
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id);
  }

  async function signOut() {
    await supabase.auth.signOut();
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
