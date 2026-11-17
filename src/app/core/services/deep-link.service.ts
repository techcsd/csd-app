import { Injectable } from '@angular/core';

import { notifAppRoute } from './notificaciones.service';

const CLAVE = 'csd.deeplink.pendiente';

/**
 * DS-52 / DS-49 — enlaces profundos que sobreviven a login + PIN.
 *
 * Un enlace (push, QR del conduce, `appUrlOpen`) puede llegar con la sesión caída o la app
 * bloqueada. Los guards (`authGuard`/`pinGuard`) guardan aquí el destino y, al terminar de
 * autenticar, la pantalla de PIN lo consume en vez de aterrizar siempre en `/home`.
 * Solo se recuerdan rutas internas (nunca `/auth/*`) y caducan a los 15 minutos.
 */
@Injectable({ providedIn: 'root' })
export class DeepLinkService {
  private memoria: { ruta: string; en: number } | null = null;
  private static readonly TTL_MS = 15 * 60 * 1000;

  /** Recuerda el destino pendiente (ignora rutas de auth y la raíz). */
  guardar(ruta: string | null | undefined): void {
    if (!ruta || !ruta.startsWith('/') || ruta.startsWith('/auth') || ruta === '/' || ruta === '/home') return;
    this.memoria = { ruta, en: Date.now() };
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify(this.memoria));
    } catch {
      // sin almacenamiento: queda solo en memoria.
    }
  }

  /** Devuelve y borra el destino pendiente (null si no hay o caducó). */
  consumir(): string | null {
    let v = this.memoria;
    if (!v) {
      try {
        const raw = sessionStorage.getItem(CLAVE);
        v = raw ? (JSON.parse(raw) as { ruta: string; en: number }) : null;
      } catch {
        v = null;
      }
    }
    this.memoria = null;
    try {
      sessionStorage.removeItem(CLAVE);
    } catch {
      // nada
    }
    if (!v || Date.now() - v.en > DeepLinkService.TTL_MS) return null;
    return v.ruta;
  }

  /**
   * Traduce una URL abierta desde fuera (`appUrlOpen`: QR, enlace web) a una ruta de la app.
   * `/conduce-qr/<token>` se conserva tal cual; el resto usa el mismo mapa que las push.
   */
  rutaDesdeUrl(url: string): string | null {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    // Esquema propio (<scheme>://conduce-qr/<token>): el primer segmento llega como host.
    const esEsquemaPropio = u.protocol !== 'http:' && u.protocol !== 'https:';
    const pathname = esEsquemaPropio ? `/${u.host}${u.pathname}`.replace(/\/+$/, '') : u.pathname;
    const path = `${pathname}${u.search}`;
    if (/^\/conduce-qr\/[^/]+$/.test(pathname)) return path;
    const dest = notifAppRoute({ tipo: 'info', ruta: path, referencia_id: null, referencia_tipo: null });
    return dest && dest !== '/home' ? dest : null;
  }
}
