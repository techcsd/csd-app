import { effect } from '@angular/core';

/**
 * Lleva el scroll del contenedor de pantalla (`.screen__body`) y la ventana
 * arriba del todo. Doble `requestAnimationFrame` para correr DESPUÉS de que
 * Angular pinte el nuevo paso (si no, el contenedor todavía tiene el alto viejo).
 */
export function scrollScreenBodyTop(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>('.screen, .screen__body')
        .forEach((el) => (el.scrollTop = 0));
    }),
  );
}

/**
 * U3 — resetea el scroll en CADA cambio de paso de un wizard. El fix P9 (app.ts)
 * solo actúa en cambios de ruta (NavigationEnd); dentro de un wizard `next()/prev()`
 * solo cambian una señal y la vista queda a media altura.
 *
 * Llamar UNA vez en el constructor (contexto de inyección). Pásale los lectores de
 * las señales que definen el "paso" visible: `step`, sub-pasos (paso5/paso8) y
 * `done` (para que la vista de resultado también arranque arriba — U4).
 *
 * Ej.: `resetScrollOnStep(() => this.step(), () => this.done());`
 */
export function resetScrollOnStep(...reads: Array<() => unknown>): void {
  effect(() => {
    for (const r of reads) r();
    scrollScreenBodyTop();
  });
}
