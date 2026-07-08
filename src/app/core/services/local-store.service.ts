import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Small async key-value store for lightweight config (PIN hash, active obra,
 * preferences). Uses Capacitor Preferences on native (Keystore-backed) and
 * localStorage on the PWA. Bulk offline data lives in Dexie, not here.
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  private native = Capacitor.isNativePlatform();

  async get(key: string): Promise<string | null> {
    if (this.native) {
      return (await Preferences.get({ key })).value ?? null;
    }
    return localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.native) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    if (this.native) {
      await Preferences.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  }
}
