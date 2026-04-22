import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { AuthFlow } from '../screens/AuthFlow';
import { ProfileSetupScreen } from '../screens/ProfileSetupScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { AnnouncementsScreen } from '../screens/AnnouncementsScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { NavigateScreen } from '../screens/NavigateScreen';
import { ServiceScreen } from '../screens/ServiceScreen';
import { AdminScreen } from '../screens/AdminScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ScheduleStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ScheduleMain" component={ScheduleScreen} options={{ title: 'Conference Schedule' }} />
      <Stack.Screen name="Venues" component={NavigateScreen} options={{ title: 'Venues' }} />
    </Stack.Navigator>
  );
}

function QRMeetupStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="QRHome" options={{ headerShown: false }}>
        {({ navigation }) => (
          <HomeScreen onEditProfile={() => navigation.navigate('EditProfile')} />
        )}
      </Stack.Screen>
      <Stack.Screen name="EditProfile" options={{ title: 'Edit profile' }}>
        {() => <ProfileSetupScreen mode="edit" />}
      </Stack.Screen>
      <Stack.Screen name="Scan" component={ScannerScreen} options={{ title: 'Scan QR' }} />
      <Stack.Screen name="Contacts" component={ContactsScreen} options={{ title: 'My Contacts' }} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Leaderboard' }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  const { profile } = useAuth();
  return (
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen
        name="Updates"
        component={AnnouncementsScreen}
        options={{ tabBarLabel: 'Updates', headerShown: false }}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleStack}
        options={{ headerShown: false, tabBarLabel: 'Schedule' }}
      />
      <Tab.Screen
        name="QRMeetup"
        component={QRMeetupStack}
        options={{ headerShown: false, tabBarLabel: 'QR Meetup' }}
      />
      <Tab.Screen
        name="Help"
        component={ServiceScreen}
        options={{ tabBarLabel: 'Help', title: 'Ask the Team' }}
      />
      {profile?.is_admin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{ tabBarLabel: 'Admin', title: 'Admin' }}
        />
      )}
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {!session ? (
        <AuthFlow />
      ) : !profile ? (
        <ProfileSetupScreen mode="create" />
      ) : (
        <MainTabs />
      )}
    </NavigationContainer>
  );
}
