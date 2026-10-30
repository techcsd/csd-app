import { Injectable, signal } from '@angular/core';

/** CM5 — foto(s) abiertas en el visor a pantalla completa.
 *  DB2 — `urls`/`index` reemplazan el `url` único de CM5 para soportar galerías
 *  (p. ej. imágenes consecutivas de una dev-note): un visor de una sola foto es
 *  simplemente `urls.length === 1`, así que no rompe a ningún llamador existente. */
export interface PhotoViewerState {
  /** URLs ya firmadas / listas para mostrar (1 o más). */
  urls: string[];
  /** Posición actual dentro de `urls`. */
  index: number;
  /** Rect del elemento tocado, para la animación "crece desde ahí" (solo en la apertura). */
  rect: DOMRect | null;
  /** Token para distinguir aperturas sucesivas (NO cambia al navegar siguiente/anterior,
   *  así la animación de apertura no se repite al pasar de foto dentro de la galería). */
  at: number;
}

/**
 * CM5 — servicio del visor de foto a pantalla completa (una sola instancia). Cualquier
 * pantalla lo abre con `open(url, origen)` sin tener que montar el componente: el host
 * global `app-photo-viewer` (en app.html) observa `estado()` y pinta el overlay.
 *
 * `origen` puede ser el `DOMRect` del avatar o el propio `HTMLElement` (p. ej.
 * `$event.currentTarget`); de ahí sale la animación de apertura (escala desde la foto
 * tocada). Si no se pasa, el visor entra con un fundido centrado.
 *
 * Solo se abre si hay URL real (avatares de iniciales → no llaman aquí).
 *
 * DB2 — `openGaleria` abre con varias fotos (navegables con flechas/contador); `open`
 * sigue siendo el atajo de una sola foto (= `openGaleria([url], 0, origen)`).
 */
@Injectable({ providedIn: 'root' })
export class PhotoViewerService {
  private _estado = signal<PhotoViewerState | null>(null);
  readonly estado = this._estado.asReadonly();

  /** Abre el visor con UNA foto. `origen` = rect del avatar o el elemento tocado. */
  open(url: string | null | undefined, origen?: DOMRect | HTMLElement | null): void {
    if (!url) return; // sin foto real → no se abre nada (CM5)
    this.openGaleria([url], 0, origen);
  }

  /** DB2 — abre el visor con VARIAS fotos, arrancando en `index`. Las URLs vacías/nulas
   *  se descartan (nunca una posición "rota" en la galería); si no queda ninguna, no
   *  abre nada (mismo contrato que `open`). */
  openGaleria(urls: ReadonlyArray<string | null | undefined>, index: number, origen?: DOMRect | HTMLElement | null): void {
    const limpias = urls.filter((u): u is string => !!u);
    if (!limpias.length) return;
    let rect: DOMRect | null = null;
    if (origen instanceof HTMLElement) rect = origen.getBoundingClientRect();
    else if (origen) rect = origen;
    const i = Math.min(Math.max(index, 0), limpias.length - 1);
    this._estado.set({ urls: limpias, index: i, rect, at: Date.now() });
  }

  /** DB2 — siguiente foto de la galería (cíclico). No-op si solo hay una. */
  siguiente(): void {
    const st = this._estado();
    if (!st || st.urls.length < 2) return;
    this._estado.set({ ...st, index: (st.index + 1) % st.urls.length, rect: null });
  }

  /** DB2 — foto anterior de la galería (cíclico). No-op si solo hay una. */
  anterior(): void {
    const st = this._estado();
    if (!st || st.urls.length < 2) return;
    this._estado.set({ ...st, index: (st.index - 1 + st.urls.length) % st.urls.length, rect: null });
  }

  close(): void {
    this._estado.set(null);
  }
}
