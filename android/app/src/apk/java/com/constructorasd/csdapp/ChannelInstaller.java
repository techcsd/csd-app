package com.constructorasd.csdapp;

import com.getcapacitor.BridgeActivity;

/**
 * CI7 — Canal `apk`: registra el ApkInstallerPlugin (auto-actualización por
 * descarga de APK, para teléfonos sin Google Play). El canal `play` tiene su
 * propia versión no-op de esta clase en src/play/java (Play prohíbe actualizarse
 * por fuera de Play). MainActivity (src/main) llama ChannelInstaller.register(this)
 * sin saber el canal; cada flavor aporta la implementación que le toca.
 */
public final class ChannelInstaller {
    private ChannelInstaller() {}

    public static void register(BridgeActivity activity) {
        activity.registerPlugin(ApkInstallerPlugin.class);
    }
}
