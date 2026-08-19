import { inject, Injectable } from '@angular/core';
import { AuthError, Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { ErrorReportService } from './error-report.service';
import { environment } from '../../../environments/environment';

export interface AuthResult {
  user: User | null;
  error: AuthError | null;
  /** true si la demora agotó el timeout (red colgada / cold-start), no credenciales. */
  timedOut?: boolean;
}

/** Resultado del login de conductor (cédula + PIN) vía edge `conductor-login`. */
export interface ConductorLoginResult {
  ok: boolean;
  /** HTTP status devuelto por la edge (401 incorrecto, 429 bloqueado…). 0 = red/timeout. */
  status: number;
  error?: string;
  /** Segundos que faltan para reintentar cuando `status === 429`. */
  retryInSeconds?: number;
  /** true cuando el fallo fue de red/timeout (no de credenciales) → ofrecer reintento. */
  networkError?: boolean;
  /** id del usuario ya autenticado (evita un getUser() extra que podría colgarse). */
  userId?: string;
}

/** Se rechaza así cuando una llamada de auth agota su tiempo. */
class AuthTimeoutError extends Error {
  constructor() {
    super('auth-timeout');
    this.name = 'AuthTimeoutError';
  }
}

/**
 * Auth against the same Supabase users as SGC. The session is persistent
 * (see SupabaseService storage); day-to-day re-entry is gated by a local PIN
 * (PinService), not by re-typing the password.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SupabaseService);
  private errorReport = inject(ErrorReportService);

  /** Corta cualquier promesa de auth de Supabase (no acepta AbortSignal) para que
   *  el login NUNCA se quede cargando infinito si la red se cuelga. */
  private withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new AuthTimeoutError()), ms);
      Promise.resolve(p).then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    try {
      const { data, error } = await this.withTimeout(
        this.supabase.client.auth.signInWithPassword({ email: email.trim(), password }),
        12000,
      );
      return { user: data.user, error };
    } catch (e) {
      const timedOut = e instanceof AuthTimeoutError;
      void this.errorReport.report('login', timedOut ? 'signIn timeout (correo)' : 'signIn error (correo)', {
        via: 'correo', timedOut,
      });
      return { user: null, error: null, timedOut };
    }
  }

  /**
   * P5 — Login de conductor por cédula + PIN. Llama a la edge pública
   * `conductor-login` (que mapea cédula → email sintético, aplica el bloqueo por
   * intentos y devuelve la sesión) y, si va bien, la instala con `setSession`.
   * Online-only (igual que el login por correo). Maneja 401 (incorrecto) y 429
   * (bloqueado, con `retryInSeconds`).
   */
  async signInConductor(cedula: string, pin: string): Promise<ConductorLoginResult> {
    // R13 — timeout de 12s: un cold-start/red colgada dejaba el spinner para
    // siempre. AbortController corta el fetch y devolvemos un mensaje claro que
    // permite reintentar (el flag de carga vive en el caller y siempre se resetea
    // porque este método SIEMPRE retorna). Paridad con la web (Promise.race 12s).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
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
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      void this.errorReport.report('login', aborted ? 'conductor-login timeout' : 'conductor-login network error', {
        via: 'conductor', aborted,
      });
      return aborted
        ? { ok: false, status: 0, networkError: true, error: 'No pudimos verificar tus datos. La conexión tardó demasiado. Revisa tu internet e intenta de nuevo.' }
        : { ok: false, status: 0, networkError: true, error: 'No hay conexión. El acceso de conductor necesita internet.' };
    } finally {
      clearTimeout(timeout);
    }
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      retryInSeconds?: number;
    };
    if (!res.ok || !body.access_token || !body.refresh_token) {
      // 401 (credenciales) y 429 (bloqueo) son esperados; el resto (500, cuerpo raro)
      // es una falla de la edge → telemetría para diagnosticar (caso Manolo Duran).
      if (res.status !== 401 && res.status !== 429) {
        void this.errorReport.report('login', `conductor-login fallo ${res.status}`, {
          via: 'conductor', status: res.status, edgeError: body.error ?? null,
        });
      }
      return { ok: false, status: res.status, error: body.error, retryInSeconds: body.retryInSeconds };
    }
    // setSession puede tocar red (refresh) → mismo timeout para no colgar el spinner.
    let session;
    try {
      const r = await this.withTimeout(
        this.supabase.client.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token }),
        12000,
      );
      if (r.error) {
        void this.errorReport.report('login', 'conductor setSession error', { via: 'conductor', msg: r.error.message });
        return { ok: false, status: 500, error: 'No pudimos verificar tus datos. Intenta de nuevo.' };
      }
      session = r.data.session;
    } catch {
      void this.errorReport.report('login', 'conductor setSession timeout', { via: 'conductor' });
      return { ok: false, status: 0, networkError: true, error: 'No pudimos verificar tus datos. La conexión tardó demasiado. Intenta de nuevo.' };
    }
    return { ok: true, status: 200, userId: session?.user?.id };
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    const { error } = await this.supabase.client.auth.signOut();
    return { error };
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session;
  }

  /**
   * AY9 — true when a session is persisted on disk (refresh token present),
   * regardless of connectivity. This is the offline-first source of truth for
   * "logged in": the blob is cleared only by explicit logout or a server-confirmed
   * revocation, so it never yields a false logout on a network failure.
   */
  async hasStoredSession(): Promise<boolean> {
    return (await this.supabase.readStoredSession()) !== null;
  }

  /** AY9 — userId from the persisted session (offline-safe; no network round-trip). */
  async getStoredUserId(): Promise<string | undefined> {
    return (await this.supabase.readStoredSession())?.user?.id;
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
