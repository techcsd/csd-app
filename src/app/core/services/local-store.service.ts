import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../../../environments/environment';

/**
 * Small async key-value store for lightweight config (PIN hash, active obra,
 * preferences). Uses Capacitor Preferences on native (Keystore-backed) and
 * localStorage on the PWA. Bulk offline data lives in Dexie, not here.
 *
 * BU1 F1.3 — las claves de DEV llevan prefijo `dev:` para que instalar prod y dev
 * en el MISMO navegador (mismo origen local, p. ej. localhost al alternar
 * env:dev/env:prod) no mezcle config/PIN/obra. PROD conserva las claves SIN prefijo
 * (retrocompat: no orfanamos la config ya guardada en el campo).
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  private native = Capacitor.isNativePlatform();
  private pfx = environment.entorno === 'dev' ? 'dev:' : '';

  async get(key: string): Promise<string | null> {
    const k = this.pfx + key;
    if (this.native) {
      return (await Preferences.get({ key: k })).value ?? null;
    }
    return localStorage.getItem(k);
  }

  async set(key: string, value: string): Promise<void> {
    const k = this.pfx + key;
    if (this.native) {
      await Preferences.set({ key: k, value });
    } else {
      localStorage.setItem(k, value);
    }
  }

  async remove(key: string): Promise<void> {
    const k = this.pfx + key;
    if (this.native) {
      await Preferences.remove({ key: k });
    } else {
      localStorage.removeItem(k);
    }
  }
}
