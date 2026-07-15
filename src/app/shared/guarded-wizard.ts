import { Directive, OnDestroy, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavGuardService } from '../core/services/nav-guard.service';

/**
 * U4 — Base para wizards/forms que no deben perder datos por un "atrás"
 * accidental (botón de la pantalla o botón físico de Android). El subcomponente
 * implementa `tieneDatos()`; esta base abre "¿Descartar cambios?" cuando hay
 * datos sin guardar y solo sale al confirmar.
 *
 * Uso: `extends GuardedWizard`, implementar `tieneDatos()`, llamar
 * `this.registerBackGuard()` en el constructor, cablear el botón atrás/cancelar
 * a `intentarSalir()` y montar `<app-confirm-dialog>` con `confirmSalir()`.
 */
@Directive()
export abstract class GuardedWizard implements OnDestroy {
  protected readonly location = inject(Location);
  private readonly navGuard = inject(NavGuardService);

  confirmSalir = signal(false);

  /** ¿Hay datos sin guardar que se perderían al salir? */
  abstract tieneDatos(): boolean;

  private readonly backHandler = (): boolean => {
    if (this.confirmSalir()) {
      this.confirmSalir.set(false); // back cierra el diálogo abierto
      return true;
    }
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true; // manejado: no navegar
    }
    return false;
  };

  protected registerBackGuard(): void {
    this.navGuard.register(this.backHandler);
  }

  /** Salida real. El subcomponente puede sobrescribir (p. ej. router). */
  protected salir(): void {
    this.location.back();
  }

  intentarSalir(): void {
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.salir();
  }

  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.salir();
  }

  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }
}
