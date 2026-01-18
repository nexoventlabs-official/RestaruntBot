// Animation tokens - Premium Design System
// Central place for timing, easing, and spring presets.

import { Easing } from 'react-native';

export const animations = {
  duration: {
    instant: 0,
    xs: 120,
    sm: 180,
    md: 260,
    lg: 420,
    xl: 650,
  },
  easing: {
    standard: Easing.bezier(0.2, 0, 0, 1),
    emphasized: Easing.bezier(0.2, 0, 0, 0.9),
    decelerate: Easing.bezier(0, 0, 0.2, 1),
    accelerate: Easing.bezier(0.4, 0, 1, 1),
  },
  spring: {
    gentle: { damping: 18, stiffness: 160, mass: 0.9 },
    snappy: { damping: 14, stiffness: 220, mass: 0.9 },
    bouncy: { damping: 12, stiffness: 180, mass: 0.8 },
  },
};

export default animations;
