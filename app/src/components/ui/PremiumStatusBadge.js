import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

const STATUS = {
  pending: { label: 'Pending', icon: 'time-outline' },
  confirmed: { label: 'Confirmed', icon: 'checkmark-circle-outline' },
  preparing: { label: 'Preparing', icon: 'restaurant-outline' },
  ready: { label: 'Ready', icon: 'checkmark-done-outline' },
  out_for_delivery: { label: 'Out for Delivery', icon: 'bicycle-outline' },
  delivered: { label: 'Delivered', icon: 'checkmark-circle' },
  cancelled: { label: 'Cancelled', icon: 'close-circle-outline' },
  refunded: { label: 'Refunded', icon: 'refresh-outline' },
};

export const PremiumStatusBadge = ({ status = 'pending', size = 'md', showIcon = true, pulsing = true }) => {
  const { theme } = useTheme();
  const pulse = useSharedValue(1);

  React.useEffect(() => {
    if (!pulsing) return;
    pulse.value = withRepeat(withSequence(withTiming(1.25, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
  }, [pulsing]);

  const config = useMemo(() => STATUS[status] || STATUS.pending, [status]);
  const color = theme.palette.status?.[status] || theme.palette.primary[400];

  const sizes = {
    sm: { px: 10, py: 4, dot: 6, icon: 12, text: theme.typography.label.small.fontSize },
    md: { px: 12, py: 6, dot: 7, icon: 14, text: theme.typography.label.medium.fontSize },
    lg: { px: 14, py: 8, dot: 8, icon: 16, text: theme.typography.label.large.fontSize },
  };
  const s = sizes[size] || sizes.md;

  const animatedDot = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: pulsing ? 0.55 : 0,
  }));

  return (
    <View style={[styles.badge, { paddingHorizontal: s.px, paddingVertical: s.py, backgroundColor: color + '18' }]}>
      <View style={[styles.dotWrap, { width: s.dot, height: s.dot }]}> 
        <Animated.View style={[styles.dotPulse, { backgroundColor: color, borderRadius: s.dot / 2 }, animatedDot]} />
        <View style={[styles.dot, { backgroundColor: color, borderRadius: s.dot / 2 }]} />
      </View>

      {showIcon ? <Ionicons name={config.icon} size={s.icon} color={color} style={styles.icon} /> : null}
      <Text style={[styles.text, { color, fontSize: s.text }]}>{config.label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
  },
  icon: { marginRight: 6 },
  text: { fontWeight: '700' },
  dotWrap: {
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: '100%',
    height: '100%',
  },
  dotPulse: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
});

export default PremiumStatusBadge;
