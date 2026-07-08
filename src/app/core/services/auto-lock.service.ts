import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from './session.service';
import { PinService } from './pin.service';

// Re-lock after this long in the background. Short enough to protect a phone
// left on a table; long enough that taking a photo (which backgrounds the
// WebView briefly) doesn't kick the user back to the PIN mid-capture.
const LOCK_AFTER_MS = 45_000;

/**
 * Requires the PIN again when the app is reopened after being in the
 * background (User Flow §2: "Reapertura de la app pide PIN"). The in-memory
 * unlock alone only covered a full cold start; this covers resume too.
 */
@Injectable({ providedIn: 'root' })
export class AutoLockService {
  private session = inject(SessionService);
  private pin = inject(PinService);
  private router = inject(Router);
  private hiddenAt: number | null = null;

  init(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
      } else if (document.visibilityState === 'visible') {
        void this.maybeLock();
      }
    });
  }

  private async maybeLock(): Promise<void> {
    const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = null;
    if (away < LOCK_AFTER_MS) return;
    if (!this.session.unlocked()) return;
    if (!(await this.pin.isSet())) return;
    this.session.lock();
    await this.router.navigate(['/auth/pin']);
  }
}
