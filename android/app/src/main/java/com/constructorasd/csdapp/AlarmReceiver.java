package com.constructorasd.csdapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * AL6 — Se dispara cuando llega el momento programado (AlarmManager). Con la app
 * cerrada, este receiver corre igual: muestra la notificación full-screen tipo
 * alarma y re-programa el siguiente slot (cada 30 min hasta las 20:00, luego el
 * próximo domingo). Se detiene cuando la app llama disable() al completar la
 * inspección.
 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        if (!WeeklyAlarm.isActive(app)) return;
        WeeklyAlarm.fire(app);
        WeeklyAlarm.reschedule(app);
    }
}
