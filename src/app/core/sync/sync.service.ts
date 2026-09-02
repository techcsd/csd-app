import { effect, inject, Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SupabaseService } from '../services/supabase.service';
import { NetworkService } from '../services/network.service';
import { db, FotoPendiente, OutboxOp } from '../db/app-db';
import { outboxCategoria } from '../util/outbox-categoria';

/** BG1(c) — un fix publicado por Tecnología (RPC `outbox_fixes_activos`). Si un
 *  pendiente 'sistema' coincide (tipo_op / error_code y versión ≥ min), la app
 *  sugiere reintentarlo. */
export interface OutboxFixActivo {
  id: string;
  tipo_op: string | null;
  error_code: string | null;
  min_app_version: string | null;
  descripcion: string;
  publicado_en: string;
}

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

/**
 * P5 — familia de la causa de un fallo permanente, para traducir el error a un
 * mensaje entendible en la pantalla "Pendientes de envío".
 */
export type SyncErrorKind =
  | 'validacion' // P0001 / 400 / 422 — el RPC rechazó los datos (mensaje propio)
  | 'permiso' // 403 / 42501 (RLS) — sin permiso
  | 'referencia' // 23xxx — FK/único: referencia inexistente o duplicada
  | 'no-encontrado' // 404
  | 'conflicto' // 409 — ya registrado
  | 'datos' // 22xxx — formato de dato inválido
  | 'foto' // la foto ya no está en el teléfono
  | 'incompatible' // firma de RPC / schema desajustado (app o servidor desactualizado)
  | 'red' // transitorio agotado (sin señal estable)
  | 'desconocido';

/** A server-side rejection that retrying won't fix (e.g. validation). */
export class PermanentSyncError extends Error {
  kind: SyncErrorKind;
  /** BC3 — campo señalado por el servidor (error tipado 22023). */
  campo?: string;
  /** BC3 — motivo estable del rechazo (requerido | formato_invalido | …). */
  motivo?: string;
  /** BG1 — SQLSTATE crudo (42501/23514/22001/22023…) para clasificar la categoría
   *  del outbox por código, no por texto. */
  code?: string;
  constructor(message: string, kind: SyncErrorKind = 'validacion', campo?: string, motivo?: string, code?: string) {
    super(message);
    this.kind = kind;
    this.campo = campo;
    this.motivo = motivo;
    this.code = code;
  }
}

/**
 * BC3 — extrae {campo, motivo} del error tipado del servidor (primitiva
 * `sgc.error_campo` → errcode 22023, `details` = JSON {campo,motivo}, `hint`=campo).
 * Ver docs/BC3-outbox-validacion-contrato.md.
 */
export function parseCampoMotivo(error: unknown): { campo?: string; motivo?: string } {
  const e = error as { details?: unknown; hint?: unknown };
  let campo: string | undefined;
  let motivo: string | undefined;
  const details = e?.details;
  if (typeof details === 'string' && details.trim().startsWith('{')) {
    try {
      const j = JSON.parse(details) as { campo?: string; motivo?: string };
      if (j.campo) campo = String(j.campo);
      if (j.motivo) motivo = String(j.motivo);
    } catch {
      /* details no era JSON: se ignora */
    }
  } else if (details && typeof details === 'object') {
    const j = details as { campo?: string; motivo?: string };
    if (j.campo) campo = String(j.campo);
    if (j.motivo) motivo = String(j.motivo);
  }
  if (!campo && typeof e?.hint === 'string' && e.hint.trim()) campo = e.hint.trim();
  return { campo, motivo };
}

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
  // Permanente por CÓDIGO (SQLSTATE del RPC/tabla o error de PostgREST): reintentar
  // NO ayuda. OJO: 42501 "permission denied" (falta un GRANT) llega como HTTP 401,
  // así que el código debe MANDAR sobre la heurística de 401=transitorio; si no,
  // los fallos de permiso se reintentaban en bucle para siempre (bug P5 real).
  const codePermanente =
    /^(P0001|22|23|42)/.test(code) || // validación RPC / datos / FK-único / permiso-privilegio
    /^DR\d/.test(code) || // AM1 — errores de negocio propios (DR451-454, DR461/462, DR471/472…): mensaje ya accionable, reintentar no ayuda
    /^PGRST(202|203|204|205)/.test(code) || // función/columna/tabla no encontrada (firma o schema)
    /schema cache|could not find the function/i.test(message);
  const statusPermanente = [400, 403, 404, 409, 422].includes(status);
  // 401/408/429/5xx son transitorios SOLO si no hay un código permanente detrás.
  const transient = (status === 401 || status === 408 || status === 429 || status >= 500) && !codePermanente;
  if (codePermanente || (statusPermanente && !transient)) {
    // BC3 — si el servidor señaló el campo (error tipado 22023 / borde 22P02), lo
    // arrastramos para que la tarjeta del outbox pueda marcarlo al corregir.
    // BG1 — y el SQLSTATE crudo, para clasificar la categoría por código.
    const { campo, motivo } = parseCampoMotivo(error);
    throw new PermanentSyncError(message, classifyKind(code, status, message), campo, motivo, code || undefined);
  }
  throw new Error(message); // default: retryable with backoff
}

function classifyKind(code: string, status: number, message = ''): SyncErrorKind {
  // BC3 — error tipado de validación con campo señalado (sgc.error_campo → 22023):
  // el mensaje ya viene en español y es accionable → 'validacion' (no 'datos'
  // genérico) para que la app muestre el texto real y marque el campo.
  if (/^22023/.test(code)) return 'validacion';
  // Desajuste de firma/esquema (PostgREST no encuentra la función) → app/servidor
  // desactualizado; no se arregla reintentando.
  if (/^PGRST(202|203|204|205)/.test(code) || /schema cache|could not find the function/i.test(message)) {
    return 'incompatible';
  }
  if (/^42501/.test(code) || status === 403) return 'permiso';
  if (/^23/.test(code)) return 'referencia';
  if (status === 404) return 'no-encontrado';
  if (status === 409) return 'conflicto';
  if (/^22/.test(code)) return 'datos';
  return 'validacion'; // P0001 / 400 / 422 y demás 42xxx → mensaje del RPC
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

  /**
   * AA1 — ops "best-effort" (telemetría): si fallan al enviarse se DESCARTAN en
   * silencio. Nunca aparecen en "Pendientes de envío", nunca piden acción al
   * usuario, nunca bloquean el drain ni cuentan como pendientes. `error_report`
   * es telemetría (PROMPT-2 FASE 1): perderla no le importa al usuario.
   */
  private static readonly SILENT_OPS = new Set<string>(['error_report']);
  private static isSilent(tipo_op: string): boolean {
    return SyncService.SILENT_OPS.has(tipo_op);
  }

  /**
   * Y6 — sink opcional para fallos PERMANENTES del outbox (un RPC que rechaza,
   * permiso/RLS, foto perdida, handler ausente…). Lo cablea ErrorReportService
   * para telemetría. NO se inyecta el servicio aquí (evita ciclo de DI).
   */
  onPermanentError?: (op: OutboxOp, err: unknown) => void;

  pendingCount = signal(0);
  errorCount = signal(0);
  syncing = signal(false);
  /** P5 — se incrementa en cada cambio del outbox para que la pantalla
   *  "Pendientes de envío" se refresque sola. */
  changed = signal(0);

  constructor() {
    // AA1 — limpieza one-shot: purga cualquier op silenciosa (error_report)
    // atascada de builds viejos ANTES de que la bandeja las muestre. A partir
    // del fix, estas ops nunca vuelven a quedarse en la cola (se descartan al
    // fallar), así que esto solo elimina las heredadas.
    void this.cleanupSilentOps().then(() => this.refreshCounts());
    // AY16 — reencola UNA vez las notas de voz que murieron en `error` antes del
    // fix del constraint mensajes_tipo_chk (cada una fallaba con 23514). Ahora
    // `audio` es válido, así que el saga de voices se sanea solo al actualizar.
    void this.sanearErroresAudioUnaVez();
    // Drain as soon as connectivity returns.
    effect(() => {
      if (this.network.online()) void this.drain();
    });
    // Safety-net ticker for backoff retries while the app is open.
    setInterval(() => void this.drain(), TICK_MS);
  }

  /** AA1 — borra las ops silenciosas que quedaron encoladas por builds viejos. */
  private async cleanupSilentOps(): Promise<void> {
    try {
      const stuck = await db.outbox.filter((o) => SyncService.isSilent(o.tipo_op)).toArray();
      if (!stuck.length) return;
      const ids = stuck.map((o) => o.id);
      await db.transaction('rw', db.outbox, db.fotos_pendientes, db.mis_registros, async () => {
        await db.outbox.bulkDelete(ids);
        for (const id of ids) {
          await db.fotos_pendientes.where('op_id').equals(id).delete();
          await db.mis_registros.delete(id);
        }
      });
    } catch {
      /* la limpieza nunca debe romper el arranque */
    }
  }

  /**
   * AY16 — saneo one-shot de las notas de voz atascadas en `error` desde antes
   * del fix del CHECK `mensajes_tipo_chk` (rechazaba tipo='audio'). Las reencola
   * a `pending` para que el drain las suba ahora que el constraint las acepta; el
   * RPC `enviar_nota_voz` es idempotente (ON CONFLICT) → un reenvío no duplica.
   * Gate por flag de Preferences para que corra SOLO una vez (no reintenta en
   * bucle si una op falla luego por una razón real).
   */
  private async sanearErroresAudioUnaVez(): Promise<void> {
    try {
      const KEY = 'sync.audioErrorSanitized.v1';
      const { value } = await Preferences.get({ key: KEY });
      if (value === '1') return;
      const errored = (await db.outbox.toArray()).filter(
        (o) => o.estado === 'error' && o.tipo_op === 'nota_voz_enviar',
      );
      for (const o of errored) {
        await db.outbox.update(o.id, { estado: 'pending', proximo_intento: 0 });
      }
      await Preferences.set({ key: KEY, value: '1' });
      if (errored.length) {
        await this.refreshCounts();
        void this.drain();
      }
    } catch {
      /* la sanitización nunca debe romper el arranque */
    }
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
      (input.fotos ?? []).map(async (f) => {
        // AE7 — un slot requerido sin blob (bug de validación aguas arriba) daba
        // un TypeError críptico en arrayBuffer() y se PERDÍA toda la captura. Falla
        // con un mensaje claro y accionable (el caller lo muestra y se reintenta).
        if (!f.blob) {
          throw new Error(`Falta la foto/firma "${f.slot}". Vuelve a tomarla e intenta de nuevo.`);
        }
        return {
          id: f.id,
          op_id: input.id,
          bucket: f.bucket,
          path: f.path,
          slot: f.slot,
          data: await f.blob.arrayBuffer(),
          type: f.blob.type || 'application/octet-stream',
        };
      }),
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
    // Limpiar también `permanente`/`error_kind`: un reintento explícito re-evalúa
    // el resultado desde cero (con el fix de `capturado_en` muchos "permanentes"
    // viejos ahora sí se envían).
    await db.outbox.update(id, {
      estado: 'pending',
      intentos: 0,
      proximo_intento: 0,
      error_msg: undefined,
      error_kind: undefined,
      error_code: undefined,
      error_campo: undefined,
      error_motivo: undefined,
      permanente: false,
      // BG1 — un reintento explícito re-abre la ventana de telemetría: si vuelve a
      // fallar como 'sistema', se re-reporta (actualiza ultima_vez / reabre resuelto).
      reportado_sistema: false,
    });
    await db.mis_registros.update(id, { estado: 'pending' });
    await this.refreshCounts();
    void this.drain();
  }

  /** Retry ALL errored ops (botón "Reintentar" de /pendientes). `drain()` salta
   *  los ops en error, así que hay que resetearlos a pending primero (APP-001).
   *  Es una acción EXPLÍCITA del usuario, así que reintenta TODOS los que están
   *  en error (incluidos los que quedaron "permanentes" con builds viejos): con
   *  el fix de `capturado_en` muchos ya se envían; los realmente irreparables
   *  (p. ej. vehículo borrado) vuelven a error en 1 intento y muestran Descartar
   *  (no hay bucle automático: drain() no reintenta ops en error por su cuenta). */
  async retryErrored(): Promise<void> {
    // Incluye también los 'pending' atascados en backoff largo (p. ej. subidas
    // que fallan por permiso/sesión): "Reintentar todos" debe forzar CADA envío
    // no completado a intentar YA (resetea intentos y proximo_intento).
    const items = await db.outbox.where('estado').anyOf('error', 'pending', 'syncing').toArray();
    if (items.length) {
      await db.transaction('rw', db.outbox, db.mis_registros, async () => {
        for (const op of items) {
          await db.outbox.update(op.id, {
            estado: 'pending',
            intentos: 0,
            proximo_intento: 0,
            error_msg: undefined,
            error_kind: undefined,
            error_code: undefined,
            error_campo: undefined,
            error_motivo: undefined,
            permanente: false,
            reportado_sistema: false,
          });
          await db.mis_registros.update(op.id, { estado: 'pending' });
        }
      });
    }
    await this.refreshCounts();
    void this.drain();
  }

  /** BG1(c) — reintenta un conjunto concreto de ops (los que un fix publicado dice
   *  que puede resolver). Resetea intentos/estado como `retry`, en una transacción. */
  async retryVarios(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await db.transaction('rw', db.outbox, db.mis_registros, async () => {
      for (const id of ids) {
        const op = await db.outbox.get(id);
        if (!op) continue;
        await db.outbox.update(id, {
          estado: 'pending',
          intentos: 0,
          proximo_intento: 0,
          error_msg: undefined,
          error_kind: undefined,
          error_code: undefined,
          error_campo: undefined,
          error_motivo: undefined,
          permanente: false,
          reportado_sistema: false,
        });
        await db.mis_registros.update(id, { estado: 'pending' });
      }
    });
    await this.refreshCounts();
    void this.drain();
  }

  /** P5 — descarta un envío atascado (con confirmación en la UI). Borra la op y
   *  sus fotos; conserva el registro local marcado "error" para no perderlo en
   *  silencio (queda visible en "Mis registros"). */
  async discard(id: string): Promise<void> {
    await db.transaction('rw', db.outbox, db.fotos_pendientes, db.mis_registros, async () => {
      await db.fotos_pendientes.where('op_id').equals(id).delete();
      await db.outbox.delete(id);
      await db.mis_registros.update(id, { estado: 'error' });
    });
    await this.refreshCounts();
  }

  /**
   * AW2 — cancela por completo una op AÚN pendiente (para "Revisar y corregir"):
   * borra la op, sus fotos y el registro local. A diferencia de `discard`, NO deja
   * un registro en 'error' (la echada nunca se envió y se va a re-registrar
   * corregida). Devuelve false si ya se envió o está en curso (no cancelable).
   */
  async cancelPending(id: string): Promise<boolean> {
    const op = await db.outbox.get(id);
    if (!op || op.estado !== 'pending') return false;
    await db.transaction('rw', db.outbox, db.fotos_pendientes, db.mis_registros, async () => {
      await db.fotos_pendientes.where('op_id').equals(id).delete();
      await db.outbox.delete(id);
      await db.mis_registros.delete(id);
    });
    await this.refreshCounts();
    return true;
  }

  /** AO3 — una op puntual (para reconstruir/corregir un conduce atascado). */
  async getOp(id: string): Promise<OutboxOp | null> {
    return (await db.outbox.get(id)) ?? null;
  }

  /** AO3 — fotos/firmas de una op, reconstruidas como Blob (WebKit-safe: ArrayBuffer
   *  + type; fallback a blob legacy). Para copiarlas a un borrador antes de descartar
   *  la op y NO perder la evidencia al corregir. */
  async getOpFotos(id: string): Promise<Array<{ slot: string; blob: Blob }>> {
    const rows = await db.fotos_pendientes.where('op_id').equals(id).toArray();
    return rows.map((f) => ({
      slot: f.slot,
      blob: f.data ? new Blob([f.data], { type: f.type || 'image/jpeg' }) : (f.blob as Blob),
    }));
  }

  /**
   * AX1 — ops de mensajería aún sin confirmar para una conversación, en orden
   * FIFO, con sus blobs reconstruidos. El hilo de chat pinta los mensajes
   * PENDIENTES desde AQUÍ (la cola durable), no desde una lista optimista en
   * memoria: así un `set(serverMsgs)` en un reload NUNCA borra un pendiente y el
   * estado real (pending/syncing/error) siempre se refleja. Cada item vive hasta
   * confirmarse (op borrada del outbox) o fallar visiblemente (estado 'error').
   */
  async opsMensajeria(
    conversacionId: string,
  ): Promise<Array<{ op: OutboxOp; fotos: Array<{ slot: string; blob: Blob }> }>> {
    const TIPOS = new Set(['mensaje_enviar', 'nota_voz_enviar', 'sticker_enviar']);
    const ops = (await db.outbox.orderBy('created_local').toArray()).filter(
      (o) => TIPOS.has(o.tipo_op) && o.payload['conversacion_id'] === conversacionId,
    );
    const out: Array<{ op: OutboxOp; fotos: Array<{ slot: string; blob: Blob }> }> = [];
    for (const op of ops) out.push({ op, fotos: await this.getOpFotos(op.id) });
    return out;
  }

  /** P5 — items del outbox para la pantalla de diagnóstico (FIFO, con nº fotos). */
  async listOutbox(): Promise<Array<OutboxOp & { fotos: number }>> {
    const ops = await db.outbox.orderBy('created_local').toArray();
    const out: Array<OutboxOp & { fotos: number }> = [];
    for (const op of ops) {
      if (SyncService.isSilent(op.tipo_op)) continue; // AA1 — telemetría nunca se muestra
      const fotos = await db.fotos_pendientes.where('op_id').equals(op.id).count();
      out.push({ ...op, fotos });
    }
    return out;
  }

  // ─── U1/U8 — Reconciliación optimista con el outbox ─────────────────────────
  // Los datos server-first no reflejan las ops que aún están en la cola. Estos
  // helpers calculan el "estado efectivo" = servidor + outbox pendiente para que
  // la app muestre el km recién capturado (aunque no haya drenado) y marque el
  // semanal enviado al instante. Generaliza el patrón de combustible.maxKmPendiente.

  /** Tipos de op que AVANZAN el odómetro del vehículo al drenar (regla no-retroceso). */
  private static readonly KM_TIPOS = [
    'vehiculo_entrega',
    'combustible',
    'checklist_preuso',
    'reporte_semanal',
    'mantenimiento',
  ];

  /** Ops del outbox aún sin confirmar (pending/syncing/error). */
  private async opsPendientes(): Promise<OutboxOp[]> {
    return db.outbox.where('estado').anyOf('pending', 'syncing', 'error').toArray();
  }

  /**
   * Máximo km que un vehículo tiene "en vuelo" en el outbox (0 si ninguno).
   * `vehiculo_entrega` guarda el km en `payload.km`; el resto en `payload.kilometraje`.
   */
  async kmPendiente(vehiculoId: string): Promise<number> {
    if (!vehiculoId) return 0;
    const ops = await this.opsPendientes();
    let max = 0;
    for (const op of ops) {
      if (!SyncService.KM_TIPOS.includes(op.tipo_op)) continue;
      const p = op.payload as Record<string, unknown>;
      if (p['vehiculo_id'] !== vehiculoId) continue;
      const km = Number(p['kilometraje'] ?? p['km']);
      if (Number.isFinite(km) && km > max) max = km;
    }
    return max;
  }

  /** km efectivo = max(km del servidor, km pendiente en el outbox). */
  async kmEfectivo(vehiculoId: string, kmServidor: number | null | undefined): Promise<number | null> {
    const base = kmServidor ?? null;
    const pend = await this.kmPendiente(vehiculoId);
    if (base == null) return pend > 0 ? pend : null;
    return Math.max(base, pend);
  }

  /**
   * Reportes semanales aún sin confirmar en el outbox: vehiculoId → fecha.
   * La UI del listado decide si la fecha cae en la semana de esa fila.
   */
  async reportesSemanalesPendientes(): Promise<Map<string, string>> {
    const ops = await this.opsPendientes();
    const out = new Map<string, string>();
    for (const op of ops) {
      if (op.tipo_op !== 'reporte_semanal') continue;
      const p = op.payload as Record<string, unknown>;
      const vid = p['vehiculo_id'];
      if (typeof vid !== 'string') continue;
      const fecha = String(p['fecha'] ?? op.capturado_en?.slice(0, 10) ?? '');
      const prev = out.get(vid);
      if (!prev || fecha > prev) out.set(vid, fecha);
    }
    return out;
  }

  private async refreshCounts(): Promise<void> {
    // AA1 — las ops silenciosas (telemetría) NO cuentan como pendientes/errores
    // para no ensuciar el badge de sincronización.
    const rows = await db.outbox.toArray();
    const visible = rows.filter((o) => !SyncService.isSilent(o.tipo_op));
    this.pendingCount.set(
      visible.filter((o) => o.estado === 'pending' || o.estado === 'syncing').length,
    );
    this.errorCount.set(visible.filter((o) => o.estado === 'error').length);
    this.changed.update((n) => n + 1);
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

  /** Falla una promesa si tarda demasiado, para que un envío colgado (subida/RPC
   *  que nunca resuelve) NO congele toda la cola (el guard `draining` quedaría en
   *  true para siempre y nada más se enviaría). El timeout cuenta como transitorio
   *  → se reintenta luego; la cola sigue con el resto. */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${label}). Se reintentará.`)), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  private async process(op: OutboxOp): Promise<void> {
    const handler = this.handlers.get(op.tipo_op);
    if (!handler) {
      // AA1 — op silenciosa sin handler (no debería pasar): descártala, no la
      // dejes acumularse ni pedir acción.
      if (SyncService.isSilent(op.tipo_op)) {
        await db.outbox.delete(op.id);
        return;
      }
      // S30 — con el bootstrap eager (app.config) esto no debería pasar. Red de
      // seguridad: NO dejar el item pending para siempre en silencio; contar
      // intentos con backoff y, tras MAX_INTENTOS, marcarlo error visible para
      // que se pueda Descartar (antes se saltaba y quedaba eterno).
      const intentos = op.intentos + 1;
      if (intentos >= MAX_INTENTOS) {
        await db.transaction('rw', db.outbox, db.mis_registros, async () => {
          await db.outbox.update(op.id, {
            estado: 'error',
            intentos,
            error_msg: `No se pudo procesar "${op.tipo_op}" (sin handler; posible desajuste de versión).`,
            error_kind: 'incompatible',
            permanente: true,
          });
          await db.mis_registros.update(op.id, { estado: 'error' });
        });
        this.onPermanentError?.(op, new PermanentSyncError(
          `Sin handler para "${op.tipo_op}" (posible desajuste de versión).`, 'incompatible'));
      } else {
        await db.outbox.update(op.id, {
          intentos,
          proximo_intento: Date.now() + BACKOFF[Math.min(intentos - 1, BACKOFF.length - 1)],
        });
      }
      return;
    }

    await db.outbox.update(op.id, { estado: 'syncing' });
    try {
      const photoPaths = await this.withTimeout(this.uploadPhotos(op.id), 90_000, 'subida de fotos');
      // Compatibilidad con items encolados por versiones viejas: si el payload no
      // trae `capturado_en` (varios RPC lo EXIGEN → fallaban con "function not
      // found" y reintentar no ayudaba), lo rellenamos desde la fila del outbox,
      // que SIEMPRE lo tiene. Así los envíos atascados por esto se envían al fin.
      const payload =
        op.payload['capturado_en'] == null
          ? { ...op.payload, capturado_en: op.capturado_en }
          : op.payload;
      await this.withTimeout(handler(payload, photoPaths), 90_000, 'guardar en el servidor');

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
      const rawType = foto.type || foto.blob?.type || 'application/octet-stream';
      // AW13 — el allowlist de mime del bucket valida por igualdad EXACTA y NO
      // acepta parámetros de codec: MediaRecorder produce 'audio/webm;codecs=opus'
      // (o 'audio/mp4;codecs=…' en iOS) → Storage responde 415 y la nota de voz
      // nunca sube (se "perdía"). Se sube con el mime BASE (audio/webm, audio/mp4).
      const type = rawType.split(';')[0].trim();
      // Reconstruye el Blob desde los bytes (o usa el legacy Blob si existiera).
      const body = foto.data ? new Blob([foto.data], { type }) : foto.blob;
      if (!body) {
        // P5 — bytes no persistidos (fila legacy / kill del SO): NO seguir en
        // silencio (subiría incompleto y fallaría en bucle). Marcar error claro.
        throw new PermanentSyncError(
          'La foto ya no está disponible en el teléfono.',
          'foto',
        );
      }
      const { error } = await this.supabase.client.storage
        .from(foto.bucket)
        .upload(foto.path, body, { upsert: true, contentType: type });
      // upsert makes re-sends idempotent; a duplicate is not an error.
      // P5 — clasificar el error de Storage (403/400 = permanente y legible) en vez
      // de lanzarlo crudo (que caía a transitorio y reintentaba en bucle).
      if (error && !/exists/i.test(error.message)) throwSyncError(error);
      paths[foto.slot] = foto.path;
    }
    return paths;
  }

  private async handleFailure(op: OutboxOp, err: unknown): Promise<void> {
    // AA1 — telemetría best-effort: si falla al enviarse, se DESCARTA en silencio
    // (nunca a estado 'error', nunca a la bandeja, sin reintentos ni ruido).
    if (SyncService.isSilent(op.tipo_op)) {
      await db.transaction('rw', db.outbox, db.fotos_pendientes, db.mis_registros, async () => {
        await db.fotos_pendientes.where('op_id').equals(op.id).delete();
        await db.mis_registros.delete(op.id);
        await db.outbox.delete(op.id);
      });
      return;
    }
    const permanent = err instanceof PermanentSyncError;
    const kind: SyncErrorKind = err instanceof PermanentSyncError ? err.kind : 'red';
    const intentos = op.intentos + 1;
    const msg = err instanceof Error ? err.message : String(err);
    // BC3 — campo/motivo señalado por el servidor (para marcarlo al corregir).
    const campo = err instanceof PermanentSyncError ? err.campo : undefined;
    const motivo = err instanceof PermanentSyncError ? err.motivo : undefined;
    // BG1 — SQLSTATE crudo, para clasificar la categoría por código.
    const code = err instanceof PermanentSyncError ? err.code : undefined;

    if (permanent || intentos >= MAX_INTENTOS) {
      // Transitorio agotado tras MAX_INTENTOS → casi seguro red/servidor: se puede
      // reintentar en bloque. Permanente → requiere acción explícita del usuario.
      await db.transaction('rw', db.outbox, db.mis_registros, async () => {
        await db.outbox.update(op.id, {
          estado: 'error',
          intentos,
          error_msg: msg,
          error_kind: kind,
          error_code: code,
          error_campo: campo,
          error_motivo: motivo,
          permanente: permanent,
        });
        await db.mis_registros.update(op.id, { estado: 'error' });
      });
      // Y6 — solo los PERMANENTES van a telemetría (un transitorio agotado suele
      // ser falta de señal, no un bug); evita ruido de reportes por mala cobertura.
      if (permanent) this.onPermanentError?.(op, err);
      // BG1/BG2 — si el fallo es de categoría 'sistema' (RLS/constraint/bug del
      // server, no culpa del usuario ni de su dato), lo reportamos a Tecnología
      // (best-effort) para que la data real atascada nunca se descubra por
      // screenshot dos semanas después. Idempotente por dedup_key server-side.
      void this.reportarSistemaSiCorresponde({ ...op, estado: 'error', error_kind: kind, error_code: code, error_campo: campo, permanente: permanent, error_msg: msg, intentos });
    } else {
      await db.outbox.update(op.id, {
        estado: 'pending',
        intentos,
        proximo_intento: Date.now() + BACKOFF[intentos - 1],
        error_msg: msg,
        error_kind: kind,
        error_code: code,
        error_campo: undefined,
        error_motivo: undefined,
      });
    }
  }

  /**
   * BG1/BG2 — reporta a Tecnología un item atascado por error de SISTEMA (una vez
   * por entrada al error; el RPC es idempotente por dedup_key igualmente). No
   * bloquea ni ensucia el flujo: si no hay red o el RPC falla, se ignora y se
   * volverá a intentar en el próximo fallo. NO se llama para 'dato' ni 'transitorio'.
   */
  private async reportarSistemaSiCorresponde(op: OutboxOp): Promise<void> {
    try {
      if (SyncService.isSilent(op.tipo_op)) return;
      if (op.reportado_sistema) return;
      if (outboxCategoria(op) !== 'sistema') return;
      if (!this.network.online()) return;
      const fotos = await db.fotos_pendientes.where('op_id').equals(op.id).count();
      const edadHoras = Math.max(0, Math.round((Date.now() - op.created_local) / 3_600_000));
      const resumen = this.payloadResumen(op);
      const { error } = await this.supabase.client.rpc('reportar_outbox_atascado', {
        p_dedup_key: op.id,
        p_tipo_op: op.tipo_op,
        p_categoria: 'sistema',
        p_error_kind: op.error_kind ?? null,
        p_error_code: op.error_code ?? null,
        p_error_msg: op.error_msg ?? null,
        p_intentos: op.intentos,
        p_fotos_count: fotos,
        p_edad_horas: edadHoras,
        p_payload_resumen: resumen,
      });
      if (!error) await db.outbox.update(op.id, { reportado_sistema: true });
    } catch {
      /* telemetría best-effort: nunca romper el drain */
    }
  }

  /** BG2 — resumen CHICO del payload para la telemetría (NO el payload completo ni
   *  las fotos): solo claves de identificación para que Tecnología ubique el caso. */
  private payloadResumen(op: OutboxOp): Record<string, unknown> {
    const p = op.payload ?? {};
    const out: Record<string, unknown> = {};
    for (const k of ['proyecto_id', 'fecha', 'tipo', 'vehiculo_id', 'salida_id', 'folio', 'destino_id', 'origen_id']) {
      if (p[k] != null) out[k] = p[k];
    }
    return out;
  }

  /**
   * BG1(c) — señales "corregido" publicadas por Tecnología (`outbox_fixes_activos`).
   * La pantalla de Pendientes las usa para SUGERIR el reintento de los atascados de
   * categoría 'sistema' que coincidan (por tipo_op / error_code y versión de la app).
   * Best-effort/online: sin red devuelve []. No cachea (la lista es corta y volátil).
   */
  async outboxFixesActivos(): Promise<OutboxFixActivo[]> {
    try {
      if (!this.network.online()) return [];
      const { data, error } = await this.supabase.client.rpc('outbox_fixes_activos');
      if (error || !Array.isArray(data)) return [];
      return data as OutboxFixActivo[];
    } catch {
      return [];
    }
  }
}
