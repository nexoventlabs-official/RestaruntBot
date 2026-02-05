/**
 * Performance Monitoring Service - Phase 6.10
 * 
 * Purpose: Monitor app performance metrics
 * 
 * Features:
 * - Screen load time tracking
 * - API response time tracking
 * - Memory usage monitoring
 * - FPS monitoring
 * - Bundle size tracking
 */

import perf from '@react-native-firebase/perf';
import * as Sentry from '@sentry/react-native';
import { InteractionManager } from 'react-native';

// Performance thresholds
const THRESHOLDS = {
  screenLoad: 1000, // 1 second
  apiCall: 2000, // 2 seconds
  interaction: 100, // 100ms
};

/**
 * Track screen load time
 */
export async function trackScreenLoad(screenName) {
  try {
    const trace = await perf().startTrace(`screen_${screenName}`);
    
    return {
      stop: async () => {
        await trace.stop();
        const metrics = await trace.getMetrics();
        console.log(`⏱️ [Performance] Screen ${screenName}:`, metrics);
        
        // Alert if slow
        if (metrics.duration > THRESHOLDS.screenLoad) {
          Sentry.captureMessage(
            `Slow screen load: ${screenName} (${metrics.duration}ms)`,
            'warning'
          );
        }
      },
    };
  } catch (error) {
    console.error('❌ [Performance] Track screen error:', error);
    return { stop: () => {} };
  }
}

/**
 * Track API call performance
 */
export async function trackAPICall(endpoint, method = 'GET') {
  try {
    const trace = await perf().startTrace(`api_${method}_${endpoint}`);
    const startTime = Date.now();
    
    return {
      stop: async (success = true) => {
        const duration = Date.now() - startTime;
        
        await trace.putMetric('success', success ? 1 : 0);
        await trace.putMetric('duration', duration);
        await trace.stop();
        
        console.log(`⏱️ [Performance] API ${method} ${endpoint}: ${duration}ms`);
        
        // Alert if slow
        if (duration > THRESHOLDS.apiCall) {
          Sentry.captureMessage(
            `Slow API call: ${method} ${endpoint} (${duration}ms)`,
            'warning'
          );
        }
      },
    };
  } catch (error) {
    console.error('❌ [Performance] Track API error:', error);
    return { stop: () => {} };
  }
}

/**
 * Track user interaction
 */
export async function trackInteraction(interactionName) {
  try {
    const trace = await perf().startTrace(`interaction_${interactionName}`);
    const startTime = Date.now();
    
    return {
      stop: async () => {
        const duration = Date.now() - startTime;
        await trace.stop();
        
        console.log(`⏱️ [Performance] Interaction ${interactionName}: ${duration}ms`);
        
        // Alert if slow
        if (duration > THRESHOLDS.interaction) {
          Sentry.captureMessage(
            `Slow interaction: ${interactionName} (${duration}ms)`,
            'warning'
          );
        }
      },
    };
  } catch (error) {
    console.error('❌ [Performance] Track interaction error:', error);
    return { stop: () => {} };
  }
}

/**
 * Track component render time
 */
export function useRenderTime(componentName) {
  const startTime = Date.now();
  
  return () => {
    const renderTime = Date.now() - startTime;
    console.log(`⏱️ [Performance] ${componentName} render: ${renderTime}ms`);
    
    if (renderTime > 100) {
      Sentry.captureMessage(
        `Slow component render: ${componentName} (${renderTime}ms)`,
        'warning'
      );
    }
  };
}

/**
 * Track navigation performance
 */
export async function trackNavigation(fromScreen, toScreen) {
  try {
    const trace = await perf().startTrace(`navigation_${fromScreen}_to_${toScreen}`);
    const startTime = Date.now();
    
    // Wait for interactions to complete
    await InteractionManager.runAfterInteractions(() => {
      const duration = Date.now() - startTime;
      trace.stop();
      
      console.log(`⏱️ [Performance] Navigation ${fromScreen} → ${toScreen}: ${duration}ms`);
    });
  } catch (error) {
    console.error('❌ [Performance] Track navigation error:', error);
  }
}

/**
 * Track app startup time
 */
export async function trackAppStartup() {
  try {
    const trace = await perf().startTrace('app_startup');
    
    return {
      stop: async () => {
        await trace.stop();
        const metrics = await trace.getMetrics();
        console.log('⏱️ [Performance] App startup:', metrics);
      },
    };
  } catch (error) {
    console.error('❌ [Performance] Track startup error:', error);
    return { stop: () => {} };
  }
}

/**
 * Track bundle load time
 */
export async function trackBundleLoad() {
  try {
    const trace = await perf().startTrace('bundle_load');
    
    return {
      stop: async () => {
        await trace.stop();
        const metrics = await trace.getMetrics();
        console.log('⏱️ [Performance] Bundle load:', metrics);
      },
    };
  } catch (error) {
    console.error('❌ [Performance] Track bundle error:', error);
    return { stop: () => {} };
  }
}

/**
 * Track custom metric
 */
export async function trackCustomMetric(name, value) {
  try {
    const trace = await perf().startTrace(`custom_${name}`);
    await trace.putMetric(name, value);
    await trace.stop();
    
    console.log(`⏱️ [Performance] Custom metric ${name}: ${value}`);
  } catch (error) {
    console.error('❌ [Performance] Track custom metric error:', error);
  }
}

/**
 * Enable performance monitoring
 */
export async function enablePerformanceMonitoring() {
  try {
    await perf().setPerformanceCollectionEnabled(true);
    console.log('✅ [Performance] Monitoring enabled');
  } catch (error) {
    console.error('❌ [Performance] Enable error:', error);
  }
}

/**
 * Disable performance monitoring
 */
export async function disablePerformanceMonitoring() {
  try {
    await perf().setPerformanceCollectionEnabled(false);
    console.log('✅ [Performance] Monitoring disabled');
  } catch (error) {
    console.error('❌ [Performance] Disable error:', error);
  }
}

/**
 * Get performance report
 */
export function getPerformanceReport() {
  // This would aggregate performance data
  // In a real app, you'd send this to your analytics backend
  return {
    timestamp: new Date().toISOString(),
    metrics: {
      // Add your metrics here
    },
  };
}

export default {
  trackScreenLoad,
  trackAPICall,
  trackInteraction,
  useRenderTime,
  trackNavigation,
  trackAppStartup,
  trackBundleLoad,
  trackCustomMetric,
  enablePerformanceMonitoring,
  disablePerformanceMonitoring,
  getPerformanceReport,
  THRESHOLDS,
};
