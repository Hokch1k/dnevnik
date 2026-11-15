package ru.dnevnik.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** Поднимает фоновую службу после перезагрузки телефона и после обновления приложения. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            SharedPreferences p = context.getSharedPreferences("dnevnik", Context.MODE_PRIVATE);
            String chat = p.getString("notif_chat", "1");
            String hw = p.getString("notif_hw", "1");
            if ("0".equals(chat) && "0".equals(hw)) return;
            Intent i = new Intent(context, NotifyService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
        } catch (Exception ignored) {
        }
    }
}
