import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AuthFlow } from '../screens/AuthFlow';
import { ProfileSetupScreen } from '../screens/ProfileSetupScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { AnnouncementsScreen } from '../screens/AnnouncementsScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { NavigateScreen } from '../screens/NavigateScreen';
import { RaffleScreen } from '../screens/RaffleScreen';
import { CompletedRaffleScreen } from '../screens/CompletedRaffleScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PrivacyPolicyScreen } from '../screens/PrivacyPolicyScreen';
import { IncomingConnectionRequestListener } from '../components/IncomingConnectionRequestListener';
import { RaffleWinListener } from '../components/RaffleWinListener';
import { PushNotificationRegistrar } from '../components/PushNotificationRegistrar';
import { OutboxFlusher } from '../components/OutboxFlusher';
import { ConnectingScreen } from '../components/ConnectingScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// How long the initial getSession + loadProfile startup check (see
// AuthContext.tsx) can run before swapping the plain spinner for the fuller
// "Attempting to connect" screen with a Retry button — matches
// ScannerScreen.tsx's SEND_TIMEOUT_MS.
const STARTUP_TIMEOUT_MS = 5 * 1000;

function ScheduleStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ScheduleMain" component={ScheduleScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Venues" component={NavigateScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function QRMeetupStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="QRHome" component={HomeScreen} options={{ headerShown: false, title: 'QR Home' }} />
      <Stack.Screen name="Scan" component={ScannerScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Contacts" component={ContactsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Raffle" component={RaffleScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CompletedRaffle" component={CompletedRaffleScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ProfileMain" options={{ headerShown: false }}>
        {({ navigation }) => (
          <ProfileScreen
            onViewContacts={() => navigation.navigate('QRMeetup', { screen: 'Contacts' })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="EditProfile" options={{ headerShown: false }}>
        {({ navigation }) => <ProfileSetupScreen mode="edit" onSaved={() => navigation.goBack()} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="SettingsMain" component={SettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  // A thin left border on every tab but the first turns into a divider
  // line between each pair of tabs, without a stray line on the outer
  // edges.
  const dividedTabItem = useMemo(() => ({ borderLeftWidth: 1, borderLeftColor: colors.border }), [colors]);

  return (
    <Tab.Navigator
      initialRouteName="Profile"
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        // panelDark, not colors.text — this bar is deliberately black in
        // both light and dark mode, not "page text color" that happens to
        // be black in light mode.
        tabBarStyle: { backgroundColor: colors.panelDark, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          headerShown: false,
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Updates"
        component={AnnouncementsScreen}
        options={{
          tabBarLabel: 'Updates',
          headerShown: false,
          tabBarItemStyle: dividedTabItem,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'megaphone' : 'megaphone-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="QRMeetup"
        component={QRMeetupStack}
        options={{
          headerShown: false,
          tabBarLabel: 'QR Meetup',
          tabBarItemStyle: dividedTabItem,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'qr-code' : 'qr-code-outline'} size={size} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Cross-tab links (e.g. Profile's "My Contacts" button) push
            // Contacts/Scan/Leaderboard onto this stack. Without this, once
            // pushed, tapping the QR Meetup tab icon leaves you stranded on
            // whatever sub-screen you last visited instead of Home, since
            // React Navigation doesn't reset a tab's stack on tab press by
            // default. preventDefault stops the default tab-press action
            // from also running alongside this navigate — without it the
            // two fought each other and made repeated taps toggle between
            // Home and Contacts instead of settling on Home.
            e.preventDefault();
            navigation.navigate('QRMeetup', { screen: 'QRHome' });
          },
        })}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleStack}
        options={{
          headerShown: false,
          tabBarLabel: 'Schedule',
          tabBarItemStyle: dividedTabItem,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color} />
          ),
        }}
      />
      {profile?.is_admin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{
            tabBarLabel: 'Admin',
            title: 'Admin',
            headerShown: false,
            tabBarItemStyle: dividedTabItem,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'} size={size} color={color} />
            ),
          }}
        />
      )}
      {/* Always last, admin or not — placed after the conditional Admin
          tab rather than before it so it stays the rightmost tab either
          way. */}
      <Tab.Screen
        name="Settings"
        component={SettingsStack}
        options={{
          headerShown: false,
          tabBarLabel: 'Settings',
          tabBarItemStyle: dividedTabItem,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { session, profile, loading, retryConnection } = useAuth();
  const { colors } = useTheme();
  // Stays false for the normal, fast (<1s) cold start — only flips once
  // `loading` has been stuck true for STARTUP_TIMEOUT_MS, swapping the
  // plain spinner for the fuller "Attempting to connect" screen instead of
  // leaving someone staring at a blank-looking screen with no explanation.
  const [slowStartup, setSlowStartup] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSlowStartup(false);
      return;
    }
    const timer = setTimeout(() => setSlowStartup(true), STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // So any screen transition, default header, or the brief flash behind a
  // modal reflects the current mode's palette instead of React
  // Navigation's stock iOS blue/white — recomputed whenever night mode
  // toggles, not a fixed value.
  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    }),
    [colors]
  );

  if (loading) {
    if (slowStartup) {
      return <ConnectingScreen onRetry={retryConnection} />;
    }
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {!session ? (
        <AuthFlow />
      ) : !profile ? (
        <ProfileSetupScreen mode="create" />
      ) : (
        <>
          <MainTabs />
          <IncomingConnectionRequestListener />
          <RaffleWinListener />
          <PushNotificationRegistrar />
          <OutboxFlusher />
        </>
      )}
    </NavigationContainer>
  );
}
