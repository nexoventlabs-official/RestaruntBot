const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Fix Android Manifest merger conflict between expo-notifications 
 * and @react-native-firebase/messaging.
 * 
 * Both set default_notification_channel_id and default_notification_color,
 * so we add tools:replace to let expo-notifications values win.
 */
module.exports = function withFirebaseMessagingFix(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];
    if (!mainApplication) return config;

    // Ensure tools namespace is declared
    if (!config.modResults.manifest.$) {
      config.modResults.manifest.$ = {};
    }
    config.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    // Find and fix conflicting meta-data entries
    const metaData = mainApplication['meta-data'] || [];
    
    for (const entry of metaData) {
      const name = entry.$?.['android:name'];
      if (
        name === 'com.google.firebase.messaging.default_notification_channel_id' ||
        name === 'com.google.firebase.messaging.default_notification_color'
      ) {
        // Add tools:replace for the conflicting attribute
        if (entry.$['android:value'] !== undefined) {
          entry.$['tools:replace'] = 'android:value';
        }
        if (entry.$['android:resource'] !== undefined) {
          entry.$['tools:replace'] = 'android:resource';
        }
      }
    }

    return config;
  });
};
