import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, type ColorScheme, type ThemeMode } from '../theme';

const STORAGE_KEY = 'night-mode';

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ColorScheme;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light');

  // Manual toggle only, per user preference — this deliberately does not
  // read the device's system Dark Mode setting.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'dark') setMode('dark');
    });
  }, []);

  function toggleMode() {
    setMode((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }

  const colors = useMemo(() => palettes[mode], [mode]);
  const value = useMemo(() => ({ mode, colors, toggleMode }), [mode, colors]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
