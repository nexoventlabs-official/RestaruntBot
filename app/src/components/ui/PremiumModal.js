import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../context/ThemeContext';

export const PremiumModal = ({ visible, onClose, children, blurBackdrop = true }) => {
  const { theme } = useTheme();
  const scale = useSharedValue(0.96);

  useEffect(() => {
    if (visible) {
      scale.value = withSpring(1, theme.animations.spring.gentle);
    } else {
      scale.value = 0.96;
    }
  }, [visible, theme.animations.spring.gentle]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          {blurBackdrop ? (
            <BlurView
              intensity={theme.isDark ? 35 : 45}
              tint={theme.isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.xl,
              borderColor: theme.colors.borderLight,
              ...theme.shadows.lg,
            },
            animatedStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    borderWidth: 1,
    padding: 16,
  },
});

export default PremiumModal;
