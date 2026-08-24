package com.constructorasd.csdapp;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import java.util.Calendar;

/**
 * AL6 — Alarma AUTÓNOMA de inspección de vehículo (domingo). Suena aunque la app
 * esté cerrada/matada: usa AlarmManager exacto + una notificación full-screen con
 * sonido de alarma. Reintenta cada 30 min de 9:00 a 20:00 (hora del dispositivo,
 * asumida RD) y se re-arma sola para el siguiente domingo. La app llama enable()
 * cuando el usuario tiene un vehículo en uso con inspección pendiente y disable()
 * al completarla. Sobrevive reinicios via BootReceiver.
 */
public final class WeeklyAlarm {
    private WeeklyAlarm() {}

    private static final String PREFS = "csd_weekly_alarm";
    private static final String KEY_ACTIVE = "active";
    static final String CHANNEL_ID = "alarma_inspeccion";
    private static final int NOTIF_ID = 90610;
    private static final int REQ_CODE = 90611;
    static final String ACTION_FIRE = "com.constructorasd.csdapp.WEEKLY_ALARM";
    static final String DEEPLINK = "/transporte/reporte-semanal";

    private static final int START_HOUR = 9;   // 9:00 AM
    private static final int END_HOUR = 20;     // 20:00 (última insistencia)
    private static final long STEP_MS = 30L * 60L * 1000L; // 30 min

    // ── API pública (desde el plugin / boot) ──────────────────────────────────
    public static void enable(Context ctx) {
        prefs(ctx).edit().putBoolean(KEY_ACTIVE, true).apply();
        reschedule(ctx);
    }

    public static void disable(Context ctx) {
        prefs(ctx).edit().putBoolean(KEY_ACTIVE, false).apply();
        AlarmManager am = alarmManager(ctx);
        if (am != null) am.cancel(pendingIntent(ctx));
        cancelNotification(ctx);
    }

    public static boolean isActive(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ACTIVE, false);
    }

    /** Programa el próximo "slot" (domingo 9:00→20:00 cada 30 min, o próximo domingo). */
    public static void reschedule(Context ctx) {
        if (!isActive(ctx)) return;
        AlarmManager am = alarmManager(ctx);
        if (am == null) return;
        long at = nextSlot(System.currentTimeMillis());
        PendingIntent pi = pendingIntent(ctx);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                // Sin permiso de alarma exacta: caemos a la variante inexacta pero
                // que igual dispara en modo Doze (mejor que nada; el server insiste).
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    // ── Cálculo del próximo disparo ────────────────────────────────────────────
    static long nextSlot(long nowMs) {
        Calendar now = Calendar.getInstance();
        now.setTimeInMillis(nowMs);

        Calendar c = (Calendar) now.clone();
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);

        boolean isSunday = now.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY;
        int hour = now.get(Calendar.HOUR_OF_DAY);

        if (isSunday && hour < START_HOUR) {
            c.set(Calendar.HOUR_OF_DAY, START_HOUR);
            c.set(Calendar.MINUTE, 0);
            return c.getTimeInMillis();
        }
        if (isSunday && hour < END_HOUR) {
            // Redondear al próximo múltiplo de 30 min DESPUÉS de ahora.
            int minute = now.get(Calendar.MINUTE);
            int add = (minute < 30) ? (30 - minute) : (60 - minute);
            c.add(Calendar.MINUTE, add);
            if (c.getTimeInMillis() <= nowMs) c.add(Calendar.MINUTE, 30);
            // Si el redondeo pasó de las 20:00, saltar al próximo domingo.
            if (c.get(Calendar.HOUR_OF_DAY) >= END_HOUR) return nextSunday(now);
            return c.getTimeInMillis();
        }
        return nextSunday(now);
    }

    private static long nextSunday(Calendar from) {
        Calendar c = (Calendar) from.clone();
        c.set(Calendar.HOUR_OF_DAY, START_HOUR);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        // Avanzar hasta el próximo domingo (estrictamente futuro).
        do {
            c.add(Calendar.DAY_OF_MONTH, 1);
        } while (c.get(Calendar.DAY_OF_WEEK) != Calendar.SUNDAY);
        return c.getTimeInMillis();
    }

    // ── Notificación full-screen tipo alarma ───────────────────────────────────
    public static void fire(Context ctx) {
        fire(ctx, null, null);
    }

    /**
     * AL6 — muestra la alarma full-screen. Con título/cuerpo opcionales (los usa la
     * push dominical de fondo, CsdMessagingService, para mostrar la placa; si vienen
     * vacíos cae a los textos por defecto). Crea el canal si falta.
     */
    public static void fire(Context ctx, String title, String body) {
        ensureChannel(ctx);
        String t = (title != null && !title.trim().isEmpty()) ? title : "Inspección de tu vehículo";
        String bd = (body != null && !body.trim().isEmpty()) ? body : "Haz ahora la inspección. Sonará hasta que la completes.";

        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("alarm_deeplink", DEEPLINK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent content = PendingIntent.getActivity(ctx, 90612, open, piFlags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(ctx, CHANNEL_ID);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_MAX);
            b.setSound(alarmSound());
        }
        b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm);
        b.setContentTitle(t);
        b.setContentText(bd);
        b.setAutoCancel(true);
        b.setOngoing(false);
        b.setContentIntent(content);
        b.setFullScreenIntent(content, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            b.setCategory(Notification.CATEGORY_ALARM);
            b.setVisibility(Notification.VISIBILITY_PUBLIC);
        }

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, b.build());
    }

    private static void cancelNotification(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
    }

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Alarma de inspección", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Recordatorio sonoro del domingo para la inspección del vehículo.");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 600, 300, 600, 300, 600});
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        ch.setSound(alarmSound(), attrs);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }

    private static Uri alarmSound() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return u;
    }

    private static PendingIntent pendingIntent(Context ctx) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(ACTION_FIRE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(ctx, REQ_CODE, i, flags);
    }

    private static AlarmManager alarmManager(Context ctx) {
        return (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
