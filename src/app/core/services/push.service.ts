import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App as CapApp } from '@capacitor/app';
import { SupabaseService } from './supabase.service';
import { NotificacionesService, notifAppRoute } from './notificaciones.service';
import { AVISOS_CHANNEL_ID } from '../constants/notif';
import { NavGuardService } from './nav-guard.service';
import { AlarmaService } from './alarma.service';
import { ErrorReportService } from './error-report.service';
import { SyncService } from '../sync/sync.service';
import { environment } from '../../../environments/environment';

/**
 * AF7 — Notificaciones push nativas (Android/FCM). La infraestructura vive en
 * SGC (tabla device_tokens + edge function send-push; `notificar` per-usuario ya
 * espeja push). Aquí registramos el token del dispositivo y deep-linkeamos al tap.
 *
 * PWA iOS / web: NO hay push nativo fiable → se aplica el fallback documentado en
 * PROMPT-1 (solo notificaciones in-app, badge en el campanario). init() es no-op
 * fuera de plataforma nativa.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private notifs = inject(NotificacionesService);
  private navGuard = inject(NavGuardService);
  private alarma = inject(AlarmaService);
  private errorReport = inject(ErrorReportService);
  private sync = inject(SyncService);

  private started = false;
  private token: string | null = null;

  /** BU1 F2.1 — ¿la plataforma soporta push? (nativo). En web/PWA no aplica. */
  get soportado(): boolean {
    return Capacitor.isNativePlatform();
  }
  /** ¿Hay push REAL disponible? Requiere FCM configurado (google-services.json).
   *  El flavor dev sin el JSON de Firebase nunca obtiene token → false; "Acerca de"
   *  lo muestra para que se sepa que ese build no recibe push. */
  get disponible(): boolean {
    return !!this.token;
  }

  /** Se llama una vez al arrancar la app (App). No-op en web/PWA. */
  async init(): Promise<void> {
    if (this.started || !Capacitor.isNativePlatform()) return;
    this.started = true;

    // BU1 F2 — el flavor dev puede NO tener Firebase (google-services.json del flavor,
    // pendiente de Xaviel). `PushNotifications.register()` invoca el nativo
    // `FirebaseMessaging.getInstance()`, que LANZA si Firebase no está inicializado y
    // **CRASHEA la app al arrancar** (excepción nativa, no atrapable desde JS). Por eso
    // en dev NO arrancamos push. "Acerca de" ya muestra "Push: No disponible en este
    // build". Para habilitar push en dev: bundlea android/app/src/dev/google-services.json
    // y relaja este guard.
    if (environment.entorno === 'dev') return;

    await PushNotifications.addListener('registration', (t) => {
      this.token = t.value;
      void this.syncToken();
    });
    await PushNotifications.addListener('registrationError', () => {
      /* best-effort: sin token no hay push, pero las in-app siguen. */
    });
    // Foreground: refresca el contador del campanario (la in-app ya se insertó).
    // AK10 — si es la push de alarma dominical, dispara la alarma tipo despertador.
    await PushNotifications.addListener('pushNotificationReceived', (n) => {
      void this.notifs.refreshNoLeidas().catch(() => {});
      const raw = (n?.data ?? {}) as Record<string, string>;
      // CC7 — Tecnología pidió reintentar / subir evidencia de un envío atascado.
      if (this.manejarPushOutbox(raw)) return;
      const data = (n?.data ?? {}) as { tipo?: string; alarma?: string | boolean; ruta?: string; vehiculo_id?: string };
      // AK10 legacy + AL6 canónico (alarm-weekly-inspection) + flag genérico alarma.
      const esAlarma =
        data.tipo === 'alarm-weekly-inspection' ||
        data.tipo === 'alarma-reporte-semanal' ||
        data.alarma === true ||
        data.alarma === 'true';
      // CK10 — push normal (mensaje/trabajo) con la app en primer plano: Android NO
      // muestra banner ni suena cuando la app está abierta. Posteamos una notificación
      // LOCAL sobre el canal de alta importancia para que se vea/oiga igual. Alarma y
      // outbox ya se manejan arriba y NO deben duplicarse como notif local.
      if (!esAlarma) void this.notificarLocal(raw, n?.title ?? null, n?.body ?? null);
      if (esAlarma) {
        // CA1 — cinturón-y-tirantes del filtro del servidor: antes de sonar la alarma a
        // pantalla completa, verifica la preferencia local (mis_notif_operativas). Si el
        // usuario la tiene apagada o Tecnología lo silenció, NO suena; y se registra
        // (nivel info) que llegó igual, para saber si el emisor la mandó de más.
        const alarmaTipo = data.tipo === 'alarm-weekly-inspection' ? 'alarm-weekly-inspection' : 'alarma-reporte-semanal';
        const disparar = () =>
          this.alarma.disparar({ vehiculoId: data.vehiculo_id ?? null, ruta: data.ruta ?? '/transporte/reporte-semanal' });
        void this.notifs
          .alarmaSuprimida(alarmaTipo)
          .then((suprimida) => {
            if (suprimida) {
              void this.errorReport.report('info', 'alarma suprimida por preferencia', { tipo: alarmaTipo, origen: 'push' });
              return;
            }
            disparar();
          })
          .catch(() => disparar()); // ante fallo del gate, comportamiento actual (sonar)
      }
    });
    // Tap en la push → deep-link (mismo mapa que la bandeja de avisos, AF6).
    // AJ7 — el deep-link pasa por el gate de navegación: si el usuario está en un
    // formulario en curso, se difiere hasta que lo cierre (nunca lo saca del form).
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const raw = (a.notification?.data ?? {}) as Record<string, string>;
      // CC7 — al tocar la push de reintento/evidencia, actuar (no hay ruta a la que ir).
      if (this.manejarPushOutbox(raw)) return;
      this.deepLinkFromData(raw);
    });

    // CK10 — tap en la notificación LOCAL (la que posteamos en primer plano): el
    // deep-link sale del `extra` que adjuntamos = los mismos `data` de la push.
    await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const raw = (a.notification?.extra ?? {}) as Record<string, string>;
      this.deepLinkFromData(raw);
    });

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;
    await PushNotifications.register();

    // CK10 — al volver a primer plano, re-registra: FCM puede haber rotado el token;
    // `register()` re-dispara `registration` con el token vigente → syncToken() hace
    // upsert solo si cambió. Best-effort (nunca romper el resume).
    CapApp.addListener('resume', () => {
      void PushNotifications.register().catch(() => {});
    }).catch(() => {});
  }

  /**
   * CK10 — deep-link compartido por el tap de la push remota y el de la notif local.
   * AQ1/AQ6 — usa la entidad asociada (echada, versión, conduce…). AJ7 — pasa por el
   * gate de navegación (no saca al usuario de un formulario en curso).
   */
  private deepLinkFromData(data: Record<string, string>): void {
    const dest = notifAppRoute({
      tipo: data['tipo'] ?? 'info',
      ruta: data['ruta'] ?? null,
      referencia_id: data['referencia_id'] ?? null,
      referencia_tipo: data['referencia_tipo'] ?? null,
    });
    if (dest && dest !== '/home') {
      this.navGuard.requestNav(() => void this.router.navigateByUrl(dest).catch(() => {}));
    }
  }

  /**
   * CK10 — postea una notificación LOCAL sobre el canal de alta importancia para que
   * una push normal suene/aparezca aunque la app esté abierta (Android silencia las
   * push en primer plano). El `extra` lleva los `data` de la push → el tap deep-linkea.
   */
  private async notificarLocal(
    data: Record<string, string>,
    title: string | null,
    body: string | null,
  ): Promise<void> {
    const titulo = title || data['title'] || data['titulo'] || 'CSD App';
    const cuerpo = body || data['body'] || data['mensaje'] || '';
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 2147483647, // id efímero (int32) — no reutilizable
            channelId: AVISOS_CHANNEL_ID,
            title: titulo,
            body: cuerpo,
            extra: data,
          },
        ],
      });
    } catch {
      /* best-effort: si falla el schedule, la in-app + badge ya quedaron. */
    }
  }

  /**
   * CC7 — pushes de "Outbox atascado" (Tecnología desde la web): `outbox_reintentar`
   * reintenta ese envío YA; `outbox_subir_evidencia` fuerza subir payload+fotos al
   * bucket privado. El match del envío se hace por `atascado_id` (guardado al reportar)
   * o por `salida_id`. Devuelve true si la push era de outbox (para no seguir al
   * deep-link genérico). Best-effort: si no encuentra el envío, no rompe nada.
   */
  private manejarPushOutbox(data: Record<string, string>): boolean {
    const tipo = data['type'] ?? data['tipo'];
    if (tipo !== 'outbox_reintentar' && tipo !== 'outbox_subir_evidencia') return false;
    const info = { atascado_id: data['atascado_id'], salida_id: data['salida_id'] };
    if (tipo === 'outbox_reintentar') void this.sync.reintentarAtascadoRemoto(info).catch(() => {});
    else void this.sync.forzarSubirEvidencia(info).catch(() => {});
    return true;
  }

  /**
   * Registra/renueva el token del usuario actual en SGC. Se reintenta tras el
   * login/desbloqueo (el token puede llegar antes de haber sesión). Idempotente.
   */
  async syncToken(): Promise<void> {
    if (!this.token || !Capacitor.isNativePlatform()) return;
    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    try {
      await this.supabase.client.rpc('registrar_device_token', {
        p_token: this.token,
        p_plataforma: platform,
      });
    } catch {
      /* sin sesión aún / offline: se reintenta en el próximo syncToken(). */
    }
  }

  /** Al cerrar sesión, desactiva el token para no seguir empujando al ex-usuario. */
  async clearToken(): Promise<void> {
    if (!this.token || !Capacitor.isNativePlatform()) return;
    try {
      await this.supabase.client.rpc('eliminar_device_token', { p_token: this.token });
    } catch {
      /* best-effort */
    }
  }
}
