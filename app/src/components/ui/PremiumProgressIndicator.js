import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const PremiumProgressIndicator = ({
  variant = 'linear', // linear | circular
  progress = 0,
  height = 8,
  size = 44,
  strokeWidth = 6,
  color,
  trackColor,
  style,
}) => {
  const { theme } = useTheme();

  const p = Math.max(0, Math.min(1, progress));
  const tint = color || theme.palette.primary[400];
  const track = trackColor || (theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)');

  if (variant === 'circular') {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    const dashOffset = useSharedValue(circumference);

    useEffect(() => {
      dashOffset.value = withTiming(circumference * (1 - p), { duration: theme.animations.duration.md });
    }, [p, circumference, theme.animations.duration.md]);

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: dashOffset.value,
    }));

    return (
      <View style={[styles.circularWrap, { width: size, height: size }, style]}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={track}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={tint}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="transparent"
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={animatedProps}
            rotation={-90}
            originX={size / 2}
            originY={size / 2}
          />
        </Svg>
      </View>
    );
  }

  return (
    <View style={[styles.linearTrack, { height, backgroundColor: track, borderRadius: height / 2 }, style]}>
      <View style={[styles.linearFill, { width: `${p * 100}%`, backgroundColor: tint, borderRadius: height / 2 }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  linearTrack: {
    width: '100%',
    overflow: 'hidden',
  },
  linearFill: {
    height: '100%',
  },
  circularWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default PremiumProgressIndicator;
