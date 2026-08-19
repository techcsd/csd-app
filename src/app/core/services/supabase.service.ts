import { Injectable } from '@angular/core';
import { createClient, SupportedStorage } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../../../environments/environment';

/**
 * On native Android we keep the Supabase session in Capacitor Preferences
 * (backed by encrypted SharedPreferences) instead of localStorage, so the
 * refresh token survives WebView storage purges. On the PWA we fall back to
 * localStorage. Same client, same `sgc` schema, same project as SGC web.
 */
const nativeStorage: SupportedStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    db: { schema: 'sgc' },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: Capacitor.isNativePlatform() ? nativeStorage : undefined,
    },
  });

  /**
   * Storage key supabase-js writes the session under. Derived EXACTLY like
   * supabase-js does (`sb-${hostname.split('.')[0]}-auth-token`) so we read the
   * same blob it wrote — do not hardcode/override it or existing sessions break.
   */
  private readonly authStorageKey = `sb-${new URL(environment.supabaseUrl).hostname.split('.')[0]}-auth-token`;

  /**
   * AY9 — reads the persisted session STRAIGHT FROM DISK, offline-safe: no
   * network, no token refresh, no ~30s blank-screen stall. Supabase only removes
   * this blob on an explicit logout or a server-CONFIRMED revocation — never on
   * a mere network failure — so "blob present with a refresh_token" is the honest
   * answer to "is this user still logged in?" even when `getSession()` returns
   * null because it couldn't refresh an expired access token while offline.
   */
  async readStoredSession(): Promise<{ user?: { id?: string }; refresh_token?: string } | null> {
    try {
      const raw = Capacitor.isNativePlatform()
        ? (await Preferences.get({ key: this.authStorageKey })).value
        : localStorage.getItem(this.authStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Modern auth-js persists the Session object directly; older builds wrap it
      // in { currentSession }. Handle both.
      const sess = parsed?.currentSession ?? parsed;
      return sess?.refresh_token ? sess : null;
    } catch {
      return null;
    }
  }
}
