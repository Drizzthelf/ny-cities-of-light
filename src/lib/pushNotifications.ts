import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Best-effort, additive layer on top of the in-app raffle-win modal and
// double-points banner — a user who denies permission, or is on a
// simulator, just doesn't get pushes; nothing else about the app depends
// on this succeeding.
export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!Device.isDevice) return;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    // onConflict: 'token', not 'user_id,token' -- a push token identifies
    // this physical device/install, not an account. Conflicting on the
    // pair let the same device accumulate one stale row per account it
    // had ever signed into (nobody deleted the old one), so a single
    // device could receive the same push several times over. Conflicting
    // on token alone means signing into a different account on this
    // device reassigns the existing row instead of adding a new one.
    await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token, platform: Platform.OS }, { onConflict: 'token' });
  } catch {
    // Token fetch/upsert failing shouldn't surface anywhere in the UI —
    // the app is fully usable without push.
  }
}

// Best-effort cleanup so a signed-out device stops being addressable by
// its previous account's pushes until someone registers on it again.
// Must run before the Supabase session is cleared -- the delete is RLS-
// scoped to auth.uid() = user_id, so it silently deletes nothing once
// signed out.
export async function unregisterPushNotifications(): Promise<void> {
  if (!Device.isDevice) return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Best-effort — a leftover token row just means this device could get
    // a stray push meant for whoever was last signed in on it.
  }
}
