const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Fix Android Manifest merger conflict between expo-notifications 
 * and @react-native-firebase/messaging.
 * 
 * Both set default_notification_channel_id and default_notification_color,
 * so we add tools:replace to let expo-notifications values win.
 */
module.exports = function withFirebaseMessagingFix(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const manifestPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'AndroidManifest.xml'
      );

      let manifest = fs.readFileSync(manifestPath, 'utf-8');

      // Add tools namespace if not present
      if (!manifest.includes('xmlns:tools=')) {
        manifest = manifest.replace(
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"'
        );
      }

      // Add tools:replace="android:value" to default_notification_channel_id
      manifest = manifest.replace(
        /(<meta-data\s+android:name="com\.google\.firebase\.messaging\.default_notification_channel_id"\s+)/g,
        '$1tools:replace="android:value" '
      );

      // Add tools:replace="android:resource" to default_notification_color
      manifest = manifest.replace(
        /(<meta-data\s+android:name="com\.google\.firebase\.messaging\.default_notification_color"\s+)/g,
        '$1tools:replace="android:resource" '
      );

      fs.writeFileSync(manifestPath, manifest);
      return config;
    },
  ]);
};
