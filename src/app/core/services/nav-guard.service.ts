import { Injectable } from '@angular/core';

/**
 * U4 — Guarda transversal del botón físico "Atrás" de Android. Una página con
 * datos sin guardar registra un handler; cuando el usuario presiona atrás,
 * `app.ts` lo consulta. Si el handler devuelve `true` significa que él manejó el
 * gesto (p. ej. abrió el diálogo "¿Descartar cambios?") y NO se debe navegar.
 *
 * Se usa identidad de función al limpiar para evitar que el `ngOnDestroy` de la
 * página saliente borre el handler que ya registró la entrante.
 */
@Injectable({ providedIn: 'root' })
export class NavGuardService {
  private handler: (() => boolean) | null = null;

  register(fn: () => boolean): void {
    this.handler = fn;
  }

  /** Limpia solo si el handler actual sigue siendo el de esta página. */
  clear(fn: () => boolean): void {
    if (this.handler === fn) this.handler = null;
  }

  /** Devuelve true si el "atrás" fue manejado por la página (no navegar). */
  handleBack(): boolean {
    return this.handler ? this.handler() : false;
  }
}
