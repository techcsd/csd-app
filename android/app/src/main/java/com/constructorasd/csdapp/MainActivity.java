package com.constructorasd.csdapp;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // V3: register the APK self-installer plugin before the bridge boots.
        registerPlugin(ApkInstallerPlugin.class);
        // P1/P2: deep-link a los ajustes de la app (permiso denegado permanente).
        registerPlugin(AppSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
