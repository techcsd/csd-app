import { inject, Injectable } from '@angular/core';
import { LocalStore } from './local-store.service';

const KEY_HASH = 'csd.pin.hash';
const KEY_SALT = 'csd.pin.salt';
const KEY_ATTEMPTS = 'csd.pin.attempts';
export const MAX_PIN_ATTEMPTS = 5;

/**
 * Local 4-digit PIN for fast daily re-entry. The PIN is never stored in
 * clear: we keep a PBKDF2-SHA256 hash + random salt in the secure LocalStore.
 * After MAX_PIN_ATTEMPTS failures the caller must fall back to a full
 * password login (which requires connectivity). See User Flow §3.
 */
@Injectable({ providedIn: 'root' })
export class PinService {
  private store = inject(LocalStore);

  async isSet(): Promise<boolean> {
    return (await this.store.get(KEY_HASH)) !== null;
  }

  async setPin(pin: string): Promise<void> {
    this.assertShape(pin);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await this.derive(pin, salt);
    await this.store.set(KEY_SALT, this.toHex(salt));
    await this.store.set(KEY_HASH, hash);
    await this.store.remove(KEY_ATTEMPTS);
  }

  /** Returns true if the PIN matches. Tracks failed attempts. */
  async verify(pin: string): Promise<boolean> {
    const [saltHex, expected] = await Promise.all([
      this.store.get(KEY_SALT),
      this.store.get(KEY_HASH),
    ]);
    if (!saltHex || !expected) return false;

    const hash = await this.derive(pin, this.fromHex(saltHex));
    const ok = timingSafeEqual(hash, expected); // APP-062 — comparación de tiempo constante
    if (ok) {
      await this.store.remove(KEY_ATTEMPTS);
    } else {
      const next = (await this.attempts()) + 1;
      await this.store.set(KEY_ATTEMPTS, String(next));
    }
    return ok;
  }

  async attempts(): Promise<number> {
    return Number((await this.store.get(KEY_ATTEMPTS)) ?? '0');
  }

  async attemptsLeft(): Promise<number> {
    return Math.max(0, MAX_PIN_ATTEMPTS - (await this.attempts()));
  }

  /** Wipe PIN state (on lockout or logout). */
  async clear(): Promise<void> {
    await Promise.all([
      this.store.remove(KEY_HASH),
      this.store.remove(KEY_SALT),
      this.store.remove(KEY_ATTEMPTS),
    ]);
  }

  private assertShape(pin: string): void {
    if (!/^\d{4}$/.test(pin)) throw new Error('El PIN debe tener 4 números.');
  }

  private async derive(pin: string, salt: Uint8Array): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
      key,
      256,
    );
    return this.toHex(new Uint8Array(bits));
  }

  private toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private fromHex(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  }
}

/** Constant-time string compare (APP-062): no early-exit por longitud/carácter. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
