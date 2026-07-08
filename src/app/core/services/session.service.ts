import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { PinService } from './pin.service';
import { UserContextService } from './user-context.service';

/**
 * Coordinates the boot flow: session → PIN → profile. `unlocked` lives in
 * memory only, so every fresh app launch re-asks for the PIN even though the
 * Supabase session persists (User Flow §2).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private auth = inject(AuthService);
  private pin = inject(PinService);
  private ctx = inject(UserContextService);

  private _unlocked = signal(false);
  unlocked = this._unlocked.asReadonly();

  /** One-shot: a single-module user is dropped straight into their module on
   *  launch, but coming back to Home manually still shows the button. */
  private autoEntered = false;
  consumeAutoEnter(): boolean {
    if (this.autoEntered) return false;
    this.autoEntered = true;
    return true;
  }

  async hasSession(): Promise<boolean> {
    return (await this.auth.getSession()) !== null;
  }

  /** Loads the profile once per session if we don't have it yet. */
  async ensureProfile(): Promise<void> {
    if (this.ctx.profile()) return;
    const user = await this.auth.getUser();
    if (user) await this.ctx.loadProfile(user.id);
  }

  markUnlocked(): void {
    this._unlocked.set(true);
  }

  /** Re-lock (require PIN again), e.g. after the app was in the background. */
  lock(): void {
    this._unlocked.set(false);
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
    await this.pin.clear();
    this.ctx.clear();
    this._unlocked.set(false);
    this.autoEntered = false;
  }
}
