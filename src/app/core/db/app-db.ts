import Dexie, { Table } from 'dexie';
import { SyncState } from '../../shared/ui/sync-badge/sync-badge';

/** Cached catalogue (materiales, vehículos, proyectos, actividades…). */
export interface CatalogoEntry {
  tipo: string;
  data: unknown;
  fetched_at: number;
}

/**
 * A photo waiting to be uploaded, tied to an outbox op + target slot.
 *
 * iOS/WebKit corrupts/fails on `Blob`/`File` stored directly in IndexedDB
 * ("Error preparing Blob/File data to be stored in object store"), so we
 * persist the raw bytes as `ArrayBuffer` + the MIME `type` and rebuild the
 * Blob on read. `blob` is kept optional only for legacy rows written before
 * this fix (read path falls back to it).
 */
export interface FotoPendiente {
  id: string;
  op_id: string;
  bucket: string;
  /** Storage object path to upload to, e.g. `{op_id}/frente.jpg`. */
  path: string;
  /** Which payload field the resulting path should be injected into. */
  slot: string;
  /** Raw bytes (WebKit-safe). */
  data?: ArrayBuffer;
  /** MIME type to rebuild the Blob (e.g. image/jpeg). */
  type?: string;
  /** Legacy: some old rows may still hold a Blob directly. */
  blob?: Blob;
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

/** A half-filled wizard (bitácora, checklist…) recoverable after a crash/leave.
 *  `tipo`/`etiqueta`/`ruta` power the "Documentación en proceso" list + resume. */
export interface Borrador {
  clave: string;
  data: unknown;
  updated_at: number;
  /** Short kind, e.g. 'checklist', 'conductor', 'vehiculo', 'parte'. */
  tipo?: string;
  /** Human label for the list, e.g. "Pre-uso · ABC-123". */
  etiqueta?: string;
  /** Route to resume the draft. */
  ruta?: string;
}

/** Local copy of what was sent, for offline "Mis partes / Mis solicitudes". */
export interface RegistroLocal {
  id: string;
  tipo_op: string;
  resumen: unknown;
  estado: SyncState;
  created_local: number;
}

/**
 * M1 — a photo belonging to an in-progress draft (e.g. the pre-uso wizard),
 * persisted so it survives an OS process kill (MIUI/low-mem) and can be
 * rehydrated when the user reopens the app. Same WebKit-safe rule as
 * `fotos_pendientes`: store raw bytes as `ArrayBuffer` + MIME, rebuild the Blob
 * on read. Keyed by `${clave}::${slot}`; `clave` matches the borrador row so
 * both are cleared together on submit/discard.
 */
export interface BorradorFoto {
  /** `${clave}::${slot}` — unique per draft+slot. */
  id: string;
  /** Draft key (matches the borradores row). Indexed for bulk clear. */
  clave: string;
  /** Slot within the draft, e.g. 'frente', 'item:<id>', 'firma'. */
  slot: string;
  /** Raw bytes (WebKit-safe). */
  data: ArrayBuffer;
  /** MIME type to rebuild the Blob (e.g. image/jpeg). */
  type: string;
}

export class AppDb extends Dexie {
  catalogos!: Table<CatalogoEntry, string>;
  outbox!: Table<OutboxOp, string>;
  fotos_pendientes!: Table<FotoPendiente, string>;
  borradores!: Table<Borrador, string>;
  mis_registros!: Table<RegistroLocal, string>;
  borrador_fotos!: Table<BorradorFoto, string>;

  constructor() {
    super('csd-app');
    this.version(1).stores({
      catalogos: 'tipo, fetched_at',
      outbox: 'id, estado, created_local',
      fotos_pendientes: 'id, op_id',
      borradores: 'clave, updated_at',
      mis_registros: 'id, tipo_op, created_local',
    });
    // v2 (M1) — fotos de borrador para recuperar el pre-uso tras un kill del SO.
    this.version(2).stores({
      borrador_fotos: 'id, clave',
    });
  }
}

/** Single shared instance. */
export const db = new AppDb();
