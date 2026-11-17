import { Injectable, signal } from '@angular/core';

export type GpsMotivo = 'permiso' | 'apagado';

/**
 * DS-51 F4.1 — estado del asistente de activación de GPS. El servicio solo guarda qué mostrar y
 * resuelve una promesa; la pantalla (`app-gps-asistente`) hace el trabajo. `mostrar()` devuelve
 * true si el GPS quedó activo, false si el chofer lo dejó sin activar.
 */
@Injectable({ providedIn: 'root' })
export class GpsAsistenteService {
  private _abierto = signal(false);
  private _motivo = signal<GpsMotivo>('apagado');
  abierto = this._abierto.asReadonly();
  motivo = this._motivo.asReadonly();

  private resolver: ((ok: boolean) => void) | null = null;

  mostrar(motivo: GpsMotivo): Promise<boolean> {
    // Si ya hay uno abierto, se cierra como "no" y se abre el nuevo (nunca dos a la vez).
    this.resolver?.(false);
    this._motivo.set(motivo);
    this._abierto.set(true);
    return new Promise<boolean>((res) => {
      this.resolver = res;
    });
  }

  cerrar(ok: boolean): void {
    this._abierto.set(false);
    const r = this.resolver;
    this.resolver = null;
    r?.(ok);
  }
}
