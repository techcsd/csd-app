package com.constructorasd.csdapp;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * P1/P2 — deep-link a la pantalla de ajustes de ESTA app, para cuando el usuario
 * negó un permiso "permanentemente" (mic / ubicación) y la única salida es
 * activarlo a mano. Espeja el patrón de ApkInstallerPlugin (intent + package uri).
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
}
