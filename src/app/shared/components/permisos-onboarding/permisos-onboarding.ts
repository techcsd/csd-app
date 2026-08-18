import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { PermissionsService, PermState } from '../../../core/services/permissions.service';
import { NativeAlarmService } from '../../../core/services/native-alarm.service';
import { LocalStore } from '../../../core/services/local-store.service';

const FLAG = 'csd_permisos_onboarding_v2';

type Estado = 'idle' | 'ok' | 'no' | 'ajustes';

/**
 * AL5 — Onboarding de permisos de UNA sola vez. Al primer arranque (nativo)
 * explica y solicita en cadena TODOS los permisos que usa la app: cámara,
 * micrófono, ubicación (+ "todo el tiempo" vía Ajustes), notificaciones, alarmas
 * exactas y exclusión de batería. Los que Android no deja pedir directo se guían
 * con deep-link a Ajustes. No vuelve a pedir a cada rato: solo corre una vez
 * (flag) — el resto del tiempo, cada feature pide su permiso puntual con su gate.
 * PWA iOS: no aplica (permisos por uso; sin alarmas autónomas) → no se muestra.
 */
@Component({
  selector: 'app-permisos-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './permisos-onboarding.html',
  styleUrl: './permisos-onboarding.scss',
})
export class PermisosOnboarding {
  private permissions = inject(PermissionsService);
  private nativeAlarm = inject(NativeAlarmService);
  private store = inject(LocalStore);

  visible = signal(false);
  corriendo = signal(false);

  camara = signal<Estado>('idle');
  ubicacion = signal<Estado>('idle');
  micro = signal<Estado>('idle');
  notif = signal<Estado>('idle');
  alarma = signal<Estado>('idle');
  bateria = signal<Estado>('idle');

  constructor() {
    // Solo nativo y una sola vez.
    if (!Capacitor.isNativePlatform()) return;
    void this.evaluarVisibilidad();
  }

  /**
   * AT-batería — el flag vive en LocalStore (Preferences en nativo) para SOBREVIVIR
   * a las actualizaciones del APK: así el onboarding de permisos (incluida la
   * batería) se pide una sola vez y no reaparece tras cada update. Migra el flag
   * viejo de `localStorage` para no re-mostrarlo a quien ya lo completó.
   */
  private async evaluarVisibilidad(): Promise<void> {
    try {
      if (await this.store.get(FLAG)) return;
    } catch {
      /* si el store falla, seguimos evaluando */
    }
    // Migración: instalaciones previas guardaron el flag en localStorage.
    try {
      if (localStorage.getItem(FLAG)) {
        await this.store.set(FLAG, '1');
        return;
      }
    } catch {
      /* ignore */
    }
    this.visible.set(true);
  }

  private mark(sig: ReturnType<typeof signal<Estado>>, st: PermState): void {
    sig.set(st === 'granted' ? 'ok' : st === 'unavailable' ? 'ajustes' : 'no');
  }

  /** Solicita en cadena los permisos directos; los de Ajustes se abren aparte. */
  async activar(): Promise<void> {
    if (this.corriendo()) return;
    this.corriendo.set(true);
    try {
      this.mark(this.camara, await this.permissions.request('camera'));
      this.mark(this.micro, await this.permissions.request('mic'));
      this.mark(this.ubicacion, await this.permissions.request('location'));
      // Notificaciones: en nativo van por FCM (POST_NOTIFICATIONS en Android 13+).
      try {
        const r = await PushNotifications.requestPermissions();
        this.notif.set(r.receive === 'granted' ? 'ok' : 'no');
      } catch {
        this.notif.set('no');
      }
    } finally {
      this.corriendo.set(false);
    }
  }

  /** Ubicación "todo el tiempo": Android exige hacerlo desde Ajustes. */
  async ubicacionSiempre(): Promise<void> {
    await this.permissions.openAppSettings();
    this.ubicacion.set('ajustes');
  }

  async pedirAlarma(): Promise<void> {
    await this.nativeAlarm.openExactAlarmSettings();
    this.alarma.set('ajustes');
  }

  async pedirBateria(): Promise<void> {
    await this.nativeAlarm.requestIgnoreBatteryOptimizations();
    this.bateria.set('ajustes');
  }

  async finish(): Promise<void> {
    try {
      await this.store.set(FLAG, '1');
    } catch {
      /* ignore */
    }
    // Fallback legacy (por si el store nativo fallara).
    try {
      localStorage.setItem(FLAG, '1');
    } catch {
      /* ignore */
    }
    this.visible.set(false);
  }
}
