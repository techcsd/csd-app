import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { DeviceInfoService } from './device-info.service';
import { AVISOS_CHANNEL_ID } from '../constants/notif';

/**
 * CK10 (parte B) — SALUD de las notificaciones. Mide si el usuario realmente puede
 * RECIBIR avisos sonoros:
 *   1) permiso del sistema otorgado (POST_NOTIFICATIONS en Android 13+ / iOS / web), y
 *   2) en Android, que el canal de alta importancia `avisos_csd_v2` NO haya sido bajado
 *      a importancia baja por el usuario (sin eso, llega sin sonido ni heads-up).
 *
 * Se usa para pintar una cinta/sección accionable ("Activar") en Perfil y en el shell.
 * Filosofía: ante CUALQUIER incertidumbre (plataforma rara, error de API, canal aún no
 * creado) devuelve `ok=true` — nunca molestar al usuario con una alarma falsa.
 */
export interface NotifSalud {
  /** ¿Puede recibir avisos sonoros? (permiso dado + canal en alta importancia). */
  ok: boolean;
  /** Causa del problema cuando `ok=false` ('ninguno' cuando está bien). */
  motivo: 'permiso' | 'canal' | 'ninguno';
  /** ¿El permiso del sistema está otorgado? */
  permiso: boolean;
  /** ¿El canal de alta importancia sigue en HIGH/MAX? (true en iOS/web: no hay canal). */
  canalOk: boolean;
  /** Fabricante del equipo (solo nativo Android; null en iOS/web). */
  fabricante: string | null;
  /** ¿El fabricante es de los que matan apps agresivamente (necesitan pasos extra)? */
  fabricanteAgresivo: boolean;
}

// Importancia de canal Android: 4 = HIGH (heads-up + sonido), 5 = MAX. < 4 = el usuario
// la bajó → llega silenciosa / sin banner.
const IMPORTANCIA_ALTA = 4;

// Fabricantes con gestión de batería agresiva (autostart/doze) que silencian las apps en
// segundo plano: requieren pasos manuales (ver guía de Soporte). Case-insensitive.
const OEM_AGRESIVOS = [
  'transsion', 'tecno', 'infinix', 'itel', 'xiaomi', 'redmi', 'poco',
  'huawei', 'honor', 'oppo', 'vivo', 'realme',
];

@Injectable({ providedIn: 'root' })
export class NotifHealthService {
  private deviceInfo = inject(DeviceInfoService);

  private _salud = signal<NotifSalud | null>(null);
  /** Último resultado evaluado (null hasta la primera llamada a `evaluar()`). */
  salud = this._salud.asReadonly();

  /** Evalúa (y cachea) la salud de notificaciones. Nunca lanza; ante duda → ok=true. */
  async evaluar(): Promise<NotifSalud> {
    const SANO: NotifSalud = {
      ok: true, motivo: 'ninguno', permiso: true, canalOk: true,
      fabricante: null, fabricanteAgresivo: false,
    };
    try {
      const plataforma = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

      // Fabricante (solo informativo en Android nativo).
      let fabricante: string | null = null;
      let agresivo = false;
      if (plataforma === 'android') {
        try {
          const info = await this.deviceInfo.ready();
          fabricante = info.manufacturer;
          agresivo = this.esAgresivo(fabricante);
        } catch {
          /* best-effort: sin info del equipo seguimos sin marcarlo agresivo */
        }
      }

      const permiso = await this.permisoOtorgado(plataforma);
      if (!permiso) {
        return this.set({ ok: false, motivo: 'permiso', permiso: false, canalOk: false, fabricante, fabricanteAgresivo: agresivo });
      }

      // iOS / web (PWA): no hay canales → la salud es solo el permiso.
      if (plataforma !== 'android') {
        return this.set({ ok: true, motivo: 'ninguno', permiso: true, canalOk: true, fabricante: null, fabricanteAgresivo: false });
      }

      // Android: el usuario puede haber bajado la importancia del canal.
      const canalOk = await this.canalEnAltaImportancia();
      return this.set({
        ok: canalOk,
        motivo: canalOk ? 'ninguno' : 'canal',
        permiso: true,
        canalOk,
        fabricante,
        fabricanteAgresivo: agresivo,
      });
    } catch {
      return this.set(SANO);
    }
  }

  private set(s: NotifSalud): NotifSalud {
    this._salud.set(s);
    return s;
  }

  private esAgresivo(fabricante: string | null): boolean {
    if (!fabricante) return false;
    const f = fabricante.toLowerCase();
    return OEM_AGRESIVOS.some((o) => f.includes(o));
  }

  /** ¿El permiso del sistema de notificaciones está otorgado? Ante error → true (no molestar). */
  private async permisoOtorgado(plataforma: string): Promise<boolean> {
    try {
      if (plataforma === 'android' || plataforma === 'ios') {
        // En Android 13+ `receive` refleja POST_NOTIFICATIONS; en iOS, el permiso de push.
        const p = await PushNotifications.checkPermissions();
        return p.receive === 'granted';
      }
      // Web/PWA: notificaciones locales (mapea a Notification.permission).
      const p = await LocalNotifications.checkPermissions();
      return p.display === 'granted';
    } catch {
      return true;
    }
  }

  /** Android: ¿el canal de avisos sigue en importancia alta (≥ HIGH)? Ante duda → true. */
  private async canalEnAltaImportancia(): Promise<boolean> {
    try {
      const { channels } = await LocalNotifications.listChannels();
      const canal = channels?.find((c) => c.id === AVISOS_CHANNEL_ID);
      // Si el canal aún no existe (lo crea MainActivity al abrir), no molestamos.
      if (!canal) return true;
      return (canal.importance ?? IMPORTANCIA_ALTA) >= IMPORTANCIA_ALTA;
    } catch {
      return true;
    }
  }
}
