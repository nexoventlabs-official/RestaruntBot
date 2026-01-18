import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

export const PremiumInput = ({
  label,
  value,
  onChangeText,
  placeholder,
  leftIcon,
  rightIcon,
  onRightIconPress,
  error,
  success,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  style,
  inputStyle,
  ...rest
}) => {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);

  const floatAnim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(floatAnim, {
      toValue: focused || !!value ? 1 : 0,
      duration: theme.animations.duration.sm,
      useNativeDriver: false,
    }).start();
  }, [focused, value, floatAnim, theme.animations.duration.sm]);

  const borderColor = useMemo(() => {
    if (error) return theme.palette.error.main;
    if (success) return theme.palette.success.main;
    if (focused) return theme.palette.primary[400];
    return theme.colors.border;
  }, [error, success, focused, theme]);

  const labelStyle = {
    transform: [
      {
        translateY: floatAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [14, -8],
        }),
      },
    ],
    fontSize: floatAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [14, 12],
    }),
    color: error
      ? theme.palette.error.main
      : focused
        ? theme.palette.primary[400]
        : theme.colors.text.tertiary,
  };

  return (
    <View style={[styles.wrap, style]}>
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.input,
            borderColor,
          },
        ]}
      >
        {leftIcon ? (
          <View style={styles.leftIcon}>
            <Ionicons name={leftIcon} size={18} color={theme.colors.text.tertiary} />
          </View>
        ) : null}

        {label ? <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text> : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={label ? undefined : placeholder}
          placeholderTextColor={theme.colors.text.tertiary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { color: theme.colors.text.primary }, inputStyle]}
          {...rest}
        />

        {rightIcon ? (
          <Text
            onPress={onRightIconPress}
            suppressHighlighting
            style={styles.rightIcon}
          >
            <Ionicons name={rightIcon} size={18} color={theme.colors.text.tertiary} />
          </Text>
        ) : null}
      </View>

      {error ? <Text style={[styles.helper, { color: theme.palette.error.main }]}>{error}</Text> : null}
      {!error && success ? <Text style={[styles.helper, { color: theme.palette.success.main }]}>{success}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  container: {
    height: 56,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: Platform.OS === 'android' ? 'hidden' : 'visible',
  },
  leftIcon: {
    marginRight: 10,
  },
  rightIcon: {
    marginLeft: 10,
  },
  label: {
    position: 'absolute',
    left: 14,
    top: 10,
    fontWeight: '600',
    paddingHorizontal: 6,
    backgroundColor: 'transparent',
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingTop: 18,
    paddingBottom: 10,
  },
  helper: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
});

export default PremiumInput;
