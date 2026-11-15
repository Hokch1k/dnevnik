package ru.dnevnik.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Фоновый опрос: пока приложение закрыто, раз в 3 минуты заглядывает в чат класса и в data.json.
 * Уведомления системные. Ключ чата и тема берутся из постоянного хранилища, которое
 * зеркалирует страница через мост (loadState/saveState).
 */
public class NotifyService extends Service {

    private static final String PREFS = "dnevnik";
    private static final String CHANNEL = "dnevnik_bg";
    private static final int FG_ID = 1;
    private static final long INTERVAL = 180000L;
    private static final long ACTIVE_GRACE = 150000L;
    private static final String HW_URL = "https://raw.githubusercontent.com/Hokch1k/dnevnik/main/data.json";

    private Thread worker;
    private volatile boolean running = true;
    private int noteId = 100;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(FG_ID, foreground());
        if (worker == null) {
            worker = new Thread(new Runnable() {
                @Override
                public void run() {
                    loop();
                }
            }, "dnevnik-bg");
            worker.setDaemon(true);
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        stopForeground(true);
        super.onDestroy();
    }

    private void loop() {
        while (running) {
            long t0 = System.currentTimeMillis();
            String chatOn = pref("notif_chat", "1");
            String hwOn = pref("notif_hw", "1");
            if ("0".equals(chatOn) && "0".equals(hwOn)) {
                stopSelf();
                return;
            }
            try {
                if ("1".equals(chatOn)) pollChat();
            } catch (Exception ignored) {
            }
            try {
                if ("1".equals(hwOn)) pollHw();
            } catch (Exception ignored) {
            }
            long spent = System.currentTimeMillis() - t0;
            long wait = INTERVAL - spent;
            if (wait < 15000L) wait = 15000L;
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void pollChat() throws Exception {
        String topic = state("chat_topic");
        String keyB64 = state("chat_k");
        if (topic.isEmpty() || keyB64.isEmpty()) return;
        String dev = state("dev_id");
        String since = pref("svc_since", "10m");
        String url = "https://ntfy.sh/" + topic + "/json?poll=1&since=" + URLEncoder.encode(since, "UTF-8");
        for (String line : http(url).split("\n")) {
            line = line.trim();
            if (line.isEmpty()) continue;
            JSONObject ev;
            try {
                ev = new JSONObject(line);
            } catch (Exception e) {
                continue;
            }
            if (!"message".equals(ev.optString("event"))) continue;
            String id = ev.optString("id");
            if (id.isEmpty()) continue;
            prefs().edit().putString("svc_since", id).apply();
            JSONObject m = decrypt(ev.optString("message"), keyB64);
            if (m == null) continue;
            if (m.has("op")) continue;
            String d = m.optString("d", "");
            if (!d.isEmpty() && d.equals(dev)) continue;
            String text = m.optString("t", "");
            if (text.isEmpty()) continue;
            String nick = m.optString("n", "Ученик");
            notifyUser("Чат класса", nick + ": " + text);
        }
    }

    private void pollHw() throws Exception {
        JSONObject j = new JSONObject(http(pref("hw_url", HW_URL)));
        String upd = j.optString("updated");
        if (upd.isEmpty()) return;
        String prev = pref("svc_hw", "");
        if (prev.isEmpty()) {
            prefs().edit().putString("svc_hw", upd).apply();
            return;
        }
        if (!upd.equals(prev)) {
            prefs().edit().putString("svc_hw", upd).apply();
            notifyUser("Домашка обновилась", "Открой Дневник, чтобы посмотреть");
        }
    }

    private JSONObject decrypt(String s, String keyB64) {
        try {
            int dot = s.indexOf('.');
            if (dot < 0) return null;
            byte[] iv = Base64.decode(s.substring(0, dot), Base64.DEFAULT);
            byte[] ct = Base64.decode(s.substring(dot + 1), Base64.DEFAULT);
            byte[] key = Base64.decode(keyB64, Base64.DEFAULT);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            return new JSONObject(new String(c.doFinal(ct), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    private String http(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Accept", "application/json");
        try {
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream(8192);
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            in.close();
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String pref(String key, String def) {
        return prefs().getString(key, def);
    }

    private String state(String key) {
        try {
            String raw = pref("ls", "");
            if (raw.isEmpty()) return "";
            JSONObject o = new JSONObject(raw);
            return o.optString(key, "");
        } catch (Exception e) {
            return "";
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Фон", NotificationManager.IMPORTANCE_MIN);
                ch.setDescription("Незаметная проверка обновлений");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification foreground() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(this, CHANNEL);
        else b = new Notification.Builder(this);
        b.setContentTitle("Дневник")
                .setContentText("Следит за домашкой и чатом")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true);
        return b.build();
    }

    private void notifyUser(String title, String body) {
        try {
            if (isAppVisible()) return;
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(this, 0, intent, flags);

            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(this, "dnevnik");
            else b = new Notification.Builder(this);
            b.setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setAutoCancel(true)
                    .setContentIntent(pi);

            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(noteId++, b.build());
        } catch (Exception ignored) {
        }
    }

    private boolean isAppVisible() {
        return System.currentTimeMillis() - prefLong("active_ts", 0L) < ACTIVE_GRACE;
    }

    private long prefLong(String key, long def) {
        return prefs().getLong(key, def);
    }
}
