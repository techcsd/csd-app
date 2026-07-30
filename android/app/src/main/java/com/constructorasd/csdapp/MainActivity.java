package com.constructorasd.csdapp;

import android.os.Bundle;
import android.webkit.PermissionRequest;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // V3: register the APK self-installer plugin before the bridge boots.
        registerPlugin(ApkInstallerPlugin.class);
        // P1/P2: deep-link a los ajustes de la app (permiso denegado permanente).
        registerPlugin(AppSettingsPlugin.class);
        super.onCreate(savedInstanceState);

        // AA16 — el WebView re-preguntaba por el micrófono/cámara en CADA grabación
        // (getUserMedia) porque no concedía el recurso automáticamente. El permiso
        // REAL lo controla Android a nivel de app (RECORD_AUDIO/CAMERA, pedido una
        // sola vez por PermisoGateService); una vez otorgado, el WebView de NUESTRO
        // propio PWA no debe volver a preguntar. Extendemos el WebChromeClient de
        // Capacitor (conserva file chooser, diálogos JS, etc.) y solo autoconcedemos
        // el recurso solicitado.
        getBridge()
            .getWebView()
            .setWebChromeClient(
                new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> request.grant(request.getResources()));
                    }
                });
    }
}
