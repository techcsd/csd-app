import { Injectable } from '@angular/core';
import { db } from '../db/app-db';

/**
 * Half-filled wizard drafts, recoverable after the app is killed (SYNC-02).
 * Stores the selected/typed state only — photos are re-taken on resume
 * (blobs + object URLs don't survive a reload cleanly). Cleared on submit.
 */
@Injectable({ providedIn: 'root' })
export class BorradorService {
  async save(clave: string, data: unknown): Promise<void> {
    await db.borradores.put({ clave, data, updated_at: Date.now() });
  }

  async load<T>(clave: string): Promise<T | null> {
    const row = await db.borradores.get(clave);
    return (row?.data as T) ?? null;
  }

  async clear(clave: string): Promise<void> {
    await db.borradores.delete(clave);
  }
}
