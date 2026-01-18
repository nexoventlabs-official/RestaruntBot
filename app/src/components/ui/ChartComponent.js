import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Path } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';

// Minimal premium chart (line) using react-native-svg.
// data: number[]
export const ChartComponent = ({
  data = [],
  width = 320,
  height = 120,
  strokeWidth = 3,
  style,
  color,
}) => {
  const { theme } = useTheme();

  const tint = color || theme.palette.primary[400];

  const path = useMemo(() => {
    if (!data.length) return '';
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    const stepX = width / Math.max(1, data.length - 1);

    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }, [data, width, height]);

  if (!path) return <View style={[styles.empty, { width, height }, style]} />;

  return (
    <View style={style}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgLinearGradient id="chartStroke" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={tint} stopOpacity="0.95" />
            <Stop offset="1" stopColor={tint} stopOpacity="0.55" />
          </SvgLinearGradient>
        </Defs>
        <Path d={path} fill="none" stroke="url(#chartStroke)" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  empty: {
    borderRadius: 12,
    opacity: 0.3,
  },
});

export default ChartComponent;
