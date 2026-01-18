import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { useTheme } from '../../context/ThemeContext';

export const AnimatedLoadingState = ({
  size = 'large',
  style,
  lottieSource,
  loop = true,
}) => {
  const { theme } = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={[styles.container, style]}>
      {lottieSource ? (
        <LottieView
          source={lottieSource}
          autoPlay
          loop={loop}
          style={styles.lottie}
        />
      ) : (
        <ActivityIndicator size={size} color={theme.palette.primary[400]} />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottie: {
    width: 120,
    height: 120,
  },
});

export default AnimatedLoadingState;
