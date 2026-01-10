import React, { useRef, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '../../theme';

// Premium Card Variants
const CARD_VARIANTS = {
  default: 'default',
  glass: 'glass',
  gradient: 'gradient',
  neumorphic: 'neumorphic',
  outlined: 'outlined',
  elevated: 'elevated',
  frosted: 'frosted',
  premium: 'premium',
  minimal: 'minimal',
  accent: 'accent',
};

export const Card = ({
  children,
  style,
  onPress,
  variant = 'default',
  padding = true,
  animated = false,
  animationDelay = 0,
  glowColor,
  accentColor = colors.zomato.red,
  borderAccent = false,
  cornerIcon,
  cornerIconColor,
  disabled = false,
}) => {
  const scaleAnim = useRef(new Animated.Value(animated ? 0.95 : 1)).current;
  const opacityAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (animated) {
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 400,
          delay: animationDelay,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          delay: animationDelay,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [animated, animationDelay]);

  const getVariantStyles = () => {
    switch (variant) {
      case 'glass':
        return {
          backgroundColor: 'rgba(255, 255, 255, 0.85)',
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.5)',
          ...shadows.lg,
        };
      case 'neumorphic':
        return {
          backgroundColor: colors.light.background,
          ...Platform.select({
            ios: {
              shadowColor: '#BEBEBE',
              shadowOffset: { width: 6, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 10,
            },
            android: { elevation: 8 },
          }),
        };
      case 'outlined':
        return {
          backgroundColor: colors.light.surface,
          borderWidth: 1.5,
          borderColor: borderAccent ? accentColor : colors.light.border,
        };
      case 'elevated':
        return {
          backgroundColor: colors.light.surface,
          ...shadows.xl,
        };
      case 'frosted':
        return {
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.3)',
          ...shadows.md,
        };
      case 'premium':
        return {
          backgroundColor: colors.light.surface,
          borderWidth: 1,
          borderColor: colors.light.borderLight,
          ...shadows.lg,
        };
      case 'minimal':
        return {
          backgroundColor: colors.light.surfaceSecondary,
        };
      case 'accent':
        return {
          backgroundColor: colors.light.surface,
          borderLeftWidth: 4,
          borderLeftColor: accentColor,
          ...shadows.card,
        };
      case 'gradient':
        return {};
      default:
        return {
          backgroundColor: colors.light.surface,
          ...shadows.card,
        };
    }
  };

  const variantStyles = getVariantStyles();

  const cardStyle = [
    styles.card,
    variantStyles,
    padding && styles.padding,
    glowColor && {
      ...Platform.select({
        ios: {
          shadowColor: glowColor,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 12,
        },
        android: { elevation: 8 },
      }),
    },
    disabled && styles.disabled,
    style,
  ];

  const renderContent = () => (
    <>
      {children}
      {cornerIcon && (
        <View style={[styles.cornerIcon, { backgroundColor: (cornerIconColor || accentColor) + '15' }]}>
          <Ionicons name={cornerIcon} size={16} color={cornerIconColor || accentColor} />
        </View>
      )}
    </>
  );

  const renderCard = () => {
    if (variant === 'gradient') {
      return (
        <LinearGradient
          colors={[colors.light.surface, colors.light.surfaceSecondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, padding && styles.padding, shadows.card, style]}
        >
          {renderContent()}
        </LinearGradient>
      );
    }

    return <View style={cardStyle}>{renderContent()}</View>;
  };

  const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

  if (onPress && !disabled) {
    return (
      <AnimatedTouchable
        style={[
          animated && { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
        ]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        {renderCard()}
      </AnimatedTouchable>
    );
  }

  if (animated) {
    return (
      <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }] }}>
        {renderCard()}
      </Animated.View>
    );
  }

  return renderCard();
};

// Premium Stat Card with Icon
export const StatCard = ({
  icon,
  title,
  value,
  subtitle,
  color = colors.zomato.red,
  bgColor,
  trend,
  trendValue,
  onPress,
  animated = true,
  animationDelay = 0,
  variant = 'default',
  size = 'medium',
}) => {
  const scaleAnim = useRef(new Animated.Value(animated ? 0.9 : 1)).current;
  const opacityAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (animated) {
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 400,
          delay: animationDelay,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          delay: animationDelay,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [animated, animationDelay]);

  const iconBgColor = bgColor || color + '15';
  const isCompact = size === 'compact';

  const getTrendIcon = () => {
    if (trend === 'up') return 'trending-up';
    if (trend === 'down') return 'trending-down';
    return 'remove';
  };

  const getTrendColor = () => {
    if (trend === 'up') return colors.success.main;
    if (trend === 'down') return colors.error.main;
    return colors.light.text.tertiary;
  };

  const cardContent = (
    <View style={[styles.statCardInner, isCompact && styles.statCardCompact]}>
      <View style={[
        styles.statIconContainer,
        { backgroundColor: iconBgColor },
        isCompact && styles.statIconCompact,
        variant === 'outlined' && { borderWidth: 1.5, borderColor: color, backgroundColor: 'transparent' },
      ]}>
        <Ionicons name={icon} size={isCompact ? 18 : 22} color={color} />
      </View>
      <View style={styles.statContent}>
        <Text style={[styles.statValue, isCompact && styles.statValueCompact]}>{value}</Text>
        <Text style={[styles.statTitle, isCompact && styles.statTitleCompact]}>{title}</Text>
        {subtitle && <Text style={styles.statSubtitle}>{subtitle}</Text>}
      </View>
      {trend && (
        <View style={[styles.trendBadge, { backgroundColor: getTrendColor() + '15' }]}>
          <Ionicons name={getTrendIcon()} size={12} color={getTrendColor()} />
          {trendValue && <Text style={[styles.trendText, { color: getTrendColor() }]}>{trendValue}</Text>}
        </View>
      )}
    </View>
  );

  const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

  if (onPress) {
    return (
      <AnimatedTouchable
        style={[
          styles.statCard,
          animated && { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
        ]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        {cardContent}
      </AnimatedTouchable>
    );
  }

  return (
    <Animated.View
      style={[
        styles.statCard,
        animated && { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
      ]}
    >
      {cardContent}
    </Animated.View>
  );
};

// Premium Action Card
export const ActionCard = ({
  icon,
  title,
  subtitle,
  color = colors.zomato.red,
  onPress,
  rightIcon = 'chevron-forward',
  badge,
  badgeColor,
  variant = 'default',
  disabled = false,
}) => {
  const getVariantStyle = () => {
    switch (variant) {
      case 'filled':
        return {
          card: { backgroundColor: color },
          icon: { backgroundColor: 'rgba(255,255,255,0.2)' },
          iconColor: '#fff',
          titleColor: '#fff',
          subtitleColor: 'rgba(255,255,255,0.8)',
          arrowBg: 'rgba(255,255,255,0.15)',
          arrowColor: '#fff',
        };
      case 'outlined':
        return {
          card: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color },
          icon: { backgroundColor: color + '15' },
          iconColor: color,
          titleColor: colors.light.text.primary,
          subtitleColor: colors.light.text.secondary,
          arrowBg: color + '10',
          arrowColor: color,
        };
      default:
        return {
          card: { backgroundColor: colors.light.surface },
          icon: { backgroundColor: color + '15' },
          iconColor: color,
          titleColor: colors.light.text.primary,
          subtitleColor: colors.light.text.secondary,
          arrowBg: colors.light.surfaceSecondary,
          arrowColor: colors.light.text.tertiary,
        };
    }
  };

  const variantStyle = getVariantStyle();

  return (
    <TouchableOpacity
      style={[styles.actionCard, variantStyle.card, disabled && styles.disabled]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <View style={[styles.actionIconContainer, variantStyle.icon]}>
        <Ionicons name={icon} size={24} color={variantStyle.iconColor} />
      </View>
      <View style={styles.actionContent}>
        <View style={styles.actionTitleRow}>
          <Text style={[styles.actionTitle, { color: variantStyle.titleColor }]}>{title}</Text>
          {badge && (
            <View style={[styles.actionBadge, { backgroundColor: badgeColor || colors.zomato.red }]}>
              <Text style={styles.actionBadgeText}>{badge}</Text>
            </View>
          )}
        </View>
        {subtitle && <Text style={[styles.actionSubtitle, { color: variantStyle.subtitleColor }]}>{subtitle}</Text>}
      </View>
      <View style={[styles.actionArrow, { backgroundColor: variantStyle.arrowBg }]}>
        <Ionicons name={rightIcon} size={18} color={variantStyle.arrowColor} />
      </View>
    </TouchableOpacity>
  );
};

// Premium Info Card with Gradient
export const InfoCard = ({
  icon,
  title,
  children,
  gradientColors = [colors.primary[50], '#FFF5F5'],
  iconColor = colors.zomato.red,
  variant = 'default',
}) => {
  if (variant === 'solid') {
    return (
      <View style={[styles.infoCard, { backgroundColor: iconColor + '10' }]}>
        <View style={[styles.infoIconContainer, { backgroundColor: iconColor + '15' }]}>
          <Ionicons name={icon} size={24} color={iconColor} />
        </View>
        <View style={styles.infoContent}>
          <Text style={[styles.infoTitle, { color: iconColor }]}>{title}</Text>
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.infoCardWrapper}>
      <LinearGradient colors={gradientColors} style={styles.infoCard}>
        <View style={[styles.infoIconContainer, { backgroundColor: iconColor + '15' }]}>
          <Ionicons name={icon} size={24} color={iconColor} />
        </View>
        <View style={styles.infoContent}>
          <Text style={[styles.infoTitle, { color: iconColor }]}>{title}</Text>
          {children}
        </View>
      </LinearGradient>
    </View>
  );
};

// Premium Feature Card
export const FeatureCard = ({
  icon,
  title,
  description,
  color = colors.zomato.red,
  onPress,
  featured = false,
}) => (
  <TouchableOpacity
    style={[styles.featureCard, featured && styles.featureCardFeatured]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    {featured && (
      <LinearGradient
        colors={[color, color + 'DD']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.featureGradientBg}
      />
    )}
    <View style={[
      styles.featureIconContainer,
      { backgroundColor: featured ? 'rgba(255,255,255,0.2)' : color + '15' },
    ]}>
      <Ionicons name={icon} size={28} color={featured ? '#fff' : color} />
    </View>
    <Text style={[styles.featureTitle, featured && styles.featureTitleFeatured]}>{title}</Text>
    <Text style={[styles.featureDescription, featured && styles.featureDescriptionFeatured]}>{description}</Text>
  </TouchableOpacity>
);

// Premium Metric Card
export const MetricCard = ({
  label,
  value,
  icon,
  color = colors.zomato.red,
  suffix,
  prefix,
  trend,
  trendValue,
  onPress,
}) => {
  const getTrendColor = () => {
    if (trend === 'up') return colors.success.main;
    if (trend === 'down') return colors.error.main;
    return colors.light.text.tertiary;
  };

  return (
    <TouchableOpacity
      style={styles.metricCard}
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress}
    >
      <View style={styles.metricHeader}>
        <View style={[styles.metricIconContainer, { backgroundColor: color + '15' }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        {trend && (
          <View style={[styles.metricTrend, { backgroundColor: getTrendColor() + '15' }]}>
            <Ionicons
              name={trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'remove'}
              size={12}
              color={getTrendColor()}
            />
            {trendValue && <Text style={[styles.metricTrendText, { color: getTrendColor() }]}>{trendValue}</Text>}
          </View>
        )}
      </View>
      <Text style={styles.metricValue}>
        {prefix}<Text style={{ color }}>{value}</Text>{suffix}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </TouchableOpacity>
  );
};

// Import Text from react-native (needed for StatCard, ActionCard, etc.)
import { Text } from 'react-native';

const styles = StyleSheet.create({
  // Base Card
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  padding: {
    padding: spacing.base,
  },
  disabled: {
    opacity: 0.5,
  },
  cornerIcon: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Stat Card
  statCard: {
    flex: 1,
    backgroundColor: colors.light.surface,
    borderRadius: radius.xl,
    padding: spacing.base,
    ...shadows.card,
  },
  statCardInner: {
    flex: 1,
  },
  statCardCompact: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statIconCompact: {
    width: 40,
    height: 40,
    borderRadius: 12,
    marginBottom: 0,
    marginRight: spacing.md,
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.light.text.primary,
    letterSpacing: -0.5,
  },
  statValueCompact: {
    fontSize: 22,
  },
  statTitle: {
    fontSize: 14,
    color: colors.light.text.secondary,
    marginTop: spacing.xs,
    fontWeight: '500',
  },
  statTitleCompact: {
    fontSize: 13,
    marginTop: 2,
  },
  statSubtitle: {
    fontSize: 12,
    color: colors.light.text.tertiary,
    marginTop: 2,
  },
  trendBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 2,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Action Card
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.base,
    ...shadows.sm,
  },
  actionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionContent: {
    flex: 1,
    marginLeft: spacing.md,
  },
  actionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  actionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  actionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  actionArrow: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Info Card
  infoCardWrapper: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.sm,
  },
  infoCard: {
    flexDirection: 'row',
    padding: spacing.base,
    borderRadius: radius.xl,
  },
  infoIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContent: {
    flex: 1,
    marginLeft: spacing.md,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },

  // Feature Card
  featureCard: {
    backgroundColor: colors.light.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    overflow: 'hidden',
    ...shadows.card,
  },
  featureCardFeatured: {
    backgroundColor: 'transparent',
  },
  featureGradientBg: {
    ...StyleSheet.absoluteFillObject,
  },
  featureIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.light.text.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  featureTitleFeatured: {
    color: '#fff',
  },
  featureDescription: {
    fontSize: 13,
    color: colors.light.text.secondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  featureDescriptionFeatured: {
    color: 'rgba(255,255,255,0.85)',
  },

  // Metric Card
  metricCard: {
    backgroundColor: colors.light.surface,
    borderRadius: radius.xl,
    padding: spacing.base,
    ...shadows.card,
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  metricIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 2,
  },
  metricTrendText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.light.text.primary,
    letterSpacing: -0.5,
  },
  metricLabel: {
    fontSize: 13,
    color: colors.light.text.secondary,
    marginTop: spacing.xs,
  },
});

export default Card;
