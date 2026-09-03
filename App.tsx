import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  PlayfairDisplay_700Bold_Italic,
} from '@expo-google-fonts/playfair-display';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { palettes } from './src/theme';

function AppContent() {
  const { mode, colors } = useTheme();
  return (
    <AuthProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} backgroundColor={colors.background} />
      <RootNavigator />
    </AuthProvider>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ PlayfairDisplay_700Bold_Italic });

  if (!fontsLoaded) {
    // Night mode preference hasn't loaded yet at this point either (it
    // lives inside ThemeProvider, mounted below) — light is the right
    // default for this brief, one-time splash regardless.
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: palettes.light.background }}>
        <ActivityIndicator size="large" color={palettes.light.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
