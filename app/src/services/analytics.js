/**
 * Analytics Service - Phase 6.10
 * 
 * Purpose: Track user behavior and app usage
 * 
 * Features:
 * - Firebase Analytics
 * - Custom events
 * - User properties
 * - Screen tracking
 * - E-commerce tracking
 */

import analytics from '@react-native-firebase/analytics';
import * as Sentry from '@sentry/react-native';

/**
 * Log screen view
 */
export async function logScreenView(screenName, screenClass) {
  try {
    await analytics().logScreenView({
      screen_name: screenName,
      screen_class: screenClass || screenName,
    });
    console.log(`📊 [Analytics] Screen view: ${screenName}`);
  } catch (error) {
    console.error('❌ [Analytics] Log screen view error:', error);
  }
}

/**
 * Log custom event
 */
export async function logEvent(eventName, params = {}) {
  try {
    await analytics().logEvent(eventName, params);
    console.log(`📊 [Analytics] Event: ${eventName}`, params);
  } catch (error) {
    console.error('❌ [Analytics] Log event error:', error);
  }
}

/**
 * Set user ID
 */
export async function setUserId(userId) {
  try {
    await analytics().setUserId(userId);
    
    // Also set in Sentry
    Sentry.setUser({ id: userId });
    
    console.log(`📊 [Analytics] User ID set: ${userId}`);
  } catch (error) {
    console.error('❌ [Analytics] Set user ID error:', error);
  }
}

/**
 * Set user properties
 */
export async function setUserProperties(properties) {
  try {
    for (const [key, value] of Object.entries(properties)) {
      await analytics().setUserProperty(key, value);
    }
    
    // Also set in Sentry
    Sentry.setUser(properties);
    
    console.log('📊 [Analytics] User properties set:', properties);
  } catch (error) {
    console.error('❌ [Analytics] Set user properties error:', error);
  }
}

/**
 * Log login event
 */
export async function logLogin(method, userType) {
  await logEvent('login', {
    method,
    user_type: userType,
  });
}

/**
 * Log signup event
 */
export async function logSignup(method, userType) {
  await logEvent('sign_up', {
    method,
    user_type: userType,
  });
}

/**
 * Log order placed
 */
export async function logOrderPlaced(orderId, value, items) {
  await logEvent('purchase', {
    transaction_id: orderId,
    value,
    currency: 'INR',
    items: items.map(item => ({
      item_id: item.id,
      item_name: item.name,
      price: item.price,
      quantity: item.quantity,
    })),
  });
}

/**
 * Log add to cart
 */
export async function logAddToCart(item) {
  await logEvent('add_to_cart', {
    item_id: item.id,
    item_name: item.name,
    price: item.price,
    quantity: item.quantity,
  });
}

/**
 * Log remove from cart
 */
export async function logRemoveFromCart(item) {
  await logEvent('remove_from_cart', {
    item_id: item.id,
    item_name: item.name,
  });
}

/**
 * Log view item
 */
export async function logViewItem(item) {
  await logEvent('view_item', {
    item_id: item.id,
    item_name: item.name,
    price: item.price,
    category: item.category,
  });
}

/**
 * Log search
 */
export async function logSearch(searchTerm) {
  await logEvent('search', {
    search_term: searchTerm,
  });
}

/**
 * Log order status change
 */
export async function logOrderStatusChange(orderId, oldStatus, newStatus) {
  await logEvent('order_status_change', {
    order_id: orderId,
    old_status: oldStatus,
    new_status: newStatus,
  });
}

/**
 * Log delivery accepted
 */
export async function logDeliveryAccepted(orderId, deliveryBoyId) {
  await logEvent('delivery_accepted', {
    order_id: orderId,
    delivery_boy_id: deliveryBoyId,
  });
}

/**
 * Log delivery completed
 */
export async function logDeliveryCompleted(orderId, deliveryBoyId, duration) {
  await logEvent('delivery_completed', {
    order_id: orderId,
    delivery_boy_id: deliveryBoyId,
    duration_minutes: duration,
  });
}

/**
 * Log error
 */
export async function logError(error, context = {}) {
  await logEvent('error', {
    error_message: error.message,
    error_stack: error.stack,
    ...context,
  });
  
  // Also log to Sentry
  Sentry.captureException(error, { contexts: { custom: context } });
}

/**
 * Log app open
 */
export async function logAppOpen() {
  await logEvent('app_open');
}

/**
 * Log app background
 */
export async function logAppBackground() {
  await logEvent('app_background');
}

/**
 * Log notification received
 */
export async function logNotificationReceived(notificationType) {
  await logEvent('notification_received', {
    notification_type: notificationType,
  });
}

/**
 * Log notification opened
 */
export async function logNotificationOpened(notificationType) {
  await logEvent('notification_opened', {
    notification_type: notificationType,
  });
}

/**
 * Log feature usage
 */
export async function logFeatureUsage(featureName, action) {
  await logEvent('feature_usage', {
    feature_name: featureName,
    action,
  });
}

/**
 * Log performance metric
 */
export async function logPerformance(metricName, value, unit = 'ms') {
  await logEvent('performance_metric', {
    metric_name: metricName,
    value,
    unit,
  });
}

/**
 * Enable analytics collection
 */
export async function enableAnalytics() {
  try {
    await analytics().setAnalyticsCollectionEnabled(true);
    console.log('✅ [Analytics] Enabled');
  } catch (error) {
    console.error('❌ [Analytics] Enable error:', error);
  }
}

/**
 * Disable analytics collection
 */
export async function disableAnalytics() {
  try {
    await analytics().setAnalyticsCollectionEnabled(false);
    console.log('✅ [Analytics] Disabled');
  } catch (error) {
    console.error('❌ [Analytics] Disable error:', error);
  }
}

export default {
  logScreenView,
  logEvent,
  setUserId,
  setUserProperties,
  logLogin,
  logSignup,
  logOrderPlaced,
  logAddToCart,
  logRemoveFromCart,
  logViewItem,
  logSearch,
  logOrderStatusChange,
  logDeliveryAccepted,
  logDeliveryCompleted,
  logError,
  logAppOpen,
  logAppBackground,
  logNotificationReceived,
  logNotificationOpened,
  logFeatureUsage,
  logPerformance,
  enableAnalytics,
  disableAnalytics,
};
