import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { PinService } from './pin.service';
import { WebauthnService } from './webauthn.service';
import { UserContextService } from './user-context.service';
import { PushService } from './push.service';
import { BorradorService } from './borrador.service';
import { NotificacionesService } from './notificaciones.service';

/**
 * Coordinates the boot flow: session → PIN → profile. `unlocked` lives in
 * memory only, so every fresh app launch re-asks for the PIN even though the
 * Supabase session persists (User Flow §2).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private auth = inject(AuthService);
  private pin = inject(PinService);
  private webauthn = inject(WebauthnService);
  private ctx = inject(UserContextService);
  private push = inject(PushService);
  private borradores = inject(BorradorService);
  private notificaciones = inject(NotificacionesService);

  private _unlocked = signal(false);
  unlocked = this._unlocked.asReadonly();

  async hasSession(): Promise<boolean> {
    return (await this.auth.getSession()) !== null;
  }

  /**
   * Loads the profile once per session if we don't have it yet. Usa la sesión
   * PERSISTIDA (getSession lee del storage local, funciona offline) en vez de
   * getUser() —que SIEMPRE hace una llamada de red y devuelve null sin señal—,
   * así en un arranque offline en frío sí obtenemos el userId y cargamos el
   * perfil cacheado (módulos disponibles offline). Los datos siguen protegidos
   * por RLS con el token real; el gate de "usuario activo" usa el perfil.
   */
  async ensureProfile(): Promise<void> {
    if (this.ctx.profile()) return;
    const session = await this.auth.getSession();
    const userId = session?.user?.id;
    if (userId) await this.ctx.loadProfile(userId);
  }

  markUnlocked(): void {
    this._unlocked.set(true);
  }

  /** Re-lock (require PIN again), e.g. after the app was in the background. */
  lock(): void {
    this._unlocked.set(false);
  }

  async logout(): Promise<void> {
    this.notificaciones.detenerRealtime(); // AM4 — cierra el canal del usuario saliente
    await this.push.clearToken(); // AF7 — desactiva el token antes de cerrar sesión
    await this.auth.signOut();
    await this.pin.clear();
    // X8 — la credencial de Face ID (PWA) es local a este usuario/dispositivo;
    // el próximo usuario la vuelve a registrar. La nativa (BiometricService) es
    // solo un flag y el diálogo del SO confirma al dueño real del teléfono.
    await this.webauthn.clear();
    // QA-18 — en un teléfono compartido varias claves de borrador no están
    // scopeadas por usuario; al cerrar sesión se limpian TODOS para que el
    // próximo usuario no vea/reanude lo que llenó el anterior. Best-effort.
    await this.borradores.clearAll();
    this.ctx.clear();
    this._unlocked.set(false);
  }
}
