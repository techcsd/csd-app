import Dexie, { Table } from 'dexie';
import { SyncState } from '../../shared/ui/sync-badge/sync-badge';

/** Cached catalogue (materiales, vehículos, proyectos, actividades…). */
export interface CatalogoEntry {
  tipo: string;
  data: unknown;
  fetched_at: number;
}

/** A photo blob waiting to be uploaded, tied to an outbox op + target slot. */
export interface FotoPendiente {
  id: string;
  op_id: string;
  bucket: string;
  /** Storage object path to upload to, e.g. `{op_id}/frente.jpg`. */
  path: string;
  /** Which payload field the resulting path should be injected into. */
  slot: string;
  blob: Blob;
}

/**
 * One queued write. The payload is the RPC parameter object; photo paths are
 * spliced in by the op handler after upload. `id` is a client UUID so a
 * re-sent op is idempotent server-side (TRD §2).
 */
export interface OutboxOp {
  id: string;
  tipo_op: string;
  payload: Record<string, unknown>;
  estado: SyncState;
  intentos: number;
  proximo_intento: number;
  error_msg?: string;
  capturado_en: string;
  created_local: number;
}

/** A half-filled wizard (bitácora, checklist) recoverable after a crash. */
export interface Borrador {
  clave: string;
  data: unknown;
  updated_at: number;
}

/** Local copy of what was sent, for offline "Mis partes / Mis solicitudes". */
export interface RegistroLocal {
  id: string;
  tipo_op: string;
  resumen: unknown;
  estado: SyncState;
  created_local: number;
}

export class AppDb extends Dexie {
  catalogos!: Table<CatalogoEntry, string>;
  outbox!: Table<OutboxOp, string>;
  fotos_pendientes!: Table<FotoPendiente, string>;
  borradores!: Table<Borrador, string>;
  mis_registros!: Table<RegistroLocal, string>;

  constructor() {
    super('csd-app');
    this.version(1).stores({
      catalogos: 'tipo, fetched_at',
      outbox: 'id, estado, created_local',
      fotos_pendientes: 'id, op_id',
      borradores: 'clave, updated_at',
      mis_registros: 'id, tipo_op, created_local',
    });
  }
}

/** Single shared instance. */
export const db = new AppDb();
