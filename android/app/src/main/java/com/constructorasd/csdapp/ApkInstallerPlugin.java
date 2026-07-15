package com.constructorasd.csdapp;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * V3 — rolling update. Installs a downloaded APK via the system package
 * installer (ACTION_VIEW + FileProvider content:// URI). On Android O+ the app
 * must hold "install unknown apps"; if it doesn't, we deep-link the user to that
 * settings screen and report {needsPermission:true} so the UI can guide them.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    private void goToInstallSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canInstallPackages());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        goToInstallSettings();
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        try {
            File file = path.startsWith("file://") ? new File(Uri.parse(path).getPath()) : new File(path);
            if (!file.exists()) {
                call.reject("APK not found: " + file.getAbsolutePath());
                return;
            }

            if (!canInstallPackages()) {
                goToInstallSettings();
                JSObject ret = new JSObject();
                ret.put("needsPermission", true);
                call.resolve(ret);
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("needsPermission", false);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage(), e);
        }
    }
}
