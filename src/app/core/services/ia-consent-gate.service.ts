import { inject, Injectable, signal } from '@angular/core';
import { ConsentService } from './consent.service';

/**
 * CI10 — Portón del consentimiento de IA. Antes del PRIMER uso de cualquier función
 * con IA de terceros (Compa, transcripción de notas de voz, lectura de recibos) se
 * pide permiso explícito (Apple 5.1.2(i)). Patrón:
 *
 *   if (!(await iaGate.pedir())) return;   // el usuario dijo "Ahora no"
 *   // … llamar a la edge de IA …
 *
 * La hoja (ConsentimientoIa, en el shell) se muestra solo si no hay consentimiento;
 * si ya lo dio (cache u online) `pedir()` resuelve true sin interrumpir. También
 * expone `reabrir()` para cuando una edge responde 403 `sin_consentimiento_ia`.
 */
@Injectable({ providedIn: 'root' })
export class IaConsentGate {
  private consent = inject(ConsentService);

  readonly visible = signal(false);
  private resolver: ((ok: boolean) => void) | null = null;
  // CI10 — tras un "Ahora no", no re-preguntamos en esta sesión (los flujos de IA
  // auto-disparados no deben acosar). Se re-habilita en Perfil › Privacidad (que
  // otorga el consentimiento → tiene('ia')=true gana sobre esto).
  private declinado = false;

  /** Resuelve true si hay (o se otorga) consentimiento; false si el usuario rehúsa. */
  async pedir(): Promise<boolean> {
    if (this.consent.tiene('ia') === true) return true;
    if (this.declinado) return false;
    if (await this.consent.refrescar('ia')) return true;
    return this.mostrar();
  }

  /** Reabre la hoja tras un 403 `sin_consentimiento_ia` de una edge. */
  reabrir(): Promise<boolean> {
    return this.mostrar();
  }

  private mostrar(): Promise<boolean> {
    // Si ya hay una hoja abierta, re-usa su promesa (no apila resolvers).
    if (this.visible()) return new Promise<boolean>((res) => (this.resolver = res));
    this.visible.set(true);
    return new Promise<boolean>((res) => (this.resolver = res));
  }

  async permitir(): Promise<void> {
    this.visible.set(false);
    this.declinado = false;
    await this.consent.otorgar('ia');
    this.resolver?.(true);
    this.resolver = null;
  }

  ahoraNo(): void {
    this.visible.set(false);
    this.declinado = true;
    this.resolver?.(false);
    this.resolver = null;
  }
}
