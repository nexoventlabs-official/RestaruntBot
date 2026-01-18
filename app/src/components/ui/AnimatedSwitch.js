import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';
import haptics from '../../utils/haptics';

export const AnimatedSwitch = ({ value, onValueChange, disabled = false, style }) => {
  const { theme } = useTheme();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, theme.animations.spring.gentle);
  }, [value, theme.animations.spring.gentle]);

  const trackStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1],
      [theme.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)', theme.palette.primary[400]]
    );

    return { backgroundColor };
  });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 18 }],
  }));

  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (disabled) return;
        haptics.selection();
        onValueChange?.(!value);
      }}
      style={[style, disabled && { opacity: 0.5 }]}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.thumb, { backgroundColor: theme.colors.surface }, theme.shadows.sm, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 4,
    justifyContent: 'center',
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
});

export default AnimatedSwitch;
