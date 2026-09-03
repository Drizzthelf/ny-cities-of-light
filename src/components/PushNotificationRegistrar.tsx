import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { registerForPushNotifications } from '../lib/pushNotifications';

// Renders nothing — mounted alongside IncomingConnectionRequestListener /
// RaffleWinListener in RootNavigator. Registers on mount and again on
// every foreground, since the Expo push token can rotate (reinstall, OS
// update) and this is the only place that's guaranteed to run often
// enough to catch that without asking the user to do anything.
export function PushNotificationRegistrar() {
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile) return;
    registerForPushNotifications(profile.id);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') registerForPushNotifications(profile.id);
    });
    return () => sub.remove();
  }, [profile?.id]);

  return null;
}
