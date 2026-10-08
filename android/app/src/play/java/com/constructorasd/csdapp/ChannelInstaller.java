package com.constructorasd.csdapp;

import com.getcapacitor.BridgeActivity;

/**
 * CI7 — Canal `play`: NO registra el ApkInstallerPlugin. Google Play prohíbe que
 * una app se actualice por fuera de Play (answer/9888379); el canal play usa Play
 * In-App Updates (@capawesome/capacitor-app-update) desde el UpdaterService. Esta
 * clase es el no-op que empareja con src/apk/java/ChannelInstaller.java. El plugin
 * ApkInstallerPlugin.java no existe en este source set, así que ni se compila.
 */
public final class ChannelInstaller {
    private ChannelInstaller() {}

    public static void register(BridgeActivity activity) {
        // no-op: sin auto-instalador de APK en el canal Play.
    }
}
