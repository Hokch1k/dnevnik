package ru.dnevnik.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {

    private static final int BG = 0xFF0B1226;
    private static final String CHANNEL_ID = "dnevnik";
    private static final int REQ_NOTIF = 7;

    private WebView webView;
    private AssetServer server;
    private SharedPreferences prefs;

    /** Мост для уведомлений и постоянного хранилища: системные уведомления надёжнее, чем Notification API в WebView. */
    public class Bridge {
        @JavascriptInterface
        public boolean notificationsAllowed() {
            return notifAllowed();
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    askNotifPermission();
                }
            });
        }

        @JavascriptInterface
        public void notify(String title, String body) {
            showNotification(title, body);
        }

        @JavascriptInterface
        public String loadState() {
            return prefs.getString("ls", "");
        }

        @JavascriptInterface
        public String prefetchData() {
            return prefs.getString("prefetch_data", "");
        }

        @JavascriptInterface
        public String prefetchChat() {
            return prefs.getString("prefetch_chat", "[]");
        }

        @JavascriptInterface
        public String prefetchSched() {
            return prefs.getString("prefetch_sched", "[]");
        }

        @JavascriptInterface
        public int appVersionCode() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void saveState(String json) {
            prefs.edit().putString("ls", json == null ? "" : json).apply();
        }

        @JavascriptInterface
        public void setBackground(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(MainActivity.this, NotifyService.class);
                    if (on) {
                        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
                        else startService(i);
                    } else {
                        stopService(i);
                    }
                }
            });
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences("dnevnik", MODE_PRIVATE);
        createChannel();

        FrameLayout rootView = new FrameLayout(this);
        rootView.setBackgroundColor(BG);

        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new Bridge(), "DnevnikNative");

        rootView.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(rootView);

        server = new AssetServer(new AssetServer.Source() {
            @Override
            public byte[] read(String path) throws IOException {
                return readAsset(path);
            }
        }, "www");

        int port = server.start(prefs.getInt("port", 0));
        if (port > 0) {
            prefs.edit().putInt("port", port).apply();
            webView.loadUrl(server.baseUrl() + "/index.html");
        } else {
            webView.setVisibility(View.GONE);
            TextView error = new TextView(this);
            error.setText("Не удалось запустить приложение. Переустановите APK.");
            error.setTextColor(Color.WHITE);
            error.setPadding(48, 96, 48, 48);
            rootView.addView(error, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        askNotifPermission();
        if (notifAllowed()) startNotifyService();
    }

    private void startNotifyService() {
        try {
            Intent i = new Intent(this, NotifyService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
            else startService(i);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF && notifAllowed()) startNotifyService();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (prefs != null) prefs.edit().putLong("active_ts", System.currentTimeMillis()).apply();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (prefs != null) prefs.edit().putLong("active_ts", System.currentTimeMillis()).apply();
    }

    private byte[] readAsset(String path) throws IOException {
        InputStream is = getAssets().open(path);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream(8192);
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            try {
                is.close();
            } catch (IOException ignored) {
            }
        }
    }

    private void askNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
    }

    private boolean notifAllowed() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Дневник", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("Домашнее задание и чат класса");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void showNotification(String title, String body) {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(this, 0, intent, flags);

            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                b = new Notification.Builder(this, CHANNEL_ID);
            } else {
                b = new Notification.Builder(this);
            }
            b.setContentTitle(title == null ? "Дневник" : title)
                    .setContentText(body == null ? "" : body)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setAutoCancel(true)
                    .setContentIntent(pi);

            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify((int) (System.currentTimeMillis() % 100000), b.build());
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.onBack&&window.onBack())}catch(e){return false}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
