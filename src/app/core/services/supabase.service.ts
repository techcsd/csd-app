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
}
