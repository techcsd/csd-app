import { inject, Injectable } from '@angular/core';
import { BorradorService, BorradorMeta } from './borrador.service';

interface Pendiente {
  data: unknown;
  meta: BorradorMeta;
}

/**
 * Autosave de formularios (SYNC-02, feedback PWA iOS): guarda el estado en
 * IndexedDB con debounce mientras el usuario escribe, y hace FLUSH inmediato
 * cuando la página se oculta (`visibilitychange` → hidden) o se descarga
 * (`pagehide`). No depende de `beforeunload` (poco confiable en móvil/iOS).
 */
@Injectable({ providedIn: 'root' })
export class AutosaveService {
  private borrador = inject(BorradorService);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private latest = new Map<string, Pendiente>();
  private bound = false;

  private readonly DEBOUNCE = 600;

  private bind(): void {
    if (this.bound || typeof document === 'undefined') return;
    this.bound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flushAll();
    });
    window.addEventListener('pagehide', () => void this.flushAll());
  }

  /** Queue an autosave (debounced). Call it whenever the form state changes. */
  queue(clave: string, data: unknown, meta: BorradorMeta = {}): void {
    this.bind();
    this.latest.set(clave, { data, meta });
    const prev = this.timers.get(clave);
    if (prev) clearTimeout(prev);
    this.timers.set(
      clave,
      setTimeout(() => void this.write(clave), this.DEBOUNCE),
    );
  }

  private async write(clave: string): Promise<void> {
    const p = this.latest.get(clave);
    if (!p) return;
    this.timers.delete(clave);
    await this.borrador.save(clave, p.data, p.meta);
  }

  /** Write every pending draft immediately (called on hide/pagehide). */
  async flushAll(): Promise<void> {
    const claves = [...this.latest.keys()];
    for (const clave of claves) {
      const t = this.timers.get(clave);
      if (t) clearTimeout(t);
      await this.write(clave);
    }
  }

  /** Stop tracking a draft (on submit/discard) — also clears its stored row. */
  async discard(clave: string): Promise<void> {
    const t = this.timers.get(clave);
    if (t) clearTimeout(t);
    this.timers.delete(clave);
    this.latest.delete(clave);
    await this.borrador.clear(clave);
  }
}
