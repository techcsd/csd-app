import { effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../services/supabase.service';
import { NetworkService } from '../services/network.service';
import { db, FotoPendiente, OutboxOp } from '../db/app-db';

/**
 * A handler knows how to commit one kind of field capture to Supabase.
 * It receives the op payload and a map of {slot → uploaded storage path} for
 * any photos that were queued with the op. It must THROW on failure; throwing
 * a `PermanentSyncError` marks the op as needing user attention (⚠️) instead
 * of being retried forever.
 */
export type OpHandler = (
  payload: Record<string, unknown>,
  photoPaths: Record<string, string>,
) => Promise<void>;

/** A server-side rejection that retrying won't fix (e.g. validation). */
export class PermanentSyncError extends Error {}

export interface EnqueueInput {
  id: string; // client UUID
  tipo_op: string;
  payload: Record<string, unknown>;
  capturado_en?: string;
  fotos?: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }>;
  resumen?: unknown; // for the local "mis registros" list
}

// Backoff schedule (ms): 30s → 1m → 2m → 5m → 5m → 5m, then give up (⚠️).
const BACKOFF = [30_000, 60_000, 120_000, 300_000, 300_000, 300_000];
const MAX_INTENTOS = BACKOFF.length;
const TICK_MS = 60_000;

/**
 * Offline-first write queue. Captures are saved to Dexie and drained to
 * Supabase FIFO whenever there's connectivity, with retries + backoff. Nothing
 * is ever discarded without the user's confirmation (PRD 3.0). (ADR-002.)
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private supabase = inject(SupabaseService);
  private network = inject(NetworkService);

  private handlers = new Map<string, OpHandler>();
  private draining = false;

  pendingCount = signal(0);
  errorCount = signal(0);
  syncing = signal(false);

  constructor() {
    void this.refreshCounts();
    // Drain as soon as connectivity returns.
    effect(() => {
      if (this.network.online()) void this.drain();
    });
    // Safety-net ticker for backoff retries while the app is open.
    setInterval(() => void this.drain(), TICK_MS);
  }

  /** Feature services register how their op type commits to the server. */
  register(tipo_op: string, handler: OpHandler): void {
    this.handlers.set(tipo_op, handler);
  }

  /** Queue a capture. Persists atomically, then tries to send. */
  async enqueue(input: EnqueueInput): Promise<void> {
    const op: OutboxOp = {
      id: input.id,
      tipo_op: input.tipo_op,
      payload: input.payload,
      estado: 'pending',
      intentos: 0,
      proximo_intento: 0,
      capturado_en: input.capturado_en ?? new Date().toISOString(),
      created_local: Date.now(),
    };
    const fotos: FotoPendiente[] = (input.fotos ?? []).map((f) => ({
      id: f.id,
      op_id: input.id,
      bucket: f.bucket,
      path: f.path,
      slot: f.slot,
      blob: f.blob,
    }));

    await db.transaction('rw', db.outbox, db.fotos_pendientes, db.mis_registros, async () => {
      await db.outbox.put(op);
      if (fotos.length) await db.fotos_pendientes.bulkPut(fotos);
      if (input.resumen !== undefined) {
        await db.mis_registros.put({
          id: input.id,
          tipo_op: input.tipo_op,
          resumen: input.resumen,
          estado: 'pending',
          created_local: op.created_local,
        });
      }
    });

    await this.refreshCounts();
    void this.drain();
  }

  /** User-triggered retry of an errored op (⚠️ badge tap). */
  async retry(id: string): Promise<void> {
    const op = await db.outbox.get(id);
    if (!op) return;
    await db.outbox.update(id, { estado: 'pending', proximo_intento: 0, error_msg: undefined });
    await this.refreshCounts();
    void this.drain();
  }

  private async refreshCounts(): Promise<void> {
    const [pending, errored] = await Promise.all([
      db.outbox.where('estado').anyOf('pending', 'syncing').count(),
      db.outbox.where('estado').equals('error').count(),
    ]);
    this.pendingCount.set(pending);
    this.errorCount.set(errored);
  }

  /** Process the queue FIFO. Safe to call repeatedly; re-entrancy guarded. */
  async drain(): Promise<void> {
    if (this.draining || !this.network.online()) return;
    this.draining = true;
    this.syncing.set(true);
    try {
      // FIFO by capture order.
      const ops = await db.outbox.orderBy('created_local').toArray();
      const now = Date.now();
      for (const op of ops) {
        if (op.estado === 'done') continue;
        if (op.estado === 'error') continue; // needs explicit retry
        if (op.proximo_intento > now) continue; // waiting on backoff
        if (!this.network.online()) break; // lost signal mid-drain
        await this.process(op);
      }
    } finally {
      this.draining = false;
      this.syncing.set(false);
      await this.refreshCounts();
    }
  }

  private async process(op: OutboxOp): Promise<void> {
    const handler = this.handlers.get(op.tipo_op);
    if (!handler) {
      // No handler registered (feature not loaded) — leave pending, try later.
      return;
    }

    await db.outbox.update(op.id, { estado: 'syncing' });
    try {
      const photoPaths = await this.uploadPhotos(op.id);
      await handler(op.payload, photoPaths);

      // Success: clear photos, mark the local record sent, drop the op.
      await db.transaction('rw', db.outbox, db.fotos_pendientes, db.mis_registros, async () => {
        await db.fotos_pendientes.where('op_id').equals(op.id).delete();
        await db.mis_registros.update(op.id, { estado: 'done' });
        await db.outbox.delete(op.id);
      });
    } catch (err) {
      await this.handleFailure(op, err);
    }
  }

  /** Uploads every pending photo for an op; returns {slot → storage path}. */
  private async uploadPhotos(opId: string): Promise<Record<string, string>> {
    const fotos = await db.fotos_pendientes.where('op_id').equals(opId).toArray();
    const paths: Record<string, string> = {};
    for (const foto of fotos) {
      const { error } = await this.supabase.client.storage
        .from(foto.bucket)
        .upload(foto.path, foto.blob, { upsert: true, contentType: foto.blob.type });
      // upsert makes re-sends idempotent; a duplicate is not an error.
      if (error && !/exists/i.test(error.message)) throw error;
      paths[foto.slot] = foto.path;
    }
    return paths;
  }

  private async handleFailure(op: OutboxOp, err: unknown): Promise<void> {
    const permanent = err instanceof PermanentSyncError;
    const intentos = op.intentos + 1;
    const msg = err instanceof Error ? err.message : String(err);

    if (permanent || intentos >= MAX_INTENTOS) {
      await db.transaction('rw', db.outbox, db.mis_registros, async () => {
        await db.outbox.update(op.id, { estado: 'error', intentos, error_msg: msg });
        await db.mis_registros.update(op.id, { estado: 'error' });
      });
    } else {
      await db.outbox.update(op.id, {
        estado: 'pending',
        intentos,
        proximo_intento: Date.now() + BACKOFF[intentos - 1],
        error_msg: msg,
      });
    }
  }
}
