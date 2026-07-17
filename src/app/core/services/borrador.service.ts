import { Injectable } from '@angular/core';
import { db, Borrador } from '../db/app-db';

/** Optional metadata to show a draft in "Documentación en proceso" + resume it. */
export interface BorradorMeta {
  tipo?: string;
  etiqueta?: string;
  ruta?: string;
}

/**
 * Half-filled wizard drafts, recoverable after the app is killed OR after the
 * user leaves to another app and comes back (SYNC-02). Stores the typed/selected
 * state; heavy photos are re-taken on resume. Cleared on submit.
 */
@Injectable({ providedIn: 'root' })
export class BorradorService {
  async save(clave: string, data: unknown, meta?: BorradorMeta): Promise<void> {
    await db.borradores.put({
      clave,
      data,
      updated_at: Date.now(),
      tipo: meta?.tipo,
      etiqueta: meta?.etiqueta,
      ruta: meta?.ruta,
    });
  }

  async load<T>(clave: string): Promise<T | null> {
    const row = await db.borradores.get(clave);
    return (row?.data as T) ?? null;
  }

  /** Full draft row (incl. updated_at/meta) — for the recovery banner. */
  async get(clave: string): Promise<Borrador | null> {
    return (await db.borradores.get(clave)) ?? null;
  }

  /** All open drafts, newest first — for "Documentación en proceso". */
  async list(): Promise<Borrador[]> {
    const all = await db.borradores.toArray();
    return all.sort((a, b) => b.updated_at - a.updated_at);
  }

  async clear(clave: string): Promise<void> {
    await db.borradores.delete(clave);
  }
}
