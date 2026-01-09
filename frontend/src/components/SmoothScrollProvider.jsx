import { useEffect, useRef, createContext, useContext } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const SmoothScrollContext = createContext(null);

export function useLenis() {
  return useContext(SmoothScrollContext);
}

export default function SmoothScrollProvider({ children }) {
  const lenisRef = useRef(null);

  useEffect(() => {
    // Custom easing function for ultra-smooth deceleration
    // This prevents sudden stops by using a more gradual ease-out curve
    const smoothEasing = (t) => {
      // Custom bezier-like easing for buttery smooth scrolling
      // Slower deceleration at the end prevents sudden stops
      return 1 - Math.pow(1 - t, 4);
    };

    // Initialize Lenis with optimized settings for smooth scrolling
    const lenis = new Lenis({
      duration: 1.4, // Slightly longer duration for smoother feel
      easing: smoothEasing,
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 0.8, // Reduced for smoother wheel scrolling
      touchMultiplier: 1.5, // Balanced touch sensitivity
      infinite: false,
      autoResize: true,
      lerp: 0.08, // Lower lerp value = smoother interpolation (prevents sudden stops)
      syncTouch: true, // Sync touch events for consistent behavior
      syncTouchLerp: 0.06, // Even smoother touch scrolling
    });

    lenisRef.current = lenis;
    window.lenis = lenis;

    // Sync Lenis scrolling with GSAP ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);

    // Use GSAP's ticker for the smoothest possible animation loop
    // Running at 60fps for consistent smooth scrolling
    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });

    // Enable lag smoothing with gentle values for smoother experience
    gsap.ticker.lagSmoothing(500, 33);

    // Refresh ScrollTrigger on resize with debounce
    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        ScrollTrigger.refresh();
        lenis.resize();
      }, 150);
    };

    window.addEventListener('resize', handleResize);

    // Handle visibility change to prevent scroll issues when tab is inactive
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lenis.stop();
      } else {
        lenis.start();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      gsap.ticker.remove(lenis.raf);
      lenis.destroy();
      window.lenis = null;
      lenisRef.current = null;
    };
  }, []);

  return (
    <SmoothScrollContext.Provider value={lenisRef}>
      {children}
    </SmoothScrollContext.Provider>
  );
}
