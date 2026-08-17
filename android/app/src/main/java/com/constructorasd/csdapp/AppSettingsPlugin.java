package com.constructorasd.csdapp;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * P1/P2 — deep-link a la pantalla de ajustes de ESTA app, para cuando el usuario
 * negó un permiso "permanentemente" (mic / ubicación) y la única salida es
 * activarlo a mano. Espeja el patrón de ApkInstallerPlugin (intent + package uri).
 *
 * AS1 — además, exclusión REAL de la optimización de batería: el diagnóstico del
 * tracking mostró que OEM agresivos (MIUI/Huawei) matan el foreground service en
 * background. Antes solo mostrábamos un toast con instrucciones; ahora disparamos
 * el diálogo nativo `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` y podemos
 * consultar si ya está excluida. (La app se instala por APK directo, no por Play,
 * así que la restricción de Play sobre este intent no aplica.)
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent intent = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("open settings failed: " + e.getMessage(), e);
        }
    }

    /** AS1 — ¿la app ya está excluida de la optimización de batería? */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean ignoring = pm != null
                    && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            ret.put("value", ignoring);
        } catch (Exception e) {
            ret.put("value", false);
        }
        call.resolve(ret);
    }

    /**
     * AS1 — pide la exclusión de la optimización de batería. Si ya está excluida,
     * abre la lista del sistema (no hay diálogo que mostrar). Devuelve el estado
     * resultante mejor-esfuerzo (el usuario decide en el diálogo del SO).
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean ignoring = pm != null
                    && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            Intent intent;
            if (ignoring) {
                // Ya excluida: no hay diálogo; llevamos a la lista por si quiere revisar.
                intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            } else {
                intent = new Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("alreadyIgnoring", ignoring);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("battery request failed: " + e.getMessage(), e);
        }
    }
}
