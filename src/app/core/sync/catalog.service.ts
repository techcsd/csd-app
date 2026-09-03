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
   * P7 — invalida una entrada de caché (borra su copia local) para que la
   * próxima lectura re-consulte el servidor. Se usa tras sincronizar un registro
   * que cambia datos derivados (p. ej. el kilometraje del vehículo), así la app
   * no muestra el valor viejo cacheado. Acepta un prefijo con `like` opcional.
   */
  async invalidate(tipo: string): Promise<void> {
    await db.catalogos.delete(tipo);
  }

  /** Invalida todas las entradas cuyo `tipo` empieza por el prefijo dado. */
  async invalidatePrefix(prefijo: string): Promise<void> {
    await db.catalogos.where('tipo').startsWith(prefijo).delete();
  }

  /**
   * AE7 — reescribe OPTIMISTAMENTE una lista cacheada (p. ej. quitar el ítem que
   * el chofer acaba de firmar/confirmar) en vez de BORRAR la caché con
   * `invalidate`. Borrarla dejaba la pantalla VACÍA si el usuario recargaba sin
   * señal (el loader falla → `read` devuelve null). Con esto, offline la lista
   * sigue mostrando el resto; al reconectar, `refresh` re-consulta y cuadra.
   */
  async optimisticUpdate<T>(tipo: string, fn: (prev: T | null) => T): Promise<void> {
    const prev = await this.read<T>(tipo);
    await this.write(tipo, fn(prev));
  }

  /**
   * Refresh a catalogue via its loader when online. On failure (offline or
   * error) returns the last cached value so the UI degrades gracefully.
   */
  async refresh<T>(tipo: string, loader: () => Promise<T>): Promise<T | null> {
    return (await this.refreshDetailed(tipo, loader)).data;
  }

  /**
   * BH6 — como `refresh`, pero DISTINGUE "vacío" de "falló". `refresh` atrapaba
   * cualquier error del loader y devolvía la caché (posiblemente nula) → una
   * consulta que fallaba se veía idéntica a "no tienes nada". Aquí el llamador sabe
   * si hubo fallo y si lo que devuelve viene de caché, para poder mostrar un estado
   * de ERROR con reintento en vez de un falso vacío (hermano de la telemetría de BG2:
   * los fallos se ven, no se adivinan). Patrón reutilizable por cualquier lista.
   */
  async refreshDetailed<T>(
    tipo: string,
    loader: () => Promise<T>,
  ): Promise<{ data: T | null; failed: boolean; fromCache: boolean }> {
    try {
      const data = await loader();
      await this.write(tipo, data);
      return { data, failed: false, fromCache: false };
    } catch (e) {
      console.warn(`CatalogService.refresh(${tipo}) failed, using cache:`, e);
      const data = await this.read<T>(tipo);
      return { data, failed: true, fromCache: data !== null };
    }
  }
}
