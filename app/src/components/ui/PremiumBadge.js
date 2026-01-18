import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';

export const PremiumBadge = ({
  label,
  color,
  size = 'md',
  style,
  animated = true,
}) => {
  const { theme } = useTheme();
  const tint = color || theme.palette.primary[400];

  const sizes = {
    sm: { px: 8, py: 4, text: theme.typography.label.small.fontSize },
    md: { px: 10, py: 6, text: theme.typography.label.medium.fontSize },
    lg: { px: 12, py: 8, text: theme.typography.label.large.fontSize },
  };

  const s = sizes[size] || sizes.md;
  const Comp = animated ? Animated.View : View;
  const compProps = animated ? { entering: FadeIn.duration(180) } : {};

  return (
    <Comp
      {...compProps}
      style={[styles.badge, { backgroundColor: tint + '18', paddingHorizontal: s.px, paddingVertical: s.py }, style]}
    >
      <Text style={[styles.text, { color: tint, fontSize: s.text }]}>{label}</Text>
    </Comp>
  );
};

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '800',
  },
});

export default PremiumBadge;
