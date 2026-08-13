package com.constructorasd.csdapp;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    // WV-GUARD — La app está construida con Angular 21, cuyo piso de soporte es
    // "baseline widely available" (~Chromium 111, ver @angular/build
    // supported-browsers.js). En WebViews más viejos el bundle usa sintaxis/APIs
    // que ese Chromium no entiende (??= → 85, Object.hasOwn → 93, y features de
    // runtime hasta ~111) y NO se parsea → pantalla en BLANCO sin pista alguna.
    // Detectamos el WebView viejo ANTES de cargar la app y mostramos una pantalla
    // nativa clara con botón para actualizar. Ver reporte QA 2026-08-03 (Huawei
    // STK-LX3 con Chromium 81). El umbral iguala el piso real de Angular 21.
    private static final int MIN_CHROMIUM_MAJOR = 111;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // V3: register the APK self-installer plugin before the bridge boots.
        registerPlugin(ApkInstallerPlugin.class);
        // P1/P2: deep-link a los ajustes de la app (permiso denegado permanente).
        registerPlugin(AppSettingsPlugin.class);
        // AL6: alarma dominical autónoma (AlarmManager exacto + full-screen).
        registerPlugin(AlarmSchedulerPlugin.class);
        super.onCreate(savedInstanceState);

        // WV-GUARD: si el WebView es demasiado viejo para Angular 21, reemplazamos
        // la vista del bridge por un mensaje nativo accionable (el WebView del
        // bridge queda descartado; su SyntaxError en JS es inofensivo a nivel
        // nativo). No seguimos con el resto del setup del WebView.
        int major = webViewChromiumMajor();
        if (major > 0 && major < MIN_CHROMIUM_MAJOR) {
            showUnsupportedWebViewScreen(major);
            return;
        }

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

        // AO7 — TOPE de la escala de fuente del sistema. El WebView refleja el
        // "Tamaño de fuente" de Ajustes de Android como textZoom (ej. 130 = 130%).
        // Con escalas muy grandes (caso RAMIREZ) los tiles y textos reventaban el
        // layout. Capamos a 140% para conservar algo de accesibilidad SIN destruir la
        // distribución (el CSS ya degrada con elipsis/columnas fluidas). Ajustable.
        capTextZoom();
    }

    /** AO7 — limita el textZoom (escala de fuente del sistema) a un máximo razonable. */
    private void capTextZoom() {
        try {
            WebSettings ws = getBridge().getWebView().getSettings();
            ws.setTextZoom(Math.min(ws.getTextZoom(), 140));
        } catch (Exception ignored) {
            // nunca romper el arranque por esto
        }
    }

    /**
     * WV-GUARD — Major version del motor Chromium del WebView actual (ej. 81 de
     * "81.0.4044.138"), o -1 si no se puede determinar (API < 26 o sin proveedor).
     * En esos casos NO bloqueamos (devolvemos -1) para no romper equipos válidos.
     */
    private int webViewChromiumMajor() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return -1;
            PackageInfo pkg = WebView.getCurrentWebViewPackage();
            if (pkg == null || pkg.versionName == null) return -1;
            String major = pkg.versionName.split("\\.")[0];
            return Integer.parseInt(major.trim());
        } catch (Exception e) {
            return -1;
        }
    }

    /**
     * WV-GUARD — Pantalla nativa (sin depender de la app web) que le explica al
     * usuario, en español claro, que su "Android System WebView" está viejo y le
     * da un botón para actualizarlo en la tienda. Se construye en código para no
     * depender de recursos/layout que quizá tampoco carguen.
     */
    private void showUnsupportedWebViewScreen(int major) {
        int pad = dp(24);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#121212"));
        root.setPadding(pad, pad, pad, pad);

        TextView emoji = new TextView(this);
        emoji.setText("⚠️");
        emoji.setTextSize(TypedValue.COMPLEX_UNIT_SP, 48);
        emoji.setGravity(Gravity.CENTER);
        root.addView(emoji);

        TextView title = new TextView(this);
        title.setText("Actualiza el navegador del sistema");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(16), 0, dp(12));
        root.addView(title);

        TextView body = new TextView(this);
        body.setText(
            "Esta app necesita una versión más nueva de “Android System WebView” "
                + "para poder funcionar.\n\nLa versión de tu equipo (" + major + ") es muy vieja "
                + "y por eso la pantalla sale en blanco.\n\nToca ACTUALIZAR, instala la actualización "
                + "y vuelve a abrir la app. Si no te deja, pídele ayuda a Tecnología.");
        body.setTextColor(Color.parseColor("#C9C9C9"));
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        body.setGravity(Gravity.CENTER);
        body.setLineSpacing(dp(4), 1f);
        root.addView(body);

        Button update = new Button(this);
        update.setText("ACTUALIZAR");
        update.setAllCaps(true);
        update.setTextColor(Color.parseColor("#121212"));
        update.setBackgroundColor(Color.parseColor("#FF5F00"));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        bp.topMargin = dp(28);
        update.setLayoutParams(bp);
        update.setOnClickListener((View v) -> openWebViewUpdate());
        root.addView(update);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#121212"));
        scroll.addView(root);
        setContentView(scroll);
    }

    /** WV-GUARD — Abre la ficha de "Android System WebView" en la tienda (Play, o
     * el navegador como respaldo) para que el usuario la actualice. */
    private void openWebViewUpdate() {
        String id = "com.google.android.webview";
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + id));
            i.setPackage("com.android.vending");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=" + id))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
