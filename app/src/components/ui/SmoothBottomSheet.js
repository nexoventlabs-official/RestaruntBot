import React, { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../context/ThemeContext';

const clamp = (value, lowerBound, upperBound) => {
  'worklet';
  return Math.min(Math.max(value, lowerBound), upperBound);
};

export const SmoothBottomSheet = ({
  visible,
  onClose,
  children,
  height = 520,
  blurBackdrop = true,
}) => {
  const { theme } = useTheme();
  const translateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, theme.animations.spring.snappy);
    } else {
      translateY.value = withTiming(height, { duration: theme.animations.duration.md });
    }
  }, [visible, height, theme.animations]);

  const backdropStyle = useAnimatedStyle(() => {
    const opacity = interpolate(translateY.value, [0, height], [1, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const gesture = useMemo(() => {
    const startY = { value: 0 };

    return Gesture.Pan()
      .onBegin(() => {
        startY.value = translateY.value;
      })
      .onUpdate((e) => {
        translateY.value = clamp(startY.value + e.translationY, 0, height);
      })
      .onEnd(() => {
        if (translateY.value > height * 0.25) {
          translateY.value = withTiming(height, { duration: theme.animations.duration.md }, (finished) => {
            if (finished && onClose) {
              runOnJS(onClose)();
            }
          });
        } else {
          translateY.value = withSpring(0, theme.animations.spring.snappy);
        }
      });
  }, [height, onClose, theme.animations, translateY]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          {blurBackdrop ? (
            <BlurView
              intensity={theme.isDark ? 30 : 40}
              tint={theme.isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </Animated.View>

        <GestureDetector gesture={gesture}>
          <Animated.View
            style={[
              styles.sheet,
              {
                height,
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: theme.radius.bottomSheet,
                borderTopRightRadius: theme.radius.bottomSheet,
              },
              sheetStyle,
            ]}
          >
            <View style={[styles.handle, { backgroundColor: theme.colors.borderLight }]} />
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    marginBottom: 10,
    opacity: 0.8,
  },
});

export default SmoothBottomSheet;
