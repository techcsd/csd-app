import { Injectable, signal } from '@angular/core';

/**
 * CM2 — "logo al entrar". Al autenticar (login o PIN) la app revela el logo CSD una
 * sola vez por arranque de proceso, SIN bloquear la carga del home: es un velo que se
 * monta sobre lo que venga (home/pin-setup) y se quita solo. El overlay global
 * `app-logo-reveal` (montado en el shell) observa `activo()`; login/pin-unlock solo
 * llaman a `disparar()` (fire-and-forget) y siguen navegando.
 *
 * "Una vez por proceso": `_yaMostrado` es un flag del singleton (vive lo que viva la
 * app). Da igual cuántas veces se llame a `disparar()` (login → pin-setup, o varios
 * pin-unlock en la misma sesión): solo el primero muestra el velo.
 */
@Injectable({ providedIn: 'root' })
export class LogoRevealService {
  /** Velo activo (el overlay lo observa). */
  private _activo = signal(false);
  readonly activo = this._activo.asReadonly();

  /** Token para re-disparar el effect del overlay si hiciera falta. */
  private _at = signal(0);
  readonly at = this._at.asReadonly();

  /** Una vez por arranque de proceso. */
  private yaMostrado = false;

  /**
   * Dispara el velo del logo (idempotente: solo la primera vez por proceso). No
   * bloquea ni espera nada — el llamador sigue navegando de inmediato.
   */
  disparar(): void {
    if (this.yaMostrado) return;
    this.yaMostrado = true;
    this._at.set(Date.now());
    this._activo.set(true);
  }

  /** Cierra el velo (auto-cierre del overlay o al tocar para saltar). */
  cerrar(): void {
    this._activo.set(false);
  }
}
