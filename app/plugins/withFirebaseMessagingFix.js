const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin — Firebase Messaging Fixes
 *
 * 1. Fixes AndroidManifest.xml merge conflicts between expo-notifications
 *    and @react-native-firebase/messaging (tools:replace attributes).
 *
 * 2. Creates a native FoodAdminMessagingService.java that displays
 *    notifications at the Java level for background/killed states.
 *    (expo-notifications.scheduleNotificationAsync does not work
 *    reliably inside a headless JS task.)
 *
 * 3. Registers that service in the manifest with a higher-priority
 *    intent-filter so it receives FCM messages *before* the default
 *    ReactNativeFirebaseMessagingService.
 */
module.exports = function withFirebaseMessagingFix(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const platformRoot = config.modRequest.platformProjectRoot;
      const manifestPath = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'AndroidManifest.xml'
      );

      // ── 1. Manifest fixes ──────────────────────────────────────────
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
        /<meta-data\s+android:name="com\.google\.firebase\.messaging\.default_notification_channel_id"\s+android:value="([^"]*)"/g,
        '<meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" tools:replace="android:value" android:value="$1"'
      );

      // Add tools:replace="android:resource" to default_notification_color
      manifest = manifest.replace(
        /<meta-data\s+android:name="com\.google\.firebase\.messaging\.default_notification_color"\s+android:resource="([^"]*)"/g,
        '<meta-data android:name="com.google.firebase.messaging.default_notification_color" tools:replace="android:resource" android:resource="$1"'
      );

      // ── 2. Register the native FoodAdminMessagingService ───────────
      if (!manifest.includes('FoodAdminMessagingService')) {
        const serviceBlock = [
          '',
          '    <!-- Native FCM service: reliable background/killed-state notification display -->',
          '    <service',
          '        android:name=".FoodAdminMessagingService"',
          '        android:exported="false"',
          '        tools:node="merge">',
          '      <intent-filter android:priority="100">',
          '        <action android:name="com.google.firebase.MESSAGING_EVENT" />',
          '      </intent-filter>',
          '    </service>',
        ].join('\n');

        manifest = manifest.replace(
          '</application>',
          serviceBlock + '\n  </application>'
        );
      }

      fs.writeFileSync(manifestPath, manifest);

      // ── 3. Write FoodAdminMessagingService.java ────────────────────
      const packageName = config.android?.package || 'com.foodadmin.mobile';
      const javaDir = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.')
      );

      if (!fs.existsSync(javaDir)) {
        fs.mkdirSync(javaDir, { recursive: true });
      }

      const javaFile = path.join(javaDir, 'FoodAdminMessagingService.java');
      // Only write if the file doesn't exist or is outdated
      const javaSource = buildJavaSource(packageName);
      fs.writeFileSync(javaFile, javaSource);

      return config;
    },
  ]);
};

/**
 * Generate the Java source for FoodAdminMessagingService.
 * Kept here so the plugin is self-contained for expo prebuild.
 */
function buildJavaSource(packageName) {
  return `package ${packageName};

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService;

/**
 * Custom Firebase Messaging Service that extends React Native Firebase's service.
 *
 * In BACKGROUND / KILLED state: displays the notification natively (Java),
 * then calls super so React Native Firebase can run the JS headless handler
 * for side-effects (badge count, etc.).
 *
 * In FOREGROUND state: skips native display (the JS onMessage handler
 * in App.js already renders it) and just calls super.
 */
public class FoodAdminMessagingService extends ReactNativeFirebaseMessagingService {

    private static final String TAG = "FoodAdminMsgSvc";
    private static final String DEFAULT_CHANNEL_ID = "default";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.d(TAG, "onMessageReceived from: " + remoteMessage.getFrom());

        if (!isAppInForeground()) {
            displayNotification(remoteMessage);
        }

        try {
            super.onMessageReceived(remoteMessage);
        } catch (Exception e) {
            Log.w(TAG, "super.onMessageReceived failed: " + e.getMessage());
        }
    }

    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "onNewToken");
        try {
            super.onNewToken(token);
        } catch (Exception e) {
            Log.w(TAG, "super.onNewToken failed: " + e.getMessage());
        }
    }

    private void displayNotification(RemoteMessage remoteMessage) {
        try {
            String title = null;
            String body = null;
            String channelId = DEFAULT_CHANNEL_ID;

            RemoteMessage.Notification notification = remoteMessage.getNotification();
            if (notification != null) {
                title = notification.getTitle();
                body = notification.getBody();
                String nc = notification.getChannelId();
                if (nc != null && !nc.isEmpty()) channelId = nc;
            }

            Map<String, String> data = remoteMessage.getData();
            if ((title == null || title.isEmpty()) && data.containsKey("title")) {
                title = data.get("title");
            }
            if ((body == null || body.isEmpty()) && data.containsKey("body")) {
                body = data.get("body");
            }
            if (data.containsKey("channelId")) {
                channelId = data.get("channelId");
            }

            if (title == null && body == null) return;

            NotificationManager mgr =
                    (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (mgr == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ensureChannel(mgr, channelId);
            }

            Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (intent == null) intent = new Intent();
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            for (Map.Entry<String, String> entry : data.entrySet()) {
                intent.putExtra(entry.getKey(), entry.getValue());
            }
            intent.putExtra("google.message_id", remoteMessage.getMessageId());

            PendingIntent pendingIntent = PendingIntent.getActivity(
                    this, (int) System.currentTimeMillis(), intent,
                    PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE);

            int smallIcon = getResources().getIdentifier(
                    "notification_icon", "drawable", getPackageName());
            if (smallIcon == 0) smallIcon = getApplicationInfo().icon;

            NotificationCompat.Builder builder =
                    new NotificationCompat.Builder(this, channelId)
                            .setSmallIcon(smallIcon)
                            .setContentTitle(title != null ? title : "")
                            .setContentText(body != null ? body : "")
                            .setAutoCancel(true)
                            .setPriority(NotificationCompat.PRIORITY_MAX)
                            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                            .setDefaults(NotificationCompat.DEFAULT_ALL)
                            .setContentIntent(pendingIntent);

            if (body != null && body.length() > 40) {
                builder.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
            }

            int notificationId = remoteMessage.getMessageId() != null
                    ? remoteMessage.getMessageId().hashCode()
                    : (int) System.currentTimeMillis();

            mgr.notify(notificationId, builder.build());
            Log.d(TAG, "Native notification displayed: " + title);
        } catch (Exception e) {
            Log.e(TAG, "Failed to display native notification", e);
        }
    }

    private void ensureChannel(NotificationManager mgr, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (mgr.getNotificationChannel(channelId) != null) return;

        String name;
        boolean bypassDnd = false;

        switch (channelId) {
            case "new-orders":   name = "New Orders";            bypassDnd = true; break;
            case "order-updates":name = "Order Updates";         bypassDnd = true; break;
            case "orders":       name = "Order Notifications";   bypassDnd = true; break;
            case "delivery":     name = "Delivery Notifications";                  break;
            default:             name = "Default Notifications";                   break;
        }

        NotificationChannel channel = new NotificationChannel(
                channelId, name, NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true);
        channel.enableLights(true);
        channel.setShowBadge(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        }
        if (bypassDnd) channel.setBypassDnd(true);

        mgr.createNotificationChannel(channel);
        Log.d(TAG, "Created notification channel: " + channelId);
    }

    private boolean isAppInForeground() {
        try {
            ActivityManager.RunningAppProcessInfo info =
                    new ActivityManager.RunningAppProcessInfo();
            ActivityManager.getMyMemoryState(info);
            return info.importance
                    == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        } catch (Exception e) {
            return false;
        }
    }
}
`;
}
