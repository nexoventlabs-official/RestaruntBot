import React from 'react';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

// Simple wrapper for consistent screen/content transitions.
export const SmoothTransition = ({ children, style, entering, exiting }) => {
  return (
    <Animated.View
      entering={entering || FadeIn.duration(220)}
      exiting={exiting || FadeOut.duration(180)}
      style={style}
    >
      {children}
    </Animated.View>
  );
};

export default SmoothTransition;
