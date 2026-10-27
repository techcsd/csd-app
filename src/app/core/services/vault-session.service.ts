import { inject, Injectable, signal } from '@angular/core';
import { BovedaService } from './boveda.service';

/** Pure helper (unit-testable without Angular DI): seconds left until `expiraAtIso`, floored at 0. */
export function segundosRestantesDesde(expiraAtIso: string, ahoraMs: number): number {
  return Math.max(0, Math.round((new Date(expiraAtIso).getTime() - ahoraMs) / 1000));
}

/**
 * CZ7/DZ-10/DZ-19 — sesión del Vault EN LA APP (2 minutos, header `x-sgc-client:
 * app` ya lo fija boveda.service). Cuenta regresiva en memoria; al llegar a 0 (o
 * al salir de cualquier pantalla del Vault / pasar la app a segundo plano) se
 * cierra y hay que reautenticarse — nunca se extiende "silenciosamente".
 */
@Injectable({ providedIn: 'root' })
export class VaultSessionService {
  private boveda = inject(BovedaService);

  private _expiraAt = signal<Date | null>(null);
  private _segundosRestantes = signal(0);
  segundosRestantes = this._segundosRestantes.asReadonly();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  vigente(): boolean {
    return this._segundosRestantes() > 0;
  }

  /** Consulta al servidor si ya hay una sesión vigente (p. ej. al reabrir una pantalla del Vault). */
  async refrescarDesdeServidor(): Promise<boolean> {
    const hasta = await this.boveda.sesionVigenteHasta();
    if (hasta) {
      this.iniciar(hasta);
      return true;
    }
    this.cerrar();
    return false;
  }

  async abrir(password: string): Promise<void> {
    const { expira_at } = await this.boveda.abrirSesion(password);
    this.iniciar(new Date(expira_at));
  }

  private iniciar(hasta: Date): void {
    this._expiraAt.set(hasta);
    this.limpiarTimer();
    const tick = () => {
      const h = this._expiraAt();
      if (!h) return;
      const restante = segundosRestantesDesde(h.toISOString(), Date.now());
      this._segundosRestantes.set(restante);
      if (restante <= 0) this.cerrar();
    };
    tick();
    this.intervalId = setInterval(tick, 1000);
  }

  /** Cierra la sesión EN EL CLIENTE (no revoca la del servidor — igual expira sola a los 2 min). */
  cerrar(): void {
    this.limpiarTimer();
    this._expiraAt.set(null);
    this._segundosRestantes.set(0);
  }

  private limpiarTimer(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
