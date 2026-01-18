import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

// Lightweight animated counter (no dependencies) to keep 60fps on low-end devices.
export const AnimatedCounter = ({
  value,
  duration = 900,
  format = (n) => String(Math.round(n)),
  style,
}) => {
  const [display, setDisplay] = useState(typeof value === 'number' ? value : Number(value || 0));

  useEffect(() => {
    const to = typeof value === 'number' ? value : Number(value || 0);
    const from = display;
    const start = Date.now();

    let raf;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const next = from + (to - from) * t;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <Text style={style}>{format(display)}</Text>;
};

export default AnimatedCounter;
