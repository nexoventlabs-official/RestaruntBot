import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius, shadows } from '../../theme';

export const Card = ({
  children,
  style,
  onPress,
  variant = 'default', // default, elevated, outlined
  padding = true,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'elevated':
        return { ...shadows.lg, backgroundColor: colors.light.surface };
      case 'outlined':
        return { borderWidth: 1, borderColor: colors.light.border, backgroundColor: colors.light.surface };
      default:
        return { ...shadows.card, backgroundColor: colors.light.surface };
    }
  };

  const variantStyles = getVariantStyles();

  const cardStyle = [
    styles.card,
    variantStyles,
    padding && styles.padding,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.8}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  padding: {
    padding: spacing.base,
  },
});

export default Card;
