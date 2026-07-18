import { inject, Injectable } from '@angular/core';
import { AuthError, Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { environment } from '../../../environments/environment';

export interface AuthResult {
  user: User | null;
  error: AuthError | null;
}

/** Resultado del login de conductor (cédula + PIN) vía edge `conductor-login`. */
export interface ConductorLoginResult {
  ok: boolean;
  /** HTTP status devuelto por la edge (401 incorrecto, 429 bloqueado…). */
  status: number;
  error?: string;
  /** Segundos que faltan para reintentar cuando `status === 429`. */
  retryInSeconds?: number;
}

/**
 * Auth against the same Supabase users as SGC. The session is persistent
 * (see SupabaseService storage); day-to-day re-entry is gated by a local PIN
 * (PinService), not by re-typing the password.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SupabaseService);

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { user: data.user, error };
  }

  /**
   * P5 — Login de conductor por cédula + PIN. Llama a la edge pública
   * `conductor-login` (que mapea cédula → email sintético, aplica el bloqueo por
   * intentos y devuelve la sesión) y, si va bien, la instala con `setSession`.
   * Online-only (igual que el login por correo). Maneja 401 (incorrecto) y 429
   * (bloqueado, con `retryInSeconds`).
   */
  async signInConductor(cedula: string, pin: string): Promise<ConductorLoginResult> {
    let res: Response;
    try {
      res = await fetch(`${environment.supabaseUrl}/functions/v1/conductor-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: environment.supabaseAnonKey,
          Authorization: `Bearer ${environment.supabaseAnonKey}`,
        },
        body: JSON.stringify({ cedula: cedula.trim(), pin: pin.trim() }),
      });
    } catch {
      return { ok: false, status: 0, error: 'No hay conexión. El acceso de conductor necesita internet.' };
    }
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      retryInSeconds?: number;
    };
    if (!res.ok || !body.access_token || !body.refresh_token) {
      return { ok: false, status: res.status, error: body.error, retryInSeconds: body.retryInSeconds };
    }
    const { error } = await this.supabase.client.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, status: 200 };
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    const { error } = await this.supabase.client.auth.signOut();
    return { error };
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session;
  }

  async getUser(): Promise<User | null> {
    const { data } = await this.supabase.client.auth.getUser();
    return data.user;
  }

  /** Recovery link points at the production PWA (SGC hard-rule #5). */
  async resetPassword(email: string): Promise<{ error: AuthError | null }> {
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${environment.appUrl}/auth/set-password`,
    });
    return { error };
  }

  async updatePassword(password: string): Promise<{ error: AuthError | null }> {
    const { error } = await this.supabase.client.auth.updateUser({ password });
    return { error };
  }

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    return this.supabase.client.auth.onAuthStateChange(callback);
  }
}
