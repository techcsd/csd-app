import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** Estado de los permisos/estado de la alarma nativa (AlarmScheduler). */
export interface AlarmStatus {
  active: boolean;
  canExact: boolean;
  ignoringBattery: boolean;
  notificationsEnabled: boolean;
}

interface AlarmSchedulerPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
  status(): Promise<AlarmStatus>;
  openExactAlarmSettings(): Promise<void>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  openNotificationSettings(): Promise<void>;
}

const AlarmScheduler = registerPlugin<AlarmSchedulerPlugin>('AlarmScheduler');

/**
 * AL6 — Puente a la alarma dominical AUTÓNOMA (plugin nativo AlarmScheduler).
 * La app decide cuándo activarla (vehículo en uso + inspección pendiente) y la
 * cancela al completarla; lo nativo dispara con la app cerrada. En web/PWA es
 * no-op (iOS no permite alarmas autónomas — documentado).
 */
@Injectable({ providedIn: 'root' })
export class NativeAlarmService {
  get disponible(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** Arma la alarma dominical (idempotente). */
  async enable(): Promise<void> {
    if (!this.disponible) return;
    try {
      await AlarmScheduler.enable();
    } catch {
      /* best-effort: nunca estorbar el arranque */
    }
  }

  /** Cancela la alarma (inspección hecha o sin vehículo en uso). */
  async disable(): Promise<void> {
    if (!this.disponible) return;
    try {
      await AlarmScheduler.disable();
    } catch {
      /* best-effort */
    }
  }

  async status(): Promise<AlarmStatus | null> {
    if (!this.disponible) return null;
    try {
      return await AlarmScheduler.status();
    } catch {
      return null;
    }
  }

  async openExactAlarmSettings(): Promise<void> {
    if (this.disponible) await AlarmScheduler.openExactAlarmSettings().catch(() => {});
  }
  async requestIgnoreBatteryOptimizations(): Promise<void> {
    if (this.disponible) await AlarmScheduler.requestIgnoreBatteryOptimizations().catch(() => {});
  }
  async openNotificationSettings(): Promise<void> {
    if (this.disponible) await AlarmScheduler.openNotificationSettings().catch(() => {});
  }
}
