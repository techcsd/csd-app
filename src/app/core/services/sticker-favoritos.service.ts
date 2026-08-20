import { inject, Injectable, signal } from '@angular/core';
import { LocalStore } from './local-store.service';

const KEY = 'sticker_favoritos_v1';

/**
 * AS12 — favoritos de stickers (estilo WhatsApp).
 *
 * Los favoritos son un atajo local del usuario: un conjunto de `ref`s de sticker
 * marcadas para acceso rápido. Se guardan en LocalStore (Preferences en nativo,
 * localStorage en la PWA) → **disponibles offline** sin depender del backend. Un
 * sticker puede estar en favoritos Y en un pack a la vez. La lista de packs sí es
 * server-side (ya existía); favoritos es la capa local que faltaba.
 */
@Injectable({ providedIn: 'root' })
export class StickerFavoritosService {
  private store = inject(LocalStore);
  private _refs = signal<string[]>([]);
  /** Refs favoritas (más recientes primero). Reactivo para el selector. */
  refs = this._refs.asReadonly();
  private cargado = false;

  /** Carga perezosa desde disco (una vez). */
  async cargar(): Promise<void> {
    if (this.cargado) return;
    this.cargado = true;
    try {
      const raw = await this.store.get(KEY);
      if (raw) this._refs.set(JSON.parse(raw) as string[]);
    } catch {
      /* lista vacía si el JSON está corrupto */
    }
  }

  esFavorito(ref: string): boolean {
    return this._refs().includes(ref);
  }

  /** Alterna una ref en favoritos y persiste. Devuelve el nuevo estado. */
  async toggle(ref: string): Promise<boolean> {
    const actual = this._refs();
    const esFav = actual.includes(ref);
    const next = esFav ? actual.filter((r) => r !== ref) : [ref, ...actual];
    this._refs.set(next);
    await this.persistir(next);
    return !esFav;
  }

  private async persistir(refs: string[]): Promise<void> {
    try {
      await this.store.set(KEY, JSON.stringify(refs));
    } catch {
      /* best-effort */
    }
  }
}
