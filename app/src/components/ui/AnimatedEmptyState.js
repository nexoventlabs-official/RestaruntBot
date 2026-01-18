import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { useTheme } from '../../context/ThemeContext';

export const AnimatedEmptyState = ({
  title = 'Nothing here yet',
  subtitle,
  icon = 'inbox-outline',
  lottieSource,
  action,
}) => {
  const { theme } = useTheme();

  return (
    <Animated.View entering={FadeInDown.duration(350)} style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: theme.colors.surfaceSecondary || theme.colors.surface }]}>
        {lottieSource ? (
          <LottieView source={lottieSource} autoPlay loop style={styles.lottie} />
        ) : (
          <Ionicons name={icon} size={42} color={theme.colors.text.tertiary} />
        )}
      </View>

      <Text style={[styles.title, { color: theme.colors.text.primary }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.colors.text.secondary }]}>{subtitle}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  iconWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  lottie: {
    width: 92,
    height: 92,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  action: {
    marginTop: 16,
  },
});

export default AnimatedEmptyState;
