/**
 * Crash Reporting Service - Phase 6.10
 * 
 * Purpose: Track and report app crashes and errors
 * 
 * Features:
 * - Sentry integration
 * - Error tracking
 * - Breadcrumbs
 * - User context
 * - Performance monitoring
 */

import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

// Sentry DSN (replace with your actual DSN)
const SENTRY_DSN = 'https://your-sentry-dsn@sentry.io/your-project-id';

/**
 * Initialize Sentry
 */
export function initializeSentry() {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__, // Disable in development
    tracesSampleRate: 1.0, // Capture 100% of transactions for performance monitoring
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30000,
    attachStacktrace: true,
    beforeSend(event, hint) {
      // Filter out certain errors
      if (event.exception) {
        const error = hint.originalException;
        
        // Don't send network errors in development
        if (__DEV__ && error?.message?.includes('Network')) {
          return null;
        }
      }
      
      return event;
    },
    integrations: [
      new Sentry.ReactNativeTracing({
        tracingOrigins: ['restaruntbot.onrender.com', 'restarunt-bot.vercel.app', /^\//],
        routingInstrumentation: new Sentry.ReactNavigationInstrumentation(),
      }),
    ],
  });

  console.log('✅ [Sentry] Initialized');
}

/**
 * Capture exception
 */
export function captureException(error, context = {}) {
  Sentry.captureException(error, {
    contexts: {
      custom: context,
    },
  });
  console.error('❌ [Sentry] Exception captured:', error);
}

/**
 * Capture message
 */
export function captureMessage(message, level = 'info') {
  Sentry.captureMessage(message, level);
  console.log(`📝 [Sentry] Message captured: ${message}`);
}

/**
 * Add breadcrumb
 */
export function addBreadcrumb(breadcrumb) {
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Set user context
 */
export function setUser(user) {
  Sentry.setUser(user);
  console.log('👤 [Sentry] User set:', user);
}

/**
 * Clear user context
 */
export function clearUser() {
  Sentry.setUser(null);
  console.log('👤 [Sentry] User cleared');
}

/**
 * Set tag
 */
export function setTag(key, value) {
  Sentry.setTag(key, value);
}

/**
 * Set context
 */
export function setContext(name, context) {
  Sentry.setContext(name, context);
}

/**
 * Start transaction (performance monitoring)
 */
export function startTransaction(name, op) {
  return Sentry.startTransaction({ name, op });
}

/**
 * Track screen navigation
 */
export function trackScreenNavigation(screenName, params = {}) {
  addBreadcrumb({
    category: 'navigation',
    message: `Navigated to ${screenName}`,
    level: 'info',
    data: params,
  });
}

/**
 * Track API call
 */
export function trackAPICall(method, url, status) {
  addBreadcrumb({
    category: 'http',
    message: `${method} ${url}`,
    level: status >= 400 ? 'error' : 'info',
    data: {
      method,
      url,
      status,
    },
  });
}

/**
 * Track user action
 */
export function trackUserAction(action, data = {}) {
  addBreadcrumb({
    category: 'user',
    message: action,
    level: 'info',
    data,
  });
}

/**
 * Track error with context
 */
export function trackError(error, context = {}) {
  captureException(error, {
    ...context,
    platform: Platform.OS,
    version: Platform.Version,
  });
}

/**
 * Track network error
 */
export function trackNetworkError(error, request) {
  captureException(error, {
    type: 'network',
    request: {
      url: request.url,
      method: request.method,
      headers: request.headers,
    },
  });
}

/**
 * Track performance issue
 */
export function trackPerformanceIssue(metric, value, threshold) {
  if (value > threshold) {
    captureMessage(
      `Performance issue: ${metric} (${value}ms > ${threshold}ms)`,
      'warning'
    );
  }
}

/**
 * Wrap async function with error tracking
 */
export function wrapAsync(fn, context = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      trackError(error, context);
      throw error;
    }
  };
}

/**
 * Test Sentry (development only)
 */
export function testSentry() {
  if (__DEV__) {
    try {
      throw new Error('Test Sentry Error');
    } catch (error) {
      captureException(error, { test: true });
    }
  }
}

export default {
  initializeSentry,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  clearUser,
  setTag,
  setContext,
  startTransaction,
  trackScreenNavigation,
  trackAPICall,
  trackUserAction,
  trackError,
  trackNetworkError,
  trackPerformanceIssue,
  wrapAsync,
  testSentry,
};
