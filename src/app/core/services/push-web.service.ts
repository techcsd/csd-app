import { inject, Injectable } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { SupabaseService } from './supabase.service';

/**
 * CO10/CO17 — Web Push REAL para la PWA (iOS 16.4+ instalada en inicio, y Android
 * Chrome PWA). Antes de esta ronda la app no tenía `pushManager`/VAPID en absoluto:
 * la cinta "notificaciones apagadas" pedía "Activar" pero no hacía nada en la PWA
 * (`permissions.openAppSettings()` es no-op fuera de nativo), y aunque el usuario
 * lograra activar el permiso del sistema, ningún aviso llegaba con la app cerrada.
 *
 * La llave pública VAPID NO es secreta (viaja al cliente por diseño del protocolo);
 * la privada vive solo como secreto del edge `send-push` (SGC). Mismo par para
 * dev y prod — ver `.env.local` (CO10/CO17, 2026-10-14) y `SGC/PARIDAD.md`.
 *
 * La notificación mientras la app está CERRADA la pinta `public/push-sw.js` (capa
 * sobre `ngsw-worker.js` — ver ese archivo para el porqué); este servicio solo se
 * ocupa del ciclo de vida de la SUSCRIPCIÓN (pedir permiso, suscribir, registrar en
 * el servidor, dar de baja).
 */
const VAPID_PUBLIC_KEY =
  'BHNqedpFDYkwzNiOG9s8ukSo6kJiQkYPdmgw0pKCX3YBuxVkdp66rMP6D4pCT1FyKlBBcdSeWETA3zm1JZ3hwFE';

@Injectable({ providedIn: 'root' })
export class PushWebService {
  private swPush = inject(SwPush);
  private supabase = inject(SupabaseService);

  /** ¿Hay Service Worker con push habilitado? (false en dev — el SW está apagado). */
  private get swDisponible(): boolean {
    return this.swPush.isEnabled;
  }

  /** iPhone/iPad (Safari o PWA) — iOS exige la PWA INSTALADA para Web Push. */
  private esIos(): boolean {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  }

  /** La PWA corre en modo standalone (instalada), o no es iOS (no lo necesita). */
  instalada(): boolean {
    if (!this.esIos()) return true;
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone;
    return standalone === true || matchMedia('(display-mode: standalone)').matches;
  }

  /** iOS < 16.4 no soporta Web Push en absoluto (sin importar instalación/permiso). */
  private iosVersionOk(): boolean {
    if (!this.esIos()) return true;
    const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); // "...iPhone OS 16_4 like Mac OS X"
    if (!m) return true; // no se pudo leer la versión → no bloquear de más
    const major = Number(m[1]);
    const minor = Number(m[2]);
    return major > 16 || (major === 16 && minor >= 4);
  }

  /**
   * ¿Este equipo PUEDE en principio recibir Web Push? (feature del navegador +
   * instalación + versión de iOS). Si es false, la cinta de Perfil/notif-health-band
   * NO debe pedir nada — no hay nada que activar.
   */
  soportado(): boolean {
    return this.swDisponible && this.instalada() && this.iosVersionOk();
  }

  /** Estado crudo del permiso del navegador ('default'|'granted'|'denied'). */
  permiso(): NotificationPermission {
    return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  }

  /** ¿Hay una suscripción PushManager activa ahora mismo? (permiso + subscribe hecho). */
  async activo(): Promise<boolean> {
    if (!this.soportado() || this.permiso() !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch {
      return false;
    }
  }

  /**
   * Gesto del usuario (botón "Activar" de la cinta): pide el permiso del navegador
   * (debe llamarse SIN awaits previos para no perder el gesto, como exige iOS),
   * suscribe con la llave VAPID y registra la suscripción en el servidor. true =
   * quedó activo.
   */
  async activar(): Promise<boolean> {
    if (!this.soportado()) return false;
    try {
      if (this.permiso() === 'default') {
        const resultado = await Notification.requestPermission();
        if (resultado !== 'granted') return false;
      }
      if (this.permiso() !== 'granted') return false;

      const sub = await this.swPush.requestSubscription({ serverPublicKey: VAPID_PUBLIC_KEY });
      const json = sub.toJSON();
      const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string };
      if (!json.endpoint || !keys.p256dh || !keys.auth) return false;

      const { error } = await this.supabase.client.rpc('registrar_suscripcion_web', {
        p_endpoint: json.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_plataforma: this.esIos() ? 'ios-pwa' : 'android-pwa',
        p_user_agent: navigator.userAgent,
      });
      return !error;
    } catch {
      return false;
    }
  }

  /** Desactiva: da de baja en el servidor y cancela la suscripción del navegador. */
  async desactivar(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      try {
        await this.supabase.client.rpc('baja_suscripcion_web', { p_endpoint: sub.endpoint });
      } catch {
        /* best-effort: igual se cancela la suscripción del navegador */
      }
      await sub.unsubscribe();
    } catch {
      /* best-effort */
    }
  }
}
