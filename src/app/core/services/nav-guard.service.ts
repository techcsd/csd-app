import { inject, Injectable } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

/**
 * U4 / AJ2 / AJ7 — Guarda transversal de navegación.
 *
 * 1. **Botón físico "Atrás" de Android** (U4): una página con datos sin guardar
 *    registra un handler; `app.ts` lo consulta. Si el handler devuelve `true`
 *    significa que él manejó el gesto (p. ej. abrió "¿Descartar cambios?") y NO
 *    se debe navegar. Se usa identidad de función al limpiar para evitar que el
 *    `ngOnDestroy` de la página saliente borre el handler que registró la entrante.
 *
 * 2. **Back seguro** (AJ2): `back(fallback)` vuelve al nivel anterior con un POP
 *    real (histórico) en vez de empujar una ruta nueva — así el stack no se
 *    ensucia y el botón físico "Atrás" no cicla. Si esta fue la primera pantalla
 *    (deep-link / arranque en frío) cae al `fallback` y nunca saca de la app.
 *
 * 3. **Gate de navegación en segundo plano** (AJ7): un evento async (deep-link de
 *    una push, realtime, etc.) NUNCA debe sacar al usuario de un formulario en
 *    curso. `requestNav(run)` difiere la navegación hasta que el formulario se
 *    cierre; si no hay formulario activo, navega de inmediato.
 */
@Injectable({ providedIn: 'root' })
export class NavGuardService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  private handler: (() => boolean) | null = null;
  private pendingNav: (() => void) | null = null;

  /**
   * QA-8 (AJ15) — profundidad REAL del stack in-app, no un contador monotónico.
   * La primera pantalla = 1; una navegación imperativa (push) suma; un `popstate`
   * (atrás/adelante del sistema, incluido el que dispara `location.back()`) resta.
   * Así `back()` detecta cuándo volvimos a la pantalla de entrada y cae al fallback
   * en vez de hacer un `location.back()` al vacío (que en el WebView podía cerrar la
   * app o dejar el botón muerto tras un deep-link en frío). El contador viejo
   * (`navCount`) solo subía — incluso en los pops que él mismo debía vigilar.
   */
  private depth = 0;
  private lastTrigger: 'imperative' | 'popstate' | 'hashchange' = 'imperative';

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.lastTrigger = e.navigationTrigger ?? 'imperative';
      } else if (e instanceof NavigationEnd) {
        if (this.depth === 0) this.depth = 1; // primera pantalla del arranque
        else if (this.lastTrigger === 'popstate') this.depth = Math.max(1, this.depth - 1);
        else this.depth++; // push imperativo (aprox.: los redirects de guard cuentan como push, sesga a pop — nunca a salir)
      }
    });
  }

  register(fn: () => boolean): void {
    this.handler = fn;
  }

  /** Limpia solo si el handler actual sigue siendo el de esta página. Al cerrarse
   *  el formulario, descarga cualquier navegación en segundo plano que quedó en
   *  espera (AJ7).
   *
   *  QA-9 (AJ15) — la descarga se DIFIERE un tick y solo se ejecuta si no hay otro
   *  formulario activo. `clear()` corre en el `ngOnDestroy`, que también dispara
   *  cuando el usuario navega por su cuenta a OTRA pantalla (p. ej. otro wizard);
   *  ejecutar el deep-link diferido de inmediato lo sacaba de ese destino. Al
   *  diferir y re-chequear `formActivo`, si aterrizó en otro formulario NO lo
   *  interrumpimos (justo lo que AJ7 buscaba); si aterrizó en una pantalla neutra,
   *  el deep-link diferido se entrega como corresponde. */
  clear(fn: () => boolean): void {
    if (this.handler === fn) {
      this.handler = null;
      const pending = this.pendingNav;
      this.pendingNav = null;
      if (pending) setTimeout(() => { if (!this.formActivo) pending(); }, 0);
    }
  }

  /** Devuelve true si el "atrás" fue manejado por la página (no navegar). */
  handleBack(): boolean {
    return this.handler ? this.handler() : false;
  }

  /** Hay un formulario/wizard con guarda activa en pantalla. */
  get formActivo(): boolean {
    return this.handler !== null;
  }

  /**
   * AJ7 — Navegación disparada por un evento en segundo plano (deep-link de push,
   * realtime, notificación). Si hay un formulario activo, se DIFIERE hasta que el
   * formulario se cierre (nunca interrumpe una captura); si no, navega ya.
   */
  requestNav(run: () => void): void {
    if (this.formActivo) {
      this.pendingNav = run; // se descarga en clear() al cerrar el formulario
      return;
    }
    run();
  }

  /**
   * AJ2 — Back seguro para botones de pantalla: POP del histórico si hay nivel
   * anterior in-app; si esta fue la primera pantalla, cae al fallback (home del
   * módulo o /home) sin salir de la app.
   */
  back(fallback = '/home'): void {
    if (this.depth > 1) this.location.back();
    else void this.router.navigateByUrl(fallback);
  }
}
