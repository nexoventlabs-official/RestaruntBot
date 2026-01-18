import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../context/ThemeContext';

export const PremiumCard = ({
  children,
  style,
  onPress,
  disabled = false,
  variant = 'glass', // glass | surface
  borderGradient,
  blurIntensity = 40,
  padding = 16,
  elevation = 'md',
}) => {
  const { theme } = useTheme();
  const { colors, radius, shadows } = theme;

  const borderColors = borderGradient || [theme.palette.primary[400] + '55', theme.palette.secondary[400] + '33'];
  const shadowStyle = shadows[elevation] || shadows.md;

  const content = (
    <View style={[styles.outer, shadowStyle, style]}>
      <LinearGradient colors={borderColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gradientBorder, { borderRadius: radius.card }]}>
        {variant === 'glass' ? (
          <BlurView
            intensity={blurIntensity}
            tint={theme.isDark ? 'dark' : 'light'}
            style={[
              styles.inner,
              {
                borderRadius: radius.card - 1,
                padding,
                backgroundColor: theme.isDark ? 'rgba(30,30,30,0.35)' : 'rgba(255,255,255,0.6)',
                borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.25)',
              },
            ]}
          >
            {children}
          </BlurView>
        ) : (
          <View
            style={[
              styles.inner,
              {
                borderRadius: radius.card - 1,
                padding,
                backgroundColor: colors.surface,
                borderColor: colors.borderLight,
              },
            ]}
          >
            {children}
          </View>
        )}
      </LinearGradient>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
      style={({ pressed }) => [pressed && Platform.OS !== 'android' ? { opacity: 0.92 } : null]}
    >
      {content}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  outer: {
    borderRadius: 16,
  },
  gradientBorder: {
    padding: 1,
    borderRadius: 16,
  },
  inner: {
    borderWidth: 1,
    overflow: 'hidden',
  },
});

export default PremiumCard;
