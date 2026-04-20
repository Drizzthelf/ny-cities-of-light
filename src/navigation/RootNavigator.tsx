import React, { useState } from 'react';
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
import { AdminScreen } from '../screens/AdminScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="HomeMain"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <HomeScreen onEditProfile={() => navigation.navigate('EditProfile')} />
        )}
      </Stack.Screen>
      <Stack.Screen name="EditProfile" options={{ title: 'Edit profile' }}>
        {() => <ProfileSetupScreen mode="edit" />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function MainTabs() {
  const { profile } = useAuth();
  return (
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{ headerShown: false, tabBarLabel: 'My QR' }}
      />
      <Tab.Screen
        name="Scan"
        component={ScannerScreen}
        options={{ tabBarLabel: 'Scan' }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{ tabBarLabel: 'Contacts' }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ tabBarLabel: 'Leaders' }}
      />
      {profile?.is_admin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{ tabBarLabel: 'Admin' }}
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
