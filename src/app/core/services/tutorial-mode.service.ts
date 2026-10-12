import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

const FLAG_KEY = 'csd_tutorial_mode';

/**
 * CM3 (PROMPT-95 F5) — "Modo grabación" para producir los videos tutoriales.
 *
 * Cuando la app corre en un navegador (Chromium) para grabar un flujo real, la cámara
 * nativa no existe y `--use-fake-device-for-media-stream` no siempre basta (el camino
 * de `<input capture>` abre el selector del sistema). Con `?tutorial=1` en la URL,
 * `CameraService` **devuelve una foto de demostración empaquetada** en vez de abrir la
 * cámara, para que el guion se grabe sin fricción.
 *
 * 🔒 **Candado:** NUNCA está activo en producción (`environment.entorno === 'prod'` lo
 * desactiva aunque venga la bandera). Es un flag explícito de dev; el "usuario demo"
 * (modo práctica, F6) reforzará este gate cuando llegue.
 */
@Injectable({ providedIn: 'root' })
export class TutorialModeService {
  private _activo = signal(false);
  readonly activo = this._activo.asReadonly();

  constructor() {
    // El candado de prod es absoluto: ni siquiera miramos la bandera.
    if (environment.entorno === 'prod') return;
    let flag = false;
    try {
      const url = new URLSearchParams(window.location.search);
      if (url.get('tutorial') === '1') {
        flag = true;
        sessionStorage.setItem(FLAG_KEY, '1'); // sobrevive a la navegación SPA
      } else {
        flag = sessionStorage.getItem(FLAG_KEY) === '1';
      }
    } catch {
      /* sin window/sessionStorage → queda apagado */
    }
    this._activo.set(flag);
  }

  /** Genera una foto de demostración (canvas → JPEG). Sin red, sin cámara. */
  async fotoDemoBlob(slot?: string): Promise<Blob> {
    const w = 1080;
    const h = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f1f33';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(0, h - 160, w, 160);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 72px Inter, sans-serif';
      ctx.fillText('FOTO DE', w / 2, h / 2 - 40);
      ctx.fillText('DEMOSTRACIÓN', w / 2, h / 2 + 50);
      if (slot) {
        ctx.font = '48px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(slot, w / 2, h / 2 + 150);
      }
    }
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? new Blob([], { type: 'image/jpeg' })), 'image/jpeg', 0.8);
    });
  }
}
