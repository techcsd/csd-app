import { Injectable, signal } from '@angular/core';

/** CM5 — foto abierta en el visor a pantalla completa. */
export interface PhotoViewerState {
  /** URL ya firmada / lista para mostrar. */
  url: string;
  /** Rect del avatar tocado, para la animación "crece desde ahí" (opcional → fade centrado). */
  rect: DOMRect | null;
  /** Token para distinguir aperturas sucesivas de la misma foto. */
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
 */
@Injectable({ providedIn: 'root' })
export class PhotoViewerService {
  private _estado = signal<PhotoViewerState | null>(null);
  readonly estado = this._estado.asReadonly();

  /** Abre el visor. `origen` = rect del avatar o el elemento tocado (para la animación). */
  open(url: string | null | undefined, origen?: DOMRect | HTMLElement | null): void {
    if (!url) return; // sin foto real → no se abre nada (CM5)
    let rect: DOMRect | null = null;
    if (origen instanceof HTMLElement) rect = origen.getBoundingClientRect();
    else if (origen) rect = origen;
    this._estado.set({ url, rect, at: Date.now() });
  }

  close(): void {
    this._estado.set(null);
  }
}
