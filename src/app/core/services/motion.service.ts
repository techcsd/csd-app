import { Injectable, signal } from '@angular/core';

/** CJ1 — preferencia de movimiento por dispositivo (no se sincroniza con la web). */
export type MotionPref = 'completas' | 'reducidas';

/** localStorage (por dispositivo, default 'completas'). */
const PREF_KEY = 'csd-motion-pref';

/**
 * MotionService (CJ1) — gestiona el ajuste de usuario "Animaciones: completas /
 * reducidas" (Perfil › Ajustes). Aplica la clase `motion-reduced` en <html>, que el
 * CSS usa para anular crossfades/transiciones igual que `prefers-reduced-motion`.
 *
 * `reducido()` es la fuente única para que las animaciones GRANDES (CJ2/CJ3) se
 * salten solas: es verdadero si el usuario eligió "reducidas" O el SO pide
 * movimiento reducido. Es por dispositivo (localStorage); el default es 'completas'.
 */
@Injectable({ providedIn: 'root' })
export class MotionService {
  private _pref = signal<MotionPref>(this.readCached());
  /** Preferencia elegida (para pintar el selector). */
  readonly pref = this._pref.asReadonly();

  constructor() {
    this.applyToDom(this._pref());
  }

  private readCached(): MotionPref {
    try {
      return localStorage.getItem(PREF_KEY) === 'reducidas' ? 'reducidas' : 'completas';
    } catch {
      return 'completas';
    }
  }

  private applyToDom(p: MotionPref): void {
    try {
      document.documentElement.classList.toggle('motion-reduced', p === 'reducidas');
    } catch {
      /* sin DOM (SSR) → no-op */
    }
  }

  /** Fija la preferencia y la aplica/cachea (best-effort, por dispositivo). */
  setPref(p: MotionPref): void {
    this._pref.set(p);
    this.applyToDom(p);
    try {
      localStorage.setItem(PREF_KEY, p);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  /**
   * ¿Hay que evitar el movimiento? Verdadero si el usuario eligió "reducidas" o si el
   * SO pide `prefers-reduced-motion: reduce`. Las celebraciones (CJ2/CJ3) lo consultan
   * para degradar a solo el check.
   */
  reducido(): boolean {
    if (this._pref() === 'reducidas') return true;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }
}
