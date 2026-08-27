import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';
import { UserContextService } from './user-context.service';

/**
 * "Entrar como" — un admin ve la app COMO otro usuario para reproducir sus
 * problemas de primera mano (paridad con la web, AZ10). Reutiliza los mismos
 * edges de producción, ya admin-gateados y auditados:
 *   · `admin-entrar-como`     → mint de un token de un-solo-uso (magic link) del
 *                               target; NO toca su contraseña; marca
 *                               app_metadata.impersonated_by; audita el inicio.
 *   · `admin-fin-impersonacion` → limpia la marca + audita el fin.
 *
 * Mecánica en la app (swap en sitio, sin recarga):
 *   1. Guarda la sesión del admin (tokens) en LocalStore.
 *   2. Canjea el `token_hash` con verifyOtp → la sesión pasa a ser el target.
 *   3. Recarga el perfil (ctx) → roles/módulos/banner reflejan al target.
 * Salir restaura la sesión del admin con setSession (funciona offline).
 *
 * Seguridad: el PIN es del DISPOSITIVO (del admin), no del usuario, así que la
 * suplantación no lo pide de nuevo ni al reiniciar. NO re-registramos push ni
 * tracking, así que la suplantación no secuestra las notificaciones ni el GPS
 * del dispositivo (siguen ligados al admin). El servidor exige is_admin() y
 * rechaza suplantar a otro admin o a uno mismo.
 */
interface ImpEstado {
  adminAccessToken: string;
  adminRefreshToken: string;
  adminId: string;
  targetId: string;
  targetNombre: string;
  startedAt: string; // ISO
}

@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);
  private ctx = inject(UserContextService);

  private readonly KEY = 'csd.impersonacion';
  /** Tope duro de 1h (paridad web AZ10): auto-salida al vencer. */
  private readonly MAX_MS = 60 * 60 * 1000;

  private _estado = signal<ImpEstado | null>(null);
  /** true mientras se está viendo como otro usuario. */
  readonly activo = computed(() => this._estado() !== null);
  readonly targetNombre = computed(() => this._estado()?.targetNombre ?? '');
  private cargado = false;

  /** Rehidrata el estado desde disco (una vez, al arrancar el shell). */
  async init(): Promise<void> {
    if (this.cargado) return;
    this.cargado = true;
    const raw = await this.store.get(this.KEY);
    if (raw) {
      try {
        this._estado.set(JSON.parse(raw) as ImpEstado);
      } catch {
        await this.store.remove(this.KEY);
      }
    }
    if (this.activo() && this.expirado()) void this.salir();
  }

  /** true si ya pasó el tope de 1h desde que empezó la suplantación. */
  expirado(): boolean {
    const e = this._estado();
    if (!e) return false;
    return Date.now() - new Date(e.startedAt).getTime() > this.MAX_MS;
  }

  /** Vuelve a mi usuario si la suplantación venció (llamar al arrancar/resume). */
  checkExpiracion(): void {
    if (this.activo() && this.expirado()) void this.salir();
  }

  /**
   * Entra como `targetId`. Devuelve `{ ok }`; si falla, `error` con el motivo del
   * servidor (no eres admin, es admin, eres tú mismo, sin email…).
   */
  async entrarComo(targetId: string, targetNombre: string): Promise<{ ok: boolean; error?: string }> {
    if (this.activo()) return { ok: false, error: 'Ya estás viendo como otro usuario. Sal primero.' };

    // Sesión del admin actual (para poder restaurarla al salir).
    const { data: sess } = await this.supabase.client.auth.getSession();
    const admin = sess?.session;
    if (!admin?.access_token || !admin?.refresh_token) {
      return { ok: false, error: 'No pude leer tu sesión.' };
    }
    const adminId = admin.user?.id ?? '';

    // El edge (admin-gateado, auditado) mint-ea un token de un solo uso del target.
    const { data, error } = await this.supabase.client.functions.invoke('admin-entrar-como', {
      body: { userId: targetId },
    });
    if (error) return { ok: false, error: await this.leerErrorEdge(error) };
    const res = data as { email?: string; nombre?: string; token_hash?: string; started_at?: string; error?: string };
    if (res?.error || !res?.token_hash) return { ok: false, error: res?.error ?? 'No se pudo iniciar la vista.' };

    const estado: ImpEstado = {
      adminAccessToken: admin.access_token,
      adminRefreshToken: admin.refresh_token,
      adminId,
      targetId,
      targetNombre: res.nombre ?? targetNombre,
      startedAt: res.started_at ?? new Date().toISOString(),
    };

    // Canjea el token → la sesión pasa a ser el target.
    const { error: otpErr } = await this.supabase.client.auth.verifyOtp({
      token_hash: res.token_hash,
      type: 'magiclink',
    });
    if (otpErr) return { ok: false, error: 'No se pudo abrir la sesión del usuario.' };

    await this.store.set(this.KEY, JSON.stringify(estado));
    this._estado.set(estado);

    // Recarga identidad: roles/módulos/es_prueba/banner ahora son del target.
    this.ctx.clear();
    await this.ctx.loadProfile(targetId);
    return { ok: true };
  }

  /** Vuelve a mi usuario (admin). Restaura la sesión localmente (sirve offline). */
  async salir(): Promise<void> {
    const e = this._estado();
    if (e) {
      try {
        await this.supabase.client.auth.setSession({
          access_token: e.adminAccessToken,
          refresh_token: e.adminRefreshToken,
        });
      } catch {
        /* si el access venció, el refresh_token reconstruye la sesión */
      }
    }
    await this.store.remove(this.KEY);
    this._estado.set(null);
    if (e) {
      this.ctx.clear();
      try {
        await this.ctx.loadProfile(e.adminId);
      } catch {
        /* offline: el perfil admin se rehidrata del cache en el próximo guard */
      }
      // Best-effort: limpia la marca del target + audita el fin.
      try {
        await this.supabase.client.functions.invoke('admin-fin-impersonacion', { body: { userId: e.targetId } });
      } catch {
        /* sin señal: la marca se limpia la próxima vez / no bloquea salir */
      }
    }
  }

  /** AU16 — el cuerpo del error de un edge viene en error.context (Response). */
  private async leerErrorEdge(error: unknown): Promise<string> {
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const b = await ctx.json();
        if (b?.error) return b.error as string;
      }
    } catch {
      /* cae al mensaje genérico */
    }
    return error instanceof Error ? error.message : 'No se pudo iniciar la vista.';
  }
}
