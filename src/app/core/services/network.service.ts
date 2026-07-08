import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';

/**
 * Connectivity as a signal. Capacitor's Network plugin has a web
 * implementation (navigator.onLine) so this works identically on APK and PWA.
 * The SyncService watches `online` to drain the outbox.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private _online = signal<boolean>(true);
  online = this._online.asReadonly();

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const status = await Network.getStatus();
      this._online.set(status.connected);
      await Network.addListener('networkStatusChange', (s) => this._online.set(s.connected));
    } catch {
      // Fallback for environments without the plugin bridge.
      this._online.set(navigator.onLine);
      window.addEventListener('online', () => this._online.set(true));
      window.addEventListener('offline', () => this._online.set(false));
    }
  }
}
