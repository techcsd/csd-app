package com.constructorasd.csdapp;

import android.view.WindowManager;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CZ7 (Vault) — activa/desactiva FLAG_SECURE en tiempo real mientras hay
 * secretos del Vault a la vista: bloquea capturas de pantalla, grabación de
 * pantalla y la miniatura de la app en "apps recientes". SOLO se activa dentro
 * de las pantallas del Vault (enable al entrar, disable al salir) — el resto de
 * la app sigue permitiendo capturas (p. ej. el diagnóstico por screenshot de
 * errores 'sistema' en Pendientes).
 */
@CapacitorPlugin(name = "ScreenSecurity")
public class ScreenSecurityPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
        call.resolve();
    }
}
