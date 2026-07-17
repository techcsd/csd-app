import { Injectable } from '@angular/core';
import { db, Borrador } from '../db/app-db';

/** A rehydrated draft photo: its slot + the rebuilt Blob. */
export interface BorradorFotoView {
  slot: string;
  blob: Blob;
}

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
    await this.clearFotos(clave);
  }

  // ── M1 — fotos de borrador (recuperación tras kill del SO) ────────────────

  /** Persist (or replace) one draft photo. WebKit-safe: stores ArrayBuffer. */
  async saveFoto(clave: string, slot: string, blob: Blob): Promise<void> {
    try {
      const data = await blob.arrayBuffer();
      await db.borrador_fotos.put({
        id: `${clave}::${slot}`,
        clave,
        slot,
        data,
        type: blob.type || 'image/jpeg',
      });
    } catch {
      /* persistir la foto del borrador nunca debe romper la captura */
    }
  }

  /** Remove one draft photo (on clear of that slot). */
  async removeFoto(clave: string, slot: string): Promise<void> {
    try {
      await db.borrador_fotos.delete(`${clave}::${slot}`);
    } catch {
      /* ignore */
    }
  }

  /** All draft photos for a key, rebuilt as Blobs (for resume). */
  async loadFotos(clave: string): Promise<BorradorFotoView[]> {
    try {
      const rows = await db.borrador_fotos.where('clave').equals(clave).toArray();
      return rows.map((r) => ({ slot: r.slot, blob: new Blob([r.data], { type: r.type }) }));
    } catch {
      return [];
    }
  }

  async clearFotos(clave: string): Promise<void> {
    try {
      await db.borrador_fotos.where('clave').equals(clave).delete();
    } catch {
      /* ignore */
    }
  }
}
