import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

export const AnimatedTabBar = ({ state, descriptors, navigation }) => {
  const { theme } = useTheme();

  return (
    <View style={styles.wrapper}>
      <View style={[styles.container, { borderRadius: 28, borderColor: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }]}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.surface }]} />
        )}

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const icon = options.tabBarIcon;

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.tab}>
              {typeof icon === 'function' ? (
                icon({
                  focused: isFocused,
                  color: isFocused ? theme.palette.primary[400] : theme.colors.text.tertiary,
                  size: 24,
                })
              ) : (
                <Ionicons
                  name={isFocused ? 'ellipse' : 'ellipse-outline'}
                  size={22}
                  color={isFocused ? theme.palette.primary[400] : theme.colors.text.tertiary}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.OS === 'ios' ? 26 : 12,
  },
  container: {
    height: Platform.OS === 'ios' ? 74 : 64,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AnimatedTabBar;
