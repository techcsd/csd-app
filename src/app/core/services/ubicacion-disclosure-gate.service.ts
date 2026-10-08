import { inject, Injectable, signal } from '@angular/core';
import { ConsentService } from './consent.service';
import { PermissionsService } from './permissions.service';
import { LocalStore } from './local-store.service';

/**
 * CI5 — Aviso previo (prominent disclosure) de ubicación en segundo plano que exige
 * Google Play ANTES de pedir "Permitir todo el tiempo". Se muestra UNA vez, la
 * primera vez que el chofer elige un estado de jornada.
 *
 * - "Aceptar y continuar" → guarda set_consentimiento('ubicacion_fondo', true) y pide
 *   el permiso (Android 11+ lleva a Ajustes con la guía existente).
 * - "Ahora no" → sin rastreo; el estado se guarda igual. Las acciones de transporte
 *   que ya exigen GPS (AF26) lo siguen exigiendo.
 *
 * El servidor no distingue "nunca preguntado" de "dijo que no" (ambos = false), así
 * que guardamos un flag local "decidido" para mostrar la hoja exactamente una vez.
 */
const DECIDIDO_KEY = 'ubicacion_fondo_decidido';

@Injectable({ providedIn: 'root' })
export class UbicacionDisclosureGate {
  private consent = inject(ConsentService);
  private permissions = inject(PermissionsService);
  private store = inject(LocalStore);

  readonly visible = signal(false);
  private resolver: ((ok: boolean) => void) | null = null;

  /**
   * Muestra la hoja solo si aún no se ha decidido. Devuelve true si el rastreo en
   * segundo plano quedó autorizado. Idempotente: si ya se decidió, no interrumpe.
   */
  async pedir(): Promise<boolean> {
    const decidido = (await this.store.get(DECIDIDO_KEY)) === '1';
    if (decidido) return this.consent.tiene('ubicacion_fondo') === true;
    if (this.visible()) return new Promise<boolean>((res) => (this.resolver = res));
    this.visible.set(true);
    return new Promise<boolean>((res) => (this.resolver = res));
  }

  /** Muestra la hoja SIEMPRE (p. ej. el botón explícito del onboarding de permisos). */
  forzar(): Promise<boolean> {
    if (this.visible()) return new Promise<boolean>((res) => (this.resolver = res));
    this.visible.set(true);
    return new Promise<boolean>((res) => (this.resolver = res));
  }

  async aceptar(): Promise<void> {
    this.visible.set(false);
    await this.store.set(DECIDIDO_KEY, '1');
    await this.consent.otorgar('ubicacion_fondo');
    // Pide el permiso. En Android 11+ "todo el tiempo" se concede en Ajustes
    // (la guía ya existe); requestLocation cubre el permiso base.
    try {
      await this.permissions.requestLocation();
      await this.permissions.openAppSettings();
    } catch {
      /* best-effort: el consentimiento ya quedó guardado */
    }
    this.resolver?.(true);
    this.resolver = null;
  }

  async ahoraNo(): Promise<void> {
    this.visible.set(false);
    await this.store.set(DECIDIDO_KEY, '1');
    await this.consent.revocar('ubicacion_fondo'); // registra el "no" (sin rastreo)
    this.resolver?.(false);
    this.resolver = null;
  }
}
