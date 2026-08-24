package com.constructorasd.csdapp;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * AL6-fix — Servicio FCM propio que EXTIENDE el de Capacitor. Su único añadido:
 * cuando llega la push dominical de ALARMA (data.tipo='alarm-weekly-inspection',
 * enviada como DATA-ONLY por send-push), dispara la alarma full-screen NATIVA
 * (WeeklyAlarm.fire) aunque la app esté en segundo plano / cerrada (no force-stop).
 * Así el "despertador" suena con la app cerrada, no solo cuando el usuario la abre.
 *
 * Para todo lo demás (pushes normales y el token FCM) delega en Capacitor via
 * super, sin cambiar nada. Se registra en el manifest en lugar del servicio de
 * Capacitor (tools:node=remove) — al heredar de él, onNewToken sigue funcionando.
 *
 * Nota: los mensajes DATA-ONLY entregan a onMessageReceived en foreground Y
 * background (salvo app force-stopped, límite de Android/MIUI que ningún código
 * puede sortear). Si la app está en primer plano, dejamos que la maneje la capa
 * JS (overlay in-app AlarmaHost) para conservar esa UX; en background disparamos
 * la alarma nativa.
 */
public class CsdMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String tipo = data.get("tipo");
        boolean esAlarma =
                "alarm-weekly-inspection".equals(tipo)
                        || "alarma-reporte-semanal".equals(tipo)
                        || "true".equals(data.get("alarma"));

        // La alarma en background la mostramos nativa; en foreground la deja el
        // overlay in-app (JS) para no cambiar esa experiencia.
        if (esAlarma && !MainActivity.isForeground) {
            try {
                WeeklyAlarm.fire(getApplicationContext(), data.get("titulo"), data.get("cuerpo"));
            } catch (Exception ignored) {
                // best-effort: si algo falla, no romper el servicio de push.
            }
            return; // no reenviar a Capacitor/JS (evita push duplicada silenciosa).
        }

        // Resto de pushes (y la alarma en foreground) → comportamiento de Capacitor.
        super.onMessageReceived(remoteMessage);
    }
}
