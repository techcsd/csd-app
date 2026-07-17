import { Injectable, signal } from '@angular/core';

/** Resultado del overlay: el Blob capturado, null (cancelar) o 'fallback'
 *  (el dispositivo no soporta getUserMedia → usar la cámara del sistema). */
export type InAppCameraResult = Blob | null | 'fallback';

/**
 * Orquesta la cámara EMBEBIDA (getUserMedia) que se dibuja como overlay global.
 * Capturar dentro de la app evita salir a la cámara del sistema, lo que en
 * teléfonos MIUI/low-mem provocaba que el SO matara la app durante la foto.
 */
@Injectable({ providedIn: 'root' })
export class InAppCameraService {
  active = signal(false);
  private resolver: ((r: InAppCameraResult) => void) | null = null;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Abre el overlay y resuelve cuando el usuario captura/cancela/falla. */
  open(): Promise<InAppCameraResult> {
    if (this.active()) return Promise.resolve(null);
    this.active.set(true);
    return new Promise((res) => (this.resolver = res));
  }

  /** Cierra el overlay resolviendo la promesa (lo llama el componente). */
  finish(result: InAppCameraResult): void {
    this.active.set(false);
    const r = this.resolver;
    this.resolver = null;
    r?.(result);
  }
}
