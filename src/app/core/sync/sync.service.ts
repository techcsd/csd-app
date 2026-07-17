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

/**
 * Classifies a Supabase/PostgREST error from an RPC and throws the right kind:
 * - PermanentSyncError → the request itself is bad; retrying can't help
 *   (our RPC validation `raise exception` = SQLSTATE P0001, integrity/data/
 *   undefined errors, or client 4xx like 400/409/422).
 * - plain Error → transient (network, 401 expired JWT, 408/429, 5xx): must fall
 *   through to backoff retry so the capture syncs itself once signal/token is back.
 * Handlers call this instead of blindly throwing PermanentSyncError on any error.
 */
export function throwSyncError(error: unknown): never {
  const e = error as { message?: string; code?: string; status?: number; statusCode?: number };
  const message = e?.message ?? String(error);
  const code = String(e?.code ?? '');
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  const transient = status === 401 || status === 408 || status === 429 || status >= 500;
  const permanent = /^(P0001|22|23|42)/.test(code) || [400, 403, 404, 409, 422].includes(status);
  if (permanent && !transient) throw new PermanentSyncError(message);
  throw new Error(message); // default: retryable with backoff
}

export interface EnqueueInput {
  id: string; // client UUID
  tipo_op: string;
  payload: Record<string, unknown>;
  capturado_en?: string;
  fotos?: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }>;
  resumen?: unknown; // for the local "mis registros" list
}

// Backoff schedule (ms) between retries: 30s → 1m → 2m → 5m → 5m; after
// MAX_INTENTOS failed attempts the op goes to `error` (⚠️). Every BACKOFF entry
// is used (failures 1..5 wait BACKOFF[0..4]; the 6th failure gives up).
const BACKOFF = [30_000, 60_000, 120_000, 300_000, 300_000];
const MAX_INTENTOS = BACKOFF.length + 1;
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
    // WebKit/iOS falla al guardar Blob/File en IndexedDB → persistimos los bytes
    // como ArrayBuffer (+ type) y reconstruimos el Blob al subir. La conversión va
    // ANTES de la transacción (Dexie no permite await arbitrario dentro de ella).
    const fotos: FotoPendiente[] = await Promise.all(
      (input.fotos ?? []).map(async (f) => ({
        id: f.id,
        op_id: input.id,
        bucket: f.bucket,
        path: f.path,
        slot: f.slot,
        data: await f.blob.arrayBuffer(),
        type: f.blob.type || 'application/octet-stream',
      })),
    );

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

  /** User-triggered retry of an errored op (⚠️ badge tap). Resets intentos so
   *  the backoff schedule re-engages instead of failing on the first try. */
  async retry(id: string): Promise<void> {
    const op = await db.outbox.get(id);
    if (!op) return;
    await db.outbox.update(id, { estado: 'pending', intentos: 0, proximo_intento: 0, error_msg: undefined });
    await db.mis_registros.update(id, { estado: 'pending' });
    await this.refreshCounts();
    void this.drain();
  }

  /** Retry ALL errored ops (global ⚠️ "toca para reintentar" bar). `drain()`
   *  skips errored ops, so we must reset them to pending first (APP-001). */
  async retryErrored(): Promise<void> {
    const errored = await db.outbox.where('estado').equals('error').toArray();
    if (errored.length) {
      await db.transaction('rw', db.outbox, db.mis_registros, async () => {
        for (const op of errored) {
          await db.outbox.update(op.id, { estado: 'pending', intentos: 0, proximo_intento: 0, error_msg: undefined });
          await db.mis_registros.update(op.id, { estado: 'pending' });
        }
      });
    }
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
      const type = foto.type || foto.blob?.type || 'application/octet-stream';
      // Reconstruye el Blob desde los bytes (o usa el legacy Blob si existiera).
      const body = foto.data ? new Blob([foto.data], { type }) : foto.blob;
      if (!body) continue; // sin datos utilizables → nada que subir
      const { error } = await this.supabase.client.storage
        .from(foto.bucket)
        .upload(foto.path, body, { upsert: true, contentType: type });
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
