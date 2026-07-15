package com.constructorasd.csdapp;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // V3: register the APK self-installer plugin before the bridge boots.
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
