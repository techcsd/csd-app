import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { SupabaseService } from './supabase.service';
import { NotificacionesService, notifAppRoute } from './notificaciones.service';
import { NavGuardService } from './nav-guard.service';
import { AlarmaService } from './alarma.service';

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

  private started = false;
  private token: string | null = null;

  /** Se llama una vez al arrancar la app (App). No-op en web/PWA. */
  async init(): Promise<void> {
    if (this.started || !Capacitor.isNativePlatform()) return;
    this.started = true;

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
      const data = (n?.data ?? {}) as { tipo?: string; alarma?: string | boolean; ruta?: string; vehiculo_id?: string };
      // AK10 legacy + AL6 canónico (alarm-weekly-inspection) + flag genérico alarma.
      if (
        data.tipo === 'alarm-weekly-inspection' ||
        data.tipo === 'alarma-reporte-semanal' ||
        data.alarma === true ||
        data.alarma === 'true'
      ) {
        this.alarma.disparar({ vehiculoId: data.vehiculo_id ?? null, ruta: data.ruta ?? '/transporte/reporte-semanal' });
      }
    });
    // Tap en la push → deep-link (mismo mapa que la bandeja de avisos, AF6).
    // AJ7 — el deep-link pasa por el gate de navegación: si el usuario está en un
    // formulario en curso, se difiere hasta que lo cierre (nunca lo saca del form).
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const data = (a.notification?.data ?? {}) as {
        tipo?: string;
        ruta?: string;
        referencia_id?: string;
        referencia_tipo?: string;
      };
      // AQ1/AQ6 — el deep-link usa la entidad asociada (echada, versión, conduce…).
      const dest = notifAppRoute({
        tipo: data.tipo ?? 'info',
        ruta: data.ruta ?? null,
        referencia_id: data.referencia_id ?? null,
        referencia_tipo: data.referencia_tipo ?? null,
      });
      if (dest && dest !== '/home') {
        this.navGuard.requestNav(() => void this.router.navigateByUrl(dest).catch(() => {}));
      }
    });

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;
    await PushNotifications.register();
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
