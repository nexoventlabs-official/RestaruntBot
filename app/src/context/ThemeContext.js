import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, UIManager, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colors, typography, spacing, radius, shadows, animations } from '../theme';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const systemScheme = useColorScheme();
  const [isDark, setIsDark] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const saved = await SecureStore.getItemAsync('theme');
      if (saved) {
        setIsDark(saved === 'dark');
      } else {
        setIsDark(systemScheme === 'dark');
      }
    } catch {
      setIsDark(systemScheme === 'dark');
    } finally {
      setIsLoaded(true);
    }
  };

  const animateThemeChange = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const toggleTheme = async () => {
    const newValue = !isDark;
    animateThemeChange();
    setIsDark(newValue);

    try {
      await SecureStore.setItemAsync('theme', newValue ? 'dark' : 'light');
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  const setTheme = async (mode) => {
    const newValue = mode === 'dark';
    animateThemeChange();
    setIsDark(newValue);

    try {
      await SecureStore.setItemAsync('theme', mode);
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  const theme = useMemo(
    () => ({
      isDark,
      mode: isDark ? 'dark' : 'light',
      colors: isDark ? colors.dark : colors.light,
      palette: colors,
      typography,
      spacing,
      radius,
      shadows,
      animations,
    }),
    [isDark]
  );

  const value = useMemo(
    () => ({
      theme,
      isDark,
      toggleTheme,
      setTheme,
      isLoaded,
    }),
    [theme, isDark, isLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeContext;
