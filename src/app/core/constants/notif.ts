/**
 * CK10 — id del canal nativo de notificaciones de alta importancia (heads-up +
 * sonido). DEBE coincidir exactamente con:
 *  - MainActivity.java → PUSH_CHANNEL_ID
 *  - AndroidManifest.xml → default_notification_channel_id
 *  - el payload del servidor (send-push → android.notification.channel_id)
 * El canal lo crea MainActivity; desde JS solo programamos notificaciones locales
 * sobre él por id (para que suenen en primer plano con la app abierta).
 */
export const AVISOS_CHANNEL_ID = 'avisos_csd_v2';
