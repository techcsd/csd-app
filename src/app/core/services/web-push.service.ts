import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { SwPush } from '@angular/service-worker';
import { SupabaseService } from './supabase.service';
import { NotificacionesService, notifAppRoute } from './notificaciones.service';
import { NavGuardService } from './nav-guard.service';
import { environment } from '../../../environments/environment';

/**
 * CF4c — Web Push REAL para la PWA (iPhone/iOS 16.4+ instalado en pantalla de inicio,
 * y cualquier navegador web: Chrome/Firefox/Edge/Android-web). Complementa a
 * `PushService` (FCM nativo, solo Android): aquí usamos la Push API estándar con
 * VAPID. La suscripción (endpoint + claves p256dh/auth) se guarda en SGC
 * (`registrar_web_push`) y el edge `send-web-push` la empuja firmada con VAPID.
 *
 * ngsw (el service worker de Angular) ya maneja el evento `push` y pinta la
 * notificación desde el payload `{ notification: { title, body, data } }`; aquí solo
 * (1) suscribimos, (2) deep-linkeamos el tap (`SwPush.notificationClicks`) y
 * (3) refrescamos el campanario en primer plano.
 *
 * iOS exige que el permiso se pida dentro de un GESTO del usuario → `enable()` (botón).
 * `init()`/`syncAfterLogin()` NO piden permiso: solo re-aseguran la suscripción si ya
 * fue concedido. No-op fuera de la PWA/web (en el APK nativo manda `PushService`).
 */
@Injectable({ providedIn: 'root' })
export class WebPushService {
  private swPush = inject(SwPush);
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private notifs = inject(NotificacionesService);
  private navGuard = inject(NavGuardService);

  private started = false;

  /** Web Push aplica solo en la PWA/web (no en el APK nativo), con SW activo, API de
   *  push disponible y clave VAPID configurada. */
  get soportado(): boolean {
    return (
      !Capacitor.isNativePlatform() &&
      this.swPush.isEnabled &&
      typeof Notification !== 'undefined' &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      'serviceWorker' in navigator &&
      !!environment.vapidPublicKey
    );
  }

  /** Permiso del navegador: 'granted' | 'denied' | 'default', o 'unsupported'. */
  get permiso(): NotificationPermission | 'unsupported' {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }

  /** Estado para la UI del toggle. */
  get estado(): 'activas' | 'bloqueadas' | 'desactivadas' | 'no-soportado' {
    if (!this.soportado) return 'no-soportado';
    if (this.permiso === 'granted') return 'activas';
    if (this.permiso === 'denied') return 'bloqueadas';
    return 'desactivadas';
  }

  /**
   * Boot (App). No pide permiso (iOS exige gesto). Engancha el tap y, si el permiso ya
   * está concedido, re-asegura la suscripción (idempotente). No-op si no aplica.
   */
  async init(): Promise<void> {
    if (this.started || !this.soportado) return;
    this.started = true;

    // Tap en la notificación → deep-link (mismo mapa que la bandeja de avisos, AQ6).
    // AJ7 — pasa por el gate de navegación: no saca al usuario de un formulario abierto.
    this.swPush.notificationClicks.subscribe(({ notification }) => {
      const data = (notification.data ?? {}) as {
        tipo?: string;
        ruta?: string;
        referencia_id?: string;
        referencia_tipo?: string;
      };
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
    // Primer plano: refresca el contador del campanario (la in-app ya se insertó).
    this.swPush.messages.subscribe(() => void this.notifs.refreshNoLeidas().catch(() => {}));

    if (this.permiso === 'granted') await this.asegurarSuscripcion();
  }

  /** Tras login (Home). Si ya hay permiso, (re)registra la suscripción en SGC. */
  async syncAfterLogin(): Promise<void> {
    if (!this.soportado || this.permiso !== 'granted') return;
    await this.asegurarSuscripcion();
  }

  /**
   * Acción del usuario (botón "Activar notificaciones"). Pide permiso (gesto iOS) y
   * suscribe. Devuelve el resultado para que la UI muestre el mensaje adecuado.
   */
  async enable(): Promise<'ok' | 'denegado' | 'no-soportado' | 'error'> {
    if (!this.soportado) return 'no-soportado';
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return 'denegado';
      await this.asegurarSuscripcion();
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /** Al cerrar sesión: desactiva la suscripción en SGC (no se empuja al ex-usuario).
   *  No desuscribe el navegador: el próximo login la re-vincula al nuevo usuario. */
  async clear(): Promise<void> {
    if (!this.soportado) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await this.supabase.client.rpc('eliminar_web_push', { p_endpoint: sub.endpoint });
    } catch {
      /* best-effort */
    }
  }

  /** Reutiliza la suscripción existente o crea una nueva con la clave VAPID, y la
   *  registra en SGC. Idempotente (el RPC hace upsert por endpoint). */
  private async asegurarSuscripcion(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.vapidB64ToBuffer(environment.vapidPublicKey),
        });
      }
      await this.registrar(sub);
    } catch {
      /* permiso revocado / SW no listo / sin red: best-effort, se reintenta al reabrir */
    }
  }

  /** Guarda la suscripción (endpoint + claves) en SGC, atada al usuario en sesión. */
  private async registrar(sub: PushSubscription): Promise<void> {
    const j = sub.toJSON();
    const p256dh = j.keys?.['p256dh'];
    const auth = j.keys?.['auth'];
    if (!p256dh || !auth) return;
    try {
      await this.supabase.client.rpc('registrar_web_push', {
        p_endpoint: sub.endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
        p_plataforma: this.esIOS() ? 'ios' : 'web',
      });
    } catch {
      /* sin sesión aún / offline: se reintenta en el próximo syncAfterLogin(). */
    }
  }

  /** ¿iPhone/iPad? (para registrar la plataforma de la suscripción). */
  private esIOS(): boolean {
    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  }

  /** Clave VAPID pública (base64url) → ArrayBuffer para `applicationServerKey`. */
  private vapidB64ToBuffer(base64url: string): ArrayBuffer {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    const b64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const buf = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
    return buf;
  }
}
