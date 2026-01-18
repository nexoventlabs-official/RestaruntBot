import React, { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import haptics from '../../utils/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const PremiumButton = ({
  title,
  onPress,
  icon,
  iconPosition = 'left',
  variant = 'solid', // solid | outline | ghost
  color = 'primary', // primary | success | danger
  size = 'md', // sm | md | lg
  fullWidth = true,
  loading = false,
  disabled = false,
  style,
  textStyle,
  haptic = 'medium', // light | medium | heavy | selection | none
}) => {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const palette = theme.palette;

  const sizes = useMemo(
    () => ({
      sm: { height: 40, paddingHorizontal: 14, fontSize: theme.typography.label.large.fontSize },
      md: { height: 48, paddingHorizontal: 18, fontSize: theme.typography.title.medium.fontSize },
      lg: { height: 56, paddingHorizontal: 22, fontSize: theme.typography.title.large.fontSize },
    }),
    [theme.typography]
  );

  const semantic = useMemo(() => {
    if (color === 'success') return { solid: ['#22C55E', '#16A34A'], tint: '#22C55E' };
    if (color === 'danger') return { solid: ['#EF4444', '#DC2626'], tint: '#EF4444' };
    return { solid: [palette.primary[400], palette.primary[500]], tint: palette.primary[400] };
  }, [color, palette.primary]);

  const containerStyle = useMemo(() => {
    const base = {
      height: sizes[size].height,
      paddingHorizontal: sizes[size].paddingHorizontal,
      borderRadius: theme.radius.lg,
    };

    if (variant === 'outline') {
      return {
        ...base,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: semantic.tint,
      };
    }

    if (variant === 'ghost') {
      return {
        ...base,
        backgroundColor: 'transparent',
      };
    }

    return base;
  }, [sizes, size, theme.radius.lg, variant, semantic.tint]);

  const labelColor = useMemo(() => {
    if (variant === 'solid') return '#fff';
    return semantic.tint;
  }, [variant, semantic.tint]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, theme.animations.spring.gentle);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, theme.animations.spring.gentle);
  };

  const invokeHaptic = () => {
    if (haptic === 'none') return;
    const fn = haptics[haptic];
    if (typeof fn === 'function') fn();
  };

  const content = (
    <View style={styles.content}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {icon && iconPosition === 'left' ? <View style={styles.iconLeft}>{icon}</View> : null}
          <Text style={[styles.text, { color: labelColor, fontSize: sizes[size].fontSize }, textStyle]} numberOfLines={1}>
            {title}
          </Text>
          {icon && iconPosition === 'right' ? <View style={styles.iconRight}>{icon}</View> : null}
        </>
      )}
    </View>
  );

  return (
    <AnimatedPressable
      disabled={disabled || loading}
      onPress={() => {
        invokeHaptic();
        onPress?.();
      }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, fullWidth && styles.fullWidth, disabled && styles.disabled, style]}
      android_ripple={
        variant === 'solid'
          ? { color: 'rgba(255,255,255,0.18)' }
          : { color: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }
      }
    >
      {variant === 'solid' ? (
        <LinearGradient
          colors={disabled ? ['#9CA3AF', '#9CA3AF'] : semantic.solid}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.solid, containerStyle]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.nonSolid, containerStyle]}>{content}</View>
      )}
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.6 },
  solid: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: Platform.OS === 'android' ? 'hidden' : 'visible',
  },
  nonSolid: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: Platform.OS === 'android' ? 'hidden' : 'visible',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  iconLeft: { marginRight: 8 },
  iconRight: { marginLeft: 8 },
});

export default PremiumButton;
