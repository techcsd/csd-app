import { Injectable } from '@angular/core';
import { db } from '../db/app-db';

/**
 * Read-through cache for catalogues the app needs offline (materiales,
 * vehículos, proyectos, actividades…). Feature services provide the loader;
 * this service handles caching, freshness (TTL) and offline reads. Writes go
 * through the SyncService outbox, never here (TRD §3.2).
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  /** Ask the browser to keep IndexedDB from being purged (iOS mitigation). */
  async persistStorage(): Promise<void> {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      /* best-effort */
    }
  }

  async read<T>(tipo: string): Promise<T | null> {
    const entry = await db.catalogos.get(tipo);
    return (entry?.data as T) ?? null;
  }

  async fetchedAt(tipo: string): Promise<number | null> {
    return (await db.catalogos.get(tipo))?.fetched_at ?? null;
  }

  async isStale(tipo: string, ttlMs: number): Promise<boolean> {
    const at = await this.fetchedAt(tipo);
    return at === null || Date.now() - at > ttlMs;
  }

  private async write<T>(tipo: string, data: T): Promise<void> {
    await db.catalogos.put({ tipo, data, fetched_at: Date.now() });
  }

  /**
   * Refresh a catalogue via its loader when online. On failure (offline or
   * error) returns the last cached value so the UI degrades gracefully.
   */
  async refresh<T>(tipo: string, loader: () => Promise<T>): Promise<T | null> {
    try {
      const data = await loader();
      await this.write(tipo, data);
      return data;
    } catch (e) {
      console.warn(`CatalogService.refresh(${tipo}) failed, using cache:`, e);
      return this.read<T>(tipo);
    }
  }
}
