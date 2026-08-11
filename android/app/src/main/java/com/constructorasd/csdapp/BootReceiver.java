package com.constructorasd.csdapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * AL6 — Las alarmas de AlarmManager NO sobreviven un reinicio del teléfono. Al
 * arrancar el dispositivo re-programamos la alarma si seguía activa (la app aún no
 * ha completado la inspección). Requiere RECEIVE_BOOT_COMPLETED.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            WeeklyAlarm.reschedule(context.getApplicationContext());
        }
    }
}
