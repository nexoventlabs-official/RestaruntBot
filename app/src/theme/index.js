// Theme Index - Export all theme values
export { colors, default as Colors } from './colors';
export { typography, default as Typography } from './typography';
export { spacing, default as Spacing } from './spacing';
export { radius, default as Radius } from './radius';
export { shadows, default as Shadows } from './shadows';
export { animations, default as Animations } from './animations';

// Convenience re-export
import { colors } from './colors';
import { typography } from './typography';
import { spacing } from './spacing';
import { radius } from './radius';
import { shadows } from './shadows';
import { animations } from './animations';

export const theme = {
  colors,
  typography,
  spacing,
  radius,
  shadows,
  animations,
};

export default theme;
